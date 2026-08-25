const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const seg_mod = @import("text-buffer-segment.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const utf8 = @import("utf8.zig");

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

/// Colors for a text selection. Color intent (rgb, indexed, default) is
/// carried inside the RGBA values themselves, so no separate tag fields
/// are needed.
pub const SelectionStyle = struct {
    bgColor: ?RGBA = null,
    fgColor: ?RGBA = null,

    pub fn rgb(bgColor: ?RGBA, fgColor: ?RGBA) SelectionStyle {
        return .{
            .bgColor = bgColor,
            .fgColor = fgColor,
        };
    }
};

/// How a selection occupies cells between stored anchor and focus offsets.
/// `cell` includes the grapheme under the max endpoint (block / Vim-visual).
/// `boundary` is the half-open insert range `[min, max)` (thin / GUI carets).
/// Occupancy is independent of cursor style; style is paint only.
pub const SelectionOccupancy = enum(u8) {
    cell = 0,
    boundary = 1,
};

/// How local cell coordinates expand into a highlight range.
/// `cell` is the current inclusive press/drag. `word` and `line` expand
/// each endpoint through selectWord / selectLine.
pub const SelectionBehavior = enum(u8) {
    cell = 0,
    word = 1,
    line = 2,
};

/// Half-open display-offset range used by word/line click expansion.
pub const SelectionRange = struct {
    start: u32,
    end: u32,
};

/// Ghostty-style boundaries for double-click selection. NUL is omitted because
/// OpenTUI text buffers do not use it for unwritten terminal cells.
/// Keep this policy separate from `utf8.findWrapBreaks`: wrap and editor motion
/// split on `/`, `-`, and CJK/ASCII transitions, but selection does not.
/// Selection groups consecutive graphemes by this class, so space and tab runs
/// are selectable instead of mapping to an adjacent word.
const default_word_boundaries = [_]u21{
    ' ',
    '\t',
    '\'',
    '"',
    '│',
    '`',
    '|',
    ':',
    ';',
    ',',
    '(',
    ')',
    '[',
    ']',
    '{',
    '}',
    '<',
    '>',
    '$',
};

const SelectionEndpoints = struct {
    anchor: u32,
    focus: u32,
};

/// Viewport defines a rectangular window into the virtual line space
pub const Viewport = struct {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
};

pub const LineInfo = struct {
    line_start_cols: []const u32,
    line_width_cols: []const u32,
    line_sources: []const u32,
    line_wraps: []const u32,
    line_width_cols_max: u32,
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
    width_cols_max: u32,
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
    width_cols: u32,
    col_offset: u32,
    source_line: usize,
    source_col_offset: u32,
    is_truncated: bool,
    ellipsis_pos: u32,
    truncation_suffix_start: u32,

    pub fn init() VirtualLine {
        return .{
            .chunks = .empty,
            .width_cols = 0,
            .col_offset = 0,
            .source_line = 0,
            .source_col_offset = 0,
            .is_truncated = false,
            .ellipsis_pos = 0,
            .truncation_suffix_start = 0,
        };
    }

    pub fn deinit(self: *VirtualLine, allocator: Allocator) void {
        self.chunks.deinit(allocator);
        self.* = undefined;
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
    const Self = UnifiedTextBufferView;

    text_buffer: *UnifiedTextBuffer,
    original_text_buffer: *UnifiedTextBuffer,
    view_id: u32,
    selection: ?TextSelection,
    /// Local selection endpoints stay separate from the derived range because
    /// cell occupancy can extend `selection.end` past the focus grapheme.
    selection_endpoints: ?SelectionEndpoints,
    selection_occupancy: SelectionOccupancy,
    selection_behavior: SelectionBehavior,
    viewport: ?Viewport,
    wrap_width: ?u32,
    wrap_mode: WrapMode,
    first_line_offset: u32,
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

    /// Persistent arena for measureForDimensions. Each call resets it with
    /// retain_capacity to avoid mmap/munmap churn during streaming.
    measure_arena: std.heap.ArenaAllocator,
    tab_indicator: ?u32,
    tab_indicator_color: ?RGBA,
    truncate: bool,
    ellipsis_chunk: TextChunk,
    ellipsis_mem_id: u8,

    // Measurement cache for Yoga layout. Keyed by (buffer, epoch, width, wrap_mode).
    // Using epoch instead of dirty flag prevents stale returns when unrelated
    // code paths clear dirty (e.g., updateVirtualLines).
    cached_measure_width: ?u32,
    cached_measure_wrap_mode: WrapMode,
    cached_measure_first_line_offset: u32,
    cached_measure_result: ?MeasureResult,
    cached_measure_epoch: u64,
    cached_measure_buffer: ?*UnifiedTextBuffer,

    truncation_applied: bool,
    truncation_epoch: u64,
    truncation_viewport: ?Viewport,

    pub fn init(global_allocator: Allocator, text_buffer: *UnifiedTextBuffer) TextBufferViewError!*Self {
        const self = global_allocator.create(Self) catch return TextBufferViewError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const virtual_lines_internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferViewError.OutOfMemory;
        errdefer global_allocator.destroy(virtual_lines_internal_arena);
        virtual_lines_internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const view_id = text_buffer.registerView() catch return TextBufferViewError.OutOfMemory;

        const ellipsis_text = "...";
        const ellipsis_mem_id = text_buffer.registerMemBuffer(ellipsis_text, false) catch return TextBufferViewError.OutOfMemory;
        const ellipsis_chunk = text_buffer.createChunk(ellipsis_mem_id, 0, 3);

        self.* = .{
            .text_buffer = text_buffer,
            .original_text_buffer = text_buffer,
            .view_id = view_id,
            .selection = null,
            .selection_endpoints = null,
            .selection_occupancy = .cell,
            .selection_behavior = .cell,
            .viewport = null,
            .wrap_width = null,
            .wrap_mode = .none,
            .first_line_offset = 0,
            .virtual_lines = .empty,
            .virtual_lines_dirty = true,
            .cached_line_starts = .empty,
            .cached_line_widths = .empty,
            .cached_line_sources = .empty,
            .cached_line_wrap_indices = .empty,
            .cached_line_first_vline = .empty,
            .cached_line_vline_counts = .empty,
            .global_allocator = global_allocator,
            .virtual_lines_arena = virtual_lines_internal_arena,
            .measure_arena = std.heap.ArenaAllocator.init(global_allocator),
            .tab_indicator = null,
            .tab_indicator_color = null,
            .truncate = false,
            .ellipsis_chunk = ellipsis_chunk,
            .ellipsis_mem_id = ellipsis_mem_id,
            .cached_measure_width = null,
            .cached_measure_wrap_mode = .none,
            .cached_measure_first_line_offset = 0,
            .cached_measure_result = null,
            .cached_measure_epoch = 0,
            .cached_measure_buffer = null,
            .truncation_applied = false,
            .truncation_epoch = 0,
            .truncation_viewport = null,
        };

        return self;
    }

    /// IMPORTANT: Views must be destroyed BEFORE their associated TextBuffer.
    /// Destroying the TextBuffer first will cause use-after-free when calling deinit.
    /// The TypeScript wrappers enforce this order via the destroy() methods.
    pub fn deinit(self: *Self) void {
        const global_allocator = self.global_allocator;
        defer global_allocator.destroy(self);

        self.original_text_buffer.unregisterView(self.view_id);
        self.virtual_lines_arena.deinit();
        global_allocator.destroy(self.virtual_lines_arena);
        self.measure_arena.deinit();
        self.* = undefined;
    }

    pub fn setViewport(self: *Self, vp: ?Viewport) void {
        self.viewport = vp;

        // If viewport has width, set wrap width (wrapping behavior depends on wrap_mode)
        if (vp) |viewport| {
            if (self.wrap_width != viewport.width) {
                self.wrap_width = viewport.width;
                self.virtual_lines_dirty = true;
                self.truncation_applied = false;
            }
        } else {
            self.truncation_applied = false;
        }
    }

    pub fn getViewport(self: *const Self) ?Viewport {
        return self.viewport;
    }

    // This is a convenience method that preserves existing offset
    pub fn setViewportSize(self: *Self, width: u32, height: u32) void {
        if (self.viewport) |vp| {
            self.setViewport(.{
                .x = vp.x,
                .y = vp.y,
                .width = width,
                .height = height,
            });
        } else {
            self.setViewport(.{
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
            self.truncation_applied = false;
        }
    }

    pub fn setWrapMode(self: *Self, mode: WrapMode) void {
        if (self.wrap_mode != mode) {
            self.wrap_mode = mode;
            self.virtual_lines_dirty = true;
            self.truncation_applied = false;
        }
    }

    pub fn setFirstLineOffset(self: *Self, offset: u32) void {
        if (self.first_line_offset != offset) {
            self.first_line_offset = offset;
            self.virtual_lines_dirty = true;
            self.truncation_applied = false;
        }
    }

    fn calculateChunkFitWord(self: *const Self, chunk: *const TextChunk, char_offset_in_chunk: u32, max_width: u32) tb.ChunkFitResult {
        if (max_width == 0) return .{ .char_count = 0, .width = 0 };

        const total_width = @as(u32, chunk.width) - char_offset_in_chunk;
        if (total_width == 0) return .{ .char_count = 0, .width = 0 };
        if (total_width <= max_width) return .{ .char_count = total_width, .width = total_width };

        const wrap_offsets = self.text_buffer.getWrapOffsetsFor(chunk) catch {
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
        self.virtual_lines = .empty;
        self.cached_line_starts = .empty;
        self.cached_line_widths = .empty;
        self.cached_line_sources = .empty;
        self.cached_line_wrap_indices = .empty;
        self.cached_line_first_vline = .empty;
        self.cached_line_vline_counts = .empty;
        self.truncation_applied = false;
        const virtual_allocator = self.virtual_lines_arena.allocator();

        // Create output structure for the generic function
        const output: VirtualLineOutput = .{
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
            virtual_allocator,
            self.text_buffer,
            self.wrap_mode,
            self.wrap_width,
            self.first_line_offset,
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

        if (self.truncate and self.viewport != null) {
            self.ensureTruncation();
        }

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

            const viewport_line_start_cols = self.cached_line_starts.items[start_idx..end_idx];
            const viewport_line_width_cols = self.cached_line_widths.items[start_idx..end_idx];
            const viewport_line_sources = self.cached_line_sources.items[start_idx..end_idx];
            const viewport_line_wraps = self.cached_line_wrap_indices.items[start_idx..end_idx];

            var width_cols_max: u32 = 0;
            for (viewport_line_width_cols) |w| {
                width_cols_max = @max(width_cols_max, w);
            }

            return .{
                .line_start_cols = viewport_line_start_cols,
                .line_width_cols = viewport_line_width_cols,
                .line_sources = viewport_line_sources,
                .line_wraps = viewport_line_wraps,
                .line_width_cols_max = width_cols_max,
            };
        }

        return .{
            .line_start_cols = self.cached_line_starts.items,
            .line_width_cols = self.cached_line_widths.items,
            .line_sources = self.cached_line_sources.items,
            .line_wraps = self.cached_line_wrap_indices.items,
            .line_width_cols_max = self.text_buffer.lineWidthColsMax(),
        };
    }

    pub fn getLogicalLineInfo(self: *Self) LineInfo {
        self.updateVirtualLines();

        return .{
            .line_start_cols = self.cached_line_starts.items,
            .line_width_cols = self.cached_line_widths.items,
            .line_sources = self.cached_line_sources.items,
            .line_wraps = self.cached_line_wrap_indices.items,
            .line_width_cols_max = self.text_buffer.lineWidthColsMax(),
        };
    }

    pub fn getWrapInfo(self: *Self) WrapInfo {
        self.updateVirtualLines();
        return .{
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
            const vline_end_col = vline_start_col + vline.width_cols;

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

    fn selectionFromStyle(start: u32, end: u32, style: SelectionStyle) TextSelection {
        return .{
            .start = start,
            .end = end,
            .bgColor = style.bgColor,
            .fgColor = style.fgColor,
        };
    }

    fn clearSelectionEndpoints(self: *Self) void {
        self.selection_endpoints = null;
    }

    fn offsetSelectionRange(self: *Self, start: u32, end: u32) struct { start: u32, end: u32 } {
        const text_end = self.text_buffer.textEndOffset();
        var range_start = @min(@min(start, end), text_end);
        var range_end = @min(@max(start, end), text_end);
        if (range_start == range_end) {
            if (self.text_buffer.graphemeBoundsAtOffset(range_start)) |bounds| range_start = bounds.start;
            return .{ .start = range_start, .end = range_start };
        }

        if (self.text_buffer.graphemeBoundsAtOffset(range_start)) |bounds| {
            range_start = bounds.start;
        }
        if (self.text_buffer.graphemeBoundsAtOffset(range_end)) |bounds| {
            if (bounds.start < range_end) range_end = bounds.end;
        }

        return .{ .start = range_start, .end = @min(range_end, text_end) };
    }

    pub fn setSelection(self: *Self, start: u32, end: u32, bgColor: ?RGBA, fgColor: ?RGBA) void {
        self.setSelectionStyle(start, end, SelectionStyle.rgb(bgColor, fgColor));
    }

    pub fn setSelectionStyle(self: *Self, start: u32, end: u32, style: SelectionStyle) void {
        // Offset APIs write an already-exclusive [start, end) and do not go
        // through occupancy. Clear stored cell-pin endpoints so a later
        // occupancy change or cursor sync cannot replay a stale focus.
        self.clearSelectionEndpoints();
        const range = self.offsetSelectionRange(start, end);
        self.selection = selectionFromStyle(range.start, range.end, style);
    }

    pub fn updateSelection(self: *Self, end: u32, bgColor: ?RGBA, fgColor: ?RGBA) void {
        self.updateSelectionStyle(end, SelectionStyle.rgb(bgColor, fgColor));
    }

    pub fn updateSelectionStyle(self: *Self, end: u32, style: SelectionStyle) void {
        if (self.selection) |sel| {
            self.clearSelectionEndpoints();
            const range = self.offsetSelectionRange(sel.start, end);
            self.selection = selectionFromStyle(range.start, range.end, style);
        }
    }

    pub fn setSelectionColors(self: *Self, bgColor: ?RGBA, fgColor: ?RGBA) void {
        if (self.selection) |*selection| {
            selection.bgColor = bgColor;
            selection.fgColor = fgColor;
        }
    }

    pub fn resetSelection(self: *Self) void {
        self.selection = null;
        self.clearSelectionEndpoints();
        self.selection_behavior = .cell;
    }

    pub fn setSelectionOccupancy(self: *Self, occupancy: SelectionOccupancy) void {
        self.selection_occupancy = occupancy;
        const endpoints = if (self.selection_endpoints) |*endpoints| endpoints else return;
        const selection = if (self.selection) |*selection| selection else return;
        const text_end = self.getTextEndOffset();
        endpoints.anchor = @min(endpoints.anchor, text_end);
        endpoints.focus = @min(endpoints.focus, text_end);
        const range = self.expandSelectionRange(endpoints.anchor, endpoints.focus, text_end, self.selection_behavior) orelse
            self.selectionRange(endpoints.anchor, endpoints.focus, text_end);
        selection.start = range.start;
        selection.end = range.end;
    }

    pub fn getSelectionOccupancy(self: *const Self) SelectionOccupancy {
        return self.selection_occupancy;
    }

    /// Inclusive-end offset helper: under `cell` occupancy, extend `end` by the
    /// grapheme at that offset. Under `boundary`, write `[start, end)` as-is.
    /// Does not store cell-pin endpoints (offset API).
    pub fn setSelectionInclusiveStyle(self: *Self, start: u32, end: u32, style: SelectionStyle) void {
        const lo = @min(start, end);
        const hi = @max(start, end);
        const exclusive_end = if (self.selection_occupancy == .cell)
            if (self.text_buffer.graphemeBoundsAtOffset(hi)) |bounds| bounds.end else hi
        else
            hi;
        self.setSelectionStyle(lo, exclusive_end, style);
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
        return self.setLocalSelectionStyle(anchorX, anchorY, focusX, focusY, SelectionStyle.rgb(bgColor, fgColor), .cell);
    }

    pub fn setLocalSelectionBehavior(self: *Self, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?RGBA, fgColor: ?RGBA, behavior: SelectionBehavior) bool {
        return self.setLocalSelectionStyle(anchorX, anchorY, focusX, focusY, SelectionStyle.rgb(bgColor, fgColor), behavior);
    }

    pub fn setLocalSelectionStyle(self: *Self, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, style: SelectionStyle, behavior: SelectionBehavior) bool {
        self.updateVirtualLines();
        if (self.truncate and self.viewport != null) {
            self.ensureTruncation();
        }

        const anchor_above = anchorY < 0;
        const focus_above = focusY < 0;
        const max_y = @as(i32, @intCast(self.virtual_lines.items.len)) - 1;
        const anchor_below = anchorY > max_y;
        const focus_below = focusY > max_y;

        if ((anchor_above and focus_above) or (anchor_below and focus_below)) {
            const had_selection = self.selection != null;
            self.resetSelection();
            return had_selection;
        }

        const text_end_offset = self.getTextEndOffset();

        // Vertical clamping takes precedence when a point is below and left.
        const anchor_offset = if (anchor_below)
            text_end_offset
        else if (anchor_above or anchorX < 0)
            0
        else
            self.coordsToCharOffset(anchorX, anchorY) orelse {
                const had_selection = self.selection != null;
                self.resetSelection();
                return had_selection;
            };

        const focus_offset = if (focus_below)
            text_end_offset
        else if (focus_above or focusX < 0)
            0
        else
            self.coordsToCharOffset(focusX, focusY) orelse {
                const had_selection = self.selection != null;
                self.resetSelection();
                return had_selection;
            };

        self.selection_endpoints = .{ .anchor = anchor_offset, .focus = focus_offset };
        self.selection_behavior = behavior;

        const range = self.expandSelectionRange(anchor_offset, focus_offset, text_end_offset, behavior) orelse
            self.selectionRange(anchor_offset, focus_offset, text_end_offset);

        // Always store selection, even if zero-width, to preserve anchor for updateLocalSelection
        const new_selection = selectionFromStyle(range.start, range.end, style);

        const selection_changed = if (self.selection) |old_sel|
            old_sel.start != new_selection.start or old_sel.end != new_selection.end
        else
            true;

        self.selection = new_selection;
        return selection_changed;
    }

    pub fn updateLocalSelection(self: *Self, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?RGBA, fgColor: ?RGBA) bool {
        return self.updateLocalSelectionStyle(anchorX, anchorY, focusX, focusY, SelectionStyle.rgb(bgColor, fgColor), .cell);
    }

    pub fn updateLocalSelectionBehavior(self: *Self, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?RGBA, fgColor: ?RGBA, behavior: SelectionBehavior) bool {
        return self.updateLocalSelectionStyle(anchorX, anchorY, focusX, focusY, SelectionStyle.rgb(bgColor, fgColor), behavior);
    }

    pub fn updateLocalSelectionStyle(self: *Self, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, style: SelectionStyle, behavior: SelectionBehavior) bool {
        if (self.selection_endpoints != null) {
            return self.updateLocalSelectionFocusOnly(focusX, focusY, style, behavior);
        } else {
            return self.setLocalSelectionStyle(anchorX, anchorY, focusX, focusY, style, behavior);
        }
    }

    fn updateLocalSelectionFocusOnly(self: *Self, focusX: i32, focusY: i32, style: SelectionStyle, behavior: SelectionBehavior) bool {
        const endpoints = self.selection_endpoints orelse return false;
        const anchor_offset = endpoints.anchor;

        self.updateVirtualLines();
        if (self.truncate and self.viewport != null) {
            self.applyTruncation();
        }

        const focus_above = focusY < 0;
        const max_y = @as(i32, @intCast(self.virtual_lines.items.len)) - 1;
        const focus_below = focusY > max_y;

        const text_end_offset = self.getTextEndOffset();

        const focus_col_offset = if (focus_below)
            text_end_offset
        else if (focus_above or focusX < 0)
            0
        else
            self.coordsToCharOffset(focusX, focusY) orelse return false;

        self.selection_endpoints.?.focus = focus_col_offset;
        self.selection_behavior = behavior;

        const range = self.expandSelectionRange(anchor_offset, focus_col_offset, text_end_offset, behavior) orelse return false;
        self.selection = selectionFromStyle(range.start, range.end, style);

        return true;
    }

    /// Keep the exclusive highlight and store cell endpoints so a later
    /// cell drag or shift-extend does not re-expand by word or line.
    /// Cell occupancy pins focus on the last occupied grapheme; boundary
    /// occupancy pins it on the exclusive end.
    pub fn convertSelectionToCell(self: *Self) bool {
        const selection = self.selection orelse return false;
        if (selection.start == selection.end) return false;

        const focus = if (self.selection_occupancy == .boundary)
            selection.end
        else if (self.text_buffer.graphemeBoundsAtOffset(selection.end - 1)) |bounds|
            bounds.start
        else
            selection.end - 1;

        self.selection_endpoints = .{ .anchor = selection.start, .focus = focus };
        self.selection_behavior = .cell;
        return true;
    }

    fn expandSelectionRange(
        self: *Self,
        anchor_offset: u32,
        focus_offset: u32,
        text_end_offset: u32,
        behavior: SelectionBehavior,
    ) ?SelectionRange {
        switch (behavior) {
            .cell => return self.selectionRange(anchor_offset, focus_offset, text_end_offset),
            .word => {
                const a = self.selectWordBetween(anchor_offset, focus_offset);
                const b = self.selectWordBetween(focus_offset, anchor_offset);
                return unionRanges(a, b);
            },
            .line => {
                const a = self.selectLine(anchor_offset);
                const b = self.selectLine(focus_offset);
                return unionRanges(a, b);
            },
        }
    }

    fn unionRanges(a: ?SelectionRange, b: ?SelectionRange) ?SelectionRange {
        const left = a orelse return b;
        const right = b orelse return a;
        return .{
            .start = @min(left.start, right.start),
            .end = @max(left.end, right.end),
        };
    }

    /// Word at `offset`. Null on newline or end-of-buffer. `/` is not a boundary.
    pub fn selectWord(self: *Self, offset: u32) ?SelectionRange {
        const grapheme = self.selectionGraphemeAt(offset) orelse return null;
        if (grapheme.is_break) return null;

        const expect_boundary = isWordBoundary(grapheme.first_cp);
        var start = grapheme.start;
        var end = grapheme.end;

        while (self.prevSelectionGrapheme(start)) |prev| {
            if (prev.is_break) break;
            if (isWordBoundary(prev.first_cp) != expect_boundary) break;
            if (prev.start >= start) break;
            start = prev.start;
        }

        while (self.selectionGraphemeAt(end)) |next| {
            if (next.is_break) break;
            if (isWordBoundary(next.first_cp) != expect_boundary) break;
            if (next.end <= end) break;
            end = next.end;
        }

        return .{ .start = start, .end = end };
    }

    /// First non-null `selectWord` walking from `from` toward `toward`, inclusive.
    pub fn selectWordBetween(self: *Self, from: u32, toward: u32) ?SelectionRange {
        const text_end = self.text_buffer.textEndOffset();
        var offset = @min(from, text_end);
        const limit = @min(toward, text_end);

        if (offset <= limit) {
            while (offset <= limit) {
                if (self.selectWord(offset)) |range| return range;
                const next = self.selectionGraphemeAt(offset) orelse return null;
                if (next.end <= offset) return null;
                offset = next.end;
            }
            return null;
        }

        while (true) {
            if (self.selectWord(offset)) |range| return range;
            if (offset <= limit) return null;
            const prev = self.prevSelectionGrapheme(offset) orelse return null;
            if (prev.start >= offset) return null;
            offset = prev.start;
        }
    }

    /// Logical line at `offset`, ASCII space/tab trimmed. All-whitespace keeps
    /// the full source line so a blank line is still selected.
    pub fn selectLine(self: *Self, offset: u32) ?SelectionRange {
        return self.trimLineWhitespace(self.sourceLineRangeAt(offset) orelse return null);
    }

    fn sourceLineRangeAt(self: *Self, offset: u32) ?SelectionRange {
        const rope = self.text_buffer.rope();
        const text_end = self.text_buffer.textEndOffset();
        if (offset > text_end) return null;
        const coords = iter_mod.offsetToCoords(rope, offset) orelse return null;
        const start = offset - coords.col;
        return .{ .start = start, .end = start + iter_mod.lineWidthAt(rope, coords.row) };
    }

    fn trimLineWhitespace(self: *Self, range: SelectionRange) SelectionRange {
        var start = range.start;
        var end = range.end;
        var saw_content = false;

        var offset = range.start;
        while (offset < range.end) {
            const grapheme = self.selectionGraphemeAt(offset) orelse break;
            if (grapheme.is_break) break;
            if (grapheme.first_cp != ' ' and grapheme.first_cp != '\t') {
                if (!saw_content) start = grapheme.start;
                end = grapheme.end;
                saw_content = true;
            }
            if (grapheme.end <= offset) break;
            offset = grapheme.end;
        }

        if (!saw_content) return range;
        return .{ .start = start, .end = end };
    }

    const SelectionGrapheme = struct {
        start: u32,
        end: u32,
        first_cp: u21,
        is_break: bool,
    };

    fn selectionGraphemeAt(self: *Self, offset: u32) ?SelectionGrapheme {
        const text_end = self.text_buffer.textEndOffset();
        if (offset >= text_end) return null;

        const rope = self.text_buffer.rope();
        const coords = iter_mod.offsetToCoords(rope, offset) orelse return null;
        const line_width = iter_mod.lineWidthAt(rope, coords.row);
        const line_start = offset - coords.col;

        if (coords.col >= line_width) {
            return .{
                .start = line_start + line_width,
                .end = line_start + line_width + 1,
                .first_cp = '\n',
                .is_break = true,
            };
        }

        const linestart = rope.getMarker(.linestart, coords.row) orelse return null;
        var seg_idx = linestart.leaf_index + 1;
        var cols_before: u32 = 0;
        const mem_registry = self.text_buffer.memRegistry();
        const tab_width = self.text_buffer.tabWidth();
        const width_method = self.text_buffer.widthMethod();

        while (seg_idx < rope.count()) : (seg_idx += 1) {
            const seg = rope.get(seg_idx) orelse break;
            if (seg.isBreak() or seg.isLineStart()) break;
            const chunk = seg.asText() orelse continue;
            const next_cols = cols_before + chunk.width;
            if (coords.col < next_cols) {
                const bytes = chunk.getBytes(mem_registry);
                const is_ascii = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                const pos = utf8.findGraphemePosByWidth(
                    bytes,
                    coords.col - cols_before,
                    tab_width,
                    is_ascii,
                    false,
                    width_method,
                );
                if (pos.byte_offset >= bytes.len) return null;
                var width = utf8.getGraphemeWidthAt(bytes, pos.byte_offset, tab_width, width_method);
                if (width == 0) {
                    const next = utf8.findGraphemePosByWidth(
                        bytes,
                        pos.columns_used + 1,
                        tab_width,
                        is_ascii,
                        false,
                        width_method,
                    );
                    if (next.byte_offset < bytes.len) {
                        width = utf8.getGraphemeWidthAt(bytes, next.byte_offset, tab_width, width_method);
                    }
                }
                const first_cp = utf8.decodeUtf8Unchecked(bytes, pos.byte_offset).cp;
                const start = line_start + cols_before + pos.columns_used;
                return .{
                    .start = start,
                    .end = start + width,
                    .first_cp = first_cp,
                    .is_break = first_cp == '\n' or first_cp == '\r',
                };
            }
            cols_before = next_cols;
        }
        return null;
    }

    fn prevSelectionGrapheme(self: *Self, offset: u32) ?SelectionGrapheme {
        if (offset == 0) return null;
        return self.selectionGraphemeAt(offset - 1);
    }

    fn isWordBoundary(cp: u21) bool {
        return std.mem.indexOfScalar(u21, &default_word_boundaries, cp) != null;
    }

    /// Derive the exclusive highlight/copy/delete range from stored endpoints.
    /// `cell`: `[min, max + width(max))` so both endpoint graphemes are occupied.
    /// `boundary`: `[min, max)` — the insert range the caret swept.
    /// Zero extent (`anchor == focus`) stays empty in both modes: a press is
    /// not a cell to occupy.
    fn selectionRange(self: *Self, anchor_offset: u32, focus_offset: u32, text_end_offset: u32) SelectionRange {
        var start = @min(anchor_offset, focus_offset);
        var end = @max(anchor_offset, focus_offset);
        if (anchor_offset == focus_offset) {
            const offset = @min(start, text_end_offset);
            return .{ .start = offset, .end = offset };
        }

        if (self.text_buffer.graphemeBoundsAtOffset(start)) |bounds| {
            start = bounds.start;
        }
        if (self.text_buffer.graphemeBoundsAtOffset(end)) |bounds| {
            if (self.selection_occupancy == .cell or bounds.start < end) {
                end = bounds.end;
            }
        }

        start = @min(start, text_end_offset);
        end = @min(end, text_end_offset);
        return .{ .start = start, .end = end };
    }

    pub fn resetLocalSelection(self: *Self) void {
        self.resetSelection();
    }

    fn getTextEndOffset(self: *Self) u32 {
        self.updateVirtualLines();
        if (self.truncate and self.viewport != null) {
            self.ensureTruncation();
        }

        if (self.virtual_lines.items.len == 0) return 0;
        const last_line_idx = self.virtual_lines.items.len - 1;
        const last_vline = &self.virtual_lines.items[last_line_idx];

        if (last_vline.is_truncated) {
            return last_vline.col_offset + last_vline.truncation_suffix_start + (last_vline.width_cols -| last_vline.ellipsis_pos -| 3);
        }

        return last_vline.col_offset + last_vline.width_cols;
    }

    /// Cell occupancy clamps wrap padding to the last cell. Boundary occupancy
    /// maps it to the insertion gap after that cell.
    fn maxLocalXOnVisualLine(self: *const Self, vlines: []const VirtualLine, vline_idx: usize) u32 {
        const vline = &vlines[vline_idx];
        if (vline.width_cols == 0) return 0;
        if (self.selection_occupancy == .cell and vline_idx + 1 < vlines.len) {
            const next_vline = &vlines[vline_idx + 1];
            if (next_vline.source_line == vline.source_line) {
                return vline.width_cols - 1;
            }
        }
        return vline.width_cols;
    }

    fn coordsToCharOffset(self: *Self, x: i32, y: i32) ?u32 {
        self.updateVirtualLines();
        if (self.truncate and self.viewport != null) {
            self.ensureTruncation();
        }

        const y_offset: i32 = if (self.viewport) |vp| @intCast(vp.y) else 0;
        const x_offset: i32 = if (self.viewport) |vp|
            (if (self.wrap_mode == .none) @intCast(vp.x) else 0)
        else
            0;

        if (self.virtual_lines.items.len == 0) {
            return 0;
        }

        const abs_y = y + y_offset;
        const abs_x = x + x_offset;

        const clamped_y = @max(0, @min(abs_y, @as(i32, @intCast(self.virtual_lines.items.len)) - 1));

        const vline_idx: usize = @intCast(clamped_y);
        const vline = &self.virtual_lines.items[vline_idx];
        const lineStart = vline.col_offset;
        const max_local_x = self.maxLocalXOnVisualLine(self.virtual_lines.items, vline_idx);

        var localX = @max(0, @min(abs_x, @as(i32, @intCast(max_local_x))));

        if (vline.is_truncated) {
            const ellipsis_width: u32 = 3;
            const localX_u32: u32 = @intCast(localX);

            if (localX_u32 >= vline.ellipsis_pos and localX_u32 < vline.ellipsis_pos + ellipsis_width) {
                localX = @intCast(vline.ellipsis_pos);
            } else if (localX_u32 >= vline.ellipsis_pos + ellipsis_width) {
                const suffix_offset = localX_u32 - vline.ellipsis_pos - ellipsis_width;
                localX = @intCast(vline.truncation_suffix_start + suffix_offset);
            }
        }

        const result = lineStart + @as(u32, @intCast(localX));

        return result;
    }

    /// Pack selection info into u64 for efficient passing
    /// Returns 0xFFFF_FFFF_FFFF_FFFF for no selection or zero-width selection
    pub fn packSelectionInfo(self: *const Self) u64 {
        if (self.selection) |sel| {
            if (sel.start == sel.end) {
                return 0xFFFF_FFFF_FFFF_FFFF;
            }
            return (@as(u64, sel.start) << 32) | @as(u64, sel.end);
        } else {
            return 0xFFFF_FFFF_FFFF_FFFF;
        }
    }

    /// Get selected text into buffer - using efficient single-pass API
    pub fn getSelectedTextIntoBuffer(self: *Self, out_buffer: []u8) usize {
        const selection = self.selection orelse return 0;
        if (selection.start == selection.end) return 0;
        return self.text_buffer.getTextRange(selection.start, selection.end, out_buffer);
    }

    pub fn getVirtualLineSpans(self: *const Self, vline_idx: usize) VirtualLineSpanInfo {
        if (vline_idx >= self.virtual_lines.items.len) {
            return .{ .spans = &[_]StyleSpan{}, .source_line = 0, .col_offset = 0 };
        }

        const vline = &self.virtual_lines.items[vline_idx];
        const spans = self.text_buffer.getLineSpans(vline.source_line);

        return .{
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

    pub fn setTruncate(self: *Self, truncate: bool) void {
        if (self.truncate != truncate) {
            self.truncate = truncate;
            self.virtual_lines_dirty = true;
            self.truncation_applied = false;
        }
    }

    pub fn getTruncate(self: *const Self) bool {
        return self.truncate;
    }

    fn ensureTruncation(self: *Self) void {
        if (!self.truncate or self.viewport == null) return;

        const epoch = self.text_buffer.getContentEpoch();
        if (self.truncation_applied and self.truncation_epoch == epoch and
            self.truncation_viewport != null and self.viewport != null and
            self.truncation_viewport.?.x == self.viewport.?.x and
            self.truncation_viewport.?.y == self.viewport.?.y and
            self.truncation_viewport.?.width == self.viewport.?.width and
            self.truncation_viewport.?.height == self.viewport.?.height)
        {
            return;
        }

        self.applyTruncation();
        self.truncation_applied = true;
        self.truncation_epoch = epoch;
        self.truncation_viewport = self.viewport;
    }

    fn applyTruncation(self: *Self) void {
        const vp = self.viewport orelse return;
        if (vp.width == 0) return;

        const ellipsis_width: u32 = 3;

        for (self.virtual_lines.items) |*vline| {
            if (vline.width_cols <= vp.width) continue;

            if (vp.width <= ellipsis_width) {
                vline.chunks.clearRetainingCapacity();
                vline.width_cols = 0;
                vline.is_truncated = true;
                vline.ellipsis_pos = 0;
                vline.truncation_suffix_start = vline.width_cols;
                continue;
            }

            const available_width = vp.width - ellipsis_width;
            const prefix_width = available_width / 2;
            const suffix_width = available_width - prefix_width;

            var new_chunks: std.ArrayListUnmanaged(VirtualChunk) = .empty;

            var prefix_accumulated: u32 = 0;
            for (vline.chunks.items) |chunk| {
                if (prefix_accumulated >= prefix_width) break;

                const space_left = prefix_width - prefix_accumulated;
                if (chunk.width <= space_left) {
                    new_chunks.append(self.virtual_lines_arena.allocator(), chunk) catch return;
                    prefix_accumulated += chunk.width;
                } else {
                    var partial = chunk;
                    partial.width = space_left;
                    new_chunks.append(self.virtual_lines_arena.allocator(), partial) catch return;
                    prefix_accumulated += space_left;
                    break;
                }
            }

            new_chunks.append(self.virtual_lines_arena.allocator(), .{
                .grapheme_start = 0,
                .width = ellipsis_width,
                .chunk = &self.ellipsis_chunk,
            }) catch return;

            const suffix_start_pos = vline.width_cols - suffix_width;

            var pos_accumulated: u32 = 0;
            for (vline.chunks.items) |chunk| {
                const chunk_end = pos_accumulated + chunk.width;

                if (chunk_end <= suffix_start_pos) {
                    pos_accumulated += chunk.width;
                    continue;
                }

                if (pos_accumulated >= suffix_start_pos) {
                    new_chunks.append(self.virtual_lines_arena.allocator(), chunk) catch return;
                } else {
                    const offset_in_chunk = suffix_start_pos - pos_accumulated;
                    var partial = chunk;
                    partial.grapheme_start += offset_in_chunk;
                    partial.width = chunk.width - offset_in_chunk;
                    new_chunks.append(self.virtual_lines_arena.allocator(), partial) catch return;
                }

                pos_accumulated += chunk.width;
            }

            vline.chunks.clearRetainingCapacity();
            vline.chunks.appendSlice(self.virtual_lines_arena.allocator(), new_chunks.items) catch return;
            vline.width_cols = vp.width;
            vline.is_truncated = true;
            vline.ellipsis_pos = prefix_width;
            vline.truncation_suffix_start = suffix_start_pos;
        }
    }

    /// Measure dimensions for given width/height WITHOUT modifying virtual lines cache
    /// This is useful for Yoga measure functions that need to know dimensions without committing changes
    /// Special case: width=0 or wrap_mode=.none means "measure intrinsic/max-content width" (no wrapping)
    pub fn measureForDimensions(self: *Self, width: u32, height: u32) TextBufferViewError!MeasureResult {
        _ = height; // Height is for future use, currently only width affects layout
        const epoch = self.text_buffer.getContentEpoch();
        if (self.cached_measure_result) |result| {
            if (self.cached_measure_epoch == epoch and self.cached_measure_buffer == self.text_buffer) {
                if (self.cached_measure_width) |cached_width| {
                    if (cached_width == width and
                        self.cached_measure_wrap_mode == self.wrap_mode and
                        self.cached_measure_first_line_offset == self.first_line_offset)
                    {
                        return result;
                    }
                }
            }
        }

        // No-wrap path avoids allocations by using marker-based line widths.
        if (width == 0 or self.wrap_mode == .none) {
            const line_count = self.text_buffer.lineCount();
            var width_cols_max: u32 = 0;
            var row: u32 = 0;
            while (row < line_count) : (row += 1) {
                width_cols_max = @max(width_cols_max, self.text_buffer.lineWidthAt(row));
            }

            const result: MeasureResult = .{
                .line_count = line_count,
                .width_cols_max = width_cols_max,
            };

            self.cached_measure_width = width;
            self.cached_measure_wrap_mode = self.wrap_mode;
            self.cached_measure_first_line_offset = self.first_line_offset;
            self.cached_measure_result = result;
            self.cached_measure_epoch = epoch;
            self.cached_measure_buffer = self.text_buffer;

            return result;
        }

        // Reuse arena capacity to avoid allocation overhead during streaming.
        _ = self.measure_arena.reset(.retain_capacity);
        const measure_allocator = self.measure_arena.allocator();

        // Create temporary output structures
        var temp_virtual_lines: std.ArrayListUnmanaged(VirtualLine) = .empty;
        var temp_line_starts: std.ArrayListUnmanaged(u32) = .empty;
        var temp_line_widths: std.ArrayListUnmanaged(u32) = .empty;
        var temp_line_sources: std.ArrayListUnmanaged(u32) = .empty;
        var temp_line_wrap_indices: std.ArrayListUnmanaged(u32) = .empty;
        var temp_line_first_vline: std.ArrayListUnmanaged(u32) = .empty;
        var temp_line_vline_counts: std.ArrayListUnmanaged(u32) = .empty;

        const output: VirtualLineOutput = .{
            .virtual_lines = &temp_virtual_lines,
            .cached_line_starts = &temp_line_starts,
            .cached_line_widths = &temp_line_widths,
            .cached_line_sources = &temp_line_sources,
            .cached_line_wrap_indices = &temp_line_wrap_indices,
            .cached_line_first_vline = &temp_line_first_vline,
            .cached_line_vline_counts = &temp_line_vline_counts,
        };

        // Use width for wrap calculation
        const wrap_width_for_measure = if (self.wrap_mode != .none and width > 0) width else null;

        // Call generic calculation with temporary structures
        calculateVirtualLinesGeneric(
            measure_allocator,
            self.text_buffer,
            self.wrap_mode,
            wrap_width_for_measure,
            self.first_line_offset,
            output,
        );

        // Calculate max width from temp structures
        var width_cols_max: u32 = 0;
        for (temp_line_widths.items) |w| {
            width_cols_max = @max(width_cols_max, w);
        }

        const result: MeasureResult = .{
            .line_count = @intCast(temp_virtual_lines.items.len),
            .width_cols_max = width_cols_max,
        };

        self.cached_measure_width = width;
        self.cached_measure_wrap_mode = self.wrap_mode;
        self.cached_measure_first_line_offset = self.first_line_offset;
        self.cached_measure_result = result;
        self.cached_measure_epoch = epoch;
        self.cached_measure_buffer = self.text_buffer;

        return result;
    }

    /// Generic virtual line calculation that writes to provided output structures
    fn calculateVirtualLinesGeneric(
        allocator: Allocator,
        text_buffer: *UnifiedTextBuffer,
        wrap_mode: WrapMode,
        wrap_width: ?u32,
        first_line_offset: u32,
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
                        vline.chunks.append(ctx.allocator, .{
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
                    vline.width_cols = line_info.width_cols;
                    vline.col_offset = line_info.col_offset;
                    vline.source_line = line_info.line_idx;
                    vline.source_col_offset = 0;

                    ctx.output.virtual_lines.append(ctx.allocator, vline) catch {};
                    ctx.output.cached_line_starts.append(ctx.allocator, vline.col_offset) catch {};
                    ctx.output.cached_line_widths.append(ctx.allocator, vline.width_cols) catch {};
                    ctx.output.cached_line_sources.append(ctx.allocator, @intCast(line_info.line_idx)) catch {};
                    ctx.output.cached_line_wrap_indices.append(ctx.allocator, 0) catch {};

                    ctx.current_vline = VirtualLine.init();
                }
            };

            var ctx: Context = .{
                .text_buffer = text_buffer,
                .allocator = allocator,
                .output = output,
                .current_vline = VirtualLine.init(),
            };

            text_buffer.walkLinesAndSegments(&ctx, Context.segment_callback, Context.line_end_callback);
        } else {
            const wrap_w = wrap_width.?;

            const WrapContext = struct {
                text_buffer: *UnifiedTextBuffer,
                allocator: Allocator,
                output: VirtualLineOutput,
                wrap_mode: WrapMode,
                wrap_w: u32,
                first_line_offset: u32,
                first_line_pending: bool,
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

                fn lineWrapWidth(wctx: *@This()) u32 {
                    if (!wctx.first_line_pending or wctx.first_line_offset == 0 or wctx.first_line_offset >= wctx.wrap_w) {
                        return wctx.wrap_w;
                    }

                    return wctx.wrap_w - wctx.first_line_offset;
                }

                fn commitVirtualLine(wctx: *@This()) void {
                    wctx.current_vline.width_cols = wctx.line_position;
                    wctx.current_vline.source_line = wctx.line_idx;
                    wctx.current_vline.source_col_offset = wctx.line_col_offset;
                    wctx.output.virtual_lines.append(wctx.allocator, wctx.current_vline) catch {};
                    wctx.output.cached_line_starts.append(wctx.allocator, wctx.current_vline.col_offset) catch {};
                    wctx.output.cached_line_widths.append(wctx.allocator, wctx.current_vline.width_cols) catch {};
                    wctx.output.cached_line_sources.append(wctx.allocator, wctx.line_idx) catch {};
                    wctx.output.cached_line_wrap_indices.append(wctx.allocator, wctx.current_line_vline_count) catch {};

                    wctx.current_line_vline_count += 1;

                    wctx.line_col_offset += wctx.line_position;
                    wctx.current_vline = VirtualLine.init();
                    wctx.current_vline.col_offset = wctx.global_char_offset;
                    wctx.line_position = 0;
                    wctx.first_line_pending = false;

                    wctx.last_wrap_chunk_count = 0;
                    wctx.last_wrap_line_position = 0;
                    wctx.last_wrap_global_offset = 0;
                }

                fn addVirtualChunk(wctx: *@This(), chunk: *const TextChunk, _: u32, start: u32, width_param: u32) void {
                    wctx.current_vline.chunks.append(wctx.allocator, .{
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
                        const chunk_bytes = chunk.getBytes(wctx.text_buffer.memRegistry());
                        const wrap_offsets = wctx.text_buffer.getWrapOffsetsFor(chunk) catch &[_]utf8.WrapBreak{};
                        const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                        const graphemes: []const GraphemeInfo = if (is_ascii_only)
                            &[_]GraphemeInfo{}
                        else
                            chunk.getGraphemes(wctx.text_buffer.getAllocator(), wctx.text_buffer.memRegistry(), wctx.text_buffer.tabWidth(), wctx.text_buffer.widthMethod()) catch &[_]GraphemeInfo{};
                        var grapheme_idx: usize = 0;
                        var col_delta: i64 = 0;

                        // char_offset tracks COLUMN position within the chunk (not grapheme count)
                        // chunk.width is also in columns. The loop processes the chunk column by column.
                        var char_offset: u32 = 0; // Column offset within chunk
                        var byte_offset: u32 = 0;
                        var wrap_idx: usize = 0;

                        while (char_offset < chunk.width) {
                            const line_wrap_w = wctx.lineWrapWidth();
                            const remaining_in_chunk = chunk.width - char_offset;
                            const remaining_on_line = if (wctx.line_position < line_wrap_w) line_wrap_w - wctx.line_position else 0;

                            var last_wrap_that_fits: ?u32 = null;
                            var saved_wrap_idx = wrap_idx;
                            while (wrap_idx < wrap_offsets.len) : (wrap_idx += 1) {
                                const wrap_break = wrap_offsets[wrap_idx];

                                const break_info = iter_mod.charOffsetToColumn(wrap_break.char_offset, graphemes, &grapheme_idx, &col_delta);
                                const break_col = break_info.col;

                                // Skip breaks that are before our current column position in the chunk
                                if (break_col < char_offset) continue;

                                // width_to_boundary: columns needed to reach and include this break
                                // break_col is the column where the break character starts (relative to chunk)
                                // char_offset is our current column position (relative to chunk)
                                // To include the break character, we need: break_col - char_offset + width
                                const width_to_boundary = break_col - char_offset + break_info.width;
                                if (width_to_boundary > remaining_on_line or width_to_boundary > remaining_in_chunk) {
                                    break;
                                }
                                last_wrap_that_fits = width_to_boundary;
                                saved_wrap_idx = wrap_idx + 1;
                            }
                            wrap_idx = saved_wrap_idx;

                            var to_add: u32 = 0;
                            var has_wrap_after: bool = false;

                            if (remaining_in_chunk <= remaining_on_line) {
                                if (last_wrap_that_fits) |boundary_w| {
                                    const would_fill_line = wctx.line_position + remaining_in_chunk >= line_wrap_w;
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
                                // Use tracked byte_offset instead of recalculating from scratch (avoids O(n²))
                                const remaining_bytes = chunk_bytes[byte_offset..];
                                const wrap_result = utf8.findWrapPosByWidth(remaining_bytes, remaining_on_line, wctx.text_buffer.tabWidth(), is_ascii_only, wctx.text_buffer.widthMethod());
                                to_add = wrap_result.columns_used;
                                byte_offset += wrap_result.byte_offset;
                                if (to_add == 0) {
                                    to_add = 1;
                                    const single_result = utf8.findWrapPosByWidth(remaining_bytes, 1, wctx.text_buffer.tabWidth(), is_ascii_only, wctx.text_buffer.widthMethod());
                                    byte_offset += single_result.byte_offset;
                                }
                            } else if (wctx.last_wrap_chunk_count > 0 and
                                wctx.last_wrap_chunk_count <= wctx.current_vline.chunks.items.len)
                            {
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
                                    commitVirtualLine(wctx);
                                }

                                continue;
                            } else {
                                commitVirtualLine(wctx);
                                if (char_offset > 0) {
                                    const pos_result = utf8.findPosByWidth(chunk_bytes, char_offset, wctx.text_buffer.tabWidth(), is_ascii_only, false, wctx.text_buffer.widthMethod());
                                    byte_offset = pos_result.byte_offset;
                                }
                                const remaining_bytes = chunk_bytes[byte_offset..];
                                const wrap_result = utf8.findWrapPosByWidth(remaining_bytes, wctx.lineWrapWidth(), wctx.text_buffer.tabWidth(), is_ascii_only, wctx.text_buffer.widthMethod());
                                to_add = wrap_result.columns_used;
                                byte_offset += wrap_result.byte_offset;
                                if (to_add == 0) {
                                    to_add = 1;
                                    const single_result = utf8.findWrapPosByWidth(remaining_bytes, 1, wctx.text_buffer.tabWidth(), is_ascii_only, wctx.text_buffer.widthMethod());
                                    byte_offset += single_result.byte_offset;
                                }
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

                                if (wctx.line_position >= line_wrap_w and char_offset < chunk.width) {
                                    if (has_wrap_after or wctx.last_wrap_chunk_count > 0) {
                                        commitVirtualLine(wctx);
                                    }
                                }
                            }
                        }
                    } else {
                        const chunk_bytes = chunk.getBytes(wctx.text_buffer.memRegistry());
                        const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                        var byte_offset: usize = 0;
                        var char_offset: u32 = 0;

                        while (char_offset < chunk.width) {
                            const line_wrap_w = wctx.lineWrapWidth();
                            const remaining_width = if (wctx.line_position < line_wrap_w) line_wrap_w - wctx.line_position else 0;

                            if (remaining_width == 0) {
                                if (wctx.line_position > 0) {
                                    commitVirtualLine(wctx);
                                    continue;
                                }
                                const remaining_bytes = chunk_bytes[byte_offset..];
                                const force_result = utf8.findWrapPosByWidth(remaining_bytes, 1, wctx.text_buffer.tabWidth(), is_ascii_only, wctx.text_buffer.widthMethod());
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
                                wctx.text_buffer.tabWidth(),
                                is_ascii_only,
                                wctx.text_buffer.widthMethod(),
                            );

                            if (wrap_result.grapheme_count == 0) {
                                if (wctx.line_position > 0) {
                                    commitVirtualLine(wctx);
                                    continue;
                                }
                                const force_result = utf8.findWrapPosByWidth(remaining_bytes, 1000, wctx.text_buffer.tabWidth(), is_ascii_only, wctx.text_buffer.widthMethod());
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

                            if (wctx.line_position >= line_wrap_w and char_offset < chunk.width) {
                                commitVirtualLine(wctx);
                            }
                        }
                    }
                }

                fn line_end_callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const wctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    if (wctx.current_vline.chunks.items.len > 0 or line_info.width_cols == 0) {
                        wctx.current_vline.width_cols = wctx.line_position;
                        wctx.current_vline.source_line = wctx.line_idx;
                        wctx.current_vline.source_col_offset = wctx.line_col_offset;
                        wctx.output.virtual_lines.append(wctx.allocator, wctx.current_vline) catch {};
                        wctx.output.cached_line_starts.append(wctx.allocator, wctx.current_vline.col_offset) catch {};
                        wctx.output.cached_line_widths.append(wctx.allocator, wctx.current_vline.width_cols) catch {};
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
                    wctx.first_line_pending = false;
                    wctx.current_vline = VirtualLine.init();
                    wctx.current_vline.col_offset = wctx.global_char_offset;
                    wctx.last_wrap_chunk_count = 0;
                    wctx.last_wrap_line_position = 0;
                    wctx.last_wrap_global_offset = 0;
                    wctx.chunk_idx_in_line = 0;
                    wctx.current_line_first_vline_idx = @intCast(wctx.output.virtual_lines.items.len);
                    wctx.current_line_vline_count = 0;
                }
            };

            var wrap_ctx: WrapContext = .{
                .text_buffer = text_buffer,
                .allocator = allocator,
                .output = output,
                .wrap_mode = wrap_mode,
                .wrap_w = wrap_w,
                .first_line_offset = first_line_offset,
                .first_line_pending = first_line_offset > 0,
            };

            text_buffer.walkLinesAndSegments(&wrap_ctx, WrapContext.segment_callback, WrapContext.line_end_callback);
        }
    }
};
