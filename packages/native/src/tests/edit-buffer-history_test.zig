const std = @import("std");
const edit_buffer = @import("../edit-buffer.zig");
const gp = @import("../grapheme.zig");
const link = @import("../link.zig");
const TextAnnotations = @import("../text-annotations.zig").TextAnnotations;

const EditBuffer = edit_buffer.EditBuffer;

fn expectText(eb: *EditBuffer, expected: []const u8) !void {
    const output = try std.testing.allocator.alloc(u8, eb.getTextBuffer().getByteSize());
    defer std.testing.allocator.free(output);
    const written = eb.getText(output);
    try std.testing.expectEqualStrings(expected, output[0..written]);
}

fn expectAnnotationsEqual(expected: *TextAnnotations, actual: *TextAnnotations) !void {
    try std.testing.expectEqual(expected.count(), actual.count());
    var iterator = expected.iterator();
    while (try iterator.next()) |annotation| try std.testing.expectEqualDeep(annotation, actual.get(annotation.id()).?);
}

fn prepareRedoBranch(eb: *EditBuffer) !u64 {
    try eb.setText("abc");
    const id = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = 1, .end_byte = 2 }, .{
        .namespace = 91,
        .style_id = 77,
        .priority = 4,
        .kind_flags = 0x81,
    });
    try eb.setCursor(0, 1);
    try eb.insertText("X");
    _ = try eb.undo();
    try std.testing.expect(!eb.canUndo());
    try std.testing.expect(eb.canRedo());
    return id;
}

const FailedEdit = enum { insert, delete, replace, set };

fn runEdit(eb: *EditBuffer, operation: FailedEdit) !void {
    switch (operation) {
        .insert => try eb.insertText("Y"),
        .delete => try eb.deleteRange(.{ .row = 0, .col = 0 }, .{ .row = 0, .col = 1 }),
        .replace => try eb.replaceText("replacement"),
        .set => try eb.setText("replacement"),
    }
}

fn exerciseFailedHistoryEdit(operation: FailedEdit, fail_offset: ?usize) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(failing.allocator(), pool, link_pool, .wcwidth, null);
    defer eb.deinit();
    const id = try prepareRedoBranch(eb);
    const before_annotation: TextAnnotations.Annotation = eb.getTextBuffer().textAnnotations().get(id).?;
    const before_cursor = eb.getPrimaryCursor();
    const before_root = eb.getTextBuffer().rope().root;
    const before_version = eb.getTextBuffer().rope().version;
    const before_content_epoch = eb.getTextBuffer().getContentEpoch();
    const before_annotation_epoch = eb.getTextBuffer().getAnnotationEpoch();
    const before_position_generation = eb.getTextBuffer().textAnnotations().positionGeneration();
    const before_alloc = failing.alloc_index;
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const edit = runEdit(eb, operation);
    if (fail_offset != null) {
        var failed = false;
        edit catch |err| {
            try std.testing.expectEqual(error.OutOfMemory, err);
            failed = true;
        };
        if (!failed) {
            // setText publishes before best-effort post-clear compaction. Failure
            // of that cleanup allocation must not roll back the semantic edit.
            try std.testing.expectEqual(FailedEdit.set, operation);
            try expectText(eb, "replacement");
            try std.testing.expect(!eb.canUndo());
            try std.testing.expect(!eb.canRedo());
            return failing.alloc_index - before_alloc;
        }
        try expectText(eb, "abc");
        try std.testing.expectEqual(before_cursor, eb.getPrimaryCursor());
        try std.testing.expect(eb.getTextBuffer().rope().root == before_root);
        try std.testing.expectEqual(before_version, eb.getTextBuffer().rope().version);
        try std.testing.expectEqual(before_content_epoch, eb.getTextBuffer().getContentEpoch());
        try std.testing.expectEqual(before_annotation_epoch, eb.getTextBuffer().getAnnotationEpoch());
        try std.testing.expectEqual(before_position_generation, eb.getTextBuffer().textAnnotations().positionGeneration());
        try std.testing.expectEqualDeep(before_annotation, eb.getTextBuffer().textAnnotations().get(id).?);
        try std.testing.expect(!eb.canUndo());
        try std.testing.expect(eb.canRedo());

        failing.fail_index = std.math.maxInt(usize);
        _ = try eb.redo();
        try expectText(eb, "aXbc");
        _ = try eb.undo();
        try expectText(eb, "abc");
        try std.testing.expectEqualDeep(before_annotation, eb.getTextBuffer().textAnnotations().get(id).?);
        try runEdit(eb, operation);
        if (operation == .set) {
            try std.testing.expect(!eb.canUndo());
            try std.testing.expect(!eb.canRedo());
        } else {
            try std.testing.expect(eb.canUndo());
            try std.testing.expect(!eb.canRedo());
            _ = try eb.undo();
            try expectText(eb, "abc");
            try std.testing.expectEqualDeep(before_annotation, eb.getTextBuffer().textAnnotations().get(id).?);
        }
    } else {
        try edit;
    }
    return failing.alloc_index - before_alloc;
}

fn exerciseFailedSparseUndo(fail_offset: ?usize) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(failing.allocator(), pool, link_pool, .wcwidth, null);
    defer eb.deinit();
    try eb.setText("abcdef");
    const id = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = 1, .end_byte = 4 }, .{
        .namespace = 1,
        .style_id = 7,
        .splice_policy = .invalidate,
    });
    const before = eb.getTextBuffer().textAnnotations().get(id).?;
    try eb.deleteRange(.{ .row = 0, .col = 1 }, .{ .row = 0, .col = 4 });
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(id) == null);
    const root = eb.getTextBuffer().rope().root;
    const version = eb.getTextBuffer().rope().version;
    const cursor = eb.getPrimaryCursor();
    const before_alloc = failing.alloc_index;
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const undo_result = eb.undo();
    if (fail_offset != null) {
        try std.testing.expectError(error.OutOfMemory, undo_result);
        try expectText(eb, "aef");
        try std.testing.expect(eb.getTextBuffer().rope().root == root);
        try std.testing.expectEqual(version, eb.getTextBuffer().rope().version);
        try std.testing.expectEqual(cursor, eb.getPrimaryCursor());
        try std.testing.expect(eb.getTextBuffer().textAnnotations().get(id) == null);
        try std.testing.expect(eb.canUndo());
        try std.testing.expect(!eb.canRedo());
        failing.fail_index = std.math.maxInt(usize);
        _ = try eb.undo();
        try expectText(eb, "abcdef");
        try std.testing.expectEqualDeep(before, eb.getTextBuffer().textAnnotations().get(id).?);
    } else {
        _ = try undo_result;
    }
    return failing.alloc_index - before_alloc;
}

fn exerciseFailedSparseRedo(fail_offset: ?usize) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(failing.allocator(), pool, link_pool, .wcwidth, null);
    defer eb.deinit();
    try eb.setText("abcdef");
    try eb.insertText("X");
    var created: [1]u64 = undefined;
    var deleted: [1]u64 = undefined;
    const add = [_]@import("../text-buffer.zig").AnnotationOperation{
        .{ .kind = .add_point, .start_byte = 2, .payload = .{ .namespace = 1, .style_id = 7 } },
    };
    _ = try eb.applyAnnotationOperations(&add, &created, &deleted);
    const after = eb.getTextBuffer().textAnnotations().get(created[0]).?;
    _ = try eb.undo();
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[0]) == null);
    const root = eb.getTextBuffer().rope().root;
    const version = eb.getTextBuffer().rope().version;
    const cursor = eb.getPrimaryCursor();
    const before_alloc = failing.alloc_index;
    if (fail_offset) |offset| failing.fail_index = before_alloc + offset;

    const redo_result = eb.redo();
    if (fail_offset != null) {
        try std.testing.expectError(error.OutOfMemory, redo_result);
        try expectText(eb, "abcdef");
        try std.testing.expect(eb.getTextBuffer().rope().root == root);
        try std.testing.expectEqual(version, eb.getTextBuffer().rope().version);
        try std.testing.expectEqual(cursor, eb.getPrimaryCursor());
        try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[0]) == null);
        try std.testing.expect(!eb.canUndo());
        try std.testing.expect(eb.canRedo());
        failing.fail_index = std.math.maxInt(usize);
        _ = try eb.redo();
        try expectText(eb, "Xabcdef");
        try std.testing.expectEqualDeep(after, eb.getTextBuffer().textAnnotations().get(created[0]).?);
    } else {
        _ = try redo_result;
    }
    return failing.alloc_index - before_alloc;
}

fn localEditAllocationCount(mark_count: usize, max_undo_depth: ?usize) !usize {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{});
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(failing.allocator(), pool, link_pool, .wcwidth, null);
    defer eb.deinit();
    try eb.setText("local edit");
    eb.setMaxUndoDepth(max_undo_depth);
    for (0..mark_count) |index| {
        const start: u32 = @intCast(1_000 + index * 2);
        _ = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = start, .end_byte = start + 1 }, .{
            .namespace = 1,
            .splice_policy = .delete_when_covered,
        });
    }
    const before = failing.alloc_index;
    try eb.insertText("X");
    return failing.alloc_index - before;
}

test "failed edits preserve exact cursor annotations history and redo branch" {
    for (std.enums.values(FailedEdit)) |operation| {
        const allocations = try exerciseFailedHistoryEdit(operation, null);
        for (0..allocations) |offset| _ = try exerciseFailedHistoryEdit(operation, offset);
    }
}

test "failed sparse undo preparation preserves exact state and remains retryable" {
    const allocations = try exerciseFailedSparseUndo(null);
    for (0..allocations) |offset| _ = try exerciseFailedSparseUndo(offset);
}

test "failed sparse redo preparation preserves exact state and remains retryable" {
    const allocations = try exerciseFailedSparseRedo(null);
    for (0..allocations) |offset| _ = try exerciseFailedSparseRedo(offset);
}

test "invalid edit coordinates and text preserve history and redo branch" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();
    const id = try prepareRedoBranch(eb);
    const annotation = eb.getTextBuffer().textAnnotations().get(id).?;
    const root = eb.getTextBuffer().rope().root;
    const version = eb.getTextBuffer().rope().version;

    eb.cursors.items[0] = .{ .row = 99, .col = 99, .desired_col = 99, .offset = 99 };
    const invalid_cursor = eb.getPrimaryCursor();
    try std.testing.expectError(error.InvalidCursor, eb.insertText("Y"));
    try std.testing.expectEqual(invalid_cursor, eb.getPrimaryCursor());
    try eb.setCursor(0, 1);
    const valid_cursor = eb.getPrimaryCursor();
    try std.testing.expectError(error.InvalidCursor, eb.deleteRange(.{ .row = 0, .col = 0 }, .{ .row = 9, .col = 0 }));
    try std.testing.expectError(error.InvalidUtf8, eb.replaceText("\xff"));
    try std.testing.expectError(error.InvalidUtf8, eb.setText("\xff"));

    try expectText(eb, "abc");
    try std.testing.expectEqual(valid_cursor, eb.getPrimaryCursor());
    try std.testing.expect(eb.getTextBuffer().rope().root == root);
    try std.testing.expectEqual(version, eb.getTextBuffer().rope().version);
    try std.testing.expectEqualDeep(annotation, eb.getTextBuffer().textAnnotations().get(id).?);
    try std.testing.expect(!eb.canUndo());
    try std.testing.expect(eb.canRedo());
    _ = try eb.redo();
    try expectText(eb, "aXbc");
}

test "virtual annotation policy is native and reference counted" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("abc[LINK]def");
    _ = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = 3, .end_byte = 9 }, .{
        .namespace = 1,
        .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual,
        .splice_policy = .delete_when_covered,
    });
    eb.setVirtualAnnotationPolicy(true);
    eb.setVirtualAnnotationPolicy(true);

    try eb.setCursorByOffset(2);
    eb.moveRight();
    try std.testing.expectEqual(@as(u32, 9), eb.getPrimaryCursor().offset);
    eb.moveLeft();
    try std.testing.expectEqual(@as(u32, 2), eb.getPrimaryCursor().offset);

    eb.setVirtualAnnotationPolicy(false);
    try eb.setCursorByOffset(2);
    eb.moveRight();
    try std.testing.expectEqual(@as(u32, 9), eb.getPrimaryCursor().offset);
    eb.setVirtualAnnotationPolicy(false);
    try eb.setCursorByOffset(2);
    eb.moveRight();
    try std.testing.expectEqual(@as(u32, 3), eb.getPrimaryCursor().offset);
}

test "virtual annotation policy ignores points and empty ranges without looping at buffer start" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("abcdef");
    const annotations = eb.getTextBuffer().textAnnotations();
    _ = try annotations.addPoint(.{ .byte = 2 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    _ = try annotations.addRange(.{ .start_byte = 3, .end_byte = 3 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    eb.setVirtualAnnotationPolicy(true);

    try eb.setCursorByOffset(0);
    try eb.setCursorByOffset(2);
    try std.testing.expectEqual(@as(u32, 2), eb.getPrimaryCursor().offset);
    try eb.setCursorByOffset(3);
    try std.testing.expectEqual(@as(u32, 3), eb.getPrimaryCursor().offset);

    _ = try annotations.addRange(.{ .start_byte = 0, .end_byte = 2 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    try eb.setCursorByOffset(5);
    try eb.setCursorByOffset(0);
    try std.testing.expectEqual(@as(u32, 2), eb.getPrimaryCursor().offset);
}

test "virtual annotation direct placement and zero-start chains always resolve outside" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .unicode, null);
    defer eb.deinit();

    try eb.setText("0123456789");
    try eb.setCursorByOffset(3);
    const annotations = eb.getTextBuffer().textAnnotations();
    _ = try annotations.addRange(.{ .start_byte = 2, .end_byte = 5 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    eb.setVirtualAnnotationPolicy(true);
    try eb.setCursorByOffset(3);
    try std.testing.expectEqual(@as(u32, 5), eb.getPrimaryCursor().offset);

    _ = try annotations.addRange(.{ .start_byte = 0, .end_byte = 3 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    _ = try annotations.addRange(.{ .start_byte = 2, .end_byte = 6 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    _ = try annotations.addRange(.{ .start_byte = 4, .end_byte = 8 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    _ = try annotations.addRange(.{ .start_byte = 2, .end_byte = 6 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    try eb.setCursorByOffset(9);
    try eb.setCursorByOffset(1);
    try std.testing.expectEqual(@as(u32, 8), eb.getPrimaryCursor().offset);

    try std.testing.expectEqual(@as(usize, 5), try annotations.clearNamespace(1));
    _ = try annotations.addRange(.{ .start_byte = 0, .end_byte = 3 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    _ = try annotations.addRange(.{ .start_byte = 2, .end_byte = 5 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    _ = try annotations.addRange(.{ .start_byte = 4, .end_byte = 7 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    _ = try annotations.addRange(.{ .start_byte = 6, .end_byte = 9 }, .{ .namespace = 1, .kind_flags = @import("../text-buffer.zig").annotation_kind_virtual });
    try eb.setCursorByOffset(10);
    try eb.setCursorByOffset(7);
    try std.testing.expectEqual(@as(u32, 9), eb.getPrimaryCursor().offset);
}

test "explicit annotation removals are purged from text history" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("abcdef");
    var created: [2]u64 = undefined;
    var deleted: [2]u64 = undefined;
    const adds = [_]@import("../text-buffer.zig").AnnotationOperation{
        .{ .kind = .add_range, .start_byte = 1, .end_byte = 3, .payload = .{ .namespace = 7, .style_id = 31 } },
        .{ .kind = .add_range, .start_byte = 3, .end_byte = 5, .payload = .{ .namespace = 8, .style_id = 32 } },
    };
    _ = try eb.applyAnnotationOperations(&adds, &created, &deleted);
    try eb.setCursorByOffset(0);
    try eb.insertText("X");
    _ = try eb.undo();

    const clear = [_]@import("../text-buffer.zig").AnnotationOperation{
        .{ .kind = .clear_namespace, .payload = .{ .namespace = 7 } },
    };
    const clear_result = try eb.applyAnnotationOperations(&clear, &.{}, &deleted);
    try std.testing.expectEqual(@as(usize, 1), clear_result.deleted_count);
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[0]) == null);
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[1]) != null);

    _ = try eb.redo();
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[0]) == null);
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[1]) != null);
    _ = try eb.undo();
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[0]) == null);
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[1]) != null);
}

test "namespace clear purges annotations detached by policy deletion" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("abcdef");
    var created: [1]u64 = undefined;
    var deleted: [1]u64 = undefined;
    const add = [_]@import("../text-buffer.zig").AnnotationOperation{
        .{ .kind = .add_range, .start_byte = 1, .end_byte = 4, .payload = .{ .namespace = 9, .splice_policy = .invalidate } },
    };
    _ = try eb.applyAnnotationOperations(&add, &created, &deleted);
    try eb.deleteRange(.{ .row = 0, .col = 1 }, .{ .row = 0, .col = 4 });
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[0]) == null);

    const clear = [_]@import("../text-buffer.zig").AnnotationOperation{
        .{ .kind = .clear_namespace, .payload = .{ .namespace = 9 } },
    };
    const result = try eb.applyAnnotationOperations(&clear, &.{}, &deleted);
    try std.testing.expectEqual(@as(usize, 0), result.deleted_count);
    _ = try eb.undo();
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[0]) == null);
}

test "sparse annotation delta restores policy deletions and exact affected shapes" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("0123456789");
    const annotations = eb.getTextBuffer().textAnnotations();
    const retained = try annotations.addRange(.{
        .start_byte = 8,
        .end_byte = 2,
        .start_gravity = .left,
        .end_gravity = .right,
    }, .{ .namespace = 1, .style_id = 11, .priority = 3 });
    const invalidated = try annotations.addPoint(.{ .byte = 4, .gravity = .left }, .{
        .namespace = 2,
        .style_id = 12,
        .kind_flags = 9,
        .splice_policy = .invalidate,
    });
    const before_retained = annotations.get(retained).?;
    const before_invalidated = annotations.get(invalidated).?;

    try eb.deleteRange(.{ .row = 0, .col = 2 }, .{ .row = 0, .col = 7 });
    const after_retained = annotations.get(retained).?;
    try std.testing.expect(annotations.get(invalidated) == null);
    try std.testing.expectEqual(@as(usize, 2), eb.edit_undo.items[0].changes.items.len);

    _ = try eb.undo();
    try std.testing.expectEqualDeep(before_retained, annotations.get(retained).?);
    try std.testing.expectEqualDeep(before_invalidated, annotations.get(invalidated).?);
    _ = try eb.redo();
    try std.testing.expectEqualDeep(after_retained, annotations.get(retained).?);
    try std.testing.expect(annotations.get(invalidated) == null);
}

test "annotation CRUD journals both sides of active text history branches" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("abcdef");
    var created: [2]u64 = undefined;
    var deleted: [2]u64 = undefined;
    const initial = [_]@import("../text-buffer.zig").AnnotationOperation{
        .{ .kind = .add_range, .start_byte = 2, .end_byte = 4, .payload = .{ .namespace = 1, .style_id = 10 } },
    };
    _ = try eb.applyAnnotationOperations(&initial, created[0..1], &deleted);
    const original = eb.getTextBuffer().textAnnotations().get(created[0]).?;
    try eb.setCursorByOffset(0);
    try eb.insertText("X");

    const after_crud = [_]@import("../text-buffer.zig").AnnotationOperation{
        .{ .kind = .update_range, .id = created[0], .start_byte = 4, .end_byte = 6 },
        .{ .kind = .update_payload, .id = created[0], .payload = .{ .namespace = 1, .style_id = 20, .priority = 7 } },
        .{ .kind = .add_point, .start_byte = 1, .payload = .{ .namespace = 2, .style_id = 30 } },
    };
    _ = try eb.applyAnnotationOperations(&after_crud, created[1..2], &deleted);
    const edited = eb.getTextBuffer().textAnnotations().get(created[0]).?;
    const added_after = eb.getTextBuffer().textAnnotations().get(created[1]).?;

    _ = try eb.undo();
    try std.testing.expectEqualDeep(original, eb.getTextBuffer().textAnnotations().get(created[0]).?);
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(created[1]) == null);
    _ = try eb.redo();
    try std.testing.expectEqualDeep(edited, eb.getTextBuffer().textAnnotations().get(created[0]).?);
    try std.testing.expectEqualDeep(added_after, eb.getTextBuffer().textAnnotations().get(created[1]).?);

    _ = try eb.undo();
    const before_crud = [_]@import("../text-buffer.zig").AnnotationOperation{
        .{ .kind = .update_range, .id = created[0], .start_byte = 1, .end_byte = 2 },
        .{ .kind = .add_point, .start_byte = 5, .payload = .{ .namespace = 3, .style_id = 40 } },
    };
    _ = try eb.applyAnnotationOperations(&before_crud, created[1..2], &deleted);
    const modified_before = eb.getTextBuffer().textAnnotations().get(created[0]).?;
    const added_before_id = created[1];
    _ = try eb.redo();
    try std.testing.expectEqualDeep(edited, eb.getTextBuffer().textAnnotations().get(created[0]).?);
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(added_before_id) == null);
    _ = try eb.undo();
    try std.testing.expectEqualDeep(modified_before, eb.getTextBuffer().textAnnotations().get(created[0]).?);
    try std.testing.expect(eb.getTextBuffer().textAnnotations().get(added_before_id) != null);
}

test "zero undo depth creates no annotation delta entries" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("abcdef");
    eb.setMaxUndoDepth(0);
    _ = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = 2, .end_byte = 4 }, .{ .namespace = 1 });
    try eb.setCursorByOffset(0);
    try eb.insertText("X");
    try std.testing.expectEqual(@as(usize, 0), eb.edit_undo.items.len);
    try std.testing.expect(!eb.canUndo());
}

test "distant annotation count does not change local edit allocation count" {
    const empty = try localEditAllocationCount(0, null);
    try std.testing.expectEqual(empty, try localEditAllocationCount(1_000, null));
    try std.testing.expectEqual(empty, try localEditAllocationCount(10_000, null));
    try std.testing.expect(try localEditAllocationCount(10_000, 0) < empty);
}

test "sparse annotation history matches snapshot oracle across randomized edits" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqr");
    var random: u64 = 0x6a09e667f3bcc909;
    const next = struct {
        fn value(state: *u64) u64 {
            state.* ^= state.* << 13;
            state.* ^= state.* >> 7;
            state.* ^= state.* << 17;
            return state.*;
        }
    }.value;
    for (0..100) |_| {
        const size = eb.getTextBuffer().getByteSize();
        const first: u32 = @intCast(next(&random) % (size + 1));
        const second: u32 = @intCast(next(&random) % (size + 1));
        const start = @min(first, second);
        const end = @max(first, second);
        const policy: TextAnnotations.SplicePolicy = switch (next(&random) % 3) {
            0 => .retain,
            1 => .invalidate,
            else => .delete_when_covered,
        };
        _ = try eb.getTextBuffer().textAnnotations().addRange(.{
            .start_byte = if (next(&random) & 1 == 0) start else end,
            .end_byte = if (next(&random) & 1 == 0) end else start,
            .start_gravity = if (next(&random) & 1 == 0) .left else .right,
            .end_gravity = if (next(&random) & 1 == 0) .left else .right,
        }, .{ .namespace = @intCast(next(&random) % 5), .style_id = @intCast(next(&random) % 100), .splice_policy = policy });
    }

    for (0..100) |_| {
        const before_text = try std.testing.allocator.alloc(u8, eb.getTextBuffer().getByteSize());
        defer std.testing.allocator.free(before_text);
        _ = eb.getText(before_text);
        var before = try eb.getTextBuffer().textAnnotations().clone(std.testing.allocator);
        defer before.deinit();
        const size = eb.getTextBuffer().getByteSize();
        if (size == 0 or next(&random) & 1 == 0) {
            const at: u32 = @intCast(next(&random) % (size + 1));
            try eb.setCursorByOffset(at);
            try eb.insertText("x");
        } else {
            const start: u32 = @intCast(next(&random) % size);
            const len: u32 = @intCast(@min(@as(u64, size - start), next(&random) % 5 + 1));
            try eb.deleteRange(.{ .row = 0, .col = start }, .{ .row = 0, .col = start + len });
        }
        const after_text = try std.testing.allocator.alloc(u8, eb.getTextBuffer().getByteSize());
        defer std.testing.allocator.free(after_text);
        _ = eb.getText(after_text);
        var after = try eb.getTextBuffer().textAnnotations().clone(std.testing.allocator);
        defer after.deinit();

        _ = try eb.undo();
        try expectText(eb, before_text);
        try expectAnnotationsEqual(&before, eb.getTextBuffer().textAnnotations());
        _ = try eb.redo();
        try expectText(eb, after_text);
        try expectAnnotationsEqual(&after, eb.getTextBuffer().textAnnotations());
    }
}

test "bounded edit history trims sparse annotation deltas with repeated edits" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();
    const eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("abcdefghij");
    eb.setMaxUndoDepth(4);
    for (0..10_000) |index| {
        const start: u32 = @intCast(1_000 + index * 2);
        _ = try eb.getTextBuffer().textAnnotations().addRange(.{ .start_byte = start, .end_byte = start + 1 }, .{ .namespace = 1 });
    }
    for (0..100) |_| try eb.insertText("x");

    try std.testing.expectEqual(@as(usize, 4), eb.edit_undo.items.len);
    for (eb.edit_undo.items) |delta| try std.testing.expectEqual(@as(usize, 0), delta.changes.items.len);
    eb.clearHistory();
    try std.testing.expectEqual(@as(usize, 0), eb.edit_undo.items.len);
}

test "EditBuffer - basic undo/redo with insertText" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.insertText("Hello");

    try eb.insertText(" World");
    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);

    const meta = try eb.undo();
    try std.testing.expect(std.mem.startsWith(u8, meta, "cursor:"));
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);

    const meta2 = try eb.redo();
    try std.testing.expect(std.mem.startsWith(u8, meta2, "cursor:"));
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);
}

test "EditBuffer - undo and redo restore cursor for mid-line edits" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.setText("hello world");
    try eb.setCursor(0, 8);

    try eb.insertText("X");
    var cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 9), cursor.col);

    _ = try eb.undo();
    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 8), cursor.col);

    _ = try eb.redo();
    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 0), cursor.row);
    try std.testing.expectEqual(@as(u32, 9), cursor.col);
}

test "EditBuffer - canUndo/canRedo" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try std.testing.expect(!eb.canUndo());
    try std.testing.expect(!eb.canRedo());

    try eb.insertText("Test");

    try std.testing.expect(eb.canUndo());
    try std.testing.expect(!eb.canRedo());

    _ = try eb.undo();

    try std.testing.expect(!eb.canUndo());
    try std.testing.expect(eb.canRedo());

    _ = try eb.redo();

    try std.testing.expect(eb.canUndo());
    try std.testing.expect(!eb.canRedo());
}

test "EditBuffer - undo/redo with deleteRange" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.insertText("Hello World");

    try eb.deleteRange(.{ .row = 0, .col = 5 }, .{ .row = 0, .col = 11 });
    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);

    _ = try eb.undo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello World", out_buffer[0..written]);

    _ = try eb.redo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);
}

test "EditBuffer - undo/redo with backspace" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.insertText("Hello");

    try eb.backspace();
    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hell", out_buffer[0..written]);

    _ = try eb.undo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);
}

test "EditBuffer - undo/redo with deleteForward" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.insertText("Hello");
    try eb.setCursor(0, 0);

    try eb.deleteForward();
    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("ello", out_buffer[0..written]);

    _ = try eb.undo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("Hello", out_buffer[0..written]);
}

test "EditBuffer - cursor position after undo" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.insertText("Line 1\nLine 2");
    var cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);

    try eb.insertText("\nLine 3");
    cursor = eb.getPrimaryCursor();
    try std.testing.expectEqual(@as(u32, 2), cursor.row);

    // Undo - cursor should be clamped to valid position
    _ = try eb.undo();
    cursor = eb.getPrimaryCursor();
    // Cursor should be clamped to end of line 1
    try std.testing.expectEqual(@as(u32, 1), cursor.row);
    try std.testing.expectEqual(@as(u32, 6), cursor.col);
}

test "EditBuffer - lineCount after undo/redo" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.insertText("Line 1");
    try std.testing.expectEqual(@as(u32, 1), eb.getTextBuffer().lineCount());

    try eb.insertText("\nLine 2\nLine 3");
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());

    _ = try eb.undo();
    try std.testing.expectEqual(@as(u32, 1), eb.getTextBuffer().lineCount());

    _ = try eb.redo();
    try std.testing.expectEqual(@as(u32, 3), eb.getTextBuffer().lineCount());
}

test "EditBuffer - clearHistory" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.insertText("Hello");
    try eb.insertText(" World");

    try std.testing.expect(eb.canUndo());

    eb.clearHistory();

    try std.testing.expect(!eb.canUndo());
    try std.testing.expect(!eb.canRedo());
}

test "EditBuffer - undo history branching" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    try eb.insertText("State A");

    try eb.insertText(" -> B");

    var out_buffer: [100]u8 = undefined;
    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("State A -> B", out_buffer[0..written]);

    _ = try eb.undo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("State A", out_buffer[0..written]);

    // Create new branch by editing after undo
    try eb.insertText(" -> C");

    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("State A -> C", out_buffer[0..written]);

    _ = try eb.undo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("State A", out_buffer[0..written]);

    // Redo should go to state C (the new branch)
    _ = try eb.redo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("State A -> C", out_buffer[0..written]);
}

test "EditBuffer - multiple undo/redo operations" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    const link_pool = link.initGlobalLinkPool(std.testing.allocator);
    defer link.deinitGlobalLinkPool();

    var eb = try EditBuffer.init(std.testing.allocator, pool, link_pool, .wcwidth, null);
    defer eb.deinit();

    var out_buffer: [100]u8 = undefined;

    try eb.insertText("A");

    try eb.insertText("B");

    try eb.insertText("C");

    var written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("ABC", out_buffer[0..written]);

    _ = try eb.undo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("AB", out_buffer[0..written]);

    _ = try eb.undo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("A", out_buffer[0..written]);

    _ = try eb.redo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("AB", out_buffer[0..written]);

    _ = try eb.redo();
    written = eb.getText(&out_buffer);
    try std.testing.expectEqualStrings("ABC", out_buffer[0..written]);
}
