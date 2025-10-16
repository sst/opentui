const std = @import("std");
const event_emitter = @import("../event-emitter.zig");

const EventType = enum {
    start,
    stop,
    update,
};

const Counter = struct {
    count: u32,

    pub fn increment(ctx: *Counter) void {
        ctx.count += 1;
    }

    pub fn reset(ctx: *Counter) void {
        ctx.count = 0;
    }
};

const CounterListener = event_emitter.EventListener(*Counter);

test "EventEmitter - can initialize and deinitialize" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();
}

test "EventEmitter - can add listener with on" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    var counter = Counter{ .count = 0 };
    const listener = CounterListener{
        .ctx = &counter,
        .handle = Counter.increment,
    };

    try emitter.on(.start, @ptrCast(&listener));

    const list = emitter.listeners.get(.start);
    try std.testing.expect(list != null);
    try std.testing.expectEqual(@as(usize, 1), list.?.items.len);
}

test "EventEmitter - can add multiple listeners to same event" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    var counter1 = Counter{ .count = 0 };
    var counter2 = Counter{ .count = 0 };

    const listener1 = CounterListener{
        .ctx = &counter1,
        .handle = Counter.increment,
    };

    const listener2 = CounterListener{
        .ctx = &counter2,
        .handle = Counter.increment,
    };

    try emitter.on(.start, @ptrCast(&listener1));
    try emitter.on(.start, @ptrCast(&listener2));

    const list = emitter.listeners.get(.start);
    try std.testing.expectEqual(@as(usize, 2), list.?.items.len);
}

test "EventEmitter - can add listeners to different events" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    var counter1 = Counter{ .count = 0 };
    var counter2 = Counter{ .count = 0 };

    const listener1 = CounterListener{
        .ctx = &counter1,
        .handle = Counter.increment,
    };

    const listener2 = CounterListener{
        .ctx = &counter2,
        .handle = Counter.reset,
    };

    try emitter.on(.start, @ptrCast(&listener1));
    try emitter.on(.stop, @ptrCast(&listener2));

    const start_list = emitter.listeners.get(.start);
    const stop_list = emitter.listeners.get(.stop);

    try std.testing.expectEqual(@as(usize, 1), start_list.?.items.len);
    try std.testing.expectEqual(@as(usize, 1), stop_list.?.items.len);
}

test "EventEmitter - emit calls all listeners for event" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    var counter1 = Counter{ .count = 0 };
    var counter2 = Counter{ .count = 0 };
    var counter3 = Counter{ .count = 0 };

    const listener1 = CounterListener{
        .ctx = &counter1,
        .handle = Counter.increment,
    };

    const listener2 = CounterListener{
        .ctx = &counter2,
        .handle = Counter.increment,
    };

    const listener3 = CounterListener{
        .ctx = &counter3,
        .handle = Counter.increment,
    };

    try emitter.on(.start, @ptrCast(&listener1));
    try emitter.on(.start, @ptrCast(&listener2));
    try emitter.on(.stop, @ptrCast(&listener3));

    emitter.emit(.start, CounterListener);

    try std.testing.expectEqual(@as(u32, 1), counter1.count);
    try std.testing.expectEqual(@as(u32, 1), counter2.count);
    try std.testing.expectEqual(@as(u32, 0), counter3.count);

    emitter.emit(.stop, CounterListener);

    try std.testing.expectEqual(@as(u32, 1), counter1.count);
    try std.testing.expectEqual(@as(u32, 1), counter2.count);
    try std.testing.expectEqual(@as(u32, 1), counter3.count);
}

test "EventEmitter - can remove listener with off" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    var counter = Counter{ .count = 0 };
    const listener = CounterListener{
        .ctx = &counter,
        .handle = Counter.increment,
    };

    try emitter.on(.start, @ptrCast(&listener));

    var list = emitter.listeners.get(.start);
    try std.testing.expectEqual(@as(usize, 1), list.?.items.len);

    emitter.off(.start, @ptrCast(&listener));

    list = emitter.listeners.get(.start);
    try std.testing.expectEqual(@as(usize, 0), list.?.items.len);
}

test "EventEmitter - off removes only matching listener by reference" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    var counter1 = Counter{ .count = 0 };
    var counter2 = Counter{ .count = 0 };

    const listener1 = CounterListener{
        .ctx = &counter1,
        .handle = Counter.increment,
    };

    const listener2 = CounterListener{
        .ctx = &counter2,
        .handle = Counter.increment,
    };

    try emitter.on(.start, @ptrCast(&listener1));
    try emitter.on(.start, @ptrCast(&listener2));

    var list = emitter.listeners.get(.start);
    try std.testing.expectEqual(@as(usize, 2), list.?.items.len);

    emitter.off(.start, @ptrCast(&listener1));

    list = emitter.listeners.get(.start);
    try std.testing.expectEqual(@as(usize, 1), list.?.items.len);

    emitter.emit(.start, CounterListener);
    try std.testing.expectEqual(@as(u32, 0), counter1.count);
    try std.testing.expectEqual(@as(u32, 1), counter2.count);
}

test "EventEmitter - emit with no listeners does not crash" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    emitter.emit(.start, CounterListener);
    emitter.emit(.stop, CounterListener);
    emitter.emit(.update, CounterListener);
}

test "EventEmitter - multiple emits increment counter correctly" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    var counter = Counter{ .count = 0 };
    const listener = CounterListener{
        .ctx = &counter,
        .handle = Counter.increment,
    };

    try emitter.on(.update, @ptrCast(&listener));

    emitter.emit(.update, CounterListener);
    emitter.emit(.update, CounterListener);
    emitter.emit(.update, CounterListener);

    try std.testing.expectEqual(@as(u32, 3), counter.count);
}

test "EventEmitter - listeners are isolated per event type" {
    const Emitter = event_emitter.EventEmitter(EventType);
    var emitter = Emitter.init(std.testing.allocator);
    defer emitter.deinit();

    var counter = Counter{ .count = 0 };
    const listener = CounterListener{
        .ctx = &counter,
        .handle = Counter.increment,
    };

    try emitter.on(.start, @ptrCast(&listener));

    emitter.emit(.start, CounterListener);
    try std.testing.expectEqual(@as(u32, 1), counter.count);

    emitter.emit(.stop, CounterListener);
    try std.testing.expectEqual(@as(u32, 1), counter.count);

    emitter.emit(.start, CounterListener);
    try std.testing.expectEqual(@as(u32, 2), counter.count);
}
