const std = @import("std");
const ghostty = @import("ghostty.zig");

pub const Error = error{
    InvalidValue,
    ProcessingFailed,
    ResponseOverflow,
} || std.mem.Allocator.Error;

pub const Options = struct {
    cols: u16,
    rows: u16,
    max_scrollback: usize = 10_000,
};

pub const parser_allocation_limit = 1024 * 1024;
pub const response_limit = 1024 * 1024;

const BoundedAllocator = struct {
    child: std.mem.Allocator,
    limit: usize,
    used: usize = 0,
    failed: bool = false,

    fn allocator(self: *BoundedAllocator) std.mem.Allocator {
        return .{ .ptr = self, .vtable = &vtable };
    }

    const vtable: std.mem.Allocator.VTable = .{
        .alloc = alloc,
        .resize = resize,
        .remap = remap,
        .free = free,
    };

    fn alloc(ctx: *anyopaque, len: usize, alignment: std.mem.Alignment, ret_addr: usize) ?[*]u8 {
        const self: *BoundedAllocator = @ptrCast(@alignCast(ctx));
        if (len > self.limit -| self.used) {
            self.failed = true;
            return null;
        }
        const result = self.child.rawAlloc(len, alignment, ret_addr);
        if (result) |_| {
            self.used += len;
        } else {
            self.failed = true;
        }
        return result;
    }

    fn resize(
        ctx: *anyopaque,
        memory: []u8,
        alignment: std.mem.Alignment,
        new_len: usize,
        ret_addr: usize,
    ) bool {
        const self: *BoundedAllocator = @ptrCast(@alignCast(ctx));
        if (new_len > memory.len and new_len - memory.len > self.limit -| self.used) return false;
        if (!self.child.rawResize(memory, alignment, new_len, ret_addr)) return false;
        self.used = self.used - memory.len + new_len;
        return true;
    }

    fn remap(
        ctx: *anyopaque,
        memory: []u8,
        alignment: std.mem.Alignment,
        new_len: usize,
        ret_addr: usize,
    ) ?[*]u8 {
        const self: *BoundedAllocator = @ptrCast(@alignCast(ctx));
        if (new_len > memory.len and new_len - memory.len > self.limit -| self.used) return null;
        const result = self.child.rawRemap(memory, alignment, new_len, ret_addr) orelse return null;
        self.used = self.used - memory.len + new_len;
        return result;
    }

    fn free(ctx: *anyopaque, memory: []u8, alignment: std.mem.Alignment, ret_addr: usize) void {
        const self: *BoundedAllocator = @ptrCast(@alignCast(ctx));
        self.child.rawFree(memory, alignment, ret_addr);
        self.used -= memory.len;
    }
};

pub const EmbeddedTerminal = struct {
    allocator: std.mem.Allocator,
    terminal: ghostty.Terminal,
    stream: ghostty.TerminalStream,
    cols: u16,
    rows: u16,
    responses: std.ArrayListUnmanaged(u8) = .empty,
    response_error: ?Error = null,
    mouse_last_cell: ?ghostty.Coordinate = null,
    parser_allocator: BoundedAllocator = undefined,

    pub fn init(allocator: std.mem.Allocator, options: Options) Error!*EmbeddedTerminal {
        if (options.cols == 0 or options.rows == 0) return error.InvalidValue;

        const self = try allocator.create(EmbeddedTerminal);
        errdefer allocator.destroy(self);

        self.* = .{
            .allocator = allocator,
            .terminal = try .init(allocator, .{
                .cols = options.cols,
                .rows = options.rows,
                .max_scrollback = options.max_scrollback,
            }),
            .stream = undefined,
            .cols = options.cols,
            .rows = options.rows,
        };
        errdefer self.terminal.deinit(allocator);

        self.parser_allocator = .{ .child = allocator, .limit = parser_allocation_limit };
        var handler = self.terminal.vtHandler();
        handler.effects.write_pty = &writePty;
        self.stream = .initAlloc(self.parser_allocator.allocator(), handler);
        return self;
    }

    pub fn deinit(self: *EmbeddedTerminal) void {
        const allocator = self.allocator;
        self.stream.deinit();
        self.terminal.deinit(allocator);
        self.responses.deinit(allocator);
        allocator.destroy(self);
    }

    pub fn write(self: *EmbeddedTerminal, bytes: []const u8) Error!void {
        self.parser_allocator.failed = false;
        self.stream.nextSlice(bytes);
        if (self.parser_allocator.failed or self.stream.handler.semantic_failure) return error.ProcessingFailed;
    }

    pub fn resize(self: *EmbeddedTerminal, cols: u16, rows: u16) Error!void {
        if (cols == 0 or rows == 0) return error.InvalidValue;
        self.stream.handler.resize(.{ .cols = cols, .rows = rows }) catch |err| switch (err) {
            error.InvalidValue => return error.InvalidValue,
            error.OutOfMemory => return error.OutOfMemory,
        };
        self.cols = cols;
        self.rows = rows;
    }

    pub fn scroll(self: *EmbeddedTerminal, delta: i32) void {
        self.terminal.scrollViewport(.{ .delta = delta });
    }

    pub fn encodeKey(self: *EmbeddedTerminal, key: ghostty.Key) Error![]u8 {
        var output: std.Io.Writer.Allocating = .init(self.allocator);
        errdefer output.deinit();
        ghostty.encodeKey(&output.writer, key.event(), .fromTerminal(&self.terminal)) catch return error.OutOfMemory;
        return output.toOwnedSlice();
    }

    pub fn encodeMouse(self: *EmbeddedTerminal, mouse: ghostty.Mouse) Error![]u8 {
        const MouseSize = @FieldType(ghostty.MouseEncodeOptions, "size");
        const size: MouseSize = .{
            .screen = .{ .width = self.cols, .height = self.rows },
            .cell = .{ .width = 1, .height = 1 },
            .padding = .{},
        };
        var options = ghostty.MouseEncodeOptions.fromTerminal(&self.terminal, size);
        // OpenTUI receives terminal-cell coordinates, not physical pixels.
        if (options.format == .sgr_pixels) return self.allocator.alloc(u8, 0);
        options.any_button_pressed = mouse.any_button_pressed;
        options.last_cell = &self.mouse_last_cell;

        var output: std.Io.Writer.Allocating = .init(self.allocator);
        errdefer output.deinit();
        ghostty.encodeMouse(&output.writer, mouse.event(), options) catch return error.OutOfMemory;
        return output.toOwnedSlice();
    }

    pub fn encodePaste(self: *EmbeddedTerminal, input: []const u8) Error![]u8 {
        const copy = try self.allocator.dupe(u8, input);
        defer self.allocator.free(copy);
        const parts = ghostty.encodePaste(copy, .fromTerminal(&self.terminal));

        var output: std.Io.Writer.Allocating = .init(self.allocator);
        errdefer output.deinit();
        for (parts) |part| output.writer.writeAll(part) catch return error.OutOfMemory;
        return output.toOwnedSlice();
    }

    pub fn encodeFocus(self: *EmbeddedTerminal, focused: bool) Error![]u8 {
        if (!self.terminal.modes.get(.focus_event)) return self.allocator.alloc(u8, 0);

        var output: std.Io.Writer.Allocating = .init(self.allocator);
        errdefer output.deinit();
        ghostty.encodeFocus(&output.writer, if (focused) .gained else .lost) catch return error.OutOfMemory;
        return output.toOwnedSlice();
    }

    pub fn freeEncoded(self: *EmbeddedTerminal, bytes: []u8) void {
        self.allocator.free(bytes);
    }

    pub fn drainResponses(self: *EmbeddedTerminal, output: []u8) Error!usize {
        if (self.response_error) |err| {
            self.response_error = null;
            return err;
        }
        const count = @min(output.len, self.responses.items.len);
        @memcpy(output[0..count], self.responses.items[0..count]);
        std.mem.copyForwards(u8, self.responses.items[0 .. self.responses.items.len - count], self.responses.items[count..]);
        self.responses.items.len -= count;
        return count;
    }

    fn writePty(handler: *ghostty.TerminalStream.Handler, data: [:0]const u8) void {
        const self: *EmbeddedTerminal = @fieldParentPtr("terminal", handler.terminal);
        if (self.response_error != null) return;
        if (data.len > response_limit - @min(self.responses.items.len, response_limit)) {
            self.response_error = error.ResponseOverflow;
            return;
        }
        self.responses.appendSlice(self.allocator, data) catch {
            self.response_error = error.OutOfMemory;
        };
    }
};
