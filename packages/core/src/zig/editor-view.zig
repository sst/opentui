const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const tbv = @import("text-buffer-view.zig");
const eb = @import("edit-buffer.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const gp = @import("grapheme.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");
const EditBuffer = eb.EditBuffer;

// Use the unified types to match EditBuffer
const UnifiedTextBuffer = tb.UnifiedTextBuffer;
const UnifiedTextBufferView = tbv.UnifiedTextBufferView;
const VirtualLine = tbv.VirtualLine;

pub const EditorViewError = error{
    OutOfMemory,
};

pub const VisualCursor = struct {
    visual_row: u32,
    visual_col: u32,
    logical_row: u32,
    logical_col: u32,
};

/// EditorView wraps a TextBufferView and manages viewport state for efficient rendering
/// It also holds a reference to an EditBuffer for cursor/editing operations
pub const EditorView = struct {
    text_buffer_view: *UnifiedTextBufferView,
    edit_buffer: *EditBuffer, // Reference to the EditBuffer (not owned)
    scroll_margin: f32, // Fraction of viewport height (0.0-0.5) to keep cursor away from edges

    // Memory management
    global_allocator: Allocator,

    pub fn init(global_allocator: Allocator, edit_buffer: *EditBuffer, viewport_width: u32, viewport_height: u32) EditorViewError!*EditorView {
        const self = global_allocator.create(EditorView) catch return EditorViewError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        // Get TextBuffer from EditBuffer and create TextBufferView
        const text_buffer = edit_buffer.getTextBuffer();
        const text_buffer_view = UnifiedTextBufferView.init(global_allocator, text_buffer) catch return EditorViewError.OutOfMemory;
        errdefer text_buffer_view.deinit();

        self.* = .{
            .text_buffer_view = text_buffer_view,
            .edit_buffer = edit_buffer,
            .scroll_margin = 0.15, // Default 15% margin
            .global_allocator = global_allocator,
        };

        // Set initial viewport on the text buffer view
        text_buffer_view.setViewport(tbv.Viewport{
            .x = 0,
            .y = 0,
            .width = viewport_width,
            .height = viewport_height,
        });

        return self;
    }

    pub fn deinit(self: *EditorView) void {
        self.text_buffer_view.deinit(); // We own this
        self.global_allocator.destroy(self);
    }

    /// Set the viewport. If wrapping is enabled and viewport width differs from current wrap width,
    /// this will trigger a reflow by updating the TextBufferView's wrap width.
    pub fn setViewport(self: *EditorView, vp: ?tbv.Viewport) void {
        self.text_buffer_view.setViewport(vp);
    }

    pub fn getViewport(self: *const EditorView) ?tbv.Viewport {
        return self.text_buffer_view.getViewport();
    }

    /// Set the scroll margin as a fraction of viewport height (0.0 to 0.5)
    /// The cursor will stay at least this many lines from the top/bottom edges when scrolling
    pub fn setScrollMargin(self: *EditorView, margin: f32) void {
        self.scroll_margin = @max(0.0, @min(0.5, margin));
    }

    /// Ensure the cursor is visible within the viewport, adjusting viewport.y if needed
    /// cursor_line: The virtual line index where the cursor is located
    pub fn ensureCursorVisible(self: *EditorView, cursor_line: u32) void {
        const vp = self.text_buffer_view.getViewport() orelse return;

        const viewport_height = vp.height;
        if (viewport_height == 0) return;

        const margin_lines = @max(1, @as(u32, @intFromFloat(@as(f32, @floatFromInt(viewport_height)) * self.scroll_margin)));

        // Get total virtual line count to determine max offset
        const total_lines = self.text_buffer_view.getVirtualLineCount();
        const max_offset = if (total_lines > viewport_height) total_lines - viewport_height else 0;

        var new_offset_y = vp.y;

        // Check if cursor is above viewport (with margin)
        if (cursor_line < vp.y + margin_lines) {
            // Scroll up to show cursor at margin from top
            if (cursor_line >= margin_lines) {
                new_offset_y = cursor_line - margin_lines;
            } else {
                new_offset_y = 0;
            }
        }
        // Check if cursor is below viewport (with margin)
        else if (cursor_line >= vp.y + viewport_height - margin_lines) {
            // Scroll down to show cursor at margin from bottom
            const desired_offset = cursor_line + margin_lines - viewport_height + 1;
            new_offset_y = @min(desired_offset, max_offset);
        }

        // Update viewport if offset changed
        if (new_offset_y != vp.y) {
            self.text_buffer_view.setViewport(tbv.Viewport{
                .x = vp.x,
                .y = new_offset_y,
                .width = vp.width,
                .height = vp.height,
            });
        }
    }

    /// Update and ensure cursor is visible if the buffer is dirty
    /// This should be called before rendering to react to buffer changes (e.g., setText)
    pub fn updateIfDirty(self: *EditorView) void {
        const buffer_dirty = self.text_buffer_view.text_buffer.isViewDirty(self.text_buffer_view.view_id);
        if (buffer_dirty) {
            // Buffer changed (e.g., setText was called), ensure cursor is visible
            const cursor = self.edit_buffer.getPrimaryCursor();
            self.ensureCursorVisible(cursor.row);
        }
    }

    /// Get virtual lines for the current viewport
    /// Returns a slice of virtual lines that are visible in the viewport
    /// The TextBufferView handles viewport slicing internally
    /// Automatically ensures cursor is visible if buffer is dirty
    pub fn getVirtualLines(self: *EditorView) []const VirtualLine {
        self.updateIfDirty();
        return self.text_buffer_view.getVirtualLines();
    }

    /// Get cached line info for the viewport
    /// Returns character offsets, widths, and max width for viewport lines only
    /// The TextBufferView handles viewport slicing internally
    /// Automatically ensures cursor is visible if buffer is dirty
    pub fn getCachedLineInfo(self: *EditorView) tbv.LineInfo {
        self.updateIfDirty();
        return self.text_buffer_view.getCachedLineInfo();
    }

    /// Get the underlying TextBufferView
    pub fn getTextBufferView(self: *EditorView) *UnifiedTextBufferView {
        return self.text_buffer_view;
    }

    /// Get the total number of virtual lines (not constrained by viewport)
    pub fn getTotalVirtualLineCount(self: *EditorView) u32 {
        return self.text_buffer_view.getVirtualLineCount();
    }

    /// Set viewport size (width and height only)
    /// This is a convenience method that preserves existing offset
    pub fn setViewportSize(self: *EditorView, width: u32, height: u32) void {
        self.text_buffer_view.setViewportSize(width, height);
    }

    /// Set wrap mode (none, char, or word)
    pub fn setWrapMode(self: *EditorView, mode: tb.WrapMode) void {
        self.text_buffer_view.setWrapMode(mode);
    }

    // ============================================================================
    // Viewport-aware EditBuffer wrappers
    // These methods wrap EditBuffer operations and ensure cursor visibility
    // ============================================================================

    /// Set cursor position and ensure it's visible in viewport
    pub fn setCursor(self: *EditorView, row: u32, col: u32) !void {
        try self.edit_buffer.setCursor(row, col);
        self.ensureCursorVisible(row);
    }

    /// Insert text at cursor and ensure cursor remains visible
    pub fn insertText(self: *EditorView, bytes: []const u8) !void {
        try self.edit_buffer.insertText(bytes);
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Delete range and ensure cursor remains visible
    pub fn deleteRange(self: *EditorView, start_cursor: eb.Cursor, end_cursor: eb.Cursor) !void {
        try self.edit_buffer.deleteRange(start_cursor, end_cursor);
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Backspace and ensure cursor remains visible
    pub fn backspace(self: *EditorView) !void {
        try self.edit_buffer.backspace();
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Delete forward and ensure cursor remains visible
    pub fn deleteForward(self: *EditorView) !void {
        try self.edit_buffer.deleteForward();
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Move cursor left and ensure it remains visible
    pub fn moveLeft(self: *EditorView) void {
        self.edit_buffer.moveLeft();
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Move cursor right and ensure it remains visible
    pub fn moveRight(self: *EditorView) void {
        self.edit_buffer.moveRight();
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Move cursor up and ensure it remains visible
    pub fn moveUp(self: *EditorView) void {
        self.edit_buffer.moveUp();
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Move cursor down and ensure it remains visible
    pub fn moveDown(self: *EditorView) void {
        self.edit_buffer.moveDown();
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Delete current line and ensure cursor remains visible
    pub fn deleteLine(self: *EditorView) !void {
        try self.edit_buffer.deleteLine();
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Go to line and ensure cursor is visible
    pub fn gotoLine(self: *EditorView, line: u32) !void {
        try self.edit_buffer.gotoLine(line);
        const cursor = self.edit_buffer.getPrimaryCursor();
        self.ensureCursorVisible(cursor.row);
    }

    /// Get primary cursor position
    pub fn getPrimaryCursor(self: *const EditorView) eb.Cursor {
        return self.edit_buffer.getPrimaryCursor();
    }

    /// Get cursor by index
    pub fn getCursor(self: *const EditorView, idx: usize) ?eb.Cursor {
        return self.edit_buffer.getCursor(idx);
    }

    /// Get text content
    pub fn getText(self: *EditorView, out_buffer: []u8) usize {
        return self.edit_buffer.getText(out_buffer);
    }

    /// Get the EditBuffer for direct access when needed
    pub fn getEditBuffer(self: *EditorView) *EditBuffer {
        return self.edit_buffer;
    }

    // ============================================================================
    // VisualCursor - Wrapping-aware cursor translation
    // ============================================================================

    /// Translate EditBuffer cursor (logical row/col) to visual cursor (accounting for wrapping)
    /// Returns null if cursor is out of bounds
    /// Automatically ensures cursor is visible if buffer is dirty
    pub fn getVisualCursor(self: *EditorView) ?VisualCursor {
        self.updateIfDirty();
        const cursor = self.edit_buffer.getPrimaryCursor();
        return self.logicalToVisualCursor(cursor.row, cursor.col);
    }

    /// Convert logical (row, col) to visual cursor position
    /// This accounts for line wrapping by finding which virtual line contains the logical position
    pub fn logicalToVisualCursor(self: *EditorView, logical_row: u32, logical_col: u32) ?VisualCursor {
        // Update virtual lines to ensure we have current wrapping info
        self.text_buffer_view.updateVirtualLines();

        const vlines = self.text_buffer_view.virtual_lines.items;
        if (vlines.len == 0) return null;

        // Find virtual lines that belong to this logical line
        for (vlines, 0..) |vline, idx| {
            if (vline.source_line == logical_row) {
                const vline_start_col = vline.source_col_offset;
                const vline_end_col = vline_start_col + vline.width;

                // Check if logical_col falls within this virtual line
                // Use < for end check instead of <=, except for the last virtual line
                const is_last_vline_for_line = idx + 1 >= vlines.len or vlines[idx + 1].source_line != logical_row;
                const end_check = if (is_last_vline_for_line) logical_col <= vline_end_col else logical_col < vline_end_col;

                if (logical_col >= vline_start_col and end_check) {
                    return VisualCursor{
                        .visual_row = @intCast(idx),
                        .visual_col = logical_col - vline_start_col,
                        .logical_row = logical_row,
                        .logical_col = logical_col,
                    };
                }
            }
        }

        // If not found, return cursor at end of last virtual line for this logical line
        var last_vline_idx: ?usize = null;
        for (vlines, 0..) |vline, idx| {
            if (vline.source_line == logical_row) {
                last_vline_idx = idx;
            } else if (vline.source_line > logical_row) {
                break;
            }
        }

        if (last_vline_idx) |idx| {
            const vline = &vlines[idx];
            return VisualCursor{
                .visual_row = @intCast(idx),
                .visual_col = vline.width,
                .logical_row = logical_row,
                .logical_col = logical_col,
            };
        }

        return null;
    }

    /// Convert visual (row, col) to logical cursor position
    pub fn visualToLogicalCursor(self: *EditorView, visual_row: u32, visual_col: u32) ?VisualCursor {
        self.text_buffer_view.updateVirtualLines();

        const vlines = self.text_buffer_view.virtual_lines.items;
        if (visual_row >= vlines.len) return null;

        const vline = &vlines[visual_row];
        const clamped_visual_col = @min(visual_col, vline.width);
        const logical_col = vline.source_col_offset + clamped_visual_col;

        return VisualCursor{
            .visual_row = visual_row,
            .visual_col = clamped_visual_col,
            .logical_row = @intCast(vline.source_line),
            .logical_col = logical_col,
        };
    }

    /// Move cursor up by one visual line (handles wrapped lines)
    pub fn moveUpVisual(self: *EditorView) void {
        const vcursor = self.getVisualCursor() orelse return;

        if (vcursor.visual_row == 0) {
            // Already at top
            return;
        }

        // Move to previous visual line
        const target_visual_row = vcursor.visual_row - 1;

        // Use visual column for desired position (not logical column from EditBuffer's desired_col)
        // This ensures consistent behavior when moving through wrapped lines
        const desired_visual_col = vcursor.visual_col;

        // Convert to new position
        if (self.visualToLogicalCursor(target_visual_row, desired_visual_col)) |new_vcursor| {
            // Update EditBuffer cursor
            if (self.edit_buffer.cursors.items.len > 0) {
                self.edit_buffer.cursors.items[0] = .{
                    .row = new_vcursor.logical_row,
                    .col = new_vcursor.logical_col,
                    .desired_col = new_vcursor.logical_col,
                };
                self.ensureCursorVisible(new_vcursor.visual_row);
            }
        }
    }

    /// Move cursor down by one visual line (handles wrapped lines)
    pub fn moveDownVisual(self: *EditorView) void {
        const vcursor = self.getVisualCursor() orelse return;

        self.text_buffer_view.updateVirtualLines();
        const vlines = self.text_buffer_view.virtual_lines.items;

        if (vcursor.visual_row + 1 >= vlines.len) {
            // Already at bottom
            return;
        }

        // Move to next visual line
        const target_visual_row = vcursor.visual_row + 1;

        // Use visual column for desired position (not logical column from EditBuffer's desired_col)
        // This ensures consistent behavior when moving through wrapped lines
        const desired_visual_col = vcursor.visual_col;

        // Convert to new position
        if (self.visualToLogicalCursor(target_visual_row, desired_visual_col)) |new_vcursor| {
            // Update EditBuffer cursor
            if (self.edit_buffer.cursors.items.len > 0) {
                self.edit_buffer.cursors.items[0] = .{
                    .row = new_vcursor.logical_row,
                    .col = new_vcursor.logical_col,
                    .desired_col = new_vcursor.logical_col,
                };
                self.ensureCursorVisible(new_vcursor.visual_row);
            }
        }
    }
};
