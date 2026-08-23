const std = @import("std");
const Allocator = std.mem.Allocator;
const tb = @import("text-buffer.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const seg_mod = @import("text-buffer-segment.zig");
const gp = @import("grapheme.zig");
const link = @import("link.zig");
const TextAnnotations = @import("text-annotations.zig").TextAnnotations;

const utf8 = @import("utf8.zig");
const event_emitter = @import("event-emitter.zig");
const event_bus = @import("event-bus.zig");

const UnifiedTextBuffer = tb.UnifiedTextBuffer;
const TextChunk = seg_mod.TextChunk;
const TextRope = seg_mod.UnifiedRope;

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
    offset: u32 = 0, // Global display-width offset from buffer start
};

const CursorCoords = struct { row: u32, col: u32 };

const CursorMeta = struct {
    row: u32,
    col: u32,
    desired_col: u32,

    fn fromCursor(cursor: Cursor) CursorMeta {
        return .{
            .row = cursor.row,
            .col = cursor.col,
            .desired_col = cursor.desired_col,
        };
    }

    fn encode(self: CursorMeta, out_buffer: []u8) ![]const u8 {
        return std.fmt.bufPrint(out_buffer, "cursor:{d}:{d}:{d}", .{ self.row, self.col, self.desired_col });
    }

    fn decode(bytes: []const u8) ?CursorMeta {
        const prefix = "cursor:";
        if (!std.mem.startsWith(u8, bytes, prefix)) {
            return null;
        }

        var parts = std.mem.splitScalar(u8, bytes[prefix.len..], ':');

        const row = std.fmt.parseInt(u32, parts.next() orelse return null, 10) catch return null;
        const col = std.fmt.parseInt(u32, parts.next() orelse return null, 10) catch return null;
        const desired_col = std.fmt.parseInt(u32, parts.next() orelse return null, 10) catch return null;

        if (parts.next() != null) {
            return null;
        }

        return .{
            .row = row,
            .col = col,
            .desired_col = desired_col,
        };
    }
};

const PreparedEditHistory = struct {
    annotations: TextAnnotations,
    rope: TextRope.PreparedUndo,
    committed: bool = false,

    fn deinit(self: *PreparedEditHistory, edit_buffer: *EditBuffer) void {
        if (!self.committed) edit_buffer.tb.rollbackAnnotationEdit(self.annotations);
        self.rope.deinit();
        edit_buffer.tb.finishEditStorage();
        self.* = undefined;
    }
};

pub const EditBuffer = struct {
    /// Public compatibility default. Applications may opt into a finite bound
    /// at construction time or with setMaxUndoDepth.
    pub const default_max_undo_depth: ?usize = null;
    id: u16,
    tb: *UnifiedTextBuffer,
    cursors: std.ArrayListUnmanaged(Cursor),
    allocator: Allocator,
    events: event_emitter.EventEmitter(EditBufferEvent),
    event_sink: ?*event_bus.EventSink,
    annotation_undo: std.ArrayListUnmanaged(TextAnnotations),
    annotation_redo: std.ArrayListUnmanaged(TextAnnotations),
    annotation_cursor_policy_references: u32,
    annotation_cursor_policy_selections: u32,

    pub fn init(
        allocator: Allocator,
        pool: *gp.GraphemePool,
        link_pool: *link.LinkPool,
        width_method: utf8.WidthMethod,
        event_sink: ?*event_bus.EventSink,
    ) !*EditBuffer {
        const self = try allocator.create(EditBuffer);
        errdefer allocator.destroy(self);

        const text_buffer = try UnifiedTextBuffer.init(allocator, pool, link_pool, width_method);
        errdefer text_buffer.deinit();
        text_buffer.rope().setMaxUndoDepth(default_max_undo_depth);

        var cursors: std.ArrayListUnmanaged(Cursor) = .empty;
        errdefer cursors.deinit(allocator);

        try cursors.append(allocator, .{ .row = 0, .col = 0 });

        const buffer_id = global_edit_buffer_id;
        global_edit_buffer_id += 1;

        self.* = .{
            .id = buffer_id,
            .tb = text_buffer,
            .cursors = cursors,
            .allocator = allocator,
            .events = event_emitter.EventEmitter(EditBufferEvent).init(allocator),
            .event_sink = event_sink,
            .annotation_undo = .empty,
            .annotation_redo = .empty,
            .annotation_cursor_policy_references = 0,
            .annotation_cursor_policy_selections = 0,
        };

        return self;
    }

    pub fn deinit(self: *EditBuffer) void {
        const allocator = self.allocator;
        defer allocator.destroy(self);

        self.events.deinit();
        self.clearAnnotationHistory(&self.annotation_undo);
        self.clearAnnotationHistory(&self.annotation_redo);
        self.annotation_undo.deinit(self.allocator);
        self.annotation_redo.deinit(self.allocator);
        self.tb.deinit();
        self.cursors.deinit(self.allocator);
        self.* = undefined;
    }

    pub fn getId(self: *const EditBuffer) u16 {
        return self.id;
    }

    fn emitNativeEvent(self: *const EditBuffer, event_name: []const u8) void {
        if (self.event_sink == null) return;
        var id_bytes: [2]u8 = undefined;
        std.mem.writeInt(u16, &id_bytes, self.id, .little);

        const full_name = std.fmt.allocPrint(self.allocator, "eb_{s}", .{event_name}) catch return;
        defer self.allocator.free(full_name);

        event_bus.emit(self.event_sink, full_name, &id_bytes);
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

    /// Editing needs an insertion boundary even though the visual cursor may
    /// occupy an interior display cell. Wide cursor units edit from their end;
    /// expanded tab cells edit from the tab's start.
    fn canonicalEditCursorCoords(self: *EditBuffer, row: u32, col: u32) EditBufferError!CursorCoords {
        const line_count = self.tb.lineCount();
        if (row >= line_count) return EditBufferError.InvalidCursor;
        const line_width = iter_mod.lineWidthAt(self.tb.rope(), row);
        if (col > line_width) return EditBufferError.InvalidCursor;
        var canonical_col = col;
        const offset = iter_mod.coordsToOffset(self.tb.rope(), row, col) orelse return EditBufferError.InvalidCursor;

        if (self.tb.cursorUnitBoundsAtOffset(offset)) |bounds| {
            if (offset > bounds.start and offset < bounds.end) {
                var first_byte: [1]u8 = undefined;
                const is_tab = self.tb.getTextRange(bounds.start, bounds.end, &first_byte) == 1 and first_byte[0] == '\t';
                const canonical_offset = if (is_tab) bounds.start else bounds.end;
                if (iter_mod.offsetToCoords(self.tb.rope(), canonical_offset)) |coords| {
                    if (coords.row == row) canonical_col = coords.col;
                }
            }
        }

        return .{ .row = row, .col = canonical_col };
    }

    pub fn setCursor(self: *EditBuffer, row: u32, col: u32) !void {
        const line_count = self.tb.lineCount();
        const clamped_row = @min(row, line_count -| 1);
        const line_width = iter_mod.lineWidthAt(self.tb.rope(), clamped_row);
        const clamped_col = @min(col, line_width);
        const offset = iter_mod.coordsToOffset(self.tb.rope(), clamped_row, clamped_col) orelse 0;
        const adjusted = self.adjustCursorOffsetForAnnotations(offset, .direct);
        const coords = iter_mod.offsetToCoords(self.tb.rope(), adjusted) orelse iter_mod.Coords{ .row = 0, .col = 0 };
        try self.setCursorRaw(coords.row, coords.col, adjusted);
    }

    fn setCursorRaw(self: *EditBuffer, row: u32, col: u32, offset: u32) !void {
        if (self.cursors.items.len == 0) {
            try self.cursors.append(self.allocator, .{ .row = row, .col = col, .desired_col = col, .offset = offset });
        } else {
            self.cursors.items[0] = .{ .row = row, .col = col, .desired_col = col, .offset = offset };
        }
        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
    }

    pub fn setCursorByOffset(self: *EditBuffer, offset: u32) !void {
        const adjusted = self.adjustCursorOffsetForAnnotations(offset, .direct);
        const coords = iter_mod.offsetToCoords(self.tb.rope(), adjusted) orelse iter_mod.Coords{ .row = 0, .col = 0 };
        try self.setCursorRaw(coords.row, coords.col, adjusted);
    }

    pub const AnnotationCursorMove = enum { direct, vertical_up, vertical_down };

    const AnnotationDisplayRange = struct { start: u32, end: u32 };
    const AnnotationCursorDirection = enum { backward, forward };

    pub fn setVirtualAnnotationPolicy(self: *EditBuffer, enabled: bool) void {
        if (enabled) self.annotation_cursor_policy_references +|= 1 else self.annotation_cursor_policy_references -|= 1;
    }

    pub fn setAnnotationPolicySelection(self: *EditBuffer, active: bool) void {
        if (active) {
            self.annotation_cursor_policy_selections +|= 1;
        } else {
            self.annotation_cursor_policy_selections -|= 1;
        }
    }

    fn annotationRangeAtOffset(self: *EditBuffer, offset: u32) ?AnnotationDisplayRange {
        if (self.annotation_cursor_policy_references == 0 or self.annotation_cursor_policy_selections != 0) return null;
        const coords = iter_mod.offsetToCoords(self.tb.rope(), offset) orelse return null;
        const byte = self.tb.displayPointToNormalizedByteOffset(.{ .row = coords.row, .col = coords.col }, .before) catch return null;
        if (byte == std.math.maxInt(u32)) return null;
        const Context = struct {
            owner: *EditBuffer,
            target: u32,
            result: ?AnnotationDisplayRange = null,

            fn visit(context: *@This(), annotation: TextAnnotations.Annotation) !void {
                if (annotation.payload.kind_flags & tb.annotation_kind_virtual == 0) return;
                const range = switch (annotation.mark) {
                    .range => |value| value,
                    .point => return,
                };
                const start_point = (context.owner.tb.normalizedByteOffsetToDisplayPoint(range.start_byte, .before) catch return).point;
                const end_point = (context.owner.tb.normalizedByteOffsetToDisplayPoint(range.end_byte, .after) catch return).point;
                const start = iter_mod.coordsToOffset(context.owner.tb.rope(), start_point.row, start_point.col) orelse return;
                const end = iter_mod.coordsToOffset(context.owner.tb.rope(), end_point.row, end_point.col) orelse return;
                if (start >= end or context.target < start or context.target >= end) return;
                if (context.result) |current| {
                    context.result = .{ .start = @min(current.start, start), .end = @max(current.end, end) };
                } else {
                    context.result = .{ .start = start, .end = end };
                }
            }
        };
        var context: Context = .{ .owner = self, .target = offset };
        self.tb.textAnnotations().visitUnordered(.overlapping, byte, byte + 1, &context, Context.visit) catch return null;
        return context.result;
    }

    fn resolveCursorOffsetForAnnotations(self: *EditBuffer, target: u32, initial_direction: AnnotationCursorDirection) u32 {
        var resolved = target;
        var direction = initial_direction;
        var remaining = self.tb.textAnnotations().count() *| 2 +| 1;
        while (remaining != 0) : (remaining -= 1) {
            const range = self.annotationRangeAtOffset(resolved) orelse break;
            if (direction == .backward and range.start == 0) direction = .forward;
            const next = if (direction == .forward) range.end else range.start - 1;
            std.debug.assert(if (direction == .forward) next > resolved else next < resolved);
            resolved = next;
        }
        std.debug.assert(self.annotationRangeAtOffset(resolved) == null);
        return resolved;
    }

    pub fn adjustCursorOffsetForAnnotations(self: *EditBuffer, target: u32, move: AnnotationCursorMove) u32 {
        const current = self.getPrimaryCursor().offset;
        const range = self.annotationRangeAtOffset(target) orelse return target;
        return switch (move) {
            .direct => if (target > current)
                self.resolveCursorOffsetForAnnotations(target, .forward)
            else if (target < current)
                self.resolveCursorOffsetForAnnotations(target, .backward)
            else if (range.start == 0 or target - (range.start - 1) >= range.end - target)
                self.resolveCursorOffsetForAnnotations(target, .forward)
            else
                self.resolveCursorOffsetForAnnotations(target, .backward),
            .vertical_up, .vertical_down => blk: {
                const distance_to_start = target - range.start;
                const distance_to_end = range.end - target;
                if (distance_to_start >= distance_to_end) break :blk self.resolveCursorOffsetForAnnotations(target, .forward);
                const before = range.start -| 1;
                if (move == .vertical_down and before <= current) break :blk self.resolveCursorOffsetForAnnotations(target, .forward);
                break :blk self.resolveCursorOffsetForAnnotations(target, .backward);
            },
        };
    }

    fn preparePrimaryCursor(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) try self.cursors.ensureUnusedCapacity(self.allocator, 1);
    }

    pub fn insertText(self: *EditBuffer, bytes: []const u8) !void {
        if (bytes.len == 0) return;
        if (self.cursors.items.len == 0) return;

        const stored_cursor = self.cursors.items[0];
        const cursor = try self.canonicalEditCursorCoords(stored_cursor.row, stored_cursor.col);
        const insert_byte = self.tb.displayPointToNormalizedByteOffset(.{ .row = cursor.row, .col = cursor.col }, .before) catch return EditBufferError.InvalidCursor;
        if (!std.unicode.utf8ValidateSlice(bytes)) return tb.TextBufferError.InvalidUtf8;
        var history = try self.prepareAutoStoreUndo();
        defer history.deinit(self);
        const result = try self.tb.replaceNormalizedBytesForEdit(insert_byte, insert_byte, bytes);
        self.commitAutoStoreUndo(&history);
        const point = result.new_display.end.point;
        const new_offset = iter_mod.coordsToOffset(self.tb.rope(), point.row, point.col) orelse 0;
        self.cursors.items[0] = .{ .row = point.row, .col = point.col, .desired_col = point.col, .offset = new_offset };
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

        const start_offset = self.tb.displayPointToNormalizedByteOffset(.{ .row = start.row, .col = start.col }, .before) catch return EditBufferError.InvalidCursor;
        var end_offset = self.tb.displayPointToNormalizedByteOffset(.{ .row = end.row, .col = end.col }, .after) catch return EditBufferError.InvalidCursor;
        const end_line_width = iter_mod.lineWidthAt(self.tb.rope(), end.row);
        if (end.col >= end_line_width) {
            end_offset = if (end.row + 1 >= self.tb.getLineCount())
                self.tb.getByteSize()
            else
                (self.tb.displayPointToNormalizedByteOffset(.{ .row = end.row + 1, .col = 0 }, .before) catch return EditBufferError.InvalidCursor) - 1;
        }

        if (start_offset >= end_offset) return;

        var history = try self.prepareAutoStoreUndo();
        defer history.deinit(self);
        _ = try self.tb.replaceNormalizedBytesForEdit(start_offset, end_offset, "");
        self.commitAutoStoreUndo(&history);

        if (self.cursors.items.len > 0) {
            const line_count = self.tb.lineCount();
            const clamped_row = if (start.row >= line_count) line_count -| 1 else start.row;
            const line_width = if (line_count > 0) iter_mod.lineWidthAt(self.tb.rope(), clamped_row) else 0;
            const clamped_col = @min(start.col, line_width);
            const offset = iter_mod.coordsToOffset(self.tb.rope(), clamped_row, clamped_col) orelse 0;

            self.cursors.items[0] = .{ .row = clamped_row, .col = clamped_col, .desired_col = clamped_col, .offset = offset };
        }

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
        self.emitNativeEvent("content-changed");
    }

    pub fn backspace(self: *EditBuffer) !void {
        if (self.cursors.items.len == 0) return;
        const stored_cursor = self.cursors.items[0];
        if (stored_cursor.offset > 0) {
            if (self.annotationRangeAtOffset(stored_cursor.offset - 1)) |range| {
                if (stored_cursor.offset == range.end) {
                    const start = iter_mod.offsetToCoords(self.tb.rope(), range.start) orelse return;
                    const end = iter_mod.offsetToCoords(self.tb.rope(), range.end) orelse return;
                    try self.deleteRange(.{ .row = start.row, .col = start.col }, .{ .row = end.row, .col = end.col });
                    return;
                }
            }
        }
        const cursor = try self.canonicalEditCursorCoords(stored_cursor.row, stored_cursor.col);

        if (cursor.row == 0 and cursor.col == 0) return;

        if (cursor.col == 0) {
            if (cursor.row > 0) {
                const prev_line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row - 1);
                try self.deleteRange(
                    .{ .row = cursor.row - 1, .col = prev_line_width },
                    .{ .row = cursor.row, .col = 0 },
                );
            }
        } else {
            const prev_grapheme_width = self.tb.getPrevGraphemeWidth(cursor.row, cursor.col);
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
        const stored_cursor = self.cursors.items[0];
        if (self.annotationRangeAtOffset(stored_cursor.offset)) |range| {
            if (stored_cursor.offset == range.start) {
                const start = iter_mod.offsetToCoords(self.tb.rope(), range.start) orelse return;
                const end = iter_mod.offsetToCoords(self.tb.rope(), range.end) orelse return;
                try self.deleteRange(.{ .row = start.row, .col = start.col }, .{ .row = end.row, .col = end.col });
                return;
            }
        }
        const cursor = try self.canonicalEditCursorCoords(stored_cursor.row, stored_cursor.col);

        const line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row);
        const line_count = self.tb.lineCount();

        if (cursor.col >= line_width) {
            if (cursor.row + 1 < line_count) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = line_width },
                    .{ .row = cursor.row + 1, .col = 0 },
                );
            }
        } else {
            const grapheme_width = self.tb.getGraphemeWidthAt(cursor.row, cursor.col);
            if (grapheme_width > 0) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = cursor.col },
                    .{ .row = cursor.row, .col = cursor.col + grapheme_width },
                );
            }
        }
    }

    pub fn moveLeft(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) {
            return;
        }
        const cursor = &self.cursors.items[0];
        var target = cursor.*;

        if (target.col > 0) {
            const prev_width = self.tb.getPrevGraphemeWidth(target.row, target.col);
            target.col -= prev_width;
        } else if (target.row > 0) {
            target.row -= 1;
            const line_width = iter_mod.lineWidthAt(self.tb.rope(), target.row);
            target.col = line_width;
        }
        const target_offset = iter_mod.coordsToOffset(self.tb.rope(), target.row, target.col) orelse 0;
        const adjusted = self.adjustCursorOffsetForAnnotations(target_offset, .direct);
        const coords = iter_mod.offsetToCoords(self.tb.rope(), adjusted) orelse return;
        cursor.* = .{ .row = coords.row, .col = coords.col, .desired_col = coords.col, .offset = adjusted };

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
    }

    pub fn moveRight(self: *EditBuffer) void {
        if (self.cursors.items.len == 0) return;
        const cursor = &self.cursors.items[0];
        var target = cursor.*;

        const line_width = iter_mod.lineWidthAt(self.tb.rope(), target.row);
        const line_count = self.tb.getLineCount();

        if (target.col < line_width) {
            const grapheme_width = self.tb.getGraphemeWidthAt(target.row, target.col);
            target.col += grapheme_width;
        } else if (target.row + 1 < line_count) {
            target.row += 1;
            target.col = 0;
        }
        const target_offset = iter_mod.coordsToOffset(self.tb.rope(), target.row, target.col) orelse 0;
        const adjusted = self.adjustCursorOffsetForAnnotations(target_offset, .direct);
        const coords = iter_mod.offsetToCoords(self.tb.rope(), adjusted) orelse return;
        cursor.* = .{ .row = coords.row, .col = coords.col, .desired_col = coords.col, .offset = adjusted };

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

            const line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row);

            cursor.col = @min(cursor.desired_col, line_width);
            cursor.offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row, cursor.col) orelse 0;
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

            const line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row);

            cursor.col = @min(cursor.desired_col, line_width);
            cursor.offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row, cursor.col) orelse 0;
        }

        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursor-changed");
    }

    /// Set text and completely reset the buffer state.
    pub fn setText(self: *EditBuffer, text: []const u8) !void {
        try self.preparePrimaryCursor();
        _ = try self.tb.replaceNormalizedBytesForEdit(0, self.tb.getByteSize(), text);
        self.tb.clearAnnotations();
        self.clearHistory();
        try self.setCursor(0, 0);
        self.emitNativeEvent("content-changed");
    }

    /// Set text from memory ID and completely reset the buffer state.
    pub fn setTextFromMemId(self: *EditBuffer, mem_id: u8) !void {
        try self.preparePrimaryCursor();
        try self.tb.replaceTextFromMemIdForEdit(mem_id);
        self.tb.clearAnnotations();
        self.clearHistory();
        try self.setCursor(0, 0);

        self.emitNativeEvent("content-changed");
    }

    /// Replace text while preserving undo history (creates an undo point)
    pub fn replaceText(self: *EditBuffer, text: []const u8) !void {
        if (!std.unicode.utf8ValidateSlice(text)) return tb.TextBufferError.InvalidUtf8;
        try self.preparePrimaryCursor();
        var history = try self.prepareAutoStoreUndo();
        defer history.deinit(self);
        _ = try self.tb.replaceNormalizedBytesForEdit(0, self.tb.getByteSize(), text);
        self.tb.clearAnnotations();
        self.commitAutoStoreUndo(&history);
        try self.setCursor(0, 0);
        self.emitNativeEvent("content-changed");
    }

    /// Replace text from memory ID while preserving undo history (creates an undo point)
    pub fn replaceTextFromMemId(self: *EditBuffer, mem_id: u8) !void {
        if (self.tb.memRegistry().get(mem_id) == null) return tb.TextBufferError.InvalidMemId;
        try self.preparePrimaryCursor();
        var history = try self.prepareAutoStoreUndo();
        defer history.deinit(self);
        try self.tb.replaceTextFromMemIdForEdit(mem_id);
        self.tb.clearAnnotations();
        self.commitAutoStoreUndo(&history);
        try self.setCursor(0, 0);

        self.emitNativeEvent("content-changed");
    }

    pub fn getText(self: *EditBuffer, out_buffer: []u8) usize {
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
            const prev_line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row - 1);
            const curr_line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row);

            try self.deleteRange(
                .{ .row = cursor.row - 1, .col = prev_line_width },
                .{ .row = cursor.row, .col = curr_line_width },
            );

            self.tb.markViewsDirty();

            const new_row = cursor.row - 1;
            const new_col = prev_line_width;
            const new_offset = iter_mod.coordsToOffset(self.tb.rope(), new_row, new_col) orelse 0;
            self.cursors.items[0] = .{ .row = new_row, .col = new_col, .desired_col = new_col, .offset = new_offset };
            self.events.emit(.cursorChanged);
            self.emitNativeEvent("cursor-changed");
        } else {
            const line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row);
            if (line_width > 0) {
                try self.deleteRange(
                    .{ .row = cursor.row, .col = 0 },
                    .{ .row = cursor.row, .col = line_width },
                );
            }
        }
    }

    pub fn gotoLine(self: *EditBuffer, line: u32) !void {
        const line_count = self.tb.lineCount();
        const target_line = @min(line, line_count -| 1);

        if (line >= line_count) {
            const last_line_width = iter_mod.lineWidthAt(self.tb.rope(), target_line);
            try self.setCursor(target_line, last_line_width);
        } else {
            try self.setCursor(target_line, 0);
        }
    }

    pub fn getCursorPosition(self: *const EditBuffer) struct { line: u32, visual_col: u32, offset: u32 } {
        const cursor = self.getPrimaryCursor();

        return .{
            .line = cursor.row,
            .visual_col = cursor.col,
            .offset = cursor.offset,
        };
    }

    pub fn debugLogRope(self: *const EditBuffer) void {
        self.tb.debugLogRope();
    }

    fn encodeCurrentCursorMeta(self: *const EditBuffer, out_buffer: []u8) ![]const u8 {
        return CursorMeta.fromCursor(self.getPrimaryCursor()).encode(out_buffer);
    }

    fn restoreCursorFromMeta(self: *EditBuffer, meta: []const u8) !bool {
        const decodedMeta = CursorMeta.decode(meta) orelse return false;

        try self.setCursor(decodedMeta.row, decodedMeta.col);

        if (self.cursors.items.len > 0) {
            self.cursors.items[0].desired_col = decodedMeta.desired_col;
        }

        return true;
    }

    fn prepareAutoStoreUndo(self: *EditBuffer) !PreparedEditHistory {
        try self.tb.prepareEditStorage();
        errdefer self.tb.finishEditStorage();
        var meta_buffer: [64]u8 = undefined;
        const meta = try self.encodeCurrentCursorMeta(meta_buffer[0..]);
        try self.annotation_undo.ensureUnusedCapacity(self.allocator, 1);
        var prepared_rope = try self.tb.rope().prepare_store_undo(meta);
        errdefer prepared_rope.deinit();
        const previous_annotations = try self.tb.beginAnnotationEdit();
        return .{ .annotations = previous_annotations, .rope = prepared_rope };
    }

    fn commitAutoStoreUndo(self: *EditBuffer, prepared: *PreparedEditHistory) void {
        self.tb.rope().commit_store_undo(&prepared.rope);
        self.annotation_undo.appendAssumeCapacity(prepared.annotations);
        self.clearAnnotationHistory(&self.annotation_redo);
        self.trimAnnotationHistory(&self.annotation_undo, self.tb.rope().undoDepth());
        prepared.committed = true;
    }

    pub fn undo(self: *EditBuffer) ![]const u8 {
        if (self.annotation_undo.items.len == 0) return error.Stop;
        try self.annotation_redo.ensureUnusedCapacity(self.allocator, 1);
        var current_meta_buffer: [64]u8 = undefined;
        const current_meta = try self.encodeCurrentCursorMeta(current_meta_buffer[0..]);
        const prev_meta = try self.tb.rope().undo(current_meta);
        const previous_annotations = self.annotation_undo.pop().?;
        const current_annotations = self.tb.swapAnnotationCheckpoint(previous_annotations);
        self.annotation_redo.appendAssumeCapacity(current_annotations);

        const restored = try self.restoreCursorFromMeta(prev_meta);

        if (!restored) {
            const cursor = self.getPrimaryCursor();
            try self.setCursor(cursor.row, cursor.col);
        }

        self.tb.markViewsDirty();
        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursorChanged");

        return prev_meta;
    }

    pub fn redo(self: *EditBuffer) ![]const u8 {
        if (self.annotation_redo.items.len == 0) return error.Stop;
        try self.annotation_undo.ensureUnusedCapacity(self.allocator, 1);
        const next_meta = try self.tb.rope().redo();
        const next_annotations = self.annotation_redo.pop().?;
        const current_annotations = self.tb.swapAnnotationCheckpoint(next_annotations);
        self.annotation_undo.appendAssumeCapacity(current_annotations);
        self.trimAnnotationHistory(&self.annotation_undo, self.tb.rope().undoDepth());

        const restored = try self.restoreCursorFromMeta(next_meta);

        if (!restored) {
            const cursor = self.getPrimaryCursor();
            try self.setCursor(cursor.row, cursor.col);
        }

        self.tb.markViewsDirty();
        self.events.emit(.cursorChanged);
        self.emitNativeEvent("cursorChanged");

        return next_meta;
    }

    pub fn canUndo(self: *const EditBuffer) bool {
        return self.tb.rope().can_undo();
    }

    pub fn canRedo(self: *const EditBuffer) bool {
        return self.tb.rope().can_redo();
    }

    pub fn clearHistory(self: *EditBuffer) void {
        self.tb.rope().clear_history();
        self.clearAnnotationHistory(&self.annotation_undo);
        self.clearAnnotationHistory(&self.annotation_redo);
        self.tb.requestStorageCompaction();
    }

    pub fn setMaxUndoDepth(self: *EditBuffer, max_depth: ?usize) void {
        self.tb.rope().setMaxUndoDepth(max_depth);
        self.trimAnnotationHistory(&self.annotation_undo, self.tb.rope().undoDepth());
        self.trimAnnotationHistory(&self.annotation_redo, self.tb.rope().redoDepth());
        self.tb.requestStorageCompaction();
    }

    pub fn getMaxUndoDepth(self: *const EditBuffer) ?usize {
        return self.tb.rope().getMaxUndoDepth();
    }

    fn clearAnnotationHistory(self: *EditBuffer, history: *std.ArrayListUnmanaged(TextAnnotations)) void {
        for (history.items) |*checkpoint| self.tb.releaseAnnotationCheckpoint(checkpoint);
        history.clearRetainingCapacity();
    }

    fn trimAnnotationHistory(self: *EditBuffer, history: *std.ArrayListUnmanaged(TextAnnotations), retained: usize) void {
        const removed = history.items.len - @min(history.items.len, retained);
        for (history.items[0..removed]) |*checkpoint| self.tb.releaseAnnotationCheckpoint(checkpoint);
        if (removed != 0) std.mem.copyForwards(TextAnnotations, history.items[0..], history.items[removed..]);
        history.shrinkRetainingCapacity(history.items.len - removed);
    }

    pub fn applyAnnotationOperations(
        self: *EditBuffer,
        operations: []const tb.AnnotationOperation,
        created_ids: []u64,
        deleted_ids: []u64,
    ) tb.TextBufferError!tb.AnnotationBatchResult {
        const result = try self.tb.applyAnnotationOperations(operations, created_ids, deleted_ids);
        // Explicit removal is authoritative even when the ID exists only in an
        // undo checkpoint, so a later undo cannot resurrect controller-owned state.
        var cleared_namespace = false;
        for (operations) |operation| {
            cleared_namespace = cleared_namespace or operation.kind == .clear_namespace;
            if (operation.kind != .remove) continue;
            for (self.annotation_undo.items) |*checkpoint| self.tb.purgeAnnotationCheckpoint(checkpoint, &.{operation.id});
            for (self.annotation_redo.items) |*checkpoint| self.tb.purgeAnnotationCheckpoint(checkpoint, &.{operation.id});
        }
        if (cleared_namespace) {
            const deleted = deleted_ids[0..result.deleted_count];
            for (self.annotation_undo.items) |*checkpoint| self.tb.purgeAnnotationCheckpoint(checkpoint, deleted);
            for (self.annotation_redo.items) |*checkpoint| self.tb.purgeAnnotationCheckpoint(checkpoint, deleted);
        }
        return result;
    }

    pub fn clear(self: *EditBuffer) !void {
        self.tb.clear();
        self.clearHistory();
        try self.setCursor(0, 0);
        self.emitNativeEvent("content-changed");
    }

    pub fn getNextWordBoundary(self: *EditBuffer) Cursor {
        if (self.cursors.items.len == 0) return .{ .row = 0, .col = 0 };
        const cursor = self.cursors.items[0];

        const line_count = self.tb.lineCount();
        if (cursor.row >= line_count) return cursor;

        const line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row);

        const linestart = self.tb.rope().getMarker(.linestart, cursor.row) orelse return cursor;
        var seg_idx = linestart.leaf_index + 1;
        var cols_before: u32 = 0;
        var passed_cursor = false;

        while (seg_idx < self.tb.rope().count()) : (seg_idx += 1) {
            const seg = self.tb.rope().get(seg_idx) orelse break;
            if (seg.isBreak() or seg.isLineStart()) break;
            if (seg.asText()) |chunk| {
                const next_cols = cols_before +| chunk.width;

                // Check this chunk if cursor is within it OR if we've already passed the cursor
                if (cursor.col < next_cols or passed_cursor) {
                    const wrap_offsets = self.tb.getWrapOffsetsFor(chunk) catch {
                        cols_before = next_cols;
                        passed_cursor = true;
                        continue;
                    };
                    const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                    const graphemes: []const seg_mod.GraphemeInfo = if (is_ascii_only)
                        &[_]seg_mod.GraphemeInfo{}
                    else
                        chunk.getGraphemes(self.tb.getAllocator(), self.tb.memRegistry(), self.tb.tabWidth(), self.tb.widthMethod()) catch &[_]seg_mod.GraphemeInfo{};
                    var grapheme_idx: usize = 0;
                    var col_delta: i64 = 0;

                    // For chunks containing or after the cursor, find the first break after cursor position
                    const local_cursor_col = if (cursor.col > cols_before) cursor.col - cols_before else 0;

                    for (wrap_offsets) |wrap_break| {
                        const break_info = iter_mod.charOffsetToColumn(wrap_break.char_offset, graphemes, &grapheme_idx, &col_delta);
                        const break_col = break_info.col;

                        // If we've passed the cursor chunk, any break is valid
                        // If we're in the cursor chunk, break must be after cursor position
                        if (passed_cursor or break_col > local_cursor_col) {
                            // break_col points at the break grapheme start.
                            // Adding width moves the cursor to the boundary after it.
                            const target_col = cols_before + break_col + break_info.width;
                            if (target_col <= line_width) {
                                const offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row, target_col) orelse cursor.offset;
                                return .{ .row = cursor.row, .col = target_col, .desired_col = target_col, .offset = offset };
                            }
                        }

                        // A boundary at the cursor can still be the next word step
                        // for script-transition cases like "a日", "日a", or "丽abc".
                        // Only accept it when the boundary starts on a word codepoint.
                        if (!passed_cursor and break_col == local_cursor_col) {
                            const break_byte_offset: usize = @intCast(wrap_break.byte_offset);
                            const chunk_bytes = chunk.getBytes(self.tb.memRegistry());
                            if (break_byte_offset < chunk_bytes.len) {
                                const break_cp = utf8.decodeUtf8Unchecked(chunk_bytes, break_byte_offset).cp;
                                if (utf8.isWordCodepoint(break_cp)) {
                                    const target_col = cols_before + break_col + break_info.width;
                                    if (target_col <= line_width) {
                                        const offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row, target_col) orelse cursor.offset;
                                        return .{ .row = cursor.row, .col = target_col, .desired_col = target_col, .offset = offset };
                                    }
                                }
                            }
                        }
                    }

                    // Mark that we've processed/passed the cursor position
                    passed_cursor = true;
                }
                cols_before = next_cols;
            }
        }

        if (cursor.row + 1 < line_count) {
            const offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row + 1, 0) orelse cursor.offset;
            return .{ .row = cursor.row + 1, .col = 0, .desired_col = 0, .offset = offset };
        }

        const offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row, line_width) orelse cursor.offset;
        return .{ .row = cursor.row, .col = line_width, .desired_col = line_width, .offset = offset };
    }

    pub fn getPrevWordBoundary(self: *EditBuffer) Cursor {
        if (self.cursors.items.len == 0) return .{ .row = 0, .col = 0 };
        const cursor = self.cursors.items[0];

        if (cursor.row == 0 and cursor.col == 0) return cursor;

        const linestart = self.tb.rope().getMarker(.linestart, cursor.row) orelse return cursor;
        var seg_idx = linestart.leaf_index + 1;
        var cols_before: u32 = 0;
        var last_boundary: ?u32 = null;

        while (seg_idx < self.tb.rope().count()) : (seg_idx += 1) {
            const seg = self.tb.rope().get(seg_idx) orelse break;
            if (seg.isBreak() or seg.isLineStart()) break;
            if (seg.asText()) |chunk| {
                const next_cols = cols_before +| chunk.width;

                const wrap_offsets = self.tb.getWrapOffsetsFor(chunk) catch {
                    cols_before = next_cols;
                    continue;
                };
                const is_ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                const graphemes: []const seg_mod.GraphemeInfo = if (is_ascii_only)
                    &[_]seg_mod.GraphemeInfo{}
                else
                    chunk.getGraphemes(self.tb.getAllocator(), self.tb.memRegistry(), self.tb.tabWidth(), self.tb.widthMethod()) catch &[_]seg_mod.GraphemeInfo{};
                var grapheme_idx: usize = 0;
                var col_delta: i64 = 0;

                for (wrap_offsets) |wrap_break| {
                    const break_info = iter_mod.charOffsetToColumn(wrap_break.char_offset, graphemes, &grapheme_idx, &col_delta);
                    // break_info follows the same convention as getNextWordBoundary:
                    // use break start + grapheme width to land after the break grapheme.
                    const boundary_col = cols_before + break_info.col + break_info.width;
                    if (boundary_col < cursor.col) {
                        last_boundary = boundary_col;
                    }
                }

                cols_before = next_cols;
                if (cursor.col <= cols_before) break;
            }
        }

        if (last_boundary) |boundary_col| {
            const offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row, boundary_col) orelse cursor.offset;
            return .{ .row = cursor.row, .col = boundary_col, .desired_col = boundary_col, .offset = offset };
        }

        if (cursor.row > 0) {
            const prev_line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row - 1);
            const offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row - 1, prev_line_width) orelse cursor.offset;
            return .{ .row = cursor.row - 1, .col = prev_line_width, .desired_col = prev_line_width, .offset = offset };
        }

        return .{ .row = 0, .col = 0, .desired_col = 0, .offset = 0 };
    }

    pub fn getEOL(self: *EditBuffer) Cursor {
        if (self.cursors.items.len == 0) return .{ .row = 0, .col = 0 };
        const cursor = self.cursors.items[0];

        const line_count = self.tb.lineCount();
        if (cursor.row >= line_count) return cursor;

        const line_width = iter_mod.lineWidthAt(self.tb.rope(), cursor.row);
        const offset = iter_mod.coordsToOffset(self.tb.rope(), cursor.row, line_width) orelse cursor.offset;

        return .{ .row = cursor.row, .col = line_width, .desired_col = line_width, .offset = offset };
    }

    /// Get text within a range of display-width offsets
    /// Automatically snaps to grapheme boundaries:
    /// - start_offset excludes graphemes that start before it
    /// - end_offset includes graphemes that start before it
    /// Returns number of bytes written to out_buffer
    pub fn getTextRange(self: *EditBuffer, start_offset: u32, end_offset: u32, out_buffer: []u8) !usize {
        return self.tb.getTextRange(start_offset, end_offset, out_buffer);
    }

    /// Get text within a range specified by row/col coordinates
    /// Automatically snaps to grapheme boundaries:
    /// Returns number of bytes written to out_buffer
    pub fn getTextRangeByCoords(self: *EditBuffer, start_row: u32, start_col: u32, end_row: u32, end_col: u32, out_buffer: []u8) usize {
        return self.tb.getTextRangeByCoords(start_row, start_col, end_row, end_col, out_buffer);
    }
};
