const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const seg_mod = @import("text-buffer-segment.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");
const event_emitter = @import("event-emitter.zig");
const event_bus = @import("event-bus.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const UnifiedTextBuffer = tb.UnifiedTextBuffer;
const TextChunk = seg_mod.TextChunk;
const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;

var global_edit_buffer_id: u16 = 0;

pub const EditBufferError = error{
    OutOfMemory,
    InvalidCursor,
};

pub const EditBufferEvent = enum {
    cursorChanged,
};

/// Cursor position (row, col in display-width coordinates)
pub const Cursor = struct {
    row: u32,
    col: u32,
    desired_col: u32 = 0,
};

const AddBuffer = struct {
    mem_id: u8,
    ptr: [*]u8,
    len: usize,
    cap: usize,
    allocator: Allocator,

    fn init(allocator: Allocator, text_buffer: *UnifiedTextBuffer, initial_cap: usize) !AddBuffer {
        const mem = try allocator.alloc(u8, initial_cap);
        const mem_id = try text_buffer.registerMemBuffer(mem, true);

        return .{
            .mem_id = mem_id,
            .ptr = mem.ptr,
            .len = 0,
            .cap = mem.len,
            .allocator = allocator,
        };
    }

    fn ensureCapacity(self: *AddBuffer, text_buffer: *UnifiedTextBuffer, need: usize) !void {
        if (self.len + need <= self.cap) return;

        // TODO: Create a new buffer, register the new buffer and use the new mem_id for subsequent inserts
        const new_cap = @max(self.cap * 2, self.len + need);
        const new_mem = try self.allocator.alloc(u8, new_cap);
        const new_mem_id = try text_buffer.registerMemBuffer(new_mem, true);
        self.mem_id = new_mem_id;
        self.ptr = new_mem.ptr;
        self.len = 0;
        self.cap = new_mem.len;
    }

    fn append(self: *AddBuffer, bytes: []const u8) struct { mem_id: u8, start: u32, end: u32 } {
        std.debug.assert(self.len + bytes.len <= self.cap);
        const start: u32 = @intCast(self.len);

        const dest_slice = self.ptr[0..self.cap];
        @memcpy(dest_slice[self.len .. self.len + bytes.len], bytes);

        self.len += bytes.len;
        const end: u32 = @intCast(self.len);
        return .{ .mem_id = self.mem_id, .start = start, .end = end };
    }
};

pub const EditBuffer = struct {
    id: u16,
    tb: *UnifiedTextBuffer,
    add_buffer: AddBuffer,
    cursors: std.ArrayListUnmanaged(Cursor),
    allocator: Allocator,
    events: event_emitter.EventEmitter(EditBufferEvent),
    segment_splitter: UnifiedRope.Node.LeafSplitFn,

    // Placeholder support
    placeholder_bytes: ?[]const u8,
    placeholder_active: bool,
    placeholder_style_ptr: ?*tb.SyntaxStyle,
    placeholder_style_id: u32,
    saved_style_ptr: ?*const tb.SyntaxStyle,
    placeholder_hl_ref: u16,
    placeholder_color: tb.RGBA,

    pub fn init(
        allocator: Allocator,
        pool: *gp.GraphemePool,
        width_method: gwidth.WidthMethod,
        graphemes_data: *Graphemes,
        display_width: *DisplayWidth,
    ) !*EditBuffer {
        const self = try allocator.create(EditBuffer);
        errdefer allocator.destroy(self);

        const text_buffer = try UnifiedTextBuffer.init(allocator, pool, width_method, graphemes_data, display_width);
        errdefer text_buffer.deinit();

        const add_buffer = try AddBuffer.init(allocator, text_buffer, 65536);
        errdefer {}

        var cursors: std.ArrayListUnmanaged(Cursor) = .{};
        errdefer cursors.deinit(allocator);

        try cursors.append(allocator, .{ .row = 0, .col = 0 });

        const buffer_id = global_edit_buffer_id;
        global_edit_buffer_id += 1;

        self.* = .{
            .id = buffer_id,
            .tb = text_buffer,
            .add_buffer = add_buffer,
            .cursors = cursors,
            .allocator = allocator,
            .events = event_emitter.EventEmitter(EditBufferEvent).init(allocator),
            .segment_splitter = .{ .ctx = self, .splitFn = splitSegmentCallback },
            .placeholder_bytes = null,
            .placeholder_active = false,
            .placeholder_style_ptr = null,
            .placeholder_style_id = 0,
            .saved_style_ptr = null,
            .placeholder_hl_ref = 0xFFFF,
            .placeholder_color = .{ 0.4, 0.4, 0.4, 1.0 },
        };

        // TODO: Rope init should be done by the text buffer
        // Or better yet: a Segment static function for the generic Rope
        try text_buffer.rope.append(Segment{ .linestart = {} });

        return self;
    }

    pub fn deinit(self: *EditBuffer) void {
        // Clean up placeholder resources
        if (self.placeholder_bytes) |bytes| {
            self.allocator.free(bytes);
        }
        if (self.placeholder_style_ptr) |style| {
            style.deinit();
        }

        // Registry owns all AddBuffer memory, don't free it manually
        self.events.deinit();
        self.tb.deinit();
        self.cursors.deinit(self.allocator);
        self.allocator.destroy(self);
    }

    pub fn getId(self: *const EditBuffer) u16 {
        return self.id;
    }

    fn emitNativeEvent(self: *const EditBuffer, event_name: []const u8) void {
        var id_bytes: [2]u8 = undefined;
        std.mem.writeInt(u16, &id_bytes, self.id, .little);

        const full_name = std.fmt.allocPrint(self.allocator, "eb_{s}", .{event_name}) catch return;
        defer self.allocator.free(full_name);

        event_bus.emit(full_name, &id_bytes);
    }

    pub fn getTextBuffer(self: *EditBuffer) *UnifiedTextBuffer {
        return self.tb;
    }

    pub fn getCursor(self: *const EditBuffer, idx: usize) ?Cursor {
        if (idx >= self.cursors.items.len) return null;
        return self.cursors.items[idx];
    }

    pub fn getPrimaryCursor(self: *const EditBuffer) Cursor {
        if (self.cursors.items.len == 0) return .{ .row = 0, .col = 0 };
        return self.cursors.items[0];
    }

    pub fn setCursor(self: *EditBuffer, row: u32, col: u32) !void {
        const line_count = self.tb.lineCount();
        const clamped_row = @min(row, line_count -| 1);

        const line_width = iter_mod.lineWidthAt(&self.tb.rope, clamped_row);
        const clamped_col = @min(col, line_width);

        if (self.cursors.items.len == 0) {
            try self.cursors.append(self.allocator, .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col });
        } else {
            self.cursors.items[0] = .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col };
        }

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
    }

    fn ensureAddCapacity(self: *EditBuffer, need: usize) !void {
        try self.add_buffer.ensureCapacity(self.tb, need);
    }

    /// TODO: This method should live in text-buffer-segment.zig and the Rope should take it as comptime param
    fn splitChunkAtWeight(
        self: *EditBuffer,
        chunk: *const TextChunk,
        weight: u32,
    ) error{ OutOfBounds, OutOfMemory }!struct { left: TextChunk, right: TextChunk } {
        const chunk_weight = chunk.width;

        if (weight == 0) {
            return .{
                .left = TextChunk{ .mem_id = 0, .byte_start = 0, .byte_end = 0, .width = 0 },
                .right = chunk.*,
            };
        } else if (weight >= chunk_weight) {
            return .{
                .left = chunk.*,
                .right = TextChunk{ .mem_id = 0, .byte_start = 0, .byte_end = 0, .width = 0 },
            };
        }

        const chunk_bytes = chunk.getBytes(&self.tb.mem_registry);
        const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;

        const result = utf8.findPosByWidth(chunk_bytes, weight, 8, is_ascii_only, false);
        const split_byte_offset = result.byte_offset;

        const left_chunk = self.tb.createChunk(
            chunk.mem_id,
            chunk.byte_start,
            chunk.byte_start + split_byte_offset,
        );

        const right_chunk = self.tb.createChunk(
            chunk.mem_id,
            chunk.byte_start + split_byte_offset,
            chunk.byte_end,
        );

        return .{ .left = left_chunk, .right = right_chunk };
    }

    fn splitSegmentCallback(
        ctx: ?*anyopaque,
        allocator: Allocator,
        leaf: *const Segment,
        weight_in_leaf: u32,
    ) error{ OutOfBounds, OutOfMemory }!UnifiedRope.Node.LeafSplitResult {
        _ = allocator;
        const edit_buf = @as(*EditBuffer, @ptrCast(@alignCast(ctx.?)));

        if (leaf.asText()) |chunk| {
            const result = try edit_buf.splitChunkAtWeight(chunk, weight_in_leaf);
            return .{
                .left = Segment{ .text = result.left },
                .right = Segment{ .text = result.right },
            };
        } else {
            return .{
                .left = Segment{ .brk = {} },
                .right = Segment{ .brk = {} },
            };
        }
    }

    pub fn insertText(self: *EditBuffer, bytes: []const u8) !void {
        if (bytes.len == 0) return;
        if (self.cursors.items.len == 0) return;

        // Remove placeholder if active
        if (self.placeholder_active) {
            try self.removePlaceholder();
            // Reset cursor to start after removing placeholder
            try self.setCursor(0, 0);
        }

        try self.autoStoreUndo();

        const cursor = self.cursors.items[0];

        try self.ensureAddCapacity(bytes.len);

        const insert_offset = iter_mod.coordsToOffset(&self.tb.rope, cursor.row, cursor.col) orelse return EditBufferError.InvalidCursor;

        const chunk_ref = self.add_buffer.append(bytes);
        const base_mem_id = chunk_ref.mem_id;
        const base_start = chunk_ref.start;

        var break_result = utf8.LineBreakResult.init(self.allocator);
        defer break_result.deinit();
        try utf8.findLineBreaksSIMD16(bytes, &break_result);

        var segments = std.ArrayList(Segment).init(self.allocator);
        defer segments.deinit();

        var local_start: u32 = 0;
        var inserted_width: u32 = 0;
        var width_after_last_break: u32 = 0; // Width of text after the last newline

        for (break_result.breaks.items) |line_break| {
            const break_pos: u32 = @intCast(line_break.pos);
            const local_end: u32 = switch (line_break.kind) {
                .CRLF => break_pos - 1,
                .CR, .LF => break_pos,
            };

            if (local_end > local_start) {
                const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + local_end);
                try segments.append(Segment{ .text = chunk });
                inserted_width += chunk.width;
            }

            try segments.append(Segment{ .brk = {} });
            try segments.append(Segment{ .linestart = {} });

            local_start = break_pos + 1;
            width_after_last_break = 0;
        }

        if (local_start < bytes.len) {
            const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + @as(u32, @intCast(bytes.len)));
            try segments.append(Segment{ .text = chunk });
            width_after_last_break = chunk.width;
            inserted_width += chunk.width;
        }

        if (segments.items.len > 0) {
            try self.tb.rope.insertSliceByWeight(insert_offset, segments.items, &self.segment_splitter);

            self.tb.char_count += inserted_width;
        }

        const num_breaks = break_result.breaks.items.len;
        if (num_breaks > 0) {
            self.cursors.items[0] = .{
                .row = cursor.row + @as(u32, @intCast(num_breaks)),
                .col = width_after_last_break,
                .desired_col = width_after_last_break,
            };
        } else {
            self.cursors.items[0] = .{
                .row = cursor.row,
                .col = cursor.col + inserted_width,
                .desired_col = cursor.col + inserted_width,
            };
        }

        self.tb.markViewsDirty();
        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
        self.emitNativeEvent("content-changed");
    }

    pub fn deleteRange(self: *EditBuffer, start_cursor: Cursor, end_cursor: Cursor) !void {
        var start = start_cursor;
        var end = end_cursor;
        if (start.row > end.row or (start.row == end.row and start.col > end.col)) {
            const temp = start;
            start = end;
            end = temp;
        }

        if (start.row == end.row and start.col == end.col) return;

        try self.autoStoreUndo();

        const start_offset = iter_mod.coordsToOffset(&self.tb.rope, start.row, start.col) orelse return EditBufferError.InvalidCursor;
        const end_offset = iter_mod.coordsToOffset(&self.tb.rope, end.row, end.col) orelse return EditBufferError.InvalidCursor;

        if (start_offset >= end_offset) return;

        const deleted_width = end_offset - start_offset;

        try self.tb.rope.deleteRangeByWeight(start_offset, end_offset, &self.segment_splitter);

        if (self.tb.char_count >= deleted_width) {
            self.tb.char_count -= deleted_width;
        } else {
            self.tb.char_count = 0;
        }

        self.tb.markViewsDirty();

        if (self.cursors.items.len > 0) {
            const line_count = self.tb.lineCount();
            const clamped_row = if (start.row >= line_count) line_count -| 1 else start.row;
            const line_width = if (line_count > 0) iter_mod.lineWidthAt(&self.tb.rope, clamped_row) else 0;
            const clamped_col = @min(start.col, line_width);

            self.cursors.items[0] = .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col };
        }

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
        self.emitNativeEvent("content-changed");

        // Insert placeholder if buffer became empty
        if (self.shouldInsertPlaceholder()) {
            try self.insertPlaceholder();
        }
    }

    pub fn backspace(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const cursor = self.cursors.items[0];

        if (cursor.row == 0 and cursor.col == 0) return;

        if (cursor.col == 0) {
            if (cursor.row > 0) {
                const prev_line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row - 1);
                try self.deleteRange(
                    .{ .row = cursor.row - 1, .col = prev_line_width },
                    .{ .row = cursor.row, .col = 0 },
                );
            }
        } else {
            const prev_grapheme_width = iter_mod.getPrevGraphemeWidth(&self.tb.rope, &self.tb.mem_registry, cursor.row, cursor.col);
            if (prev_grapheme_width == 0) return; // Nothing to delete

            const target_col = cursor.col - prev_grapheme_width;
            try self.deleteRange(
                .{ .row = cursor.row, .col = target_col },
                .{ .row = cursor.row, .col = cursor.col },
            );
        }

        // deleteRange already checks for placeholder insertion
    }

    pub fn deleteForward(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const cursor = self.cursors.items[0];

        try self.autoStoreUndo();

        const line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row);
        const line_count = self.tb.lineCount();

        if (cursor.col >= line_width) {
            if (cursor.row + 1 < line_count) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = line_width },
                    .{ .row = cursor.row + 1, .col = 0 },
                );
            }
        } else {
            const grapheme_width = iter_mod.getGraphemeWidthAt(&self.tb.rope, &self.tb.mem_registry, cursor.row, cursor.col);
            if (grapheme_width > 0) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = cursor.col },
                    .{ .row = cursor.row, .col = cursor.col + grapheme_width },
                );
            }
        }
    }

    pub fn moveLeft(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        if (cursor.col > 0) {
            const prev_width = iter_mod.getPrevGraphemeWidth(&self.tb.rope, &self.tb.mem_registry, cursor.row, cursor.col);
            cursor.col -= prev_width;
        } else if (cursor.row > 0) {
            cursor.row -= 1;
            const line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row);
            cursor.col = line_width;
        }
        cursor.desired_col = cursor.col;

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
    }

    pub fn moveRight(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        const line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row);
        const line_count = self.tb.getLineCount();

        if (cursor.col < line_width) {
            const grapheme_width = iter_mod.getGraphemeWidthAt(&self.tb.rope, &self.tb.mem_registry, cursor.row, cursor.col);
            cursor.col += grapheme_width;
        } else if (cursor.row + 1 < line_count) {
            cursor.row += 1;
            cursor.col = 0;
        }
        cursor.desired_col = cursor.col;

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
    }

    pub fn moveUp(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        if (cursor.row > 0) {
            if (cursor.desired_col == 0) {
                cursor.desired_col = cursor.col;
            }

            cursor.row -= 1;

            const line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row);

            cursor.col = @min(cursor.desired_col, line_width);
        }

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
    }

    pub fn moveDown(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];

        const line_count = self.tb.getLineCount();
        if (cursor.row + 1 < line_count) {
            if (cursor.desired_col == 0) {
                cursor.desired_col = cursor.col;
            }

            cursor.row += 1;

            const line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row);

            cursor.col = @min(cursor.desired_col, line_width);
        }

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
    }

    pub fn setText(self: *EditBuffer, text: []const u8) !void {
        // Deactivate placeholder if active (setText replaces everything)
        if (self.placeholder_active) {
            self.placeholder_active = false;
            self.saved_style_ptr = null;
        }

        try self.tb.setText(text);

        const new_mem = try self.allocator.alloc(u8, self.add_buffer.cap);
        const new_mem_id = try self.tb.registerMemBuffer(new_mem, true);
        self.add_buffer.mem_id = new_mem_id;
        self.add_buffer.ptr = new_mem.ptr;
        self.add_buffer.len = 0;

        try self.setCursor(0, 0);
        self.emitNativeEvent("content-changed");

        // Insert placeholder if the new text is empty
        if (text.len == 0 and self.placeholder_bytes != null) {
            try self.insertPlaceholder();
        }
    }

    pub fn getText(self: *EditBuffer, out_buffer: []u8) usize {
        // Return empty if placeholder is active (display-only)
        if (self.placeholder_active) {
            return 0;
        }
        return self.tb.getPlainTextIntoBuffer(out_buffer);
    }

    pub fn deleteLine(self: *EditBuffer) !void {
        const cursor = self.getPrimaryCursor();
        const line_count = self.tb.lineCount();

        if (cursor.row >= line_count) return;

        if (cursor.row + 1 < line_count) {
            try self.deleteRange(
                .{ .row = cursor.row, .col = 0 },
                .{ .row = cursor.row + 1, .col = 0 },
            );
        } else if (cursor.row > 0) {
            const prev_line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row - 1);
            const curr_line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row);

            try self.deleteRange(
                .{ .row = cursor.row - 1, .col = prev_line_width },
                .{ .row = cursor.row, .col = curr_line_width },
            );

            self.tb.markViewsDirty();

            self.cursors.items[0] = .{ .row = cursor.row - 1, .col = prev_line_width, .desired_col = prev_line_width };
            self.events.emit(.cursorChanged);
            self.emitNativeEvent("cursor-changed");
        } else {
            const line_width = iter_mod.lineWidthAt(&self.tb.rope, cursor.row);
            if (line_width > 0) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = 0 },
                    .{ .row = cursor.row, .col = line_width },
                );
            }
        }

        // deleteRange already checks for placeholder insertion
    }

    pub fn gotoLine(self: *EditBuffer, line: u32) !void {
        const line_count = self.tb.lineCount();
        const target_line = @min(line, line_count -| 1);

        if (line >= line_count) {
            const last_line_width = iter_mod.lineWidthAt(&self.tb.rope, target_line);
            try self.setCursor(target_line, last_line_width);
        } else {
            try self.setCursor(target_line, 0);
        }
    }

    pub fn getCursorPosition(self: *const EditBuffer) struct { line: u32, visual_col: u32 } {
        const cursor = self.getPrimaryCursor();

        return .{
            .line = cursor.row,
            .visual_col = cursor.col,
        };
    }

    pub fn debugLogRope(self: *const EditBuffer) void {
        self.tb.debugLogRope();
    }

    fn autoStoreUndo(self: *EditBuffer) !void {
        try self.tb.rope.store_undo("edit");
    }

    pub fn undo(self: *EditBuffer) ![]const u8 {
        const prev_meta = try self.tb.rope.undo("current");

        self.tb.char_count = self.tb.rope.root.metrics().weight();

        const cursor = self.getPrimaryCursor();
        try self.setCursor(cursor.row, cursor.col);

        self.tb.markViewsDirty();
        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursorChanged");

        return prev_meta;
    }

    pub fn redo(self: *EditBuffer) ![]const u8 {
        const next_meta = try self.tb.rope.redo();

        self.tb.char_count = self.tb.rope.root.metrics().weight();

        const cursor = self.getPrimaryCursor();
        try self.setCursor(cursor.row, cursor.col);

        self.tb.markViewsDirty();
        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursorChanged");

        return next_meta;
    }

    pub fn canUndo(self: *const EditBuffer) bool {
        return self.tb.rope.can_undo();
    }

    pub fn canRedo(self: *const EditBuffer) bool {
        return self.tb.rope.can_redo();
    }

    pub fn clearHistory(self: *EditBuffer) void {
        self.tb.rope.clear_history();
    }

    // Placeholder support methods

    pub fn setPlaceholder(self: *EditBuffer, text: []const u8) !void {
        // Store the placeholder text (allocate in EditBuffer's allocator)
        if (self.placeholder_bytes) |old| {
            self.allocator.free(old);
        }

        if (text.len == 0) {
            self.placeholder_bytes = null;
            // If placeholder was active, remove it
            if (self.placeholder_active) {
                try self.removePlaceholder();
            }
            return;
        }

        const new_bytes = try self.allocator.alloc(u8, text.len);
        @memcpy(new_bytes, text);
        self.placeholder_bytes = new_bytes;

        // If content is empty, activate placeholder
        const is_empty = self.tb.getLength() == 0;
        if (is_empty and !self.placeholder_active) {
            try self.insertPlaceholder();
        } else if (self.placeholder_active) {
            // Placeholder is active, update it
            try self.removePlaceholder();
            try self.insertPlaceholder();
        }
    }

    pub fn setPlaceholderColor(self: *EditBuffer, color: tb.RGBA) !void {
        self.placeholder_color = color;

        // If placeholder is active, update the style
        if (self.placeholder_active and self.placeholder_style_ptr != null) {
            // Re-register the style with new color
            const style = self.placeholder_style_ptr.?;
            self.placeholder_style_id = try style.registerStyle("__placeholder__", color, null, 0);

            // Re-apply highlight
            self.tb.removeHighlightsByRef(self.placeholder_hl_ref);
            const placeholder_len = if (self.placeholder_bytes) |pb| self.tb.measureText(pb) else 0;
            if (placeholder_len > 0) {
                try self.tb.addHighlightByCharRange(0, placeholder_len, self.placeholder_style_id, 255, self.placeholder_hl_ref);
            }
        }
    }

    fn insertPlaceholder(self: *EditBuffer) !void {
        const placeholder_text = self.placeholder_bytes orelse return;
        if (placeholder_text.len == 0) return;

        // Save the current syntax style
        self.saved_style_ptr = self.tb.getSyntaxStyle();

        // Create a dedicated SyntaxStyle for the placeholder if not already created
        if (self.placeholder_style_ptr == null) {
            const style = try tb.SyntaxStyle.init(self.allocator);
            self.placeholder_style_ptr = style;
            self.placeholder_style_id = try style.registerStyle("__placeholder__", self.placeholder_color, null, 0);
        }

        // Set the placeholder style on the text buffer
        self.tb.setSyntaxStyle(self.placeholder_style_ptr.?);

        // Insert the placeholder text into the rope
        try self.ensureAddCapacity(placeholder_text.len);
        const insert_offset: u32 = 0;

        const chunk_ref = self.add_buffer.append(placeholder_text);
        const base_mem_id = chunk_ref.mem_id;
        const base_start = chunk_ref.start;

        var break_result = utf8.LineBreakResult.init(self.allocator);
        defer break_result.deinit();
        try utf8.findLineBreaksSIMD16(placeholder_text, &break_result);

        var segments = std.ArrayList(Segment).init(self.allocator);
        defer segments.deinit();

        var local_start: u32 = 0;
        var inserted_width: u32 = 0;

        for (break_result.breaks.items) |line_break| {
            const break_pos: u32 = @intCast(line_break.pos);
            const local_end: u32 = switch (line_break.kind) {
                .CRLF => break_pos - 1,
                .CR, .LF => break_pos,
            };

            if (local_end > local_start) {
                const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + local_end);
                try segments.append(Segment{ .text = chunk });
                inserted_width += chunk.width;
            }

            try segments.append(Segment{ .brk = {} });
            try segments.append(Segment{ .linestart = {} });

            local_start = break_pos + 1;
        }

        if (local_start < placeholder_text.len) {
            const chunk = self.tb.createChunk(base_mem_id, base_start + local_start, base_start + @as(u32, @intCast(placeholder_text.len)));
            try segments.append(Segment{ .text = chunk });
            inserted_width += chunk.width;
        }

        if (segments.items.len > 0) {
            try self.tb.rope.insertSliceByWeight(insert_offset, segments.items, &self.segment_splitter);
            self.tb.char_count += inserted_width;
        }

        // Add highlight for the placeholder
        try self.tb.addHighlightByCharRange(0, inserted_width, self.placeholder_style_id, 255, self.placeholder_hl_ref);

        self.placeholder_active = true;
        self.tb.markViewsDirty();

        // Reset cursor to start
        try self.setCursor(0, 0);
    }

    fn removePlaceholder(self: *EditBuffer) !void {
        if (!self.placeholder_active) return;

        // Remove highlight first
        self.tb.removeHighlightsByRef(self.placeholder_hl_ref);

        // Clear the rope and add back a single linestart marker
        self.tb.rope.clear();
        try self.tb.rope.append(Segment{ .linestart = {} });

        self.tb.char_count = 0;

        // Restore the saved syntax style
        self.tb.setSyntaxStyle(self.saved_style_ptr);
        self.saved_style_ptr = null;

        self.placeholder_active = false;
        self.tb.markViewsDirty();
    }

    fn shouldInsertPlaceholder(self: *const EditBuffer) bool {
        // Check if buffer is empty (only has linestart markers)
        return self.tb.getLength() == 0 and self.placeholder_bytes != null and !self.placeholder_active;
    }
};
