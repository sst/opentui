const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const tbv = @import("text-buffer-view.zig");
const eb = @import("edit-buffer.zig");
const EditBuffer = eb.EditBuffer;

// Use the unified types to match EditBuffer
const UnifiedTextBuffer = tb.UnifiedTextBuffer;
const UnifiedTextBufferView = tbv.UnifiedTextBufferView;
const VirtualLine = tbv.VirtualLine;

pub const EditorViewError = error{
    OutOfMemory,
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

    /// Get virtual lines for the current viewport
    /// Returns a slice of virtual lines that are visible in the viewport
    /// The TextBufferView handles viewport slicing internally
    pub fn getVirtualLines(self: *EditorView) []const VirtualLine {
        return self.text_buffer_view.getVirtualLines();
    }

    /// Get cached line info for the viewport
    /// Returns character offsets, widths, and max width for viewport lines only
    /// The TextBufferView handles viewport slicing internally
    pub fn getCachedLineInfo(self: *EditorView) tbv.LineInfo {
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

    /// Set text and ensure cursor is visible (resets to 0,0)
    pub fn setText(self: *EditorView, text: []const u8) !void {
        try self.edit_buffer.setText(text);
        self.ensureCursorVisible(0);
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
};
