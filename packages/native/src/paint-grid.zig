const std = @import("std");
const b = @import("buffer.zig");
const gp = @import("grapheme.zig");
const ansi = @import("ansi.zig");

// Experimental, target-local recordings. Payloads own pool references, never
// pointers into a caller's text/view/framebuffer. Geometry only invalidates a
// command; the cell index comes exclusively from its actual drawing.
pub const PaintGrid = struct {
    pub const Mode = enum { set, raw, direct, blend, blend_raw, text, inherit };
    pub const Op = struct {
        index: u32,
        cell: b.Cell,
        opacity: f32,
        mode: Mode,
        background_index: u32,
        background_group: u32,
        owner: u32,
    };
    const Context = struct {
        owner: u32,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        scissor: ?b.ClipRect,
        opacity: f32,
    };
    const Command = struct {
        context: Context,
        ops: std.ArrayList(Op) = .empty,
        pending: std.ArrayList(Op) = .empty,
        recording: bool = false,
        rerecord: bool = false,
        present: bool = false,
    };
    const Ref = struct { command: u32, op: u32 };
    const Scope = struct { owner: u32, scissor_depth: usize, opacity_depth: usize };

    target: *b.OptimizedBuffer,
    commands: std.ArrayList(Command) = .empty,
    stack: std.ArrayList(Scope) = .empty,
    cells: []std.ArrayList(Ref),
    dirty: []bool,
    background: ansi.RGBA,
    count: u32 = 0,
    active: bool = false,
    valid: bool = false,
    replaying: bool = false,
    fallback: bool = false,
    unsupported_last_frame: bool = false,
    recomposed: u32 = 0,
    skipped: u32 = 0,
    recorded: u32 = 0,
    fallbacks: u32 = 0,
    background_group: u32 = 0,
    replay_group: ?u32 = null,
    inherited_background: ansi.RGBA = undefined,

    pub fn init(target: *b.OptimizedBuffer, background: ansi.RGBA) !*PaintGrid {
        const a = target.allocator;
        const self = try a.create(PaintGrid);
        errdefer a.destroy(self);
        const cells = try a.alloc(std.ArrayList(Ref), target.width * target.height);
        errdefer a.free(cells);
        for (cells) |*cell| cell.* = .empty;
        const dirty = try a.alloc(bool, cells.len);
        @memset(dirty, true);
        self.* = .{ .target = target, .cells = cells, .dirty = dirty, .background = background };
        return self;
    }

    fn release(self: *PaintGrid, ops: *std.ArrayList(Op)) void {
        for (ops.items) |op| {
            if (gp.isClusterChar(op.cell.char)) self.target.pool.decref(gp.graphemeIdFromChar(op.cell.char)) catch {};
            const id = ansi.TextAttributes.getLinkId(op.cell.attributes);
            if (id != 0) self.target.link_pool.decref(id) catch {};
        }
        ops.clearRetainingCapacity();
    }

    pub fn deinit(self: *PaintGrid) void {
        const a = self.target.allocator;
        for (self.commands.items) |*command| {
            self.release(&command.ops);
            self.release(&command.pending);
            command.ops.deinit(a);
            command.pending.deinit(a);
        }
        for (self.cells) |*cell| cell.deinit(a);
        a.free(self.cells);
        a.free(self.dirty);
        self.commands.deinit(a);
        self.stack.deinit(a);
        a.destroy(self);
    }

    pub fn begin(self: *PaintGrid, background: ansi.RGBA, force_fallback: bool) void {
        const retained = self.valid;
        const unsupported = self.unsupported_last_frame;
        self.unsupported_last_frame = false;
        self.count = 0;
        self.stack.clearRetainingCapacity();
        self.active = true;
        self.fallback = false;
        self.recomposed = 0;
        self.skipped = 0;
        self.recorded = 0;
        if (!b.rgbaEqual(background, self.background)) self.valid = false;
        self.background = background;
        if (!self.valid) @memset(self.dirty, true);
        if (force_fallback or unsupported or self.target.paint_raw_exposed) {
            if (retained) {
                self.materialize();
            } else {
                // Native publication already cleared a full-render target. Do not
                // erase raw writes made since then, before this frame began.
                self.fallback = true;
                self.valid = false;
                self.fallbacks += 1;
            }
        }
    }

    pub fn push(self: *PaintGrid, owner: u32, x: i32, y: i32, width: u32, height: u32, dirty: bool) !bool {
        const t = self.target;
        const nested = self.stack.items.len != 0;
        try self.stack.append(t.allocator, .{ .owner = owner, .scissor_depth = t.scissor_stack.items.len, .opacity_depth = t.opacity_stack.items.len });
        if (nested) self.markVolatile();
        if (nested or self.fallback) return true;
        self.background_group = 0;
        const context: Context = .{ .owner = owner, .x = x, .y = y, .width = width, .height = height, .scissor = t.getCurrentScissorRect(), .opacity = t.getCurrentOpacity() };
        const index = self.count;
        const fresh = index == self.commands.items.len;
        if (fresh) try self.commands.append(t.allocator, .{ .context = context });
        self.count += 1;
        const command = &self.commands.items[index];
        command.recording = dirty or fresh or !command.present or !self.valid or command.rerecord or !std.meta.eql(command.context, context);
        command.present = true;
        command.context = context;
        if (command.recording) {
            self.release(&command.pending);
            command.rerecord = false;
            self.recorded += 1;
        } else self.skipped += 1;
        return command.recording;
    }

    pub fn pop(self: *PaintGrid) void {
        if (self.stack.pop()) |scope| {
            self.target.scissor_stack.items.len = @min(scope.scissor_depth, self.target.scissor_stack.items.len);
            self.target.opacity_stack.items.len = @min(scope.opacity_depth, self.target.opacity_stack.items.len);
        }
    }

    pub fn markVolatile(self: *PaintGrid) void {
        if (self.active and !self.fallback and self.count != 0) self.commands.items[self.count - 1].rerecord = true;
    }

    pub fn isRecording(self: *const PaintGrid) bool {
        return self.active and !self.replaying and !self.fallback and self.stack.items.len != 0;
    }

    pub fn record(self: *PaintGrid, index: u32, cell: b.Cell, mode: Mode, background_index: u32) bool {
        if (!self.isRecording()) return false;
        const t = self.target;
        const op: Op = .{ .index = index, .cell = cell, .mode = mode, .opacity = t.getCurrentOpacity(), .background_index = background_index, .background_group = if (mode == .inherit) self.background_group else 0, .owner = self.stack.items[self.stack.items.len - 1].owner };
        self.commands.items[self.count - 1].pending.append(t.allocator, op) catch {
            self.materialize();
            return false;
        };
        if (gp.isClusterChar(cell.char)) t.pool.incref(gp.graphemeIdFromChar(cell.char)) catch {};
        const id = ansi.TextAttributes.getLinkId(cell.attributes);
        if (id != 0) t.link_pool.incref(id) catch {};
        return true;
    }

    fn spanEnd(self: *const PaintGrid, op: Op) u32 {
        const width = self.target.width;
        return @min(op.index + 1 + (if (gp.isGraphemeChar(op.cell.char) and op.mode != .raw and op.mode != .direct) gp.charRightExtent(op.cell.char) else 0), (op.index / width + 1) * width);
    }

    fn apply(self: *PaintGrid, op: Op) void {
        const t = self.target;
        const x = op.index % t.width;
        const y = op.index / t.width;
        var cell = op.cell;
        var opacity = [_]f32{op.opacity};
        t.opacity_stack.items = &opacity;
        defer t.opacity_stack.items = &.{};
        switch (op.mode) {
            .set => t.set(x, y, cell),
            .raw, .direct => {
                // Direct Grid writes intentionally do not repair spans. Preserve
                // those pixels, but do not retain references to overwritten starts
                // forever now that the target survives between frames.
                const old = t.buffer.char[op.index];
                t.grapheme_tracker.replace(
                    if (gp.isGraphemeChar(old)) gp.graphemeIdFromChar(old) else null,
                    if (gp.isGraphemeChar(cell.char)) gp.graphemeIdFromChar(cell.char) else null,
                );
                t.setRaw(x, y, cell);
            },
            .blend, .blend_raw => {
                if (op.mode == .blend) t.setCellWithAlphaBlending(x, y, cell.char, cell.fg, cell.bg, cell.attributes) else t.setCellWithAlphaBlendingRaw(x, y, cell.char, cell.fg, cell.bg, cell.attributes);
            },
            .text, .inherit => {
                if (op.mode == .inherit) {
                    if (self.replay_group != op.background_group) {
                        self.replay_group = op.background_group;
                        self.inherited_background = t.buffer.bg[op.background_index];
                    }
                    cell.bg = self.inherited_background;
                }
                t.setTextCell(x, y, cell);
            },
        }
    }

    // Unsupported access can be discovered halfway through a painter. Materialize
    // the prefix, including that painter's partial stream, then continue it once.
    pub fn materialize(self: *PaintGrid) void {
        if (!self.active or self.replaying or self.fallback) return;
        const t = self.target;
        self.replaying = true;
        const scissors = t.scissor_stack;
        const opacity = t.opacity_stack;
        t.scissor_stack = .empty;
        t.opacity_stack = .empty;
        defer {
            t.opacity_stack.deinit(t.allocator);
            t.scissor_stack = scissors;
            t.opacity_stack = opacity;
            self.replaying = false;
        }
        t.clear(self.background, null);
        for (self.commands.items[0..self.count]) |command| {
            self.replay_group = null;
            for ((if (command.recording) command.pending else command.ops).items) |op| self.apply(op);
        }
        self.fallback = true;
        self.valid = false;
        self.fallbacks += 1;
    }

    pub fn abort(self: *PaintGrid) void {
        self.active = false;
        self.valid = false;
        while (self.stack.items.len != 0) self.pop();
        for (self.cells) |*cell| cell.clearRetainingCapacity();
        for (self.commands.items) |*command| {
            self.release(&command.ops);
            self.release(&command.pending);
        }
    }

    pub fn finish(self: *PaintGrid) !void {
        if (self.fallback) {
            self.active = false;
            return;
        }
        const t = self.target;
        const a = t.allocator;
        // Remove old references before releasing their payloads. Equal streams
        // retain their index and do no composition work, including repeated writes.
        for (self.commands.items, 0..) |*command, ci| {
            if (ci < self.count and !command.recording) continue;
            if (ci < self.count and std.meta.eql(command.ops.items.len, command.pending.items.len)) {
                var equal = true;
                for (command.ops.items, command.pending.items) |old, new| {
                    if (!std.meta.eql(old, new)) {
                        equal = false;
                        break;
                    }
                }
                if (equal) {
                    self.release(&command.pending);
                    continue;
                }
            }
            for (command.ops.items, 0..) |op, oi| {
                const changed = ci >= self.count or oi >= command.pending.items.len or !std.meta.eql(op, command.pending.items[oi]);
                for (op.index..self.spanEnd(op)) |index| {
                    if (changed) self.dirty[index] = true;
                    const refs = &self.cells[index];
                    var ri: usize = 0;
                    while (ri < refs.items.len) {
                        if (refs.items[ri].command == ci) {
                            _ = refs.orderedRemove(ri);
                        } else ri += 1;
                    }
                }
            }
            if (ci < self.count) {
                for (command.pending.items, 0..) |op, oi| {
                    if (oi >= command.ops.items.len or !std.meta.eql(op, command.ops.items[oi])) {
                        @memset(self.dirty[op.index..self.spanEnd(op)], true);
                    }
                }
            }
            self.release(&command.ops);
            if (ci >= self.count) {
                command.present = false;
                continue;
            }
            std.mem.swap(std.ArrayList(Op), &command.ops, &command.pending);
            for (command.ops.items, 0..) |op, oi| {
                for (op.index..self.spanEnd(op)) |index| {
                    const refs = &self.cells[index];
                    var at: usize = 0;
                    while (at < refs.items.len and refs.items[at].command <= ci) : (at += 1) {}
                    try refs.insert(a, at, .{ .command = @intCast(ci), .op = @intCast(oi) });
                }
            }
        }
        // Wide writes/repairs and inherited tab backgrounds couple cells. Close
        // damage over those actual spans, not over renderable layout rectangles.
        var expanded = true;
        while (expanded) {
            expanded = false;
            for (self.dirty, 0..) |dirty, index| {
                if (!dirty) continue;
                const char = t.buffer.char[index];
                if (gp.isClusterChar(char)) {
                    const start = index - @min(gp.charLeftExtent(char), index % t.width);
                    const end = @min(index + 1 + gp.charRightExtent(char), (index / t.width + 1) * t.width);
                    for (start..end) |i| if (!self.dirty[i]) {
                        self.dirty[i] = true;
                        expanded = true;
                    };
                }
                for (self.cells[index].items) |ref| {
                    const op = self.commands.items[ref.command].ops.items[ref.op];
                    for (op.index..self.spanEnd(op)) |i| if (!self.dirty[i]) {
                        self.dirty[i] = true;
                        expanded = true;
                    };
                }
            }
            for (self.commands.items[0..self.count]) |command| for (command.ops.items) |op| {
                if (op.mode == .inherit and self.dirty[op.background_index] and !self.dirty[op.index]) {
                    self.dirty[op.index] = true;
                    expanded = true;
                }
                if (op.mode == .inherit and self.dirty[op.index] and !self.dirty[op.background_index]) {
                    self.dirty[op.background_index] = true;
                    expanded = true;
                }
            };
        }
        self.replaying = true;
        defer self.replaying = false;
        const scissors = t.scissor_stack;
        const opacity = t.opacity_stack;
        t.scissor_stack = .empty;
        t.opacity_stack = .empty;
        defer {
            t.opacity_stack.deinit(a);
            t.scissor_stack = scissors;
            t.opacity_stack = opacity;
        }
        for (self.dirty, 0..) |dirty, index| {
            if (!dirty) continue;
            self.recomposed += 1;
            t.set(@intCast(index % t.width), @intCast(index / t.width), .{ .char = b.DEFAULT_SPACE_CHAR, .fg = ansi.rgbColor(255, 255, 255, 255), .bg = self.background, .attributes = 0 });
        }
        for (self.commands.items[0..self.count]) |command| {
            self.replay_group = null;
            for (command.ops.items) |op| {
                if (self.dirty[op.index]) self.apply(op);
            }
        }
        @memset(self.dirty, false);
        self.active = false;
        self.valid = true;
    }

    pub fn retainedBytes(self: *const PaintGrid) u64 {
        var bytes: u64 = @sizeOf(PaintGrid) + self.cells.len * (@sizeOf(std.ArrayList(Ref)) + @sizeOf(bool)) + self.commands.capacity * @sizeOf(Command) + self.stack.capacity * @sizeOf(Scope);
        for (self.commands.items) |command| bytes += (command.ops.capacity + command.pending.capacity) * @sizeOf(Op);
        for (self.cells) |cell| bytes += cell.capacity * @sizeOf(Ref);
        return bytes;
    }
};
