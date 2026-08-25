const std = @import("std");
const builtin = @import("builtin");

pub fn build(b: *std.Build) void {
    var default_target = b.graph.host.query;
    if (builtin.os.tag == .linux) {
        default_target.abi = .musl;
        default_target.glibc_version = null;
    }
    const target = b.standardTargetOptions(.{ .default_target = default_target });
    const optimize = b.standardOptimizeOption(.{});
    const opentui = b.dependency("opentui", .{
        .target = target,
        .optimize = optimize,
    });

    const module = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("opentui", opentui.module("opentui"));

    const executable = b.addExecutable(.{
        .name = "opentui-hello",
        .root_module = module,
    });
    b.installArtifact(executable);

    const run = b.addRunArtifact(executable);
    run.step.dependOn(b.getInstallStep());
    const run_step = b.step("run", "Render two frames without JavaScript");
    run_step.dependOn(&run.step);
}
