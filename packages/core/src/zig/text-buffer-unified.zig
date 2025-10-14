const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const seg_mod = @import("text-buffer-segment.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const ss = @import("syntax-style.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;
const LineInfo = iter_mod.LineInfo;
const SegmentIterator = iter_mod.SegmentIterator;
const TextChunk = tb.TextChunk;
const MemRegistry = tb.MemRegistry;
const RGBA = tb.RGBA;
const TextSelection = tb.TextSelection;
const SyntaxStyle = ss.SyntaxStyle;
const TextBufferError = tb.TextBufferError;
const Highlight = tb.Highlight;
const StyleSpan = tb.StyleSpan;

/// UnifiedTextBuffer - TextBuffer implementation using a single unified rope
/// instead of nested rope structures (lines → chunks)
pub const UnifiedTextBuffer = struct {
    const Self = @This();

    mem_registry: MemRegistry,
    char_count: u32,
    default_fg: ?RGBA,
    default_bg: ?RGBA,
    default_attributes: ?u8,

    allocator: Allocator,
    global_allocator: Allocator,
    arena: *std.heap.ArenaAllocator,

    rope: UnifiedRope, // Single unified rope containing text segments and breaks
    syntax_style: ?*const SyntaxStyle,

    // Cached line info (built once per setText, invalidated on edits)
    line_info_cache: std.ArrayListUnmanaged(iter_mod.LineInfo),
    line_info_dirty: bool,

    pool: *gp.GraphemePool,
    graphemes_data: Graphemes,
    display_width: DisplayWidth,
    width_method: gwidth.WidthMethod,

    // View registration system
    view_dirty_flags: std.ArrayListUnmanaged(bool),
    next_view_id: u32,
    free_view_ids: std.ArrayListUnmanaged(u32),

    // Per-line highlight cache (invalidated on edits)
    // Maps line_idx to highlights for that line
    line_highlights: std.ArrayListUnmanaged(std.ArrayListUnmanaged(Highlight)),
    line_spans: std.ArrayListUnmanaged(std.ArrayListUnmanaged(StyleSpan)),

    pub fn init(
        global_allocator: Allocator,
        pool: *gp.GraphemePool,
        width_method: gwidth.WidthMethod,
        graphemes_data: *Graphemes,
        display_width: *DisplayWidth,
    ) TextBufferError!*Self {
        const self = global_allocator.create(Self) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(internal_arena);
        internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const internal_allocator = internal_arena.allocator();

        const graph = graphemes_data.*;
        const dw = display_width.*;

        const rope = UnifiedRope.init(internal_allocator) catch return TextBufferError.OutOfMemory;

        var view_dirty_flags: std.ArrayListUnmanaged(bool) = .{};
        errdefer view_dirty_flags.deinit(global_allocator);

        var free_view_ids: std.ArrayListUnmanaged(u32) = .{};
        errdefer free_view_ids.deinit(global_allocator);

        var mem_registry = MemRegistry.init(global_allocator);
        errdefer mem_registry.deinit();

        self.* = .{
            .mem_registry = mem_registry,
            .char_count = 0,
            .default_fg = null,
            .default_bg = null,
            .default_attributes = null,
            .allocator = internal_allocator,
            .global_allocator = global_allocator,
            .arena = internal_arena,
            .rope = rope,
            .syntax_style = null,
            .pool = pool,
            .graphemes_data = graph,
            .display_width = dw,
            .width_method = width_method,
            .view_dirty_flags = view_dirty_flags,
            .next_view_id = 0,
            .free_view_ids = free_view_ids,
            .line_highlights = .{},
            .line_spans = .{},
            .line_info_cache = .{},
            .line_info_dirty = false,
        };

        return self;
    }

    pub fn deinit(self: *Self) void {
        self.view_dirty_flags.deinit(self.global_allocator);
        self.free_view_ids.deinit(self.global_allocator);

        // Free highlight/span caches
        for (self.line_highlights.items) |*hl_list| {
            hl_list.deinit(self.allocator);
        }
        self.line_highlights.deinit(self.allocator);

        for (self.line_spans.items) |*span_list| {
            span_list.deinit(self.allocator);
        }
        self.line_spans.deinit(self.allocator);

        self.mem_registry.deinit();
        self.arena.deinit();
        self.global_allocator.destroy(self.arena);
        self.global_allocator.destroy(self);
    }

    // View registration (same as original)
    pub fn registerView(self: *Self) TextBufferError!u32 {
        if (self.free_view_ids.items.len > 0) {
            const id = self.free_view_ids.items[self.free_view_ids.items.len - 1];
            _ = self.free_view_ids.pop();
            self.view_dirty_flags.items[id] = true;
            return id;
        }

        const id = self.next_view_id;
        self.next_view_id += 1;
        try self.view_dirty_flags.append(self.global_allocator, true);
        return id;
    }

    pub fn unregisterView(self: *Self, view_id: u32) void {
        if (view_id < self.view_dirty_flags.items.len) {
            self.free_view_ids.append(self.global_allocator, view_id) catch {};
        }
    }

    pub fn isViewDirty(self: *const Self, view_id: u32) bool {
        if (view_id < self.view_dirty_flags.items.len) {
            return self.view_dirty_flags.items[view_id];
        }
        return false;
    }

    pub fn clearViewDirty(self: *Self, view_id: u32) void {
        if (view_id < self.view_dirty_flags.items.len) {
            self.view_dirty_flags.items[view_id] = false;
        }
    }

    fn markAllViewsDirty(self: *Self) void {
        for (self.view_dirty_flags.items) |*flag| {
            flag.* = true;
        }
    }

    pub fn markViewsDirty(self: *Self) void {
        self.markAllViewsDirty();
    }

    // Basic queries using unified rope
    pub fn getLength(self: *const Self) u32 {
        return self.char_count;
    }

    pub fn getByteSize(self: *const Self) u32 {
        var total: u32 = 0;
        var seg_idx: u32 = 0;
        const seg_count = self.rope.count();

        while (seg_idx < seg_count) : (seg_idx += 1) {
            if (self.rope.get(seg_idx)) |seg| {
                if (seg.asText()) |chunk| {
                    total += chunk.byte_end - chunk.byte_start;
                }
                // Breaks don't contribute bytes (we add \n when extracting text)
            }
        }

        // Add newlines between lines (line_count - 1)
        const line_count = iter_mod.getLineCount(&self.rope);
        if (line_count > 0) {
            total += line_count - 1; // newlines
        }

        return total;
    }

    pub fn measureText(self: *const Self, text: []const u8) u32 {
        return gwidth.gwidth(text, self.width_method, &self.display_width);
    }

    pub fn reset(self: *Self) void {
        _ = self.arena.reset(if (self.arena.queryCapacity() > 0) .retain_capacity else .free_all);

        self.mem_registry.clear();
        self.char_count = 0;

        self.rope = UnifiedRope.init(self.allocator) catch return;

        // Clear highlight caches
        for (self.line_highlights.items) |*hl_list| {
            hl_list.deinit(self.allocator);
        }
        self.line_highlights.clearRetainingCapacity();

        for (self.line_spans.items) |*span_list| {
            span_list.deinit(self.allocator);
        }
        self.line_spans.clearRetainingCapacity();

        self.markAllViewsDirty();
    }

    // Default colors/attributes
    pub fn setDefaultFg(self: *Self, fg: ?RGBA) void {
        self.default_fg = fg;
    }

    pub fn setDefaultBg(self: *Self, bg: ?RGBA) void {
        self.default_bg = bg;
    }

    pub fn setDefaultAttributes(self: *Self, attributes: ?u8) void {
        self.default_attributes = attributes;
    }

    pub fn resetDefaults(self: *Self) void {
        self.default_fg = null;
        self.default_bg = null;
        self.default_attributes = null;
    }

    pub fn setSyntaxStyle(self: *Self, syntax_style: ?*const SyntaxStyle) void {
        self.syntax_style = syntax_style;
    }

    pub fn getSyntaxStyle(self: *const Self) ?*const SyntaxStyle {
        return self.syntax_style;
    }

    /// Set the text content using SIMD-optimized line break detection
    pub fn setText(self: *Self, text: []const u8) TextBufferError!void {
        self.reset();

        if (text.len == 0) {
            // Empty buffer - no segments needed
            self.markAllViewsDirty();
            return;
        }

        const mem_id = try self.mem_registry.register(text, false);

        var break_result = utf8.LineBreakResult.init(self.allocator);
        defer break_result.deinit();

        try utf8.findLineBreaksSIMD16(text, &break_result);

        // Build segments: [text] [break] [text] [break] ... [text]
        var segments = std.ArrayList(Segment).init(self.allocator);
        defer segments.deinit();

        var line_start: u32 = 0;

        for (break_result.breaks.items) |line_break| {
            const break_pos_u32: u32 = @intCast(line_break.pos);
            const line_end: u32 = switch (line_break.kind) {
                .CRLF => break_pos_u32 - 1,
                .CR, .LF => break_pos_u32,
            };

            // Add text segment for line content
            if (line_end > line_start) {
                const chunk = self.createChunk(mem_id, line_start, line_end);
                try segments.append(Segment{ .text = chunk });
                self.char_count += chunk.width;
            }

            // Add break segment
            try segments.append(Segment{ .brk = {} });

            line_start = break_pos_u32 + 1;
        }

        // Handle final line (after last break, or entire text if no breaks)
        if (line_start < text.len) {
            const chunk = self.createChunk(mem_id, line_start, @intCast(text.len));
            try segments.append(Segment{ .text = chunk });
            self.char_count += chunk.width;
        } else if (line_start == text.len and break_result.breaks.items.len > 0) {
            // Empty final line after trailing newline - no segment needed
        }

        // Build rope from segments
        self.rope = try UnifiedRope.from_slice(self.allocator, segments.items);

        self.markAllViewsDirty();
    }

    /// Create a TextChunk from a memory buffer range
    pub fn createChunk(
        self: *const Self,
        mem_id: u8,
        byte_start: u32,
        byte_end: u32,
    ) TextChunk {
        const mem_buf = self.mem_registry.get(mem_id).?;
        const chunk_bytes = mem_buf[byte_start..byte_end];
        const chunk_width: u16 = gwidth.gwidth(chunk_bytes, self.width_method, &self.display_width);

        var flags: u8 = 0;
        if (chunk_bytes.len > 0 and utf8.isAsciiOnly(chunk_bytes)) {
            flags |= TextChunk.Flags.ASCII_ONLY;
        }

        return TextChunk{
            .mem_id = mem_id,
            .byte_start = byte_start,
            .byte_end = byte_end,
            .width = chunk_width,
            .flags = flags,
        };
    }

    pub fn getLineCount(self: *const Self) u32 {
        return iter_mod.getLineCount(&self.rope);
    }

    pub fn lineCount(self: *const Self) u32 {
        return self.getLineCount();
    }

    /// Register a memory buffer
    pub fn registerMemBuffer(self: *Self, data: []const u8, owned: bool) TextBufferError!u8 {
        return try self.mem_registry.register(data, owned);
    }

    pub fn getMemBuffer(self: *const Self, mem_id: u8) ?[]const u8 {
        return self.mem_registry.get(mem_id);
    }

    pub fn getArenaAllocatedBytes(self: *const Self) usize {
        return self.arena.queryCapacity();
    }

    /// Extract all text as UTF-8 bytes into provided output buffer
    pub fn getPlainTextIntoBuffer(self: *const Self, out_buffer: []u8) usize {
        var out_index: usize = 0;

        const line_count = self.getLineCount();

        const Context = struct {
            buffer: *const UnifiedTextBuffer,
            out_buffer: []u8,
            out_index: *usize,
            line_count: u32,
            current_line_idx: u32 = 0,

            fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                // Copy text segments in this line using walkSegments
                const SegContext = struct {
                    buffer: *const UnifiedTextBuffer,
                    out_buffer: []u8,
                    out_index: *usize,

                    fn seg_callback(seg_ctx_ptr: *anyopaque, chunk: *const TextChunk, idx: u32) void {
                        _ = idx;
                        const seg_ctx = @as(*@This(), @ptrCast(@alignCast(seg_ctx_ptr)));
                        const chunk_bytes = chunk.getBytes(&seg_ctx.buffer.mem_registry);
                        const copy_len = @min(chunk_bytes.len, seg_ctx.out_buffer.len - seg_ctx.out_index.*);
                        if (copy_len > 0) {
                            @memcpy(seg_ctx.out_buffer[seg_ctx.out_index.* .. seg_ctx.out_index.* + copy_len], chunk_bytes[0..copy_len]);
                            seg_ctx.out_index.* += copy_len;
                        }
                    }
                };

                var seg_ctx = SegContext{
                    .buffer = ctx.buffer,
                    .out_buffer = ctx.out_buffer,
                    .out_index = ctx.out_index,
                };
                iter_mod.walkSegments(&ctx.buffer.rope, line_info.seg_start, line_info.seg_end, &seg_ctx, SegContext.seg_callback);

                // Add newline between lines (not after last line)
                if (ctx.current_line_idx < ctx.line_count - 1 and ctx.out_index.* < ctx.out_buffer.len) {
                    ctx.out_buffer[ctx.out_index.*] = '\n';
                    ctx.out_index.* += 1;
                }

                ctx.current_line_idx += 1;
            }
        };

        var ctx = Context{
            .buffer = self,
            .out_buffer = out_buffer,
            .out_index = &out_index,
            .line_count = line_count,
        };
        iter_mod.walkLines(&self.rope, &ctx, Context.callback);

        return out_index;
    }

    /// Create a grapheme iterator for given bytes
    pub fn getGraphemeIterator(self: *const Self, bytes: []const u8) Graphemes.Iterator {
        return self.graphemes_data.iterator(bytes);
    }

    /// Compatibility: Get line info for all lines
    /// Returns line starts, widths, and max width
    pub fn getLineInfo(self: *const Self) struct {
        line_count: u32,
        starts: []const u32,
        widths: []const u32,
        max_width: u32,
    } {
        var starts = std.ArrayList(u32).init(self.allocator);
        var widths = std.ArrayList(u32).init(self.allocator);
        var max_width: u32 = 0;

        const Context = struct {
            starts: *std.ArrayList(u32),
            widths: *std.ArrayList(u32),
            max_width: *u32,

            fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                ctx.starts.append(line_info.char_offset) catch {};
                ctx.widths.append(line_info.width) catch {};
                ctx.max_width.* = @max(ctx.max_width.*, line_info.width);
            }
        };

        var ctx = Context{
            .starts = &starts,
            .widths = &widths,
            .max_width = &max_width,
        };
        iter_mod.walkLines(&self.rope, &ctx, Context.callback);

        return .{
            .line_count = self.getLineCount(),
            .starts = starts.items,
            .widths = widths.items,
            .max_width = max_width,
        };
    }

    /// Compatibility: Get a specific line's info
    /// Returns a temporary struct that provides chunk access
    pub const LineCompat = struct {
        buffer: *const UnifiedTextBuffer,
        line_info: iter_mod.LineInfo,
        char_offset: u32,
        width: u32,

        /// Walk chunks in this line
        pub fn walkChunks(
            self: *const LineCompat,
            ctx: *anyopaque,
            walker_fn: *const fn (ctx: *anyopaque, chunk: *const TextChunk, idx: u32) void,
        ) void {
            var seg_iter = SegmentIterator.init(&self.buffer.rope, self.line_info.seg_start, self.line_info.seg_end);
            var idx: u32 = 0;
            while (seg_iter.next()) |chunk| {
                walker_fn(ctx, chunk, idx);
                idx += 1;
            }
        }
    };

    pub fn getLine(self: *const Self, idx: u32) ?LineCompat {
        const Context = struct {
            buffer: *const UnifiedTextBuffer,
            target_idx: u32,
            result: ?LineCompat = null,

            fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                if (line_info.line_idx == ctx.target_idx) {
                    ctx.result = LineCompat{
                        .buffer = ctx.buffer,
                        .line_info = line_info,
                        .char_offset = line_info.char_offset,
                        .width = line_info.width,
                    };
                }
            }
        };

        var ctx = Context{ .buffer = self, .target_idx = idx };
        iter_mod.walkLines(&self.rope, &ctx, Context.callback);
        return ctx.result;
    }

    /// Walk all lines in order
    pub fn walkLines(
        self: *const Self,
        user_ctx: *anyopaque,
        walker_fn: *const fn (ctx: *anyopaque, line: *const LineCompat, idx: u32) void,
    ) void {
        const Context = struct {
            buffer: *const UnifiedTextBuffer,
            user_ctx: *anyopaque,
            user_fn: *const fn (ctx: *anyopaque, line: *const LineCompat, idx: u32) void,

            fn callback(cb_ctx_ptr: *anyopaque, line_info: LineInfo) void {
                const cb_ctx = @as(*@This(), @ptrCast(@alignCast(cb_ctx_ptr)));
                const line_compat = LineCompat{
                    .buffer = cb_ctx.buffer,
                    .line_info = line_info,
                    .char_offset = line_info.char_offset,
                    .width = line_info.width,
                };
                cb_ctx.user_fn(cb_ctx.user_ctx, &line_compat, line_info.line_idx);
            }
        };

        var walk_ctx = Context{
            .buffer = self,
            .user_ctx = user_ctx,
            .user_fn = walker_fn,
        };
        iter_mod.walkLines(&self.rope, &walk_ctx, Context.callback);
    }

    /// Walk all chunks in a specific line
    pub fn walkChunks(
        self: *const Self,
        line_idx: u32,
        ctx: *anyopaque,
        walker_fn: *const fn (ctx: *anyopaque, chunk: *const TextChunk, idx: u32) void,
    ) void {
        if (self.getLine(line_idx)) |line_compat| {
            line_compat.walkChunks(ctx, walker_fn);
        }
    }

    // Highlight support - to be implemented in next phase
    pub fn addHighlight(
        self: *Self,
        line_idx: usize,
        col_start: u32,
        col_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: ?u16,
    ) TextBufferError!void {
        _ = self;
        _ = line_idx;
        _ = col_start;
        _ = col_end;
        _ = style_id;
        _ = priority;
        _ = hl_ref;
        // TODO: Implement highlight caching
    }

    pub fn getLineHighlights(self: *const Self, line_idx: usize) []const Highlight {
        _ = self;
        _ = line_idx;
        return &[_]Highlight{};
    }

    pub fn getLineSpans(self: *const Self, line_idx: usize) []const StyleSpan {
        _ = self;
        _ = line_idx;
        return &[_]StyleSpan{};
    }
};
