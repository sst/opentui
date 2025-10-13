const std = @import("std");
const builtin = @import("builtin");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const target = b.standardTargetOptions(.{});

    // Get dependencies from build.zig.zon
    const uucode_dep = b.lazyDependency("uucode", .{
        .target = target,
        .optimize = optimize,
        .fields = @as([]const []const u8, &.{
            "grapheme_break",
        }),
    });

    // Test executable for utf8-wrap-by-width
    const test_exe = b.addTest(.{
        .name = "utf8-wrap-by-width-test",
        .root_source_file = b.path("utf8-wrap-by-width.test.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Add dependencies
    if (uucode_dep) |uucode| {
        test_exe.root_module.addImport("uucode", uucode.module("uucode"));
    }

    const run_test = b.addRunArtifact(test_exe);
    const test_step = b.step("test", "Run utf8-wrap-by-width tests");
    test_step.dependOn(&run_test.step);

    // Benchmark executable for utf8-wrap-by-width
    const bench_exe = b.addExecutable(.{
        .name = "utf8-wrap-by-width-bench",
        .root_source_file = b.path("utf8-wrap-by-width-bench.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Add dependencies
    if (uucode_dep) |uucode| {
        bench_exe.root_module.addImport("uucode", uucode.module("uucode"));
    }

    b.installArtifact(bench_exe);

    const run_bench = b.addRunArtifact(bench_exe);
    if (b.args) |args| {
        run_bench.addArgs(args);
    }
    const bench_step = b.step("bench", "Run utf8-wrap-by-width benchmarks");
    bench_step.dependOn(&run_bench.step);

    // Default step builds the benchmark executable
    b.getInstallStep().dependOn(&bench_exe.step);
}
