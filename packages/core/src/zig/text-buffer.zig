const std = @import("std");
const Allocator = std.mem.Allocator;
const buffer = @import("buffer.zig");
const ss = @import("syntax-style.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const logger = @import("logger.zig");

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
        self: *TextChunk,
        mem_registry: *const MemRegistry,
        allocator: Allocator,
        graphemes_data: *const Graphemes,
        width_method: gwidth.WidthMethod,
        display_width: *const DisplayWidth,
    ) TextBufferError![]const GraphemeInfo {
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
        self.graphemes = graphemes;

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
pub const TextLine = struct {
    chunks: std.ArrayListUnmanaged(TextChunk),
    width: u32,
    char_offset: u32, // Cumulative char offset for selection tracking
    highlights: std.ArrayListUnmanaged(Highlight), // Highlights for this line
    spans: std.ArrayListUnmanaged(StyleSpan), // Pre-computed style spans for this line

    pub fn init() TextLine {
        return .{
            .chunks = .{},
            .width = 0,
            .char_offset = 0,
            .highlights = .{},
            .spans = .{},
        };
    }

    pub fn deinit(self: *TextLine, allocator: Allocator) void {
        self.chunks.deinit(allocator);
        self.highlights.deinit(allocator);
        self.spans.deinit(allocator);
    }
};

/// TextBuffer holds text organized by lines without styling
pub const TextBuffer = struct {
    mem_registry: MemRegistry, // Registry for multiple memory buffers
    char_count: u32, // Total character count across all chunks
    default_fg: ?RGBA,
    default_bg: ?RGBA,
    default_attributes: ?u8,

    allocator: Allocator,
    global_allocator: Allocator,
    arena: *std.heap.ArenaAllocator,

    lines: std.ArrayListUnmanaged(TextLine),
    syntax_style: ?*const SyntaxStyle,

    pool: *gp.GraphemePool,
    graphemes_data: Graphemes,
    display_width: DisplayWidth,
    width_method: gwidth.WidthMethod,

    // View registration system
    view_dirty_flags: std.ArrayListUnmanaged(bool),
    next_view_id: u32,
    free_view_ids: std.ArrayListUnmanaged(u32),

    pub fn init(global_allocator: Allocator, pool: *gp.GraphemePool, width_method: gwidth.WidthMethod, graphemes_data: *Graphemes, display_width: *DisplayWidth) TextBufferError!*TextBuffer {
        const self = global_allocator.create(TextBuffer) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(internal_arena);
        internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const internal_allocator = internal_arena.allocator();

        const graph = graphemes_data.*;
        const dw = display_width.*;

        var lines: std.ArrayListUnmanaged(TextLine) = .{};

        errdefer {
            for (lines.items) |*line| {
                line.deinit(internal_allocator);
            }
            lines.deinit(internal_allocator);
        }

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

    pub fn deinit(self: *TextBuffer) void {
        self.view_dirty_flags.deinit(self.global_allocator);
        self.free_view_ids.deinit(self.global_allocator);
        self.mem_registry.deinit();
        self.arena.deinit();
        self.global_allocator.destroy(self.arena);
        self.global_allocator.destroy(self);
    }

    /// Register a view with this buffer and return a view ID
    pub fn registerView(self: *TextBuffer) TextBufferError!u32 {
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
    pub fn unregisterView(self: *TextBuffer, view_id: u32) void {
        if (view_id < self.view_dirty_flags.items.len) {
            self.free_view_ids.append(self.global_allocator, view_id) catch {};
        }
    }

    /// Check if a view is marked as dirty
    pub fn isViewDirty(self: *const TextBuffer, view_id: u32) bool {
        if (view_id < self.view_dirty_flags.items.len) {
            return self.view_dirty_flags.items[view_id];
        }
        return false;
    }

    /// Clear the dirty flag for a view
    pub fn clearViewDirty(self: *TextBuffer, view_id: u32) void {
        if (view_id < self.view_dirty_flags.items.len) {
            self.view_dirty_flags.items[view_id] = false;
        }
    }

    /// Mark all registered views as dirty
    fn markAllViewsDirty(self: *TextBuffer) void {
        for (self.view_dirty_flags.items) |*flag| {
            flag.* = true;
        }
    }

    pub fn getLength(self: *const TextBuffer) u32 {
        return self.char_count;
    }

    pub fn getByteSize(self: *const TextBuffer) u32 {
        // TODO: Cache bytesize and recalculate when chunks change
        var total_bytes: u32 = 0;
        for (self.lines.items, 0..) |line, line_idx| {
            for (line.chunks.items) |chunk| {
                total_bytes += chunk.byte_end - chunk.byte_start;
            }
            // Add newline byte count (except for last line)
            if (line_idx < self.lines.items.len - 1) {
                total_bytes += 1; // for '\n'
            }
        }
        return total_bytes;
    }

    pub fn measureText(self: *const TextBuffer, text: []const u8) u32 {
        return gwidth.gwidth(text, self.width_method, &self.display_width);
    }

    pub fn reset(self: *TextBuffer) void {
        _ = self.arena.reset(if (self.arena.queryCapacity() > 0) .retain_capacity else .free_all);

        self.mem_registry.clear();
        self.char_count = 0;

        self.lines = .{};

        // Mark all registered views as dirty
        self.markAllViewsDirty();
    }

    pub fn setDefaultFg(self: *TextBuffer, fg: ?RGBA) void {
        self.default_fg = fg;
    }

    pub fn setDefaultBg(self: *TextBuffer, bg: ?RGBA) void {
        self.default_bg = bg;
    }

    pub fn setDefaultAttributes(self: *TextBuffer, attributes: ?u8) void {
        self.default_attributes = attributes;
    }

    pub fn resetDefaults(self: *TextBuffer) void {
        self.default_fg = null;
        self.default_bg = null;
        self.default_attributes = null;
    }

    /// Add a highlight to a specific line
    pub fn addHighlight(
        self: *TextBuffer,
        line_idx: usize,
        col_start: u32,
        col_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: ?u16,
    ) TextBufferError!void {
        if (line_idx >= self.lines.items.len) {
            return TextBufferError.InvalidIndex;
        }

        const hl = Highlight{
            .col_start = col_start,
            .col_end = col_end,
            .style_id = style_id,
            .priority = priority,
            .hl_ref = hl_ref,
        };

        try self.lines.items[line_idx].highlights.append(self.allocator, hl);
        try self.rebuildLineSpans(line_idx);
    }

    /// Remove all highlights with a specific reference ID
    pub fn removeHighlightsByRef(self: *TextBuffer, hl_ref: u16) void {
        for (self.lines.items, 0..) |*line, line_idx| {
            var i: usize = 0;
            var changed = false;
            while (i < line.highlights.items.len) {
                if (line.highlights.items[i].hl_ref) |ref| {
                    if (ref == hl_ref) {
                        _ = line.highlights.swapRemove(i);
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
    pub fn clearLineHighlights(self: *TextBuffer, line_idx: usize) void {
        if (line_idx < self.lines.items.len) {
            self.lines.items[line_idx].highlights.clearRetainingCapacity();
            self.rebuildLineSpans(line_idx) catch {};
        }
    }

    /// Clear all highlights from all lines
    pub fn clearAllHighlights(self: *TextBuffer) void {
        for (self.lines.items, 0..) |*line, line_idx| {
            line.highlights.clearRetainingCapacity();
            self.rebuildLineSpans(line_idx) catch {};
        }
    }

    /// Get highlights for a specific line
    pub fn getLineHighlights(self: *const TextBuffer, line_idx: usize) []const Highlight {
        if (line_idx < self.lines.items.len) {
            return self.lines.items[line_idx].highlights.items;
        }
        return &[_]Highlight{};
    }

    /// Get pre-computed style spans for a specific line
    pub fn getLineSpans(self: *const TextBuffer, line_idx: usize) []const StyleSpan {
        if (line_idx < self.lines.items.len) {
            return self.lines.items[line_idx].spans.items;
        }
        return &[_]StyleSpan{};
    }

    /// Convert row/col coordinates to absolute character offset
    /// Row is 0-based line index, col is 0-based column within that line
    /// Returns null if coordinates are out of bounds
    pub fn coordsToCharOffset(self: *const TextBuffer, row: u32, col: u32) ?u32 {
        if (row >= self.lines.items.len) return null;

        const line = &self.lines.items[row];
        if (col > line.width) return null;

        return line.char_offset + col;
    }

    /// Convert row/col coordinates to byte offset in the underlying memory buffer
    /// Returns the memory ID, byte offset, and remaining bytes in the chunk
    /// Returns null if coordinates are out of bounds
    pub fn coordsToByteOffset(self: *const TextBuffer, row: u32, col: u32) ?struct { mem_id: u8, byte_offset: u32 } {
        if (row >= self.lines.items.len) return null;

        const line = &self.lines.items[row];
        if (col > line.width) return null;

        // Find which chunk contains this column
        var current_col: u32 = 0;
        for (line.chunks.items) |*chunk| {
            if (col <= current_col + chunk.width) {
                // This chunk contains the target column
                const col_in_chunk = col - current_col;

                // Get graphemes for this chunk to find byte offset
                const graphemes = chunk.getGraphemes(
                    &self.mem_registry,
                    self.allocator,
                    &self.graphemes_data,
                    self.width_method,
                    &self.display_width,
                ) catch return null;

                // Walk through graphemes to find the byte offset
                var chars_so_far: u32 = 0;
                for (graphemes) |g| {
                    if (chars_so_far >= col_in_chunk) {
                        return .{
                            .mem_id = chunk.mem_id,
                            .byte_offset = chunk.byte_start + g.byte_offset,
                        };
                    }
                    chars_so_far += g.width;
                }

                // If we're at the end of the chunk, return end position
                return .{
                    .mem_id = chunk.mem_id,
                    .byte_offset = chunk.byte_end,
                };
            }
            current_col += chunk.width;
        }

        // Column is at the end of the line
        if (line.chunks.items.len > 0) {
            const last_chunk = &line.chunks.items[line.chunks.items.len - 1];
            return .{
                .mem_id = last_chunk.mem_id,
                .byte_offset = last_chunk.byte_end,
            };
        }

        return null;
    }

    /// Convert absolute character offset to row/col coordinates
    /// Returns null if offset is out of bounds
    pub fn charOffsetToCoords(self: *const TextBuffer, char_offset: u32) ?struct { row: u32, col: u32 } {
        if (self.lines.items.len == 0) return null;

        // Binary search to find the line containing this offset
        var left: usize = 0;
        var right: usize = self.lines.items.len;

        while (left < right) {
            const mid = left + (right - left) / 2;
            const line = &self.lines.items[mid];
            const line_end_char = if (mid + 1 < self.lines.items.len)
                self.lines.items[mid + 1].char_offset
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
        self: *TextBuffer,
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
        self: *TextBuffer,
        char_start: u32,
        char_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: ?u16,
    ) TextBufferError!void {
        if (char_start >= char_end or self.lines.items.len == 0) {
            return;
        }

        // Binary search to find the starting line
        var start_line_idx: usize = 0;
        {
            var left: usize = 0;
            var right: usize = self.lines.items.len;
            while (left < right) {
                const mid = left + (right - left) / 2;
                const line = &self.lines.items[mid];
                const line_end_char = if (mid + 1 < self.lines.items.len)
                    self.lines.items[mid + 1].char_offset
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
            if (left >= self.lines.items.len) return;
            if (left == right) start_line_idx = left;
        }

        const start_line = &self.lines.items[start_line_idx];
        const start_line_end_char = if (start_line_idx + 1 < self.lines.items.len)
            self.lines.items[start_line_idx + 1].char_offset
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
        while (line_idx < self.lines.items.len) {
            const line = &self.lines.items[line_idx];
            const line_end_char = if (line_idx + 1 < self.lines.items.len)
                self.lines.items[line_idx + 1].char_offset
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
    fn rebuildLineSpans(self: *TextBuffer, line_idx: usize) TextBufferError!void {
        if (line_idx >= self.lines.items.len) {
            return TextBufferError.InvalidIndex;
        }

        const line = &self.lines.items[line_idx];
        line.spans.clearRetainingCapacity();

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
                try line.spans.append(self.allocator, StyleSpan{
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
    pub fn setSyntaxStyle(self: *TextBuffer, syntax_style: ?*const SyntaxStyle) void {
        self.syntax_style = syntax_style;
    }

    /// Get the current syntax style
    pub fn getSyntaxStyle(self: *const TextBuffer) ?*const SyntaxStyle {
        return self.syntax_style;
    }

    /// Set the text content of the buffer
    /// Parses UTF-8 text into lines and grapheme clusters
    pub fn setText(self: *TextBuffer, text: []const u8) TextBufferError!void {
        self.reset();

        if (text.len == 0) {
            // Create empty line for empty text
            const empty_line = TextLine.init();
            try self.lines.append(self.allocator, empty_line);
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
            var final_line = TextLine.init();
            final_line.char_offset = self.char_count;
            try self.lines.append(self.allocator, final_line);
        }
    }

    /// Create a TextChunk from a memory buffer range
    /// Calculates width, but graphemes are computed lazily on first access
    fn createChunk(
        self: *const TextBuffer,
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
    fn parseLine(self: *TextBuffer, mem_id: u8, text: []const u8, byte_start: u32, byte_end: u32, _: bool) TextBufferError!void {
        var line = TextLine.init();
        line.char_offset = self.char_count;

        // Note: We don't include the newline character in the chunk
        // Newlines are implicit line separators, not counted as characters

        // Store the chunk with just byte references
        if (byte_start < byte_end) {
            const chunk = self.createChunk(mem_id, byte_start, byte_end);

            self.char_count += chunk.width;
            try line.chunks.append(self.allocator, chunk);
            line.width = chunk.width;
        }

        _ = text; // Suppress unused warning
        try self.lines.append(self.allocator, line);
    }

    /// Get the real line count (not virtual/wrapped lines)
    pub fn getLineCount(self: *const TextBuffer) u32 {
        return @intCast(self.lines.items.len);
    }

    pub fn getLines(self: *const TextBuffer) []const TextLine {
        return self.lines.items;
    }

    /// Get line info (starts, widths, max_width) from the buffer
    /// The returned slices are valid until the next setText/reset call
    pub fn getLineInfo(self: *const TextBuffer) struct {
        line_count: u32,
        starts: []const u32,
        widths: []const u32,
        max_width: u32,
    } {
        var starts = std.ArrayList(u32).init(self.allocator);
        var widths = std.ArrayList(u32).init(self.allocator);
        var max_width: u32 = 0;

        for (self.lines.items) |line| {
            starts.append(line.char_offset) catch {};
            widths.append(line.width) catch {};
            max_width = @max(max_width, line.width);
        }

        return .{
            .line_count = @intCast(self.lines.items.len),
            .starts = starts.items,
            .widths = widths.items,
            .max_width = max_width,
        };
    }

    /// Extract all text as UTF-8 bytes from the char buffer into provided output buffer
    /// Returns the number of bytes written to the output buffer
    pub fn getPlainTextIntoBuffer(self: *const TextBuffer, out_buffer: []u8) usize {
        var out_index: usize = 0;

        for (self.lines.items, 0..) |line, line_idx| {
            for (line.chunks.items) |chunk| {
                const chunk_bytes = chunk.getBytes(&self.mem_registry);
                const copy_len = @min(chunk_bytes.len, out_buffer.len - out_index);
                if (copy_len > 0) {
                    @memcpy(out_buffer[out_index .. out_index + copy_len], chunk_bytes[0..copy_len]);
                    out_index += copy_len;
                }
            }

            // Add newline between lines (except after last line)
            if (line_idx < self.lines.items.len - 1 and out_index < out_buffer.len) {
                out_buffer[out_index] = '\n';
                out_index += 1;
            }
        }

        return out_index;
    }

    /// Register a memory buffer with the text buffer
    /// Returns the memory ID that can be used to reference this buffer
    /// If owned is true, the buffer will be freed when the TextBuffer is destroyed
    pub fn registerMemBuffer(self: *TextBuffer, data: []const u8, owned: bool) TextBufferError!u8 {
        return try self.mem_registry.register(data, owned);
    }

    /// Get a memory buffer by its ID
    pub fn getMemBuffer(self: *const TextBuffer, mem_id: u8) ?[]const u8 {
        return self.mem_registry.get(mem_id);
    }

    /// Add a new line with a chunk
    pub fn addLine(
        self: *TextBuffer,
        mem_id: u8,
        byte_start: u32,
        byte_end: u32,
    ) TextBufferError!void {
        _ = self.mem_registry.get(mem_id) orelse return TextBufferError.InvalidMemId;

        const chunk = self.createChunk(mem_id, byte_start, byte_end);

        var line = TextLine.init();
        line.char_offset = self.char_count;
        line.width = chunk.width;

        try line.chunks.append(self.allocator, chunk);
        try self.lines.append(self.allocator, line);
        self.char_count += chunk.width;

        // Mark all views as dirty
        self.markAllViewsDirty();
    }
};
