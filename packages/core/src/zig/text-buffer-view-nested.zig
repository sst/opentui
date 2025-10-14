const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer-nested.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");
const uucode = @import("uucode");

const RGBA = tb.RGBA;
const TextSelection = tb.TextSelection;
const WrapMode = tb.WrapMode;
const StyleSpan = tb.StyleSpan;
const GraphemeInfo = tb.GraphemeInfo;

pub const TextBufferViewError = error{
    OutOfMemory,
};

/// A virtual chunk references a portion of a real TextChunk for text wrapping
pub const VirtualChunk = struct {
    source_chunk: usize,
    grapheme_start: u32, // Index into cached graphemes
    grapheme_count: u32, // Number of grapheme clusters
    width: u16,
};

/// A virtual line represents a display line after text wrapping
pub const VirtualLine = struct {
    chunks: std.ArrayListUnmanaged(VirtualChunk),
    width: u32,
    char_offset: u32,
    source_line: usize, // Which real line this virtual line comes from
    source_col_offset: u32, // Column offset within the source line (0 for first vline, 10 for second if wrapped at 10, etc.)

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

/// TextBufferView provides a view over a TextBuffer with wrapping and selection state
/// Generic over LineStorage and ChunkStorage types (matches TextBuffer's generic parameters)
pub fn TextBufferView(comptime LineStorage: type, comptime ChunkStorage: type) type {
    const TextBufferType = tb.TextBuffer(LineStorage, ChunkStorage);
    const Line = tb.TextLine(ChunkStorage);

    return struct {
        const Self = @This();

        text_buffer: *TextBufferType, // Reference to the underlying buffer (not owned)
        view_id: u32, // Registration ID in the text buffer

        // View-specific state
        selection: ?TextSelection,
        local_selection: ?LocalSelection,

        // Wrapping state
        wrap_width: ?u32,
        wrap_mode: WrapMode,
        virtual_lines: std.ArrayListUnmanaged(VirtualLine),
        virtual_lines_dirty: bool,

        // Cached line info (view-specific because it depends on wrapping)
        cached_line_starts: std.ArrayListUnmanaged(u32),
        cached_line_widths: std.ArrayListUnmanaged(u32),
        cached_max_width: u32,

        // Memory management
        global_allocator: Allocator,
        virtual_lines_arena: *std.heap.ArenaAllocator,

        pub fn init(global_allocator: Allocator, text_buffer: *TextBufferType) TextBufferViewError!*Self {
            const self = global_allocator.create(Self) catch return TextBufferViewError.OutOfMemory;
            errdefer global_allocator.destroy(self);

            const virtual_lines_internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferViewError.OutOfMemory;
            errdefer global_allocator.destroy(virtual_lines_internal_arena);
            virtual_lines_internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

            const virtual_lines_allocator = virtual_lines_internal_arena.allocator();

            var virtual_lines: std.ArrayListUnmanaged(VirtualLine) = .{};
            errdefer {
                for (virtual_lines.items) |*vline| {
                    vline.deinit(virtual_lines_allocator);
                }
                virtual_lines.deinit(virtual_lines_allocator);
            }

            var cached_line_starts: std.ArrayListUnmanaged(u32) = .{};
            errdefer cached_line_starts.deinit(virtual_lines_allocator);

            var cached_line_widths: std.ArrayListUnmanaged(u32) = .{};
            errdefer cached_line_widths.deinit(virtual_lines_allocator);

            // Register this view with the text buffer
            const view_id = text_buffer.registerView() catch return TextBufferViewError.OutOfMemory;

            self.* = .{
                .text_buffer = text_buffer,
                .view_id = view_id,
                .selection = null,
                .local_selection = null,
                .wrap_width = null,
                .wrap_mode = .char,
                .virtual_lines = virtual_lines,
                .virtual_lines_dirty = true,
                .cached_line_starts = cached_line_starts,
                .cached_line_widths = cached_line_widths,
                .cached_max_width = 0,
                .global_allocator = global_allocator,
                .virtual_lines_arena = virtual_lines_internal_arena,
            };

            return self;
        }

        pub fn deinit(self: *Self) void {
            // Unregister from the text buffer
            self.text_buffer.unregisterView(self.view_id);

            self.virtual_lines_arena.deinit();
            self.global_allocator.destroy(self.virtual_lines_arena);
            self.global_allocator.destroy(self);
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

        /// Set the wrap width for text wrapping. null means no wrapping.
        pub fn setWrapWidth(self: *Self, width: ?u32) void {
            if (self.wrap_width != width) {
                self.wrap_width = width;
                self.virtual_lines_dirty = true;
            }
        }

        /// Set the wrap mode for text wrapping.
        pub fn setWrapMode(self: *Self, mode: WrapMode) void {
            if (self.wrap_mode != mode) {
                self.wrap_mode = mode;
                self.virtual_lines_dirty = true;
            }
        }

        /// Get grapheme info for a chunk (lazily computed on first access)
        /// Returns the grapheme slice from the chunk
        pub fn getOrCreateChunkCache(self: *Self, line_idx: usize, chunk_idx: usize) TextBufferViewError![]const GraphemeInfo {
            const line = self.text_buffer.getLine(@intCast(line_idx)) orelse return TextBufferViewError.OutOfMemory;
            const chunk = line.chunks.get(@intCast(chunk_idx)) orelse return TextBufferViewError.OutOfMemory;
            return chunk.getGraphemes(
                &self.text_buffer.mem_registry,
                self.text_buffer.allocator,
                &self.text_buffer.graphemes_data,
                self.text_buffer.width_method,
                &self.text_buffer.display_width,
            ) catch return TextBufferViewError.OutOfMemory;
        }

        fn calculateChunkFitWord(self: *const Self, chunk: *const tb.TextChunk, char_offset_in_chunk: u32, max_width: u32) tb.ChunkFitResult {
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

        /// Update virtual lines based on current wrap width
        pub fn updateVirtualLines(self: *Self) void {
            // Check both local and buffer dirty flags
            const buffer_dirty = self.text_buffer.isViewDirty(self.view_id);
            if (!self.virtual_lines_dirty and !buffer_dirty) return;

            _ = self.virtual_lines_arena.reset(.free_all);
            self.virtual_lines = .{};
            self.cached_line_starts = .{};
            self.cached_line_widths = .{};
            self.cached_max_width = 0;
            const virtual_allocator = self.virtual_lines_arena.allocator();

            var global_char_offset: u32 = 0;

            if (self.wrap_width == null) {
                // No wrapping - create 1:1 mapping to real lines
                const NoWrapContext = struct {
                    view: *Self,
                    virtual_allocator: Allocator,
                    global_char_offset: *u32,

                    fn lineWalker(ctx_ptr: *anyopaque, line: *const Line, line_idx: u32) LineStorage.Node.WalkerResult {
                        const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                        var vline = VirtualLine.init();
                        vline.width = line.width;
                        vline.char_offset = ctx.global_char_offset.*;
                        vline.source_line = line_idx;
                        vline.source_col_offset = 0;

                        // Walk chunks to create virtual chunks
                        const ChunkContext = struct {
                            vline: *VirtualLine,
                            virtual_allocator: Allocator,
                            line_idx: u32,

                            fn chunkWalker(chunk_ctx_ptr: *anyopaque, chunk: *const tb.TextChunk, chunk_idx: u32) ChunkStorage.Node.WalkerResult {
                                const chunk_ctx = @as(*@This(), @ptrCast(@alignCast(chunk_ctx_ptr)));
                                chunk_ctx.vline.chunks.append(chunk_ctx.virtual_allocator, VirtualChunk{
                                    .source_chunk = chunk_idx,
                                    .grapheme_start = 0,
                                    .grapheme_count = chunk.width,
                                    .width = chunk.width,
                                }) catch {};
                                return .{};
                            }
                        };

                        var chunk_ctx = ChunkContext{ .vline = &vline, .virtual_allocator = ctx.virtual_allocator, .line_idx = line_idx };
                        line.chunks.walk(&chunk_ctx, ChunkContext.chunkWalker) catch {};

                        ctx.view.virtual_lines.append(ctx.virtual_allocator, vline) catch {};
                        ctx.view.cached_line_starts.append(ctx.virtual_allocator, vline.char_offset) catch {};
                        ctx.view.cached_line_widths.append(ctx.virtual_allocator, vline.width) catch {};
                        ctx.view.cached_max_width = @max(ctx.view.cached_max_width, vline.width);

                        ctx.global_char_offset.* += line.width;
                        return .{};
                    }
                };

                var no_wrap_ctx = NoWrapContext{ .view = self, .virtual_allocator = virtual_allocator, .global_char_offset = &global_char_offset };
                self.text_buffer.walkLines(&no_wrap_ctx, NoWrapContext.lineWalker) catch {};
            } else {
                // Wrap lines at wrap_width
                const wrap_w = self.wrap_width.?;

                const WrapContext = struct {
                    view: *Self,
                    virtual_allocator: Allocator,
                    wrap_w: u32,
                    global_char_offset: *u32,

                    fn lineWalker(ctx_ptr: *anyopaque, line: *const Line, line_idx: u32) LineStorage.Node.WalkerResult {
                        const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                        var line_position: u32 = 0;
                        var line_col_offset: u32 = 0;
                        var current_vline = VirtualLine.init();
                        current_vline.char_offset = ctx.global_char_offset.*;
                        current_vline.source_line = line_idx;
                        current_vline.source_col_offset = 0;

                        const ChunkContext = struct {
                            view: *Self,
                            virtual_allocator: Allocator,
                            wrap_w: u32,
                            global_char_offset: *u32,
                            line_idx: u32,
                            line_position: *u32,
                            line_col_offset: *u32,
                            current_vline: *VirtualLine,
                            line: *const Line,

                            fn commitVirtualLine(chunk_ctx: *@This()) void {
                                chunk_ctx.current_vline.width = chunk_ctx.line_position.*;
                                chunk_ctx.view.virtual_lines.append(chunk_ctx.virtual_allocator, chunk_ctx.current_vline.*) catch {};
                                chunk_ctx.view.cached_line_starts.append(chunk_ctx.virtual_allocator, chunk_ctx.current_vline.char_offset) catch {};
                                chunk_ctx.view.cached_line_widths.append(chunk_ctx.virtual_allocator, chunk_ctx.current_vline.width) catch {};
                                chunk_ctx.view.cached_max_width = @max(chunk_ctx.view.cached_max_width, chunk_ctx.current_vline.width);

                                chunk_ctx.line_col_offset.* += chunk_ctx.line_position.*;
                                chunk_ctx.current_vline.* = VirtualLine.init();
                                chunk_ctx.current_vline.char_offset = chunk_ctx.global_char_offset.*;
                                chunk_ctx.current_vline.source_line = chunk_ctx.line_idx;
                                chunk_ctx.current_vline.source_col_offset = chunk_ctx.line_col_offset.*;
                                chunk_ctx.line_position.* = 0;
                            }

                            fn addVirtualChunk(chunk_ctx: *@This(), chunk_idx: u32, start: u32, count: u32, width: u32) void {
                                chunk_ctx.current_vline.chunks.append(chunk_ctx.virtual_allocator, VirtualChunk{
                                    .source_chunk = chunk_idx,
                                    .grapheme_start = start,
                                    .grapheme_count = count,
                                    .width = @intCast(width),
                                }) catch {};
                                chunk_ctx.global_char_offset.* += count;
                                chunk_ctx.line_position.* += width;
                            }

                            fn chunkWalker(chunk_ctx_ptr: *anyopaque, chunk: *const tb.TextChunk, chunk_idx: u32) ChunkStorage.Node.WalkerResult {
                                const chunk_ctx = @as(*@This(), @ptrCast(@alignCast(chunk_ctx_ptr)));

                                if (chunk_ctx.view.wrap_mode == .word) {
                                    var char_offset: u32 = 0;
                                    while (char_offset < chunk.width) {
                                        const remaining_width = if (chunk_ctx.line_position.* < chunk_ctx.wrap_w) chunk_ctx.wrap_w - chunk_ctx.line_position.* else 0;
                                        const fit = chunk_ctx.view.calculateChunkFitWord(chunk, char_offset, remaining_width);

                                        if (fit.char_count == 0) {
                                            if (chunk_ctx.line_position.* > 0) {
                                                commitVirtualLine(chunk_ctx);
                                                continue;
                                            }
                                            if (char_offset < chunk.width) {
                                                const forced = @min(1, chunk.width - char_offset);
                                                addVirtualChunk(chunk_ctx, chunk_idx, char_offset, forced, forced);
                                                char_offset += forced;
                                                continue;
                                            }
                                            break;
                                        }

                                        addVirtualChunk(chunk_ctx, chunk_idx, char_offset, fit.char_count, fit.width);
                                        char_offset += fit.char_count;

                                        if (chunk_ctx.line_position.* >= chunk_ctx.wrap_w and char_offset < chunk.width) {
                                            commitVirtualLine(chunk_ctx);
                                        }
                                    }
                                    return .{};
                                }

                                const chunk_bytes = chunk.getBytes(&chunk_ctx.view.text_buffer.mem_registry);
                                const is_ascii_only = (chunk.flags & tb.TextChunk.Flags.ASCII_ONLY) != 0;
                                var byte_offset: usize = 0;
                                var char_offset: u32 = 0;

                                while (char_offset < chunk.width) {
                                    const remaining_width = if (chunk_ctx.line_position.* < chunk_ctx.wrap_w) chunk_ctx.wrap_w - chunk_ctx.line_position.* else 0;

                                    if (remaining_width == 0) {
                                        if (chunk_ctx.line_position.* > 0) {
                                            commitVirtualLine(chunk_ctx);
                                            continue;
                                        }
                                        const remaining_bytes = chunk_bytes[byte_offset..];
                                        const force_result = utf8.findWrapPosByWidthSIMD16(remaining_bytes, 1, 8, is_ascii_only);
                                        if (force_result.grapheme_count > 0) {
                                            addVirtualChunk(chunk_ctx, chunk_idx, char_offset, force_result.grapheme_count, force_result.columns_used);
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
                                        if (chunk_ctx.line_position.* > 0) {
                                            commitVirtualLine(chunk_ctx);
                                            continue;
                                        }
                                        const force_result = utf8.findWrapPosByWidthSIMD16(remaining_bytes, 1000, 8, is_ascii_only);
                                        if (force_result.grapheme_count > 0) {
                                            addVirtualChunk(chunk_ctx, chunk_idx, char_offset, force_result.grapheme_count, force_result.columns_used);
                                            char_offset += force_result.grapheme_count;
                                            byte_offset += force_result.byte_offset;
                                            if (char_offset < chunk.width) {
                                                commitVirtualLine(chunk_ctx);
                                            }
                                        }
                                        break;
                                    }

                                    addVirtualChunk(chunk_ctx, chunk_idx, char_offset, wrap_result.grapheme_count, wrap_result.columns_used);
                                    char_offset += wrap_result.grapheme_count;
                                    byte_offset += wrap_result.byte_offset;

                                    if (chunk_ctx.line_position.* >= chunk_ctx.wrap_w and char_offset < chunk.width) {
                                        commitVirtualLine(chunk_ctx);
                                    }
                                }
                                return .{};
                            }
                        };

                        var chunk_ctx = ChunkContext{
                            .view = ctx.view,
                            .virtual_allocator = ctx.virtual_allocator,
                            .wrap_w = ctx.wrap_w,
                            .global_char_offset = ctx.global_char_offset,
                            .line_idx = line_idx,
                            .line_position = &line_position,
                            .line_col_offset = &line_col_offset,
                            .current_vline = &current_vline,
                            .line = line,
                        };
                        line.chunks.walk(&chunk_ctx, ChunkContext.chunkWalker) catch {};

                        // Append the last virtual line if it has content or represents an empty line
                        if (current_vline.chunks.items.len > 0 or line.width == 0) {
                            current_vline.width = line_position;
                            ctx.view.virtual_lines.append(ctx.virtual_allocator, current_vline) catch {};
                            ctx.view.cached_line_starts.append(ctx.virtual_allocator, current_vline.char_offset) catch {};
                            ctx.view.cached_line_widths.append(ctx.virtual_allocator, current_vline.width) catch {};
                            ctx.view.cached_max_width = @max(ctx.view.cached_max_width, current_vline.width);
                        }

                        return .{};
                    }
                };

                var wrap_ctx = WrapContext{ .view = self, .virtual_allocator = virtual_allocator, .wrap_w = wrap_w, .global_char_offset = &global_char_offset };
                self.text_buffer.walkLines(&wrap_ctx, WrapContext.lineWalker) catch {};
            }

            // Clear both dirty flags
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

        /// Get cached line info (line starts and widths)
        /// Returns the maximum line width
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

        /// Get style spans for a virtual line, adjusted for the virtual line's column offset
        /// This is used when rendering wrapped text to correctly apply highlights
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

        /// Format: [start:u32][end:u32] packed into u64
        /// If no selection, returns 0xFFFFFFFF_FFFFFFFF (all bits set)
        pub fn packSelectionInfo(self: *const Self) u64 {
            if (self.selection) |sel| {
                return (@as(u64, sel.start) << 32) | @as(u64, sel.end);
            } else {
                return 0xFFFF_FFFF_FFFF_FFFF;
            }
        }

        /// Set local selection coordinates and automatically calculate character positions
        /// Returns true if the selection changed, false otherwise
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
                    if (old_sel.start != new_selection.start or
                        old_sel.end != new_selection.end)
                    {
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
        /// Returns null if no valid selection
        fn calculateMultiLineSelection(self: *Self) ?struct { start: u32, end: u32 } {
            const local_sel = self.local_selection orelse return null;
            if (!local_sel.isActive) return null;

            self.updateVirtualLines();

            var selectionStart: ?u32 = null;
            var selectionEnd: ?u32 = null;

            const startY = @min(local_sel.anchorY, local_sel.focusY);
            const endY = @max(local_sel.anchorY, local_sel.focusY);

            // Determine anchor and focus points based on selection direction
            var selStartX: i32 = undefined;
            var selEndX: i32 = undefined;

            if (local_sel.anchorY < local_sel.focusY or
                (local_sel.anchorY == local_sel.focusY and local_sel.anchorX <= local_sel.focusX))
            {
                selStartX = local_sel.anchorX;
                selEndX = local_sel.focusX;
            } else {
                selStartX = local_sel.focusX;
                selEndX = local_sel.anchorX;
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
                    // Entire line is selected
                    if (selectionStart == null) selectionStart = lineStart;
                    selectionEnd = lineEnd;
                } else if (lineY == startY and lineY == endY) {
                    // Selection starts and ends on this line
                    const localStartX = @max(0, @min(selStartX, @as(i32, @intCast(lineWidth))));
                    const localEndX = @max(0, @min(selEndX, @as(i32, @intCast(lineWidth))));
                    if (localStartX != localEndX) {
                        selectionStart = lineStart + @as(u32, @intCast(localStartX));
                        selectionEnd = lineStart + @as(u32, @intCast(localEndX));
                    }
                } else if (lineY == startY) {
                    // Selection starts on this line
                    const localStartX = @max(0, @min(selStartX, @as(i32, @intCast(lineWidth))));
                    if (localStartX < lineWidth) {
                        selectionStart = lineStart + @as(u32, @intCast(localStartX));
                        selectionEnd = lineEnd;
                    }
                } else if (lineY == endY) {
                    // Selection ends on this line
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

        /// Extract selected text as UTF-8 bytes from the char buffer into provided output buffer
        /// Returns the number of bytes written to the output buffer
        pub fn getSelectedTextIntoBuffer(self: *Self, out_buffer: []u8) usize {
            const selection = self.selection orelse return 0;
            const start = selection.start;
            const end = selection.end;

            const SelectionContext = struct {
                view: *Self,
                out_buffer: []u8,
                out_index: *usize,
                count: *u32,
                start: u32,
                end: u32,
                line_count: u32,

                fn lineWalker(ctx_ptr: *anyopaque, line: *const Line, line_idx: u32) LineStorage.Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    var line_had_selection = false;

                    const ChunkContext = struct {
                        view: *Self,
                        out_buffer: []u8,
                        out_index: *usize,
                        count: *u32,
                        start: u32,
                        end: u32,
                        line_idx: u32,
                        line_had_selection: *bool,

                        fn chunkWalker(chunk_ctx_ptr: *anyopaque, chunk: *const tb.TextChunk, chunk_idx: u32) ChunkStorage.Node.WalkerResult {
                            const chunk_ctx = @as(*@This(), @ptrCast(@alignCast(chunk_ctx_ptr)));
                            const graphemes_cache = chunk_ctx.view.getOrCreateChunkCache(chunk_ctx.line_idx, chunk_idx) catch return .{};
                            const chunk_bytes = chunk.getBytes(&chunk_ctx.view.text_buffer.mem_registry);

                            for (graphemes_cache) |g| {
                                if (chunk_ctx.count.* >= chunk_ctx.end) return .{ .keep_walking = false };

                                const grapheme_start_count = chunk_ctx.count.*;
                                const grapheme_end_count = chunk_ctx.count.* + g.width;

                                if (grapheme_end_count > chunk_ctx.start and grapheme_start_count < chunk_ctx.end) {
                                    chunk_ctx.line_had_selection.* = true;

                                    const grapheme_bytes = chunk_bytes[g.byte_offset .. g.byte_offset + g.byte_len];
                                    const copy_len = @min(grapheme_bytes.len, chunk_ctx.out_buffer.len - chunk_ctx.out_index.*);

                                    if (copy_len > 0) {
                                        @memcpy(chunk_ctx.out_buffer[chunk_ctx.out_index.* .. chunk_ctx.out_index.* + copy_len], grapheme_bytes[0..copy_len]);
                                        chunk_ctx.out_index.* += copy_len;
                                    }
                                }

                                chunk_ctx.count.* += g.width;
                            }
                            return .{};
                        }
                    };

                    var chunk_ctx = ChunkContext{
                        .view = ctx.view,
                        .out_buffer = ctx.out_buffer,
                        .out_index = ctx.out_index,
                        .count = ctx.count,
                        .start = ctx.start,
                        .end = ctx.end,
                        .line_idx = line_idx,
                        .line_had_selection = &line_had_selection,
                    };
                    line.chunks.walk(&chunk_ctx, ChunkContext.chunkWalker) catch {};

                    // Add newline between lines if we're still in the selection range and not at the last line
                    if (line_had_selection and line_idx < ctx.line_count - 1 and ctx.count.* < ctx.end and ctx.out_index.* < ctx.out_buffer.len) {
                        ctx.out_buffer[ctx.out_index.*] = '\n';
                        ctx.out_index.* += 1;
                    }

                    return .{};
                }
            };

            var out_index: usize = 0;
            var count: u32 = 0;
            var sel_ctx = SelectionContext{
                .view = self,
                .out_buffer = out_buffer,
                .out_index = &out_index,
                .count = &count,
                .start = start,
                .end = end,
                .line_count = self.text_buffer.lineCount(),
            };
            self.text_buffer.walkLines(&sel_ctx, SelectionContext.lineWalker) catch {};

            return out_index;
        }

        /// Extract all text as UTF-8 bytes from the char buffer into provided output buffer
        /// Delegates to the underlying TextBuffer
        /// Returns the number of bytes written to the output buffer
        pub fn getPlainTextIntoBuffer(self: *const Self, out_buffer: []u8) usize {
            return self.text_buffer.getPlainTextIntoBuffer(out_buffer);
        }

        /// Get the total bytes allocated by the virtual lines arena allocator
        pub fn getArenaAllocatedBytes(self: *const Self) usize {
            return self.virtual_lines_arena.queryCapacity();
        }
    };
}

// Type aliases for different buffer implementations
pub const TextBufferViewArray = TextBufferView(tb.ArrayRope(tb.TextLine(tb.ArrayRope(tb.TextChunk))), tb.ArrayRope(tb.TextChunk));
pub const TextBufferViewRope = TextBufferView(tb.Rope(tb.TextLine(tb.Rope(tb.TextChunk))), tb.Rope(tb.TextChunk));
