const std = @import("std");
const Allocator = std.mem.Allocator;
const buffer = @import("buffer.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const logger = @import("logger.zig");

pub const RGBA = buffer.RGBA;
pub const TextSelection = buffer.TextSelection;

pub const USE_DEFAULT_FG: u16 = 0x8000;
pub const USE_DEFAULT_BG: u16 = 0x4000;
pub const USE_DEFAULT_ATTR: u16 = 0x2000;
pub const ATTR_MASK: u16 = 0x00FF;

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

/// A chunk represents a contiguous sequence of characters with the same styling
pub const TextChunk = struct {
    chars: []u32, // Chunk owns its character data
    fg: ?RGBA,
    bg: ?RGBA,
    attributes: u16,
};

pub const ChunkRef = struct {
    line_index: usize,
    chunk_index: usize,
};

/// A ChunkGroup tracks references to TextChunks that were created from a single writeChunk call
/// This allows mapping StyledText operations to the native text buffer
pub const ChunkGroup = struct {
    chunk_refs: std.ArrayListUnmanaged(ChunkRef),

    pub fn init() ChunkGroup {
        return .{
            .chunk_refs = .{},
        };
    }

    pub fn deinit(self: *ChunkGroup, allocator: Allocator) void {
        self.chunk_refs.deinit(allocator);
    }

    pub fn addChunkRef(self: *ChunkGroup, allocator: Allocator, line_index: usize, chunk_index: usize) !void {
        try self.chunk_refs.append(allocator, ChunkRef{
            .line_index = line_index,
            .chunk_index = chunk_index,
        });
    }

    pub fn getChunkCount(self: *const ChunkGroup) usize {
        return self.chunk_refs.items.len;
    }
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

    pub fn getStyle(self: *const VirtualChunk, text_buffer: *const TextBuffer) struct {
        fg: ?RGBA,
        bg: ?RGBA,
        attributes: u16,
    } {
        const chunk = &text_buffer.lines.items[self.source_line].chunks.items[self.source_chunk];
        return .{
            .fg = chunk.fg,
            .bg = chunk.bg,
            .attributes = chunk.attributes,
        };
    }
};

/// A virtual line represents a display line after text wrapping
pub const VirtualLine = struct {
    chunks: std.ArrayListUnmanaged(VirtualChunk),
    width: u32,
    char_offset: u32,

    pub fn init() VirtualLine {
        return .{
            .chunks = .{},
            .width = 0,
            .char_offset = 0,
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

pub const LocalSelection = struct {
    anchorX: i32,
    anchorY: i32,
    focusX: i32,
    focusY: i32,
    isActive: bool,
};

/// TextBuffer holds chunks of styled text organized by lines
pub const TextBuffer = struct {
    char_count: u32, // Total character count across all chunks
    selection: ?TextSelection,
    local_selection: ?LocalSelection,
    default_fg: ?RGBA,
    default_bg: ?RGBA,
    default_attributes: ?u8,

    allocator: Allocator,
    global_allocator: Allocator,
    arena: *std.heap.ArenaAllocator,
    virtual_lines_arena: *std.heap.ArenaAllocator,

    lines: std.ArrayListUnmanaged(TextLine),
    current_line: usize,
    current_line_width: u32,

    chunk_groups: std.ArrayListUnmanaged(*ChunkGroup),

    wrap_width: ?u32,
    wrap_mode: WrapMode,
    virtual_lines: std.ArrayListUnmanaged(VirtualLine),
    virtual_lines_dirty: bool,

    // Cached line info
    cached_line_starts: std.ArrayListUnmanaged(u32),
    cached_line_widths: std.ArrayListUnmanaged(u32),
    cached_max_width: u32,

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

        const virtual_lines_internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(virtual_lines_internal_arena);
        virtual_lines_internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const internal_allocator = internal_arena.allocator();
        const virtual_lines_allocator = virtual_lines_internal_arena.allocator();

        const graph = graphemes_data.*;
        const dw = display_width.*;

        var lines: std.ArrayListUnmanaged(TextLine) = .{};

        errdefer {
            for (lines.items) |*line| {
                line.deinit(internal_allocator);
            }
            lines.deinit(internal_allocator);
        }

        var chunk_groups: std.ArrayListUnmanaged(*ChunkGroup) = .{};
        errdefer chunk_groups.deinit(internal_allocator);

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

        const first_line = TextLine.init();
        lines.append(internal_allocator, first_line) catch return TextBufferError.OutOfMemory;

        self.* = .{
            .char_count = 0,
            .selection = null,
            .local_selection = null,
            .default_fg = null,
            .default_bg = null,
            .default_attributes = null,
            .allocator = internal_allocator,
            .global_allocator = global_allocator,
            .arena = internal_arena,
            .virtual_lines_arena = virtual_lines_internal_arena,
            .lines = lines,
            .current_line = 0,
            .current_line_width = 0,
            .chunk_groups = chunk_groups,
            .wrap_width = null,
            .wrap_mode = .char,
            .virtual_lines = virtual_lines,
            .virtual_lines_dirty = true,
            .cached_line_starts = cached_line_starts,
            .cached_line_widths = cached_line_widths,
            .cached_max_width = 0,
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
        self.virtual_lines_arena.deinit();
        self.arena.deinit();
        self.global_allocator.destroy(self.virtual_lines_arena);
        self.global_allocator.destroy(self.arena);
        self.global_allocator.destroy(self);
    }

    pub fn getLength(self: *const TextBuffer) u32 {
        return self.char_count;
    }

    pub fn reset(self: *TextBuffer) void {
        self.grapheme_tracker.clear();

        _ = self.arena.reset(if (self.arena.queryCapacity() > 0) .retain_capacity else .free_all);
        _ = self.virtual_lines_arena.reset(if (self.virtual_lines_arena.queryCapacity() > 0) .retain_capacity else .free_all);

        self.char_count = 0;
        self.current_line = 0;
        self.current_line_width = 0;
        self.local_selection = null;
        self.selection = null;

        self.lines = .{};
        self.chunk_groups = .{};
        self.virtual_lines = .{};
        self.cached_line_starts = .{};
        self.cached_line_widths = .{};
        self.cached_max_width = 0;
        // wrap_width is preserved across resets
        self.virtual_lines_dirty = true;

        const first_line = TextLine.init();
        self.lines.append(self.allocator, first_line) catch {};
    }

    pub fn setSelection(self: *TextBuffer, start: u32, end: u32, bgColor: ?RGBA, fgColor: ?RGBA) void {
        self.selection = TextSelection{
            .start = start,
            .end = end,
            .bgColor = bgColor,
            .fgColor = fgColor,
        };
    }

    pub fn resetSelection(self: *TextBuffer) void {
        self.selection = null;
    }

    pub fn getSelection(self: *const TextBuffer) ?TextSelection {
        return self.selection;
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

    /// Set the wrap width for text wrapping. null means no wrapping.
    pub fn setWrapWidth(self: *TextBuffer, width: ?u32) void {
        if (self.wrap_width != width) {
            self.wrap_width = width;
            self.virtual_lines_dirty = true;
        }
    }

    /// Set the wrap mode for text wrapping.
    pub fn setWrapMode(self: *TextBuffer, mode: WrapMode) void {
        if (self.wrap_mode != mode) {
            self.wrap_mode = mode;
            self.virtual_lines_dirty = true;
        }
    }

    /// Calculate how many characters from a chunk fit within the given width
    /// Returns the number of characters and their total width
    fn calculateChunkFit(_: *const TextBuffer, chars: []const u32, max_width: u32) ChunkFitResult {
        if (max_width == 0) return .{ .char_count = 0, .width = 0 };
        if (chars.len == 0) return .{ .char_count = 0, .width = 0 };

        const has_newline = chars[chars.len - 1] == '\n';
        const effective_len = if (has_newline) chars.len - 1 else chars.len;

        if (effective_len <= max_width) {
            if (has_newline) {
                return .{ .char_count = @intCast(chars.len), .width = @intCast(effective_len) };
            }
            return .{ .char_count = @intCast(chars.len), .width = @intCast(chars.len) };
        }

        const cut_pos = max_width;
        const char_at_cut = chars[cut_pos];

        if (gp.isContinuationChar(char_at_cut)) {
            const left_extent = gp.charLeftExtent(char_at_cut);
            const grapheme_start = cut_pos - left_extent;
            const grapheme_width = left_extent + 1 + gp.charRightExtent(char_at_cut);

            if (grapheme_start + grapheme_width <= max_width) {
                return .{ .char_count = grapheme_start + grapheme_width, .width = grapheme_start + grapheme_width };
            }

            return .{ .char_count = grapheme_start, .width = grapheme_start };
        } else if (gp.isGraphemeChar(char_at_cut)) {
            const grapheme_width = 1 + gp.charRightExtent(char_at_cut);

            if (cut_pos + grapheme_width > max_width) {
                return .{ .char_count = cut_pos, .width = cut_pos };
            }

            return .{ .char_count = cut_pos + grapheme_width, .width = cut_pos + grapheme_width };
        }

        return .{ .char_count = cut_pos, .width = cut_pos };
    }

    fn isWordBoundary(c: u32) bool {
        return switch (c) {
            ' ', '\t', '\r', '\n' => true, // Whitespace
            '-', '–', '—' => true, // Dashes and hyphens
            '/', '\\' => true, // Slashes
            '.', ',', ';', ':', '!', '?' => true, // Punctuation
            '(', ')', '[', ']', '{', '}' => true, // Brackets
            else => false,
        };
    }

    /// Calculate how many characters from a chunk fit within the given width (word wrapping)
    /// Returns the number of characters and their total width
    fn calculateChunkFitWord(self: *const TextBuffer, chars: []const u32, max_width: u32) ChunkFitResult {
        if (max_width == 0) return .{ .char_count = 0, .width = 0 };
        if (chars.len == 0) return .{ .char_count = 0, .width = 0 };

        const has_newline = chars[chars.len - 1] == '\n';
        const effective_len = if (has_newline) chars.len - 1 else chars.len;

        if (effective_len <= max_width) {
            if (has_newline) {
                return .{ .char_count = @intCast(chars.len), .width = @intCast(effective_len) };
            }
            return .{ .char_count = @intCast(chars.len), .width = @intCast(chars.len) };
        }

        var cut_pos = @min(max_width, @as(u32, @intCast(chars.len)));
        var found_boundary = false;

        while (cut_pos > 0) {
            cut_pos -= 1;
            const c = chars[cut_pos];

            if (gp.isContinuationChar(c)) {
                const left_extent = gp.charLeftExtent(c);
                cut_pos = cut_pos -| left_extent; // Saturating subtraction
                if (cut_pos == 0) break;
                continue;
            }

            if (isWordBoundary(c)) {
                cut_pos += 1;
                found_boundary = true;
                break;
            }
        }

        if (!found_boundary or cut_pos == 0) {
            // Check if we're at the beginning of a word that could fit on next line
            // First, find where this word ends
            var word_end: u32 = 0;
            while (word_end < chars.len and !isWordBoundary(chars[word_end])) : (word_end += 1) {}

            // TODO: we always have wrap_width set at this point?
            const line_width = if (self.wrap_width) |w| w else max_width;

            // If the word is longer than a full line width, we have to break it
            if (word_end > line_width) {
                cut_pos = max_width;
            } else {
                return .{ .char_count = 0, .width = 0 };
            }
            const char_at_cut = chars[cut_pos];

            if (gp.isContinuationChar(char_at_cut)) {
                const left_extent = gp.charLeftExtent(char_at_cut);
                const grapheme_start = cut_pos - left_extent;
                const grapheme_width = left_extent + 1 + gp.charRightExtent(char_at_cut);

                if (grapheme_start + grapheme_width <= max_width) {
                    return .{ .char_count = grapheme_start + grapheme_width, .width = grapheme_start + grapheme_width };
                }

                return .{ .char_count = grapheme_start, .width = grapheme_start };
            } else if (gp.isGraphemeChar(char_at_cut)) {
                const grapheme_width = 1 + gp.charRightExtent(char_at_cut);

                if (cut_pos + grapheme_width > max_width) {
                    return .{ .char_count = cut_pos, .width = cut_pos };
                }

                return .{ .char_count = cut_pos + grapheme_width, .width = cut_pos + grapheme_width };
            }
        }

        return .{ .char_count = cut_pos, .width = cut_pos };
    }

    /// Calculate the visual width of a chunk of characters
    fn calculateChunkWidth(_: *const TextBuffer, chars: []const u32) u32 {
        if (chars.len == 0) return 0;

        if (chars[chars.len - 1] == '\n') {
            return @intCast(chars.len - 1);
        }

        return @intCast(chars.len);
    }

    /// Update virtual lines based on current wrap width
    pub fn updateVirtualLines(self: *TextBuffer) void {
        if (!self.virtual_lines_dirty) return;

        _ = self.virtual_lines_arena.reset(.free_all);
        self.virtual_lines = .{};
        self.cached_line_starts = .{};
        self.cached_line_widths = .{};
        self.cached_max_width = 0;
        const virtual_allocator = self.virtual_lines_arena.allocator();

        if (self.wrap_width == null) {
            // No wrapping - create 1:1 mapping to real lines
            for (self.lines.items, 0..) |*line, line_idx| {
                var vline = VirtualLine.init();
                vline.width = line.width;
                vline.char_offset = line.char_offset;

                // Create virtual chunks that reference entire real chunks
                for (line.chunks.items, 0..) |*chunk, chunk_idx| {
                    vline.chunks.append(virtual_allocator, VirtualChunk{
                        .source_line = line_idx,
                        .source_chunk = chunk_idx,
                        .char_start = 0,
                        .char_count = @intCast(chunk.chars.len),
                        .width = self.calculateChunkWidth(chunk.chars),
                    }) catch {};
                }

                self.virtual_lines.append(virtual_allocator, vline) catch {};
                self.cached_line_starts.append(virtual_allocator, vline.char_offset) catch {};
                self.cached_line_widths.append(virtual_allocator, vline.width) catch {};
                self.cached_max_width = @max(self.cached_max_width, vline.width);
            }
        } else {
            // Wrap lines at wrap_width
            const wrap_w = self.wrap_width.?;
            var global_char_offset: u32 = 0;

            for (self.lines.items, 0..) |*line, line_idx| {
                var line_position: u32 = 0;
                var current_vline = VirtualLine.init();
                current_vline.char_offset = global_char_offset;
                var first_in_line = true;

                for (line.chunks.items, 0..) |*chunk, chunk_idx| {
                    var chunk_pos: u32 = 0;

                    while (chunk_pos < chunk.chars.len) {
                        const remaining_width = if (line_position < wrap_w) wrap_w - line_position else 0;
                        const remaining_chars = chunk.chars[chunk_pos..];

                        // Check if this is a newline at the start
                        if (remaining_chars.len > 0 and remaining_chars[0] == '\n') {
                            // Add the newline to current line and start a new line
                            current_vline.chunks.append(virtual_allocator, VirtualChunk{
                                .source_line = line_idx,
                                .source_chunk = chunk_idx,
                                .char_start = chunk_pos,
                                .char_count = 1,
                                .width = 0,
                            }) catch {};

                            current_vline.width = line_position;
                            self.virtual_lines.append(virtual_allocator, current_vline) catch {};
                            self.cached_line_starts.append(virtual_allocator, current_vline.char_offset) catch {};
                            self.cached_line_widths.append(virtual_allocator, current_vline.width) catch {};
                            self.cached_max_width = @max(self.cached_max_width, current_vline.width);

                            chunk_pos += 1;
                            global_char_offset += 1;

                            // Start new virtual line
                            current_vline = VirtualLine.init();
                            current_vline.char_offset = global_char_offset;
                            line_position = 0;
                            first_in_line = true;
                            continue;
                        }

                        const fit_result = switch (self.wrap_mode) {
                            .char => self.calculateChunkFit(remaining_chars, remaining_width),
                            .word => self.calculateChunkFitWord(remaining_chars, remaining_width),
                        };

                        // If nothing fits and we have content on the line, wrap to next line
                        if (fit_result.char_count == 0 and line_position > 0) {
                            current_vline.width = line_position;
                            self.virtual_lines.append(virtual_allocator, current_vline) catch {};
                            self.cached_line_starts.append(virtual_allocator, current_vline.char_offset) catch {};
                            self.cached_line_widths.append(virtual_allocator, current_vline.width) catch {};
                            self.cached_max_width = @max(self.cached_max_width, current_vline.width);

                            current_vline = VirtualLine.init();
                            current_vline.char_offset = global_char_offset;
                            line_position = 0;
                            first_in_line = false;
                            continue;
                        }

                        // TODO: what???
                        // If nothing fits even on empty line (char too wide), skip it
                        if (fit_result.char_count == 0) {
                            chunk_pos += 1;
                            global_char_offset += 1;
                            continue;
                        }

                        current_vline.chunks.append(virtual_allocator, VirtualChunk{
                            .source_line = line_idx,
                            .source_chunk = chunk_idx,
                            .char_start = chunk_pos,
                            .char_count = fit_result.char_count,
                            .width = fit_result.width,
                        }) catch {};

                        chunk_pos += fit_result.char_count;
                        global_char_offset += fit_result.char_count;
                        line_position += fit_result.width;

                        // Check if we need to wrap
                        if (line_position >= wrap_w and chunk_pos < chunk.chars.len) {
                            current_vline.width = line_position;
                            self.virtual_lines.append(virtual_allocator, current_vline) catch {};
                            self.cached_line_starts.append(virtual_allocator, current_vline.char_offset) catch {};
                            self.cached_line_widths.append(virtual_allocator, current_vline.width) catch {};
                            self.cached_max_width = @max(self.cached_max_width, current_vline.width);

                            current_vline = VirtualLine.init();
                            current_vline.char_offset = global_char_offset;
                            line_position = 0;
                        }
                    }
                }

                // Append the last virtual line if it has content or represents an empty line
                if (current_vline.chunks.items.len > 0 or line.chunks.items.len == 0) {
                    current_vline.width = line_position;
                    self.virtual_lines.append(virtual_allocator, current_vline) catch {};
                    self.cached_line_starts.append(virtual_allocator, current_vline.char_offset) catch {};
                    self.cached_line_widths.append(virtual_allocator, current_vline.width) catch {};
                    self.cached_max_width = @max(self.cached_max_width, current_vline.width);
                }
            }
        }

        self.virtual_lines_dirty = false;
    }

    /// Write a UTF-8 encoded text chunk with styling to the buffer
    /// Creates a new chunk with the specified styling and adds it to the current line
    pub fn writeChunk(self: *TextBuffer, textBytes: []const u8, fg: ?RGBA, bg: ?RGBA, attr: ?u8) TextBufferError!u32 {
        // Empty text creates a single chunk group
        if (textBytes.len == 0) {
            const chunk_group = self.allocator.create(ChunkGroup) catch return TextBufferError.OutOfMemory;
            chunk_group.* = ChunkGroup.init();
            errdefer {
                chunk_group.deinit(self.allocator);
                self.allocator.destroy(chunk_group);
            }
            self.chunk_groups.append(self.allocator, chunk_group) catch return TextBufferError.OutOfMemory;
            return 0;
        }

        const chunk_group = self.allocator.create(ChunkGroup) catch return TextBufferError.OutOfMemory;
        chunk_group.* = ChunkGroup.init();
        errdefer {
            chunk_group.deinit(self.allocator);
            self.allocator.destroy(chunk_group);
        }

        var attrValue: u16 = 0;

        // Handle default colors and attributes
        if (fg == null) {
            attrValue |= USE_DEFAULT_FG;
        }
        if (bg == null) {
            attrValue |= USE_DEFAULT_BG;
        }
        if (attr) |a| {
            attrValue |= @as(u16, a);
        } else {
            attrValue |= USE_DEFAULT_ATTR;
        }

        var iter = self.graphemes_data.iterator(textBytes);
        var cellCount: u32 = 0;

        // Temporary buffer to collect characters for current chunk
        var chunk_chars = std.ArrayList(u32).init(self.allocator);
        defer chunk_chars.deinit();

        var current_chunk_width: u32 = 0;

        iter = self.graphemes_data.iterator(textBytes);

        while (iter.next()) |gc| {
            const bytes = gc.bytes(textBytes);

            var required: u32 = 0;
            var encoded_char: u32 = 0;
            var is_newline: bool = false;

            if (bytes.len == 1 and bytes[0] == '\n') {
                required = 1;
                is_newline = true;
                encoded_char = '\n';
            } else {
                const width_u16: u16 = gwidth.gwidth(bytes, self.width_method, &self.display_width);
                if (width_u16 == 0) {
                    // zero-width/control cluster: skip
                    continue;
                }
                const width: u32 = @intCast(width_u16);
                required = width;

                if (bytes.len == 1 and width == 1 and bytes[0] >= 32) {
                    encoded_char = @as(u32, bytes[0]);
                } else {
                    const gid = self.pool.alloc(bytes) catch return TextBufferError.OutOfMemory;
                    encoded_char = gp.packGraphemeStart(gid & gp.GRAPHEME_ID_MASK, width);
                    self.grapheme_tracker.add(gid);
                }
            }

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

            if (is_newline) {
                if (chunk_chars.items.len > 0) {
                    // Allocate permanent storage for chunk chars from arena
                    const chunk_data = self.allocator.alloc(u32, chunk_chars.items.len) catch return TextBufferError.OutOfMemory;
                    @memcpy(chunk_data, chunk_chars.items);

                    const chunk = TextChunk{
                        .chars = chunk_data,
                        .fg = fg,
                        .bg = bg,
                        .attributes = attrValue,
                    };

                    if (self.current_line < self.lines.items.len) {
                        const chunk_index = self.lines.items[self.current_line].chunks.items.len;
                        self.lines.items[self.current_line].chunks.append(self.allocator, chunk) catch return TextBufferError.OutOfMemory;
                        self.lines.items[self.current_line].width += current_chunk_width;

                        chunk_group.addChunkRef(self.allocator, self.current_line, chunk_index) catch return TextBufferError.OutOfMemory;
                    }

                    chunk_chars.clearRetainingCapacity();
                    current_chunk_width = 0;
                }

                if (self.current_line < self.lines.items.len) {
                    self.lines.items[self.current_line].width = self.current_line_width;
                }

                self.current_line_width = 0;

                self.current_line += 1;
                if (self.current_line >= self.lines.items.len) {
                    var new_line = TextLine.init();
                    new_line.char_offset = self.char_count;
                    self.lines.append(self.allocator, new_line) catch return TextBufferError.OutOfMemory;
                }

                cellCount += 1;
            } else {
                current_chunk_width += required;
                self.current_line_width += required;
                cellCount += required;
            }
        }

        // Create final chunk if there's remaining content
        if (chunk_chars.items.len > 0) {
            // Allocate permanent storage for chunk chars from arena
            const chunk_data = self.allocator.alloc(u32, chunk_chars.items.len) catch return TextBufferError.OutOfMemory;
            @memcpy(chunk_data, chunk_chars.items);

            const chunk = TextChunk{
                .chars = chunk_data,
                .fg = fg,
                .bg = bg,
                .attributes = attrValue,
            };

            if (self.current_line < self.lines.items.len) {
                const chunk_index = self.lines.items[self.current_line].chunks.items.len;
                self.lines.items[self.current_line].chunks.append(self.allocator, chunk) catch return TextBufferError.OutOfMemory;
                self.lines.items[self.current_line].width += current_chunk_width;

                chunk_group.addChunkRef(self.allocator, self.current_line, chunk_index) catch return TextBufferError.OutOfMemory;
            }
        }

        self.chunk_groups.append(self.allocator, chunk_group) catch return TextBufferError.OutOfMemory;

        return cellCount << 1;
    }

    pub fn finalizeLineInfo(self: *TextBuffer) void {
        // Update the final line's width
        if (self.current_line < self.lines.items.len) {
            self.lines.items[self.current_line].width = self.current_line_width;
        }
        // Mark virtual lines as dirty so they get recalculated
        self.virtual_lines_dirty = true;
    }

    pub fn getLineCount(self: *TextBuffer) u32 {
        // Ensure virtual lines are up to date
        self.updateVirtualLines();
        // Return virtual line count if we have wrapping
        if (self.wrap_width != null) {
            return @intCast(self.virtual_lines.items.len);
        }
        return @intCast(self.lines.items.len);
    }

    /// Format: [start:u32][end:u32] packed into u64
    /// If no selection, returns 0xFFFFFFFF_FFFFFFFF (all bits set)
    pub fn packSelectionInfo(self: *const TextBuffer) u64 {
        if (self.selection) |sel| {
            return (@as(u64, sel.start) << 32) | @as(u64, sel.end);
        } else {
            return 0xFFFF_FFFF_FFFF_FFFF;
        }
    }

    /// Set local selection coordinates and automatically calculate character positions
    /// Returns true if the selection changed, false otherwise
    pub fn setLocalSelection(self: *TextBuffer, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?RGBA, fgColor: ?RGBA) bool {
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

    pub fn resetLocalSelection(self: *TextBuffer) void {
        self.local_selection = null;
        self.selection = null;
    }

    /// Calculate character positions from local selection coordinates
    /// Returns null if no valid selection
    fn calculateMultiLineSelection(self: *TextBuffer) ?struct { start: u32, end: u32 } {
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
                self.virtual_lines.items[i + 1].char_offset - 1
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
    pub fn getSelectedTextIntoBuffer(self: *const TextBuffer, out_buffer: []u8) usize {
        const selection = self.selection orelse return 0;
        const start = selection.start;
        const end = selection.end;

        var out_index: usize = 0;
        var count: u32 = 0;

        // Iterate through all lines and chunks, similar to rendering
        for (self.lines.items) |line| {
            for (line.chunks.items) |chunk| {
                var chunk_char_index: u32 = 0;
                while (chunk_char_index < chunk.chars.len and count < end and out_index < out_buffer.len) : (chunk_char_index += 1) {
                    const c = chunk.chars[chunk_char_index];

                    if (!gp.isContinuationChar(c)) {
                        if (count >= start) {
                            if (gp.isGraphemeChar(c)) {
                                const gid = gp.graphemeIdFromChar(c);
                                const grapheme_bytes = self.pool.get(gid) catch continue;
                                const copy_len = @min(grapheme_bytes.len, out_buffer.len - out_index);
                                @memcpy(out_buffer[out_index .. out_index + copy_len], grapheme_bytes[0..copy_len]);
                                out_index += copy_len;
                            } else {
                                var utf8_buf: [4]u8 = undefined;
                                const utf8_len = std.unicode.utf8Encode(@intCast(c), &utf8_buf) catch 1;
                                const copy_len = @min(utf8_len, out_buffer.len - out_index);
                                @memcpy(out_buffer[out_index .. out_index + copy_len], utf8_buf[0..copy_len]);
                                out_index += copy_len;
                            }
                        }
                        count += 1;

                        // Skip continuation characters for graphemes
                        if (gp.isGraphemeChar(c)) {
                            const right_extent = gp.charRightExtent(c);
                            var k: u32 = 0;
                            while (k < right_extent and chunk_char_index + 1 < chunk.chars.len) : (k += 1) {
                                chunk_char_index += 1;
                                // Verify the continuation character exists
                                if (chunk_char_index >= chunk.chars.len or !gp.isContinuationChar(chunk.chars[chunk_char_index])) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        return out_index;
    }

    /// Extract all text as UTF-8 bytes from the char buffer into provided output buffer
    /// Returns the number of bytes written to the output buffer
    pub fn getPlainTextIntoBuffer(self: *const TextBuffer, out_buffer: []u8) usize {
        var out_index: usize = 0;

        // Iterate through all lines and chunks, similar to rendering
        for (self.lines.items) |line| {
            for (line.chunks.items) |chunk| {
                var chunk_char_index: u32 = 0;
                while (chunk_char_index < chunk.chars.len and out_index < out_buffer.len) : (chunk_char_index += 1) {
                    const c = chunk.chars[chunk_char_index];

                    if (!gp.isContinuationChar(c)) {
                        if (gp.isGraphemeChar(c)) {
                            const gid = gp.graphemeIdFromChar(c);
                            const grapheme_bytes = self.pool.get(gid) catch continue;
                            const copy_len = @min(grapheme_bytes.len, out_buffer.len - out_index);
                            @memcpy(out_buffer[out_index .. out_index + copy_len], grapheme_bytes[0..copy_len]);
                            out_index += copy_len;
                        } else {
                            var utf8_buf: [4]u8 = undefined;
                            const utf8_len = std.unicode.utf8Encode(@intCast(c), &utf8_buf) catch 1;
                            const copy_len = @min(utf8_len, out_buffer.len - out_index);
                            @memcpy(out_buffer[out_index .. out_index + copy_len], utf8_buf[0..copy_len]);
                            out_index += copy_len;
                        }

                        // Skip continuation characters for graphemes
                        if (gp.isGraphemeChar(c)) {
                            const right_extent = gp.charRightExtent(c);
                            var k: u32 = 0;
                            while (k < right_extent and chunk_char_index + 1 < chunk.chars.len) : (k += 1) {
                                chunk_char_index += 1;
                                // Verify the continuation character exists
                                if (chunk_char_index >= chunk.chars.len or !gp.isContinuationChar(chunk.chars[chunk_char_index])) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        return out_index;
    }

    /// Insert a chunk group at the specified index
    /// This maps to StyledText.insert() operation
    pub fn insertChunkGroup(self: *TextBuffer, index: usize, text_bytes: []const u8, fg: ?RGBA, bg: ?RGBA, attr: ?u8) TextBufferError!u32 {
        if (text_bytes.len == 0) return self.char_count;

        // Save the current state to identify newly created chunks
        const old_line_count = self.lines.items.len;
        const old_last_line_chunk_count = if (old_line_count > 0)
            self.lines.items[old_line_count - 1].chunks.items.len
        else
            0;

        // Use writeChunk to parse and create chunks, then pop the group
        _ = try self.writeChunk(text_bytes, fg, bg, attr);
        const new_chunk_group = self.chunk_groups.pop() orelse return TextBufferError.InvalidIndex;

        if (index >= self.chunk_groups.items.len) {
            self.chunk_groups.append(self.allocator, new_chunk_group) catch return TextBufferError.OutOfMemory;
            return self.char_count;
        }

        // Move chunks from where writeChunk put them to the correct insertion point
        const target_group = self.chunk_groups.items[index];
        const insert_line_idx = if (target_group.chunk_refs.items.len > 0)
            target_group.chunk_refs.items[0].line_index
        else
            0;
        const insert_chunk_idx = if (target_group.chunk_refs.items.len > 0)
            target_group.chunk_refs.items[0].chunk_index
        else
            0;

        // Collect all newly created chunks
        var new_chunks: std.ArrayListUnmanaged(TextChunk) = .{};
        defer new_chunks.deinit(self.allocator);

        // If writeChunk created new lines, those chunks are new
        const current_line_count = self.lines.items.len;
        if (current_line_count > old_line_count) {
            for (old_line_count..current_line_count) |line_idx| {
                for (self.lines.items[line_idx].chunks.items) |chunk| {
                    try new_chunks.append(self.allocator, chunk);
                }
            }
            // Remove the extra lines created by writeChunk
            while (self.lines.items.len > old_line_count) {
                var line = self.lines.pop() orelse break;
                line.chunks.clearRetainingCapacity(); // Don't deinit, we moved the chunks
            }
        }

        // Also get new chunks added to the last existing line
        if (old_line_count > 0) {
            var last_line = &self.lines.items[old_line_count - 1];
            while (last_line.chunks.items.len > old_last_line_chunk_count) {
                const chunk = last_line.chunks.pop() orelse break;
                try new_chunks.insert(self.allocator, 0, chunk); // Insert at beginning to maintain order
            }
        }

        // Now insert the new chunks at the target location
        if (insert_line_idx < self.lines.items.len and new_chunks.items.len > 0) {
            var target_line = &self.lines.items[insert_line_idx];

            // Insert all new chunks at the target position
            for (new_chunks.items, 0..) |chunk, i| {
                try target_line.chunks.insert(self.allocator, insert_chunk_idx + i, chunk);
            }

            // Update chunk refs to point to the newly inserted chunks
            for (new_chunk_group.chunk_refs.items, 0..) |*ref, i| {
                ref.line_index = insert_line_idx;
                ref.chunk_index = insert_chunk_idx + i;
            }
        }

        self.chunk_groups.insert(self.allocator, index, new_chunk_group) catch return TextBufferError.OutOfMemory;

        return self.char_count;
    }

    /// Remove a chunk group at the specified index
    /// This maps to StyledText.remove() operation
    pub fn removeChunkGroup(self: *TextBuffer, index: usize) TextBufferError!u32 {
        if (index >= self.chunk_groups.items.len) return TextBufferError.InvalidIndex;

        const chunk_group = self.chunk_groups.items[index];

        var i = chunk_group.chunk_refs.items.len;
        while (i > 0) {
            i -= 1;
            const chunk_ref = chunk_group.chunk_refs.items[i];
            if (chunk_ref.line_index < self.lines.items.len and
                chunk_ref.chunk_index < self.lines.items[chunk_ref.line_index].chunks.items.len)
            {
                _ = self.lines.items[chunk_ref.line_index].chunks.orderedRemove(chunk_ref.chunk_index);
            }
        }

        _ = self.chunk_groups.orderedRemove(index);
        chunk_group.deinit(self.allocator);
        self.allocator.destroy(chunk_group);

        return self.char_count;
    }

    /// Replace a chunk group at the specified index
    /// This maps to StyledText.replace() operation
    pub fn replaceChunkGroup(self: *TextBuffer, index: usize, text_bytes: []const u8, fg: ?RGBA, bg: ?RGBA, attr: ?u8) TextBufferError!u32 {
        if (index >= self.chunk_groups.items.len) return TextBufferError.InvalidIndex;

        _ = try self.removeChunkGroup(index);

        return try self.insertChunkGroup(index, text_bytes, fg, bg, attr);
    }

    /// Get the number of chunk groups
    pub fn getChunkGroupCount(self: *const TextBuffer) usize {
        return self.chunk_groups.items.len;
    }

    /// Get a chunk group by index
    pub fn getChunkGroup(self: *const TextBuffer, index: usize) ?*const ChunkGroup {
        if (index >= self.chunk_groups.items.len) return null;
        return self.chunk_groups.items[index];
    }

    /// Get cached line info (line starts and widths)
    /// Returns the maximum line width
    pub fn getCachedLineInfo(self: *TextBuffer) struct {
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
};
