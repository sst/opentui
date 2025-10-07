const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const gp = @import("grapheme.zig");

const TextBuffer = tb.TextBuffer;
const RGBA = tb.RGBA;
const TextSelection = tb.TextSelection;
const WrapMode = tb.WrapMode;
const VirtualLine = tb.VirtualLine;
const VirtualChunk = tb.VirtualChunk;
const StyleSpan = tb.StyleSpan;

pub const TextBufferViewError = error{
    OutOfMemory,
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

    pub fn deinit(self: *TextBufferView) void {
        // Unregister from the text buffer
        self.text_buffer.unregisterView(self.view_id);

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

    /// Calculate how many characters from a chunk fit within the given width
    /// Returns the number of characters and their total width
    fn calculateChunkFit(_: *const TextBufferView, chars: []const u32, max_width: u32) tb.ChunkFitResult {
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
    fn calculateChunkFitWord(self: *const TextBufferView, chars: []const u32, max_width: u32) tb.ChunkFitResult {
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
    fn calculateChunkWidth(_: *const TextBufferView, chars: []const u32) u32 {
        if (chars.len == 0) return 0;

        return @intCast(chars.len);
    }

    /// Update virtual lines based on current wrap width
    pub fn updateVirtualLines(self: *TextBufferView) void {
        // Check both local and buffer dirty flags
        const buffer_dirty = self.text_buffer.isViewDirty(self.view_id);
        if (!self.virtual_lines_dirty and !buffer_dirty) return;

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

            for (lines, 0..) |*line, line_idx| {
                var line_position: u32 = 0;
                var line_col_offset: u32 = 0; // Track column offset within the real line
                var current_vline = VirtualLine.init();
                current_vline.char_offset = global_char_offset;
                current_vline.source_line = line_idx;
                current_vline.source_col_offset = 0;
                var first_in_line = true;

                for (line.chunks.items, 0..) |*chunk, chunk_idx| {
                    var chunk_pos: u32 = 0;

                    while (chunk_pos < chunk.chars.len) {
                        const remaining_width = if (line_position < wrap_w) wrap_w - line_position else 0;
                        const remaining_chars = chunk.chars[chunk_pos..];

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

                            line_col_offset += line_position;
                            current_vline = VirtualLine.init();
                            current_vline.char_offset = global_char_offset;
                            current_vline.source_line = line_idx;
                            current_vline.source_col_offset = line_col_offset;
                            line_position = 0;
                            first_in_line = false;
                            continue;
                        }

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
                if (current_vline.chunks.items.len > 0 or line.chunks.items.len == 0) {
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
    pub fn getSelectedTextIntoBuffer(self: *const TextBufferView, out_buffer: []u8) usize {
        const selection = self.selection orelse return 0;
        const start = selection.start;
        const end = selection.end;

        var out_index: usize = 0;
        var count: u32 = 0;

        const lines = self.text_buffer.getLines();
        const pool = self.text_buffer.pool;

        // Iterate through all lines and chunks, similar to rendering
        for (lines, 0..) |line, line_idx| {
            var line_had_selection = false;

            for (line.chunks.items) |chunk| {
                var chunk_char_index: u32 = 0;
                while (chunk_char_index < chunk.chars.len and count < end and out_index < out_buffer.len) : (chunk_char_index += 1) {
                    const c = chunk.chars[chunk_char_index];

                    if (!gp.isContinuationChar(c)) {
                        if (count >= start) {
                            line_had_selection = true;
                            if (gp.isGraphemeChar(c)) {
                                const gid = gp.graphemeIdFromChar(c);
                                const grapheme_bytes = pool.get(gid) catch continue;
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
