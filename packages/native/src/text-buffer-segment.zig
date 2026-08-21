const std = @import("std");
const Allocator = std.mem.Allocator;
const rope_mod = @import("rope.zig");
const buffer = @import("buffer.zig");
const mem_registry_mod = @import("mem-registry.zig");

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

const MemRegistry = mem_registry_mod.MemRegistry;

pub const WrapMode = enum {
    none,
    char,
    word,
};

pub const GraphemeInfo = utf8.GraphemeInfo;
pub const ChunkLayoutInfo = utf8.ChunkLayoutInfo;

const CachedMeasure = struct {
    wrap_width: u32,
    first_width: u32,
    tab_width: u8,
    width_method: utf8.WidthMethod,
    result: WordMeasureSummary,
};

pub const TextChunkColdState = struct {
    graphemes: ?[]GraphemeInfo = null,
    graphemes_capacity: usize = 0,
    graphemes_tab_width: ?u8 = null,
    graphemes_width_method: ?utf8.WidthMethod = null,
    wrap_breaks: ?[]utf8.LayoutWrapBreak = null,
    wrap_breaks_capacity: usize = 0,
    wrap_breaks_tab_width: ?u8 = null,
    wrap_breaks_width_method: ?utf8.WidthMethod = null,
    word_classes: utf8.WordClassEdges = .{ .first = .other, .last = .other },
    measure_word: ?CachedMeasure = null,
};

pub const WordMeasureSummary = struct {
    line_count: u32,
    width_max: u32,
};

/// A chunk represents a contiguous sequence of UTF-8 bytes from a specific memory buffer
pub const TextChunk = struct {
    mem_id: u8,
    byte_start: u32,
    byte_end: u32,
    width: u32,
    flags: u8 = 0,
    cold: ?*TextChunkColdState = null,

    pub const Flags = struct {
        pub const ASCII_ONLY: u8 = 0b00000001; // Printable ASCII only (32..126).
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

    fn getOrCreateCold(self: *const TextChunk, allocator: Allocator) TextBufferError!*TextChunkColdState {
        if (self.cold) |cold| return cold;
        const cold = allocator.create(TextChunkColdState) catch return TextBufferError.OutOfMemory;
        cold.* = .{};
        @constCast(self).cold = cold;
        return cold;
    }

    pub fn getCachedLayoutInfo(
        self: *const TextChunk,
        tabwidth: u8,
        width_method: utf8.WidthMethod,
    ) ?ChunkLayoutInfo {
        const cold = self.cold orelse return null;
        const cached = cold.wrap_breaks orelse return null;
        if (cold.wrap_breaks_tab_width != tabwidth or cold.wrap_breaks_width_method != width_method) return null;
        return .{
            .wrap_breaks = cached,
            .word_classes = cold.word_classes,
        };
    }

    pub fn getWordMeasureSummary(
        self: *const TextChunk,
        wrap_width: u32,
        first_width: u32,
        tab_width: u8,
        width_method: utf8.WidthMethod,
    ) ?WordMeasureSummary {
        const cold = self.cold orelse return null;
        const cached = cold.measure_word orelse return null;
        if (cached.wrap_width != wrap_width or
            cached.first_width != first_width or
            cached.tab_width != tab_width or
            cached.width_method != width_method) return null;
        return cached.result;
    }

    pub fn setWordMeasureSummary(
        self: *const TextChunk,
        allocator: Allocator,
        wrap_width: u32,
        first_width: u32,
        tab_width: u8,
        width_method: utf8.WidthMethod,
        summary: WordMeasureSummary,
    ) TextBufferError!void {
        const cold = try self.getOrCreateCold(allocator);
        cold.measure_word = .{
            .wrap_width = wrap_width,
            .first_width = first_width,
            .tab_width = tab_width,
            .width_method = width_method,
            .result = summary,
        };
    }

    /// Lazily compute and cache grapheme info for this chunk
    /// Returns a slice that is valid until the buffer is reset
    /// For ASCII-only chunks, returns an empty slice (sentinel)
    /// For mixed chunks, returns only multibyte (non-ASCII) graphemes and tabs with their column offsets
    pub fn getGraphemes(
        self: *const TextChunk,
        allocator: Allocator,
        mem_registry: *const MemRegistry,
        tabwidth: u8,
        width_method: utf8.WidthMethod,
    ) TextBufferError![]const GraphemeInfo {
        if (self.isAsciiOnly()) return &[_]GraphemeInfo{};

        const cold = try self.getOrCreateCold(allocator);
        if (cold.graphemes) |cached| {
            if (cold.graphemes_tab_width == tabwidth and cold.graphemes_width_method == width_method) {
                return cached;
            }

            var reusable: std.ArrayListUnmanaged(GraphemeInfo) = .{
                .items = cached,
                .capacity = cold.graphemes_capacity,
            };
            reusable.clearRetainingCapacity();
            try utf8.findGraphemeInfo(allocator, self.getBytes(mem_registry), tabwidth, self.isAsciiOnly(), width_method, &reusable);
            cold.graphemes = reusable.items;
            cold.graphemes_capacity = reusable.capacity;
            cold.graphemes_tab_width = tabwidth;
            cold.graphemes_width_method = width_method;
            return reusable.items;
        }

        const chunk_bytes = self.getBytes(mem_registry);

        var grapheme_list: std.ArrayListUnmanaged(GraphemeInfo) = .empty;
        errdefer grapheme_list.deinit(allocator);

        try utf8.findGraphemeInfo(allocator, chunk_bytes, tabwidth, self.isAsciiOnly(), width_method, &grapheme_list);

        cold.graphemes = grapheme_list.items;
        cold.graphemes_capacity = grapheme_list.capacity;
        cold.graphemes_tab_width = tabwidth;
        cold.graphemes_width_method = width_method;
        return grapheme_list.items;
    }

    /// Lazily compute and cache direct byte/column wrap metadata for this chunk.
    pub fn getLayoutInfo(
        self: *const TextChunk,
        allocator: Allocator,
        mem_registry: *const MemRegistry,
        tabwidth: u8,
        width_method: utf8.WidthMethod,
    ) TextBufferError!ChunkLayoutInfo {
        const cold = try self.getOrCreateCold(allocator);
        if (cold.wrap_breaks) |cached| {
            if (cold.wrap_breaks_tab_width == tabwidth and cold.wrap_breaks_width_method == width_method) {
                return .{
                    .wrap_breaks = cached,
                    .word_classes = cold.word_classes,
                };
            }

            if (cold.wrap_breaks_width_method == width_method) {
                var reusable: std.ArrayListUnmanaged(utf8.LayoutWrapBreak) = .{
                    .items = cached,
                    .capacity = cold.wrap_breaks_capacity,
                };
                reusable.clearRetainingCapacity();
                const word_classes = try utf8.findChunkLayoutInfo(
                    allocator,
                    self.getBytes(mem_registry),
                    tabwidth,
                    self.isAsciiOnly(),
                    width_method,
                    &reusable,
                );
                cold.wrap_breaks = reusable.items;
                cold.wrap_breaks_capacity = reusable.capacity;
                cold.wrap_breaks_tab_width = tabwidth;
                cold.word_classes = word_classes;
                return .{
                    .wrap_breaks = reusable.items,
                    .word_classes = word_classes,
                };
            }
        }

        const chunk_bytes = self.getBytes(mem_registry);
        var wrap_breaks: std.ArrayListUnmanaged(utf8.LayoutWrapBreak) = .empty;
        errdefer wrap_breaks.deinit(allocator);

        const word_classes = try utf8.findChunkLayoutInfo(allocator, chunk_bytes, tabwidth, self.isAsciiOnly(), width_method, &wrap_breaks);

        const cached: []utf8.LayoutWrapBreak = if (wrap_breaks.items.len > 0) wrap_breaks.items else @constCast(&[_]utf8.LayoutWrapBreak{});
        cold.wrap_breaks = cached;
        cold.wrap_breaks_capacity = wrap_breaks.capacity;
        cold.wrap_breaks_tab_width = tabwidth;
        cold.wrap_breaks_width_method = width_method;
        cold.word_classes = word_classes;

        return .{
            .wrap_breaks = cached,
            .word_classes = word_classes,
        };
    }
};

/// A highlight represents a styled region on a line
pub const Highlight = struct {
    col_start: u32,
    col_end: u32,
    style_id: u32,
    priority: u8,
    hl_ref: u16 = 0,
    internal: bool = false,
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

    /// Two text chunks can be merged if they reference contiguous memory in the same buffer
    pub fn canMerge(left: *const Segment, right: *const Segment) bool {
        if (!left.isText() or !right.isText()) return false;

        const left_chunk = left.asText() orelse return false;
        const right_chunk = right.asText() orelse return false;

        if (left_chunk.mem_id != right_chunk.mem_id) return false;
        if (left_chunk.byte_end != right_chunk.byte_start) return false;
        if (left_chunk.flags != right_chunk.flags) return false;

        return true;
    }

    pub fn merge(allocator: Allocator, left: *const Segment, right: *const Segment) Segment {
        _ = allocator;

        const left_chunk = left.asText().?;
        const right_chunk = right.asText().?;

        // TODO: could clear the caches on the original chunks,
        // as the original chunks are only kept for history purposes.

        return .{
            .text = TextChunk{
                .mem_id = left_chunk.mem_id,
                .byte_start = left_chunk.byte_start,
                .byte_end = right_chunk.byte_end,
                .width = left_chunk.width + right_chunk.width,
                .flags = left_chunk.flags,
            },
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
            const linestart_segment: Segment = .{ .linestart = {} };
            const insert_slice = &[_]Segment{linestart_segment};
            return .{ .insert_between = insert_slice };
        }

        // [brk, text] -> insert linestart between
        if (left_seg.isBreak() and right_seg.isText()) {
            const linestart_segment: Segment = .{ .linestart = {} };
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
    /// - Rope must start with linestart (even when empty - ensures at least one line)
    pub fn rewriteEnds(allocator: Allocator, first: ?*const Segment, last: ?*const Segment) !BoundaryAction {
        _ = allocator;
        _ = last;

        // Ensure rope starts with linestart (insert even if empty)
        if (first) |first_seg| {
            if (!first_seg.isLineStart()) {
                const linestart_segment: Segment = .{ .linestart = {} };
                const insert_slice = &[_]Segment{linestart_segment};
                return .{ .insert_between = insert_slice };
            }
        } else {
            // Empty rope - insert linestart to ensure at least one line
            const linestart_segment: Segment = .{ .linestart = {} };
            const insert_slice = &[_]Segment{linestart_segment};
            return .{ .insert_between = insert_slice };
        }

        return .{};
    }
};

pub const UnifiedRope = rope_mod.Rope(Segment);
