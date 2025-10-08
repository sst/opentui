const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const TextBuffer = tb.TextBuffer;
const RGBA = tb.RGBA;
const TextSelection = tb.TextSelection;
const WrapMode = tb.WrapMode;
const StyleSpan = tb.StyleSpan;

pub const TextBufferViewError = error{
    OutOfMemory,
};

/// Cached grapheme cluster information for a chunk
pub const GraphemeInfo = struct {
    byte_offset: u32, // Offset within the chunk's bytes
    byte_len: u8, // Length in UTF-8 bytes
    width: u8, // Display width (1, 2, etc.)
};

/// Cache key for chunk grapheme info
pub const ChunkCacheKey = struct {
    line_idx: u32,
    chunk_idx: u32,

    pub fn hash(self: ChunkCacheKey) u64 {
        return (@as(u64, self.line_idx) << 32) | @as(u64, self.chunk_idx);
    }

    pub fn eql(self: ChunkCacheKey, other: ChunkCacheKey) bool {
        return self.line_idx == other.line_idx and self.chunk_idx == other.chunk_idx;
    }
};

/// Cached grapheme information for a chunk
pub const ChunkCache = struct {
    graphemes: []GraphemeInfo,
    total_width: u32,
    total_chars: u32,
};

/// A virtual chunk references a portion of a real TextChunk for text wrapping
pub const VirtualChunk = struct {
    source_line: usize,
    source_chunk: usize,
    grapheme_start: u32, // Index into cached graphemes
    grapheme_count: u32, // Number of grapheme clusters
    width: u32,
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
pub const TextBufferView = struct {
    text_buffer: *TextBuffer, // Reference to the underlying buffer (not owned)
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

    // Grapheme cluster cache per chunk
    chunk_cache: std.AutoHashMap(u64, ChunkCache),

    // Memory management
    global_allocator: Allocator,
    virtual_lines_arena: *std.heap.ArenaAllocator,

    pub fn init(global_allocator: Allocator, text_buffer: *TextBuffer) TextBufferViewError!*TextBufferView {
        const self = global_allocator.create(TextBufferView) catch return TextBufferViewError.OutOfMemory;
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

        var chunk_cache = std.AutoHashMap(u64, ChunkCache).init(global_allocator);
        errdefer chunk_cache.deinit();

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
            .chunk_cache = chunk_cache,
            .global_allocator = global_allocator,
            .virtual_lines_arena = virtual_lines_internal_arena,
        };

        return self;
    }

    pub fn deinit(self: *TextBufferView) void {
        // Unregister from the text buffer
        self.text_buffer.unregisterView(self.view_id);

        // Clean up chunk cache
        var it = self.chunk_cache.valueIterator();
        while (it.next()) |cache| {
            self.global_allocator.free(cache.graphemes);
        }
        self.chunk_cache.deinit();

        self.virtual_lines_arena.deinit();
        self.global_allocator.destroy(self.virtual_lines_arena);
        self.global_allocator.destroy(self);
    }

    pub fn setSelection(self: *TextBufferView, start: u32, end: u32, bgColor: ?RGBA, fgColor: ?RGBA) void {
        self.selection = TextSelection{
            .start = start,
            .end = end,
            .bgColor = bgColor,
            .fgColor = fgColor,
        };
    }

    pub fn resetSelection(self: *TextBufferView) void {
        self.selection = null;
    }

    pub fn getSelection(self: *const TextBufferView) ?TextSelection {
        return self.selection;
    }

    /// Set the wrap width for text wrapping. null means no wrapping.
    pub fn setWrapWidth(self: *TextBufferView, width: ?u32) void {
        if (self.wrap_width != width) {
            self.wrap_width = width;
            self.virtual_lines_dirty = true;
        }
    }

    /// Set the wrap mode for text wrapping.
    pub fn setWrapMode(self: *TextBufferView, mode: WrapMode) void {
        if (self.wrap_mode != mode) {
            self.wrap_mode = mode;
            self.virtual_lines_dirty = true;
        }
    }

    /// Get or create cached grapheme info for a chunk
    /// Returns a slice of GraphemeInfo that is valid until the cache is cleared
    pub fn getOrCreateChunkCache(self: *TextBufferView, line_idx: usize, chunk_idx: usize) TextBufferViewError![]const GraphemeInfo {
        const key = ChunkCacheKey{ .line_idx = @intCast(line_idx), .chunk_idx = @intCast(chunk_idx) };
        const hash_key = key.hash();

        if (self.chunk_cache.get(hash_key)) |cache| {
            return cache.graphemes;
        }

        // Build cache for this chunk
        const lines = self.text_buffer.getLines();
        const chunk = &lines[line_idx].chunks.items[chunk_idx];
        const chunk_bytes = chunk.getBytes(self.text_buffer.text_bytes);

        var grapheme_list = std.ArrayList(GraphemeInfo).init(self.global_allocator);
        defer grapheme_list.deinit();

        var total_width: u32 = 0;
        var total_chars: u32 = 0;

        var iter = self.text_buffer.graphemes_data.iterator(chunk_bytes);
        var byte_pos: u32 = 0;

        while (iter.next()) |gc| {
            const gbytes = gc.bytes(chunk_bytes);
            const width_u16: u16 = gwidth.gwidth(gbytes, self.text_buffer.width_method, &self.text_buffer.display_width);

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

            total_width += width;
            total_chars += width; // Each grapheme contributes 'width' cells
            byte_pos += @intCast(gbytes.len);
        }

        const graphemes = try self.global_allocator.dupe(GraphemeInfo, grapheme_list.items);

        try self.chunk_cache.put(hash_key, ChunkCache{
            .graphemes = graphemes,
            .total_width = total_width,
            .total_chars = total_chars,
        });

        return graphemes;
    }

    /// Calculate how many graphemes from a chunk fit within the given width
    /// Returns the number of grapheme clusters and their total width
    fn calculateChunkFit(_: *const TextBufferView, graphemes: []const GraphemeInfo, max_width: u32) tb.ChunkFitResult {
        if (max_width == 0) return .{ .char_count = 0, .width = 0 };
        if (graphemes.len == 0) return .{ .char_count = 0, .width = 0 };

        var total_width: u32 = 0;
        var count: u32 = 0;

        for (graphemes) |g| {
            if (total_width + g.width > max_width) {
                break;
            }
            total_width += g.width;
            count += g.width; // Each grapheme contributes 'width' cells
        }

        return .{ .char_count = count, .width = total_width };
    }

    fn isWordBoundaryByte(c: u8) bool {
        return switch (c) {
            ' ', '\t', '\r', '\n' => true, // Whitespace
            '-' => true, // Dash
            '/', '\\' => true, // Slashes
            '.', ',', ';', ':', '!', '?' => true, // Punctuation
            '(', ')', '[', ']', '{', '}' => true, // Brackets
            else => false,
        };
    }

    /// Calculate how many graphemes from a chunk fit within the given width (word wrapping)
    /// Returns the number of grapheme clusters and their total width
    /// chunk_bytes should be the full chunk bytes, not a slice
    fn calculateChunkFitWord(self: *const TextBufferView, chunk_bytes: []const u8, graphemes: []const GraphemeInfo, max_width: u32) tb.ChunkFitResult {
        if (max_width == 0) return .{ .char_count = 0, .width = 0 };
        if (graphemes.len == 0) return .{ .char_count = 0, .width = 0 };

        var total_width: u32 = 0;
        var last_boundary_idx: ?usize = null;
        var last_boundary_width: u32 = 0;
        var last_boundary_chars: u32 = 0;

        for (graphemes, 0..) |g, idx| {
            if (total_width + g.width > max_width) {
                // Can't fit this grapheme
                if (last_boundary_idx) |_| {
                    // Wrap at last word boundary
                    return .{ .char_count = last_boundary_chars, .width = last_boundary_width };
                } else {
                    // No boundary found - either wrap at beginning or force break
                    const line_width = if (self.wrap_width) |w| w else max_width;

                    // Check if first word is too long for any line
                    var word_width: u32 = 0;
                    for (graphemes) |wg| {
                        const first_byte = chunk_bytes[wg.byte_offset];
                        if (isWordBoundaryByte(first_byte)) break;
                        word_width += wg.width;
                    }

                    if (word_width > line_width) {
                        // Force break the word
                        var forced_width: u32 = 0;
                        var forced_count: u32 = 0;
                        for (graphemes) |fg| {
                            if (forced_width + fg.width > max_width) break;
                            forced_width += fg.width;
                            forced_count += fg.width;
                        }
                        return .{ .char_count = forced_count, .width = forced_width };
                    }

                    // Word can fit on next line
                    return .{ .char_count = 0, .width = 0 };
                }
            }

            total_width += g.width;

            // Check if this grapheme is a word boundary
            const first_byte = chunk_bytes[g.byte_offset];
            if (isWordBoundaryByte(first_byte)) {
                last_boundary_idx = idx + 1; // After this boundary
                last_boundary_width = total_width;
                last_boundary_chars = total_width; // Sum of widths so far
            }
        }

        // All graphemes fit
        var count: u32 = 0;
        for (graphemes) |g| {
            count += g.width;
        }
        return .{ .char_count = count, .width = total_width };
    }

    /// Update virtual lines based on current wrap width
    pub fn updateVirtualLines(self: *TextBufferView) void {
        // Check both local and buffer dirty flags
        const buffer_dirty = self.text_buffer.isViewDirty(self.view_id);
        if (!self.virtual_lines_dirty and !buffer_dirty) return;

        // Clear chunk cache if buffer is dirty
        if (buffer_dirty) {
            var it = self.chunk_cache.valueIterator();
            while (it.next()) |cache| {
                self.global_allocator.free(cache.graphemes);
            }
            self.chunk_cache.clearRetainingCapacity();
        }

        _ = self.virtual_lines_arena.reset(.free_all);
        self.virtual_lines = .{};
        self.cached_line_starts = .{};
        self.cached_line_widths = .{};
        self.cached_max_width = 0;
        const virtual_allocator = self.virtual_lines_arena.allocator();

        const lines = self.text_buffer.getLines();

        if (self.wrap_width == null) {
            // No wrapping - create 1:1 mapping to real lines
            for (lines, 0..) |*line, line_idx| {
                var vline = VirtualLine.init();
                vline.width = line.width;
                vline.char_offset = line.char_offset;
                vline.source_line = line_idx;
                vline.source_col_offset = 0;

                // Create virtual chunks that reference entire real chunks
                for (line.chunks.items, 0..) |*chunk, chunk_idx| {
                    vline.chunks.append(virtual_allocator, VirtualChunk{
                        .source_line = line_idx,
                        .source_chunk = chunk_idx,
                        .grapheme_start = 0,
                        .grapheme_count = chunk.char_count,
                        .width = chunk.width,
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

            for (lines, 0..) |*line, line_idx| {
                var line_position: u32 = 0;
                var line_col_offset: u32 = 0; // Track column offset within the real line
                var current_vline = VirtualLine.init();
                current_vline.char_offset = global_char_offset;
                current_vline.source_line = line_idx;
                current_vline.source_col_offset = 0;

                for (line.chunks.items, 0..) |*chunk, chunk_idx| {
                    // Get or create cached grapheme info for this chunk
                    const graphemes_cache = self.getOrCreateChunkCache(line_idx, chunk_idx) catch continue;
                    const chunk_bytes = chunk.getBytes(self.text_buffer.text_bytes);

                    var grapheme_idx: u32 = 0;

                    while (grapheme_idx < graphemes_cache.len) {
                        const remaining_width = if (line_position < wrap_w) wrap_w - line_position else 0;
                        const remaining_graphemes = graphemes_cache[grapheme_idx..];

                        const fit_result = switch (self.wrap_mode) {
                            .char => self.calculateChunkFit(remaining_graphemes, remaining_width),
                            .word => self.calculateChunkFitWord(chunk_bytes, remaining_graphemes, remaining_width),
                        };

                        // If nothing fits and we have content on the line, wrap to next line
                        if (fit_result.char_count == 0 and line_position > 0) {
                            current_vline.width = line_position;
                            self.virtual_lines.append(virtual_allocator, current_vline) catch {};
                            self.cached_line_starts.append(virtual_allocator, current_vline.char_offset) catch {};
                            self.cached_line_widths.append(virtual_allocator, current_vline.width) catch {};
                            self.cached_max_width = @max(self.cached_max_width, current_vline.width);

                            line_col_offset += line_position;
                            current_vline = VirtualLine.init();
                            current_vline.char_offset = global_char_offset;
                            current_vline.source_line = line_idx;
                            current_vline.source_col_offset = line_col_offset;
                            line_position = 0;
                            continue;
                        }

                        // If nothing fits even on empty line, force-add at least one grapheme
                        // (e.g., a 2-cell emoji with wrap_width=1 should still appear on a line)
                        if (fit_result.char_count == 0 and line_position == 0 and grapheme_idx < graphemes_cache.len) {
                            // Force add the first grapheme even if it doesn't fit
                            const g = graphemes_cache[grapheme_idx];

                            current_vline.chunks.append(virtual_allocator, VirtualChunk{
                                .source_line = line_idx,
                                .source_chunk = chunk_idx,
                                .grapheme_start = grapheme_idx,
                                .grapheme_count = g.width,
                                .width = g.width,
                            }) catch {};

                            grapheme_idx += 1;
                            global_char_offset += g.width;
                            line_position += g.width;
                            continue;
                        }

                        // If nothing fits and we're mid-line, this should have been caught by the wrap check above
                        if (fit_result.char_count == 0) {
                            break; // Move to next chunk
                        }

                        // Count how many graphemes this represents
                        var num_graphemes: u32 = 0;
                        for (remaining_graphemes) |g| {
                            if (num_graphemes >= fit_result.char_count) break;
                            num_graphemes += g.width;
                        }

                        current_vline.chunks.append(virtual_allocator, VirtualChunk{
                            .source_line = line_idx,
                            .source_chunk = chunk_idx,
                            .grapheme_start = grapheme_idx,
                            .grapheme_count = fit_result.char_count,
                            .width = fit_result.width,
                        }) catch {};

                        // Advance by the number of graphemes that fit
                        var chars_processed: u32 = 0;
                        var graphemes_processed: u32 = 0;
                        for (remaining_graphemes) |g| {
                            if (chars_processed >= fit_result.char_count) break;
                            chars_processed += g.width;
                            graphemes_processed += 1;
                        }

                        grapheme_idx += graphemes_processed;
                        global_char_offset += fit_result.char_count;
                        line_position += fit_result.width;

                        // Check if we need to wrap
                        if (line_position >= wrap_w and grapheme_idx < graphemes_cache.len) {
                            current_vline.width = line_position;
                            self.virtual_lines.append(virtual_allocator, current_vline) catch {};
                            self.cached_line_starts.append(virtual_allocator, current_vline.char_offset) catch {};
                            self.cached_line_widths.append(virtual_allocator, current_vline.width) catch {};
                            self.cached_max_width = @max(self.cached_max_width, current_vline.width);

                            line_col_offset += line_position;
                            current_vline = VirtualLine.init();
                            current_vline.char_offset = global_char_offset;
                            current_vline.source_line = line_idx;
                            current_vline.source_col_offset = line_col_offset;
                            line_position = 0;
                        }
                    }
                }

                // Append the last virtual line if it has content or represents an empty line
                if (current_vline.chunks.items.len > 0 or line.width == 0) {
                    current_vline.width = line_position;
                    self.virtual_lines.append(virtual_allocator, current_vline) catch {};
                    self.cached_line_starts.append(virtual_allocator, current_vline.char_offset) catch {};
                    self.cached_line_widths.append(virtual_allocator, current_vline.width) catch {};
                    self.cached_max_width = @max(self.cached_max_width, current_vline.width);
                }
            }
        }

        // Clear both dirty flags
        self.virtual_lines_dirty = false;
        self.text_buffer.clearViewDirty(self.view_id);
    }

    pub fn getVirtualLineCount(self: *TextBufferView) u32 {
        self.updateVirtualLines();
        return @intCast(self.virtual_lines.items.len);
    }

    pub fn getVirtualLines(self: *TextBufferView) []const VirtualLine {
        self.updateVirtualLines();
        return self.virtual_lines.items;
    }

    /// Get cached line info (line starts and widths)
    /// Returns the maximum line width
    pub fn getCachedLineInfo(self: *TextBufferView) struct {
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
    pub fn getVirtualLineSpans(self: *const TextBufferView, vline_idx: usize) struct {
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
    pub fn packSelectionInfo(self: *const TextBufferView) u64 {
        if (self.selection) |sel| {
            return (@as(u64, sel.start) << 32) | @as(u64, sel.end);
        } else {
            return 0xFFFF_FFFF_FFFF_FFFF;
        }
    }

    /// Set local selection coordinates and automatically calculate character positions
    /// Returns true if the selection changed, false otherwise
    pub fn setLocalSelection(self: *TextBufferView, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?RGBA, fgColor: ?RGBA) bool {
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

    pub fn resetLocalSelection(self: *TextBufferView) void {
        self.local_selection = null;
        self.selection = null;
    }

    /// Calculate character positions from local selection coordinates
    /// Returns null if no valid selection
    fn calculateMultiLineSelection(self: *TextBufferView) ?struct { start: u32, end: u32 } {
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
    pub fn getSelectedTextIntoBuffer(self: *TextBufferView, out_buffer: []u8) usize {
        const selection = self.selection orelse return 0;
        const start = selection.start;
        const end = selection.end;

        var out_index: usize = 0;
        var count: u32 = 0;

        const lines = self.text_buffer.getLines();

        // Iterate through all lines and chunks
        for (lines, 0..) |line, line_idx| {
            var line_had_selection = false;

            for (line.chunks.items, 0..) |chunk, chunk_idx| {
                // Get cached grapheme info
                const graphemes_cache = self.getOrCreateChunkCache(line_idx, chunk_idx) catch continue;
                const chunk_bytes = chunk.getBytes(self.text_buffer.text_bytes);

                for (graphemes_cache) |g| {
                    if (count >= end) break;

                    // Each grapheme contributes 'width' cells
                    const grapheme_start_count = count;
                    const grapheme_end_count = count + g.width;

                    // Check if any part of this grapheme is selected
                    if (grapheme_end_count > start and grapheme_start_count < end) {
                        line_had_selection = true;

                        // Copy the grapheme's bytes
                        const grapheme_bytes = chunk_bytes[g.byte_offset .. g.byte_offset + g.byte_len];
                        const copy_len = @min(grapheme_bytes.len, out_buffer.len - out_index);

                        if (copy_len > 0) {
                            @memcpy(out_buffer[out_index .. out_index + copy_len], grapheme_bytes[0..copy_len]);
                            out_index += copy_len;
                        }
                    }

                    count += g.width;
                }
            }

            // Add newline between lines if we're still in the selection range and not at the last line
            if (line_had_selection and line_idx < lines.len - 1 and count < end and out_index < out_buffer.len) {
                out_buffer[out_index] = '\n';
                out_index += 1;
            }
        }

        return out_index;
    }

    /// Extract all text as UTF-8 bytes from the char buffer into provided output buffer
    /// Delegates to the underlying TextBuffer
    /// Returns the number of bytes written to the output buffer
    pub fn getPlainTextIntoBuffer(self: *const TextBufferView, out_buffer: []u8) usize {
        return self.text_buffer.getPlainTextIntoBuffer(out_buffer);
    }
};
