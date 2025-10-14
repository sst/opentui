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

/// Viewport defines a rectangular window into the virtual line space
pub const Viewport = struct {
    x: u32, // Column offset (for horizontal scroll)
    y: u32, // Virtual line offset (first visible line)
    width: u32, // Viewport width in columns
    height: u32, // Viewport height in rows (virtual lines)
};

/// Line info struct for viewport lines
pub const LineInfo = struct {
    starts: []const u32,
    widths: []const u32,
    max_width: u32,
};

/// EditorView wraps a TextBufferView and manages viewport state for efficient rendering
/// It also holds a reference to an EditBuffer for cursor/editing operations
pub const EditorView = struct {
    text_buffer_view: *UnifiedTextBufferView,
    edit_buffer: *EditBuffer, // Reference to the EditBuffer (not owned)
    viewport: ?Viewport,
    scroll_margin: f32, // Fraction of viewport height (0.0-0.5) to keep cursor away from edges
    last_wrap_override: ?u32, // Track last applied wrap width to avoid redundant reflows

    // Memory management
    global_allocator: Allocator,
    line_info_arena: *std.heap.ArenaAllocator,

    pub fn init(global_allocator: Allocator, edit_buffer: *EditBuffer, viewport_width: u32, viewport_height: u32) EditorViewError!*EditorView {
        const self = global_allocator.create(EditorView) catch return EditorViewError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        // Get TextBuffer from EditBuffer and create TextBufferView
        const text_buffer = edit_buffer.getTextBuffer();
        const text_buffer_view = UnifiedTextBufferView.init(global_allocator, text_buffer) catch return EditorViewError.OutOfMemory;
        errdefer text_buffer_view.deinit();

        const line_info_internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return EditorViewError.OutOfMemory;
        errdefer global_allocator.destroy(line_info_internal_arena);
        line_info_internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        self.* = .{
            .text_buffer_view = text_buffer_view,
            .edit_buffer = edit_buffer,
            .viewport = Viewport{
                .x = 0,
                .y = 0,
                .width = viewport_width,
                .height = viewport_height,
            },
            .scroll_margin = 0.15, // Default 15% margin
            .last_wrap_override = null,
            .global_allocator = global_allocator,
            .line_info_arena = line_info_internal_arena,
        };

        return self;
    }

    pub fn deinit(self: *EditorView) void {
        self.text_buffer_view.deinit(); // We own this
        self.line_info_arena.deinit();
        self.global_allocator.destroy(self.line_info_arena);
        self.global_allocator.destroy(self);
    }

    /// Set the viewport. If wrapping is enabled and viewport width differs from current wrap width,
    /// this will trigger a reflow by updating the TextBufferView's wrap width.
    pub fn setViewport(self: *EditorView, vp: ?Viewport) void {
        self.viewport = vp;

        // If wrapping is enabled and viewport has width, override wrap width
        if (vp) |viewport| {
            const current_wrap_width = self.text_buffer_view.wrap_width;
            if (current_wrap_width != null) {
                // Only update if different to avoid redundant reflows
                if (self.last_wrap_override == null or self.last_wrap_override.? != viewport.width) {
                    self.text_buffer_view.setWrapWidth(viewport.width);
                    self.last_wrap_override = viewport.width;
                }
            }
        }
    }

    pub fn getViewport(self: *const EditorView) ?Viewport {
        return self.viewport;
    }

    /// Set the scroll margin as a fraction of viewport height (0.0 to 0.5)
    /// The cursor will stay at least this many lines from the top/bottom edges when scrolling
    pub fn setScrollMargin(self: *EditorView, margin: f32) void {
        self.scroll_margin = @max(0.0, @min(0.5, margin));
    }

    /// Ensure the cursor is visible within the viewport, adjusting viewport.y if needed
    /// cursor_line: The virtual line index where the cursor is located
    pub fn ensureCursorVisible(self: *EditorView, cursor_line: u32) void {
        const vp = self.viewport orelse return;

        const viewport_height = vp.height;
        if (viewport_height == 0) return;

        const margin_lines = @max(1, @as(u32, @intFromFloat(@as(f32, @floatFromInt(viewport_height)) * self.scroll_margin)));

        // Get total virtual line count to determine max offset
        const all_vlines = self.text_buffer_view.getVirtualLines();
        const total_lines = @as(u32, @intCast(all_vlines.len));
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
            self.viewport = Viewport{
                .x = vp.x,
                .y = new_offset_y,
                .width = vp.width,
                .height = vp.height,
            };
        }
    }

    /// Get virtual lines for the current viewport
    /// Returns a slice of virtual lines that are visible in the viewport
    pub fn getVirtualLines(self: *EditorView) []const VirtualLine {
        const all_vlines = self.text_buffer_view.getVirtualLines();

        const vp = self.viewport orelse return all_vlines;

        // Calculate viewport slice range
        const start_idx = @min(vp.y, @as(u32, @intCast(all_vlines.len)));
        const end_idx = @min(start_idx + vp.height, @as(u32, @intCast(all_vlines.len)));

        // Return slice directly - don't cache it
        return all_vlines[start_idx..end_idx];
    }

    /// Get cached line info for the viewport
    /// Returns character offsets, widths, and max width for viewport lines only
    pub fn getCachedLineInfo(self: *EditorView) LineInfo {
        const vp = self.viewport orelse {
            // No viewport - delegate to TextBufferView
            const tbv_info = self.text_buffer_view.getCachedLineInfo();
            return LineInfo{
                .starts = tbv_info.starts,
                .widths = tbv_info.widths,
                .max_width = tbv_info.max_width,
            };
        };

        // Reset arena for fresh allocation
        _ = self.line_info_arena.reset(.free_all);
        const arena_allocator = self.line_info_arena.allocator();

        // Get full line info from TextBufferView
        const full_info = self.text_buffer_view.getCachedLineInfo();

        // Calculate viewport slice range
        const start_idx = @min(vp.y, @as(u32, @intCast(full_info.starts.len)));
        const end_idx = @min(start_idx + vp.height, @as(u32, @intCast(full_info.starts.len)));

        if (start_idx >= end_idx) {
            return LineInfo{
                .starts = &[_]u32{},
                .widths = &[_]u32{},
                .max_width = 0,
            };
        }

        // Slice the arrays for viewport
        const viewport_starts = full_info.starts[start_idx..end_idx];
        const viewport_widths = full_info.widths[start_idx..end_idx];

        // Calculate max width for viewport lines
        var max_width: u32 = 0;
        for (viewport_widths) |w| {
            max_width = @max(max_width, w);
        }

        // Copy to arena for consistent memory management
        const starts_copy = arena_allocator.dupe(u32, viewport_starts) catch &[_]u32{};
        const widths_copy = arena_allocator.dupe(u32, viewport_widths) catch &[_]u32{};

        return LineInfo{
            .starts = starts_copy,
            .widths = widths_copy,
            .max_width = max_width,
        };
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
        if (self.viewport) |vp| {
            self.setViewport(Viewport{
                .x = vp.x,
                .y = vp.y,
                .width = width,
                .height = height,
            });
        } else {
            self.setViewport(Viewport{
                .x = 0,
                .y = 0,
                .width = width,
                .height = height,
            });
        }
    }

    /// Enable or disable text wrapping
    pub fn enableWrapping(self: *EditorView, enabled: bool) void {
        if (enabled) {
            // Enable wrapping with current viewport width (or 80 if no viewport)
            const wrap_width = if (self.viewport) |vp| vp.width else 80;
            self.text_buffer_view.setWrapWidth(wrap_width);
        } else {
            // Disable wrapping
            self.text_buffer_view.setWrapWidth(null);
        }
    }

    /// Set wrap mode (char or word)
    pub fn setWrapMode(self: *EditorView, mode: tb.WrapMode) void {
        self.text_buffer_view.setWrapMode(mode);
    }

    /// Check if wrapping is currently enabled
    pub fn isWrappingEnabled(self: *const EditorView) bool {
        return self.text_buffer_view.wrap_width != null;
    }
};
