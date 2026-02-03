// kitty graphics protocol commands

const std = @import("std");
const ansi = @import("ansi.zig");
const Allocator = std.mem.Allocator;

const CHUNK_SIZE = 4096;

pub const IMAGE = struct {
    // kitty graphics protocol data with raw RGBA pixels
    pub fn write(writer: anytype, id: u32, width: u32, height: u32, base64_data: []const u8) void {
        var i: usize = 0;
        var first = true;

        while (i < base64_data.len) {
            const end = @min(i + CHUNK_SIZE, base64_data.len);
            const chunk = base64_data[i..end];
            const more: u8 = if (end < base64_data.len) 1 else 0;

            if (first) {
                std.fmt.format(writer, "\x1b_Ga=T,f=32,s={d},v={d},i={d},m={d},q=1;{s}\x1b\\", .{
                    width, height, id, more, chunk,
                }) catch {};
                first = false;
            } else {
                std.fmt.format(writer, "\x1b_Gm={d};{s}\x1b\\", .{ more, chunk }) catch {};
            }

            i = end;
        }
    }

    pub fn delete(writer: anytype, id: u32) void {
        std.fmt.format(writer, "\x1b_Ga=d,d=i,i={d},q=1\x1b\\", .{id}) catch {};
    }

    pub fn create(writer: anytype, id: u32, x: u32, y: u32, width: u32, height: u32, data: []const u8, allocator: Allocator) void {
        const encoder = std.base64.standard.Encoder;
        const encoded_len = encoder.calcSize(data.len);

        const buf = allocator.alloc(u8, encoded_len) catch return;
        defer allocator.free(buf);
        const encoded = encoder.encode(buf, data);

        ansi.ANSI.moveToOutput(writer, x, y) catch {};
        write(writer, id, width, height, encoded);
    }
};
