const std = @import("std");

const yoga_impl = @import("../yoga.zig");

const c = @cImport({
    @cInclude("yoga/Yoga.h");
});

const YogaEnumKind = enum(u32) {
    flex_direction = 1,
};

const YogaFloatKind = enum(u32) {
    flex_grow = 1,
};

const YogaValueKind = enum(u32) {
    width = 0,
    height = 1,
    flex_basis = 6,
};

const YogaUnit = enum(u32) {
    point = 1,
};

const ExternalYogaLayout = extern struct {
    left: f32,
    top: f32,
    right: f32,
    bottom: f32,
    width: f32,
    height: f32,
};

extern fn yogaConfigCreate() c.YGConfigRef;
extern fn yogaConfigFree(config: c.YGConfigRef) void;
extern fn yogaNodeCreate() c.YGNodeRef;
extern fn yogaNodeCreateForOpenTUI() c.YGNodeRef;
extern fn yogaNodeCreateWithConfig(config: c.YGConfigConstRef) c.YGNodeRef;
extern fn yogaNodeFree(node: c.YGNodeRef) void;
extern fn yogaNodeInsertChild(node: c.YGNodeRef, child: c.YGNodeRef, index: u32) void;
extern fn yogaNodeCalculateLayout(node: c.YGNodeRef, width: f32, height: f32, direction: u32) void;
extern fn yogaNodeGetComputedLayout(node: c.YGNodeConstRef, out_ptr: *ExternalYogaLayout) void;
extern fn yogaNodeStyleSetEnum(node: c.YGNodeRef, kind: u32, value: u32) void;
extern fn yogaNodeStyleSetFloat(node: c.YGNodeRef, kind: u32, value: f32) void;
extern fn yogaNodeStyleSetValue(node: c.YGNodeRef, kind: u32, edge_or_gutter: u32, unit: u32, value: f32) void;
extern fn yogaNodeStyleGetValue(node: c.YGNodeConstRef, kind: u32, edge_or_gutter: u32) u64;
extern fn yogaNodeSetMeasureFunc(node: c.YGNodeRef, callback_ptr: ?*const anyopaque) void;
extern fn yogaNodeSetDirtiedFunc(node: c.YGNodeRef, callback_ptr: ?*const anyopaque) void;

comptime {
    _ = yoga_impl;
}

fn enumValue(value: anytype) u32 {
    return @intCast(value);
}

test "Yoga wrapper computes basic flex layout" {
    const config = yogaConfigCreate();
    defer yogaConfigFree(config);

    const root = yogaNodeCreateWithConfig(config);
    defer yogaNodeFree(root);

    yogaNodeStyleSetEnum(root, @intFromEnum(YogaEnumKind.flex_direction), enumValue(c.YGFlexDirectionRow));
    yogaNodeStyleSetValue(root, @intFromEnum(YogaValueKind.width), 0, @intFromEnum(YogaUnit.point), 100);
    yogaNodeStyleSetValue(root, @intFromEnum(YogaValueKind.height), 0, @intFromEnum(YogaUnit.point), 100);

    const child = yogaNodeCreateWithConfig(config);
    defer yogaNodeFree(child);
    yogaNodeStyleSetFloat(child, @intFromEnum(YogaFloatKind.flex_grow), 1);
    yogaNodeInsertChild(root, child, 0);

    yogaNodeCalculateLayout(root, std.math.nan(f32), std.math.nan(f32), enumValue(c.YGDirectionLTR));

    var layout: ExternalYogaLayout = undefined;
    yogaNodeGetComputedLayout(child, &layout);
    try std.testing.expectApproxEqAbs(@as(f32, 100), layout.width, 0.001);
    try std.testing.expectApproxEqAbs(@as(f32, 100), layout.height, 0.001);
}

test "OpenTUI Yoga nodes use the native fixed config" {
    const first = yogaNodeCreateForOpenTUI();
    defer yogaNodeFree(first);
    const second = yogaNodeCreateForOpenTUI();
    defer yogaNodeFree(second);

    const first_config = c.YGNodeGetConfig(first);
    const second_config = c.YGNodeGetConfig(second);
    try std.testing.expect(first_config == second_config);
    try std.testing.expect(!c.YGConfigGetUseWebDefaults(first_config));
    try std.testing.expectEqual(@as(f32, 1), c.YGConfigGetPointScaleFactor(first_config));
}

test "Yoga wrapper packs style values" {
    const node = yogaNodeCreate();
    defer yogaNodeFree(node);

    yogaNodeStyleSetValue(node, @intFromEnum(YogaValueKind.flex_basis), 0, @intFromEnum(YogaUnit.point), 10);
    const packed_value = yogaNodeStyleGetValue(node, @intFromEnum(YogaValueKind.flex_basis), 0);
    const unit: u32 = @intCast(packed_value & 0xffffffff);
    const value_bits: u32 = @intCast((packed_value >> 32) & 0xffffffff);
    const value: f32 = @bitCast(value_bits);

    try std.testing.expectEqual(@as(u32, @intFromEnum(YogaUnit.point)), unit);
    try std.testing.expectApproxEqAbs(@as(f32, 10), value, 0.001);
}

test "Yoga wrapper stores dirtied callback alongside measure callback" {
    const node = yogaNodeCreate();
    defer yogaNodeFree(node);

    yogaNodeSetMeasureFunc(node, null);
    yogaNodeSetDirtiedFunc(node, null);
    try std.testing.expect(c.YGNodeGetContext(node) == null);
}
