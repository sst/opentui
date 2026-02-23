const std = @import("std");
const builtin = @import("builtin");

const SupportedZigVersion = struct {
    major: u32,
    minor: u32,
    patch: u32,
};

const SUPPORTED_ZIG_VERSIONS = [_]SupportedZigVersion{
    .{ .major = 0, .minor = 15, .patch = 2 },
};

const SupportedTarget = struct {
    zig_target: []const u8,
    output_name: []const u8,
    description: []const u8,
};

const SUPPORTED_TARGETS = [_]SupportedTarget{
    .{ .zig_target = "x86_64-linux", .output_name = "x86_64-linux", .description = "Linux x86_64" },
    .{ .zig_target = "aarch64-linux", .output_name = "aarch64-linux", .description = "Linux aarch64" },
    .{ .zig_target = "x86_64-macos", .output_name = "x86_64-macos", .description = "macOS x86_64 (Intel)" },
    .{ .zig_target = "aarch64-macos", .output_name = "aarch64-macos", .description = "macOS aarch64 (Apple Silicon)" },
    .{ .zig_target = "x86_64-windows-gnu", .output_name = "x86_64-windows", .description = "Windows x86_64" },
    .{ .zig_target = "aarch64-windows-gnu", .output_name = "aarch64-windows", .description = "Windows aarch64" },
};

const LIB_NAME = "opentui";
const ROOT_SOURCE_FILE = "lib.zig";

/// Apply dependencies to a module
fn applyDependencies(b: *std.Build, module: *std.Build.Module, optimize: std.builtin.OptimizeMode, target: std.Build.ResolvedTarget) void {
    // Add uucode for grapheme break detection and width calculation
    if (b.lazyDependency("uucode", .{
        .target = target,
        .optimize = optimize,
        .fields = @as([]const []const u8, &.{
            "grapheme_break",
            "east_asian_width",
            "general_category",
            "is_emoji_presentation",
        }),
    })) |uucode_dep| {
        module.addImport("uucode", uucode_dep.module("uucode"));
    }
}

fn checkZigVersion() void {
    const current_version = builtin.zig_version;
    var is_supported = false;

    for (SUPPORTED_ZIG_VERSIONS) |supported| {
        if (current_version.major == supported.major and
            current_version.minor == supported.minor and
            current_version.patch == supported.patch)
        {
            is_supported = true;
            break;
        }
    }

    if (!is_supported) {
        std.debug.print("\x1b[31mError: Unsupported Zig version {}.{}.{}\x1b[0m\n", .{
            current_version.major,
            current_version.minor,
            current_version.patch,
        });
        std.debug.print("Supported Zig versions:\n", .{});
        for (SUPPORTED_ZIG_VERSIONS) |supported| {
            std.debug.print("  - {}.{}.{}\n", .{
                supported.major,
                supported.minor,
                supported.patch,
            });
        }
        std.debug.print("\nPlease install a supported Zig version to continue.\n", .{});
        std.process.exit(1);
    }
}

pub fn build(b: *std.Build) void {
    checkZigVersion();

    const optimize = b.standardOptimizeOption(.{});
    const bench_optimize = b.option(std.builtin.OptimizeMode, "bench-optimize", "Optimize mode for benchmarks") orelse .ReleaseFast;
    const debug_use_llvm = b.option(bool, "debug-llvm", "Use LLVM backend for debug/test artifacts");
    const target_option = b.option([]const u8, "target", "Build for specific target (e.g., 'x86_64-linux-gnu').");
    const build_all = b.option(bool, "all", "Build for all supported targets") orelse false;

    if (target_option) |target_str| {
        // Build single target
        buildSingleTarget(b, target_str, optimize) catch |err| {
            std.debug.print("Error building target '{s}': {}\n", .{ target_str, err });
            std.process.exit(1);
        };
    } else if (build_all) {
        // Build all supported targets
        buildAllTargets(b, optimize);
    } else {
        // Build for native target only (default)
        buildNativeTarget(b, optimize);
    }

    // Test step (native only)
    const test_step = b.step("test", "Run unit tests");
    const native_target = b.resolveTargetQuery(.{});
    const test_mod = b.createModule(.{
        .root_source_file = b.path("test.zig"),
        .target = native_target,
        .optimize = .Debug,
    });
    applyDependencies(b, test_mod, .Debug, native_target);
    const run_test = b.addRunArtifact(b.addTest(.{
        .root_module = test_mod,
        .filters = if (b.option([]const u8, "test-filter", "Skip tests that do not match filter")) |f| &.{f} else &.{},
        .use_llvm = debug_use_llvm,
    }));
    test_step.dependOn(&run_test.step);

    // Bench step (native only)
    const bench_step = b.step("bench", "Run benchmarks");
    const bench_mod = b.createModule(.{
        .root_source_file = b.path("bench.zig"),
        .target = native_target,
        .optimize = bench_optimize,
    });
    applyDependencies(b, bench_mod, bench_optimize, native_target);
    const bench_exe = b.addExecutable(.{
        .name = "opentui-bench",
        .root_module = bench_mod,
    });
    const run_bench = b.addRunArtifact(bench_exe);
    if (b.args) |args| {
        run_bench.addArgs(args);
    }
    bench_step.dependOn(&run_bench.step);

    const bench_ffi_step = b.step("bench-ffi", "Build NativeSpanFeed benchmark library");
    const bench_ffi_mod = b.createModule(.{
        .root_source_file = b.path("native-span-feed-bench-lib.zig"),
        .target = native_target,
        .optimize = bench_optimize,
    });
    applyDependencies(b, bench_ffi_mod, bench_optimize, native_target);
    const bench_ffi_lib = b.addLibrary(.{
        .name = "native_span_feed_bench",
        .root_module = bench_ffi_mod,
        .linkage = .dynamic,
    });
    const install_bench_ffi = b.addInstallArtifact(bench_ffi_lib, .{});
    bench_ffi_step.dependOn(&install_bench_ffi.step);
    bench_step.dependOn(bench_ffi_step);

    // Debug step (native only)
    const debug_step = b.step("debug", "Run debug executable");
    const debug_mod = b.createModule(.{
        .root_source_file = b.path("debug-view.zig"),
        .target = native_target,
        .optimize = .Debug,
    });
    applyDependencies(b, debug_mod, .Debug, native_target);
    const debug_exe = b.addExecutable(.{
        .name = "opentui-debug",
        .root_module = debug_mod,
        .use_llvm = debug_use_llvm,
    });
    const run_debug = b.addRunArtifact(debug_exe);
    debug_step.dependOn(&run_debug.step);
}

fn buildAllTargets(b: *std.Build, optimize: std.builtin.OptimizeMode) void {
    for (SUPPORTED_TARGETS) |supported_target| {
        buildTarget(b, supported_target.zig_target, supported_target.output_name, supported_target.description, optimize) catch |err| {
            std.debug.print("Failed to build target {s}: {}\n", .{ supported_target.description, err });
            continue;
        };
    }
}

fn buildNativeTarget(b: *std.Build, optimize: std.builtin.OptimizeMode) void {
    // Find the matching supported target for the native platform
    const native_arch = @tagName(builtin.cpu.arch);
    const native_os = @tagName(builtin.os.tag);

    for (SUPPORTED_TARGETS) |supported_target| {
        // Check if this target matches the native platform
        if (std.mem.indexOf(u8, supported_target.zig_target, native_arch) != null and
            std.mem.indexOf(u8, supported_target.zig_target, native_os) != null)
        {
            buildTarget(b, supported_target.zig_target, supported_target.output_name, supported_target.description, optimize) catch |err| {
                std.debug.print("Failed to build native target {s}: {}\n", .{ supported_target.description, err });
            };
            return;
        }
    }

    std.debug.print("No matching supported target for native platform ({s}-{s})\n", .{ native_arch, native_os });
}

fn buildSingleTarget(b: *std.Build, target_str: []const u8, optimize: std.builtin.OptimizeMode) !void {
    // Check if it matches a known target, use its output_name
    for (SUPPORTED_TARGETS) |supported_target| {
        if (std.mem.eql(u8, target_str, supported_target.zig_target)) {
            try buildTarget(b, supported_target.zig_target, supported_target.output_name, supported_target.description, optimize);
            return;
        }
    }
    // Custom target - use target string as output name
    const description = try std.fmt.allocPrint(b.allocator, "Custom target: {s}", .{target_str});
    try buildTarget(b, target_str, target_str, description, optimize);
}

fn buildTarget(
    b: *std.Build,
    zig_target: []const u8,
    output_name: []const u8,
    description: []const u8,
    optimize: std.builtin.OptimizeMode,
) !void {
    const target_query = try std.Target.Query.parse(.{ .arch_os_abi = zig_target });
    const target = b.resolveTargetQuery(target_query);

    const module = b.createModule(.{
        .root_source_file = b.path(ROOT_SOURCE_FILE),
        .target = target,
        .optimize = optimize,
    });

    applyDependencies(b, module, optimize, target);

    const lib = b.addLibrary(.{
        .name = LIB_NAME,
        .root_module = module,
        .linkage = .dynamic,
    });

    const install_dir = b.addInstallArtifact(lib, .{
        .dest_dir = .{
            .override = .{
                .custom = try std.fmt.allocPrint(b.allocator, "../lib/{s}", .{output_name}),
            },
        },
    });

    const build_step_name = try std.fmt.allocPrint(b.allocator, "build-{s}", .{output_name});
    const build_step = b.step(build_step_name, try std.fmt.allocPrint(b.allocator, "Build for {s}", .{description}));
    build_step.dependOn(&install_dir.step);

    b.getInstallStep().dependOn(&install_dir.step);
}
