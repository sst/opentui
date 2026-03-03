const std = @import("std");
const testing = std.testing;
const stdin_parser = @import("../stdin-parser.zig");

const TokenSnapshot = struct {
    kind: stdin_parser.StdinTokenKind,
    payload: []u8,
};

fn deinitSnapshots(snapshots: *std.ArrayList(TokenSnapshot), allocator: std.mem.Allocator) void {
    for (snapshots.items) |snapshot| {
        allocator.free(snapshot.payload);
    }
    snapshots.deinit(allocator);
}

fn drainAvailable(parser: *stdin_parser.StdinParser, allocator: std.mem.Allocator) !std.ArrayList(TokenSnapshot) {
    var snapshots = std.ArrayList(TokenSnapshot).empty;
    errdefer deinitSnapshots(&snapshots, allocator);

    var token_buf: [32]stdin_parser.StdinToken = undefined;
    var payload_buf: [2048]u8 = undefined;

    while (true) {
        const stats = parser.drain(token_buf[0..], payload_buf[0..]);

        var i: usize = 0;
        while (i < stats.token_count) : (i += 1) {
            const token = token_buf[i];
            const start: usize = @intCast(token.payload_offset);
            const len: usize = @intCast(token.payload_len);

            const copy = try allocator.alloc(u8, len);
            if (len > 0) {
                @memcpy(copy, payload_buf[start .. start + len]);
            }

            try snapshots.append(allocator, .{
                .kind = @enumFromInt(token.kind),
                .payload = copy,
            });
        }

        if (stats.token_count == 0) {
            break;
        }
    }

    return snapshots;
}

test "stdin parser emits mouse then key from one push" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    try parser.push("\x1b[<64;10;5Mx");

    var snapshots = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&snapshots, testing.allocator);

    try testing.expectEqual(@as(usize, 2), snapshots.items.len);
    try testing.expectEqual(stdin_parser.StdinTokenKind.mouse_sgr, snapshots.items[0].kind);
    try testing.expectEqualStrings("\x1b[<64;10;5M", snapshots.items[0].payload);
    try testing.expectEqual(stdin_parser.StdinTokenKind.text, snapshots.items[1].kind);
    try testing.expectEqualStrings("x", snapshots.items[1].payload);
}

test "stdin parser emits key then mouse from one push" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    try parser.push("x\x1b[<64;10;5M");

    var snapshots = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&snapshots, testing.allocator);

    try testing.expectEqual(@as(usize, 2), snapshots.items.len);
    try testing.expectEqual(stdin_parser.StdinTokenKind.text, snapshots.items[0].kind);
    try testing.expectEqualStrings("x", snapshots.items[0].payload);
    try testing.expectEqual(stdin_parser.StdinTokenKind.mouse_sgr, snapshots.items[1].kind);
    try testing.expectEqualStrings("\x1b[<64;10;5M", snapshots.items[1].payload);
}

test "stdin parser handles split SGR mouse across pushes" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    try parser.push("\x1b[<64;10;");

    var first = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&first, testing.allocator);
    try testing.expectEqual(@as(usize, 0), first.items.len);

    try parser.push("5M");

    var second = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&second, testing.allocator);
    try testing.expectEqual(@as(usize, 1), second.items.len);
    try testing.expectEqual(stdin_parser.StdinTokenKind.mouse_sgr, second.items[0].kind);
    try testing.expectEqualStrings("\x1b[<64;10;5M", second.items[0].payload);
}

test "stdin parser handles split OSC response across pushes" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    try parser.push("\x1b]4;0;#fff");

    var first = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&first, testing.allocator);
    try testing.expectEqual(@as(usize, 0), first.items.len);

    try parser.push("fff\x07");

    var second = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&second, testing.allocator);
    try testing.expectEqual(@as(usize, 1), second.items.len);
    try testing.expectEqual(stdin_parser.StdinTokenKind.osc, second.items[0].kind);
    try testing.expectEqualStrings("\x1b]4;0;#ffffff\x07", second.items[0].payload);
}

test "stdin parser handles split bracketed paste across pushes" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    try parser.push("\x1b[200~hello ");

    var first = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&first, testing.allocator);
    try testing.expectEqual(@as(usize, 0), first.items.len);

    try parser.push("world\x1b[201~");

    var second = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&second, testing.allocator);
    try testing.expectEqual(@as(usize, 1), second.items.len);
    try testing.expectEqual(stdin_parser.StdinTokenKind.paste, second.items[0].kind);
    try testing.expectEqualStrings("hello world", second.items[0].payload);
}

test "stdin parser keeps focus sequences mixed with text" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    try parser.push("a\x1b[Ib\x1b[Oc");

    var snapshots = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&snapshots, testing.allocator);

    try testing.expectEqual(@as(usize, 5), snapshots.items.len);
    try testing.expectEqual(stdin_parser.StdinTokenKind.text, snapshots.items[0].kind);
    try testing.expectEqualStrings("a", snapshots.items[0].payload);
    try testing.expectEqual(stdin_parser.StdinTokenKind.csi, snapshots.items[1].kind);
    try testing.expectEqualStrings("\x1b[I", snapshots.items[1].payload);
    try testing.expectEqual(stdin_parser.StdinTokenKind.text, snapshots.items[2].kind);
    try testing.expectEqualStrings("b", snapshots.items[2].payload);
    try testing.expectEqual(stdin_parser.StdinTokenKind.csi, snapshots.items[3].kind);
    try testing.expectEqualStrings("\x1b[O", snapshots.items[3].payload);
    try testing.expectEqual(stdin_parser.StdinTokenKind.text, snapshots.items[4].kind);
    try testing.expectEqualStrings("c", snapshots.items[4].payload);
}

test "stdin parser is chunk-shape invariant" {
    const stream = "x\x1b[<64;10;5M\x1b[I\x1b]4;0;#ffffff\x07\x1b[200~p\x1b[201~👍";

    const parser_a = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser_a.deinit();
    try parser_a.push(stream);
    var single_chunk = try drainAvailable(parser_a, testing.allocator);
    defer deinitSnapshots(&single_chunk, testing.allocator);

    const parser_b = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser_b.deinit();

    const chunks = [_][]const u8{
        "x\x1b[<64",
        ";10;5M\x1b",
        "[I\x1b]4;0;",
        "#ffffff\x07\x1b[200~",
        "p\x1b[201~",
        "👍",
    };

    for (chunks) |chunk| {
        try parser_b.push(chunk);
    }

    var split_chunks = try drainAvailable(parser_b, testing.allocator);
    defer deinitSnapshots(&split_chunks, testing.allocator);

    try testing.expectEqual(single_chunk.items.len, split_chunks.items.len);

    var i: usize = 0;
    while (i < single_chunk.items.len) : (i += 1) {
        try testing.expectEqual(single_chunk.items[i].kind, split_chunks.items[i].kind);
        try testing.expectEqualStrings(single_chunk.items[i].payload, split_chunks.items[i].payload);
    }
}

test "stdin parser timeout keeps pending utf8 lead bytes" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    try parser.push(&[_]u8{0xE9});

    var first = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&first, testing.allocator);
    try testing.expectEqual(@as(usize, 0), first.items.len);

    try parser.flushTimeout(std.math.maxInt(u64));

    var second = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&second, testing.allocator);
    try testing.expectEqual(@as(usize, 0), second.items.len);

    try parser.push(&[_]u8{ 0x80, 0x80 });

    var third = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&third, testing.allocator);

    try testing.expectEqual(@as(usize, 1), third.items.len);
    try testing.expectEqual(stdin_parser.StdinTokenKind.text, third.items[0].kind);
    try testing.expectEqual(@as(usize, 3), third.items[0].payload.len);
    try testing.expectEqual(@as(u8, 0xE9), third.items[0].payload[0]);
    try testing.expectEqual(@as(u8, 0x80), third.items[0].payload[1]);
    try testing.expectEqual(@as(u8, 0x80), third.items[0].payload[2]);
}

test "stdin parser reset releases retained buffer capacity" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    const chunk = [_]u8{'x'} ** 4096;
    try parser.push(&chunk);

    const grown_capacity = parser.buffer.capacity;
    try testing.expect(grown_capacity >= chunk.len);

    parser.reset();

    try testing.expect(parser.buffer.capacity <= 256);
}

test "stdin parser releases invalid utf8 lead when next byte is not continuation" {
    const parser = try stdin_parser.StdinParser.init(testing.allocator, stdin_parser.defaultOptions());
    defer parser.deinit();

    try parser.push(&[_]u8{0xE9});

    var first = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&first, testing.allocator);
    try testing.expectEqual(@as(usize, 0), first.items.len);

    try parser.push("x");

    var second = try drainAvailable(parser, testing.allocator);
    defer deinitSnapshots(&second, testing.allocator);

    try testing.expectEqual(@as(usize, 2), second.items.len);
    try testing.expectEqual(stdin_parser.StdinTokenKind.unknown, second.items[0].kind);
    try testing.expectEqual(@as(usize, 1), second.items[0].payload.len);
    try testing.expectEqual(@as(u8, 0xE9), second.items[0].payload[0]);
    try testing.expectEqual(stdin_parser.StdinTokenKind.text, second.items[1].kind);
    try testing.expectEqualStrings("x", second.items[1].payload);
}
