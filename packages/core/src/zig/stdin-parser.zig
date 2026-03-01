const std = @import("std");

pub const StdinTokenKind = enum(u8) {
    text = 0,
    csi = 1,
    osc = 2,
    dcs = 3,
    apc = 4,
    ss3 = 5,
    mouse_sgr = 6,
    mouse_x10 = 7,
    paste = 8,
    esc = 9,
    unknown = 255,
};

pub const StdinToken = extern struct {
    kind: u8,
    flags: u8,
    reserved0: u16,
    payload_offset: u32,
    payload_len: u32,
    aux0: i32,
    aux1: i32,
};

pub const StdinParserOptions = extern struct {
    timeout_ms: u32,
    max_buffer_bytes: u32,
    reserved0: u32,
};

pub const StdinDrainStats = extern struct {
    token_count: u32,
    payload_bytes: u32,
    has_pending: u8,
    overflowed: u8,
    reserved0: u16,
};

const ESC: u8 = 0x1b;
const BEL: u8 = 0x07;
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

pub fn defaultOptions() StdinParserOptions {
    return .{
        .timeout_ms = 10,
        .max_buffer_bytes = 64 * 1024,
        .reserved0 = 0,
    };
}

pub fn resolveOptions(options_ptr: ?*const StdinParserOptions) StdinParserOptions {
    var options = if (options_ptr) |ptr| ptr.* else defaultOptions();

    if (options.timeout_ms == 0) {
        options.timeout_ms = 10;
    }
    if (options.max_buffer_bytes == 0) {
        options.max_buffer_bytes = 64 * 1024;
    }
    options.reserved0 = 0;

    return options;
}

const CandidateToken = struct {
    kind: StdinTokenKind,
    consumed: usize,
    payload_start: usize,
    payload_len: usize,
    clear_paste_mode: bool = false,
};

const ParseResult = union(enum) {
    none,
    incomplete,
    token: CandidateToken,
};

pub const StdinParser = struct {
    allocator: std.mem.Allocator,
    options: StdinParserOptions,
    buffer: std.ArrayList(u8),
    in_paste_mode: bool,
    pending_since_ms: ?u64,
    flush_pending_escape: bool,

    pub fn init(allocator: std.mem.Allocator, options: StdinParserOptions) !*StdinParser {
        const parser = try allocator.create(StdinParser);
        parser.* = .{
            .allocator = allocator,
            .options = options,
            .buffer = std.ArrayList(u8).empty,
            .in_paste_mode = false,
            .pending_since_ms = null,
            .flush_pending_escape = false,
        };
        errdefer allocator.destroy(parser);

        try parser.buffer.ensureTotalCapacityPrecise(allocator, 128);
        return parser;
    }

    pub fn deinit(self: *StdinParser) void {
        self.buffer.deinit(self.allocator);
        self.allocator.destroy(self);
    }

    pub fn push(self: *StdinParser, bytes: []const u8) !void {
        if (bytes.len == 0) {
            return;
        }

        const max_bytes: usize = @intCast(self.options.max_buffer_bytes);
        if (self.buffer.items.len + bytes.len > max_bytes) {
            return error.BufferLimitReached;
        }

        try self.buffer.appendSlice(self.allocator, bytes);
    }

    pub fn drain(self: *StdinParser, token_out: []StdinToken, payload_out: []u8) StdinDrainStats {
        var stats = StdinDrainStats{
            .token_count = 0,
            .payload_bytes = 0,
            .has_pending = 0,
            .overflowed = 0,
            .reserved0 = 0,
        };

        var token_index: usize = 0;
        var payload_index: usize = 0;

        while (true) {
            const parsed = self.nextToken();

            switch (parsed) {
                .none => break,
                .incomplete => {
                    if (self.flush_pending_escape and !self.in_paste_mode and self.buffer.items.len > 0 and self.buffer.items[0] == ESC) {
                        const forced = CandidateToken{
                            .kind = .esc,
                            .consumed = self.buffer.items.len,
                            .payload_start = 0,
                            .payload_len = self.buffer.items.len,
                        };

                        if (!self.emitCandidate(forced, token_out, &token_index, payload_out, &payload_index)) {
                            stats.overflowed = 1;
                            stats.has_pending = 1;
                            break;
                        }

                        self.consumePrefix(forced.consumed);
                        self.flush_pending_escape = false;
                        continue;
                    }

                    break;
                },
                .token => |candidate| {
                    if (!self.emitCandidate(candidate, token_out, &token_index, payload_out, &payload_index)) {
                        stats.overflowed = 1;
                        stats.has_pending = 1;
                        break;
                    }

                    self.consumePrefix(candidate.consumed);
                    if (candidate.clear_paste_mode) {
                        self.in_paste_mode = false;
                    }
                    self.flush_pending_escape = false;
                },
            }
        }

        if (self.hasPendingState()) {
            stats.has_pending = 1;
            if (self.pending_since_ms == null) {
                self.pending_since_ms = nowMs();
            }
        } else {
            self.pending_since_ms = null;
            self.flush_pending_escape = false;
        }

        stats.token_count = @intCast(token_index);
        stats.payload_bytes = @intCast(payload_index);
        return stats;
    }

    pub fn reset(self: *StdinParser) void {
        self.buffer.clearRetainingCapacity();
        self.in_paste_mode = false;
        self.pending_since_ms = null;
        self.flush_pending_escape = false;
    }

    pub fn flushTimeout(self: *StdinParser, now_ms: u64) !void {
        const pending_since = self.pending_since_ms orelse return;
        if (self.in_paste_mode) {
            return;
        }
        if (self.buffer.items.len == 0) {
            return;
        }
        if (self.buffer.items[0] != ESC) {
            return;
        }

        const timeout_ms: u64 = @intCast(self.options.timeout_ms);
        if (now_ms < pending_since or now_ms - pending_since < timeout_ms) {
            return;
        }

        self.flush_pending_escape = true;
    }

    fn hasPendingState(self: *const StdinParser) bool {
        return self.in_paste_mode or self.buffer.items.len > 0;
    }

    fn consumePrefix(self: *StdinParser, consumed: usize) void {
        if (consumed == 0) {
            return;
        }

        if (consumed >= self.buffer.items.len) {
            self.buffer.clearRetainingCapacity();
            return;
        }

        const remaining = self.buffer.items.len - consumed;
        std.mem.copyForwards(u8, self.buffer.items[0..remaining], self.buffer.items[consumed..]);
        self.buffer.items.len = remaining;
    }

    fn emitCandidate(
        self: *StdinParser,
        candidate: CandidateToken,
        token_out: []StdinToken,
        token_index: *usize,
        payload_out: []u8,
        payload_index: *usize,
    ) bool {
        if (token_index.* >= token_out.len) {
            return false;
        }
        if (payload_index.* + candidate.payload_len > payload_out.len) {
            return false;
        }

        if (candidate.payload_len > 0) {
            const start = candidate.payload_start;
            const end = start + candidate.payload_len;
            @memcpy(payload_out[payload_index.* .. payload_index.* + candidate.payload_len], self.buffer.items[start..end]);
        }

        token_out[token_index.*] = .{
            .kind = @intFromEnum(candidate.kind),
            .flags = 0,
            .reserved0 = 0,
            .payload_offset = @intCast(payload_index.*),
            .payload_len = @intCast(candidate.payload_len),
            .aux0 = 0,
            .aux1 = 0,
        };

        token_index.* += 1;
        payload_index.* += candidate.payload_len;
        return true;
    }

    fn nextToken(self: *StdinParser) ParseResult {
        if (self.in_paste_mode) {
            return self.nextPasteToken();
        }

        if (self.buffer.items.len == 0) {
            return .none;
        }

        if (std.mem.startsWith(u8, self.buffer.items, BRACKETED_PASTE_START)) {
            self.consumePrefix(BRACKETED_PASTE_START.len);
            self.in_paste_mode = true;
            return self.nextToken();
        }

        if (self.buffer.items.len < BRACKETED_PASTE_START.len and
            std.mem.eql(u8, self.buffer.items, BRACKETED_PASTE_START[0..self.buffer.items.len]))
        {
            return .incomplete;
        }

        if (self.buffer.items[0] == ESC) {
            return parseEscapeToken(self.buffer.items);
        }

        return parseTextToken(self.buffer.items);
    }

    fn nextPasteToken(self: *StdinParser) ParseResult {
        if (std.mem.indexOf(u8, self.buffer.items, BRACKETED_PASTE_END)) |end_index| {
            return .{ .token = .{
                .kind = .paste,
                .consumed = end_index + BRACKETED_PASTE_END.len,
                .payload_start = 0,
                .payload_len = end_index,
                .clear_paste_mode = true,
            } };
        }

        return .incomplete;
    }
};

fn nowMs() u64 {
    const ts = std.time.milliTimestamp();
    if (ts <= 0) {
        return 0;
    }
    return @intCast(ts);
}

fn parseTextToken(bytes: []const u8) ParseResult {
    if (bytes.len == 0) {
        return .none;
    }

    const seq_len = utf8SequenceLength(bytes[0]);
    if (seq_len == 0) {
        return .{ .token = .{
            .kind = .unknown,
            .consumed = 1,
            .payload_start = 0,
            .payload_len = 1,
        } };
    }

    if (bytes.len < seq_len) {
        return .incomplete;
    }

    var i: usize = 1;
    while (i < seq_len) : (i += 1) {
        if ((bytes[i] & 0xc0) != 0x80) {
            return .{ .token = .{
                .kind = .unknown,
                .consumed = 1,
                .payload_start = 0,
                .payload_len = 1,
            } };
        }
    }

    return .{ .token = .{
        .kind = .text,
        .consumed = seq_len,
        .payload_start = 0,
        .payload_len = seq_len,
    } };
}

fn utf8SequenceLength(first: u8) usize {
    if (first < 0x80) return 1;
    if ((first & 0xe0) == 0xc0) return 2;
    if ((first & 0xf0) == 0xe0) return 3;
    if ((first & 0xf8) == 0xf0) return 4;
    return 0;
}

fn parseEscapeToken(bytes: []const u8) ParseResult {
    if (bytes.len == 0) return .none;
    if (bytes[0] != ESC) return parseTextToken(bytes);

    if (bytes.len == 1) {
        return .incomplete;
    }

    const second = bytes[1];

    if (second == ESC) {
        if (bytes.len == 2) {
            return .incomplete;
        }

        if (!isNestedEscapeSequenceStart(bytes[2])) {
            return .{ .token = .{
                .kind = .unknown,
                .consumed = 2,
                .payload_start = 0,
                .payload_len = 2,
            } };
        }

        const nested = parseEscapeToken(bytes[1..]);
        switch (nested) {
            .none => return .incomplete,
            .incomplete => return .incomplete,
            .token => |token| {
                return .{ .token = .{
                    .kind = token.kind,
                    .consumed = token.consumed + 1,
                    .payload_start = 0,
                    .payload_len = token.payload_len + 1,
                    .clear_paste_mode = token.clear_paste_mode,
                } };
            },
        }
    }

    return switch (second) {
        '[' => parseCsiToken(bytes),
        ']' => parseOscToken(bytes),
        'P' => parseStTerminatedToken(bytes, .dcs),
        '_' => parseStTerminatedToken(bytes, .apc),
        'O' => if (bytes.len >= 3)
            .{ .token = .{
                .kind = .ss3,
                .consumed = 3,
                .payload_start = 0,
                .payload_len = 3,
            } }
        else
            .incomplete,
        else => .{ .token = .{
            .kind = .unknown,
            .consumed = 2,
            .payload_start = 0,
            .payload_len = 2,
        } },
    };
}

fn parseCsiToken(bytes: []const u8) ParseResult {
    if (bytes.len < 3) {
        return .incomplete;
    }

    if (bytes[2] == 'M') {
        if (bytes.len < 6) {
            return .incomplete;
        }

        return .{ .token = .{
            .kind = .mouse_x10,
            .consumed = 6,
            .payload_start = 0,
            .payload_len = 6,
        } };
    }

    var i: usize = 2;
    while (i < bytes.len) : (i += 1) {
        const b = bytes[i];
        if (b >= 0x40 and b <= 0x7e) {
            const consumed = i + 1;
            const sequence = bytes[0..consumed];
            const kind: StdinTokenKind = if (isMouseSgrSequence(sequence)) .mouse_sgr else .csi;

            return .{ .token = .{
                .kind = kind,
                .consumed = consumed,
                .payload_start = 0,
                .payload_len = consumed,
            } };
        }
    }

    return .incomplete;
}

fn parseOscToken(bytes: []const u8) ParseResult {
    var i: usize = 2;
    while (i < bytes.len) : (i += 1) {
        if (bytes[i] == BEL) {
            const consumed = i + 1;
            return .{ .token = .{
                .kind = .osc,
                .consumed = consumed,
                .payload_start = 0,
                .payload_len = consumed,
            } };
        }

        if (bytes[i] == ESC) {
            if (i + 1 >= bytes.len) {
                return .incomplete;
            }
            if (bytes[i + 1] == '\\') {
                const consumed = i + 2;
                return .{ .token = .{
                    .kind = .osc,
                    .consumed = consumed,
                    .payload_start = 0,
                    .payload_len = consumed,
                } };
            }
        }
    }

    return .incomplete;
}

fn parseStTerminatedToken(bytes: []const u8, kind: StdinTokenKind) ParseResult {
    var i: usize = 2;
    while (i < bytes.len) : (i += 1) {
        if (bytes[i] != ESC) {
            continue;
        }
        if (i + 1 >= bytes.len) {
            return .incomplete;
        }
        if (bytes[i + 1] == '\\') {
            const consumed = i + 2;
            return .{ .token = .{
                .kind = kind,
                .consumed = consumed,
                .payload_start = 0,
                .payload_len = consumed,
            } };
        }
    }

    return .incomplete;
}

fn isNestedEscapeSequenceStart(byte: u8) bool {
    return byte == '[' or byte == ']' or byte == 'O' or byte == 'N' or byte == 'P' or byte == '_';
}

fn isMouseSgrSequence(sequence: []const u8) bool {
    if (!std.mem.startsWith(u8, sequence, "\x1b[<")) {
        return false;
    }
    if (sequence.len < 7) {
        return false;
    }

    const final = sequence[sequence.len - 1];
    if (final != 'M' and final != 'm') {
        return false;
    }

    const body = sequence[3 .. sequence.len - 1];
    var part_count: usize = 0;
    var has_digit = false;

    for (body) |char| {
        if (char >= '0' and char <= '9') {
            has_digit = true;
            continue;
        }

        if (char == ';' and has_digit and part_count < 2) {
            part_count += 1;
            has_digit = false;
            continue;
        }

        return false;
    }

    return part_count == 2 and has_digit;
}
