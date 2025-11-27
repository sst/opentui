const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const seg_mod = @import("text-buffer-segment.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const gp = @import("grapheme.zig");
const utf8 = @import("utf8.zig");

const logger = @import("logger.zig");

const UnifiedTextBuffer = tb.UnifiedTextBuffer;
const RGBA = tb.RGBA;
const TextSelection = tb.TextSelection;
pub const WrapMode = tb.WrapMode;
const TextChunk = seg_mod.TextChunk;
const StyleSpan = tb.StyleSpan;
const GraphemeInfo = seg_mod.GraphemeInfo;

pub const TextBufferViewError = error{
    OutOfMemory,
};

/// Viewport defines a rectangular window into the virtual line space
pub const Viewport = struct {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
};

pub const LineInfo = struct {
    starts: []const u32,
    widths: []const u32,
    sources: []const u32,
    wraps: []const u32,
    max_width: u32,
};

pub const WrapInfo = struct {
    line_first_vline: []const u32,
    line_vline_counts: []const u32,
};

/// Output structure for virtual line calculation
pub const VirtualLineOutput = struct {
    virtual_lines: *std.ArrayListUnmanaged(VirtualLine),
    cached_line_starts: *std.ArrayListUnmanaged(u32),
    cached_line_widths: *std.ArrayListUnmanaged(u32),
    cached_line_sources: *std.ArrayListUnmanaged(u32),
    cached_line_wrap_indices: *std.ArrayListUnmanaged(u32),
    cached_line_first_vline: *std.ArrayListUnmanaged(u32),
    cached_line_vline_counts: *std.ArrayListUnmanaged(u32),
};

/// Result from measuring dimensions without modifying cache
pub const MeasureResult = struct {
    line_count: u32,
    max_width: u32,
};

pub const VirtualLineSpanInfo = struct {
    spans: []const StyleSpan,
    source_line: usize,
    col_offset: u32,
};

pub const VirtualChunk = struct {
    grapheme_start: u32,
    width: u32,
    // Direct reference to source chunk for rendering
    chunk: *const TextChunk,
};

pub const VirtualLine = struct {
    chunks: std.ArrayListUnmanaged(VirtualChunk),
    width: u32,
    char_offset: u32,
    source_line: usize,
    source_col_offset: u32,

    pub fn init() VirtualLine {
        return .{
            .chunks = .{},
            .width = 0,
            .char_offset = 0,
            .source_line = 0,
            .source_col_offset = 0,
        };
    }

    pub fn deinit(self: *VirtualLine, allocator: Allocator) void {
        self.chunks.deinit(allocator);
    }
};

pub const LocalSelection = struct {
    anchorX: i32,
    anchorY: i32,
    focusX: i32,
    focusY: i32,
    isActive: bool,
};

pub const TextBufferView = UnifiedTextBufferView;

pub const UnifiedTextBufferView = struct {
    const Self = @This();

    text_buffer: *UnifiedTextBuffer,
    original_text_buffer: *UnifiedTextBuffer,
    view_id: u32,
    selection: ?TextSelection,
    local_selection: ?LocalSelection,
    viewport: ?Viewport,
    wrap_width: ?u32,
    wrap_mode: WrapMode,
    virtual_lines: std.ArrayListUnmanaged(VirtualLine),
    virtual_lines_dirty: bool,
    cached_line_starts: std.ArrayListUnmanaged(u32),
    cached_line_widths: std.ArrayListUnmanaged(u32),
    cached_line_sources: std.ArrayListUnmanaged(u32),
    cached_line_wrap_indices: std.ArrayListUnmanaged(u32),
    cached_line_first_vline: std.ArrayListUnmanaged(u32),
    cached_line_vline_counts: std.ArrayListUnmanaged(u32),
    global_allocator: Allocator,
    virtual_lines_arena: *std.heap.ArenaAllocator,
    tab_indicator: ?u32,
    tab_indicator_color: ?RGBA,

    pub fn init(global_allocator: Allocator, text_buffer: *UnifiedTextBuffer) TextBufferViewError!*Self {
        const self = global_allocator.create(Self) catch return TextBufferViewError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const virtual_lines_internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferViewError.OutOfMemory;
        errdefer global_allocator.destroy(virtual_lines_internal_arena);
        virtual_lines_internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const view_id = text_buffer.registerView() catch return TextBufferViewError.OutOfMemory;

        self.* = .{
            .text_buffer = text_buffer,
            .original_text_buffer = text_buffer,
            .view_id = view_id,
            .selection = null,
            .local_selection = null,
            .viewport = null,
            .wrap_width = null,
            .wrap_mode = .none,
            .virtual_lines = .{},
            .virtual_lines_dirty = true,
            .cached_line_starts = .{},
            .cached_line_widths = .{},
            .cached_line_sources = .{},
            .cached_line_wrap_indices = .{},
            .cached_line_first_vline = .{},
            .cached_line_vline_counts = .{},
            .global_allocator = global_allocator,
            .virtual_lines_arena = virtual_lines_internal_arena,
            .tab_indicator = null,
            .tab_indicator_color = null,
        };

        return self;
    }

    pub fn deinit(self: *Self) void {
        self.original_text_buffer.unregisterView(self.view_id);
        self.virtual_lines_arena.deinit();
        self.global_allocator.destroy(self.virtual_lines_arena);
        self.global_allocator.destroy(self);
    }

    pub fn setViewport(self: *Self, vp: ?Viewport) void {
        self.viewport = vp;

        // If viewport has width, set wrap width (wrapping behavior depends on wrap_mode)
        if (vp) |viewport| {
            if (self.wrap_width != viewport.width) {
                self.wrap_width = viewport.width;
                self.virtual_lines_dirty = true;
            }
        }
    }

    pub fn getViewport(self: *const Self) ?Viewport {
        return self.viewport;
    }

    // This is a convenience method that preserves existing offset
    pub fn setViewportSize(self: *Self, width: u32, height: u32) void {
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

    pub fn setWrapWidth(self: *Self, width: ?u32) void {
        if (self.wrap_width != width) {
            self.wrap_width = width;
            self.virtual_lines_dirty = true;
        }
    }

    pub fn setWrapMode(self: *Self, mode: WrapMode) void {
        if (self.wrap_mode != mode) {
            self.wrap_mode = mode;
            self.virtual_lines_dirty = true;
        }
    }

    fn calculateChunkFitWord(self: *const Self, chunk: *const TextChunk, char_offset_in_chunk: u32, max_width: u32) tb.ChunkFitResult {
        if (max_width == 0) return .{ .char_count = 0, .width = 0 };

        const total_width = @as(u32, chunk.width) - char_offset_in_chunk;
        if (total_width == 0) return .{ .char_count = 0, .width = 0 };
        if (total_width <= max_width) return .{ .char_count = total_width, .width = total_width };

        const wrap_offsets = chunk.getWrapOffsets(&self.text_buffer.mem_registry, self.text_buffer.allocator, self.text_buffer.width_method) catch {
            const fit_width = @min(max_width, total_width);
            return .{ .char_count = fit_width, .width = fit_width };
        };

        var last_boundary: ?u32 = null;
        var first_boundary: ?u32 = null;

        for (wrap_offsets) |wrap_break| {
            const offset = @as(u32, wrap_break.char_offset);
            if (offset < char_offset_in_chunk) continue;

            const local_offset = offset - char_offset_in_chunk;
            if (local_offset >= total_width) break;

            const width_to_boundary = local_offset + 1;
            if (first_boundary == null) first_boundary = width_to_boundary;

            if (width_to_boundary <= max_width) {
                last_boundary = width_to_boundary;
            } else break;
        }

        if (last_boundary) |width| return .{ .char_count = width, .width = width };

        const line_width = self.wrap_width orelse max_width;
        const needs_force_break = (first_boundary orelse total_width) > line_width;

        if (needs_force_break) {
            const fit_width = @min(max_width, total_width);
            return .{ .char_count = fit_width, .width = fit_width };
        }

        return .{ .char_count = 0, .width = 0 };
    }

    pub fn updateVirtualLines(self: *Self) void {
        const buffer_dirty = self.text_buffer.isViewDirty(self.view_id);
        if (!self.virtual_lines_dirty and !buffer_dirty) return;

        _ = self.virtual_lines_arena.reset(.free_all);
        self.virtual_lines = .{};
        self.cached_line_starts = .{};
        self.cached_line_widths = .{};
        self.cached_line_sources = .{};
        self.cached_line_wrap_indices = .{};
        self.cached_line_first_vline = .{};
        self.cached_line_vline_counts = .{};
        const virtual_allocator = self.virtual_lines_arena.allocator();

        // Create output structure for the generic function
        const output = VirtualLineOutput{
            .virtual_lines = &self.virtual_lines,
            .cached_line_starts = &self.cached_line_starts,
            .cached_line_widths = &self.cached_line_widths,
            .cached_line_sources = &self.cached_line_sources,
            .cached_line_wrap_indices = &self.cached_line_wrap_indices,
            .cached_line_first_vline = &self.cached_line_first_vline,
            .cached_line_vline_counts = &self.cached_line_vline_counts,
        };

        // Call the generic calculation function
        calculateVirtualLinesGeneric(
            self.text_buffer,
            self.wrap_mode,
            self.wrap_width,
            virtual_allocator,
            output,
        );

        self.virtual_lines_dirty = false;
        self.text_buffer.clearViewDirty(self.view_id);
    }

    pub fn getVirtualLineCount(self: *Self) u32 {
        self.updateVirtualLines();
        return @intCast(self.virtual_lines.items.len);
    }

    pub fn getVirtualLines(self: *Self) []const VirtualLine {
        self.updateVirtualLines();

        const all_vlines = self.virtual_lines.items;

        // If viewport is set, return only the visible lines
        if (self.viewport) |vp| {
            const start_idx = @min(vp.y, @as(u32, @intCast(all_vlines.len)));
            const end_idx = @min(start_idx + vp.height, @as(u32, @intCast(all_vlines.len)));
            return all_vlines[start_idx..end_idx];
        }

        return all_vlines;
    }

    pub fn getCachedLineInfo(self: *Self) LineInfo {
        self.updateVirtualLines();

        // If viewport is set, return only the visible lines' info
        if (self.viewport) |vp| {
            const start_idx = @min(vp.y, @as(u32, @intCast(self.cached_line_starts.items.len)));
            const end_idx = @min(start_idx + vp.height, @as(u32, @intCast(self.cached_line_starts.items.len)));

            const viewport_starts = self.cached_line_starts.items[start_idx..end_idx];
            const viewport_widths = self.cached_line_widths.items[start_idx..end_idx];
            const viewport_sources = self.cached_line_sources.items[start_idx..end_idx];
            const viewport_wraps = self.cached_line_wrap_indices.items[start_idx..end_idx];

            var max_width: u32 = 0;
            for (viewport_widths) |w| {
                max_width = @max(max_width, w);
            }

            return LineInfo{
                .starts = viewport_starts,
                .widths = viewport_widths,
                .sources = viewport_sources,
                .wraps = viewport_wraps,
                .max_width = max_width,
            };
        }

        return LineInfo{
            .starts = self.cached_line_starts.items,
            .widths = self.cached_line_widths.items,
            .sources = self.cached_line_sources.items,
            .wraps = self.cached_line_wrap_indices.items,
            .max_width = iter_mod.getMaxLineWidth(&self.text_buffer.rope),
        };
    }

    pub fn getLogicalLineInfo(self: *Self) LineInfo {
        self.updateVirtualLines();

        return LineInfo{
            .starts = self.cached_line_starts.items,
            .widths = self.cached_line_widths.items,
            .sources = self.cached_line_sources.items,
            .wraps = self.cached_line_wrap_indices.items,
            .max_width = iter_mod.getMaxLineWidth(&self.text_buffer.rope),
        };
    }

    pub fn getWrapInfo(self: *Self) WrapInfo {
        self.updateVirtualLines();
        return WrapInfo{
            .line_first_vline = self.cached_line_first_vline.items,
            .line_vline_counts = self.cached_line_vline_counts.items,
        };
    }

    pub fn findVisualLineIndex(self: *Self, logical_row: u32, logical_col: u32) u32 {
        self.updateVirtualLines();

        const vlines = self.virtual_lines.items;
        if (vlines.len == 0) return 0;

        const wrap_info = self.getWrapInfo();

        // Clamp logical_row to valid range
        const clamped_row = if (logical_row >= wrap_info.line_first_vline.len)
            if (wrap_info.line_first_vline.len > 0) wrap_info.line_first_vline.len - 1 else 0
        else
            logical_row;

        if (clamped_row >= wrap_info.line_first_vline.len) return 0;

        const first_vline_idx = wrap_info.line_first_vline[clamped_row];
        const vline_count = wrap_info.line_vline_counts[clamped_row];

        if (vline_count == 0) return first_vline_idx;

        var i: u32 = 0;
        while (i < vline_count) : (i += 1) {
            const vline_idx = first_vline_idx + i;
            if (vline_idx >= vlines.len) break;

            const vline = &vlines[vline_idx];
            const vline_start_col = vline.source_col_offset;
            const vline_end_col = vline_start_col + vline.width;

            const is_last_vline = (i == vline_count - 1);

            // For the end check: use < for all lines except the last line where we use <=
            // This ensures that a position exactly at vline_end_col goes to the NEXT line
            // unless this is the last line (where there is no next line)
            const end_check = if (is_last_vline) logical_col <= vline_end_col else logical_col < vline_end_col;

            if (logical_col >= vline_start_col and end_check) {
                return vline_idx;
            }
        }

        // If not found, return last virtual line for this logical line
        const last_vline_idx = first_vline_idx + vline_count - 1;
        if (last_vline_idx < vlines.len) {
            return last_vline_idx;
        }

        return first_vline_idx;
    }

    pub fn getPlainTextIntoBuffer(self: *const Self, out_buffer: []u8) usize {
        return self.text_buffer.getPlainTextIntoBuffer(out_buffer);
    }

    pub fn getArenaAllocatedBytes(self: *const Self) usize {
        return self.virtual_lines_arena.queryCapacity();
    }

    pub fn setSelection(self: *Self, start: u32, end: u32, bgColor: ?RGBA, fgColor: ?RGBA) void {
        self.selection = TextSelection{
            .start = start,
            .end = end,
            .bgColor = bgColor,
            .fgColor = fgColor,
        };
    }

    pub fn resetSelection(self: *Self) void {
        self.selection = null;
    }

    pub fn getSelection(self: *const Self) ?TextSelection {
        return self.selection;
    }

    pub fn getTextBuffer(self: *const Self) *UnifiedTextBuffer {
        return self.text_buffer;
    }

    pub fn switchToBuffer(self: *Self, buffer: *UnifiedTextBuffer) void {
        self.text_buffer = buffer;
        self.virtual_lines_dirty = true;
    }

    pub fn switchToOriginalBuffer(self: *Self) void {
        if (self.text_buffer != self.original_text_buffer) {
            self.text_buffer = self.original_text_buffer;
            self.virtual_lines_dirty = true;
        }
    }

    pub fn setLocalSelection(self: *Self, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?RGBA, fgColor: ?RGBA) bool {
        const new_local_sel = LocalSelection{
            .anchorX = anchorX,
            .anchorY = anchorY,
            .focusX = focusX,
            .focusY = focusY,
            .isActive = true,
        };

        const coords_changed = if (self.local_selection) |old_sel| blk: {
            break :blk old_sel.anchorX != new_local_sel.anchorX or
                old_sel.anchorY != new_local_sel.anchorY or
                old_sel.focusX != new_local_sel.focusX or
                old_sel.focusY != new_local_sel.focusY;
        } else true;

        self.local_selection = new_local_sel;

        const char_selection = self.calculateMultiLineSelection();
        var selection_changed = coords_changed;

        if (char_selection) |sel| {
            const new_selection = TextSelection{
                .start = sel.start,
                .end = sel.end,
                .bgColor = bgColor,
                .fgColor = fgColor,
            };

            if (self.selection) |old_sel| {
                if (old_sel.start != new_selection.start or old_sel.end != new_selection.end) {
                    selection_changed = true;
                }
            } else {
                selection_changed = true;
            }

            self.selection = new_selection;
        } else {
            if (self.selection != null) {
                selection_changed = true;
            }
            self.selection = null;
        }

        return selection_changed;
    }

    pub fn resetLocalSelection(self: *Self) void {
        self.local_selection = null;
        self.selection = null;
    }

    // Local coordinates are viewport-relative (if viewport is set)
    fn calculateMultiLineSelection(self: *Self) ?struct { start: u32, end: u32 } {
        const local_sel = self.local_selection orelse return null;
        if (!local_sel.isActive) return null;

        self.updateVirtualLines();

        // Apply viewport offsets to convert viewport-relative to absolute coordinates
        const y_offset: i32 = if (self.viewport) |vp| @intCast(vp.y) else 0;
        const x_offset: i32 = if (self.viewport) |vp|
            (if (self.wrap_mode == .none) @intCast(vp.x) else 0)
        else
            0;

        var selectionStart: ?u32 = null;
        var selectionEnd: ?u32 = null;

        // Convert viewport-relative Y coordinates to absolute virtual line indices
        const startY = @min(local_sel.anchorY + y_offset, local_sel.focusY + y_offset);
        const endY = @max(local_sel.anchorY + y_offset, local_sel.focusY + y_offset);

        var selStartX: i32 = undefined;
        var selEndX: i32 = undefined;

        if (local_sel.anchorY < local_sel.focusY or
            (local_sel.anchorY == local_sel.focusY and local_sel.anchorX <= local_sel.focusX))
        {
            selStartX = local_sel.anchorX + x_offset;
            selEndX = local_sel.focusX + x_offset;
        } else {
            selStartX = local_sel.focusX + x_offset;
            selEndX = local_sel.anchorX + x_offset;
        }

        for (self.virtual_lines.items, 0..) |vline, i| {
            const lineY = @as(i32, @intCast(i));

            if (lineY < startY or lineY > endY) continue;

            const lineStart = vline.char_offset;
            const lineWidth = vline.width;
            // lineEnd is the end of the line content, excluding the newline
            const lineEnd = lineStart + lineWidth;

            if (lineY > startY and lineY < endY) {
                if (selectionStart == null) selectionStart = lineStart;
                selectionEnd = lineEnd;
            } else if (lineY == startY and lineY == endY) {
                const localStartX = @max(0, @min(selStartX, @as(i32, @intCast(lineWidth))));
                const localEndX = @max(0, @min(selEndX, @as(i32, @intCast(lineWidth))));
                if (localStartX != localEndX) {
                    selectionStart = lineStart + @as(u32, @intCast(localStartX));
                    selectionEnd = lineStart + @as(u32, @intCast(localEndX));
                }
            } else if (lineY == startY) {
                const localStartX = @max(0, @min(selStartX, @as(i32, @intCast(lineWidth))));
                if (localStartX < lineWidth) {
                    selectionStart = lineStart + @as(u32, @intCast(localStartX));
                    selectionEnd = lineEnd;
                }
            } else if (lineY == endY) {
                const localEndX = @max(0, @min(selEndX, @as(i32, @intCast(lineWidth))));
                if (selectionStart == null) selectionStart = lineStart;
                selectionEnd = lineStart + @as(u32, @intCast(localEndX));
            }
        }

        return if (selectionStart != null and selectionEnd != null and selectionStart.? < selectionEnd.?)
            .{ .start = selectionStart.?, .end = selectionEnd.? }
        else
            null;
    }

    /// Pack selection info into u64 for efficient passing
    pub fn packSelectionInfo(self: *const Self) u64 {
        if (self.selection) |sel| {
            return (@as(u64, sel.start) << 32) | @as(u64, sel.end);
        } else {
            return 0xFFFF_FFFF_FFFF_FFFF;
        }
    }

    /// Get selected text into buffer - using efficient single-pass API
    pub fn getSelectedTextIntoBuffer(self: *Self, out_buffer: []u8) usize {
        const selection = self.selection orelse return 0;
        return iter_mod.extractTextBetweenOffsets(
            &self.text_buffer.rope,
            &self.text_buffer.mem_registry,
            self.text_buffer.tab_width,
            selection.start,
            selection.end,
            out_buffer,
            self.text_buffer.width_method,
        );
    }

    pub fn getVirtualLineSpans(self: *const Self, vline_idx: usize) VirtualLineSpanInfo {
        if (vline_idx >= self.virtual_lines.items.len) {
            return VirtualLineSpanInfo{ .spans = &[_]StyleSpan{}, .source_line = 0, .col_offset = 0 };
        }

        const vline = &self.virtual_lines.items[vline_idx];
        const spans = self.text_buffer.getLineSpans(vline.source_line);

        return VirtualLineSpanInfo{
            .spans = spans,
            .source_line = vline.source_line,
            .col_offset = vline.source_col_offset,
        };
    }

    pub fn setTabIndicator(self: *Self, indicator: ?u32) void {
        self.tab_indicator = indicator;
    }

    pub fn getTabIndicator(self: *const Self) ?u32 {
        return self.tab_indicator;
    }

    pub fn setTabIndicatorColor(self: *Self, color: ?RGBA) void {
        self.tab_indicator_color = color;
    }

    pub fn getTabIndicatorColor(self: *const Self) ?RGBA {
        return self.tab_indicator_color;
    }

    /// Measure dimensions for given width/height WITHOUT modifying virtual lines cache
    /// This is useful for Yoga measure functions that need to know dimensions without committing changes
    /// Special case: width=0 means "measure intrinsic/max-content width" (no wrapping)
    pub fn measureForDimensions(self: *const Self, width: u32, height: u32) TextBufferViewError!MeasureResult {
        _ = height; // Height is for future use, currently only width affects layout

        // Create temporary arena for measurement
        var measure_arena = std.heap.ArenaAllocator.init(self.global_allocator);
        defer measure_arena.deinit();
        const measure_allocator = measure_arena.allocator();

        // Create temporary output structures
        var temp_virtual_lines = std.ArrayListUnmanaged(VirtualLine){};
        var temp_line_starts = std.ArrayListUnmanaged(u32){};
        var temp_line_widths = std.ArrayListUnmanaged(u32){};
        var temp_line_sources = std.ArrayListUnmanaged(u32){};
        var temp_line_wrap_indices = std.ArrayListUnmanaged(u32){};
        var temp_line_first_vline = std.ArrayListUnmanaged(u32){};
        var temp_line_vline_counts = std.ArrayListUnmanaged(u32){};

        const output = VirtualLineOutput{
            .virtual_lines = &temp_virtual_lines,
            .cached_line_starts = &temp_line_starts,
            .cached_line_widths = &temp_line_widths,
            .cached_line_sources = &temp_line_sources,
            .cached_line_wrap_indices = &temp_line_wrap_indices,
            .cached_line_first_vline = &temp_line_first_vline,
            .cached_line_vline_counts = &temp_line_vline_counts,
        };

        // Use width for wrap calculation
        // Special case: width=0 means get intrinsic width (no wrapping), so pass null
        const wrap_width_for_measure = if (self.wrap_mode != .none and width > 0) width else null;

        // Call generic calculation with temporary structures
        calculateVirtualLinesGeneric(
            self.text_buffer,
            self.wrap_mode,
            wrap_width_for_measure,
            measure_allocator,
            output,
        );

        // Calculate max width from temp structures
        var max_width: u32 = 0;
        for (temp_line_widths.items) |w| {
            max_width = @max(max_width, w);
        }

        return MeasureResult{
            .line_count = @intCast(temp_virtual_lines.items.len),
            .max_width = max_width,
        };
    }

    /// Generic virtual line calculation that writes to provided output structures
    fn calculateVirtualLinesGeneric(
        text_buffer: *UnifiedTextBuffer,
        wrap_mode: WrapMode,
        wrap_width: ?u32,
        allocator: Allocator,
        output: VirtualLineOutput,
    ) void {
        if (wrap_mode == .none or wrap_width == null) {
            // No wrapping - create 1:1 mapping to real lines
            const Context = struct {
                text_buffer: *UnifiedTextBuffer,
                allocator: Allocator,
                output: VirtualLineOutput,
                current_vline: ?VirtualLine = null,

                fn segment_callback(ctx_ptr: *anyopaque, line_idx: u32, chunk: *const TextChunk, _: u32) void {
                    _ = line_idx;
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    if (ctx.current_vline) |*vline| {
                        vline.chunks.append(ctx.allocator, VirtualChunk{
                            .grapheme_start = 0,
                            .width = chunk.width,
                            .chunk = chunk,
                        }) catch {};
                    }
                }

                fn line_end_callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    const first_vline_idx: u32 = @intCast(ctx.output.virtual_lines.items.len);
                    ctx.output.cached_line_first_vline.append(ctx.allocator, first_vline_idx) catch {};
                    ctx.output.cached_line_vline_counts.append(ctx.allocator, 1) catch {};

                    var vline = if (ctx.current_vline) |v| v else VirtualLine.init();
                    vline.width = line_info.width;
                    vline.char_offset = line_info.char_offset;
                    vline.source_line = line_info.line_idx;
                    vline.source_col_offset = 0;

                    ctx.output.virtual_lines.append(ctx.allocator, vline) catch {};
                    ctx.output.cached_line_starts.append(ctx.allocator, vline.char_offset) catch {};
                    ctx.output.cached_line_widths.append(ctx.allocator, vline.width) catch {};
                    ctx.output.cached_line_sources.append(ctx.allocator, @intCast(line_info.line_idx)) catch {};
                    ctx.output.cached_line_wrap_indices.append(ctx.allocator, 0) catch {};

                    ctx.current_vline = VirtualLine.init();
                }
            };

            var ctx = Context{
                .text_buffer = text_buffer,
                .allocator = allocator,
                .output = output,
                .current_vline = VirtualLine.init(),
            };

            iter_mod.walkLinesAndSegments(&text_buffer.rope, &ctx, Context.segment_callback, Context.line_end_callback);
        } else {
            const wrap_w = wrap_width.?;

            const WrapContext = struct {
                text_buffer: *UnifiedTextBuffer,
                allocator: Allocator,
                output: VirtualLineOutput,
                wrap_mode: WrapMode,
                wrap_w: u32,
                global_char_offset: u32 = 0,
                line_idx: u32 = 0,
                line_col_offset: u32 = 0,
                line_position: u32 = 0,
                current_vline: VirtualLine = VirtualLine.init(),
                chunk_idx_in_line: u32 = 0,
                current_line_first_vline_idx: u32 = 0,
                current_line_vline_count: u32 = 0,

                last_wrap_chunk_count: u32 = 0,
                last_wrap_line_position: u32 = 0,
                last_wrap_global_offset: u32 = 0,

                fn commitVirtualLine(wctx: *@This()) void {
                    wctx.current_vline.width = wctx.line_position;
                    wctx.current_vline.source_line = wctx.line_idx;
                    wctx.current_vline.source_col_offset = wctx.line_col_offset;
                    wctx.output.virtual_lines.append(wctx.allocator, wctx.current_vline) catch {};
                    wctx.output.cached_line_starts.append(wctx.allocator, wctx.current_vline.char_offset) catch {};
                    wctx.output.cached_line_widths.append(wctx.allocator, wctx.current_vline.width) catch {};
                    wctx.output.cached_line_sources.append(wctx.allocator, wctx.line_idx) catch {};
                    wctx.output.cached_line_wrap_indices.append(wctx.allocator, wctx.current_line_vline_count) catch {};

                    wctx.current_line_vline_count += 1;

                    wctx.line_col_offset += wctx.line_position;
                    wctx.current_vline = VirtualLine.init();
                    wctx.current_vline.char_offset = wctx.global_char_offset;
                    wctx.line_position = 0;

                    wctx.last_wrap_chunk_count = 0;
                    wctx.last_wrap_line_position = 0;
                    wctx.last_wrap_global_offset = 0;
                }

                fn addVirtualChunk(wctx: *@This(), chunk: *const TextChunk, _: u32, start: u32, width_param: u32) void {
                    wctx.current_vline.chunks.append(wctx.allocator, VirtualChunk{
                        .grapheme_start = start,
                        .width = width_param,
                        .chunk = chunk,
                    }) catch {};
                    wctx.global_char_offset += width_param;
                    wctx.line_position += width_param;
                }

                fn segment_callback(ctx_ptr: *anyopaque, _: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void {
                    const wctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    wctx.chunk_idx_in_line = chunk_idx_in_line;

                    if (wctx.wrap_mode == .word) {
                        const chunk_bytes = chunk.getBytes(&wctx.text_buffer.mem_registry);
                        const wrap_offsets = chunk.getWrapOffsets(&wctx.text_buffer.mem_registry, wctx.text_buffer.allocator, wctx.text_buffer.width_method) catch &[_]utf8.WrapBreak{};

                        var char_offset: u32 = 0;
                        var wrap_idx: usize = 0;
                        while (char_offset < chunk.width) {
                            const remaining_in_chunk = chunk.width - char_offset;
                            const remaining_on_line = if (wctx.line_position < wctx.wrap_w) wctx.wrap_w - wctx.line_position else 0;

                            var last_wrap_that_fits: ?u32 = null;
                            var saved_wrap_idx = wrap_idx;
                            while (wrap_idx < wrap_offsets.len) : (wrap_idx += 1) {
                                const wrap_break = wrap_offsets[wrap_idx];
                                const offset = @as(u32, wrap_break.char_offset);
                                if (offset < char_offset) continue;
                                const width_to_boundary = offset - char_offset + 1;
                                if (width_to_boundary > remaining_on_line or width_to_boundary > remaining_in_chunk) break;
                                last_wrap_that_fits = width_to_boundary;
                                saved_wrap_idx = wrap_idx + 1;
                            }
                            wrap_idx = saved_wrap_idx;

                            var to_add: u32 = 0;
                            var has_wrap_after: bool = false;

                            if (remaining_in_chunk <= remaining_on_line) {
                                if (last_wrap_that_fits) |boundary_w| {
                                    const would_fill_line = wctx.line_position + remaining_in_chunk >= wctx.wrap_w;
                                    if (would_fill_line and boundary_w < remaining_in_chunk) {
                                        to_add = boundary_w;
                                        has_wrap_after = true;
                                    } else {
                                        to_add = remaining_in_chunk;
                                        has_wrap_after = true;
                                    }
                                } else {
                                    to_add = remaining_in_chunk;
                                }
                            } else if (last_wrap_that_fits) |boundary_w| {
                                to_add = boundary_w;
                                has_wrap_after = true;
                            } else if (wctx.line_position == 0) {
                                const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                                var byte_offset: u32 = 0;
                                if (char_offset > 0) {
                                    const pos_result = utf8.findPosByWidth(chunk_bytes, char_offset, wctx.text_buffer.tab_width, is_ascii_only, false, wctx.text_buffer.width_method);
                                    byte_offset = pos_result.byte_offset;
                                }
                                const remaining_bytes = chunk_bytes[byte_offset..];
                                const wrap_result = utf8.findWrapPosByWidth(remaining_bytes, remaining_on_line, wctx.text_buffer.tab_width, is_ascii_only, wctx.text_buffer.width_method);
                                to_add = wrap_result.columns_used;
                                if (to_add == 0) to_add = 1;
                            } else if (wctx.last_wrap_chunk_count > 0) {
                                var accumulated_width: u32 = 0;
                                for (wctx.current_vline.chunks.items[0..wctx.last_wrap_chunk_count]) |vchunk| {
                                    accumulated_width += vchunk.width;
                                }

                                const chunks_after_wrap = wctx.current_vline.chunks.items[wctx.last_wrap_chunk_count..];
                                var chunks_to_move_count = chunks_after_wrap.len;
                                var split_chunk: ?VirtualChunk = null;

                                if (accumulated_width > wctx.last_wrap_line_position) {
                                    const last_chunk_idx = wctx.last_wrap_chunk_count - 1;
                                    const last_chunk = wctx.current_vline.chunks.items[last_chunk_idx];
                                    const overhang = accumulated_width - wctx.last_wrap_line_position;

                                    split_chunk = VirtualChunk{
                                        .grapheme_start = last_chunk.grapheme_start + last_chunk.width - overhang,
                                        .width = overhang,
                                        .chunk = last_chunk.chunk,
                                    };

                                    wctx.current_vline.chunks.items[last_chunk_idx].width -= overhang;

                                    chunks_to_move_count += 1;
                                }

                                const saved_chunks_result = wctx.allocator.alloc(VirtualChunk, chunks_to_move_count);
                                if (saved_chunks_result) |saved_chunks| {
                                    var saved_idx: usize = 0;

                                    if (split_chunk) |sc| {
                                        saved_chunks[saved_idx] = sc;
                                        saved_idx += 1;
                                    }

                                    @memcpy(saved_chunks[saved_idx..], chunks_after_wrap);

                                    wctx.line_position = wctx.last_wrap_line_position;
                                    wctx.global_char_offset = wctx.last_wrap_global_offset;
                                    wctx.current_vline.chunks.items.len = wctx.last_wrap_chunk_count;

                                    commitVirtualLine(wctx);

                                    for (saved_chunks) |vchunk| {
                                        wctx.current_vline.chunks.append(wctx.allocator, vchunk) catch {};
                                        wctx.global_char_offset += vchunk.width;
                                        wctx.line_position += vchunk.width;
                                    }
                                } else |_| {
                                    logger.err("Failed to allocate space for saved chunks", .{});
                                    commitVirtualLine(wctx);
                                }

                                continue;
                            } else {
                                commitVirtualLine(wctx);
                                const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                                var byte_offset: u32 = 0;
                                if (char_offset > 0) {
                                    const pos_result = utf8.findPosByWidth(chunk_bytes, char_offset, wctx.text_buffer.tab_width, is_ascii_only, false, wctx.text_buffer.width_method);
                                    byte_offset = pos_result.byte_offset;
                                }
                                const remaining_bytes = chunk_bytes[byte_offset..];
                                const wrap_result = utf8.findWrapPosByWidth(remaining_bytes, wctx.wrap_w, wctx.text_buffer.tab_width, is_ascii_only, wctx.text_buffer.width_method);
                                to_add = wrap_result.columns_used;
                                if (to_add == 0) to_add = 1;
                            }

                            if (to_add > 0) {
                                const position_before_add = wctx.line_position;
                                const offset_before_add = wctx.global_char_offset;

                                addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, to_add);
                                char_offset += to_add;

                                if (has_wrap_after) {
                                    const wrap_pos_in_added = if (last_wrap_that_fits) |boundary_w|
                                        @min(boundary_w, to_add)
                                    else
                                        to_add;

                                    wctx.last_wrap_chunk_count = @intCast(wctx.current_vline.chunks.items.len);
                                    wctx.last_wrap_line_position = position_before_add + wrap_pos_in_added;
                                    wctx.last_wrap_global_offset = offset_before_add + wrap_pos_in_added;
                                }

                                if (wctx.line_position >= wctx.wrap_w and char_offset < chunk.width) {
                                    if (has_wrap_after or wctx.last_wrap_chunk_count > 0) {
                                        commitVirtualLine(wctx);
                                    }
                                }
                            }
                        }
                    } else {
                        const chunk_bytes = chunk.getBytes(&wctx.text_buffer.mem_registry);
                        const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                        var byte_offset: usize = 0;
                        var char_offset: u32 = 0;

                        while (char_offset < chunk.width) {
                            const remaining_width = if (wctx.line_position < wctx.wrap_w) wctx.wrap_w - wctx.line_position else 0;

                            if (remaining_width == 0) {
                                if (wctx.line_position > 0) {
                                    commitVirtualLine(wctx);
                                    continue;
                                }
                                const remaining_bytes = chunk_bytes[byte_offset..];
                                const force_result = utf8.findWrapPosByWidth(remaining_bytes, 1, wctx.text_buffer.tab_width, is_ascii_only, wctx.text_buffer.width_method);
                                if (force_result.grapheme_count > 0) {
                                    addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, force_result.columns_used);
                                    char_offset += force_result.columns_used;
                                    byte_offset += force_result.byte_offset;
                                } else {
                                    break;
                                }
                                continue;
                            }

                            const remaining_bytes = chunk_bytes[byte_offset..];
                            const wrap_result = utf8.findWrapPosByWidth(
                                remaining_bytes,
                                remaining_width,
                                wctx.text_buffer.tab_width,
                                is_ascii_only,
                                wctx.text_buffer.width_method,
                            );

                            if (wrap_result.grapheme_count == 0) {
                                if (wctx.line_position > 0) {
                                    commitVirtualLine(wctx);
                                    continue;
                                }
                                const force_result = utf8.findWrapPosByWidth(remaining_bytes, 1000, wctx.text_buffer.tab_width, is_ascii_only, wctx.text_buffer.width_method);
                                if (force_result.grapheme_count > 0) {
                                    addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, force_result.columns_used);
                                    char_offset += force_result.columns_used;
                                    byte_offset += force_result.byte_offset;
                                    if (char_offset < chunk.width) {
                                        commitVirtualLine(wctx);
                                    }
                                }
                                break;
                            }

                            addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, wrap_result.columns_used);
                            char_offset += wrap_result.columns_used;
                            byte_offset += wrap_result.byte_offset;

                            if (wctx.line_position >= wctx.wrap_w and char_offset < chunk.width) {
                                commitVirtualLine(wctx);
                            }
                        }
                    }
                }

                fn line_end_callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const wctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    if (wctx.current_vline.chunks.items.len > 0 or line_info.width == 0) {
                        wctx.current_vline.width = wctx.line_position;
                        wctx.current_vline.source_line = wctx.line_idx;
                        wctx.current_vline.source_col_offset = wctx.line_col_offset;
                        wctx.output.virtual_lines.append(wctx.allocator, wctx.current_vline) catch {};
                        wctx.output.cached_line_starts.append(wctx.allocator, wctx.current_vline.char_offset) catch {};
                        wctx.output.cached_line_widths.append(wctx.allocator, wctx.current_vline.width) catch {};
                        wctx.output.cached_line_sources.append(wctx.allocator, wctx.line_idx) catch {};
                        wctx.output.cached_line_wrap_indices.append(wctx.allocator, wctx.current_line_vline_count) catch {};
                        wctx.current_line_vline_count += 1;
                    }

                    wctx.output.cached_line_first_vline.append(wctx.allocator, wctx.current_line_first_vline_idx) catch {};
                    wctx.output.cached_line_vline_counts.append(wctx.allocator, wctx.current_line_vline_count) catch {};

                    wctx.global_char_offset += 1;

                    wctx.line_idx += 1;
                    wctx.line_col_offset = 0;
                    wctx.line_position = 0;
                    wctx.current_vline = VirtualLine.init();
                    wctx.current_vline.char_offset = wctx.global_char_offset;
                    wctx.chunk_idx_in_line = 0;
                    wctx.current_line_first_vline_idx = @intCast(wctx.output.virtual_lines.items.len);
                    wctx.current_line_vline_count = 0;
                }
            };

            var wrap_ctx = WrapContext{
                .text_buffer = text_buffer,
                .allocator = allocator,
                .output = output,
                .wrap_mode = wrap_mode,
                .wrap_w = wrap_w,
            };

            iter_mod.walkLinesAndSegments(&text_buffer.rope, &wrap_ctx, WrapContext.segment_callback, WrapContext.line_end_callback);
        }
    }
};
