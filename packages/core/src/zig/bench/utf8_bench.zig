const std = @import("std");
const bench_utils = @import("../bench-utils.zig");
const utf8 = @import("../utf8.zig");

const BenchResult = bench_utils.BenchResult;

pub const benchName = "UTF-8 Operations";

// Test data generators
fn generateAsciiText(allocator: std.mem.Allocator, length: usize) ![]const u8 {
    var text = try allocator.alloc(u8, length);
    var i: usize = 0;
    while (i < length) : (i += 1) {
        // Generate printable ASCII (32-126)
        text[i] = @as(u8, @intCast(32 + (i % 95)));
    }
    return text;
}

fn generateMixedText(allocator: std.mem.Allocator, length: usize) ![]const u8 {
    var text = std.ArrayList(u8).init(allocator);
    var i: usize = 0;
    while (text.items.len < length) : (i += 1) {
        if (i % 4 == 0) {
            // Unicode character (3 bytes)
            try text.appendSlice("世");
        } else if (i % 4 == 1) {
            // Emoji (4 bytes)
            try text.appendSlice("😀");
        } else {
            // ASCII
            try text.append(@as(u8, @intCast(32 + (i % 95))));
        }
    }
    return text.toOwnedSlice();
}

fn generateUnicodeHeavyText(allocator: std.mem.Allocator, length: usize) ![]const u8 {
    var text = std.ArrayList(u8).init(allocator);
    var i: usize = 0;
    while (text.items.len < length) : (i += 1) {
        if (i % 3 == 0) {
            try text.appendSlice("世界");
        } else if (i % 3 == 1) {
            try text.appendSlice("😀🎉");
        } else {
            try text.appendSlice("Ñoño");
        }
    }
    return text.toOwnedSlice();
}

fn generateTextWithLineBreaks(allocator: std.mem.Allocator, length: usize, break_kind: utf8.LineBreakKind) ![]const u8 {
    var text = std.ArrayList(u8).init(allocator);
    var i: usize = 0;
    while (text.items.len < length) : (i += 1) {
        // Add some content
        var j: usize = 0;
        while (j < 80 and text.items.len < length) : (j += 1) {
            try text.append(@as(u8, @intCast(32 + (j % 95))));
        }
        if (text.items.len >= length) break;

        // Add line break
        switch (break_kind) {
            .LF => try text.append('\n'),
            .CR => try text.append('\r'),
            .CRLF => try text.appendSlice("\r\n"),
        }
    }
    return text.toOwnedSlice();
}

fn generateTextWithWrapBreaks(allocator: std.mem.Allocator, length: usize) ![]const u8 {
    var text = std.ArrayList(u8).init(allocator);
    const break_chars = " \t-/\\.,;:!?()[]{}";
    var i: usize = 0;
    while (text.items.len < length) : (i += 1) {
        if (i % 10 == 0 and i > 0) {
            try text.append(break_chars[i % break_chars.len]);
        } else {
            try text.append(@as(u8, @intCast(97 + (i % 26)))); // a-z
        }
    }
    return text.toOwnedSlice();
}

// Benchmark isAsciiOnly
fn benchIsAsciiOnly(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Small ASCII text (1KB)
    {
        const text = try generateAsciiText(allocator, 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.isAsciiOnly(text);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "isAsciiOnly: ASCII text (1KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large ASCII text (100KB)
    {
        const text = try generateAsciiText(allocator, 100 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.isAsciiOnly(text);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "isAsciiOnly: ASCII text (100KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text (1KB)
    {
        const text = try generateMixedText(allocator, 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.isAsciiOnly(text);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "isAsciiOnly: Mixed text (1KB) - early exit", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

// Benchmark findLineBreaksSIMD16
fn benchFindLineBreaks(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // LF line breaks
    {
        const text = try generateTextWithLineBreaks(allocator, 10 * 1024, .LF);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var line_breaks = utf8.LineBreakResult.init(allocator);
            defer line_breaks.deinit();

            var timer = try std.time.Timer.start();
            try utf8.findLineBreaksSIMD16(text, &line_breaks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findLineBreaks: LF (10KB, ~125 breaks)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // CRLF line breaks
    {
        const text = try generateTextWithLineBreaks(allocator, 10 * 1024, .CRLF);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var line_breaks = utf8.LineBreakResult.init(allocator);
            defer line_breaks.deinit();

            var timer = try std.time.Timer.start();
            try utf8.findLineBreaksSIMD16(text, &line_breaks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findLineBreaks: CRLF (10KB, ~120 breaks)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // No line breaks (fast path)
    {
        const text = try generateAsciiText(allocator, 10 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var line_breaks = utf8.LineBreakResult.init(allocator);
            defer line_breaks.deinit();

            var timer = try std.time.Timer.start();
            try utf8.findLineBreaksSIMD16(text, &line_breaks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findLineBreaks: No breaks (10KB) - fast path", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

// Benchmark findWrapBreaksSIMD16
fn benchFindWrapBreaks(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // ASCII with wrap breaks
    {
        const text = try generateTextWithWrapBreaks(allocator, 10 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var wrap_breaks = utf8.WrapBreakResult.init(allocator);
            defer wrap_breaks.deinit();

            var timer = try std.time.Timer.start();
            try utf8.findWrapBreaksSIMD16(text, &wrap_breaks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findWrapBreaks: ASCII (10KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text
    {
        const text = try generateMixedText(allocator, 10 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var wrap_breaks = utf8.WrapBreakResult.init(allocator);
            defer wrap_breaks.deinit();

            var timer = try std.time.Timer.start();
            try utf8.findWrapBreaksSIMD16(text, &wrap_breaks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findWrapBreaks: Mixed ASCII/Unicode (10KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Unicode heavy
    {
        const text = try generateUnicodeHeavyText(allocator, 10 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var wrap_breaks = utf8.WrapBreakResult.init(allocator);
            defer wrap_breaks.deinit();

            var timer = try std.time.Timer.start();
            try utf8.findWrapBreaksSIMD16(text, &wrap_breaks);
            const elapsed = timer.read();

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findWrapBreaks: Unicode heavy (10KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

// Benchmark findWrapPosByWidthSIMD16
fn benchFindWrapPosByWidth(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // ASCII text - various column limits
    {
        const text = try generateAsciiText(allocator, 1024);
        defer allocator.free(text);

        const max_columns = 80;

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.findWrapPosByWidthSIMD16(text, max_columns, 4, true);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findWrapPosByWidth: ASCII (1KB, max_cols=80)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text
    {
        const text = try generateMixedText(allocator, 1024);
        defer allocator.free(text);

        const max_columns = 80;

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.findWrapPosByWidthSIMD16(text, max_columns, 4, false);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findWrapPosByWidth: Mixed (1KB, max_cols=80)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Unicode heavy with CJK (double-width chars)
    {
        const text = try generateUnicodeHeavyText(allocator, 1024);
        defer allocator.free(text);

        const max_columns = 80;

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.findWrapPosByWidthSIMD16(text, max_columns, 4, false);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findWrapPosByWidth: CJK/Emoji (1KB, max_cols=80)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

// Benchmark findPosByWidth
fn benchFindPosByWidth(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // ASCII - include_start_before = true
    {
        const text = try generateAsciiText(allocator, 1024);
        defer allocator.free(text);

        const max_columns = 80;

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.findPosByWidth(text, max_columns, 4, true, true);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findPosByWidth: ASCII (1KB, include_before=true)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // ASCII - include_start_before = false
    {
        const text = try generateAsciiText(allocator, 1024);
        defer allocator.free(text);

        const max_columns = 80;

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.findPosByWidth(text, max_columns, 4, true, false);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findPosByWidth: ASCII (1KB, include_before=false)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text
    {
        const text = try generateMixedText(allocator, 1024);
        defer allocator.free(text);

        const max_columns = 80;

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.findPosByWidth(text, max_columns, 4, false, true);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "findPosByWidth: Mixed (1KB, max_cols=80)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

// Benchmark calculateTextWidth
fn benchCalculateTextWidth(allocator: std.mem.Allocator, iterations: usize) ![]BenchResult {
    var results = std.ArrayList(BenchResult).init(allocator);

    // Small ASCII text (1KB)
    {
        const text = try generateAsciiText(allocator, 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.calculateTextWidth(text, 4, true);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "calculateTextWidth: ASCII (1KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Large ASCII text (100KB)
    {
        const text = try generateAsciiText(allocator, 100 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.calculateTextWidth(text, 4, true);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "calculateTextWidth: ASCII (100KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Very large ASCII text (1MB)
    {
        const text = try generateAsciiText(allocator, 1024 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.calculateTextWidth(text, 4, true);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "calculateTextWidth: ASCII (1MB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // ASCII with tabs
    {
        var text = std.ArrayList(u8).init(allocator);
        defer text.deinit();
        var i: usize = 0;
        while (text.items.len < 10 * 1024) : (i += 1) {
            if (i % 20 == 0) {
                try text.append('\t');
            } else {
                try text.append(@as(u8, @intCast(32 + (i % 95))));
            }
        }

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.calculateTextWidth(text.items, 4, true);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "calculateTextWidth: ASCII with tabs (10KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Mixed text
    {
        const text = try generateMixedText(allocator, 10 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.calculateTextWidth(text, 4, false);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "calculateTextWidth: Mixed ASCII/Unicode (10KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    // Unicode heavy
    {
        const text = try generateUnicodeHeavyText(allocator, 10 * 1024);
        defer allocator.free(text);

        var min_ns: u64 = std.math.maxInt(u64);
        var max_ns: u64 = 0;
        var total_ns: u64 = 0;

        var iter: usize = 0;
        while (iter < iterations) : (iter += 1) {
            var timer = try std.time.Timer.start();
            const result = utf8.calculateTextWidth(text, 4, false);
            const elapsed = timer.read();
            _ = result;

            min_ns = @min(min_ns, elapsed);
            max_ns = @max(max_ns, elapsed);
            total_ns += elapsed;
        }

        const name = try std.fmt.allocPrint(allocator, "calculateTextWidth: Unicode heavy (10KB)", .{});
        try results.append(BenchResult{
            .name = name,
            .min_ns = min_ns,
            .avg_ns = total_ns / iterations,
            .max_ns = max_ns,
            .total_ns = total_ns,
            .iterations = iterations,
            .mem_stats = null,
        });
    }

    return try results.toOwnedSlice();
}

pub fn run(
    allocator: std.mem.Allocator,
    show_mem: bool,
) ![]BenchResult {
    _ = show_mem;

    var all_results = std.ArrayList(BenchResult).init(allocator);

    const iterations: usize = 1000;

    // isAsciiOnly benchmarks
    const ascii_only_results = try benchIsAsciiOnly(allocator, iterations);
    defer allocator.free(ascii_only_results);
    try all_results.appendSlice(ascii_only_results);

    // findLineBreaks benchmarks
    const line_breaks_results = try benchFindLineBreaks(allocator, iterations);
    defer allocator.free(line_breaks_results);
    try all_results.appendSlice(line_breaks_results);

    // findWrapBreaks benchmarks
    const wrap_breaks_results = try benchFindWrapBreaks(allocator, iterations);
    defer allocator.free(wrap_breaks_results);
    try all_results.appendSlice(wrap_breaks_results);

    // findWrapPosByWidth benchmarks
    const wrap_pos_results = try benchFindWrapPosByWidth(allocator, iterations);
    defer allocator.free(wrap_pos_results);
    try all_results.appendSlice(wrap_pos_results);

    // findPosByWidth benchmarks
    const pos_width_results = try benchFindPosByWidth(allocator, iterations);
    defer allocator.free(pos_width_results);
    try all_results.appendSlice(pos_width_results);

    // calculateTextWidth benchmarks
    const text_width_results = try benchCalculateTextWidth(allocator, iterations);
    defer allocator.free(text_width_results);
    try all_results.appendSlice(text_width_results);

    return try all_results.toOwnedSlice();
}
