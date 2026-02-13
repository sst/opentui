const lib = @import("lib.zig");
const bench = @import("bench/native-span-feed_bench.zig");

comptime {
    _ = lib;
    _ = bench;
}
