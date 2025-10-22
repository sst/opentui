const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const tbv = @import("text-buffer-view.zig");
const eb = @import("edit-buffer.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const gp = @import("grapheme.zig");
const event_emitter = @import("event-emitter.zig");
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

/// VisualCursor represents a cursor position with both visual and logical coordinates.
/// Visual coordinates (visual_row, visual_col) are VIEWPORT-RELATIVE.
/// This means visual_row=0 is the first visible line in the viewport, not the first line in the document.
/// Logical coordinates (logical_row, logical_col) are document-absolute.
pub const VisualCursor = struct {
    visual_row: u32, // Viewport-relative row (0 = top of viewport)
    visual_col: u32, // Viewport-relative column (0 = left edge of viewport when not wrapping)
    logical_row: u32, // Document-absolute row
    logical_col: u32, // Document-absolute column
    offset: u32, // Global display-width offset from buffer start
};

/// EditorView wraps a TextBufferView and manages viewport state for efficient rendering
/// It also holds a reference to an EditBuffer for cursor/editing operations
pub const EditorView = struct {
    text_buffer_view: *UnifiedTextBufferView,
    edit_buffer: *EditBuffer, // Reference to the EditBuffer (not owned)
    scroll_margin: f32, // Fraction of viewport height (0.0-0.5) to keep cursor away from edges
    desired_visual_col: ?u32, // Preserved visual column for visual up/down navigation
    cursor_changed_listener: event_emitter.EventEmitter(eb.EditBufferEvent).Listener,

    // Memory management
    global_allocator: Allocator,

    fn onCursorChanged(ctx: *anyopaque) void {
        const self: *EditorView = @ptrCast(@alignCast(ctx));
        // Reset desired visual column when cursor changes via non-visual means
        self.desired_visual_col = null;
    }

    pub fn init(global_allocator: Allocator, edit_buffer: *EditBuffer, viewport_width: u32, viewport_height: u32) EditorViewError!*EditorView {
        const self = global_allocator.create(EditorView) catch return EditorViewError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const text_buffer = edit_buffer.getTextBuffer();
        const text_buffer_view = UnifiedTextBufferView.init(global_allocator, text_buffer) catch return EditorViewError.OutOfMemory;
        errdefer text_buffer_view.deinit();

        self.* = .{
            .text_buffer_view = text_buffer_view,
            .edit_buffer = edit_buffer,
            .scroll_margin = 0.15, // Default 15% margin
            .desired_visual_col = null,
            .cursor_changed_listener = .{
                .ctx = undefined, // Will be set below
                .handle = onCursorChanged,
            },
            .global_allocator = global_allocator,
        };

        // Set self reference in listener
        self.cursor_changed_listener.ctx = self;

        // Register listener with EditBuffer
        edit_buffer.events.on(.cursorChanged, self.cursor_changed_listener) catch return EditorViewError.OutOfMemory;

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
        self.edit_buffer.events.off(.cursorChanged, self.cursor_changed_listener);
        self.text_buffer_view.deinit();
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

    /// Ensure the cursor is visible within the viewport, adjusting viewport.y and viewport.x if needed
    /// cursor_line: The virtual line index where the cursor is located
    pub fn ensureCursorVisible(self: *EditorView, cursor_line: u32) void {
        const vp = self.text_buffer_view.getViewport() orelse return;

        const viewport_height = vp.height;
        const viewport_width = vp.width;
        if (viewport_height == 0 or viewport_width == 0) return;

        const margin_lines = @max(1, @as(u32, @intFromFloat(@as(f32, @floatFromInt(viewport_height)) * self.scroll_margin)));
        const margin_cols = @max(1, @as(u32, @intFromFloat(@as(f32, @floatFromInt(viewport_width)) * self.scroll_margin)));

        // Get total virtual line count to determine max vertical offset
        const total_lines = self.text_buffer_view.getVirtualLineCount();
        const max_offset_y = if (total_lines > viewport_height) total_lines - viewport_height else 0;

        var new_offset_y = vp.y;
        var new_offset_x = vp.x;

        // Vertical scrolling
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
            new_offset_y = @min(desired_offset, max_offset_y);
        }

        // Horizontal scrolling (only when wrapping is disabled)
        if (self.text_buffer_view.wrap_mode == .none) {
            const cursor = self.edit_buffer.getPrimaryCursor();
            const cursor_col = cursor.col;

            // Check if cursor is left of viewport (with margin)
            if (cursor_col < vp.x + margin_cols) {
                // Scroll left to show cursor at margin from left edge
                if (cursor_col >= margin_cols) {
                    new_offset_x = cursor_col - margin_cols;
                } else {
                    new_offset_x = 0;
                }
            }
            // Check if cursor is right of viewport (with margin)
            else if (cursor_col >= vp.x + viewport_width - margin_cols) {
                // Scroll right to show cursor at margin from right edge
                new_offset_x = cursor_col + margin_cols - viewport_width + 1;
            }
        }

        // Update viewport if offset changed
        if (new_offset_y != vp.y or new_offset_x != vp.x) {
            self.text_buffer_view.setViewport(tbv.Viewport{
                .x = new_offset_x,
                .y = new_offset_y,
                .width = vp.width,
                .height = vp.height,
            });
        }
    }

    /// Always ensures cursor visibility since cursor movements don't mark buffer dirty
    pub fn updateBeforeRender(self: *EditorView) void {
        const cursor = self.edit_buffer.getPrimaryCursor();
        const vcursor = self.logicalToVisualCursor(cursor.row, cursor.col);
        self.ensureCursorVisible(vcursor.visual_row);
    }

    /// Automatically ensures cursor is visible before rendering
    pub fn getVirtualLines(self: *EditorView) []const VirtualLine {
        self.updateBeforeRender();
        return self.text_buffer_view.getVirtualLines();
    }

    /// Automatically ensures cursor is visible before rendering
    pub fn getCachedLineInfo(self: *EditorView) tbv.LineInfo {
        self.updateBeforeRender();
        return self.text_buffer_view.getCachedLineInfo();
    }

    pub fn getTextBufferView(self: *EditorView) *UnifiedTextBufferView {
        return self.text_buffer_view;
    }

    pub fn getTotalVirtualLineCount(self: *EditorView) u32 {
        return self.text_buffer_view.getVirtualLineCount();
    }

    /// This is a convenience method that preserves existing offset
    pub fn setViewportSize(self: *EditorView, width: u32, height: u32) void {
        self.text_buffer_view.setViewportSize(width, height);
    }

    pub fn setWrapMode(self: *EditorView, mode: tb.WrapMode) void {
        self.text_buffer_view.setWrapMode(mode);
    }

    pub fn getPrimaryCursor(self: *const EditorView) eb.Cursor {
        return self.edit_buffer.getPrimaryCursor();
    }

    pub fn getCursor(self: *const EditorView, idx: usize) ?eb.Cursor {
        return self.edit_buffer.getCursor(idx);
    }

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

    /// Returns viewport-relative visual coordinates for external API consumers
    pub fn getVisualCursor(self: *EditorView) VisualCursor {
        self.updateBeforeRender();
        const cursor = self.edit_buffer.getPrimaryCursor();
        const vcursor = self.logicalToVisualCursor(cursor.row, cursor.col);

        // Convert absolute visual coordinates to viewport-relative for the API
        const vp = self.text_buffer_view.getViewport() orelse return vcursor;

        const viewport_relative_row = if (vcursor.visual_row >= vp.y) vcursor.visual_row - vp.y else 0;
        const viewport_relative_col = if (self.text_buffer_view.wrap_mode == .none)
            (if (vcursor.visual_col >= vp.x) vcursor.visual_col - vp.x else 0)
        else
            vcursor.visual_col;

        return VisualCursor{
            .visual_row = viewport_relative_row,
            .visual_col = viewport_relative_col,
            .logical_row = vcursor.logical_row,
            .logical_col = vcursor.logical_col,
            .offset = vcursor.offset,
        };
    }

    /// This accounts for line wrapping by finding which virtual line contains the logical position
    /// Returns absolute visual coordinates (document-absolute, not viewport-relative)
    pub fn logicalToVisualCursor(self: *EditorView, logical_row: u32, logical_col: u32) VisualCursor {
        // Clamp logical coordinates to valid buffer ranges
        const line_count = iter_mod.getLineCount(&self.edit_buffer.tb.rope);
        const clamped_row = if (line_count > 0) @min(logical_row, line_count - 1) else 0;

        const line_width = iter_mod.lineWidthAt(&self.edit_buffer.tb.rope, clamped_row);
        const clamped_col = @min(logical_col, line_width);

        const visual_row_idx = self.text_buffer_view.findVisualLineIndex(clamped_row, clamped_col);

        const vlines = self.text_buffer_view.virtual_lines.items;
        if (vlines.len == 0 or visual_row_idx >= vlines.len) {
            // Fallback for edge cases
            const offset = iter_mod.coordsToOffset(&self.edit_buffer.tb.rope, clamped_row, clamped_col) orelse 0;
            return VisualCursor{
                .visual_row = 0,
                .visual_col = 0,
                .logical_row = clamped_row,
                .logical_col = clamped_col,
                .offset = offset,
            };
        }

        const vline = &vlines[visual_row_idx];
        const vline_start_col = vline.source_col_offset;

        // Calculate visual column within this virtual line
        const visual_col = if (clamped_col >= vline_start_col)
            clamped_col - vline_start_col
        else
            0;

        const offset = iter_mod.coordsToOffset(&self.edit_buffer.tb.rope, clamped_row, clamped_col) orelse 0;

        return VisualCursor{
            .visual_row = visual_row_idx,
            .visual_col = visual_col,
            .logical_row = clamped_row,
            .logical_col = clamped_col,
            .offset = offset,
        };
    }

    /// Input visual coordinates are absolute (document-absolute)
    /// Returns a VisualCursor with absolute visual coordinates
    pub fn visualToLogicalCursor(self: *EditorView, visual_row: u32, visual_col: u32) ?VisualCursor {
        self.text_buffer_view.updateVirtualLines();

        const vlines = self.text_buffer_view.virtual_lines.items;
        if (visual_row >= vlines.len) return null;

        const vline = &vlines[visual_row];
        const clamped_visual_col = @min(visual_col, vline.width);
        const logical_col = vline.source_col_offset + clamped_visual_col;
        const logical_row = @as(u32, @intCast(vline.source_line));

        const offset = iter_mod.coordsToOffset(&self.edit_buffer.tb.rope, logical_row, logical_col) orelse 0;

        return VisualCursor{
            .visual_row = visual_row,
            .visual_col = clamped_visual_col,
            .logical_row = logical_row,
            .logical_col = logical_col,
            .offset = offset,
        };
    }

    pub fn moveUpVisual(self: *EditorView) void {
        const cursor = self.edit_buffer.getPrimaryCursor();
        const vcursor = self.logicalToVisualCursor(cursor.row, cursor.col);

        if (vcursor.visual_row == 0) {
            return;
        }

        const target_visual_row = vcursor.visual_row - 1;

        // This persists across empty/narrow lines to restore column when possible
        if (self.desired_visual_col == null) {
            self.desired_visual_col = vcursor.visual_col;
        }
        const desired_visual_col = self.desired_visual_col.?;

        if (self.visualToLogicalCursor(target_visual_row, desired_visual_col)) |new_vcursor| {
            if (self.edit_buffer.cursors.items.len > 0) {
                self.edit_buffer.cursors.items[0] = .{
                    .row = new_vcursor.logical_row,
                    .col = new_vcursor.logical_col,
                    .desired_col = new_vcursor.logical_col,
                };
                self.ensureCursorVisible(new_vcursor.visual_row);

                // Restore desired_visual_col after the cursor change event resets it
                self.desired_visual_col = desired_visual_col;
            }
        }
    }

    pub fn moveDownVisual(self: *EditorView) void {
        const cursor = self.edit_buffer.getPrimaryCursor();
        const vcursor = self.logicalToVisualCursor(cursor.row, cursor.col);

        self.text_buffer_view.updateVirtualLines();
        const vlines = self.text_buffer_view.virtual_lines.items;

        if (vcursor.visual_row + 1 >= vlines.len) {
            return;
        }

        const target_visual_row = vcursor.visual_row + 1;

        // This persists across empty/narrow lines to restore column when possible
        if (self.desired_visual_col == null) {
            self.desired_visual_col = vcursor.visual_col;
        }
        const desired_visual_col = self.desired_visual_col.?;

        if (self.visualToLogicalCursor(target_visual_row, desired_visual_col)) |new_vcursor| {
            if (self.edit_buffer.cursors.items.len > 0) {
                self.edit_buffer.cursors.items[0] = .{
                    .row = new_vcursor.logical_row,
                    .col = new_vcursor.logical_col,
                    .desired_col = new_vcursor.logical_col,
                };
                self.ensureCursorVisible(new_vcursor.visual_row);

                // Restore desired_visual_col after the cursor change event resets it
                self.desired_visual_col = desired_visual_col;
            }
        }
    }

    pub fn deleteSelectedText(self: *EditorView) !void {
        const selection = self.text_buffer_view.getSelection() orelse return;

        const start_coords = iter_mod.offsetToCoords(&self.edit_buffer.tb.rope, selection.start) orelse return;
        const end_coords = iter_mod.offsetToCoords(&self.edit_buffer.tb.rope, selection.end) orelse return;

        const start_cursor = eb.Cursor{
            .row = start_coords.row,
            .col = start_coords.col,
            .desired_col = start_coords.col,
        };
        const end_cursor = eb.Cursor{
            .row = end_coords.row,
            .col = end_coords.col,
            .desired_col = end_coords.col,
        };

        try self.edit_buffer.deleteRange(start_cursor, end_cursor);
        self.text_buffer_view.resetLocalSelection();
        self.updateBeforeRender();
    }

    pub fn setCursorByOffset(self: *EditorView, offset: u32) !void {
        try self.edit_buffer.setCursorByOffset(offset);
        self.updateBeforeRender();
    }
};
