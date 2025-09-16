const std = @import("std");
const builtin = @import("builtin");

const SupportedZigVersion = struct {
    major: u32,
    minor: u32,
    patch: u32,
};

const SUPPORTED_ZIG_VERSIONS = [_]SupportedZigVersion{
    .{ .major = 0, .minor = 14, .patch = 0 },
    .{ .major = 0, .minor = 14, .patch = 1 },
    // .{ .major = 0, .minor = 15, .patch = 0 },
};

/// Apply zg (Zig Unicode) dependencies to a module
fn applyZgDependencies(b: *std.Build, module: *std.Build.Module, optimize: std.builtin.OptimizeMode, target: std.Build.ResolvedTarget) void {
    const zg_dep = b.dependency("zg", .{
        // .cjk = false,
        .optimize = optimize,
        .target = target,
    });
    module.addImport("code_point", zg_dep.module("code_point"));
    module.addImport("Graphemes", zg_dep.module("Graphemes"));
    module.addImport("DisplayWidth", zg_dep.module("DisplayWidth"));
}

const SupportedTarget = struct {
    cpu_arch: std.Target.Cpu.Arch,
    os_tag: std.Target.Os.Tag,
    description: []const u8,
};

const SUPPORTED_TARGETS = [_]SupportedTarget{
    .{ .cpu_arch = .x86_64, .os_tag = .linux, .description = "Linux x86_64" },
    .{ .cpu_arch = .x86_64, .os_tag = .macos, .description = "macOS x86_64 (Intel)" },
    .{ .cpu_arch = .aarch64, .os_tag = .macos, .description = "macOS aarch64 (Apple Silicon)" },
    .{ .cpu_arch = .x86_64, .os_tag = .windows, .description = "Windows x86_64" },
    .{ .cpu_arch = .aarch64, .os_tag = .windows, .description = "Windows aarch64" },
    .{ .cpu_arch = .aarch64, .os_tag = .linux, .description = "Linux aarch64" },
};

const LIB_NAME = "opentui";
const ROOT_SOURCE_FILE = "lib.zig";

const LibvtermConfig = struct {
    available: bool,
    include_paths: []const []const u8,
    library_paths: []const []const u8,
    compile_flags: []const []const u8,
};

fn detectLibvterm(b: *std.Build, target: std.Build.ResolvedTarget) LibvtermConfig {
    _ = b; // Suppress unused parameter warning
    
    switch (target.result.os.tag) {
        .macos => {
            // Only enable libvterm for native architecture to avoid cross-compilation issues
            const native_arch = builtin.cpu.arch;
            if (target.result.cpu.arch != native_arch) {
                // Skip libvterm for cross-compilation targets
                return LibvtermConfig{
                    .available = false,
                    .include_paths = &[_][]const u8{},
                    .library_paths = &[_][]const u8{},
                    .compile_flags = &[_][]const u8{},
                };
            }
            
            // Try Homebrew paths based on native architecture
            switch (native_arch) {
                .aarch64 => {
                    // Apple Silicon Homebrew path
                    if (std.fs.accessAbsolute("/opt/homebrew/opt/libvterm/include/vterm.h", .{})) {
                        return LibvtermConfig{
                            .available = true,
                            .include_paths = &[_][]const u8{"/opt/homebrew/opt/libvterm/include"},
                            .library_paths = &[_][]const u8{"/opt/homebrew/opt/libvterm/lib"},
                            .compile_flags = &[_][]const u8{ "-I/opt/homebrew/opt/libvterm/include", "-std=c99" },
                        };
                    } else |_| {}
                },
                .x86_64 => {
                    // Intel Homebrew path
                    if (std.fs.accessAbsolute("/usr/local/opt/libvterm/include/vterm.h", .{})) {
                        return LibvtermConfig{
                            .available = true,
                            .include_paths = &[_][]const u8{"/usr/local/opt/libvterm/include"},
                            .library_paths = &[_][]const u8{"/usr/local/opt/libvterm/lib"},
                            .compile_flags = &[_][]const u8{ "-I/usr/local/opt/libvterm/include", "-std=c99" },
                        };
                    } else |_| {}
                },
                else => {
                    // Unsupported architecture for macOS
                },
            }
            
            // Try system paths as fallback
            if (std.fs.accessAbsolute("/usr/include/vterm.h", .{})) {
                return LibvtermConfig{
                    .available = true,
                    .include_paths = &[_][]const u8{"/usr/include"},
                    .library_paths = &[_][]const u8{"/usr/lib"},
                    .compile_flags = &[_][]const u8{ "-I/usr/include", "-std=c99" },
                };
            } else |_| {}
        },
        .linux => {
            // Check common Linux package manager paths
            if (std.fs.accessAbsolute("/usr/include/vterm.h", .{})) {
                return LibvtermConfig{
                    .available = true,
                    .include_paths = &[_][]const u8{"/usr/include"},
                    .library_paths = &[_][]const u8{"/usr/lib"},
                    .compile_flags = &[_][]const u8{ "-I/usr/include", "-std=c99" },
                };
            } else |_| {}
            
            if (std.fs.accessAbsolute("/usr/local/include/vterm.h", .{})) {
                return LibvtermConfig{
                    .available = true,
                    .include_paths = &[_][]const u8{"/usr/local/include"},
                    .library_paths = &[_][]const u8{"/usr/local/lib"},
                    .compile_flags = &[_][]const u8{ "-I/usr/local/include", "-std=c99" },
                };
            } else |_| {}
        },
        .windows => {
            // Windows support would require vcpkg or manual installation
            // For now, disable libvterm on Windows
        },
        else => {
            // Other platforms not supported yet
        },
    }
    
    // libvterm not available
    return LibvtermConfig{
        .available = false,
        .include_paths = &[_][]const u8{},
        .library_paths = &[_][]const u8{},
        .compile_flags = &[_][]const u8{},
    };
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

    const optimize = b.option(std.builtin.OptimizeMode, "optimize", "Optimization level (Debug, ReleaseFast, ReleaseSafe, ReleaseSmall)") orelse .Debug;
    const target_option = b.option([]const u8, "target", "Build for specific target (e.g., 'x86_64-linux'). If not specified, builds for all supported targets.");

    if (target_option) |target_str| {
        buildSingleTarget(b, target_str, optimize) catch |err| {
            std.debug.print("Error building target '{s}': {}\n", .{ target_str, err });
            std.process.exit(1);
        };
    } else {
        buildAllTargets(b, optimize);
    }

    // Add test step
    const test_step = b.step("test", "Run all tests");
    const test_target_query = std.Target.Query{
        .cpu_arch = builtin.cpu.arch,
        .os_tag = builtin.os.tag,
    };
    const test_target = b.resolveTargetQuery(test_target_query);

    // Run tests using the test index file
    const test_exe = b.addTest(.{
        .root_source_file = b.path("test.zig"),
        .target = test_target,
    });

    applyZgDependencies(b, test_exe.root_module, .Debug, test_target);

    const run_test = b.addRunArtifact(test_exe);
    test_step.dependOn(&run_test.step);
}

fn buildAllTargets(b: *std.Build, optimize: std.builtin.OptimizeMode) void {
    for (SUPPORTED_TARGETS) |supported_target| {
        const target_query = std.Target.Query{
            .cpu_arch = supported_target.cpu_arch,
            .os_tag = supported_target.os_tag,
        };

        buildTargetFromQuery(b, target_query, supported_target.description, optimize) catch |err| {
            std.debug.print("Failed to build target {s}: {}\n", .{ supported_target.description, err });
            continue;
        };
    }
}

fn buildSingleTarget(b: *std.Build, target_str: []const u8, optimize: std.builtin.OptimizeMode) !void {
    const target_query = try std.Target.Query.parse(.{ .arch_os_abi = target_str });
    const description = try std.fmt.allocPrint(b.allocator, "Custom target: {s}", .{target_str});
    try buildTargetFromQuery(b, target_query, description, optimize);
}

fn buildTargetFromQuery(
    b: *std.Build,
    target_query: std.Target.Query,
    description: []const u8,
    optimize: std.builtin.OptimizeMode,
) !void {
    const target = b.resolveTargetQuery(target_query);
    var target_output: *std.Build.Step.Compile = undefined;

    const link_libc_needed = switch (target.result.os.tag) {
        .macos, .linux => true,
        else => false,
    };

    const module = b.addModule(LIB_NAME, .{
        .root_source_file = b.path(ROOT_SOURCE_FILE),
        .target = target,
        .optimize = optimize,
        .link_libc = link_libc_needed,
    });

    // Add libvterm support with cross-platform detection
    const libvterm_config = detectLibvterm(b, target);
    
    // Create build options to inform Zig code about libvterm availability
    const build_options = b.addOptions();
    build_options.addOption(bool, "has_libvterm", libvterm_config.available);
    module.addOptions("build_options", build_options);
    
    if (libvterm_config.available) {
        std.debug.print("Building with libvterm support for {s}\n", .{description});
        
        // Add include paths
        for (libvterm_config.include_paths) |include_path| {
            module.addIncludePath(.{ .cwd_relative = include_path });
        }
        
        // Add library paths
        for (libvterm_config.library_paths) |library_path| {
            module.addLibraryPath(.{ .cwd_relative = library_path });
        }
        
        // Link libvterm
        module.linkSystemLibrary("vterm", .{});
        
        // Add our wrapper C file with appropriate flags
        module.addCSourceFile(.{
            .file = b.path("vterm_wrapper.c"),
            .flags = libvterm_config.compile_flags,
        });
    } else {
        std.debug.print("Building without libvterm support for {s} (not available)\n", .{description});
    }

    applyZgDependencies(b, module, optimize, target);

    target_output = b.addLibrary(.{
        .name = LIB_NAME,
        .root_module = module,
        .linkage = .dynamic,
    });

    const target_name = try createTargetName(b.allocator, target.result);
    defer b.allocator.free(target_name);

    const install_dir = b.addInstallArtifact(target_output, .{
        .dest_dir = .{
            .override = .{
                .custom = try std.fmt.allocPrint(b.allocator, "../lib/{s}", .{target_name}),
            },
        },
    });

    const build_step_name = try std.fmt.allocPrint(b.allocator, "build-{s}", .{target_name});
    const build_step = b.step(build_step_name, try std.fmt.allocPrint(b.allocator, "Build for {s}", .{description}));
    build_step.dependOn(&install_dir.step);

    b.getInstallStep().dependOn(&install_dir.step);
}

fn createTargetName(allocator: std.mem.Allocator, target: std.Target) ![]u8 {
    return std.fmt.allocPrint(
        allocator,
        "{s}-{s}",
        .{
            @tagName(target.cpu.arch),
            @tagName(target.os.tag),
        },
    );
}
