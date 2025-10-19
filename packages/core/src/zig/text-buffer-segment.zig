const std = @import("std");
const Allocator = std.mem.Allocator;
const rope_mod = @import("rope.zig");
const buffer = @import("buffer.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");

pub const RGBA = buffer.RGBA;
pub const TextSelection = buffer.TextSelection;

pub const TextBufferError = error{
    OutOfMemory,
    InvalidDimensions,
    InvalidIndex,
    InvalidId,
    InvalidMemId,
};

pub const WrapMode = enum {
    none,
    char,
    word,
};

pub const ChunkFitResult = struct {
    char_count: u32,
    width: u32,
};

/// Cached grapheme cluster information
/// Only stored for multibyte (non-ASCII) graphemes
pub const GraphemeInfo = struct {
    byte_offset: u32,
    byte_len: u8,
    width: u8,
    col_offset: u32,
};

/// Memory buffer reference in the registry
pub const MemBuffer = struct {
    data: []const u8,
    owned: bool,
};

/// Registry for multiple memory buffers
pub const MemRegistry = struct {
    buffers: std.ArrayListUnmanaged(MemBuffer),
    allocator: Allocator,

    pub fn init(allocator: Allocator) MemRegistry {
        return .{
            .buffers = .{},
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *MemRegistry) void {
        for (self.buffers.items) |mem_buf| {
            if (mem_buf.owned) {
                self.allocator.free(mem_buf.data);
            }
        }
        self.buffers.deinit(self.allocator);
    }

    pub fn register(self: *MemRegistry, data: []const u8, owned: bool) TextBufferError!u8 {
        if (self.buffers.items.len >= 255) {
            return TextBufferError.OutOfMemory;
        }
        const id: u8 = @intCast(self.buffers.items.len);
        try self.buffers.append(self.allocator, MemBuffer{
            .data = data,
            .owned = owned,
        });
        return id;
    }

    pub fn get(self: *const MemRegistry, id: u8) ?[]const u8 {
        if (id >= self.buffers.items.len) return null;
        return self.buffers.items[id].data;
    }

    pub fn clear(self: *MemRegistry) void {
        for (self.buffers.items) |mem_buf| {
            if (mem_buf.owned) {
                self.allocator.free(mem_buf.data);
            }
        }
        self.buffers.clearRetainingCapacity();
    }
};

/// A chunk represents a contiguous sequence of UTF-8 bytes from a specific memory buffer
pub const TextChunk = struct {
    mem_id: u8,
    byte_start: u32,
    byte_end: u32,
    width: u16,
    flags: u8 = 0,
    graphemes: ?[]GraphemeInfo = null,
    wrap_offsets: ?[]utf8.WrapBreak = null,

    pub const Flags = struct {
        pub const ASCII_ONLY: u8 = 0b00000001;
    };

    pub fn isAsciiOnly(self: *const TextChunk) bool {
        return (self.flags & Flags.ASCII_ONLY) != 0;
    }

    pub fn empty() TextChunk {
        return .{
            .mem_id = 0,
            .byte_start = 0,
            .byte_end = 0,
            .width = 0,
        };
    }

    pub fn is_empty(self: *const TextChunk) bool {
        return self.width == 0;
    }

    pub fn getBytes(self: *const TextChunk, mem_registry: *const MemRegistry) []const u8 {
        const mem_buf = mem_registry.get(self.mem_id) orelse return &[_]u8{};
        return mem_buf[self.byte_start..self.byte_end];
    }

    /// Lazily compute and cache grapheme info for this chunk
    /// Returns a slice that is valid until the buffer is reset
    /// For ASCII-only chunks, returns an empty slice (sentinel)
    /// For mixed chunks, returns only multibyte (non-ASCII) graphemes with their column offsets
    pub fn getGraphemes(
        self: *const TextChunk,
        mem_registry: *const MemRegistry,
        allocator: Allocator,
        graphemes_data: *const Graphemes,
        width_method: gwidth.WidthMethod,
        display_width: *const DisplayWidth,
    ) TextBufferError![]const GraphemeInfo {
        const mut_self = @constCast(self);
        if (self.graphemes) |cached| {
            return cached;
        }

        if (self.isAsciiOnly()) {
            const empty_slice = try allocator.alloc(GraphemeInfo, 0);
            mut_self.graphemes = empty_slice;
            return empty_slice;
        }

        const chunk_bytes = self.getBytes(mem_registry);
        var grapheme_list = std.ArrayList(GraphemeInfo).init(allocator);
        defer grapheme_list.deinit();

        var iter = graphemes_data.iterator(chunk_bytes);
        var byte_pos: u32 = 0;
        var col: u32 = 0;

        while (iter.next()) |gc| {
            const gbytes = gc.bytes(chunk_bytes);
            const width_u16: u16 = gwidth.gwidth(gbytes, width_method, display_width);

            if (width_u16 == 0) {
                byte_pos += @intCast(gbytes.len);
                continue;
            }

            const width: u8 = @intCast(width_u16);

            if (gbytes.len != 1) {
                try grapheme_list.append(GraphemeInfo{
                    .byte_offset = byte_pos,
                    .byte_len = @intCast(gbytes.len),
                    .width = width,
                    .col_offset = col,
                });
            }

            byte_pos += @intCast(gbytes.len);
            col += width;
        }

        const graphemes = try allocator.dupe(GraphemeInfo, grapheme_list.items);
        mut_self.graphemes = graphemes;

        return graphemes;
    }

    /// Lazily compute and cache wrap offsets for this chunk
    /// Returns a slice that is valid until the buffer is reset
    pub fn getWrapOffsets(
        self: *const TextChunk,
        mem_registry: *const MemRegistry,
        allocator: Allocator,
    ) TextBufferError![]const utf8.WrapBreak {
        const mut_self = @constCast(self);
        if (self.wrap_offsets) |cached| {
            return cached;
        }

        const chunk_bytes = self.getBytes(mem_registry);
        var wrap_result = utf8.WrapBreakResult.init(allocator);
        defer wrap_result.deinit();

        try utf8.findWrapBreaksSIMD16(chunk_bytes, &wrap_result);

        const wrap_offsets = try allocator.dupe(utf8.WrapBreak, wrap_result.breaks.items);
        mut_self.wrap_offsets = wrap_offsets;

        return wrap_offsets;
    }
};

/// A highlight represents a styled region on a line
pub const Highlight = struct {
    col_start: u32,
    col_end: u32,
    style_id: u32,
    priority: u8,
    hl_ref: ?u16,
};

/// Pre-computed style span for efficient rendering
/// Represents a contiguous region with a single style
pub const StyleSpan = struct {
    col: u32,
    style_id: u32,
    next_col: u32,
};

/// A segment in the unified rope - either text content or a line break marker
pub const Segment = union(enum) {
    text: TextChunk,
    brk: void,
    linestart: void,

    /// Define which union tags are markers (for O(1) line lookup)
    pub const MarkerTypes = &[_]std.meta.Tag(Segment){ .brk, .linestart };

    /// Metrics for aggregation in the rope tree
    /// These enable O(log n) row/col coordinate mapping and efficient line queries
    pub const Metrics = struct {
        total_width: u32 = 0,
        total_bytes: u32 = 0,
        linestart_count: u32 = 0,
        newline_count: u32 = 0,
        max_line_width: u32 = 0,
        /// Whether all text segments in subtree are ASCII-only (for fast wrapping paths)
        ascii_only: bool = true,

        pub fn add(self: *Metrics, other: Metrics) void {
            self.total_width += other.total_width;
            self.total_bytes += other.total_bytes;
            self.linestart_count += other.linestart_count;
            self.newline_count += other.newline_count;

            self.max_line_width = @max(self.max_line_width, other.max_line_width);

            self.ascii_only = self.ascii_only and other.ascii_only;
        }

        /// Get the balancing weight for the rope
        /// We use total_width + newline_count to give each break a weight of 1
        /// This eliminates boundary ambiguity in coordinate/offset conversions
        pub fn weight(self: *const Metrics) u32 {
            return self.total_width + self.newline_count;
        }
    };

    /// Measure this segment to produce its metrics
    pub fn measure(self: *const Segment) Metrics {
        return switch (self.*) {
            .text => |chunk| blk: {
                const is_ascii = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                const byte_len = chunk.byte_end - chunk.byte_start;
                break :blk Metrics{
                    .total_width = chunk.width,
                    .total_bytes = byte_len,
                    .linestart_count = 0,
                    .newline_count = 0,
                    .max_line_width = chunk.width,
                    .ascii_only = is_ascii,
                };
            },
            .brk => Metrics{
                .total_width = 0,
                .total_bytes = 0,
                .linestart_count = 0,
                .newline_count = 1,
                .max_line_width = 0,
                .ascii_only = true,
            },
            .linestart => Metrics{
                .total_width = 0,
                .total_bytes = 0,
                .linestart_count = 1,
                .newline_count = 0,
                .max_line_width = 0,
                .ascii_only = true,
            },
        };
    }

    pub fn empty() Segment {
        return .{ .text = TextChunk.empty() };
    }

    pub fn is_empty(self: *const Segment) bool {
        return switch (self.*) {
            .text => |chunk| chunk.is_empty(),
            .brk => false,
            .linestart => false,
        };
    }

    pub fn getBytes(self: *const Segment, mem_registry: *const MemRegistry) []const u8 {
        return switch (self.*) {
            .text => |chunk| chunk.getBytes(mem_registry),
            .brk => &[_]u8{},
            .linestart => &[_]u8{},
        };
    }

    pub fn isBreak(self: *const Segment) bool {
        return switch (self.*) {
            .brk => true,
            else => false,
        };
    }

    pub fn isLineStart(self: *const Segment) bool {
        return switch (self.*) {
            .linestart => true,
            else => false,
        };
    }

    pub fn isText(self: *const Segment) bool {
        return switch (self.*) {
            .text => true,
            else => false,
        };
    }

    pub fn asText(self: *const Segment) ?*const TextChunk {
        return switch (self.*) {
            .text => |*chunk| chunk,
            else => null,
        };
    }

    /// Boundary normalization action
    pub const BoundaryAction = struct {
        delete_left: bool = false,
        delete_right: bool = false,
        insert_between: []const Segment = &[_]Segment{},
    };

    /// Rewrite boundary between two adjacent segments to enforce invariants
    ///
    /// Document invariants enforced at join boundaries:
    /// - Every line starts with a linestart marker
    /// - Line breaks must be followed by linestart markers
    /// - No duplicate linestart markers (deduplicated automatically)
    /// - When joining lines, orphaned linestart markers are removed
    /// - Empty lines are represented as [linestart, brk] with no text, or [linestart] if final
    /// - Consecutive breaks [brk, brk] get a linestart inserted between (empty line)
    ///
    /// Rules applied locally at O(log n) join points:
    /// - [linestart, linestart] → delete right (dedup)
    /// - [brk, text] → insert linestart between (ensure line starts with marker)
    /// - [brk, brk] → insert linestart between (represents empty line)
    /// - [text, linestart] → delete right (remove orphaned linestart when joining lines)
    ///
    /// Valid patterns (no action needed):
    /// - [text, brk] (line content followed by break)
    /// - [linestart, text] (line marker followed by content)
    /// - [linestart, brk] (empty line before another line)
    /// - [linestart] alone (empty final line or empty buffer)
    /// - [brk, linestart, brk] (empty line between two lines, normalized from [brk, brk])
    ///
    /// These rules preserve linestart markers when deleting at col=0 within a line,
    /// since the deletion splits around the marker, and [text, linestart] only triggers
    /// when actually joining lines (deleting the break between them).
    pub fn rewriteBoundary(allocator: Allocator, left: ?*const Segment, right: ?*const Segment) !BoundaryAction {
        _ = allocator;

        if (left == null or right == null) return .{};

        const left_seg = left.?;
        const right_seg = right.?;

        // [linestart, linestart] -> delete right (dedup)
        if (left_seg.isLineStart() and right_seg.isLineStart()) {
            return .{ .delete_right = true };
        }

        // [brk, brk] -> insert linestart between (represents empty line)
        if (left_seg.isBreak() and right_seg.isBreak()) {
            const linestart_segment = Segment{ .linestart = {} };
            const insert_slice = &[_]Segment{linestart_segment};
            return .{ .insert_between = insert_slice };
        }

        // [brk, text] -> insert linestart between
        if (left_seg.isBreak() and right_seg.isText()) {
            const linestart_segment = Segment{ .linestart = {} };
            const insert_slice = &[_]Segment{linestart_segment};
            return .{ .insert_between = insert_slice };
        }

        // [text, linestart] -> delete right (remove orphaned linestart when joining lines)
        if (left_seg.isText() and right_seg.isLineStart()) {
            return .{ .delete_right = true };
        }

        return .{};
    }

    /// Rewrite rope ends to enforce invariants
    /// Rules:
    /// - Rope must start with linestart (or be empty)
    /// - Rope must not end with brk (trailing breaks are invalid)
    pub fn rewriteEnds(allocator: Allocator, first: ?*const Segment, last: ?*const Segment) !BoundaryAction {
        _ = allocator;

        // Ensure rope starts with linestart
        if (first) |first_seg| {
            if (!first_seg.isLineStart()) {
                const linestart_segment = Segment{ .linestart = {} };
                const insert_slice = &[_]Segment{linestart_segment};
                return .{ .insert_between = insert_slice };
            }
        }

        // Remove trailing break
        // TODO: Really?
        if (last) |last_seg| {
            if (last_seg.isBreak()) {
                return .{ .delete_right = true };
            }
        }

        return .{};
    }
};

/// Unified rope type for text buffer - stores text segments and break markers in a single tree
pub const UnifiedRope = rope_mod.Rope(Segment);
