const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const seg_mod = @import("text-buffer-segment.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

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
    x: u32, // Column offset (for horizontal scroll)
    y: u32, // Virtual line offset (first visible line)
    width: u32, // Viewport width in columns
    height: u32, // Viewport height in rows (virtual lines)
};

/// Line info struct for cached line information
pub const LineInfo = struct {
    starts: []const u32,
    widths: []const u32,
    max_width: u32,
};

/// Wrap info struct for logical-to-virtual line mapping
pub const WrapInfo = struct {
    line_first_vline: []const u32,
    line_vline_counts: []const u32,
};

/// A virtual chunk references a portion of a real TextChunk for text wrapping
pub const VirtualChunk = struct {
    grapheme_start: u32,
    grapheme_count: u32,
    width: u16,
    // Direct reference to source chunk for rendering
    chunk: *const TextChunk,
};

/// A virtual line represents a display line after text wrapping
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

/// Main TextBufferView type - unified architecture
pub const TextBufferView = UnifiedTextBufferView;

// Legacy type aliases for FFI/test compatibility
pub const TextBufferViewArray = UnifiedTextBufferView;
pub const TextBufferViewRope = UnifiedTextBufferView;

/// TextBufferView for UnifiedTextBuffer
pub const UnifiedTextBufferView = struct {
    const Self = @This();

    text_buffer: *UnifiedTextBuffer,
    view_id: u32,

    // View-specific state
    selection: ?TextSelection,
    local_selection: ?LocalSelection,

    // Viewport state
    viewport: ?Viewport,

    // Wrapping state
    wrap_width: ?u32,
    wrap_mode: WrapMode,
    virtual_lines: std.ArrayListUnmanaged(VirtualLine),
    virtual_lines_dirty: bool,

    // Cached line info
    cached_line_starts: std.ArrayListUnmanaged(u32),
    cached_line_widths: std.ArrayListUnmanaged(u32),

    // Cached wrap info (logical line -> virtual line mapping)
    cached_line_first_vline: std.ArrayListUnmanaged(u32),
    cached_line_vline_counts: std.ArrayListUnmanaged(u32),

    // Memory management
    global_allocator: Allocator,
    virtual_lines_arena: *std.heap.ArenaAllocator,

    pub fn init(global_allocator: Allocator, text_buffer: *UnifiedTextBuffer) TextBufferViewError!*Self {
        const self = global_allocator.create(Self) catch return TextBufferViewError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const virtual_lines_internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferViewError.OutOfMemory;
        errdefer global_allocator.destroy(virtual_lines_internal_arena);
        virtual_lines_internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const view_id = text_buffer.registerView() catch return TextBufferViewError.OutOfMemory;

        self.* = .{
            .text_buffer = text_buffer,
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
            .cached_line_first_vline = .{},
            .cached_line_vline_counts = .{},
            .global_allocator = global_allocator,
            .virtual_lines_arena = virtual_lines_internal_arena,
        };

        return self;
    }

    pub fn deinit(self: *Self) void {
        self.text_buffer.unregisterView(self.view_id);
        self.virtual_lines_arena.deinit();
        self.global_allocator.destroy(self.virtual_lines_arena);
        self.global_allocator.destroy(self);
    }

    /// Set the viewport. Automatically sets wrap width to viewport width.
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

    /// Set viewport size (width and height only)
    /// This is a convenience method that preserves existing offset
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

    /// Calculate how much of a chunk fits in remaining width for word wrapping
    fn calculateChunkFitWord(self: *const Self, chunk: *const TextChunk, char_offset_in_chunk: u32, max_width: u32) tb.ChunkFitResult {
        if (max_width == 0) return .{ .char_count = 0, .width = 0 };

        const total_width = @as(u32, chunk.width) - char_offset_in_chunk;
        if (total_width == 0) return .{ .char_count = 0, .width = 0 };
        if (total_width <= max_width) return .{ .char_count = total_width, .width = total_width };

        const wrap_offsets = chunk.getWrapOffsets(&self.text_buffer.mem_registry, self.text_buffer.allocator) catch {
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

    /// Update virtual lines with wrapping support
    pub fn updateVirtualLines(self: *Self) void {
        const buffer_dirty = self.text_buffer.isViewDirty(self.view_id);
        if (!self.virtual_lines_dirty and !buffer_dirty) return;

        _ = self.virtual_lines_arena.reset(.free_all);
        self.virtual_lines = .{};
        self.cached_line_starts = .{};
        self.cached_line_widths = .{};
        self.cached_line_first_vline = .{};
        self.cached_line_vline_counts = .{};
        const virtual_allocator = self.virtual_lines_arena.allocator();

        if (self.wrap_mode == .none or self.wrap_width == null) {
            // No wrapping - create 1:1 mapping to real lines using single-pass API
            const Context = struct {
                view: *Self,
                virtual_allocator: Allocator,
                current_vline: ?VirtualLine = null,

                fn segment_callback(ctx_ptr: *anyopaque, line_idx: u32, chunk: *const TextChunk, _: u32) void {
                    _ = line_idx;
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    // Append chunk to current virtual line
                    if (ctx.current_vline) |*vline| {
                        vline.chunks.append(ctx.virtual_allocator, VirtualChunk{
                            .grapheme_start = 0,
                            .grapheme_count = chunk.width,
                            .width = chunk.width,
                            .chunk = chunk,
                        }) catch {};
                    }
                }

                fn line_end_callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    // Record first virtual line index for this logical line (1:1 mapping)
                    const first_vline_idx: u32 = @intCast(ctx.view.virtual_lines.items.len);
                    ctx.view.cached_line_first_vline.append(ctx.virtual_allocator, first_vline_idx) catch {};
                    ctx.view.cached_line_vline_counts.append(ctx.virtual_allocator, 1) catch {};

                    // If we have a pending vline from segments, finalize it
                    // Otherwise create empty vline
                    var vline = if (ctx.current_vline) |v| v else VirtualLine.init();
                    vline.width = line_info.width;
                    vline.char_offset = line_info.char_offset;
                    vline.source_line = line_info.line_idx;
                    vline.source_col_offset = 0;

                    ctx.view.virtual_lines.append(ctx.virtual_allocator, vline) catch {};
                    ctx.view.cached_line_starts.append(ctx.virtual_allocator, vline.char_offset) catch {};
                    ctx.view.cached_line_widths.append(ctx.virtual_allocator, vline.width) catch {};

                    // Reset for next line
                    ctx.current_vline = VirtualLine.init();
                }
            };

            var ctx = Context{
                .view = self,
                .virtual_allocator = virtual_allocator,
                .current_vline = VirtualLine.init(),
            };

            iter_mod.walkLinesAndSegments(&self.text_buffer.rope, &ctx, Context.segment_callback, Context.line_end_callback);
        } else {
            // Wrapping enabled
            const wrap_w = self.wrap_width.?;

            const WrapContext = struct {
                view: *Self,
                virtual_allocator: Allocator,
                wrap_w: u32,
                global_char_offset: u32 = 0,
                line_idx: u32 = 0,
                line_col_offset: u32 = 0,
                line_position: u32 = 0,
                current_vline: VirtualLine = VirtualLine.init(),
                chunk_idx_in_line: u32 = 0,
                current_line_first_vline_idx: u32 = 0,
                current_line_vline_count: u32 = 0,

                fn commitVirtualLine(wctx: *@This()) void {
                    wctx.current_vline.width = wctx.line_position;
                    wctx.current_vline.source_line = wctx.line_idx;
                    wctx.current_vline.source_col_offset = wctx.line_col_offset;
                    wctx.view.virtual_lines.append(wctx.virtual_allocator, wctx.current_vline) catch {};
                    wctx.view.cached_line_starts.append(wctx.virtual_allocator, wctx.current_vline.char_offset) catch {};
                    wctx.view.cached_line_widths.append(wctx.virtual_allocator, wctx.current_vline.width) catch {};

                    wctx.current_line_vline_count += 1;

                    wctx.line_col_offset += wctx.line_position;
                    wctx.current_vline = VirtualLine.init();
                    wctx.current_vline.char_offset = wctx.global_char_offset;
                    wctx.line_position = 0;
                }

                fn addVirtualChunk(wctx: *@This(), chunk: *const TextChunk, _: u32, start: u32, count: u32, width: u32) void {
                    wctx.current_vline.chunks.append(wctx.virtual_allocator, VirtualChunk{
                        .grapheme_start = start,
                        .grapheme_count = count,
                        .width = @intCast(width),
                        .chunk = chunk,
                    }) catch {};
                    wctx.global_char_offset += width;
                    wctx.line_position += width;
                }

                fn segment_callback(ctx_ptr: *anyopaque, line_idx: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void {
                    _ = line_idx;
                    const wctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    wctx.chunk_idx_in_line = chunk_idx_in_line;

                    if (wctx.view.wrap_mode == .word) {
                        // Word wrapping
                        var char_offset: u32 = 0;
                        while (char_offset < chunk.width) {
                            const remaining_width = if (wctx.line_position < wctx.wrap_w) wctx.wrap_w - wctx.line_position else 0;
                            const fit = wctx.view.calculateChunkFitWord(chunk, char_offset, remaining_width);

                            if (fit.char_count == 0) {
                                if (wctx.line_position > 0) {
                                    commitVirtualLine(wctx);
                                    continue;
                                }
                                if (char_offset < chunk.width) {
                                    const forced = @min(1, chunk.width - char_offset);
                                    addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, forced, forced);
                                    char_offset += forced;
                                    continue;
                                }
                                break;
                            }

                            addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, fit.char_count, fit.width);
                            char_offset += fit.char_count;

                            if (wctx.line_position >= wctx.wrap_w and char_offset < chunk.width) {
                                commitVirtualLine(wctx);
                            }
                        }
                    } else {
                        // Character wrapping
                        const chunk_bytes = chunk.getBytes(&wctx.view.text_buffer.mem_registry);
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
                                const force_result = utf8.findWrapPosByWidthSIMD16(remaining_bytes, 1, 8, is_ascii_only);
                                if (force_result.grapheme_count > 0) {
                                    addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, force_result.columns_used, force_result.columns_used);
                                    char_offset += force_result.columns_used;
                                    byte_offset += force_result.byte_offset;
                                } else {
                                    break;
                                }
                                continue;
                            }

                            const remaining_bytes = chunk_bytes[byte_offset..];
                            const wrap_result = utf8.findWrapPosByWidthSIMD16(
                                remaining_bytes,
                                remaining_width,
                                8,
                                is_ascii_only,
                            );

                            if (wrap_result.grapheme_count == 0) {
                                if (wctx.line_position > 0) {
                                    commitVirtualLine(wctx);
                                    continue;
                                }
                                const force_result = utf8.findWrapPosByWidthSIMD16(remaining_bytes, 1000, 8, is_ascii_only);
                                if (force_result.grapheme_count > 0) {
                                    addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, force_result.columns_used, force_result.columns_used);
                                    char_offset += force_result.columns_used;
                                    byte_offset += force_result.byte_offset;
                                    if (char_offset < chunk.width) {
                                        commitVirtualLine(wctx);
                                    }
                                }
                                break;
                            }

                            addVirtualChunk(wctx, chunk, chunk_idx_in_line, char_offset, wrap_result.columns_used, wrap_result.columns_used);
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

                    // Commit current virtual line if it has content or represents an empty line
                    if (wctx.current_vline.chunks.items.len > 0 or line_info.width == 0) {
                        wctx.current_vline.width = wctx.line_position;
                        wctx.current_vline.source_line = wctx.line_idx;
                        wctx.current_vline.source_col_offset = wctx.line_col_offset;
                        wctx.view.virtual_lines.append(wctx.virtual_allocator, wctx.current_vline) catch {};
                        wctx.view.cached_line_starts.append(wctx.virtual_allocator, wctx.current_vline.char_offset) catch {};
                        wctx.view.cached_line_widths.append(wctx.virtual_allocator, wctx.current_vline.width) catch {};
                        wctx.current_line_vline_count += 1;
                    }

                    // Record wrap info for this logical line
                    wctx.view.cached_line_first_vline.append(wctx.virtual_allocator, wctx.current_line_first_vline_idx) catch {};
                    wctx.view.cached_line_vline_counts.append(wctx.virtual_allocator, wctx.current_line_vline_count) catch {};

                    // Reset for next logical line
                    wctx.line_idx += 1;
                    wctx.line_col_offset = 0;
                    wctx.line_position = 0;
                    wctx.current_vline = VirtualLine.init();
                    wctx.current_vline.char_offset = wctx.global_char_offset;
                    wctx.chunk_idx_in_line = 0;
                    wctx.current_line_first_vline_idx = @intCast(wctx.view.virtual_lines.items.len);
                    wctx.current_line_vline_count = 0;
                }
            };

            var wrap_ctx = WrapContext{
                .view = self,
                .virtual_allocator = virtual_allocator,
                .wrap_w = wrap_w,
            };

            iter_mod.walkLinesAndSegments(&self.text_buffer.rope, &wrap_ctx, WrapContext.segment_callback, WrapContext.line_end_callback);
        }

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

            // Calculate max width for viewport lines
            var max_width: u32 = 0;
            for (viewport_widths) |w| {
                max_width = @max(max_width, w);
            }

            return LineInfo{
                .starts = viewport_starts,
                .widths = viewport_widths,
                .max_width = max_width,
            };
        }

        return LineInfo{
            .starts = self.cached_line_starts.items,
            .widths = self.cached_line_widths.items,
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

    /// Find the visual line index for a given logical (row, col) position
    pub fn findVisualLineIndex(self: *Self, logical_row: u32, logical_col: u32) ?u32 {
        self.updateVirtualLines();

        const vlines = self.virtual_lines.items;
        if (vlines.len == 0) return null;

        const wrap_info = self.getWrapInfo();

        // Check if logical_row is in bounds
        if (logical_row >= wrap_info.line_first_vline.len) return null;

        const first_vline_idx = wrap_info.line_first_vline[logical_row];
        const vline_count = wrap_info.line_vline_counts[logical_row];

        // If no virtual lines for this logical line, return null
        if (vline_count == 0) return null;

        // Search through virtual lines for this logical line
        var i: u32 = 0;
        while (i < vline_count) : (i += 1) {
            const vline_idx = first_vline_idx + i;
            if (vline_idx >= vlines.len) break;

            const vline = &vlines[vline_idx];
            const vline_start_col = vline.source_col_offset;
            const vline_end_col = vline_start_col + vline.width;

            // Check if logical_col falls within this virtual line
            const is_last_vline = (i == vline_count - 1);
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

        return null;
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

    /// Set local selection coordinates and calculate character positions
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

    /// Calculate character positions from local selection coordinates
    /// Local coordinates are viewport-relative (if viewport is set)
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
            const lineEnd = if (i < self.virtual_lines.items.len - 1)
                self.virtual_lines.items[i + 1].char_offset
            else
                lineStart + lineWidth;

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
                if (localEndX > 0) {
                    if (selectionStart == null) selectionStart = lineStart;
                    selectionEnd = lineStart + @as(u32, @intCast(localEndX));
                }
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
        const start = selection.start;
        const end = selection.end;

        var out_index: usize = 0;
        var char_offset: u32 = 0;
        const line_count = self.text_buffer.getLineCount();

        const Context = struct {
            view: *Self,
            out_buffer: []u8,
            out_index: *usize,
            char_offset: *u32,
            start: u32,
            end: u32,
            line_count: u32,
            line_had_selection: bool = false,

            fn segment_callback(ctx_ptr: *anyopaque, line_idx: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void {
                _ = line_idx;
                _ = chunk_idx_in_line;
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                const chunk_start_offset = ctx.char_offset.*;
                const chunk_end_offset = chunk_start_offset + chunk.width;

                // Skip chunk if it's entirely outside selection
                if (chunk_end_offset <= ctx.start or chunk_start_offset >= ctx.end) {
                    ctx.char_offset.* = chunk_end_offset;
                    return;
                }

                ctx.line_had_selection = true;

                const chunk_bytes = chunk.getBytes(&ctx.view.text_buffer.mem_registry);
                const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;

                // Calculate the column range within this chunk to include
                const local_start_col: u32 = if (ctx.start > chunk_start_offset) ctx.start - chunk_start_offset else 0;
                const local_end_col: u32 = @min(ctx.end - chunk_start_offset, chunk.width);

                // Find byte offsets corresponding to column positions
                var byte_start: u32 = 0;
                var byte_end: u32 = @intCast(chunk_bytes.len);

                if (local_start_col > 0) {
                    // For start: exclude graphemes that start before limit
                    const start_result = utf8.findPosByWidth(chunk_bytes, local_start_col, 8, is_ascii_only, false);
                    byte_start = start_result.byte_offset;
                }

                if (local_end_col < chunk.width) {
                    // For end: include graphemes that start before limit
                    const end_result = utf8.findPosByWidth(chunk_bytes, local_end_col, 8, is_ascii_only, true);
                    byte_end = end_result.byte_offset;
                }

                // Copy the selected byte range
                if (byte_start < byte_end and byte_start < chunk_bytes.len) {
                    const actual_end = @min(byte_end, @as(u32, @intCast(chunk_bytes.len)));
                    const selected_bytes = chunk_bytes[byte_start..actual_end];
                    const copy_len = @min(selected_bytes.len, ctx.out_buffer.len - ctx.out_index.*);

                    if (copy_len > 0) {
                        @memcpy(ctx.out_buffer[ctx.out_index.* .. ctx.out_index.* + copy_len], selected_bytes[0..copy_len]);
                        ctx.out_index.* += copy_len;
                    }
                }

                ctx.char_offset.* = chunk_end_offset;
            }

            fn line_end_callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                // Add newline between lines if we had selection and not at last line
                if (ctx.line_had_selection and line_info.line_idx < ctx.line_count - 1 and ctx.char_offset.* < ctx.end and ctx.out_index.* < ctx.out_buffer.len) {
                    ctx.out_buffer[ctx.out_index.*] = '\n';
                    ctx.out_index.* += 1;
                }

                // Reset flag for next line
                ctx.line_had_selection = false;
            }
        };

        var ctx = Context{
            .view = self,
            .out_buffer = out_buffer,
            .out_index = &out_index,
            .char_offset = &char_offset,
            .start = start,
            .end = end,
            .line_count = line_count,
        };

        iter_mod.walkLinesAndSegments(&self.text_buffer.rope, &ctx, Context.segment_callback, Context.line_end_callback);

        return out_index;
    }

    /// Get virtual line spans for highlighting
    pub fn getVirtualLineSpans(self: *const Self, vline_idx: usize) struct {
        spans: []const StyleSpan,
        source_line: usize,
        col_offset: u32,
    } {
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
};
