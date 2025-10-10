const std = @import("std");
const Allocator = std.mem.Allocator;
const buffer = @import("buffer.zig");
const ss = @import("syntax-style.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const logger = @import("logger.zig");

pub const ArrayRope = @import("array-rope.zig").ArrayRope;
pub const Rope = @import("rope.zig").Rope;

pub const RGBA = buffer.RGBA;
pub const TextSelection = buffer.TextSelection;
pub const SyntaxStyle = ss.SyntaxStyle;

pub const TextBufferError = error{
    OutOfMemory,
    InvalidDimensions,
    InvalidIndex,
    InvalidId,
    InvalidMemId,
};

pub const WrapMode = enum {
    char,
    word,
};

pub const ChunkFitResult = struct {
    char_count: u32,
    width: u32,
};

pub const ByteOffset = struct {
    mem_id: u8,
    byte_offset: u32,
};

/// Cached grapheme cluster information
pub const GraphemeInfo = struct {
    byte_offset: u32, // Offset within the chunk's bytes
    byte_len: u8, // Length in UTF-8 bytes
    width: u8, // Display width (1, 2, etc.)
};

/// Memory buffer reference in the registry
pub const MemBuffer = struct {
    data: []const u8,
    owned: bool, // Whether this buffer should be freed on deinit
};

/// Registry for multiple memory buffers
pub const MemRegistry = struct {
    buffers: std.ArrayListUnmanaged(MemBuffer),
    allocator: Allocator,

    pub fn init(allocator: Allocator) MemRegistry {
        return .{
            .buffers = .{},
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *MemRegistry) void {
        for (self.buffers.items) |mem_buf| {
            if (mem_buf.owned) {
                self.allocator.free(mem_buf.data);
            }
        }
        self.buffers.deinit(self.allocator);
    }

    /// Register a memory buffer and return its ID
    pub fn register(self: *MemRegistry, data: []const u8, owned: bool) TextBufferError!u8 {
        if (self.buffers.items.len >= 255) {
            return TextBufferError.OutOfMemory; // Max 255 buffers with u8 ID
        }
        const id: u8 = @intCast(self.buffers.items.len);
        try self.buffers.append(self.allocator, MemBuffer{
            .data = data,
            .owned = owned,
        });
        return id;
    }

    /// Get buffer by ID
    pub fn get(self: *const MemRegistry, id: u8) ?[]const u8 {
        if (id >= self.buffers.items.len) return null;
        return self.buffers.items[id].data;
    }

    /// Clear all registered buffers
    pub fn clear(self: *MemRegistry) void {
        for (self.buffers.items) |mem_buf| {
            if (mem_buf.owned) {
                self.allocator.free(mem_buf.data);
            }
        }
        self.buffers.clearRetainingCapacity();
    }
};

/// A chunk represents a contiguous sequence of UTF-8 bytes from a specific memory buffer
pub const TextChunk = struct {
    mem_id: u8, // ID of the memory buffer this chunk references
    byte_start: u32, // Offset into the memory buffer
    byte_end: u32, // End offset into the memory buffer
    width: u32, // Display width in cells (computed once)
    graphemes: ?[]GraphemeInfo, // Lazy grapheme buffer (computed on first access, reused by views)

    pub fn getBytes(self: *const TextChunk, mem_registry: *const MemRegistry) []const u8 {
        const mem_buf = mem_registry.get(self.mem_id) orelse return &[_]u8{};
        return mem_buf[self.byte_start..self.byte_end];
    }

    /// Lazily compute and cache grapheme info for this chunk
    /// Returns a slice that is valid until the buffer is reset
    pub fn getGraphemes(
        self: *const TextChunk,
        mem_registry: *const MemRegistry,
        allocator: Allocator,
        graphemes_data: *const Graphemes,
        width_method: gwidth.WidthMethod,
        display_width: *const DisplayWidth,
    ) TextBufferError![]const GraphemeInfo {
        // Need to cast to mutable to cache the graphemes
        const mut_self = @constCast(self);
        if (self.graphemes) |cached| {
            return cached;
        }

        const chunk_bytes = self.getBytes(mem_registry);
        var grapheme_list = std.ArrayList(GraphemeInfo).init(allocator);
        defer grapheme_list.deinit();

        var iter = graphemes_data.iterator(chunk_bytes);
        var byte_pos: u32 = 0;

        while (iter.next()) |gc| {
            const gbytes = gc.bytes(chunk_bytes);
            const width_u16: u16 = gwidth.gwidth(gbytes, width_method, display_width);

            if (width_u16 == 0) {
                byte_pos += @intCast(gbytes.len);
                continue;
            }

            const width: u8 = @intCast(width_u16);

            try grapheme_list.append(GraphemeInfo{
                .byte_offset = byte_pos,
                .byte_len = @intCast(gbytes.len),
                .width = width,
            });

            byte_pos += @intCast(gbytes.len);
        }

        const graphemes = try allocator.dupe(GraphemeInfo, grapheme_list.items);
        mut_self.graphemes = graphemes;

        return graphemes;
    }
};

/// A highlight represents a styled region on a line
pub const Highlight = struct {
    col_start: u32, // Column start (in grapheme/display units)
    col_end: u32, // Column end (in grapheme/display units)
    style_id: u32, // ID into SyntaxStyle
    priority: u8, // Higher priority wins for overlaps
    hl_ref: ?u16, // Optional reference for bulk removal
};

/// Pre-computed style span for efficient rendering
/// Represents a contiguous region with a single style
pub const StyleSpan = struct {
    col: u32, // Starting column
    style_id: u32, // Style to use (0 = use default)
    next_col: u32, // Column where next style change happens
};

/// A line contains multiple chunks and tracks its total width
/// Generic over ChunkStorage type (ArrayRope or Rope)
pub fn TextLine(comptime ChunkStorage: type) type {
    return struct {
        const Self = @This();

        chunks: ChunkStorage,
        width: u32,
        char_offset: u32, // Cumulative char offset for selection tracking
        highlights: std.ArrayListUnmanaged(Highlight), // Highlights for this line
        spans: std.ArrayListUnmanaged(StyleSpan), // Pre-computed style spans for this line

        pub fn init(allocator: Allocator) !Self {
            return .{
                .chunks = try ChunkStorage.init(allocator),
                .width = 0,
                .char_offset = 0,
                .highlights = .{},
                .spans = .{},
            };
        }

        pub fn deinit(self: *Self, allocator: Allocator) void {
            _ = self;
            _ = allocator;
            // Chunks are managed by arena, highlights/spans will be cleared on reset
        }
    };
}

/// TextBuffer holds text organized by lines without styling
/// Generic over LineStorage and ChunkStorage types (ArrayRope or Rope)
pub fn TextBuffer(comptime LineStorage: type, comptime ChunkStorage: type) type {
    return struct {
        const Self = @This();
        const Line = TextLine(ChunkStorage);

        mem_registry: MemRegistry, // Registry for multiple memory buffers
        char_count: u32, // Total character count across all chunks
        default_fg: ?RGBA,
        default_bg: ?RGBA,
        default_attributes: ?u8,

        allocator: Allocator,
        global_allocator: Allocator,
        arena: *std.heap.ArenaAllocator,

        lines: LineStorage,
        syntax_style: ?*const SyntaxStyle,

        pool: *gp.GraphemePool,
        graphemes_data: Graphemes,
        display_width: DisplayWidth,
        width_method: gwidth.WidthMethod,

        // View registration system
        view_dirty_flags: std.ArrayListUnmanaged(bool),
        next_view_id: u32,
        free_view_ids: std.ArrayListUnmanaged(u32),

        pub fn init(global_allocator: Allocator, pool: *gp.GraphemePool, width_method: gwidth.WidthMethod, graphemes_data: *Graphemes, display_width: *DisplayWidth) TextBufferError!*Self {
            const self = global_allocator.create(Self) catch return TextBufferError.OutOfMemory;
            errdefer global_allocator.destroy(self);

            const internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
            errdefer global_allocator.destroy(internal_arena);
            internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

            const internal_allocator = internal_arena.allocator();

            const graph = graphemes_data.*;
            const dw = display_width.*;

            const lines = LineStorage.init(internal_allocator) catch return TextBufferError.OutOfMemory;

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
                .lines = lines,
                .syntax_style = null,
                .pool = pool,
                .graphemes_data = graph,
                .display_width = dw,
                .width_method = width_method,
                .view_dirty_flags = view_dirty_flags,
                .next_view_id = 0,
                .free_view_ids = free_view_ids,
            };

            return self;
        }

        pub fn deinit(self: *Self) void {
            self.view_dirty_flags.deinit(self.global_allocator);
            self.free_view_ids.deinit(self.global_allocator);
            self.mem_registry.deinit();
            self.arena.deinit();
            self.global_allocator.destroy(self.arena);
            self.global_allocator.destroy(self);
        }

        /// Register a view with this buffer and return a view ID
        pub fn registerView(self: *Self) TextBufferError!u32 {
            // Try to reuse a freed ID first
            if (self.free_view_ids.items.len > 0) {
                const id = self.free_view_ids.items[self.free_view_ids.items.len - 1];
                _ = self.free_view_ids.pop();
                self.view_dirty_flags.items[id] = true; // Mark as dirty initially
                return id;
            }

            // Otherwise allocate a new ID
            const id = self.next_view_id;
            self.next_view_id += 1;
            try self.view_dirty_flags.append(self.global_allocator, true);
            return id;
        }

        /// Unregister a view from this buffer
        pub fn unregisterView(self: *Self, view_id: u32) void {
            if (view_id < self.view_dirty_flags.items.len) {
                self.free_view_ids.append(self.global_allocator, view_id) catch {};
            }
        }

        /// Check if a view is marked as dirty
        pub fn isViewDirty(self: *const Self, view_id: u32) bool {
            if (view_id < self.view_dirty_flags.items.len) {
                return self.view_dirty_flags.items[view_id];
            }
            return false;
        }

        /// Clear the dirty flag for a view
        pub fn clearViewDirty(self: *Self, view_id: u32) void {
            if (view_id < self.view_dirty_flags.items.len) {
                self.view_dirty_flags.items[view_id] = false;
            }
        }

        /// Mark all registered views as dirty
        fn markAllViewsDirty(self: *Self) void {
            for (self.view_dirty_flags.items) |*flag| {
                flag.* = true;
            }
        }

        pub fn getLength(self: *const Self) u32 {
            return self.char_count;
        }

        pub fn getByteSize(self: *const Self) u32 {
            // TODO: Cache bytesize and recalculate when chunks change
            const Context = struct {
                total_bytes: u32 = 0,
                line_count: u32,

                fn walker(ctx_ptr: *anyopaque, line: *const Line, idx: u32) LineStorage.Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    // Walk through chunks using rope API
                    const ChunkContext = struct {
                        total: *u32,
                        fn chunkWalker(chunk_ctx: *anyopaque, chunk: *const TextChunk, _: u32) ChunkStorage.Node.WalkerResult {
                            const c = @as(*@This(), @ptrCast(@alignCast(chunk_ctx)));
                            c.total.* += chunk.byte_end - chunk.byte_start;
                            return .{};
                        }
                    };
                    var chunk_ctx = ChunkContext{ .total = &ctx.total_bytes };
                    line.chunks.walk(&chunk_ctx, ChunkContext.chunkWalker) catch {};

                    // Add newline byte count (except for last line)
                    if (idx < ctx.line_count - 1) {
                        ctx.total_bytes += 1; // for '\n'
                    }
                    return .{};
                }
            };

            var ctx = Context{ .line_count = self.lines.count() };
            self.lines.walk(&ctx, Context.walker) catch {};
            return ctx.total_bytes;
        }

        pub fn measureText(self: *const Self, text: []const u8) u32 {
            return gwidth.gwidth(text, self.width_method, &self.display_width);
        }

        pub fn reset(self: *Self) void {
            _ = self.arena.reset(if (self.arena.queryCapacity() > 0) .retain_capacity else .free_all);

            self.mem_registry.clear();
            self.char_count = 0;

            self.lines = LineStorage.init(self.allocator) catch return;

            // Mark all registered views as dirty
            self.markAllViewsDirty();
        }

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

        /// Add a highlight to a specific line
        pub fn addHighlight(
            self: *Self,
            line_idx: usize,
            col_start: u32,
            col_end: u32,
            style_id: u32,
            priority: u8,
            hl_ref: ?u16,
        ) TextBufferError!void {
            if (line_idx >= self.lines.count()) {
                return TextBufferError.InvalidIndex;
            }

            const hl = Highlight{
                .col_start = col_start,
                .col_end = col_end,
                .style_id = style_id,
                .priority = priority,
                .hl_ref = hl_ref,
            };

            // Get mutable line - need to work with rope API
            const line_ptr = self.lines.get(@intCast(line_idx)) orelse return TextBufferError.InvalidIndex;
            try @constCast(line_ptr).highlights.append(self.allocator, hl);
            try self.rebuildLineSpans(line_idx);
        }

        /// Remove all highlights with a specific reference ID
        pub fn removeHighlightsByRef(self: *Self, hl_ref: u16) void {
            const Context = struct {
                buffer: *Self,
                hl_ref: u16,

                fn walker(ctx_ptr: *anyopaque, line: *const Line, idx: u32) LineStorage.Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    const mut_line = @constCast(line);
                    var i: usize = 0;
                    var changed = false;
                    while (i < mut_line.highlights.items.len) {
                        if (mut_line.highlights.items[i].hl_ref) |ref| {
                            if (ref == ctx.hl_ref) {
                                _ = mut_line.highlights.swapRemove(i);
                                changed = true;
                                continue;
                            }
                        }
                        i += 1;
                    }
                    if (changed) {
                        ctx.buffer.rebuildLineSpans(idx) catch {};
                    }
                    return .{};
                }
            };

            var ctx = Context{ .buffer = self, .hl_ref = hl_ref };
            self.lines.walk(&ctx, Context.walker) catch {};
        }

        /// Clear all highlights from a specific line
        pub fn clearLineHighlights(self: *Self, line_idx: usize) void {
            if (line_idx < self.lines.count()) {
                if (self.lines.get(@intCast(line_idx))) |line| {
                    @constCast(line).highlights.clearRetainingCapacity();
                    self.rebuildLineSpans(line_idx) catch {};
                }
            }
        }

        /// Clear all highlights from all lines
        pub fn clearAllHighlights(self: *Self) void {
            const Context = struct {
                buffer: *Self,

                fn walker(ctx_ptr: *anyopaque, line: *const Line, idx: u32) LineStorage.Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    @constCast(line).highlights.clearRetainingCapacity();
                    ctx.buffer.rebuildLineSpans(idx) catch {};
                    return .{};
                }
            };

            var ctx = Context{ .buffer = self };
            self.lines.walk(&ctx, Context.walker) catch {};
        }

        /// Get highlights for a specific line
        pub fn getLineHighlights(self: *const Self, line_idx: usize) []const Highlight {
            if (line_idx < self.lines.count()) {
                if (self.lines.get(@intCast(line_idx))) |line| {
                    return line.highlights.items;
                }
            }
            return &[_]Highlight{};
        }

        /// Get pre-computed style spans for a specific line
        pub fn getLineSpans(self: *const Self, line_idx: usize) []const StyleSpan {
            if (line_idx < self.lines.count()) {
                if (self.lines.get(@intCast(line_idx))) |line| {
                    return line.spans.items;
                }
            }
            return &[_]StyleSpan{};
        }

        /// Convert row/col coordinates to absolute character offset
        /// Row is 0-based line index, col is 0-based column within that line
        /// Returns null if coordinates are out of bounds
        pub fn coordsToCharOffset(self: *const Self, row: u32, col: u32) ?u32 {
            if (row >= self.lines.count()) return null;

            const line = self.lines.get(row) orelse return null;
            if (col > line.width) return null;

            return line.char_offset + col;
        }

        /// Convert row/col coordinates to byte offset in the underlying memory buffer
        /// Returns the memory ID, byte offset, and remaining bytes in the chunk
        /// Returns null if coordinates are out of bounds
        pub fn coordsToByteOffset(self: *const Self, row: u32, col: u32) ?ByteOffset {
            if (row >= self.lines.count()) return null;

            const line = self.lines.get(row) orelse return null;
            if (col > line.width) return null;

            const ChunkContext = struct {
                buffer: *const Self,
                col: u32,
                current_col: u32 = 0,
                result: ?ByteOffset = null,

                fn walker(ctx_ptr: *anyopaque, chunk: *const TextChunk, _: u32) ChunkStorage.Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    if (ctx.col <= ctx.current_col + chunk.width) {
                        // This chunk contains the target column
                        const col_in_chunk = ctx.col - ctx.current_col;

                        // Get graphemes for this chunk to find byte offset
                        const graphemes = chunk.getGraphemes(
                            &ctx.buffer.mem_registry,
                            ctx.buffer.allocator,
                            &ctx.buffer.graphemes_data,
                            ctx.buffer.width_method,
                            &ctx.buffer.display_width,
                        ) catch return .{ .keep_walking = false };

                        // Walk through graphemes to find the byte offset
                        var chars_so_far: u32 = 0;
                        for (graphemes) |g| {
                            if (chars_so_far >= col_in_chunk) {
                                ctx.result = ByteOffset{
                                    .mem_id = chunk.mem_id,
                                    .byte_offset = chunk.byte_start + g.byte_offset,
                                };
                                return .{ .keep_walking = false };
                            }
                            chars_so_far += g.width;
                        }

                        // If we're at the end of the chunk, return end position
                        ctx.result = ByteOffset{
                            .mem_id = chunk.mem_id,
                            .byte_offset = chunk.byte_end,
                        };
                        return .{ .keep_walking = false };
                    }
                    ctx.current_col += chunk.width;
                    return .{};
                }
            };

            var chunk_ctx = ChunkContext{ .buffer = self, .col = col };
            line.chunks.walk(&chunk_ctx, ChunkContext.walker) catch {};

            if (chunk_ctx.result) |result| {
                return result;
            }

            // Column is at the end of the line - get last chunk
            const last_chunk = line.chunks.get(line.chunks.count() - 1);
            if (last_chunk) |lc| {
                return ByteOffset{
                    .mem_id = lc.mem_id,
                    .byte_offset = lc.byte_end,
                };
            }

            return null;
        }

        /// Convert absolute character offset to row/col coordinates
        /// Returns null if offset is out of bounds
        pub fn charOffsetToCoords(self: *const Self, char_offset: u32) ?struct { row: u32, col: u32 } {
            const line_count = self.lines.count();
            if (line_count == 0) return null;

            // Binary search to find the line containing this offset
            var left: usize = 0;
            var right: usize = line_count;

            while (left < right) {
                const mid = left + (right - left) / 2;
                const line = self.lines.get(@intCast(mid)) orelse return null;
                const next_line = self.lines.get(@intCast(mid + 1));
                const line_end_char = if (next_line) |nl|
                    nl.char_offset
                else
                    line.char_offset + line.width;

                if (char_offset < line.char_offset) {
                    right = mid;
                } else if (char_offset >= line_end_char) {
                    left = mid + 1;
                } else {
                    // Found the line
                    const col = char_offset - line.char_offset;
                    return .{ .row = @intCast(mid), .col = col };
                }
            }

            return null;
        }

        /// Add a highlight using row/col coordinates
        /// Efficiently handles single-line and multi-line highlights
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
            const char_start = self.coordsToCharOffset(start_row, start_col) orelse return TextBufferError.InvalidIndex;
            const char_end = self.coordsToCharOffset(end_row, end_col) orelse return TextBufferError.InvalidIndex;

            return self.addHighlightByCharRange(char_start, char_end, style_id, priority, hl_ref);
        }

        /// Add a highlight using character offsets into the full text
        /// Efficiently handles single-line and multi-line highlights
        pub fn addHighlightByCharRange(
            self: *Self,
            char_start: u32,
            char_end: u32,
            style_id: u32,
            priority: u8,
            hl_ref: ?u16,
        ) TextBufferError!void {
            const line_count = self.lines.count();
            if (char_start >= char_end or line_count == 0) {
                return;
            }

            // Binary search to find the starting line
            var start_line_idx: usize = 0;
            {
                var left: usize = 0;
                var right: usize = line_count;
                while (left < right) {
                    const mid = left + (right - left) / 2;
                    const line = self.lines.get(@intCast(mid)) orelse break;
                    const next_line = self.lines.get(@intCast(mid + 1));
                    const line_end_char = if (next_line) |nl|
                        nl.char_offset
                    else
                        line.char_offset + line.width;

                    if (char_start < line.char_offset) {
                        right = mid;
                    } else if (char_start >= line_end_char) {
                        left = mid + 1;
                    } else {
                        start_line_idx = mid;
                        break;
                    }
                }
                if (left >= line_count) return;
                if (left == right) start_line_idx = left;
            }

            const start_line = self.lines.get(@intCast(start_line_idx)) orelse return;
            const start_line_next = self.lines.get(@intCast(start_line_idx + 1));
            const start_line_end_char = if (start_line_next) |nl|
                nl.char_offset
            else
                start_line.char_offset + start_line.width;

            // Fast path: highlight is entirely within one line
            if (char_end <= start_line_end_char) {
                const col_start = char_start - start_line.char_offset;
                const col_end = char_end - start_line.char_offset;
                return self.addHighlight(start_line_idx, col_start, col_end, style_id, priority, hl_ref);
            }

            // Multi-line highlight: process first line
            {
                const col_start = char_start - start_line.char_offset;
                const col_end = start_line.width;
                try self.addHighlight(start_line_idx, col_start, col_end, style_id, priority, hl_ref);
            }

            // Process middle and end lines
            var line_idx = start_line_idx + 1;
            while (line_idx < line_count) {
                const line = self.lines.get(@intCast(line_idx)) orelse break;
                const next_line = self.lines.get(@intCast(line_idx + 1));
                const line_end_char = if (next_line) |nl|
                    nl.char_offset
                else
                    line.char_offset + line.width;

                if (line.char_offset >= char_end) {
                    break;
                }

                if (char_end <= line_end_char) {
                    // This is the last line
                    const col_end = char_end - line.char_offset;
                    try self.addHighlight(line_idx, 0, col_end, style_id, priority, hl_ref);
                    break;
                } else {
                    // Middle line: highlight entire line
                    try self.addHighlight(line_idx, 0, line.width, style_id, priority, hl_ref);
                }

                line_idx += 1;
            }
        }

        /// Rebuild pre-computed style spans for a line
        /// Builds an optimized span list for O(1) rendering lookups
        fn rebuildLineSpans(self: *Self, line_idx: usize) TextBufferError!void {
            if (line_idx >= self.lines.count()) {
                return TextBufferError.InvalidIndex;
            }

            const line = self.lines.get(@intCast(line_idx)) orelse return TextBufferError.InvalidIndex;
            const mut_line = @constCast(line);
            mut_line.spans.clearRetainingCapacity();

            if (line.highlights.items.len == 0) {
                return; // No highlights, rendering will use defaults
            }

            const highlights = line.highlights.items;

            // Collect all boundary columns
            const Event = struct {
                col: u32,
                is_start: bool,
                hl_idx: usize,
            };

            var events = std.ArrayList(Event).init(self.allocator);
            defer events.deinit();

            for (highlights, 0..) |hl, idx| {
                try events.append(.{ .col = hl.col_start, .is_start = true, .hl_idx = idx });
                try events.append(.{ .col = hl.col_end, .is_start = false, .hl_idx = idx });
            }

            // Sort by column, ends before starts at same position
            const sortFn = struct {
                fn lessThan(_: void, a: Event, b: Event) bool {
                    if (a.col != b.col) return a.col < b.col;
                    return !a.is_start; // Ends before starts
                }
            }.lessThan;
            std.mem.sort(Event, events.items, {}, sortFn);

            // Build spans by tracking active highlights
            var active = std.AutoHashMap(usize, void).init(self.allocator);
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
                    try mut_line.spans.append(self.allocator, StyleSpan{
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

        /// Set the syntax style for highlight resolution
        pub fn setSyntaxStyle(self: *Self, syntax_style: ?*const SyntaxStyle) void {
            self.syntax_style = syntax_style;
        }

        /// Get the current syntax style
        pub fn getSyntaxStyle(self: *const Self) ?*const SyntaxStyle {
            return self.syntax_style;
        }

        /// Set the text content of the buffer
        /// Parses UTF-8 text into lines and grapheme clusters
        pub fn setText(self: *Self, text: []const u8) TextBufferError!void {
            self.reset();

            if (text.len == 0) {
                // Create empty line for empty text
                const empty_line = try Line.init(self.allocator);
                try self.lines.append(empty_line);
                return;
            }

            // Register the text buffer and get its ID
            const mem_id = try self.mem_registry.register(text, false);

            // Parse into lines using memchr for \n
            var line_start: u32 = 0;
            var pos: u32 = 0;
            var has_trailing_newline = false;

            while (pos < text.len) {
                if (std.mem.indexOfScalarPos(u8, text, pos, '\n')) |nl_pos| {
                    var line_end: u32 = @intCast(nl_pos);
                    // Check for \r before \n
                    if (nl_pos > 0 and text[nl_pos - 1] == '\r') {
                        line_end = @intCast(nl_pos - 1);
                    }

                    // Parse line with newline included
                    try self.parseLine(mem_id, text, line_start, line_end, true);

                    pos = @intCast(nl_pos + 1);
                    line_start = pos;
                    has_trailing_newline = (pos == text.len);
                } else {
                    // Last line (no trailing \n)
                    try self.parseLine(mem_id, text, line_start, @intCast(text.len), false);
                    has_trailing_newline = false;
                    break;
                }
            }

            // If text ends with \n, create an empty final line
            if (has_trailing_newline) {
                var final_line = try Line.init(self.allocator);
                final_line.char_offset = self.char_count;
                try self.lines.append(final_line);
            }
        }

        /// Create a TextChunk from a memory buffer range
        /// Calculates width, but graphemes are computed lazily on first access
        fn createChunk(
            self: *const Self,
            mem_id: u8,
            byte_start: u32,
            byte_end: u32,
        ) TextChunk {
            const mem_buf = self.mem_registry.get(mem_id).?;
            const chunk_bytes = mem_buf[byte_start..byte_end];
            const chunk_width: u32 = gwidth.gwidth(chunk_bytes, self.width_method, &self.display_width);

            return TextChunk{
                .mem_id = mem_id,
                .byte_start = byte_start,
                .byte_end = byte_end,
                .width = chunk_width,
                .graphemes = null, // Computed lazily
            };
        }

        /// Parse a single line into chunks (count and measure graphemes, but don't encode)
        fn parseLine(self: *Self, mem_id: u8, text: []const u8, byte_start: u32, byte_end: u32, _: bool) TextBufferError!void {
            var line = try Line.init(self.allocator);
            line.char_offset = self.char_count;

            // Note: We don't include the newline character in the chunk
            // Newlines are implicit line separators, not counted as characters

            // Store the chunk with just byte references
            if (byte_start < byte_end) {
                const chunk = self.createChunk(mem_id, byte_start, byte_end);

                self.char_count += chunk.width;
                try line.chunks.append(chunk);
                line.width = chunk.width;
            }

            _ = text; // Suppress unused warning
            try self.lines.append(line);
        }

        /// Get the real line count (not virtual/wrapped lines)
        pub fn getLineCount(self: *const Self) u32 {
            return self.lines.count();
        }

        /// Get the real line count (alias for compatibility)
        pub fn lineCount(self: *const Self) u32 {
            return self.lines.count();
        }

        /// Get a line by index (for rare index-based logic)
        pub fn getLine(self: *const Self, idx: u32) ?*const Line {
            return self.lines.get(idx);
        }

        /// Walk all lines in order (primary iteration API)
        pub fn walkLines(self: *const Self, ctx: *anyopaque, f: LineStorage.Node.WalkerFn) !void {
            try self.lines.walk(ctx, f);
        }

        /// Walk all chunks in a specific line
        pub fn walkChunks(self: *const Self, line_idx: u32, ctx: *anyopaque, f: ChunkStorage.Node.WalkerFn) !void {
            if (self.getLine(line_idx)) |line| {
                try line.chunks.walk(ctx, f);
            }
        }

        /// Get line info (starts, widths, max_width) from the buffer
        /// The returned slices are valid until the next setText/reset call
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

                fn walker(ctx_ptr: *anyopaque, line: *const Line, idx: u32) LineStorage.Node.WalkerResult {
                    _ = idx;
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                    ctx.starts.append(line.char_offset) catch {};
                    ctx.widths.append(line.width) catch {};
                    ctx.max_width.* = @max(ctx.max_width.*, line.width);
                    return .{};
                }
            };

            var ctx = Context{ .starts = &starts, .widths = &widths, .max_width = &max_width };
            self.lines.walk(&ctx, Context.walker) catch {};

            return .{
                .line_count = self.lines.count(),
                .starts = starts.items,
                .widths = widths.items,
                .max_width = max_width,
            };
        }

        /// Extract all text as UTF-8 bytes from the char buffer into provided output buffer
        /// Returns the number of bytes written to the output buffer
        pub fn getPlainTextIntoBuffer(self: *const Self, out_buffer: []u8) usize {
            const Context = struct {
                buffer: *const Self,
                out_buffer: []u8,
                out_index: usize = 0,
                line_count: u32,

                fn walker(ctx_ptr: *anyopaque, line: *const Line, idx: u32) LineStorage.Node.WalkerResult {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    // Walk through chunks using rope API
                    const ChunkContext = struct {
                        buffer: *const Self,
                        out_buffer: []u8,
                        out_index: *usize,

                        fn chunkWalker(chunk_ctx: *anyopaque, chunk: *const TextChunk, _: u32) ChunkStorage.Node.WalkerResult {
                            const c = @as(*@This(), @ptrCast(@alignCast(chunk_ctx)));
                            const chunk_bytes = chunk.getBytes(&c.buffer.mem_registry);
                            const copy_len = @min(chunk_bytes.len, c.out_buffer.len - c.out_index.*);
                            if (copy_len > 0) {
                                @memcpy(c.out_buffer[c.out_index.* .. c.out_index.* + copy_len], chunk_bytes[0..copy_len]);
                                c.out_index.* += copy_len;
                            }
                            return .{};
                        }
                    };
                    var chunk_ctx = ChunkContext{ .buffer = ctx.buffer, .out_buffer = ctx.out_buffer, .out_index = &ctx.out_index };
                    line.chunks.walk(&chunk_ctx, ChunkContext.chunkWalker) catch {};

                    // Add newline between lines (except after last line)
                    if (idx < ctx.line_count - 1 and ctx.out_index < ctx.out_buffer.len) {
                        ctx.out_buffer[ctx.out_index] = '\n';
                        ctx.out_index += 1;
                    }
                    return .{};
                }
            };

            var ctx = Context{ .buffer = self, .out_buffer = out_buffer, .line_count = self.lines.count() };
            self.lines.walk(&ctx, Context.walker) catch {};
            return ctx.out_index;
        }

        /// Register a memory buffer with the text buffer
        /// Returns the memory ID that can be used to reference this buffer
        /// If owned is true, the buffer will be freed when the TextBuffer is destroyed
        pub fn registerMemBuffer(self: *Self, data: []const u8, owned: bool) TextBufferError!u8 {
            return try self.mem_registry.register(data, owned);
        }

        /// Get a memory buffer by its ID
        pub fn getMemBuffer(self: *const Self, mem_id: u8) ?[]const u8 {
            return self.mem_registry.get(mem_id);
        }

        /// Add a new line with a chunk
        pub fn addLine(
            self: *Self,
            mem_id: u8,
            byte_start: u32,
            byte_end: u32,
        ) TextBufferError!void {
            _ = self.mem_registry.get(mem_id) orelse return TextBufferError.InvalidMemId;

            const chunk = self.createChunk(mem_id, byte_start, byte_end);

            var line = try Line.init(self.allocator);
            line.char_offset = self.char_count;
            line.width = chunk.width;

            try line.chunks.append(chunk);
            try self.lines.append(line);
            self.char_count += chunk.width;

            // Mark all views as dirty
            self.markAllViewsDirty();
        }
    };
}

/// Type aliases for common use cases
/// Read-only text buffer using ArrayRope for both lines and chunks (O(1) access, no editing overhead)
pub const TextBufferArray = TextBuffer(ArrayRope(TextLine(ArrayRope(TextChunk))), ArrayRope(TextChunk));

/// Fully writable text buffer using Rope for both lines and chunks (O(log n) access, efficient editing at all levels)
pub const TextBufferRope = TextBuffer(Rope(TextLine(Rope(TextChunk))), Rope(TextChunk));
