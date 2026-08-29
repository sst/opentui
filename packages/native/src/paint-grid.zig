const std = @import("std");
const b = @import("buffer.zig");
const gp = @import("grapheme.zig");
const ansi = @import("ansi.zig");

// Experimental, target-local recordings. Payloads own pool references, never
// pointers into a caller's text/view/framebuffer. Geometry only invalidates a
// command; damage comes exclusively from its actual drawing.
pub const PaintGrid = struct {
    pub const Mode = enum { set, raw, direct, blend, blend_raw, text, inherit, inherit_cell, fill };
    pub const Op = struct {
        index: u32,
        cell: b.Cell,
        opacity: f32,
        mode: Mode,
        background_index: u32,
        background_group: u32,
        owner: u32,
        count: u32 = 1,
        text_offset: u32 = std.math.maxInt(u32),
    };
    const Stream = struct {
        ops: std.ArrayList(Op) = .empty,
        chars: std.ArrayList(u32) = .empty,

        fn charAt(self: Stream, op: Op, offset: usize) u32 {
            return if (op.text_offset == std.math.maxInt(u32)) op.cell.char else self.chars.items[op.text_offset + offset];
        }

        fn deinit(self: *Stream, a: std.mem.Allocator) void {
            self.ops.deinit(a);
            self.chars.deinit(a);
            self.* = .{};
        }
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
        ops: Stream = .{},
        pending: Stream = .{},
        recording: bool = false,
        rerecord: bool = false,
        present: bool = false,
        first: u32 = std.math.maxInt(u32),
        end: u32 = 0,
        dependencies: bool = false,
    };
    const Scope = struct { owner: u32, scissor_depth: usize, opacity_depth: usize };

    target: *b.OptimizedBuffer,
    payload: std.heap.ArenaAllocator,
    commands: std.ArrayList(Command) = .empty,
    stack: std.ArrayList(Scope) = .empty,
    dirty: []bool = &.{},
    dirty_cells: []u32 = &.{},
    dirty_count: usize = 0,
    background: ansi.RGBA,
    count: u32 = 0,
    active: bool = false,
    valid: bool = false,
    replaying: bool = false,
    fallback: bool = false,
    retain_on_fallback: bool = false,
    recomposed: u32 = 0,
    skipped: u32 = 0,
    recorded: u32 = 0,
    fallbacks: u32 = 0,
    background_group: u32 = 0,
    replay_group: ?u32 = null,
    inherited_background: ansi.RGBA = undefined,
    empty: bool = true,
    painting: bool = false,
    preserved: bool = false,

    pub fn init(target: *b.OptimizedBuffer, background: ansi.RGBA) !*PaintGrid {
        const a = target.allocator;
        const self = try a.create(PaintGrid);
        self.* = .{ .target = target, .background = background, .payload = std.heap.ArenaAllocator.init(a) };
        return self;
    }

    fn release(self: *PaintGrid, stream: *Stream) void {
        for (stream.ops.items) |op| {
            if (gp.isClusterChar(op.cell.char)) self.target.pool.decref(gp.graphemeIdFromChar(op.cell.char)) catch {};
            const id = ansi.TextAttributes.getLinkId(op.cell.attributes);
            if (id != 0) self.target.link_pool.decref(id) catch {};
        }
        stream.ops.clearRetainingCapacity();
        stream.chars.clearRetainingCapacity();
    }

    pub fn deinit(self: *PaintGrid) void {
        const a = self.target.allocator;
        for (self.commands.items) |*command| {
            self.release(&command.ops);
            self.release(&command.pending);
            command.ops.deinit(self.payload.allocator());
            command.pending.deinit(self.payload.allocator());
        }
        self.payload.deinit();
        a.free(self.dirty);
        a.free(self.dirty_cells);
        self.commands.deinit(a);
        self.stack.deinit(a);
        a.destroy(self);
    }

    pub fn begin(self: *PaintGrid, background: ansi.RGBA, force_fallback: bool) void {
        const retained = self.valid;
        self.preserved = retained;
        const unsupported = self.target.paint_unsupported;
        self.target.paint_unsupported = false;
        self.count = 0;
        self.stack.clearRetainingCapacity();
        self.active = true;
        self.fallback = false;
        self.retain_on_fallback = force_fallback and !unsupported and !self.target.paint_raw_exposed;
        self.recomposed = 0;
        self.skipped = 0;
        self.recorded = 0;
        self.painting = false;
        if (!b.rgbaEqual(background, self.background)) self.valid = false;
        self.background = background;
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
            return;
        }
    }

    fn prepare(self: *PaintGrid) !void {
        if (self.dirty.len == 0) {
            // Full-only targets need no damage storage.
            const a = self.target.allocator;
            const dirty = try a.alloc(bool, self.target.width * self.target.height);
            errdefer a.free(dirty);
            const dirty_cells = try a.alloc(u32, dirty.len);
            self.dirty = dirty;
            self.dirty_cells = dirty_cells;
        }
        // Every command will be rerecorded. Reuse its old payload storage
        // instead of allocating a second stream just to compare invalid data.
        for (self.commands.items) |*command| {
            self.release(&command.ops);
            std.mem.swap(Stream, &command.ops, &command.pending);
        }
        @memset(self.dirty, true);
        for (self.dirty_cells, 0..) |*index, i| index.* = @intCast(i);
        self.dirty_count = self.dirty.len;
        self.painting = true;
        self.replaying = true;
        self.target.clear(self.background, null);
        self.replaying = false;
    }

    pub fn push(self: *PaintGrid, owner: u32, x: i32, y: i32, width: u32, height: u32, dirty: bool) !bool {
        const t = self.target;
        const nested = self.stack.items.len != 0;
        try self.stack.append(t.allocator, .{ .owner = owner, .scissor_depth = t.scissor_stack.items.len, .opacity_depth = t.opacity_stack.items.len });
        if (nested) self.markVolatile();
        if (nested or self.fallback) return true;
        if (!self.valid and self.count == 0) try self.prepare();
        self.empty = false;
        self.background_group = 0;
        self.replay_group = null;
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
        return self.recordSpan(index, cell, mode, background_index, 1);
    }

    pub fn recordSpan(self: *PaintGrid, index: u32, cell: b.Cell, mode: Mode, background_index: u32, count: u32) bool {
        if (!self.isRecording()) return false;
        const t = self.target;
        const op: Op = .{ .index = index, .cell = cell, .mode = mode, .opacity = t.getCurrentOpacity(), .background_index = background_index, .background_group = if (mode == .inherit) self.background_group else 0, .owner = self.stack.items[self.stack.items.len - 1].owner, .count = count };
        const pending = &self.commands.items[self.count - 1].pending;
        if (count == 1 and pending.ops.items.len != 0 and mode != .inherit and !gp.isClusterChar(cell.char)) {
            const last = &pending.ops.items[pending.ops.items.len - 1];
            if (last.index + last.count == index and last.index / t.width == index / t.width and
                last.mode == mode and last.owner == op.owner and last.opacity == op.opacity and
                !gp.isClusterChar(last.cell.char) and last.cell.attributes == cell.attributes and
                b.rgbaEqual(last.cell.fg, cell.fg) and b.rgbaEqual(last.cell.bg, cell.bg))
            {
                // Solid spans need no glyph payload. Differing scalar glyphs share
                // the same preblend style, but never retain a caller-owned view.
                if (last.text_offset != std.math.maxInt(u32) or last.cell.char != cell.char) {
                    const extra = if (last.text_offset == std.math.maxInt(u32)) last.count + 1 else 1;
                    pending.chars.ensureTotalCapacity(self.payload.allocator(), @max(128, pending.chars.items.len + extra)) catch {
                        self.materialize();
                        return false;
                    };
                    if (last.text_offset == std.math.maxInt(u32)) {
                        last.text_offset = @intCast(pending.chars.items.len);
                        pending.chars.appendNTimesAssumeCapacity(last.cell.char, last.count);
                    }
                    pending.chars.appendAssumeCapacity(cell.char);
                }
                last.count += 1;
                if (self.painting) self.paintInput(op);
                return true;
            }
        }
        pending.ops.append(self.payload.allocator(), op) catch {
            self.materialize();
            return false;
        };
        if (gp.isClusterChar(cell.char)) t.pool.incref(gp.graphemeIdFromChar(cell.char)) catch {};
        const id = ansi.TextAttributes.getLinkId(cell.attributes);
        if (id != 0) t.link_pool.incref(id) catch {};
        if (self.painting) self.paintInput(op);
        return true;
    }

    fn paintInput(self: *PaintGrid, op: Op) void {
        // Inputs already carry their actual footprint, including direct Grid
        // writes outside the scissor. The live opacity is still in scope.
        // Paint once while capturing; fills keep the normal bulk raster path.
        self.replaying = true;
        defer self.replaying = false;
        const t = self.target;
        const scissors = t.scissor_stack;
        t.scissor_stack = .empty;
        defer t.scissor_stack = scissors;
        if (op.mode == .fill) {
            t.fillRect(op.index % t.width, op.index / t.width, op.count, 1, op.cell.bg);
        } else self.applyCell(op);
    }

    // The caller has clipped a uniform printable-ASCII run. Own its inputs once;
    // on first capture the caller still performs the ordinary raster loop.
    pub fn recordTextRun(self: *PaintGrid, index: u32, cell: b.Cell, text: []const u8, mode: Mode) bool {
        if (!self.isRecording()) return false;
        const pending = &self.commands.items[self.count - 1].pending;
        const a = self.payload.allocator();
        pending.ops.ensureUnusedCapacity(a, 1) catch {
            self.materialize();
            return false;
        };
        pending.chars.ensureUnusedCapacity(a, text.len) catch {
            self.materialize();
            return false;
        };
        pending.ops.appendAssumeCapacity(.{
            .index = index,
            .cell = cell,
            .mode = mode,
            .opacity = self.target.getCurrentOpacity(),
            .background_index = 0,
            .background_group = 0,
            .owner = self.stack.items[self.stack.items.len - 1].owner,
            .count = @intCast(text.len),
            .text_offset = @intCast(pending.chars.items.len),
        });
        for (text) |char| pending.chars.appendAssumeCapacity(char);
        const id = ansi.TextAttributes.getLinkId(cell.attributes);
        if (id != 0) self.target.link_pool.incref(id) catch {};
        return !self.painting;
    }

    fn spanEnd(self: *const PaintGrid, op: Op) u32 {
        const width = self.target.width;
        return @min(op.index + op.count + (if (gp.isGraphemeChar(op.cell.char) and op.mode != .raw and op.mode != .direct) gp.charRightExtent(op.cell.char) else 0), (op.index / width + 1) * width);
    }

    fn apply(self: *PaintGrid, stream: Stream, op: Op, dirty_only: bool) void {
        const t = self.target;
        var opacity = [_]f32{op.opacity};
        t.opacity_stack.items = &opacity;
        defer t.opacity_stack.items = &.{};
        if (op.mode == .fill) {
            var index = op.index;
            const end = op.index + op.count;
            while (index < end) {
                if (dirty_only and !self.dirty[index]) {
                    index += 1;
                    continue;
                }
                const start = index;
                index += 1;
                while (index < end and (!dirty_only or self.dirty[index])) : (index += 1) {}
                t.fillRect(start % t.width, start / t.width, index - start, 1, op.cell.bg);
            }
            return;
        }
        for (0..op.count) |offset| {
            const index = op.index + @as(u32, @intCast(offset));
            if (dirty_only and !self.dirty[index]) continue;
            var scalar = op;
            scalar.index = index;
            scalar.cell.char = stream.charAt(op, offset);
            self.applyCell(scalar);
        }
    }

    fn applyCell(self: *PaintGrid, op: Op) void {
        const t = self.target;
        const x = op.index % t.width;
        const y = op.index / t.width;
        var cell = op.cell;
        switch (op.mode) {
            .fill => unreachable,
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
            .text, .inherit, .inherit_cell => {
                if (op.mode == .inherit) {
                    if (self.replay_group != op.background_group) {
                        self.replay_group = op.background_group;
                        self.inherited_background = t.buffer.bg[op.background_index];
                    }
                    cell.bg = self.inherited_background;
                }
                if (op.mode == .inherit_cell) cell.bg = t.buffer.bg[op.index];
                t.setTextCell(x, y, cell);
            },
        }
    }

    // Unsupported access can be discovered halfway through a painter. Materialize
    // the prefix, including that painter's partial stream, then continue it once.
    pub fn materialize(self: *PaintGrid) void {
        if (!self.active or self.replaying or self.fallback) return;
        if (self.painting) {
            self.fallback = true;
            self.valid = false;
            self.fallbacks += 1;
            return;
        }
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
        // An invalid target was already cleared by native publication. As at
        // begin(force_fallback), preserve writes made before this empty frame.
        if (self.preserved or self.count != 0) t.clear(self.background, null);
        for (self.commands.items[0..self.count]) |command| {
            self.replay_group = null;
            const stream = if (command.recording) command.pending else command.ops;
            for (stream.ops.items) |op| self.apply(stream, op, false);
        }
        self.fallback = true;
        self.valid = false;
        self.fallbacks += 1;
    }

    pub fn abort(self: *PaintGrid) void {
        self.active = false;
        self.valid = false;
        while (self.stack.items.len != 0) self.pop();
        if (self.empty) return;
        for (self.commands.items) |*command| {
            self.release(&command.ops);
            self.release(&command.pending);
            command.ops = .{};
            command.pending = .{};
        }
        // All retained pool references are gone before payload storage is reused.
        _ = self.payload.reset(.free_all);
        self.empty = true;
    }

    fn summarize(self: *PaintGrid, command: *Command) void {
        command.first = std.math.maxInt(u32);
        command.end = 0;
        command.dependencies = false;
        for (command.ops.ops.items) |op| {
            command.first = @min(command.first, op.index);
            command.end = @max(command.end, self.spanEnd(op));
            command.dependencies = command.dependencies or op.mode == .inherit or self.spanEnd(op) > op.index + op.count;
        }
    }

    fn markDirty(self: *PaintGrid, index: usize) void {
        if (self.dirty[index]) return;
        self.dirty[index] = true;
        self.dirty_cells[self.dirty_count] = @intCast(index);
        self.dirty_count += 1;
    }

    fn equalStyle(old: Op, new: Op) bool {
        var left = old;
        var right = new;
        left.cell.char = 0;
        right.cell.char = 0;
        left.text_offset = 0;
        right.text_offset = 0;
        // Non-inherited writes do not read a background cell.
        if (left.mode != .inherit) left.background_index = 0;
        if (right.mode != .inherit) right.background_index = 0;
        return std.meta.eql(left, right);
    }

    pub fn finish(self: *PaintGrid) !void {
        if (self.fallback) {
            if (self.retain_on_fallback) {
                // Planned full paints keep owned capacity, but recovery must
                // rerecord every command before any cached paint can be skipped.
                self.active = false;
                self.valid = false;
                while (self.stack.items.len != 0) self.pop();
                return;
            }
            self.abort();
            return;
        }
        const t = self.target;
        const a = t.allocator;
        if (!self.valid and self.count == 0) try self.prepare();
        // Compare glyphs within equal footprints so one edit does not damage
        // its whole row span. Footprint changes damage both old and new spans.
        for (self.commands.items, 0..) |*command, ci| {
            if (ci < self.count and !command.recording) continue;
            if (ci < self.count and command.ops.ops.items.len == command.pending.ops.items.len) {
                var same_footprint = true;
                for (command.ops.ops.items, command.pending.ops.items) |old, new| {
                    if (old.index != new.index or old.count != new.count or self.spanEnd(old) != self.spanEnd(new)) {
                        same_footprint = false;
                        break;
                    }
                }
                if (same_footprint) {
                    for (command.ops.ops.items, command.pending.ops.items) |old, new| {
                        if (!equalStyle(old, new)) {
                            for (old.index..self.spanEnd(old)) |index| self.markDirty(index);
                        } else for (0..old.count) |offset| {
                            if (command.ops.charAt(old, offset) != command.pending.charAt(new, offset)) {
                                const start = old.index + offset;
                                const end = if (old.count == 1) self.spanEnd(old) else start + 1;
                                for (start..end) |index| self.markDirty(index);
                            }
                        }
                    }
                    self.release(&command.ops);
                    std.mem.swap(Stream, &command.ops, &command.pending);
                    self.summarize(command);
                    continue;
                }
            }
            for (command.ops.ops.items) |op| for (op.index..self.spanEnd(op)) |index| self.markDirty(index);
            if (ci < self.count) {
                for (command.pending.ops.items) |op| for (op.index..self.spanEnd(op)) |index| self.markDirty(index);
            }
            self.release(&command.ops);
            if (ci >= self.count) {
                command.present = false;
                continue;
            }
            std.mem.swap(Stream, &command.ops, &command.pending);
            self.summarize(command);
        }
        if (self.painting or self.dirty_count == 0) {
            if (self.painting) {
                self.recomposed = @intCast(self.dirty.len);
                @memset(self.dirty, false);
                self.dirty_count = 0;
            }
            self.active = false;
            self.valid = true;
            return;
        }
        // Wide writes/repairs and inherited tab backgrounds couple cells. Close
        // damage over those actual spans, not over renderable layout rectangles.
        var full_replay = self.dirty_count > self.dirty.len / 4;
        var expanded = !full_replay;
        var cursor: usize = 0;
        var closure_work: usize = 0;
        var closure_limit: usize = std.math.maxInt(usize);
        closure: while (expanded) {
            expanded = false;
            while (cursor < self.dirty_count) : (cursor += 1) {
                const index = self.dirty_cells[cursor];
                const char = t.buffer.char[index];
                if (gp.isClusterChar(char)) {
                    const start = index - @min(gp.charLeftExtent(char), index % t.width);
                    const end = @min(index + 1 + gp.charRightExtent(char), (index / t.width + 1) * t.width);
                    for (start..end) |i| if (!self.dirty[i]) {
                        self.markDirty(i);
                    };
                }
            }
            for (self.commands.items[0..self.count]) |command| {
                if (!command.dependencies) continue;
                for (command.ops.ops.items) |op| {
                    const span_end = self.spanEnd(op);
                    // Always allow the initial dependency scan. Bound rescanning
                    // reverse/transitive overlaps by one screen's worth of work.
                    closure_work += span_end - op.index;
                    if (closure_work > closure_limit) {
                        full_replay = true;
                        break :closure;
                    }
                    if (span_end > op.index + op.count) {
                        const span = self.dirty[op.index..span_end];
                        if (std.mem.indexOfScalar(bool, span, true) != null) {
                            for (op.index..span_end) |index| if (!self.dirty[index]) {
                                self.markDirty(index);
                                expanded = true;
                            };
                        }
                    }
                    if (op.mode == .inherit and self.dirty[op.background_index] and !self.dirty[op.index]) {
                        self.markDirty(op.index);
                        expanded = true;
                    }
                    if (op.mode == .inherit and self.dirty[op.index] and !self.dirty[op.background_index]) {
                        self.markDirty(op.background_index);
                        expanded = true;
                    }
                }
            }
            if (closure_limit == std.math.maxInt(usize)) closure_limit = closure_work + self.dirty.len;
        }
        if (full_replay) {
            @memset(self.dirty, true);
            for (self.dirty_cells, 0..) |*index, i| index.* = @intCast(i);
            self.dirty_count = self.dirty.len;
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
        var first: usize = self.dirty.len;
        var end: usize = 0;
        if (full_replay) {
            t.clear(self.background, null);
            self.recomposed = @intCast(self.dirty.len);
            first = 0;
            end = self.dirty.len;
        }
        for (self.dirty_cells[0..self.dirty_count]) |index| {
            if (full_replay) break;
            first = @min(first, index);
            end = @max(end, index + 1);
            self.recomposed += 1;
            t.set(@intCast(index % t.width), @intCast(index / t.width), .{ .char = b.DEFAULT_SPACE_CHAR, .fg = ansi.rgbColor(255, 255, 255, 255), .bg = self.background, .attributes = 0 });
        }
        for (self.commands.items[0..self.count]) |command| {
            if (command.end <= first or command.first >= end) continue;
            self.replay_group = null;
            for (command.ops.ops.items) |op| self.apply(command.ops, op, !full_replay);
        }
        for (self.dirty_cells[0..self.dirty_count]) |index| self.dirty[index] = false;
        self.dirty_count = 0;
        self.active = false;
        self.valid = true;
    }

    pub fn retainedBytes(self: *const PaintGrid) u64 {
        var bytes: u64 = @sizeOf(PaintGrid) + self.dirty.len * (@sizeOf(bool) + @sizeOf(u32)) + self.commands.capacity * @sizeOf(Command) + self.stack.capacity * @sizeOf(Scope);
        bytes += self.payload.queryCapacity();
        return bytes;
    }
};
