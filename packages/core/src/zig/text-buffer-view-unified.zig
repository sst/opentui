const std = @import("std");
const Allocator = std.mem.Allocator;
const unified_tb = @import("text-buffer-unified.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const tb = @import("text-buffer.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const UnifiedTextBuffer = unified_tb.UnifiedTextBuffer;
const LineIterator = iter_mod.LineIterator;
const SegmentIterator = iter_mod.SegmentIterator;
const RGBA = tb.RGBA;
const TextSelection = tb.TextSelection;
pub const WrapMode = tb.WrapMode;
const TextChunk = tb.TextChunk;

pub const TextBufferViewError = error{
    OutOfMemory,
};

/// A virtual chunk references a portion of a real TextChunk for text wrapping
pub const VirtualChunk = struct {
    source_chunk: usize,
    grapheme_start: u32,
    grapheme_count: u32,
    width: u16,
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

/// TextBufferView for UnifiedTextBuffer
pub const UnifiedTextBufferView = struct {
    const Self = @This();

    text_buffer: *UnifiedTextBuffer,
    view_id: u32,

    // View-specific state
    selection: ?TextSelection,
    local_selection: ?LocalSelection,

    // Wrapping state
    wrap_width: ?u32,
    wrap_mode: WrapMode,
    virtual_lines: std.ArrayListUnmanaged(VirtualLine),
    virtual_lines_dirty: bool,

    // Cached line info
    cached_line_starts: std.ArrayListUnmanaged(u32),
    cached_line_widths: std.ArrayListUnmanaged(u32),
    cached_max_width: u32,

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
            .wrap_width = null,
            .wrap_mode = .char,
            .virtual_lines = .{},
            .virtual_lines_dirty = true,
            .cached_line_starts = .{},
            .cached_line_widths = .{},
            .cached_max_width = 0,
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
        self.cached_max_width = 0;
        const virtual_allocator = self.virtual_lines_arena.allocator();

        if (self.wrap_width == null) {
            // No wrapping - create 1:1 mapping to real lines using single-pass API
            const Context = struct {
                view: *Self,
                virtual_allocator: Allocator,
                current_vline: ?VirtualLine = null,

                fn segment_callback(ctx_ptr: *anyopaque, line_idx: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void {
                    _ = line_idx;
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    // Append chunk to current virtual line
                    if (ctx.current_vline) |*vline| {
                        vline.chunks.append(ctx.virtual_allocator, VirtualChunk{
                            .source_chunk = chunk_idx_in_line,
                            .grapheme_start = 0,
                            .grapheme_count = chunk.width,
                            .width = chunk.width,
                        }) catch {};
                    }
                }

                fn line_end_callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

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
                    ctx.view.cached_max_width = @max(ctx.view.cached_max_width, vline.width);

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

                fn commitVirtualLine(wctx: *@This()) void {
                    wctx.current_vline.width = wctx.line_position;
                    wctx.current_vline.source_line = wctx.line_idx;
                    wctx.current_vline.source_col_offset = wctx.line_col_offset;
                    wctx.view.virtual_lines.append(wctx.virtual_allocator, wctx.current_vline) catch {};
                    wctx.view.cached_line_starts.append(wctx.virtual_allocator, wctx.current_vline.char_offset) catch {};
                    wctx.view.cached_line_widths.append(wctx.virtual_allocator, wctx.current_vline.width) catch {};
                    wctx.view.cached_max_width = @max(wctx.view.cached_max_width, wctx.current_vline.width);

                    wctx.line_col_offset += wctx.line_position;
                    wctx.current_vline = VirtualLine.init();
                    wctx.current_vline.char_offset = wctx.global_char_offset;
                    wctx.line_position = 0;
                }

                fn addVirtualChunk(wctx: *@This(), chunk_idx: u32, start: u32, count: u32, width: u32) void {
                    wctx.current_vline.chunks.append(wctx.virtual_allocator, VirtualChunk{
                        .source_chunk = chunk_idx,
                        .grapheme_start = start,
                        .grapheme_count = count,
                        .width = @intCast(width),
                    }) catch {};
                    wctx.global_char_offset += count;
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
                                    addVirtualChunk(wctx, chunk_idx_in_line, char_offset, forced, forced);
                                    char_offset += forced;
                                    continue;
                                }
                                break;
                            }

                            addVirtualChunk(wctx, chunk_idx_in_line, char_offset, fit.char_count, fit.width);
                            char_offset += fit.char_count;

                            if (wctx.line_position >= wctx.wrap_w and char_offset < chunk.width) {
                                commitVirtualLine(wctx);
                            }
                        }
                    } else {
                        // Character wrapping
                        const chunk_bytes = chunk.getBytes(&wctx.view.text_buffer.mem_registry);
                        const is_ascii_only = (chunk.flags & tb.TextChunk.Flags.ASCII_ONLY) != 0;
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
                                    addVirtualChunk(wctx, chunk_idx_in_line, char_offset, force_result.grapheme_count, force_result.columns_used);
                                    char_offset += force_result.grapheme_count;
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
                                    addVirtualChunk(wctx, chunk_idx_in_line, char_offset, force_result.grapheme_count, force_result.columns_used);
                                    char_offset += force_result.grapheme_count;
                                    byte_offset += force_result.byte_offset;
                                    if (char_offset < chunk.width) {
                                        commitVirtualLine(wctx);
                                    }
                                }
                                break;
                            }

                            addVirtualChunk(wctx, chunk_idx_in_line, char_offset, wrap_result.grapheme_count, wrap_result.columns_used);
                            char_offset += wrap_result.grapheme_count;
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
                        wctx.view.cached_max_width = @max(wctx.view.cached_max_width, wctx.current_vline.width);
                    }

                    // Reset for next logical line
                    wctx.line_idx += 1;
                    wctx.line_col_offset = 0;
                    wctx.line_position = 0;
                    wctx.current_vline = VirtualLine.init();
                    wctx.current_vline.char_offset = wctx.global_char_offset;
                    wctx.chunk_idx_in_line = 0;
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
        return self.virtual_lines.items;
    }

    pub fn getCachedLineInfo(self: *Self) struct {
        starts: []const u32,
        widths: []const u32,
        max_width: u32,
    } {
        self.updateVirtualLines();

        return .{
            .starts = self.cached_line_starts.items,
            .widths = self.cached_line_widths.items,
            .max_width = self.cached_max_width,
        };
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
};
