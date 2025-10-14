const std = @import("std");
const Allocator = std.mem.Allocator;
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

// Re-export types from segment module
pub const TextChunk = seg_mod.TextChunk;
pub const MemRegistry = seg_mod.MemRegistry;
pub const RGBA = seg_mod.RGBA;
pub const TextSelection = seg_mod.TextSelection;
pub const TextBufferError = seg_mod.TextBufferError;
pub const Highlight = seg_mod.Highlight;
pub const StyleSpan = seg_mod.StyleSpan;
pub const WrapMode = seg_mod.WrapMode;
pub const ChunkFitResult = seg_mod.ChunkFitResult;
pub const GraphemeInfo = seg_mod.GraphemeInfo;

const SyntaxStyle = ss.SyntaxStyle;

// Main TextBuffer type - unified rope architecture
pub const TextBuffer = UnifiedTextBuffer;

// Legacy type aliases for FFI compatibility
pub const TextBufferArray = UnifiedTextBuffer;
pub const TextBufferRope = UnifiedTextBuffer;

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
            hl_list.deinit(self.global_allocator);
        }
        self.line_highlights.deinit(self.global_allocator);

        for (self.line_spans.items) |*span_list| {
            span_list.deinit(self.global_allocator);
        }
        self.line_spans.deinit(self.global_allocator);

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
        // Free highlight/span arrays (they use global_allocator, not arena)
        for (self.line_highlights.items) |*hl_list| {
            hl_list.deinit(self.global_allocator);
        }
        self.line_highlights.clearRetainingCapacity();

        for (self.line_spans.items) |*span_list| {
            span_list.deinit(self.global_allocator);
        }
        self.line_spans.clearRetainingCapacity();

        // Now reset the arena (frees all the internal memory)
        _ = self.arena.reset(if (self.arena.queryCapacity() > 0) .retain_capacity else .free_all);

        self.mem_registry.clear();
        self.char_count = 0;

        self.rope = UnifiedRope.init(self.allocator) catch return;

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
        self.reset(); // reset() already clears highlights

        if (text.len == 0) {
            // Empty buffer - create one empty text segment to represent the single empty line
            // This matches editor semantics where an empty buffer has 1 empty line
            const mem_id = try self.mem_registry.register(&[_]u8{}, false);
            const empty_chunk = self.createChunk(mem_id, 0, 0);
            try self.rope.append(Segment{ .text = empty_chunk });
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
        const count = self.rope.count();
        if (count == 0) return 0; // Truly empty (after reset)
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

    /// Add a line from a memory buffer (for compatibility with old API)
    /// Note: This is not as efficient as setText for bulk operations
    /// Adds text segment with a break separator before it (if not the first line)
    pub fn addLine(
        self: *Self,
        mem_id: u8,
        byte_start: u32,
        byte_end: u32,
    ) TextBufferError!void {
        _ = self.mem_registry.get(mem_id) orelse return TextBufferError.InvalidMemId;

        const chunk = self.createChunk(mem_id, byte_start, byte_end);
        const had_content = self.rope.count() > 0;

        // If we already have content, add a break to separate from previous line
        if (had_content) {
            try self.rope.append(Segment{ .brk = {} });
        }

        // Add text segment (even if empty)
        try self.rope.append(Segment{ .text = chunk });
        self.char_count += chunk.width;

        self.markAllViewsDirty();
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
        /// Chunks accessor for compatibility with buffer.zig
        pub const ChunksAccessor = struct {
            buffer: *const UnifiedTextBuffer,
            line_info: iter_mod.LineInfo,

            pub fn get(self: *const @This(), idx: u32) ?*const TextChunk {
                // Get the chunk at the given index within this line's segments
                const seg_start = self.line_info.seg_start;
                const seg_end = self.line_info.seg_end;

                var chunk_idx: u32 = 0;
                var seg_idx = seg_start;

                while (seg_idx < seg_end) : (seg_idx += 1) {
                    if (self.buffer.rope.get(seg_idx)) |seg| {
                        if (seg.asText()) |chunk| {
                            if (chunk_idx == idx) {
                                return chunk;
                            }
                            chunk_idx += 1;
                        }
                    }
                }

                return null;
            }
        };

        // All fields must come before declarations
        buffer: *const UnifiedTextBuffer,
        line_info: iter_mod.LineInfo,
        char_offset: u32,
        width: u32,
        chunks: ChunksAccessor,

        pub fn init(buf: *const UnifiedTextBuffer, line_inf: iter_mod.LineInfo) LineCompat {
            return .{
                .buffer = buf,
                .line_info = line_inf,
                .char_offset = line_inf.char_offset,
                .width = line_inf.width,
                .chunks = ChunksAccessor{
                    .buffer = buf,
                    .line_info = line_inf,
                },
            };
        }

        /// Walk chunks in this line
        pub fn walkChunks(
            self: *const LineCompat,
            ctx: *anyopaque,
            walker_fn: *const fn (ctx: *anyopaque, chunk: *const TextChunk, idx: u32) void,
        ) void {
            iter_mod.walkSegments(&self.buffer.rope, self.line_info.seg_start, self.line_info.seg_end, ctx, walker_fn);
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
                    ctx.result = LineCompat.init(ctx.buffer, line_info);
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
                const line_compat = LineCompat.init(cb_ctx.buffer, line_info);
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

    // Highlight system
    fn ensureLineHighlightStorage(self: *Self, line_idx: usize) TextBufferError!void {
        while (self.line_highlights.items.len <= line_idx) {
            try self.line_highlights.append(self.global_allocator, .{});
        }
        while (self.line_spans.items.len <= line_idx) {
            try self.line_spans.append(self.global_allocator, .{});
        }
    }

    pub fn addHighlight(
        self: *Self,
        line_idx: usize,
        col_start: u32,
        col_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: ?u16,
    ) TextBufferError!void {
        const line_count = self.getLineCount();
        if (line_idx >= line_count) {
            return TextBufferError.InvalidIndex;
        }

        if (col_start >= col_end) {
            return; // Empty range
        }

        try self.ensureLineHighlightStorage(line_idx);

        const hl = Highlight{
            .col_start = col_start,
            .col_end = col_end,
            .style_id = style_id,
            .priority = priority,
            .hl_ref = hl_ref,
        };

        try self.line_highlights.items[line_idx].append(self.global_allocator, hl);
        try self.rebuildLineSpans(line_idx);
    }

    pub fn getLineHighlights(self: *const Self, line_idx: usize) []const Highlight {
        if (line_idx < self.line_highlights.items.len) {
            return self.line_highlights.items[line_idx].items;
        }
        return &[_]Highlight{};
    }

    pub fn getLineSpans(self: *const Self, line_idx: usize) []const StyleSpan {
        if (line_idx < self.line_spans.items.len) {
            return self.line_spans.items[line_idx].items;
        }
        return &[_]StyleSpan{};
    }

    fn rebuildLineSpans(self: *Self, line_idx: usize) TextBufferError!void {
        if (line_idx >= self.line_spans.items.len) {
            return TextBufferError.InvalidIndex;
        }

        self.line_spans.items[line_idx].clearRetainingCapacity();

        if (line_idx >= self.line_highlights.items.len or self.line_highlights.items[line_idx].items.len == 0) {
            return; // No highlights
        }

        const highlights = self.line_highlights.items[line_idx].items;

        // Collect all boundary columns
        const Event = struct {
            col: u32,
            is_start: bool,
            hl_idx: usize,
        };

        var events = std.ArrayList(Event).init(self.global_allocator);
        defer events.deinit();

        for (highlights, 0..) |hl, idx| {
            try events.append(.{ .col = hl.col_start, .is_start = true, .hl_idx = idx });
            try events.append(.{ .col = hl.col_end, .is_start = false, .hl_idx = idx });
        }

        // Sort by column, ends before starts at same position
        const sortFn = struct {
            fn lessThan(_: void, a: Event, b: Event) bool {
                if (a.col != b.col) return a.col < b.col;
                return !a.is_start;
            }
        }.lessThan;
        std.mem.sort(Event, events.items, {}, sortFn);

        // Build spans by tracking active highlights
        var active = std.AutoHashMap(usize, void).init(self.global_allocator);
        defer active.deinit();

        var current_col: u32 = 0;

        for (events.items) |event| {
            // Find current highest priority style before processing event
            var current_priority: i16 = -1;
            var current_style: u32 = 0;
            var it = active.keyIterator();
            while (it.next()) |hl_idx| {
                const hl = highlights[hl_idx.*];
                if (hl.priority > current_priority) {
                    current_priority = @intCast(hl.priority);
                    current_style = hl.style_id;
                }
            }

            // Emit span for the segment leading up to this event
            if (event.col > current_col) {
                try self.line_spans.items[line_idx].append(self.global_allocator, StyleSpan{
                    .col = current_col,
                    .style_id = current_style,
                    .next_col = event.col,
                });
                current_col = event.col;
            }

            // Process event
            if (event.is_start) {
                try active.put(event.hl_idx, {});
            } else {
                _ = active.remove(event.hl_idx);
            }
        }
    }

    /// Add highlight by row/col coordinates
    pub fn addHighlightByCoords(
        self: *Self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        style_id: u32,
        priority: u8,
        hl_ref: ?u16,
    ) TextBufferError!void {
        const char_start = iter_mod.coordsToOffset(&self.rope, start_row, start_col) orelse return TextBufferError.InvalidIndex;
        const char_end = iter_mod.coordsToOffset(&self.rope, end_row, end_col) orelse return TextBufferError.InvalidIndex;
        return self.addHighlightByCharRange(char_start, char_end, style_id, priority, hl_ref);
    }

    /// Add highlight by character range
    pub fn addHighlightByCharRange(
        self: *Self,
        char_start: u32,
        char_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: ?u16,
    ) TextBufferError!void {
        const line_count = self.getLineCount();
        if (char_start >= char_end or line_count == 0) {
            return;
        }

        // Walk lines to find which lines this highlight affects
        const Context = struct {
            buffer: *Self,
            char_start: u32,
            char_end: u32,
            style_id: u32,
            priority: u8,
            hl_ref: ?u16,
            start_line_idx: ?usize = null,

            fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                const line_start_char = line_info.char_offset;
                const line_end_char = line_info.char_offset + line_info.width;

                // Skip lines before the highlight
                if (line_end_char <= ctx.char_start) return;
                // Stop after the highlight ends
                if (line_start_char >= ctx.char_end) return;

                // This line overlaps with the highlight
                const col_start = if (ctx.char_start > line_start_char)
                    ctx.char_start - line_start_char
                else
                    0;

                const col_end = if (ctx.char_end < line_end_char)
                    ctx.char_end - line_start_char
                else
                    line_info.width;

                ctx.buffer.addHighlight(
                    line_info.line_idx,
                    col_start,
                    col_end,
                    ctx.style_id,
                    ctx.priority,
                    ctx.hl_ref,
                ) catch {};
            }
        };

        var ctx = Context{
            .buffer = self,
            .char_start = char_start,
            .char_end = char_end,
            .style_id = style_id,
            .priority = priority,
            .hl_ref = hl_ref,
        };
        iter_mod.walkLines(&self.rope, &ctx, Context.callback);
    }

    /// Remove all highlights with a specific reference ID
    pub fn removeHighlightsByRef(self: *Self, hl_ref: u16) void {
        for (self.line_highlights.items, 0..) |*hl_list, line_idx| {
            var i: usize = 0;
            var changed = false;
            while (i < hl_list.items.len) {
                if (hl_list.items[i].hl_ref) |ref| {
                    if (ref == hl_ref) {
                        _ = hl_list.orderedRemove(i);
                        changed = true;
                        continue;
                    }
                }
                i += 1;
            }
            if (changed) {
                self.rebuildLineSpans(line_idx) catch {};
            }
        }
    }

    /// Clear all highlights from a specific line
    pub fn clearLineHighlights(self: *Self, line_idx: usize) void {
        if (line_idx < self.line_highlights.items.len) {
            self.line_highlights.items[line_idx].clearRetainingCapacity();
        }
        if (line_idx < self.line_spans.items.len) {
            self.line_spans.items[line_idx].clearRetainingCapacity();
        }
    }

    /// Clear all highlights
    pub fn clearAllHighlights(self: *Self) void {
        for (self.line_highlights.items) |*hl_list| {
            hl_list.clearRetainingCapacity();
        }
        for (self.line_spans.items) |*span_list| {
            span_list.clearRetainingCapacity();
        }
    }
};
