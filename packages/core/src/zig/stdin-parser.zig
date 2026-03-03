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
    aux0: i32,
    aux1: i32,
};

pub const StdinParserOptions = extern struct {
    timeout_ms: u32,
    max_buffer_bytes: u32,
    reserved0: u32,
};

pub const StdinPayloadRef = extern struct {
    payload_ptr: ?[*]const u8,
    payload_len: u32,
    reserved0: u32,
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
    consume: struct {
        consumed: usize,
        clear_paste_mode: bool = false,
    },
    token: CandidateToken,
};

pub const NextTokenStatus = enum {
    none,
    pending,
    token,
};

pub const NextToken = struct {
    status: NextTokenStatus,
    kind: StdinTokenKind = .unknown,
    payload: []const u8 = &[_]u8{},
};

pub const StdinParser = struct {
    allocator: std.mem.Allocator,
    options: StdinParserOptions,
    buffer: std.ArrayList(u8),
    in_paste_mode: bool,
    pending_since_ms: ?u64,
    flush_pending_timeout: bool,
    pending_consumed: usize,
    pending_clear_paste_mode: bool,

    pub fn init(allocator: std.mem.Allocator, options: StdinParserOptions) !*StdinParser {
        const parser = try allocator.create(StdinParser);
        parser.* = .{
            .allocator = allocator,
            .options = options,
            .buffer = std.ArrayList(u8).empty,
            .in_paste_mode = false,
            .pending_since_ms = null,
            .flush_pending_timeout = false,
            .pending_consumed = 0,
            .pending_clear_paste_mode = false,
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

        self.commitPendingToken();

        const max_bytes: usize = @intCast(self.options.max_buffer_bytes);
        if (self.buffer.items.len + bytes.len > max_bytes) {
            return error.BufferLimitReached;
        }

        try self.buffer.appendSlice(self.allocator, bytes);
    }

    pub fn reset(self: *StdinParser) void {
        self.buffer.deinit(self.allocator);
        self.buffer = std.ArrayList(u8).empty;
        self.buffer.ensureTotalCapacityPrecise(self.allocator, 128) catch {};
        self.in_paste_mode = false;
        self.pending_since_ms = null;
        self.flush_pending_timeout = false;
        self.pending_consumed = 0;
        self.pending_clear_paste_mode = false;
    }

    pub fn flushTimeout(self: *StdinParser, now_ms: u64) !void {
        const pending_since = self.pending_since_ms orelse return;
        if (self.in_paste_mode) {
            return;
        }
        if (self.buffer.items.len == 0) {
            return;
        }
        const timeout_ms: u64 = @intCast(self.options.timeout_ms);
        if (now_ms < pending_since or now_ms - pending_since < timeout_ms) {
            return;
        }

        self.flush_pending_timeout = true;
    }

    pub fn next(self: *StdinParser) NextToken {
        self.commitPendingToken();

        while (true) {
            const parsed = self.nextToken();

            switch (parsed) {
                .none => {
                    self.pending_since_ms = null;
                    self.flush_pending_timeout = false;
                    return .{ .status = .none };
                },
                .incomplete => {
                    if (self.flush_pending_timeout and !self.in_paste_mode and self.buffer.items.len > 0) {
                        const first = self.buffer.items[0];
                        const seq_len = utf8SequenceLength(first);
                        const should_force_unknown = seq_len == 0 or (self.buffer.items.len == 1 and seq_len > 1);

                        if (first == ESC or should_force_unknown) {
                            const forced = if (first == ESC)
                                CandidateToken{
                                    .kind = .esc,
                                    .consumed = self.buffer.items.len,
                                    .payload_start = 0,
                                    .payload_len = self.buffer.items.len,
                                }
                            else
                                CandidateToken{
                                    .kind = .unknown,
                                    .consumed = 1,
                                    .payload_start = 0,
                                    .payload_len = 1,
                                };

                            return self.stageNextToken(forced);
                        }
                    }

                    if (self.hasPendingState()) {
                        if (self.pending_since_ms == null) {
                            self.pending_since_ms = nowMs();
                        }
                        return .{ .status = .pending };
                    }

                    self.pending_since_ms = null;
                    self.flush_pending_timeout = false;
                    return .{ .status = .none };
                },
                .consume => |consume| {
                    self.consumePrefix(consume.consumed);
                    if (consume.clear_paste_mode) {
                        self.in_paste_mode = false;
                    }
                    self.flush_pending_timeout = false;
                    continue;
                },
                .token => |candidate| {
                    return self.stageNextToken(candidate);
                },
            }
        }
    }

    fn stageNextToken(self: *StdinParser, candidate: CandidateToken) NextToken {
        const start = candidate.payload_start;
        const end = start + candidate.payload_len;

        self.pending_consumed = candidate.consumed;
        self.pending_clear_paste_mode = candidate.clear_paste_mode;
        self.flush_pending_timeout = false;
        self.pending_since_ms = null;

        return .{
            .status = .token,
            .kind = candidate.kind,
            .payload = self.buffer.items[start..end],
        };
    }

    fn commitPendingToken(self: *StdinParser) void {
        if (self.pending_consumed == 0) {
            return;
        }

        self.consumePrefix(self.pending_consumed);
        if (self.pending_clear_paste_mode) {
            self.in_paste_mode = false;
        }
        self.pending_consumed = 0;
        self.pending_clear_paste_mode = false;
    }

    fn hasPendingState(self: *const StdinParser) bool {
        return self.pending_consumed > 0 or self.in_paste_mode or self.buffer.items.len > 0;
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

    const available = @min(bytes.len, seq_len);

    var i: usize = 1;
    while (i < available) : (i += 1) {
        if ((bytes[i] & 0xc0) != 0x80) {
            return .{ .token = .{
                .kind = .unknown,
                .consumed = 1,
                .payload_start = 0,
                .payload_len = 1,
            } };
        }
    }

    if (bytes.len < seq_len) {
        return .incomplete;
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
    if (first >= 0xc2 and first <= 0xdf) return 2;
    if (first >= 0xe0 and first <= 0xef) return 3;
    if (first >= 0xf0 and first <= 0xf4) return 4;
    return 0;
}

const EscapeParseState = enum {
    start,
    esc,
    csi,
    osc,
    osc_escape,
    st,
    st_escape,
};

fn escapeToken(kind: StdinTokenKind, consumed: usize) ParseResult {
    return .{ .token = .{
        .kind = kind,
        .consumed = consumed,
        .payload_start = 0,
        .payload_len = consumed,
    } };
}

fn parseEscapeToken(bytes: []const u8) ParseResult {
    var i: usize = 0;
    var st_kind: StdinTokenKind = .unknown;

    state: switch (EscapeParseState.start) {
        .start => {
            if (bytes.len == 0) {
                return .none;
            }
            if (bytes[0] != ESC) {
                return parseTextToken(bytes);
            }
            if (bytes.len == 1) {
                return .incomplete;
            }

            i = 1;
            continue :state .esc;
        },

        .esc => switch (bytes[i]) {
            '[' => {
                i += 1;
                continue :state .csi;
            },
            ']' => {
                i += 1;
                continue :state .osc;
            },
            'P' => {
                st_kind = .dcs;
                i += 1;
                continue :state .st;
            },
            '_' => {
                st_kind = .apc;
                i += 1;
                continue :state .st;
            },
            'O' => {
                if (bytes.len < i + 2) {
                    return .incomplete;
                }
                return escapeToken(.ss3, i + 2);
            },
            ESC => {
                if (i + 1 >= bytes.len) {
                    return .incomplete;
                }
                if (!isNestedEscapeSequenceStart(bytes[i + 1])) {
                    return escapeToken(.unknown, i + 1);
                }

                i += 1;
                continue :state .esc;
            },
            else => return escapeToken(.unknown, i + 1),
        },

        .csi => {
            if (i >= bytes.len) {
                return .incomplete;
            }

            if (bytes[i] == 'M') {
                const required_len = i + 4;
                if (bytes.len < required_len) {
                    return .incomplete;
                }
                return escapeToken(.mouse_x10, required_len);
            }

            var scan_index: usize = i;
            while (scan_index < bytes.len) : (scan_index += 1) {
                const b = bytes[scan_index];
                if (b >= 0x40 and b <= 0x7e) {
                    const consumed = scan_index + 1;
                    const kind: StdinTokenKind = if (isMouseSgrSequence(bytes[0..consumed])) .mouse_sgr else .csi;
                    return escapeToken(kind, consumed);
                }
            }

            return .incomplete;
        },

        .osc => {
            var scan_index: usize = i;
            while (scan_index < bytes.len) : (scan_index += 1) {
                const b = bytes[scan_index];
                if (b == BEL) {
                    return escapeToken(.osc, scan_index + 1);
                }
                if (b == ESC) {
                    i = scan_index;
                    continue :state .osc_escape;
                }
            }

            return .incomplete;
        },

        .osc_escape => {
            if (i + 1 >= bytes.len) {
                return .incomplete;
            }
            if (bytes[i + 1] == '\\') {
                return escapeToken(.osc, i + 2);
            }

            i += 1;
            continue :state .osc;
        },

        .st => {
            var scan_index: usize = i;
            while (scan_index < bytes.len) : (scan_index += 1) {
                if (bytes[scan_index] == ESC) {
                    i = scan_index;
                    continue :state .st_escape;
                }
            }

            return .incomplete;
        },

        .st_escape => {
            if (i + 1 >= bytes.len) {
                return .incomplete;
            }
            if (bytes[i + 1] == '\\') {
                return escapeToken(st_kind, i + 2);
            }

            i += 1;
            continue :state .st;
        },
    }
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
