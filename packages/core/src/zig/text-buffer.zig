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
};

pub const WrapMode = enum {
    char,
    word,
};

pub const ChunkFitResult = struct {
    char_count: u32,
    width: u32,
};

/// A chunk represents a contiguous sequence of characters
pub const TextChunk = struct {
    byte_start: u32, // Offset into TextBuffer.text_bytes
    byte_end: u32, // Offset into TextBuffer.text_bytes
    chars: []u32, // Pre-packed u32s (grapheme starts + continuations)
    width: u32, // Display width in cells
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

/// A virtual chunk references a portion of a real TextChunk for text wrapping
pub const VirtualChunk = struct {
    source_line: usize,
    source_chunk: usize,
    char_start: u32,
    char_count: u32,
    width: u32,

    pub fn getChars(self: *const VirtualChunk, text_buffer: *const TextBuffer) []const u32 {
        const chunk = &text_buffer.lines.items[self.source_line].chunks.items[self.source_chunk];
        return chunk.chars[self.char_start .. self.char_start + self.char_count];
    }
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

/// A line contains multiple chunks and tracks its total width
pub const TextLine = struct {
    chunks: std.ArrayListUnmanaged(TextChunk),
    width: u32,
    char_offset: u32, // Cumulative char offset for selection tracking

    pub fn init() TextLine {
        return .{
            .chunks = .{},
            .width = 0,
            .char_offset = 0,
        };
    }

    pub fn deinit(self: *TextLine, allocator: Allocator) void {
        self.chunks.deinit(allocator);
    }
};

/// TextBuffer holds text organized by lines without styling
pub const TextBuffer = struct {
    text_bytes: []const u8, // Reference to external UTF-8 bytes
    char_count: u32, // Total character count across all chunks
    default_fg: ?RGBA,
    default_bg: ?RGBA,
    default_attributes: ?u8,

    allocator: Allocator,
    global_allocator: Allocator,
    arena: *std.heap.ArenaAllocator,

    lines: std.ArrayListUnmanaged(TextLine),
    line_highlights: std.ArrayListUnmanaged(std.ArrayListUnmanaged(Highlight)),
    line_spans: std.ArrayListUnmanaged(std.ArrayListUnmanaged(StyleSpan)),
    syntax_style: ?*const SyntaxStyle,

    pool: *gp.GraphemePool,
    graphemes_data: Graphemes,
    display_width: DisplayWidth,
    grapheme_tracker: gp.GraphemeTracker,
    width_method: gwidth.WidthMethod,

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

        var line_highlights: std.ArrayListUnmanaged(std.ArrayListUnmanaged(Highlight)) = .{};
        errdefer line_highlights.deinit(internal_allocator);

        var line_spans: std.ArrayListUnmanaged(std.ArrayListUnmanaged(StyleSpan)) = .{};
        errdefer line_spans.deinit(internal_allocator);

        self.* = .{
            .text_bytes = &[_]u8{},
            .char_count = 0,
            .default_fg = null,
            .default_bg = null,
            .default_attributes = null,
            .allocator = internal_allocator,
            .global_allocator = global_allocator,
            .arena = internal_arena,
            .lines = lines,
            .line_highlights = line_highlights,
            .line_spans = line_spans,
            .syntax_style = null,
            .pool = pool,
            .graphemes_data = graph,
            .display_width = dw,
            .grapheme_tracker = gp.GraphemeTracker.init(global_allocator, pool),
            .width_method = width_method,
        };

        return self;
    }

    pub fn deinit(self: *TextBuffer) void {
        self.grapheme_tracker.deinit();
        self.arena.deinit();
        self.global_allocator.destroy(self.arena);
        self.global_allocator.destroy(self);
    }

    pub fn getLength(self: *const TextBuffer) u32 {
        return self.char_count;
    }

    pub fn getByteSize(self: *const TextBuffer) u32 {
        return @intCast(self.text_bytes.len);
    }

    pub fn measureText(self: *const TextBuffer, text: []const u8) u32 {
        return gwidth.gwidth(text, self.width_method, &self.display_width);
    }

    pub fn reset(self: *TextBuffer) void {
        self.grapheme_tracker.clear();

        _ = self.arena.reset(if (self.arena.queryCapacity() > 0) .retain_capacity else .free_all);

        self.text_bytes = &[_]u8{};
        self.char_count = 0;

        self.lines = .{};
        self.line_highlights = .{};
        self.line_spans = .{};
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
        // Ensure line_highlights is sized to include this line
        while (self.line_highlights.items.len <= line_idx) {
            try self.line_highlights.append(
                self.allocator,
                std.ArrayListUnmanaged(Highlight){},
            );
        }

        const hl = Highlight{
            .col_start = col_start,
            .col_end = col_end,
            .style_id = style_id,
            .priority = priority,
            .hl_ref = hl_ref,
        };

        try self.line_highlights.items[line_idx].append(self.allocator, hl);
        try self.rebuildLineSpans(line_idx);
    }

    /// Remove all highlights with a specific reference ID
    pub fn removeHighlightsByRef(self: *TextBuffer, hl_ref: u16) void {
        for (self.line_highlights.items, 0..) |*line_hls, line_idx| {
            var i: usize = 0;
            var changed = false;
            while (i < line_hls.items.len) {
                if (line_hls.items[i].hl_ref) |ref| {
                    if (ref == hl_ref) {
                        _ = line_hls.swapRemove(i);
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
        if (line_idx < self.line_highlights.items.len) {
            self.line_highlights.items[line_idx].clearRetainingCapacity();
            self.rebuildLineSpans(line_idx) catch {};
        }
    }

    /// Clear all highlights from all lines
    pub fn clearAllHighlights(self: *TextBuffer) void {
        for (self.line_highlights.items, 0..) |*line_hls, line_idx| {
            line_hls.clearRetainingCapacity();
            self.rebuildLineSpans(line_idx) catch {};
        }
    }

    /// Get highlights for a specific line
    pub fn getLineHighlights(self: *const TextBuffer, line_idx: usize) []const Highlight {
        if (line_idx < self.line_highlights.items.len) {
            return self.line_highlights.items[line_idx].items;
        }
        return &[_]Highlight{};
    }

    /// Get pre-computed style spans for a specific line
    pub fn getLineSpans(self: *const TextBuffer, line_idx: usize) []const StyleSpan {
        if (line_idx < self.line_spans.items.len) {
            return self.line_spans.items[line_idx].items;
        }
        return &[_]StyleSpan{};
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
        // Ensure line_spans is sized
        while (self.line_spans.items.len <= line_idx) {
            try self.line_spans.append(
                self.allocator,
                std.ArrayListUnmanaged(StyleSpan){},
            );
        }

        self.line_spans.items[line_idx].clearRetainingCapacity();

        if (line_idx >= self.line_highlights.items.len or self.line_highlights.items[line_idx].items.len == 0) {
            return; // No highlights, rendering will use defaults
        }

        const highlights = self.line_highlights.items[line_idx].items;

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
                try self.line_spans.items[line_idx].append(self.allocator, StyleSpan{
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

        // Reference the external text (no copy)
        self.text_bytes = text;

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
                try self.parseLine(line_start, line_end, true);

                pos = @intCast(nl_pos + 1);
                line_start = pos;
                has_trailing_newline = (pos == text.len);
            } else {
                // Last line (no trailing \n)
                try self.parseLine(line_start, @intCast(text.len), false);
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

    /// Parse a single line into chunks with grapheme clusters
    fn parseLine(self: *TextBuffer, byte_start: u32, byte_end: u32, _: bool) TextBufferError!void {
        var line = TextLine.init();
        line.char_offset = self.char_count;

        const line_bytes = self.text_bytes[byte_start..byte_end];

        // Temporary buffer to collect characters for the line chunk
        var chunk_chars = std.ArrayList(u32).init(self.allocator);
        defer chunk_chars.deinit();

        var chunk_width: u32 = 0;
        var iter = self.graphemes_data.iterator(line_bytes);

        while (iter.next()) |gc| {
            const gbytes = gc.bytes(line_bytes);
            const width_u16: u16 = gwidth.gwidth(gbytes, self.width_method, &self.display_width);

            if (width_u16 == 0) {
                // Zero-width or control cluster: skip
                continue;
            }

            const width: u32 = @intCast(width_u16);
            var encoded_char: u32 = 0;

            // Encode the grapheme cluster
            if (gbytes.len == 1 and width == 1 and gbytes[0] >= 32) {
                encoded_char = @as(u32, gbytes[0]);
            } else {
                const gid = self.pool.allocUnowned(gbytes) catch return TextBufferError.OutOfMemory;
                encoded_char = gp.packGraphemeStart(gid & gp.GRAPHEME_ID_MASK, width);
                self.grapheme_tracker.add(gid);
            }

            // Pack the start + continuations
            if (gp.isGraphemeChar(encoded_char)) {
                const right = gp.charRightExtent(encoded_char);
                const gid: u32 = gp.graphemeIdFromChar(encoded_char);

                try chunk_chars.append(encoded_char);
                self.char_count += 1;

                var k: u32 = 1;
                while (k <= right) : (k += 1) {
                    const cont = gp.packContinuation(k, right - k, gid);
                    try chunk_chars.append(cont);
                    self.char_count += 1;
                }
            } else {
                try chunk_chars.append(encoded_char);
                self.char_count += 1;
            }

            chunk_width += width;
        }

        // Note: We don't include the newline character in the chunk
        // Newlines are implicit line separators, not counted as characters

        // Store the chunk with pre-computed u32s
        if (chunk_chars.items.len > 0) {
            const chunk_data = self.allocator.alloc(u32, chunk_chars.items.len) catch return TextBufferError.OutOfMemory;
            @memcpy(chunk_data, chunk_chars.items);

            const chunk = TextChunk{
                .byte_start = byte_start,
                .byte_end = byte_end,
                .chars = chunk_data,
                .width = chunk_width,
            };

            try line.chunks.append(self.allocator, chunk);
            line.width = chunk_width;
        }

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
        // Simply copy the original text bytes which already contain newlines
        const copy_len = @min(self.text_bytes.len, out_buffer.len);
        @memcpy(out_buffer[0..copy_len], self.text_bytes[0..copy_len]);
        return copy_len;
    }
};
