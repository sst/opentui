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
    char,
    word,
};

pub const ChunkFitResult = struct {
    char_count: u32,
    width: u32,
};

/// Cached grapheme cluster information
pub const GraphemeInfo = struct {
    byte_offset: u32, // Offset within the chunk's bytes
    byte_len: u8, // Length in UTF-8 bytes
    width: u8, // Display width (1, 2, etc.)
};

/// Memory buffer reference in the registry
pub const MemBuffer = struct {
    data: []const u8,
    owned: bool, // Whether this buffer should be freed on deinit
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

    /// Register a memory buffer and return its ID
    pub fn register(self: *MemRegistry, data: []const u8, owned: bool) TextBufferError!u8 {
        if (self.buffers.items.len >= 255) {
            return TextBufferError.OutOfMemory; // Max 255 buffers with u8 ID
        }
        const id: u8 = @intCast(self.buffers.items.len);
        try self.buffers.append(self.allocator, MemBuffer{
            .data = data,
            .owned = owned,
        });
        return id;
    }

    /// Get buffer by ID
    pub fn get(self: *const MemRegistry, id: u8) ?[]const u8 {
        if (id >= self.buffers.items.len) return null;
        return self.buffers.items[id].data;
    }

    /// Clear all registered buffers
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
    mem_id: u8, // ID of the memory buffer this chunk references
    byte_start: u32, // Offset into the memory buffer
    byte_end: u32, // End offset into the memory buffer
    width: u16, // Display width in cells (computed once)
    flags: u8 = 0, // Bitflags for chunk properties
    graphemes: ?[]GraphemeInfo = null, // Lazy grapheme buffer (computed on first access, reused by views)
    wrap_offsets: ?[]utf8.WrapBreak = null, // Lazy wrap offset buffer (computed on first access)

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
    pub fn getGraphemes(
        self: *const TextChunk,
        mem_registry: *const MemRegistry,
        allocator: Allocator,
        graphemes_data: *const Graphemes,
        width_method: gwidth.WidthMethod,
        display_width: *const DisplayWidth,
    ) TextBufferError![]const GraphemeInfo {
        // Need to cast to mutable to cache the graphemes
        const mut_self = @constCast(self);
        if (self.graphemes) |cached| {
            return cached;
        }

        const chunk_bytes = self.getBytes(mem_registry);
        var grapheme_list = std.ArrayList(GraphemeInfo).init(allocator);
        defer grapheme_list.deinit();

        var iter = graphemes_data.iterator(chunk_bytes);
        var byte_pos: u32 = 0;

        while (iter.next()) |gc| {
            const gbytes = gc.bytes(chunk_bytes);
            const width_u16: u16 = gwidth.gwidth(gbytes, width_method, display_width);

            if (width_u16 == 0) {
                byte_pos += @intCast(gbytes.len);
                continue;
            }

            const width: u8 = @intCast(width_u16);

            try grapheme_list.append(GraphemeInfo{
                .byte_offset = byte_pos,
                .byte_len = @intCast(gbytes.len),
                .width = width,
            });

            byte_pos += @intCast(gbytes.len);
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
    col_start: u32, // Column start (in grapheme/display units)
    col_end: u32, // Column end (in grapheme/display units)
    style_id: u32, // ID into SyntaxStyle
    priority: u8, // Higher priority wins for overlaps
    hl_ref: ?u16, // Optional reference for bulk removal
};

/// Pre-computed style span for efficient rendering
/// Represents a contiguous region with a single style
pub const StyleSpan = struct {
    col: u32, // Starting column
    style_id: u32, // Style to use (0 = use default)
    next_col: u32, // Column where next style change happens
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
        /// Total display width (sum of all text segments, breaks contribute 0)
        total_width: u32 = 0,

        /// Number of line break markers in the subtree
        break_count: u32 = 0,

        /// Number of linestart markers in the subtree
        linestart_count: u32 = 0,

        /// Display width from start of subtree to first break (or total if no breaks)
        first_line_width: u32 = 0,

        /// Display width from last break to end of subtree (or total if no breaks)
        last_line_width: u32 = 0,

        /// Maximum line width in the entire subtree
        /// For internal nodes, this is max(left.max, right.max, left.last + right.first)
        max_line_width: u32 = 0,

        /// Whether all text segments in subtree are ASCII-only (for fast wrapping paths)
        ascii_only: bool = true,

        /// Combine metrics from two child nodes
        /// This is called when building internal rope nodes
        pub fn add(self: *Metrics, other: Metrics) void {
            // Save original state for boundary calculation
            const left_break_count = self.break_count;
            const left_last_width = self.last_line_width;
            const right_first_width = other.first_line_width;

            self.total_width += other.total_width;
            self.break_count += other.break_count;
            self.linestart_count += other.linestart_count;

            // first_line_width: if left has no breaks, combine left + right first line
            // Otherwise, left's first line is already complete
            if (left_break_count == 0) {
                self.first_line_width = self.first_line_width + other.first_line_width;
            }
            // else: self.first_line_width stays as is (left's first line ends at left's first break)

            // last_line_width: if right has breaks, use right's last line width
            // Otherwise, combine left's last line with right's total width
            if (other.break_count > 0) {
                self.last_line_width = other.last_line_width;
            } else {
                self.last_line_width = self.last_line_width + other.last_line_width;
            }

            // max_line_width: max of left's max, right's max, and potentially the combined/boundary width
            if (left_break_count == 0 and other.break_count == 0) {
                // No breaks anywhere - single line, use combined width
                self.max_line_width = self.first_line_width; // Already combined above
            } else {
                // At least one break exists - check boundary
                const boundary_width = if (left_break_count > 0)
                    left_last_width + right_first_width
                else
                    0; // Left has no breaks, so no boundary to join

                self.max_line_width = @max(
                    @max(self.max_line_width, other.max_line_width),
                    boundary_width,
                );
            }

            // ascii_only: only true if both subtrees are ASCII-only
            self.ascii_only = self.ascii_only and other.ascii_only;
        }

        /// Get the balancing weight for the rope
        /// We use total_width as the weight metric
        pub fn weight(self: *const Metrics) u32 {
            return self.total_width;
        }
    };

    /// Measure this segment to produce its metrics
    pub fn measure(self: *const Segment) Metrics {
        return switch (self.*) {
            .text => |chunk| blk: {
                const is_ascii = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0;
                break :blk Metrics{
                    .total_width = chunk.width,
                    .break_count = 0,
                    .linestart_count = 0,
                    .first_line_width = chunk.width,
                    .last_line_width = chunk.width,
                    .max_line_width = chunk.width,
                    .ascii_only = is_ascii,
                };
            },
            .brk => Metrics{
                .total_width = 0,
                .break_count = 1,
                .linestart_count = 0,
                .first_line_width = 0,
                .last_line_width = 0,
                .max_line_width = 0,
                .ascii_only = true,
            },
            .linestart => Metrics{
                .total_width = 0,
                .break_count = 0,
                .linestart_count = 1,
                .first_line_width = 0,
                .last_line_width = 0,
                .max_line_width = 0,
                .ascii_only = true,
            },
        };
    }

    /// Create an empty segment (used by rope for initialization)
    pub fn empty() Segment {
        return .{ .text = TextChunk.empty() };
    }

    /// Check if this segment is empty
    pub fn is_empty(self: *const Segment) bool {
        return switch (self.*) {
            .text => |chunk| chunk.is_empty(),
            .brk => false, // Breaks are never "empty" - they represent a line boundary
            .linestart => false, // Linestart markers are never "empty" - they represent a line start
        };
    }

    /// Get the bytes for this segment (empty for breaks and linestart)
    pub fn getBytes(self: *const Segment, mem_registry: *const MemRegistry) []const u8 {
        return switch (self.*) {
            .text => |chunk| chunk.getBytes(mem_registry),
            .brk => &[_]u8{},
            .linestart => &[_]u8{},
        };
    }

    /// Check if this is a break segment
    pub fn isBreak(self: *const Segment) bool {
        return switch (self.*) {
            .brk => true,
            else => false,
        };
    }

    /// Check if this is a linestart segment
    pub fn isLineStart(self: *const Segment) bool {
        return switch (self.*) {
            .linestart => true,
            else => false,
        };
    }

    /// Check if this is a text segment
    pub fn isText(self: *const Segment) bool {
        return switch (self.*) {
            .text => true,
            else => false,
        };
    }

    /// Get the text chunk if this is a text segment, null otherwise
    pub fn asText(self: *const Segment) ?*const TextChunk {
        return switch (self.*) {
            .text => |*chunk| chunk,
            else => null,
        };
    }
};

/// Helper to combine metrics (same logic as Metrics.add but pure function)
pub fn combineMetrics(left: Segment.Metrics, right: Segment.Metrics) Segment.Metrics {
    var result = left;
    result.add(right);
    return result;
}

/// Unified rope type for text buffer - stores text segments and break markers in a single tree
pub const UnifiedRope = rope_mod.Rope(Segment);
