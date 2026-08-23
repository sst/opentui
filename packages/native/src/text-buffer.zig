const std = @import("std");
const builtin = @import("builtin");
const io = if (builtin.is_test) std.testing.io else @import("root").io;
const Allocator = std.mem.Allocator;
const seg_mod = @import("text-buffer-segment.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const mem_registry_mod = @import("mem-registry.zig");
const ss = @import("syntax-style.zig");
const gp = @import("grapheme.zig");
const ansi = @import("ansi.zig");
const link = @import("link.zig");
const TextAnnotations = @import("text-annotations.zig").TextAnnotations;

const utf8 = @import("utf8.zig");
const utils = @import("utils.zig");

const logger = @import("logger.zig");

const Segment = seg_mod.Segment;
const UnifiedRope = seg_mod.UnifiedRope;
const LineInfo = iter_mod.LineInfo;

// Re-export types from segment module
pub const TextChunk = seg_mod.TextChunk;
pub const MemRegistry = mem_registry_mod.MemRegistry;
pub const RGBA = seg_mod.RGBA;
pub const TextSelection = seg_mod.TextSelection;
pub const TextBufferError = seg_mod.TextBufferError;
pub const Highlight = seg_mod.Highlight;
pub const StyleSpan = seg_mod.StyleSpan;
pub const WrapMode = seg_mod.WrapMode;
pub const ChunkFitResult = seg_mod.ChunkFitResult;
pub const GraphemeInfo = seg_mod.GraphemeInfo;

/// Byte coordinate in the normalized UTF-8 document exposed by getPlainText.
/// Every logical line break occupies one byte, regardless of its source spelling.
pub const NormalizedByteOffset = u32;

pub const NormalizedByteRange = struct {
    start: NormalizedByteOffset,
    end: NormalizedByteOffset,
};

pub const DisplayPoint = struct {
    row: u32,
    col: u32,
};

pub const BoundaryAffinity = utf8.BoundaryAffinity;

pub const NormalizedByteLocation = struct {
    row: u32,
    byte_in_line: u32,
};

pub const DisplayBoundary = struct {
    point: DisplayPoint,
    exact: bool,
};

pub const DisplayRange = struct {
    start: DisplayBoundary,
    end: DisplayBoundary,
};

pub const DisplayExtent = struct {
    rows: u32,
    columns: u32,
};

/// Rope content and content_epoch change together on success. Byte annotations
/// follow the edit. External line highlights, selections, view-local state,
/// EditBuffer cursors, and undo checkpoints remain caller-owned.
pub const SpliceResult = struct {
    old_range: NormalizedByteRange,
    /// Length of replacement after CR/LF/CRLF normalization.
    inserted_len: u32,
    /// old_range.start + inserted_len in the new normalized document.
    new_end: NormalizedByteOffset,
    old_display: DisplayRange,
    new_display: DisplayRange,
    old_extent: DisplayExtent,
    new_extent: DisplayExtent,
};

pub const SyntaxStyle = ss.SyntaxStyle;

pub const TextBuffer = UnifiedTextBuffer;

/// A styled text chunk passed from TypeScript across the FFI boundary.
/// Each chunk carries raw text bytes, optional packed RGBA colors, text
/// attributes, and an optional hyperlink URL.
///
/// The color pointers point to 4 consecutive u16 values in the packed RGBA
/// format defined by ansi.zig. Use utils.ptrToRGBA to read them.
pub const StyledChunk = extern struct {
    text_ptr: [*]const u8,
    text_len: usize,
    /// Optional foreground color as 4 packed u16 values (see ansi.RGBA).
    fg_ptr: ?[*]const u16,
    /// Optional background color as 4 packed u16 values (see ansi.RGBA).
    bg_ptr: ?[*]const u16,
    attributes: u32,
    style_id: u32 = 0,
    style_kind: StyleKind = .value,
    syntax_style: ?*const SyntaxStyle = null,
    link_ptr: ?[*]const u8 = null,
    link_len: usize = 0,
};

fn styleValuePaints(chunk: StyledChunk) bool {
    return chunk.style_kind == .registered or chunk.fg_ptr != null or chunk.bg_ptr != null or
        chunk.attributes != 0 or chunk.link_len != 0;
}

pub const StyleKind = enum(u32) {
    value = 0,
    registered = 1,
};

pub const DocumentRangeInput = struct {
    id: u64 = 0,
    remove: bool = false,
    start_chunk: u32,
    end_chunk: u32,
    style: StyledChunk,
    styled: bool,
    priority: u8,
};

pub const DocumentRange = struct {
    id: u64,
    owner: u32,
    start_byte: u32,
    end_byte: u32,
    styled: bool,
};

pub const DocumentOperationKind = enum {
    replace,
    update_style,
    move,
    remove,
    clear_owner,
};

pub const DocumentOperation = struct {
    kind: DocumentOperationKind,
    target_id: u64 = 0,
    anchor_id: u64 = 0,
    use_target: bool = true,
    target_mode: enum { replace, before, after } = .replace,
    start_byte: u32 = 0,
    end_byte: u32 = 0,
    owner: u32 = 0,
    chunks: []const StyledChunk = &.{},
    ranges: []const DocumentRangeInput = &.{},
    style: StyledChunk = .{ .text_ptr = "".ptr, .text_len = 0, .fg_ptr = null, .bg_ptr = null, .attributes = 0 },
    before: bool = false,
};

pub const annotation_kind_style: u32 = 1 << 0;
const annotation_kind_document: u32 = 1 << 1;
pub const annotation_kind_virtual: u32 = 1 << 2;

pub const AnnotationOperationKind = enum {
    add_range,
    add_point,
    update_range,
    update_point,
    update_payload,
    remove,
    clear_namespace,
};

pub const AnnotationOperation = struct {
    kind: AnnotationOperationKind,
    id: u64 = 0,
    start_byte: u32 = 0,
    end_byte: u32 = 0,
    start_gravity: TextAnnotations.Gravity = .right,
    end_gravity: TextAnnotations.Gravity = .left,
    payload: TextAnnotations.PayloadInput = .{ .namespace = 0 },
};

pub const AnnotationBatchResult = struct {
    created_count: usize,
    deleted_count: usize,
};

const InternalStyleSlot = struct {
    definition: ss.StyleDefinition,
    resolved_syntax_style: ?*const SyntaxStyle,
    resolved_style_id: u32,
    link_url: ?[]u8,
    link_id: u32,
    refs: u32,
};

pub const UnifiedTextBuffer = struct {
    const Self = UnifiedTextBuffer;
    const styled_text_owner: u32 = std.math.maxInt(u32);
    const style_range_kind = annotation_kind_style;
    const document_range_kind = annotation_kind_document;
    pub const internal_style_base: u32 = 0x8000_0000;
    pub const rope_compaction_arena_limit: usize = 32;
    pub const rope_compaction_byte_limit: usize = 8 * 1024 * 1024;
    pub const backing_compaction_block_limit: usize = 64;

    mem_registry: MemRegistry,
    default_fg: ?RGBA,
    default_bg: ?RGBA,
    default_attributes: ?u32,

    allocator: Allocator,
    global_allocator: Allocator,
    arena: *std.heap.ArenaAllocator,
    rope_transaction_arenas: std.ArrayListUnmanaged(*std.heap.ArenaAllocator),

    _rope: UnifiedRope,
    empty_rope_root: *const UnifiedRope.Node,
    empty_rope_leaf: *const UnifiedRope.Node,
    syntax_style: ?*const SyntaxStyle,

    pool: *gp.GraphemePool,
    link_pool: *link.LinkPool,
    link_tracker: ?link.LinkTracker,
    internal_style_slots: std.ArrayListUnmanaged(InternalStyleSlot),

    width_method: utf8.WidthMethod,

    view_dirty_flags: std.ArrayListUnmanaged(bool),
    next_view_id: u32,
    free_view_ids: std.ArrayListUnmanaged(u32),

    /// Monotonic counter that increments on every content change. Views use this
    /// to detect stale caches even after clearViewDirty() runs.
    content_epoch: u64,
    /// Changes for annotation-only paint mutations without invalidating layout.
    annotation_epoch: u64,
    annotations: TextAnnotations,

    // Per-line highlight cache (invalidated on edits)
    // Maps line_idx to highlights for that line
    external_line_highlights: std.ArrayListUnmanaged(std.ArrayListUnmanaged(Highlight)),
    line_highlights: std.ArrayListUnmanaged(std.ArrayListUnmanaged(Highlight)),
    line_spans: std.ArrayListUnmanaged(std.ArrayListUnmanaged(StyleSpan)),
    line_projection_epochs: std.ArrayListUnmanaged(u64),
    projection_epoch: u64,
    internal_highlight_count: usize,
    highlight_batch_depth: u32,
    dirty_span_lines: std.AutoHashMap(usize, void),

    // Immutable blocks owned by committed Rope roots. A block is never replaced
    // while a root can reference it; unreachable blocks are swept after commit.
    owned_backing_ids: [255]bool,
    storage_compaction_requested: bool,
    edit_storage_guard_depth: u32,

    tab_width: u8,

    segment_splitter: UnifiedRope.Node.LeafSplitFn,
    byte_splitter: UnifiedRope.Node.MetricSplitFn,

    pub const Defaults = struct {
        fg: ?RGBA,
        bg: ?RGBA,
        attributes: ?u32,
    };

    /// Accessor: return default fg/bg/attributes as a struct.
    pub fn defaults(self: *const Self) Defaults {
        return .{
            .fg = self.default_fg,
            .bg = self.default_bg,
            .attributes = self.default_attributes,
        };
    }

    /// Accessor: return a const pointer to the mem registry.
    pub fn memRegistry(self: *const Self) *const MemRegistry {
        return &self.mem_registry;
    }

    /// Accessor: return the width method.
    pub fn widthMethod(self: *const Self) utf8.WidthMethod {
        return self.width_method;
    }

    /// Accessor: return tab width.
    pub fn tabWidth(self: *const Self) u8 {
        return self.tab_width;
    }

    /// Accessor: return the internal allocator.
    pub fn getAllocator(self: *const Self) Allocator {
        return self.allocator;
    }

    /// Accessor: return pointer to the rope (for edit-path callers).
    /// Const-preserving: returns *UnifiedRope or *const UnifiedRope depending on receiver.
    pub fn rope(self: anytype) blk: {
        const T = @TypeOf(self);
        break :blk if (T == *Self) *UnifiedRope else if (T == *const Self) *const UnifiedRope else @compileError("expected *Self or *const Self");
    } {
        return &self._rope;
    }

    /// Accessor: get line width at a given row.
    pub fn lineWidthAt(self: *const Self, row: u32) u32 {
        return iter_mod.lineWidthAt(@constCast(&self._rope), row);
    }

    /// Accessor: get maximum line width across all lines.
    pub fn lineWidthColsMax(self: *const Self) u32 {
        return iter_mod.getMaxLineWidth(&self._rope);
    }

    pub fn getGraphemeWidthAt(self: *const Self, row: u32, col: u32) u32 {
        return iter_mod.getGraphemeWidthAt(@constCast(&self._rope), &self.mem_registry, row, col, self.tab_width, self.width_method);
    }

    pub fn getPrevGraphemeWidth(self: *const Self, row: u32, col: u32) u32 {
        return iter_mod.getPrevGraphemeWidth(@constCast(&self._rope), &self.mem_registry, row, col, self.tab_width, self.width_method);
    }

    pub fn textEndOffset(self: *const Self) u32 {
        return self._rope.totalWeight();
    }

    pub fn graphemeBoundsAtOffset(self: *const Self, offset: u32) ?struct { start: u32, end: u32 } {
        const rope_ptr = @constCast(&self._rope);
        const coords = iter_mod.offsetToCoords(rope_ptr, offset) orelse return null;
        const bounds = iter_mod.getGraphemeBoundsAt(
            rope_ptr,
            &self.mem_registry,
            coords.row,
            coords.col,
            self.tab_width,
            self.width_method,
        ) orelse return null;
        const line_start = offset - coords.col;
        return .{ .start = line_start + bounds.start, .end = line_start + bounds.end };
    }

    pub fn cursorUnitBoundsAtOffset(self: *const Self, offset: u32) ?struct { start: u32, end: u32 } {
        const rope_ptr = @constCast(&self._rope);
        const coords = iter_mod.offsetToCoords(rope_ptr, offset) orelse return null;
        const bounds = iter_mod.getCursorUnitBoundsAt(
            rope_ptr,
            &self.mem_registry,
            coords.row,
            coords.col,
            self.tab_width,
            self.width_method,
        ) orelse return null;
        const line_start = offset - coords.col;
        return .{ .start = line_start + bounds.start, .end = line_start + bounds.end };
    }

    pub fn getWrapOffsetsFor(self: *const Self, chunk: *const TextChunk) TextBufferError![]const utf8.WrapBreak {
        return chunk.getWrapOffsets(self.allocator, &self.mem_registry, self.width_method);
    }

    /// Accessor: walk all lines and segments via callbacks.
    pub fn walkLinesAndSegments(
        self: *const Self,
        ctx: *anyopaque,
        segment_callback: *const fn (ctx: *anyopaque, line_idx: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void,
        line_end_callback: *const fn (ctx: *anyopaque, line_info: LineInfo) void,
    ) void {
        iter_mod.walkLinesAndSegments(&self._rope, ctx, segment_callback, line_end_callback);
    }

    pub fn init(
        global_allocator: Allocator,
        pool: *gp.GraphemePool,
        link_pool: *link.LinkPool,
        width_method: utf8.WidthMethod,
    ) TextBufferError!*Self {
        const self = global_allocator.create(Self) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        errdefer global_allocator.destroy(internal_arena);
        internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const internal_allocator = internal_arena.allocator();

        const init_rope = UnifiedRope.init(internal_allocator) catch return TextBufferError.OutOfMemory;

        var view_dirty_flags: std.ArrayListUnmanaged(bool) = .empty;
        errdefer view_dirty_flags.deinit(global_allocator);

        var free_view_ids: std.ArrayListUnmanaged(u32) = .empty;
        errdefer free_view_ids.deinit(global_allocator);

        var mem_registry = MemRegistry.init(global_allocator);
        errdefer mem_registry.deinit();

        var dirty_span_lines = std.AutoHashMap(usize, void).init(global_allocator);
        errdefer dirty_span_lines.deinit();

        self.* = .{
            .mem_registry = mem_registry,
            .default_fg = null,
            .default_bg = null,
            .default_attributes = null,
            .allocator = internal_allocator,
            .global_allocator = global_allocator,
            .arena = internal_arena,
            .rope_transaction_arenas = .empty,
            ._rope = init_rope,
            .empty_rope_root = init_rope.root,
            .empty_rope_leaf = init_rope.empty_leaf,
            .syntax_style = null,
            .pool = pool,
            .link_pool = link_pool,
            .link_tracker = null,
            .internal_style_slots = .empty,
            .width_method = width_method,
            .view_dirty_flags = view_dirty_flags,
            .next_view_id = 0,
            .free_view_ids = free_view_ids,
            .content_epoch = 0,
            .annotation_epoch = 0,
            .annotations = TextAnnotations.init(global_allocator),
            .external_line_highlights = .empty,
            .line_highlights = .empty,
            .line_spans = .empty,
            .line_projection_epochs = .empty,
            .projection_epoch = 1,
            .internal_highlight_count = 0,
            .highlight_batch_depth = 0,
            .dirty_span_lines = dirty_span_lines,
            .owned_backing_ids = [_]bool{false} ** 255,
            .storage_compaction_requested = false,
            .edit_storage_guard_depth = 0,
            .tab_width = 2,
            .segment_splitter = .{ .ctx = self, .splitFn = splitSegmentCallback },
            .byte_splitter = .{
                .ctx = self,
                .metricFn = normalizedBytesForMetrics,
                .splitFn = splitSegmentAtNormalizedByte,
            },
        };

        return self;
    }

    pub fn deinit(self: *Self) void {
        const global_allocator = self.global_allocator;
        defer global_allocator.destroy(self);

        if (self.syntax_style) |style| {
            (@constCast(style)).offDestroy(@ptrCast(self), onSyntaxStyleDestroyed);
        }

        self.view_dirty_flags.deinit(self.global_allocator);
        self.free_view_ids.deinit(self.global_allocator);
        self.annotations.deinit();

        for (self.external_line_highlights.items) |*hl_list| {
            hl_list.deinit(self.global_allocator);
        }
        self.external_line_highlights.deinit(self.global_allocator);

        // Free highlight/span caches
        for (self.line_highlights.items) |*hl_list| {
            hl_list.deinit(self.global_allocator);
        }
        self.line_highlights.deinit(self.global_allocator);

        for (self.line_spans.items) |*span_list| {
            span_list.deinit(self.global_allocator);
        }
        self.line_spans.deinit(self.global_allocator);
        self.line_projection_epochs.deinit(self.global_allocator);

        // Free dirty span lines hashmap
        self.dirty_span_lines.deinit();

        if (self.link_tracker) |*tracker| {
            tracker.deinit();
        }
        for (self.internal_style_slots.items, 0..) |*slot, index| if (slot.refs != 0) {
            slot.refs = 1;
            self.releaseInternalStyle(internal_style_base | @as(u32, @intCast(index)));
        };
        self.internal_style_slots.deinit(self.global_allocator);

        self.mem_registry.deinit();
        self.releaseRopeTransactionArenas();
        self.rope_transaction_arenas.deinit(self.global_allocator);
        self.arena.deinit();
        global_allocator.destroy(self.arena);
        self.* = undefined;
    }

    // View registration (same as original)
    pub fn registerView(self: *Self) TextBufferError!u32 {
        if (self.free_view_ids.items.len > 0) {
            const id = self.free_view_ids.items[self.free_view_ids.items.len - 1];
            _ = self.free_view_ids.pop();
            self.view_dirty_flags.items[id] = true;
            return id;
        }

        const id = self.next_view_id;
        self.next_view_id += 1;
        try self.view_dirty_flags.append(self.global_allocator, true);
        return id;
    }

    pub fn unregisterView(self: *Self, view_id: u32) void {
        if (view_id < self.view_dirty_flags.items.len) {
            self.free_view_ids.append(self.global_allocator, view_id) catch {};
        }
    }

    pub fn isViewDirty(self: *const Self, view_id: u32) bool {
        if (view_id < self.view_dirty_flags.items.len) {
            return self.view_dirty_flags.items[view_id];
        }
        return false;
    }

    pub fn clearViewDirty(self: *Self, view_id: u32) void {
        if (view_id < self.view_dirty_flags.items.len) {
            self.view_dirty_flags.items[view_id] = false;
        }
    }

    /// Returns the current content epoch. Use this to detect buffer changes
    /// independent of the dirty flag (other code paths may clear dirty).
    pub fn getContentEpoch(self: *const Self) u64 {
        return self.content_epoch;
    }

    pub fn getAnnotationEpoch(self: *const Self) u64 {
        return self.annotation_epoch;
    }

    pub fn textAnnotations(self: *Self) *TextAnnotations {
        return &self.annotations;
    }

    /// Applies one annotation-only transaction. IDs deleted by explicit removes
    /// follow operation order; namespace clears use the MarkTree iterator order
    /// (lower byte, then native ID).
    pub fn applyAnnotationOperations(
        self: *Self,
        operations: []const AnnotationOperation,
        created_ids: []u64,
        deleted_ids: []u64,
    ) TextBufferError!AnnotationBatchResult {
        var created_count: usize = 0;
        for (operations) |operation| created_count += @intFromBool(operation.kind == .add_range or operation.kind == .add_point);
        if (created_ids.len < created_count) return TextBufferError.InvalidDimensions;
        if (operations.len == 0) return .{ .created_count = 0, .deleted_count = 0 };

        for (operations) |operation| switch (operation.kind) {
            .add_range, .update_range => {
                _ = try self.normalizedByteOffsetToLocation(operation.start_byte);
                _ = try self.normalizedByteOffsetToLocation(operation.end_byte);
            },
            .add_point, .update_point => _ = try self.normalizedByteOffsetToLocation(operation.start_byte),
            .update_payload, .remove, .clear_namespace => {},
        };

        if (operations.len == 1) switch (operations[0].kind) {
            .add_range => {
                const operation = operations[0];
                try self.retainInternalStyle(operation.payload.style_id);
                errdefer self.releaseInternalStyle(operation.payload.style_id);
                created_ids[0] = self.annotations.addRange(.{
                    .start_byte = operation.start_byte,
                    .end_byte = operation.end_byte,
                    .start_gravity = operation.start_gravity,
                    .end_gravity = operation.end_gravity,
                }, operation.payload) catch |err| return annotationMutationError(err);
                self.markPaintDirty();
                return .{ .created_count = 1, .deleted_count = 0 };
            },
            .add_point => {
                const operation = operations[0];
                try self.retainInternalStyle(operation.payload.style_id);
                errdefer self.releaseInternalStyle(operation.payload.style_id);
                created_ids[0] = self.annotations.addPoint(.{
                    .byte = operation.start_byte,
                    .gravity = operation.start_gravity,
                }, operation.payload) catch |err| return annotationMutationError(err);
                self.markPaintDirty();
                return .{ .created_count = 1, .deleted_count = 0 };
            },
            .remove => {
                const operation = operations[0];
                const existing = self.annotations.get(operation.id) orelse return .{ .created_count = 0, .deleted_count = 0 };
                if (deleted_ids.len < 1) return TextBufferError.InvalidDimensions;
                if (!(self.annotations.remove(operation.id) catch |err| return annotationMutationError(err))) return TextBufferError.InvalidIndex;
                self.releaseInternalStyle(existing.payload.style_id);
                deleted_ids[0] = operation.id;
                self.markPaintDirty();
                return .{ .created_count = 0, .deleted_count = 1 };
            },
            .update_range, .update_point, .update_payload, .clear_namespace => {},
        };

        var candidate = self.annotations.clone(self.global_allocator) catch return TextBufferError.OutOfMemory;
        var candidate_owned = true;
        defer if (candidate_owned) candidate.deinit();
        const prepared_created = self.global_allocator.alloc(u64, created_count) catch return TextBufferError.OutOfMemory;
        defer self.global_allocator.free(prepared_created);
        var prepared_deleted: std.ArrayListUnmanaged(u64) = .empty;
        defer prepared_deleted.deinit(self.global_allocator);

        var created_index: usize = 0;
        for (operations) |operation| switch (operation.kind) {
            .add_range => {
                prepared_created[created_index] = candidate.addRange(.{
                    .start_byte = operation.start_byte,
                    .end_byte = operation.end_byte,
                    .start_gravity = operation.start_gravity,
                    .end_gravity = operation.end_gravity,
                }, operation.payload) catch |err| return annotationMutationError(err);
                created_index += 1;
            },
            .add_point => {
                prepared_created[created_index] = candidate.addPoint(.{
                    .byte = operation.start_byte,
                    .gravity = operation.start_gravity,
                }, operation.payload) catch |err| return annotationMutationError(err);
                created_index += 1;
            },
            .update_range => if (!(candidate.updateRange(operation.id, .{
                .start_byte = operation.start_byte,
                .end_byte = operation.end_byte,
                .start_gravity = operation.start_gravity,
                .end_gravity = operation.end_gravity,
            }) catch |err| return annotationMutationError(err))) return TextBufferError.InvalidIndex,
            .update_point => if (!(candidate.updatePoint(operation.id, .{
                .byte = operation.start_byte,
                .gravity = operation.start_gravity,
            }) catch |err| return annotationMutationError(err))) return TextBufferError.InvalidIndex,
            .update_payload => if (!(candidate.updatePayload(operation.id, operation.payload) catch |err| return annotationMutationError(err))) return TextBufferError.InvalidIndex,
            .remove => {
                if (candidate.get(operation.id) == null) continue;
                prepared_deleted.append(self.global_allocator, operation.id) catch return TextBufferError.OutOfMemory;
                if (!(candidate.remove(operation.id) catch |err| return annotationMutationError(err))) return TextBufferError.InvalidIndex;
            },
            .clear_namespace => {
                var iterator = candidate.iterator();
                while (iterator.next() catch return TextBufferError.InvalidDimensions) |annotation| {
                    if (annotation.payload.namespace == operation.payload.namespace) {
                        prepared_deleted.append(self.global_allocator, annotation.id()) catch return TextBufferError.OutOfMemory;
                    }
                }
                _ = candidate.clearNamespace(operation.payload.namespace) catch |err| return annotationMutationError(err);
            },
        };
        if (deleted_ids.len < prepared_deleted.items.len) return TextBufferError.InvalidDimensions;

        candidate_owned = false;
        try self.publishAnnotationCandidate(candidate);
        @memcpy(created_ids[0..created_count], prepared_created);
        @memcpy(deleted_ids[0..prepared_deleted.items.len], prepared_deleted.items);
        return .{ .created_count = created_count, .deleted_count = prepared_deleted.items.len };
    }

    fn annotationMutationError(err: anyerror) TextBufferError {
        return switch (err) {
            error.OutOfMemory => TextBufferError.OutOfMemory,
            else => TextBufferError.InvalidDimensions,
        };
    }

    pub fn checkpointAnnotations(self: *Self) TextBufferError!TextAnnotations {
        var checkpoint = self.annotations.clone(self.global_allocator) catch return TextBufferError.OutOfMemory;
        errdefer checkpoint.deinit();
        if (self.internal_style_slots.items.len == 0) return checkpoint;
        var retained: std.ArrayListUnmanaged(u32) = .empty;
        defer retained.deinit(self.global_allocator);
        var it = checkpoint.iterator();
        while (it.next() catch return TextBufferError.InvalidDimensions) |annotation| {
            if (annotation.payload.style_id & internal_style_base == 0) continue;
            self.retainInternalStyle(annotation.payload.style_id) catch |err| {
                for (retained.items) |style_id| self.releaseInternalStyle(style_id);
                return err;
            };
            retained.append(self.global_allocator, annotation.payload.style_id) catch {
                self.releaseInternalStyle(annotation.payload.style_id);
                for (retained.items) |style_id| self.releaseInternalStyle(style_id);
                return TextBufferError.OutOfMemory;
            };
        }
        return checkpoint;
    }

    pub fn releaseAnnotationCheckpoint(self: *Self, checkpoint: *TextAnnotations) void {
        var it = checkpoint.iterator();
        while (it.next() catch null) |annotation| self.releaseInternalStyle(annotation.payload.style_id);
        checkpoint.deinit();
    }

    pub fn beginAnnotationEdit(self: *Self) TextBufferError!TextAnnotations {
        const candidate = try self.checkpointAnnotations();
        const previous = self.annotations;
        self.annotations = candidate;
        return previous;
    }

    pub fn rollbackAnnotationEdit(self: *Self, previous: TextAnnotations) void {
        var candidate = self.annotations;
        var annotations = candidate.iterator();
        while (annotations.next() catch null) |annotation| self.releaseInternalStyle(annotation.payload.style_id);
        candidate.deinit();
        self.annotations = previous;
    }

    pub fn swapAnnotationCheckpoint(self: *Self, checkpoint: TextAnnotations) TextAnnotations {
        const current = self.annotations;
        self.annotations = checkpoint;
        self.annotation_epoch +%= 1;
        self.projection_epoch +%= 1;
        return current;
    }

    pub fn purgeAnnotationCheckpoint(self: *Self, checkpoint: *TextAnnotations, ids: []const u64) void {
        for (ids) |id| {
            const annotation = checkpoint.get(id) orelse continue;
            const removed = checkpoint.remove(id) catch unreachable;
            std.debug.assert(removed);
            self.releaseInternalStyle(annotation.payload.style_id);
        }
    }

    /// Clear live annotations without releasing references owned by detached
    /// EditBuffer history checkpoints.
    pub fn clearAnnotations(self: *Self) void {
        var annotations = self.annotations.iterator();
        while (annotations.next() catch null) |annotation| self.releaseInternalStyle(annotation.payload.style_id);
        self.annotations.deinit();
        self.annotations = TextAnnotations.init(self.global_allocator);
        self.markPaintDirty();
    }

    fn publishAnnotationCandidate(self: *Self, candidate_value: TextAnnotations) TextBufferError!void {
        var candidate = candidate_value;
        errdefer candidate.deinit();
        var retained: std.ArrayListUnmanaged(u32) = .empty;
        defer retained.deinit(self.global_allocator);
        var removed: std.ArrayListUnmanaged(u32) = .empty;
        defer removed.deinit(self.global_allocator);

        var next = candidate.iterator();
        while (next.next() catch return TextBufferError.InvalidDimensions) |annotation| {
            const current = self.annotations.get(annotation.id());
            if (current == null or current.?.payload.style_id != annotation.payload.style_id) {
                self.retainInternalStyle(annotation.payload.style_id) catch |err| {
                    for (retained.items) |style_id| self.releaseInternalStyle(style_id);
                    return err;
                };
                retained.append(self.global_allocator, annotation.payload.style_id) catch {
                    self.releaseInternalStyle(annotation.payload.style_id);
                    for (retained.items) |style_id| self.releaseInternalStyle(style_id);
                    return TextBufferError.OutOfMemory;
                };
            }
        }
        errdefer for (retained.items) |style_id| self.releaseInternalStyle(style_id);

        var current = self.annotations.iterator();
        while (current.next() catch return TextBufferError.InvalidDimensions) |annotation| {
            const replacement = candidate.get(annotation.id());
            if (replacement == null or replacement.?.payload.style_id != annotation.payload.style_id) {
                try removed.append(self.global_allocator, annotation.payload.style_id);
            }
        }

        var old = self.annotations;
        self.annotations = candidate;
        old.deinit();
        for (removed.items) |style_id| self.releaseInternalStyle(style_id);
        self.markPaintDirty();
    }

    fn markAllViewsDirty(self: *Self) void {
        // Increment epoch first so views see the new value when checking caches.
        // Use wrapping add for safety, though u64 won't overflow in practice.
        self.content_epoch +%= 1;
        self.projection_epoch +%= 1;
        for (self.view_dirty_flags.items) |*flag| {
            flag.* = true;
        }
    }

    fn markTextBytesDirty(self: *Self) void {
        self.content_epoch +%= 1;
        for (self.view_dirty_flags.items) |*flag| flag.* = true;
    }

    fn markViewCachesDirty(self: *Self) void {
        for (self.view_dirty_flags.items) |*flag| flag.* = true;
    }

    fn markPaintDirty(self: *Self) void {
        self.annotation_epoch +%= 1;
        self.projection_epoch +%= 1;
    }

    pub fn markViewsDirty(self: *Self) void {
        self.markAllViewsDirty();
    }

    // Basic queries using unified rope
    pub fn getLength(self: *const Self) u32 {
        const metrics = self._rope.root.metrics();
        return metrics.custom.total_width;
    }

    pub fn getByteSize(self: *const Self) u32 {
        return normalizedBytesForMetrics(self._rope.root.metrics());
    }

    fn normalizedBytesForMetrics(metrics: UnifiedRope.Metrics) u32 {
        return metrics.custom.total_bytes + metrics.custom.newline_count;
    }

    fn normalizedByteRowInNode(self: *const Self, node: *const UnifiedRope.Node, byte_offset: u32, row_before: u32) TextBufferError!u32 {
        const node_bytes = normalizedBytesForMetrics(node.metrics());
        if (byte_offset > node_bytes) return TextBufferError.InvalidByteOffset;

        return switch (node.*) {
            .branch => |*branch| blk: {
                const left_bytes = normalizedBytesForMetrics(branch.left_metrics);
                if (byte_offset <= left_bytes) {
                    break :blk try self.normalizedByteRowInNode(branch.left, byte_offset, row_before);
                }
                break :blk try self.normalizedByteRowInNode(
                    branch.right,
                    byte_offset - left_bytes,
                    row_before +| branch.left_metrics.custom.newline_count,
                );
            },
            .leaf => |*leaf| switch (leaf.data) {
                .text => |chunk| blk: {
                    const bytes = chunk.getBytes(&self.mem_registry);
                    if (byte_offset > bytes.len) return TextBufferError.InvalidByteOffset;
                    if (!std.unicode.utf8ValidateSlice(bytes[0..byte_offset])) return TextBufferError.InvalidByteOffset;
                    break :blk row_before;
                },
                .brk => if (byte_offset == 0) row_before else if (byte_offset == 1) row_before +| 1 else TextBufferError.InvalidByteOffset,
                .linestart => if (byte_offset == 0) row_before else TextBufferError.InvalidByteOffset,
            },
        };
    }

    fn normalizedLineStartInNode(node: *const UnifiedRope.Node, newline_index: u32, bytes_before: u32) ?u32 {
        return switch (node.*) {
            .branch => |*branch| {
                const left_newlines = branch.left_metrics.custom.newline_count;
                if (newline_index < left_newlines) {
                    return normalizedLineStartInNode(branch.left, newline_index, bytes_before);
                }
                return normalizedLineStartInNode(
                    branch.right,
                    newline_index - left_newlines,
                    bytes_before +| normalizedBytesForMetrics(branch.left_metrics),
                );
            },
            .leaf => |*leaf| switch (leaf.data) {
                .brk => if (newline_index == 0) bytes_before +| 1 else null,
                else => null,
            },
        };
    }

    fn normalizedLineStart(self: *const Self, row: u32) TextBufferError!u32 {
        if (row >= self.getLineCount()) return TextBufferError.InvalidByteOffset;
        if (row == 0) return 0;
        return normalizedLineStartInNode(self._rope.root, row - 1, 0) orelse TextBufferError.InvalidByteOffset;
    }

    pub fn normalizedByteOffsetToLocation(self: *const Self, byte_offset: NormalizedByteOffset) TextBufferError!NormalizedByteLocation {
        if (byte_offset > self.getByteSize()) return TextBufferError.InvalidByteOffset;
        const row = try self.normalizedByteRowInNode(self._rope.root, byte_offset, 0);
        const line_start = try self.normalizedLineStart(row);
        return .{ .row = row, .byte_in_line = byte_offset - line_start };
    }

    pub fn normalizedByteOffsetToDisplayPoint(
        self: *const Self,
        byte_offset: NormalizedByteOffset,
        affinity: BoundaryAffinity,
    ) TextBufferError!DisplayBoundary {
        const location = try self.normalizedByteOffsetToLocation(byte_offset);
        const marker = self._rope.findMarker(.linestart, location.row) orelse return TextBufferError.InvalidByteOffset;
        var segment_index = marker.leaf_index + 1;
        var bytes_in_line: u32 = 0;
        var columns: u32 = 0;
        while (segment_index < self._rope.count()) : (segment_index += 1) {
            const segment = self._rope.get(segment_index) orelse break;
            if (segment.isBreak() or segment.isLineStart()) break;
            const chunk = segment.asText() orelse continue;
            const chunk_bytes = chunk.getBytes(&self.mem_registry);
            const chunk_end = bytes_in_line +| @as(u32, @intCast(chunk_bytes.len));
            if (location.byte_in_line <= chunk_end) {
                if (chunk.isAsciiOnly()) {
                    return .{
                        .point = .{ .row = location.row, .col = columns +| location.byte_in_line - bytes_in_line },
                        .exact = true,
                    };
                }
                const mapped = utf8.byteOffsetToDisplayColumn(
                    chunk_bytes,
                    location.byte_in_line - bytes_in_line,
                    self.tab_width,
                    self.width_method,
                    affinity,
                ) orelse return TextBufferError.InvalidByteOffset;
                return .{ .point = .{ .row = location.row, .col = columns +| mapped.column }, .exact = mapped.exact };
            }
            bytes_in_line = chunk_end;
            columns +|= chunk.width;
        }
        if (bytes_in_line == location.byte_in_line) return .{ .point = .{ .row = location.row, .col = columns }, .exact = true };
        return TextBufferError.InvalidByteOffset;
    }

    pub fn normalizedByteOffsetToDisplayPointStrict(self: *const Self, byte_offset: NormalizedByteOffset) TextBufferError!DisplayPoint {
        const mapped = try self.normalizedByteOffsetToDisplayPoint(byte_offset, .before);
        if (!mapped.exact) return TextBufferError.InvalidDisplayColumn;
        return mapped.point;
    }

    pub fn displayPointToNormalizedByteOffset(self: *const Self, point: DisplayPoint, affinity: BoundaryAffinity) TextBufferError!NormalizedByteOffset {
        const weight = iter_mod.coordsToOffset(@constCast(&self._rope), point.row, point.col) orelse return TextBufferError.InvalidDisplayColumn;
        _ = weight;

        const line_start = try self.normalizedLineStart(point.row);
        const marker = self._rope.findMarker(.linestart, point.row) orelse return TextBufferError.InvalidDisplayColumn;
        var segment_index = marker.leaf_index + 1;
        var bytes_before: u32 = 0;
        var columns_before: u32 = 0;

        while (segment_index < self._rope.count()) : (segment_index += 1) {
            const segment = self._rope.get(segment_index) orelse break;
            if (segment.isBreak() or segment.isLineStart()) break;
            const chunk = segment.asText() orelse continue;
            const chunk_bytes = chunk.getBytes(&self.mem_registry);
            const chunk_end = columns_before +| chunk.width;
            if (point.col <= chunk_end) {
                const local_col = point.col - columns_before;
                const position = utf8.findPosByWidth(
                    chunk_bytes,
                    local_col,
                    self.tab_width,
                    chunk.isAsciiOnly(),
                    affinity == .after,
                    self.width_method,
                );
                return line_start +| bytes_before +| position.byte_offset;
            }
            columns_before = chunk_end;
            bytes_before +|= @intCast(chunk_bytes.len);
        }

        if (point.col == columns_before) return line_start +| bytes_before;
        return TextBufferError.InvalidDisplayColumn;
    }

    fn splitChunkAtWeight(self: *Self, chunk: *const TextChunk, weight: u32) error{ OutOfBounds, OutOfMemory }!struct { left: TextChunk, right: TextChunk } {
        if (weight == 0) return .{ .left = TextChunk.empty(), .right = chunk.* };
        if (weight >= chunk.width) return .{ .left = chunk.*, .right = TextChunk.empty() };

        const bytes = chunk.getBytes(&self.mem_registry);
        const result = utf8.findPosByWidth(bytes, weight, self.tab_width, chunk.isAsciiOnly(), false, self.width_method);

        return .{
            .left = self.createChunk(chunk.mem_id, chunk.byte_start, chunk.byte_start + result.byte_offset),
            .right = self.createChunk(chunk.mem_id, chunk.byte_start + result.byte_offset, chunk.byte_end),
        };
    }

    fn splitSegmentCallback(
        allocator: Allocator,
        ctx: ?*anyopaque,
        leaf: *const Segment,
        weight_in_leaf: u32,
    ) error{ OutOfBounds, OutOfMemory }!UnifiedRope.Node.LeafSplitResult {
        _ = allocator;
        const self = @as(*Self, @ptrCast(@alignCast(ctx.?)));
        if (leaf.asText()) |chunk| {
            const split = try self.splitChunkAtWeight(chunk, weight_in_leaf);
            return .{ .left = .{ .text = split.left }, .right = .{ .text = split.right } };
        }
        return .{ .left = leaf.*, .right = leaf.* };
    }

    pub fn segmentSplitter(self: *Self) *const UnifiedRope.Node.LeafSplitFn {
        return &self.segment_splitter;
    }

    fn splitSegmentAtNormalizedByte(
        allocator: Allocator,
        ctx: ?*anyopaque,
        leaf: *const Segment,
        byte_in_leaf: u32,
    ) error{ OutOfBounds, OutOfMemory }!UnifiedRope.Node.LeafSplitResult {
        _ = allocator;
        const self = @as(*Self, @ptrCast(@alignCast(ctx.?)));
        const chunk = leaf.asText() orelse return error.OutOfBounds;
        const bytes = chunk.getBytes(&self.mem_registry);
        if (byte_in_leaf == 0 or byte_in_leaf >= bytes.len) return error.OutOfBounds;
        if (!std.unicode.utf8ValidateSlice(bytes[0..byte_in_leaf])) return error.OutOfBounds;

        return .{
            .left = .{ .text = self.createChunk(chunk.mem_id, chunk.byte_start, chunk.byte_start + byte_in_leaf) },
            .right = .{ .text = self.createChunk(chunk.mem_id, chunk.byte_start + byte_in_leaf, chunk.byte_end) },
        };
    }

    fn writeNormalized(source: []const u8, output: []u8) usize {
        var source_index: usize = 0;
        var output_index: usize = 0;
        while (source_index < source.len) : (source_index += 1) {
            if (source[source_index] == '\r' and source_index + 1 < source.len and source[source_index + 1] == '\n') {
                output[output_index] = '\n';
                output_index += 1;
                source_index += 1;
            } else {
                output[output_index] = source[source_index];
                output_index += 1;
            }
        }
        return output_index;
    }

    fn copyNormalizedByteRange(self: *const Self, start: u32, end: u32, output: []u8) usize {
        if (start >= end or output.len == 0) return 0;

        const Context = struct {
            buffer: *const Self,
            start: u32,
            end: u32,
            document_offset: u32 = 0,
            output: []u8,
            written: usize = 0,
            line_count: u32,

            fn copyIntersection(ctx: *@This(), bytes: []const u8) void {
                const item_start = ctx.document_offset;
                const item_end = item_start + @as(u32, @intCast(bytes.len));
                defer ctx.document_offset = item_end;
                if (item_end <= ctx.start or item_start >= ctx.end) return;

                const local_start: usize = @intCast(if (ctx.start > item_start) ctx.start - item_start else 0);
                const local_end: usize = @intCast(@min(ctx.end, item_end) - item_start);
                const copy_len = @min(local_end - local_start, ctx.output.len - ctx.written);
                @memcpy(ctx.output[ctx.written .. ctx.written + copy_len], bytes[local_start .. local_start + copy_len]);
                ctx.written += copy_len;
            }

            fn segmentCallback(ctx_ptr: *anyopaque, _: u32, chunk: *const TextChunk, _: u32) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                ctx.copyIntersection(chunk.getBytes(&ctx.buffer.mem_registry));
            }

            fn lineEndCallback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                if (line_info.line_idx + 1 < ctx.line_count) ctx.copyIntersection("\n");
            }
        };

        var ctx: Context = .{
            .buffer = self,
            .start = start,
            .end = end,
            .output = output,
            .line_count = self.getLineCount(),
        };
        self.walkLinesAndSegments(&ctx, Context.segmentCallback, Context.lineEndCallback);
        return ctx.written;
    }

    /// Candidate transaction roots deliberately defer final line-marker and
    /// grapheme normalization. Copy their byte semantics directly from Rope
    /// items so a temporary trailing break does not depend on line iteration.
    fn copyCurrentNormalizedBytes(self: *const Self, output: []u8) usize {
        const Context = struct {
            buffer: *const Self,
            output: []u8,
            written: usize = 0,
            valid: bool = true,

            fn copy(ctx_ptr: *anyopaque, segment: *const Segment) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                if (!ctx.valid) return;
                const bytes = switch (segment.*) {
                    .text => |chunk| chunk.getBytes(&ctx.buffer.mem_registry),
                    .brk => "\n",
                    .linestart => return,
                };
                if (bytes.len > ctx.output.len - ctx.written) {
                    ctx.valid = false;
                    return;
                }
                @memcpy(ctx.output[ctx.written .. ctx.written + bytes.len], bytes);
                ctx.written += bytes.len;
            }
        };
        var context: Context = .{ .buffer = self, .output = output };
        self._rope.walkCurrentItems(&context, Context.copy);
        return if (context.valid) context.written else 0;
    }

    fn normalizedReplacementLength(replacement: []const u8) TextBufferError!u32 {
        var normalized_len: usize = replacement.len;
        var index: usize = 0;
        while (index + 1 < replacement.len) : (index += 1) {
            if (replacement[index] == '\r' and replacement[index + 1] == '\n') {
                normalized_len -= 1;
                index += 1;
            }
        }
        return std.math.cast(u32, normalized_len) orelse TextBufferError.InvalidDimensions;
    }

    fn displayExtent(range: DisplayRange) DisplayExtent {
        const rows = range.end.point.row - range.start.point.row;
        return .{
            .rows = rows,
            .columns = if (rows == 0) range.end.point.col - range.start.point.col else range.end.point.col,
        };
    }

    /// Replace normalized UTF-8 document bytes in [start, end). Only the Rope and
    /// edit-following annotations are committed here. External highlights,
    /// selections, view state, EditBuffer cursors, and undo checkpoint policy
    /// remain caller-owned. Rope undo/redo does not rewind annotation payloads or
    /// positions; callers that combine both own that history policy.
    pub fn replaceNormalizedBytes(
        self: *Self,
        start: NormalizedByteOffset,
        end: NormalizedByteOffset,
        replacement: []const u8,
    ) TextBufferError!SpliceResult {
        return self.replaceNormalizedBytesWithAnnotations(start, end, replacement, null, false);
    }

    pub fn replaceNormalizedBytesForEdit(
        self: *Self,
        start: NormalizedByteOffset,
        end: NormalizedByteOffset,
        replacement: []const u8,
    ) TextBufferError!SpliceResult {
        return self.replaceNormalizedBytesWithAnnotations(start, end, replacement, null, true);
    }

    /// Consumes an annotation candidate already transformed for this splice.
    /// On failure the candidate is destroyed; on success it becomes live.
    fn replaceNormalizedBytesWithAnnotations(
        self: *Self,
        start: NormalizedByteOffset,
        end: NormalizedByteOffset,
        replacement: []const u8,
        supplied_annotations: ?*TextAnnotations,
        use_live_candidate: bool,
    ) TextBufferError!SpliceResult {
        if (start > end or end > self.getByteSize()) return TextBufferError.InvalidByteOffset;
        if (!std.unicode.utf8ValidateSlice(replacement)) return TextBufferError.InvalidUtf8;
        const inserted_len = try normalizedReplacementLength(replacement);
        const new_end = std.math.add(u32, start, inserted_len) catch return TextBufferError.InvalidDimensions;
        const retained_len = self.getByteSize() - (end - start);
        _ = std.math.add(u32, retained_len, inserted_len) catch return TextBufferError.InvalidDimensions;

        const old_start_display = try self.normalizedByteOffsetToDisplayPoint(start, .before);
        const old_end_display = try self.normalizedByteOffsetToDisplayPoint(end, .after);
        const old_display: DisplayRange = .{ .start = old_start_display, .end = old_end_display };
        if (start == end and replacement.len == 0 and supplied_annotations == null) {
            return .{
                .old_range = .{ .start = start, .end = end },
                .inserted_len = 0,
                .new_end = start,
                .old_display = old_display,
                .new_display = old_display,
                .old_extent = displayExtent(old_display),
                .new_extent = displayExtent(old_display),
            };
        }
        try self.compactRopeTransactionArenasIfNeeded();

        const start_location = try self.normalizedByteOffsetToLocation(start);
        const end_location = try self.normalizedByteOffsetToLocation(end);

        // Resegment complete affected lines so grapheme clusters remain correct
        // when replacement codepoints combine with retained text at either edge.
        const region_start = try self.normalizedLineStart(start_location.row);
        const region_end = if (end_location.row + 1 < self.getLineCount()) blk: {
            const next_line_start = try self.normalizedLineStart(end_location.row + 1);
            break :blk next_line_start - 1;
        } else self.getByteSize();

        const prefix_len: usize = start - region_start;
        const suffix_len: usize = region_end - end;
        const combined_len = std.math.add(usize, prefix_len, inserted_len) catch return TextBufferError.InvalidDimensions;
        const total_len = std.math.add(usize, combined_len, suffix_len) catch return TextBufferError.InvalidDimensions;
        if (total_len > std.math.maxInt(u32)) return TextBufferError.InvalidDimensions;

        const combined = self.global_allocator.alloc(u8, total_len) catch return TextBufferError.OutOfMemory;
        var combined_owned = true;
        defer if (combined_owned) self.global_allocator.free(combined);
        if (self.copyNormalizedByteRange(region_start, start, combined[0..prefix_len]) != prefix_len) return TextBufferError.InvalidByteOffset;
        std.debug.assert(writeNormalized(replacement, combined[prefix_len .. prefix_len + inserted_len]) == inserted_len);
        if (self.copyNormalizedByteRange(end, region_end, combined[prefix_len + inserted_len ..]) != suffix_len) return TextBufferError.InvalidByteOffset;

        var segments: std.ArrayListUnmanaged(Segment) = .empty;
        defer segments.deinit(self.global_allocator);

        const mem_id: ?u8 = if (combined.len == 0) null else self.mem_registry.nextId() orelse return TextBufferError.OutOfMemory;
        if (combined.len > 0) {
            const prepared = try self.textToSegments(self.global_allocator, combined, mem_id.?, 0, false);
            segments = prepared.segments;
            if (region_start != 0) try segments.insert(self.global_allocator, 0, .{ .linestart = {} });
        } else if (region_start != 0) {
            try segments.append(self.global_allocator, .{ .linestart = {} });
        }

        var generated_annotations: ?TextAnnotations = null;
        if (supplied_annotations == null and !use_live_candidate) {
            generated_annotations = self.annotations.clone(self.global_allocator) catch |err| switch (err) {
                error.OutOfMemory => return TextBufferError.OutOfMemory,
                else => return TextBufferError.InvalidDimensions,
            };
        }
        var annotation_candidate_owned = generated_annotations != null;
        defer if (annotation_candidate_owned) generated_annotations.?.deinit();
        const candidate_annotations = if (use_live_candidate) &self.annotations else supplied_annotations orelse &generated_annotations.?;
        var prepared_annotation_splice: ?TextAnnotations.PreparedSplice = null;
        defer if (prepared_annotation_splice) |*prepared| prepared.deinit();
        if (use_live_candidate) {
            prepared_annotation_splice = candidate_annotations.prepareSplice(start, end - start, inserted_len) catch |err| switch (err) {
                error.OutOfMemory => return TextBufferError.OutOfMemory,
                else => return TextBufferError.InvalidDimensions,
            };
        } else if (supplied_annotations == null) {
            candidate_annotations.splice(start, end - start, inserted_len) catch |err| switch (err) {
                error.OutOfMemory => return TextBufferError.OutOfMemory,
                else => return TextBufferError.InvalidDimensions,
            };
        }

        var deleted_style_ids: std.ArrayListUnmanaged(u32) = .empty;
        defer deleted_style_ids.deinit(self.global_allocator);
        if (prepared_annotation_splice) |*prepared| {
            try deleted_style_ids.ensureTotalCapacity(self.global_allocator, prepared.delete_ids.len);
            for (prepared.delete_ids) |id| deleted_style_ids.appendAssumeCapacity(candidate_annotations.get(id).?.payload.style_id);
        } else {
            var old_annotations = self.annotations.iterator();
            while (old_annotations.next() catch return TextBufferError.InvalidDimensions) |annotation| {
                if (candidate_annotations.get(annotation.id()) == null) {
                    try deleted_style_ids.append(self.global_allocator, annotation.payload.style_id);
                }
            }
        }

        if (combined.len > 0) self.mem_registry.prepareRegister() catch return TextBufferError.OutOfMemory;

        // Persistent Rope preparation is deliberately last and isolated in its
        // own arena. A failed preparation can therefore release every node it
        // allocated instead of leaking high-water storage into the document.
        try self.rope_transaction_arenas.ensureUnusedCapacity(self.global_allocator, 1);
        const transaction_arena = self.global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        var transaction_arena_owned = true;
        defer if (transaction_arena_owned) self.global_allocator.destroy(transaction_arena);
        transaction_arena.* = std.heap.ArenaAllocator.init(self.global_allocator);
        defer if (transaction_arena_owned) transaction_arena.deinit();
        var candidate_rope = self._rope;
        candidate_rope.allocator = transaction_arena.allocator();
        const prepared_root = candidate_rope.prepareReplaceRangeByMetric(region_start, region_end, segments.items, &self.byte_splitter) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            error.OutOfBounds => return TextBufferError.InvalidByteOffset,
        };

        if (combined.len > 0) {
            const registered_id = self.mem_registry.register(combined, true) catch unreachable;
            std.debug.assert(registered_id == mem_id.?);
            self.owned_backing_ids[registered_id] = true;
            combined_owned = false;
        }

        self._rope.commitPreparedRoot(prepared_root);
        self.rope_transaction_arenas.appendAssumeCapacity(transaction_arena);
        transaction_arena_owned = false;
        if (self.edit_storage_guard_depth == 0) self.sweepUnreachableBacking();
        if (prepared_annotation_splice) |*prepared| {
            candidate_annotations.commitPreparedSplice(prepared) catch unreachable;
        } else {
            var previous_annotations = self.annotations;
            self.annotations = candidate_annotations.*;
            annotation_candidate_owned = false;
            previous_annotations.deinit();
        }
        for (deleted_style_ids.items) |style_id| self.releaseInternalStyle(style_id);
        self.annotation_epoch +%= 1;
        self.markAllViewsDirty();

        const new_display: DisplayRange = .{
            .start = self.normalizedByteOffsetToDisplayPoint(start, .before) catch unreachable,
            .end = self.normalizedByteOffsetToDisplayPoint(new_end, .after) catch unreachable,
        };
        return .{
            .old_range = .{ .start = start, .end = end },
            .inserted_len = inserted_len,
            .new_end = new_end,
            .old_display = old_display,
            .new_display = new_display,
            .old_extent = displayExtent(old_display),
            .new_extent = displayExtent(new_display),
        };
    }

    pub fn measureText(self: *const Self, text: []const u8) u32 {
        // For grapheme-accurate width calculation (used by highlighting system),
        // use utf8.calculateTextWidth which properly handles grapheme clusters
        const is_ascii = utf8.isAsciiOnly(text);
        return utf8.calculateTextWidth(text, self.tab_width, is_ascii, self.width_method);
    }

    /// Clear text and document annotations without resetting the arena or memory
    /// registry. External line highlights remain caller-owned.
    /// Use this for frequent text updates where undo/redo history should be preserved.
    pub fn clear(self: *Self) void {
        self.clearLinkRefs();
        self.clearInternalStyleRefs();
        self._rope.clearToPreallocatedRoot(self.empty_rope_root, self.empty_rope_leaf);
        self.sweepUnreachableBacking();
        self.annotations.deinit();
        self.annotations = TextAnnotations.init(self.global_allocator);
        self.annotation_epoch +%= 1;
        self.markAllViewsDirty();
    }

    pub fn reset(self: *Self) void {
        self.clearLinkRefs();
        self.clearInternalStyleRefs();
        self._rope.clear_history();
        self.annotations.deinit();
        self.annotations = TextAnnotations.init(self.global_allocator);
        self.annotation_epoch +%= 1;

        // Free highlight/span arrays (they use global_allocator, not arena)
        for (self.external_line_highlights.items) |*hl_list| {
            hl_list.deinit(self.global_allocator);
        }
        self.external_line_highlights.clearRetainingCapacity();
        for (self.line_highlights.items) |*hl_list| {
            hl_list.deinit(self.global_allocator);
        }
        self.line_highlights.clearRetainingCapacity();
        self.internal_highlight_count = 0;

        for (self.line_spans.items) |*span_list| {
            span_list.deinit(self.global_allocator);
        }
        self.line_spans.clearRetainingCapacity();
        self.line_projection_epochs.clearRetainingCapacity();
        self.dirty_span_lines.clearRetainingCapacity();
        self.highlight_batch_depth = 0;

        self.owned_backing_ids = [_]bool{false} ** 255;
        self.storage_compaction_requested = false;
        self.edit_storage_guard_depth = 0;

        self.releaseRopeTransactionArenas();

        // Now reset the arena (frees all the internal memory)
        _ = self.arena.reset(if (self.arena.queryCapacity() > 0) .retain_capacity else .free_all);

        self.mem_registry.clear();

        // The retained arena already held a Rope root and its required leading
        // marker, so rebuilding the empty root cannot require backing growth.
        self._rope = UnifiedRope.init(self.allocator) catch unreachable;
        self.empty_rope_root = self._rope.root;
        self.empty_rope_leaf = self._rope.empty_leaf;

        self.markAllViewsDirty();
    }

    // Default colors/attributes
    pub fn setDefaultFg(self: *Self, fg: ?RGBA) void {
        self.default_fg = fg;
    }

    pub fn setDefaultBg(self: *Self, bg: ?RGBA) void {
        self.default_bg = bg;
    }

    pub fn setDefaultAttributes(self: *Self, attributes: ?u32) void {
        self.default_attributes = attributes;
    }

    pub fn resetDefaults(self: *Self) void {
        self.default_fg = null;
        self.default_bg = null;
        self.default_attributes = null;
    }

    fn onSyntaxStyleDestroyed(ctx_ptr: *anyopaque) void {
        const self = @as(*Self, @ptrCast(@alignCast(ctx_ptr)));
        self.invalidateResolvedStyles(self.syntax_style);
        self.syntax_style = null;
        self.markPaintDirty();
    }

    fn invalidateResolvedStyle(self: *Self, slot: *InternalStyleSlot, expected_style: ?*const SyntaxStyle) void {
        const resolved_style = slot.resolved_syntax_style orelse return;
        if (expected_style != null and resolved_style != expected_style.?) return;
        if (slot.resolved_style_id != 0) {
            (@constCast(resolved_style)).unregisterAnonymousStyleDefinition(slot.resolved_style_id);
        }
        if (slot.link_id != 0) self.link_pool.decref(slot.link_id) catch {};
        slot.resolved_syntax_style = null;
        slot.resolved_style_id = 0;
        slot.link_id = 0;
    }

    fn invalidateResolvedStyles(self: *Self, expected_style: ?*const SyntaxStyle) void {
        for (self.internal_style_slots.items) |*slot| self.invalidateResolvedStyle(slot, expected_style);
    }

    pub fn setSyntaxStyle(self: *Self, syntax_style: ?*const SyntaxStyle) void {
        if (self.syntax_style == syntax_style) return;

        if (syntax_style) |style| {
            (@constCast(style)).onDestroy(@ptrCast(self), onSyntaxStyleDestroyed) catch return;
        }
        if (self.syntax_style) |prev| {
            self.invalidateResolvedStyles(prev);
            (@constCast(prev)).offDestroy(@ptrCast(self), onSyntaxStyleDestroyed);
        }
        self.syntax_style = syntax_style;
        self.markPaintDirty();
    }

    pub fn getSyntaxStyle(self: *const Self) ?*const SyntaxStyle {
        return self.syntax_style;
    }

    fn getLinkTracker(self: *Self) *link.LinkTracker {
        if (self.link_tracker == null) {
            self.link_tracker = link.LinkTracker.init(self.global_allocator, self.link_pool);
        }

        return &self.link_tracker.?;
    }

    fn clearLinkRefs(self: *Self) void {
        if (self.link_tracker) |*tracker| {
            tracker.clear();
        }
    }

    fn clearInternalStyleRefs(self: *Self) void {
        for (self.internal_style_slots.items, 0..) |*slot, index| if (slot.refs != 0) {
            slot.refs = 1;
            self.releaseInternalStyle(internal_style_base | @as(u32, @intCast(index)));
        };
    }

    /// Set the text content using SIMD-optimized line break detection
    pub fn setText(self: *Self, text: []const u8) TextBufferError!void {
        _ = try self.replaceNormalizedBytes(0, self.getByteSize(), text);
        self.clearAnnotations();
    }

    /// Set text from a pre-registered memory ID
    pub fn setTextFromMemId(self: *Self, mem_id: u8) TextBufferError!void {
        const text = self.mem_registry.get(mem_id) orelse return TextBufferError.InvalidMemId;
        _ = try self.replaceNormalizedBytes(0, self.getByteSize(), text);
        self.clearAnnotations();
    }

    pub fn replaceTextFromMemIdForEdit(self: *Self, mem_id: u8) TextBufferError!void {
        const text = self.mem_registry.get(mem_id) orelse return TextBufferError.InvalidMemId;
        _ = try self.replaceNormalizedBytesForEdit(0, self.getByteSize(), text);
    }

    /// Append text to the end of the buffer without clearing
    pub fn append(self: *Self, text: []const u8) TextBufferError!void {
        if (text.len == 0) {
            return;
        }

        const start_byte = self.getByteSize();
        const inserted_len = try normalizedReplacementLength(text);
        var prepared_annotations = self.annotations.prepareSplice(start_byte, 0, inserted_len) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            else => return TextBufferError.InvalidDimensions,
        };
        defer prepared_annotations.deinit();
        const mem_id = try self.mem_registry.register(text, false);
        try self.appendInternal(mem_id, text);
        self.annotations.commitPreparedSplice(&prepared_annotations) catch return TextBufferError.InvalidDimensions;
    }

    /// Append text from a pre-registered memory ID
    pub fn appendFromMemId(self: *Self, mem_id: u8) TextBufferError!void {
        const text = self.mem_registry.get(mem_id) orelse return TextBufferError.InvalidMemId;
        if (text.len == 0) return;
        const start_byte = self.getByteSize();
        const inserted_len = try normalizedReplacementLength(text);
        var prepared_annotations = self.annotations.prepareSplice(start_byte, 0, inserted_len) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            else => return TextBufferError.InvalidDimensions,
        };
        defer prepared_annotations.deinit();
        try self.appendInternal(mem_id, text);
        self.annotations.commitPreparedSplice(&prepared_annotations) catch return TextBufferError.InvalidDimensions;
    }

    /// Internal append that doesn't register memory
    fn appendInternal(self: *Self, mem_id: u8, text: []const u8) TextBufferError!void {
        if (text.len == 0) {
            return;
        }

        // The rope's boundary rewrite will handle normalization at join points
        var result = try self.textToSegments(self.global_allocator, text, mem_id, 0, false);
        defer result.segments.deinit(result.allocator);

        const insert_pos = self._rope.count();
        try self._rope.insert_slice(insert_pos, result.segments.items);

        self.markAllViewsDirty();
    }

    /// Internal setText that doesn't call clear (for use by setStyledText)
    fn setTextInternal(self: *Self, mem_id: u8, text: []const u8) TextBufferError!void {
        if (text.len == 0) {
            self.markAllViewsDirty();
            return;
        }

        var result = try self.textToSegments(self.global_allocator, text, mem_id, 0, true);
        defer result.segments.deinit(result.allocator);

        try self._rope.setSegments(result.segments.items);

        self.markAllViewsDirty();
    }

    /// Create a TextChunk from a memory buffer range
    pub fn createChunk(
        self: *const Self,
        mem_id: u8,
        byte_start: u32,
        byte_end: u32,
    ) TextChunk {
        const mem_buf = self.mem_registry.get(mem_id).?;
        const chunk_bytes = mem_buf[byte_start..byte_end];
        return self.createChunkFromBytes(mem_id, byte_start, byte_end, chunk_bytes);
    }

    fn createChunkFromBytes(
        self: *const Self,
        mem_id: u8,
        byte_start: u32,
        byte_end: u32,
        chunk_bytes: []const u8,
    ) TextChunk {
        const is_ascii = utf8.isAsciiOnly(chunk_bytes);

        var flags: u8 = 0;
        if (chunk_bytes.len > 0 and is_ascii) {
            flags |= TextChunk.Flags.ASCII_ONLY;
        }

        const chunk_width = utf8.calculateTextWidth(chunk_bytes, self.tab_width, is_ascii, self.width_method);

        return .{
            .mem_id = mem_id,
            .byte_start = byte_start,
            .byte_end = byte_end,
            .width = chunk_width,
            .flags = flags,
        };
    }

    /// Convert text to segments with line breaks
    /// Returns segments array and total width
    pub fn textToSegments(
        self: *const Self,
        allocator: Allocator,
        text: []const u8,
        mem_id: u8,
        byte_offset: u32,
        prepend_linestart: bool,
    ) TextBufferError!struct { segments: std.ArrayListUnmanaged(Segment), total_width: u32, allocator: Allocator } {
        var break_result = utf8.LineBreakResult.init(allocator);
        defer break_result.deinit();
        try utf8.findLineBreaks(text, &break_result);

        var segments: std.ArrayListUnmanaged(Segment) = .empty;
        errdefer segments.deinit(allocator);

        if (prepend_linestart) {
            try segments.append(allocator, .{ .linestart = {} });
        }

        var local_start: u32 = 0;
        var total_width: u32 = 0;

        for (break_result.breaks.items) |line_break| {
            const break_pos: u32 = @intCast(line_break.pos);
            const local_end: u32 = switch (line_break.kind) {
                .CRLF => break_pos - 1,
                .CR, .LF => break_pos,
            };

            if (local_end > local_start) {
                const chunk = self.createChunkFromBytes(
                    mem_id,
                    byte_offset + local_start,
                    byte_offset + local_end,
                    text[local_start..local_end],
                );
                try segments.append(allocator, .{ .text = chunk });
                total_width = std.math.add(u32, total_width, chunk.width) catch return TextBufferError.InvalidDimensions;
            }

            try segments.append(allocator, .{ .brk = {} });
            try segments.append(allocator, .{ .linestart = {} });

            local_start = break_pos + 1;
        }

        if (local_start < text.len) {
            const chunk = self.createChunkFromBytes(
                mem_id,
                byte_offset + local_start,
                byte_offset + @as(u32, @intCast(text.len)),
                text[local_start..],
            );
            try segments.append(allocator, .{ .text = chunk });
            total_width = std.math.add(u32, total_width, chunk.width) catch return TextBufferError.InvalidDimensions;
        }

        return .{ .segments = segments, .total_width = total_width, .allocator = allocator };
    }

    pub fn getLineCount(self: *const Self) u32 {
        const count = self._rope.count();
        if (count == 0) return 0; // Truly empty (after reset)
        return iter_mod.getLineCount(&self._rope);
    }

    pub fn lineCount(self: *const Self) u32 {
        return self.getLineCount();
    }

    /// Register a memory buffer
    pub fn registerMemBuffer(self: *Self, data: []const u8, owned: bool) TextBufferError!u8 {
        return self.mem_registry.register(data, owned);
    }

    pub fn replaceMemBuffer(self: *Self, mem_id: u8, data: []const u8, owned: bool) TextBufferError!void {
        try self.mem_registry.replace(mem_id, data, owned);
    }

    pub fn clearMemRegistry(self: *Self) void {
        // No current or historical root may outlive the storage it references.
        self.clearLinkRefs();
        self.clearInternalStyleRefs();
        self._rope.clearToPreallocatedRoot(self.empty_rope_root, self.empty_rope_leaf);
        self._rope.clear_history();
        self.clearAllHighlights();
        self.annotations.deinit();
        self.annotations = TextAnnotations.init(self.global_allocator);
        self.annotation_epoch +%= 1;
        self.dirty_span_lines.clearRetainingCapacity();
        self.highlight_batch_depth = 0;
        self.mem_registry.clear();
        self.owned_backing_ids = [_]bool{false} ** 255;
        self.storage_compaction_requested = false;
        self.edit_storage_guard_depth = 0;
        self.releaseRopeTransactionArenas();
        self.markAllViewsDirty();
    }

    pub fn getMemBuffer(self: *const Self, mem_id: u8) ?[]const u8 {
        return self.mem_registry.get(mem_id);
    }

    /// Add a line from a memory buffer (for compatibility with old API)
    /// Note: This is not as efficient as setText for bulk operations
    /// Adds text segment with a break separator before it (if not the first line)
    pub fn addLine(
        self: *Self,
        mem_id: u8,
        byte_start: u32,
        byte_end: u32,
    ) TextBufferError!void {
        _ = self.mem_registry.get(mem_id) orelse return TextBufferError.InvalidMemId;

        const chunk = self.createChunk(mem_id, byte_start, byte_end);

        const had_content = self._rope.count() > 1;

        if (had_content) {
            try self._rope.append(.{ .brk = {} });
            try self._rope.append(.{ .linestart = {} });
        }

        try self._rope.append(.{ .text = chunk });

        self.markAllViewsDirty();
    }

    pub fn getArenaAllocatedBytes(self: *const Self) usize {
        var total = self.arena.queryCapacity();
        for (self.rope_transaction_arenas.items) |arena| total += arena.queryCapacity();
        return total;
    }

    fn getRopeTransactionArenaBytes(self: *const Self) usize {
        var total: usize = 0;
        for (self.rope_transaction_arenas.items) |arena| total += arena.queryCapacity();
        return total;
    }

    fn getOwnedBackingBlockCount(self: *const Self) usize {
        var count: usize = 0;
        for (self.owned_backing_ids) |owned| count += @intFromBool(owned);
        return count;
    }

    pub fn getBackingStoreBytes(self: *const Self) usize {
        var total: usize = 0;
        for (self.owned_backing_ids, 0..) |owned, index| if (owned) {
            if (self.mem_registry.get(@intCast(index))) |buffer| total += buffer.len;
        };
        return total;
    }

    pub fn getBackingStoreCapacity(self: *const Self) usize {
        // Owned blocks are allocated at their exact committed length.
        return self.getBackingStoreBytes();
    }

    pub fn getBackingStoreBlockCount(self: *const Self) usize {
        return self.getOwnedBackingBlockCount();
    }

    fn markReachableBacking(ctx_ptr: *anyopaque, segment: *const Segment) void {
        const reachable = @as(*[255]bool, @ptrCast(@alignCast(ctx_ptr)));
        if (segment.asText()) |chunk| {
            if (chunk.byte_start != chunk.byte_end) reachable[chunk.mem_id] = true;
        }
    }

    fn sweepUnreachableBacking(self: *Self) void {
        var reachable = [_]bool{false} ** 255;
        self._rope.walkRetainedItems(&reachable, markReachableBacking);
        for (&self.owned_backing_ids, 0..) |*owned, index| {
            if (owned.* and !reachable[index]) {
                self.mem_registry.unregisterNoAlloc(@intCast(index)) catch unreachable;
                owned.* = false;
            }
        }
    }

    const BackingRange = struct {
        mem_id: u8,
        start: u32,
        end: u32,
        target_start: u32 = 0,
    };

    const RangeCollector = struct {
        allocator: Allocator,
        ranges: std.ArrayListUnmanaged(BackingRange) = .empty,
        failed: bool = false,

        fn collect(ctx_ptr: *anyopaque, segment: *const Segment) void {
            const ctx = @as(*RangeCollector, @ptrCast(@alignCast(ctx_ptr)));
            const chunk = segment.asText() orelse return;
            if (chunk.byte_start == chunk.byte_end or ctx.failed) return;
            ctx.ranges.append(ctx.allocator, .{
                .mem_id = chunk.mem_id,
                .start = chunk.byte_start,
                .end = chunk.byte_end,
            }) catch {
                ctx.failed = true;
            };
        }

        fn lessThan(_: void, left: BackingRange, right: BackingRange) bool {
            if (left.mem_id != right.mem_id) return left.mem_id < right.mem_id;
            if (left.start != right.start) return left.start < right.start;
            return left.end < right.end;
        }

        fn finish(self: *RangeCollector) TextBufferError![]BackingRange {
            if (self.failed) return TextBufferError.OutOfMemory;
            std.mem.sort(BackingRange, self.ranges.items, {}, lessThan);
            var output: usize = 0;
            for (self.ranges.items) |range| {
                if (output != 0) {
                    const previous = &self.ranges.items[output - 1];
                    if (previous.mem_id == range.mem_id and range.start <= previous.end) {
                        previous.end = @max(previous.end, range.end);
                        continue;
                    }
                }
                self.ranges.items[output] = range;
                output += 1;
            }
            self.ranges.shrinkRetainingCapacity(output);
            return self.ranges.items;
        }

        fn deinit(self: *RangeCollector) void {
            self.ranges.deinit(self.allocator);
        }
    };

    const CompactStorageContext = struct {
        owner: *const Self,
        mem_id: u8,
        ranges: []const BackingRange,

        fn cloneSegment(ctx_ptr: ?*anyopaque, source: *const Segment) anyerror!Segment {
            const ctx = @as(*CompactStorageContext, @ptrCast(@alignCast(ctx_ptr.?)));
            return switch (source.*) {
                .text => |chunk| blk: {
                    const bytes = chunk.getBytes(&ctx.owner.mem_registry);
                    if (bytes.len == 0) break :blk source.*;
                    var target_start: ?u32 = null;
                    for (ctx.ranges) |range| {
                        if (range.mem_id == chunk.mem_id and range.start <= chunk.byte_start and range.end >= chunk.byte_end) {
                            target_start = range.target_start + (chunk.byte_start - range.start);
                            break;
                        }
                    }
                    const start = target_start orelse return TextBufferError.InvalidDimensions;
                    const end = std.math.add(u32, start, @intCast(bytes.len)) catch return TextBufferError.InvalidDimensions;
                    break :blk .{ .text = ctx.owner.createChunkFromBytes(
                        ctx.mem_id,
                        start,
                        end,
                        bytes,
                    ) };
                },
                else => source.*,
            };
        }
    };

    fn cloneSegmentIdentity(_: ?*anyopaque, source: *const Segment) anyerror!Segment {
        return source.*;
    }

    fn compactRopeTransactionArenasIfNeeded(self: *Self) TextBufferError!void {
        const arena_bytes = self.getRopeTransactionArenaBytes();
        const backing_blocks = self.getOwnedBackingBlockCount();
        if (!self.storage_compaction_requested and self.rope_transaction_arenas.items.len < rope_compaction_arena_limit and arena_bytes < rope_compaction_byte_limit and backing_blocks < backing_compaction_block_limit) return;

        if (self._rope.root.metrics().count == 1 and !self._rope.has_history()) {
            self.sweepUnreachableBacking();
            self.markViewCachesDirty();
            self.releaseRopeTransactionArenas();
            self.storage_compaction_requested = false;
            return;
        }

        const compacted_arena = self.global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        var compacted_owned = true;
        defer if (compacted_owned) self.global_allocator.destroy(compacted_arena);
        compacted_arena.* = std.heap.ArenaAllocator.init(self.global_allocator);
        defer if (compacted_owned) compacted_arena.deinit();

        var collector: RangeCollector = .{ .allocator = self.global_allocator };
        defer collector.deinit();
        self._rope.walkRetainedItems(&collector, RangeCollector.collect);
        const ranges = try collector.finish();
        var storage_len: usize = 0;
        for (ranges) |*range| {
            range.target_start = std.math.cast(u32, storage_len) orelse return TextBufferError.InvalidDimensions;
            storage_len = std.math.add(usize, storage_len, range.end - range.start) catch return TextBufferError.InvalidDimensions;
        }
        if (storage_len > std.math.maxInt(u32)) return TextBufferError.InvalidDimensions;
        const existing_id: ?u8 = blk: {
            for (self.owned_backing_ids, 0..) |owned, index| if (owned) break :blk @intCast(index);
            break :blk null;
        };
        const mem_id = existing_id orelse self.mem_registry.nextId() orelse return TextBufferError.OutOfMemory;
        const compacted_storage = self.global_allocator.alloc(u8, storage_len) catch return TextBufferError.OutOfMemory;
        var storage_owned = true;
        defer if (storage_owned) self.global_allocator.free(compacted_storage);
        for (ranges) |range| {
            const source = self.mem_registry.get(range.mem_id) orelse return TextBufferError.InvalidMemId;
            @memcpy(
                compacted_storage[range.target_start .. range.target_start + (range.end - range.start)],
                source[range.start..range.end],
            );
        }
        var storage_context: CompactStorageContext = .{ .owner = self, .mem_id = mem_id, .ranges = ranges };
        const compacted = self._rope.cloneRetained(
            compacted_arena.allocator(),
            self.global_allocator,
            @ptrCast(&storage_context),
            CompactStorageContext.cloneSegment,
        ) catch |err| switch (err) {
            error.InvalidDimensions => return TextBufferError.InvalidDimensions,
            else => return TextBufferError.OutOfMemory,
        };
        if (existing_id == null) self.mem_registry.prepareRegister() catch return TextBufferError.OutOfMemory;
        try self.rope_transaction_arenas.ensureUnusedCapacity(self.global_allocator, 1);

        // Views cache pointers to Rope-owned TextChunks. Invalidate them even
        // when a later semantic preparation fails; epochs remain unchanged.
        self.markViewCachesDirty();
        if (existing_id) |id| {
            self.mem_registry.replace(id, compacted_storage, true) catch unreachable;
        } else {
            const registered = self.mem_registry.register(compacted_storage, true) catch unreachable;
            std.debug.assert(registered == mem_id);
            self.owned_backing_ids[registered] = true;
        }
        storage_owned = false;

        self.releaseRopeTransactionArenas();
        self._rope = compacted;
        self.rope_transaction_arenas.appendAssumeCapacity(compacted_arena);
        self.sweepUnreachableBacking();
        self.storage_compaction_requested = false;
        compacted_owned = false;
    }

    pub fn requestStorageCompaction(self: *Self) void {
        self.sweepUnreachableBacking();
        // Empty documents can release every transaction arena without allocating.
        // Non-empty documents wait for the normal bounded arena/block thresholds.
        self.storage_compaction_requested = self._rope.root.metrics().count == 1 and !self._rope.has_history();
        self.compactRopeTransactionArenasIfNeeded() catch {};
    }

    pub fn prepareEditStorage(self: *Self) TextBufferError!void {
        try self.compactRopeTransactionArenasIfNeeded();
        self.edit_storage_guard_depth += 1;
    }

    pub fn finishEditStorage(self: *Self) void {
        std.debug.assert(self.edit_storage_guard_depth != 0);
        self.edit_storage_guard_depth -= 1;
        if (self.edit_storage_guard_depth == 0) self.sweepUnreachableBacking();
    }

    fn releaseRopeTransactionArenas(self: *Self) void {
        for (self.rope_transaction_arenas.items) |arena| {
            arena.deinit();
            self.global_allocator.destroy(arena);
        }
        self.rope_transaction_arenas.clearRetainingCapacity();
    }

    /// Extract all text as UTF-8 bytes into provided output buffer
    pub fn getPlainTextIntoBuffer(self: *const Self, out_buffer: []u8) usize {
        var out_index: usize = 0;

        const line_count = self.getLineCount();

        const Context = struct {
            buffer: *const UnifiedTextBuffer,
            out_buffer: []u8,
            out_index: *usize,
            line_count: u32,

            fn segmentCallback(ctx_ptr: *anyopaque, line_idx: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void {
                _ = line_idx;
                _ = chunk_idx_in_line;
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                const chunk_bytes = chunk.getBytes(&ctx.buffer.mem_registry);
                const copy_len = @min(chunk_bytes.len, ctx.out_buffer.len - ctx.out_index.*);
                if (copy_len > 0) {
                    @memcpy(ctx.out_buffer[ctx.out_index.* .. ctx.out_index.* + copy_len], chunk_bytes[0..copy_len]);
                    ctx.out_index.* += copy_len;
                }
            }

            fn lineEndCallback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                // Add newline between lines (not after last line)
                if (ctx.line_count > 0 and line_info.line_idx < ctx.line_count - 1 and ctx.out_index.* < ctx.out_buffer.len) {
                    ctx.out_buffer[ctx.out_index.*] = '\n';
                    ctx.out_index.* += 1;
                }
            }
        };

        var ctx: Context = .{
            .buffer = self,
            .out_buffer = out_buffer,
            .out_index = &out_index,
            .line_count = line_count,
        };
        self.walkLinesAndSegments(&ctx, Context.segmentCallback, Context.lineEndCallback);

        return out_index;
    }

    pub fn startHighlightsTransaction(self: *Self) void {
        self.highlight_batch_depth += 1;
    }

    pub fn endHighlightsTransaction(self: *Self) void {
        if (self.highlight_batch_depth == 0) return;

        self.highlight_batch_depth -= 1;

        if (self.highlight_batch_depth == 0) {
            var it = self.dirty_span_lines.keyIterator();
            while (it.next()) |line_idx| {
                self.projectLine(line_idx.*) catch {};
            }
            self.dirty_span_lines.clearRetainingCapacity();
        }
    }

    fn markLineSpansDirty(self: *Self, line_idx: usize) void {
        self.dirty_span_lines.put(line_idx, {}) catch {};
    }

    // Highlight system
    fn ensureLineHighlightStorage(self: *Self, line_idx: usize) TextBufferError!void {
        while (self.external_line_highlights.items.len <= line_idx) {
            try self.external_line_highlights.append(self.global_allocator, .empty);
        }
        while (self.line_highlights.items.len <= line_idx) {
            try self.line_highlights.append(self.global_allocator, .empty);
        }
        while (self.line_spans.items.len <= line_idx) {
            try self.line_spans.append(self.global_allocator, .empty);
        }
        while (self.line_projection_epochs.items.len <= line_idx) {
            try self.line_projection_epochs.append(self.global_allocator, 0);
        }
    }

    pub fn addHighlight(
        self: *Self,
        line_idx: usize,
        col_start: u32,
        col_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: u16,
    ) TextBufferError!void {
        return self.addHighlightInternal(line_idx, col_start, col_end, style_id, priority, hl_ref, false);
    }

    fn addHighlightInternal(
        self: *Self,
        line_idx: usize,
        col_start: u32,
        col_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: u16,
        internal: bool,
    ) TextBufferError!void {
        const line_count = self.getLineCount();
        if (line_idx >= line_count) {
            return TextBufferError.InvalidIndex;
        }

        if (col_start >= col_end) {
            return; // Empty range
        }

        try self.ensureLineHighlightStorage(line_idx);

        const hl: Highlight = .{
            .col_start = col_start,
            .col_end = col_end,
            .style_id = style_id,
            .priority = priority,
            .hl_ref = hl_ref,
            .internal = internal,
        };

        try self.external_line_highlights.items[line_idx].append(self.global_allocator, hl);
        if (internal) {
            self.internal_highlight_count += 1;
        }

        self.markPaintDirty();

        if (self.highlight_batch_depth == 0) {
            try self.projectLine(line_idx);
        } else {
            self.markLineSpansDirty(line_idx);
        }
    }

    pub fn getLineHighlights(self: *Self, line_idx: usize) []const Highlight {
        if (line_idx >= self.getLineCount()) {
            if (line_idx < self.external_line_highlights.items.len) return self.external_line_highlights.items[line_idx].items;
            return &[_]Highlight{};
        }
        self.projectLine(line_idx) catch return &[_]Highlight{};
        if (line_idx < self.line_highlights.items.len) {
            return self.line_highlights.items[line_idx].items;
        }
        return &[_]Highlight{};
    }

    pub fn getLineSpans(self: *Self, line_idx: usize) []const StyleSpan {
        if (line_idx < self.getLineCount()) self.projectLine(line_idx) catch return &[_]StyleSpan{};
        if (line_idx < self.line_spans.items.len) {
            return self.line_spans.items[line_idx].items;
        }
        return &[_]StyleSpan{};
    }

    const ProjectedAnnotation = struct {
        annotation: TextAnnotations.Annotation,
        start: u32,
        end: u32,
    };

    const ProjectionEvent = struct {
        col: u32,
        is_start: bool,
        hl_idx: usize,
    };

    fn projectionBoundaryLessThan(_: void, left: utf8.DisplayBoundary, right: utf8.DisplayBoundary) bool {
        if (left.byte_offset != right.byte_offset) return left.byte_offset < right.byte_offset;
        return @intFromEnum(left.affinity) < @intFromEnum(right.affinity);
    }

    fn projectionBoundaryColumn(boundaries: []const utf8.DisplayBoundary, offset: u32, affinity: BoundaryAffinity) ?u32 {
        var low: usize = 0;
        var high = boundaries.len;
        while (low < high) {
            const middle = low + (high - low) / 2;
            const boundary = boundaries[middle];
            if (boundary.byte_offset < offset or
                (boundary.byte_offset == offset and @intFromEnum(boundary.affinity) < @intFromEnum(affinity)))
            {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        if (low == boundaries.len or boundaries[low].byte_offset != offset or boundaries[low].affinity != affinity) return null;
        return boundaries[low].column;
    }

    fn mapLineProjectionBoundaries(self: *Self, line_idx: usize, boundaries: []utf8.DisplayBoundary) TextBufferError!void {
        if (boundaries.len == 0) return;
        const marker = self._rope.findMarker(.linestart, @intCast(line_idx)) orelse return TextBufferError.InvalidByteOffset;
        var segment_index = marker.leaf_index + 1;
        var boundary_index: usize = 0;
        var bytes_in_line: u32 = 0;
        var columns: u32 = 0;
        while (segment_index < self._rope.count()) : (segment_index += 1) {
            const segment = self._rope.get(segment_index) orelse break;
            if (segment.isBreak() or segment.isLineStart()) break;
            const chunk = segment.asText() orelse continue;
            const chunk_bytes = chunk.getBytes(&self.mem_registry);
            const chunk_end = bytes_in_line +| @as(u32, @intCast(chunk_bytes.len));
            var boundary_end = boundary_index;
            while (boundary_end < boundaries.len and boundaries[boundary_end].byte_offset <= chunk_end) : (boundary_end += 1) {}
            if (!utf8.byteOffsetsToDisplayColumns(
                chunk_bytes,
                boundaries[boundary_index..boundary_end],
                bytes_in_line,
                columns,
                self.tab_width,
                self.width_method,
            )) return TextBufferError.InvalidByteOffset;
            boundary_index = boundary_end;
            bytes_in_line = chunk_end;
            columns +|= chunk.width;
        }
        if (boundary_index != boundaries.len) return TextBufferError.InvalidByteOffset;
    }

    fn projectLine(self: *Self, line_idx: usize) TextBufferError!void {
        if (line_idx >= self.getLineCount()) return TextBufferError.InvalidIndex;
        try self.ensureLineHighlightStorage(line_idx);
        if (self.line_projection_epochs.items[line_idx] == self.projection_epoch) return;
        var projected: std.ArrayListUnmanaged(Highlight) = .empty;
        defer projected.deinit(self.global_allocator);
        const external = self.external_line_highlights.items[line_idx].items;

        var projected_annotations: std.ArrayListUnmanaged(ProjectedAnnotation) = .empty;
        defer projected_annotations.deinit(self.global_allocator);
        var boundaries: std.ArrayListUnmanaged(utf8.DisplayBoundary) = .empty;
        defer boundaries.deinit(self.global_allocator);

        const line_start = try self.normalizedLineStart(@intCast(line_idx));
        const line_end = if (line_idx + 1 < self.getLineCount())
            (try self.normalizedLineStart(@intCast(line_idx + 1))) - 1
        else
            self.getByteSize();

        if (line_start < line_end) {
            const Context = struct {
                allocator: Allocator,
                annotations: *std.ArrayListUnmanaged(ProjectedAnnotation),
                boundaries: *std.ArrayListUnmanaged(utf8.DisplayBoundary),
                line_start: u32,
                line_end: u32,
                fn visit(ctx: *@This(), annotation: TextAnnotations.Annotation) !void {
                    if (annotation.payload.kind_flags & style_range_kind == 0) return;
                    const range = switch (annotation.mark) {
                        .range => |value| value,
                        .point => return,
                    };
                    const start = @max(range.start_byte, ctx.line_start);
                    const end = @min(range.end_byte, ctx.line_end);
                    if (start >= end) return;
                    try ctx.annotations.append(ctx.allocator, .{ .annotation = annotation, .start = start, .end = end });
                    try ctx.boundaries.append(ctx.allocator, .{ .byte_offset = start - ctx.line_start, .affinity = .before });
                    try ctx.boundaries.append(ctx.allocator, .{ .byte_offset = end - ctx.line_start, .affinity = .after });
                }
            };
            var context: Context = .{
                .allocator = self.global_allocator,
                .annotations = &projected_annotations,
                .boundaries = &boundaries,
                .line_start = line_start,
                .line_end = line_end,
            };
            self.annotations.visitUnordered(.overlapping, line_start, line_end, &context, Context.visit) catch return TextBufferError.OutOfMemory;
            std.mem.sort(ProjectedAnnotation, projected_annotations.items, {}, struct {
                fn lessThan(_: void, a: ProjectedAnnotation, b: ProjectedAnnotation) bool {
                    return TextAnnotations.hasHigherPrecedence(a.annotation, b.annotation);
                }
            }.lessThan);
            std.mem.sort(utf8.DisplayBoundary, boundaries.items, {}, projectionBoundaryLessThan);
            var boundary_count: usize = 0;
            for (boundaries.items) |boundary| {
                if (boundary_count != 0 and
                    boundaries.items[boundary_count - 1].byte_offset == boundary.byte_offset and
                    boundaries.items[boundary_count - 1].affinity == boundary.affinity) continue;
                boundaries.items[boundary_count] = boundary;
                boundary_count += 1;
            }
            boundaries.shrinkRetainingCapacity(boundary_count);
            try self.mapLineProjectionBoundaries(line_idx, boundaries.items);
        }

        const projected_count = std.math.add(usize, external.len, projected_annotations.items.len) catch return TextBufferError.InvalidDimensions;
        try projected.ensureTotalCapacity(self.global_allocator, projected_count);
        projected.appendSliceAssumeCapacity(external);
        // Visitors return winner-first, while span ties intentionally use later
        // array entries so public highlight insertion order is stable.
        var annotation_index = projected_annotations.items.len;
        while (annotation_index != 0) {
            annotation_index -= 1;
            const annotation = projected_annotations.items[annotation_index];
            const start_col = projectionBoundaryColumn(boundaries.items, annotation.start - line_start, .before) orelse return TextBufferError.InvalidByteOffset;
            const end_col = projectionBoundaryColumn(boundaries.items, annotation.end - line_start, .after) orelse return TextBufferError.InvalidByteOffset;
            projected.appendAssumeCapacity(.{
                .col_start = start_col,
                .col_end = end_col,
                .style_id = annotation.annotation.payload.style_id,
                .priority = annotation.annotation.payload.priority,
                .hl_ref = annotation.annotation.payload.highlight_ref orelse
                    (std.math.cast(u16, annotation.annotation.id() & std.math.maxInt(u32)) orelse 0),
                .internal = true,
            });
        }

        var spans: std.ArrayListUnmanaged(StyleSpan) = .empty;
        defer spans.deinit(self.global_allocator);
        var events: std.ArrayListUnmanaged(ProjectionEvent) = .empty;
        defer events.deinit(self.global_allocator);
        const event_count = std.math.mul(usize, projected.items.len, 2) catch return TextBufferError.InvalidDimensions;
        try events.ensureTotalCapacity(self.global_allocator, event_count);
        const active = self.global_allocator.alloc(bool, projected.items.len) catch return TextBufferError.OutOfMemory;
        defer self.global_allocator.free(active);
        var heap: std.ArrayListUnmanaged(usize) = .empty;
        defer heap.deinit(self.global_allocator);
        try heap.ensureTotalCapacity(self.global_allocator, projected.items.len);
        try spans.ensureTotalCapacity(self.global_allocator, std.math.add(usize, event_count, 1) catch return TextBufferError.InvalidDimensions);

        // Resolving an internal style publishes an anonymous SyntaxStyle entry
        // and possibly a LinkPool reference. Every later projection step is now
        // capacity-reserved; rollback only the slots first resolved by this plan.
        var newly_resolved: std.ArrayListUnmanaged(usize) = .empty;
        defer newly_resolved.deinit(self.global_allocator);
        try newly_resolved.ensureTotalCapacity(self.global_allocator, projected_annotations.items.len);
        var projected_index = external.len;
        while (projected_index < projected.items.len) : (projected_index += 1) {
            const slot_id = projected.items[projected_index].style_id;
            const slot_index: usize = slot_id & ~internal_style_base;
            const was_resolved = slot_id & internal_style_base != 0 and
                slot_index < self.internal_style_slots.items.len and
                self.internal_style_slots.items[slot_index].resolved_syntax_style == self.syntax_style;
            projected.items[projected_index].style_id = self.resolveAnnotationStyle(slot_id) catch |err| {
                var rollback_index = newly_resolved.items.len;
                while (rollback_index != 0) {
                    rollback_index -= 1;
                    self.invalidateResolvedStyle(&self.internal_style_slots.items[newly_resolved.items[rollback_index]], self.syntax_style);
                }
                return err;
            };
            if (!was_resolved and
                self.syntax_style != null and
                slot_id & internal_style_base != 0 and
                slot_index < self.internal_style_slots.items.len and
                self.internal_style_slots.items[slot_index].resolved_syntax_style == self.syntax_style)
            {
                newly_resolved.appendAssumeCapacity(slot_index);
            }
        }

        self.rebuildLineSpansPrepared(line_idx, projected.items, &spans, &events, active, &heap);
        std.mem.swap(std.ArrayListUnmanaged(Highlight), &projected, &self.line_highlights.items[line_idx]);
        std.mem.swap(std.ArrayListUnmanaged(StyleSpan), &spans, &self.line_spans.items[line_idx]);
        self.line_projection_epochs.items[line_idx] = self.projection_epoch;
    }

    fn rebuildLineSpansPrepared(
        self: *Self,
        line_idx: usize,
        highlights: []const Highlight,
        spans: *std.ArrayListUnmanaged(StyleSpan),
        events: *std.ArrayListUnmanaged(ProjectionEvent),
        active: []bool,
        heap: *std.ArrayListUnmanaged(usize),
    ) void {
        std.debug.assert(line_idx < self.line_spans.items.len);
        std.debug.assert(events.capacity >= highlights.len * 2);
        std.debug.assert(active.len == highlights.len);
        std.debug.assert(heap.capacity >= highlights.len);
        std.debug.assert(spans.capacity >= highlights.len * 2 + 1);

        if (highlights.len == 0) return;

        for (highlights, 0..) |hl, idx| {
            events.appendAssumeCapacity(.{ .col = hl.col_start, .is_start = true, .hl_idx = idx });
            events.appendAssumeCapacity(.{ .col = hl.col_end, .is_start = false, .hl_idx = idx });
        }

        // Sort by column, ends before starts at same position
        const sortFn = struct {
            fn lessThan(_: void, a: ProjectionEvent, b: ProjectionEvent) bool {
                if (a.col != b.col) return a.col < b.col;
                if (a.is_start != b.is_start) return !a.is_start; // ends before starts
                // If both are same type at same column, use hl_idx for stable sort
                return a.hl_idx < b.hl_idx;
            }
        }.lessThan;
        std.mem.sort(ProjectionEvent, events.items, {}, sortFn);
        @memset(active, false);

        const Heap = struct {
            fn better(values: []const Highlight, left: usize, right: usize) bool {
                return values[left].priority > values[right].priority or
                    (values[left].priority == values[right].priority and left > right);
            }

            fn push(values: []const Highlight, storage: *std.ArrayListUnmanaged(usize), value: usize) void {
                storage.appendAssumeCapacity(value);
                var child = storage.items.len - 1;
                while (child != 0) {
                    const parent = (child - 1) / 2;
                    if (!better(values, storage.items[child], storage.items[parent])) break;
                    std.mem.swap(usize, &storage.items[child], &storage.items[parent]);
                    child = parent;
                }
            }

            fn removeTop(values: []const Highlight, storage: *std.ArrayListUnmanaged(usize)) void {
                const last = storage.pop().?;
                if (storage.items.len == 0) return;
                storage.items[0] = last;
                var parent: usize = 0;
                while (true) {
                    const left = parent * 2 + 1;
                    if (left >= storage.items.len) break;
                    const right = left + 1;
                    const child = if (right < storage.items.len and better(values, storage.items[right], storage.items[left])) right else left;
                    if (!better(values, storage.items[child], storage.items[parent])) break;
                    std.mem.swap(usize, &storage.items[parent], &storage.items[child]);
                    parent = child;
                }
            }

            fn winner(values: []const Highlight, storage: *std.ArrayListUnmanaged(usize), live: []const bool) ?usize {
                while (storage.items.len != 0 and !live[storage.items[0]]) removeTop(values, storage);
                return if (storage.items.len == 0) null else storage.items[0];
            }

            fn appendSpan(output: *std.ArrayListUnmanaged(StyleSpan), start: u32, end: u32, style_id: u32) void {
                if (start >= end) return;
                if (output.items.len != 0) {
                    const previous = &output.items[output.items.len - 1];
                    if (previous.next_col == start and previous.style_id == style_id) {
                        previous.next_col = end;
                        return;
                    }
                }
                output.appendAssumeCapacity(.{ .col = start, .style_id = style_id, .next_col = end });
            }
        };

        var current_col: u32 = 0;
        var event_index: usize = 0;
        while (event_index < events.items.len) {
            const event_col = events.items[event_index].col;
            const winner = Heap.winner(highlights, heap, active);
            Heap.appendSpan(spans, current_col, event_col, if (winner) |index| highlights[index].style_id else 0);
            current_col = event_col;
            while (event_index < events.items.len and events.items[event_index].col == event_col) : (event_index += 1) {
                const event = events.items[event_index];
                if (event.is_start) {
                    active[event.hl_idx] = true;
                    Heap.push(highlights, heap, event.hl_idx);
                } else {
                    active[event.hl_idx] = false;
                }
            }
        }

        // Emit final span after last event if there were any highlights
        // This ensures the line returns to default styling after the last highlight ends
        if (events.items.len > 0 and Heap.winner(highlights, heap, active) == null) {
            const line_width = self.lineWidthAt(@intCast(line_idx));
            Heap.appendSpan(spans, current_col, line_width, 0);
        }
    }

    /// Add highlight by row/col coordinates
    pub fn addHighlightByCoords(
        self: *Self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        style_id: u32,
        priority: u8,
        hl_ref: u16,
    ) TextBufferError!void {
        const char_start = iter_mod.coordsToOffset(&self._rope, start_row, start_col) orelse return TextBufferError.InvalidIndex;
        const char_end = iter_mod.coordsToOffset(&self._rope, end_row, end_col) orelse return TextBufferError.InvalidIndex;
        return self.addHighlightByCharRange(char_start, char_end, style_id, priority, hl_ref);
    }

    /// Add highlight by character range
    pub fn addHighlightByCharRange(
        self: *Self,
        char_start: u32,
        char_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: u16,
    ) TextBufferError!void {
        return self.addHighlightByCharRangeInternal(char_start, char_end, style_id, priority, hl_ref, false);
    }

    fn addHighlightByCharRangeInternal(
        self: *Self,
        char_start: u32,
        char_end: u32,
        style_id: u32,
        priority: u8,
        hl_ref: u16,
        internal: bool,
    ) TextBufferError!void {
        const line_count = self.getLineCount();
        if (char_start >= char_end or line_count == 0) {
            return;
        }

        // Walk lines to find which lines this highlight affects
        const Context = struct {
            buffer: *Self,
            char_start: u32,
            char_end: u32,
            style_id: u32,
            priority: u8,
            hl_ref: u16,
            internal: bool,
            start_line_idx: ?usize = null,

            fn callback(ctx_ptr: *anyopaque, line_info: LineInfo) void {
                const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));
                const line_start_col_offset = line_info.col_offset;
                const line_end_col_offset = line_info.col_offset + line_info.width_cols;

                // Skip lines before the highlight
                if (line_end_col_offset <= ctx.char_start) return;
                // Stop after the highlight ends
                if (line_start_col_offset >= ctx.char_end) return;

                // This line overlaps with the highlight
                const col_start = if (ctx.char_start > line_start_col_offset)
                    ctx.char_start - line_start_col_offset
                else
                    0;

                const col_end = if (ctx.char_end < line_end_col_offset)
                    ctx.char_end - line_start_col_offset
                else
                    line_info.width_cols;

                ctx.buffer.addHighlightInternal(
                    line_info.line_idx,
                    col_start,
                    col_end,
                    ctx.style_id,
                    ctx.priority,
                    ctx.hl_ref,
                    ctx.internal,
                ) catch {};
            }
        };

        var ctx: Context = .{
            .buffer = self,
            .char_start = char_start,
            .char_end = char_end,
            .style_id = style_id,
            .priority = priority,
            .hl_ref = hl_ref,
            .internal = internal,
        };
        iter_mod.walkLines(&self._rope, &ctx, Context.callback, false);
    }

    fn clearInternalHighlights(self: *Self) void {
        var style_ids: std.ArrayListUnmanaged(u32) = .empty;
        defer style_ids.deinit(self.global_allocator);
        var annotations = self.annotations.iterator();
        while (annotations.next() catch return) |annotation| {
            if (annotation.payload.namespace == styled_text_owner) {
                style_ids.append(self.global_allocator, annotation.payload.style_id) catch return;
            }
        }

        var changed = false;
        for (self.external_line_highlights.items) |*hl_list| {
            var i: usize = 0;
            while (i < hl_list.items.len) {
                if (hl_list.items[i].internal) {
                    _ = hl_list.orderedRemove(i);
                    changed = true;
                    continue;
                }
                i += 1;
            }
        }
        self.internal_highlight_count = 0;
        const removed = self.annotations.clearOwner(styled_text_owner) catch 0;
        if (removed != 0) {
            for (style_ids.items) |style_id| self.releaseInternalStyle(style_id);
            self.markPaintDirty();
        } else if (changed) {
            self.projection_epoch +%= 1;
        }
    }

    /// Remove all highlights with a specific reference ID
    pub fn removeHighlightsByRef(self: *Self, hl_ref: u16) void {
        for (self.external_line_highlights.items, 0..) |*hl_list, line_idx| {
            var i: usize = 0;
            var changed = false;
            while (i < hl_list.items.len) {
                if (hl_list.items[i].hl_ref == hl_ref) {
                    if (hl_list.items[i].internal and self.internal_highlight_count > 0) {
                        self.internal_highlight_count -= 1;
                    }
                    _ = hl_list.orderedRemove(i);
                    changed = true;
                    continue;
                }
                i += 1;
            }
            if (changed) {
                self.markPaintDirty();
                if (self.highlight_batch_depth == 0) {
                    self.projectLine(line_idx) catch {};
                } else {
                    self.markLineSpansDirty(line_idx);
                }
            }
        }
    }

    /// Clear all highlights from a specific line
    pub fn clearLineHighlights(self: *Self, line_idx: usize) void {
        if (line_idx < self.getLineCount()) {
            var candidate = self.annotations.clone(self.global_allocator) catch return;
            const line_start = self.normalizedLineStart(@intCast(line_idx)) catch {
                candidate.deinit();
                return;
            };
            const line_end = if (line_idx + 1 < self.getLineCount())
                self.normalizedLineStart(@intCast(line_idx + 1)) catch {
                    candidate.deinit();
                    return;
                }
            else
                self.getByteSize();
            candidate.clipRange(line_start, line_end) catch {
                candidate.deinit();
                return;
            };
            self.publishAnnotationCandidate(candidate) catch return;
        }
        var external_changed = false;
        if (line_idx < self.external_line_highlights.items.len) {
            external_changed = self.external_line_highlights.items[line_idx].items.len != 0;
            for (self.external_line_highlights.items[line_idx].items) |hl| {
                if (hl.internal and self.internal_highlight_count > 0) self.internal_highlight_count -= 1;
            }
            self.external_line_highlights.items[line_idx].clearRetainingCapacity();
        }
        if (line_idx >= self.getLineCount() and external_changed) self.markPaintDirty();
        if (self.highlight_batch_depth != 0) self.markLineSpansDirty(line_idx);
    }

    /// Clear all highlights
    pub fn clearAllHighlights(self: *Self) void {
        var candidate = self.annotations.clone(self.global_allocator) catch return;
        var ids: std.ArrayListUnmanaged(u64) = .empty;
        defer ids.deinit(self.global_allocator);
        var it = candidate.iterator();
        while (it.next() catch {
            candidate.deinit();
            return;
        }) |annotation| {
            if (annotation.payload.kind_flags & style_range_kind != 0) ids.append(self.global_allocator, annotation.id()) catch {
                candidate.deinit();
                return;
            };
        }
        for (ids.items) |id| _ = candidate.remove(id) catch {
            candidate.deinit();
            return;
        };
        self.publishAnnotationCandidate(candidate) catch return;
        for (self.external_line_highlights.items) |*hl_list| hl_list.clearRetainingCapacity();
        self.internal_highlight_count = 0;
        for (self.line_spans.items) |*span_list| span_list.clearRetainingCapacity();
    }

    /// Get highlights for a specific line
    pub fn getLineHighlightsSlice(self: *Self, line_idx: usize) []const Highlight {
        return self.getLineHighlights(line_idx);
    }

    /// Get total number of highlights across all lines
    pub fn getHighlightCount(self: *Self) u32 {
        var count: u64 = 0;
        for (self.external_line_highlights.items) |highlights| count += highlights.items.len;
        var it = self.annotations.iterator();
        while (it.next() catch return std.math.maxInt(u32)) |annotation| {
            count += @intFromBool(annotation.payload.kind_flags & style_range_kind != 0);
            if (count > std.math.maxInt(u32)) return std.math.maxInt(u32);
        }
        return @intCast(count);
    }

    pub fn createStyleRange(
        self: *Self,
        owner: u32,
        start_byte: u32,
        end_byte: u32,
        style_id: u32,
        priority: u8,
    ) TextBufferError!u64 {
        if (start_byte > end_byte or end_byte > self.getByteSize()) return TextBufferError.InvalidByteOffset;
        _ = try self.normalizedByteOffsetToLocation(start_byte);
        _ = try self.normalizedByteOffsetToLocation(end_byte);
        const id = self.annotations.addRange(.{
            .start_byte = start_byte,
            .end_byte = end_byte,
        }, .{
            .namespace = owner,
            .style_id = style_id,
            .priority = priority,
            .internal = true,
            .kind_flags = style_range_kind,
        }) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            else => return TextBufferError.InvalidDimensions,
        };
        self.markPaintDirty();
        return id;
    }

    pub fn createStyleValueRange(
        self: *Self,
        owner: u32,
        start_byte: u32,
        end_byte: u32,
        style_value: StyledChunk,
        priority: u8,
    ) TextBufferError!u64 {
        const style_id = try self.acquireInternalStyle(style_value);
        errdefer self.releaseInternalStyle(style_id);
        return self.createStyleRange(owner, start_byte, end_byte, style_id, priority);
    }

    pub fn getDocumentRange(self: *Self, id: u64) ?DocumentRange {
        const annotation = self.annotations.get(id) orelse return null;
        if (annotation.payload.kind_flags & document_range_kind == 0 or annotation.mark != .range) return null;
        return .{
            .id = id,
            .owner = annotation.payload.namespace,
            .start_byte = @min(annotation.mark.range.start_byte, annotation.mark.range.end_byte),
            .end_byte = @max(annotation.mark.range.start_byte, annotation.mark.range.end_byte),
            .styled = annotation.payload.kind_flags & style_range_kind != 0,
        };
    }

    pub fn getDocumentRangeText(self: *Self, id: u64, output: []u8) ?usize {
        const range = self.getDocumentRange(id) orelse return null;
        const length: usize = range.end_byte - range.start_byte;
        if (output.len < length) return null;
        return self.copyNormalizedByteRange(range.start_byte, range.end_byte, output);
    }

    pub fn measureDocumentRange(self: *Self, id: u64) TextBufferError!u32 {
        const range = self.getDocumentRange(id) orelse return TextBufferError.InvalidIndex;
        const length: usize = range.end_byte - range.start_byte;
        const text = self.global_allocator.alloc(u8, length) catch return TextBufferError.OutOfMemory;
        defer self.global_allocator.free(text);
        if (self.copyNormalizedByteRange(range.start_byte, range.end_byte, text) != length) return TextBufferError.InvalidByteOffset;
        return self.measureText(text);
    }

    pub fn removeStyleRange(self: *Self, id: u64) TextBufferError!bool {
        const old = self.annotations.get(id);
        const removed = self.annotations.remove(id) catch return TextBufferError.InvalidDimensions;
        if (removed) {
            if (old) |annotation| self.releaseInternalStyle(annotation.payload.style_id);
            self.markPaintDirty();
        }
        return removed;
    }

    pub fn clearStyleOwner(self: *Self, owner: u32) TextBufferError!u32 {
        var styles: std.ArrayListUnmanaged(u32) = .empty;
        defer styles.deinit(self.global_allocator);
        var annotations = self.annotations.iterator();
        while (annotations.next() catch return TextBufferError.InvalidDimensions) |annotation| {
            if (annotation.payload.namespace == owner) try styles.append(self.global_allocator, annotation.payload.style_id);
        }
        const removed = self.annotations.clearOwner(owner) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            else => return TextBufferError.InvalidDimensions,
        };
        if (removed != 0) {
            for (styles.items) |style_id| self.releaseInternalStyle(style_id);
            self.markPaintDirty();
        }
        return std.math.cast(u32, removed) orelse TextBufferError.InvalidDimensions;
    }

    fn acquireInternalStyle(self: *Self, chunk: StyledChunk) TextBufferError!u32 {
        return self.acquireInternalStyleFor(chunk, self.syntax_style);
    }

    fn acquireInternalStyleFor(self: *Self, chunk: StyledChunk, syntax_style: ?*const SyntaxStyle) TextBufferError!u32 {
        switch (chunk.style_kind) {
            .registered => {
                if (chunk.style_id == 0 or chunk.style_id >= internal_style_base or chunk.link_len != 0 or chunk.link_ptr != null) return TextBufferError.InvalidDimensions;
                const source = chunk.syntax_style orelse return TextBufferError.InvalidDimensions;
                const attached = syntax_style orelse return TextBufferError.InvalidDimensions;
                if (source != attached or !attached.isRegisteredStyleId(chunk.style_id)) return TextBufferError.InvalidDimensions;
                return chunk.style_id;
            },
            .value => if (chunk.style_id != 0 or chunk.syntax_style != null) return TextBufferError.InvalidDimensions,
        }
        const fg = if (chunk.fg_ptr) |ptr| utils.ptrToRGBA(ptr) else null;
        const bg = if (chunk.bg_ptr) |ptr| utils.ptrToRGBA(ptr) else null;
        const link_url = if (chunk.link_len == 0)
            null
        else if (chunk.link_ptr) |ptr|
            ptr[0..chunk.link_len]
        else
            return TextBufferError.InvalidDimensions;
        const definition: ss.StyleDefinition = .{ .fg = fg, .bg = bg, .attributes = chunk.attributes };
        for (self.internal_style_slots.items, 0..) |*slot, index| {
            const links_equal = if (slot.link_url) |existing|
                link_url != null and std.mem.eql(u8, existing, link_url.?)
            else
                link_url == null;
            if (slot.refs != 0 and std.meta.eql(slot.definition, definition) and links_equal) {
                if (slot.refs == std.math.maxInt(u32)) return TextBufferError.InvalidDimensions;
                slot.refs += 1;
                return internal_style_base | @as(u32, @intCast(index));
            }
        }

        const owned_link = if (link_url) |url| self.global_allocator.dupe(u8, url) catch return TextBufferError.OutOfMemory else null;
        errdefer if (owned_link) |url| self.global_allocator.free(url);
        for (self.internal_style_slots.items, 0..) |*slot, index| {
            if (slot.refs != 0) continue;
            slot.* = .{
                .definition = definition,
                .resolved_syntax_style = null,
                .resolved_style_id = 0,
                .link_url = owned_link,
                .link_id = 0,
                .refs = 1,
            };
            return internal_style_base | @as(u32, @intCast(index));
        }

        if (self.internal_style_slots.items.len >= internal_style_base) return TextBufferError.InvalidDimensions;
        try self.internal_style_slots.ensureUnusedCapacity(self.global_allocator, 1);
        const slot_id = internal_style_base | @as(u32, @intCast(self.internal_style_slots.items.len));
        self.internal_style_slots.appendAssumeCapacity(.{
            .definition = definition,
            .resolved_syntax_style = null,
            .resolved_style_id = 0,
            .link_url = owned_link,
            .link_id = 0,
            .refs = 1,
        });
        return slot_id;
    }

    fn releaseInternalStyle(self: *Self, slot_id: u32) void {
        if (slot_id & internal_style_base == 0) return;
        const index: usize = slot_id & ~internal_style_base;
        if (index >= self.internal_style_slots.items.len) return;
        const slot = &self.internal_style_slots.items[index];
        if (slot.refs == 0) return;
        slot.refs -= 1;
        if (slot.refs != 0) return;
        self.invalidateResolvedStyle(slot, null);
        if (slot.link_url) |url| self.global_allocator.free(url);
        slot.link_url = null;
    }

    fn retainInternalStyle(self: *Self, slot_id: u32) TextBufferError!void {
        if (slot_id & internal_style_base == 0) return;
        const index: usize = slot_id & ~internal_style_base;
        if (index >= self.internal_style_slots.items.len) return TextBufferError.InvalidDimensions;
        const slot = &self.internal_style_slots.items[index];
        if (slot.refs == 0 or slot.refs == std.math.maxInt(u32)) return TextBufferError.InvalidDimensions;
        slot.refs += 1;
    }

    fn resolveAnnotationStyle(self: *Self, slot_id: u32) TextBufferError!u32 {
        if (slot_id & internal_style_base == 0) return slot_id;
        const index: usize = slot_id & ~internal_style_base;
        if (index >= self.internal_style_slots.items.len) return 0;
        const style = self.syntax_style orelse return 0;
        const slot = &self.internal_style_slots.items[index];
        if (slot.resolved_syntax_style == style) return slot.resolved_style_id;
        var definition = slot.definition;
        if (slot.link_url) |url| {
            const link_id = self.link_pool.acquire(url) catch return TextBufferError.OutOfMemory;
            slot.link_id = link_id;
            definition.attributes = ansi.TextAttributes.setLinkId(definition.attributes, link_id);
        }
        errdefer if (slot.link_id != 0) {
            self.link_pool.decref(slot.link_id) catch {};
            slot.link_id = 0;
        };
        slot.resolved_style_id = (@constCast(style)).registerAnonymousStyleDefinition(definition) catch return TextBufferError.OutOfMemory;
        slot.resolved_syntax_style = style;
        return slot.resolved_style_id;
    }

    /// Normalizes every structural chunk independently. In particular, a CR at
    /// the end of one child and an LF at the start of the next child remain two
    /// line breaks, while CRLF inside one child remains one line break.
    fn normalizeStyledChunks(
        chunks: []const StyledChunk,
        output: []u8,
        boundaries: []u32,
    ) TextBufferError!usize {
        if (boundaries.len != chunks.len + 1) return TextBufferError.InvalidDimensions;
        boundaries[0] = 0;
        var output_offset: usize = 0;
        for (chunks, 0..) |chunk, chunk_index| {
            var previous_was_cr = false;
            for (chunk.text_ptr[0..chunk.text_len]) |byte| {
                if (byte == '\n' and previous_was_cr) {
                    previous_was_cr = false;
                    continue;
                }
                if (output_offset >= output.len) return TextBufferError.InvalidDimensions;
                output[output_offset] = if (byte == '\r') '\n' else byte;
                output_offset += 1;
                previous_was_cr = byte == '\r';
            }
            boundaries[chunk_index + 1] = std.math.cast(u32, output_offset) orelse return TextBufferError.InvalidDimensions;
        }
        return output_offset;
    }

    pub fn replaceStyledRangeBytes(
        self: *Self,
        start_byte: u32,
        end_byte: u32,
        chunks: []const StyledChunk,
        owner: u32,
    ) TextBufferError!SpliceResult {
        if (start_byte > end_byte or end_byte > self.getByteSize()) return TextBufferError.InvalidByteOffset;
        var total_len: usize = 0;
        for (chunks) |chunk| total_len = std.math.add(usize, total_len, chunk.text_len) catch return TextBufferError.InvalidDimensions;
        if (total_len > std.math.maxInt(u32)) return TextBufferError.InvalidDimensions;
        const replacement = self.global_allocator.alloc(u8, total_len) catch return TextBufferError.OutOfMemory;
        defer self.global_allocator.free(replacement);
        var offset: usize = 0;
        for (chunks) |chunk| {
            if (chunk.text_len == 0) continue;
            @memcpy(replacement[offset .. offset + chunk.text_len], chunk.text_ptr[0..chunk.text_len]);
            offset += chunk.text_len;
        }

        var acquired_styles: std.ArrayListUnmanaged(u32) = .empty;
        defer acquired_styles.deinit(self.global_allocator);
        var styles_committed = false;
        defer if (!styles_committed) for (acquired_styles.items) |style_id| self.releaseInternalStyle(style_id);

        const normalized_boundaries = self.global_allocator.alloc(u32, chunks.len + 1) catch return TextBufferError.OutOfMemory;
        defer self.global_allocator.free(normalized_boundaries);
        const normalized_len = try normalizeStyledChunks(chunks, replacement, normalized_boundaries);
        const normalized_offset: u32 = @intCast(normalized_len);

        var candidate = self.annotations.clone(self.global_allocator) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            else => return TextBufferError.InvalidDimensions,
        };
        var candidate_owned = true;
        defer if (candidate_owned) candidate.deinit();
        candidate.clipOwnerRange(owner, start_byte, end_byte) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            else => return TextBufferError.InvalidDimensions,
        };
        candidate.splice(start_byte, end_byte - start_byte, normalized_offset) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            else => return TextBufferError.InvalidDimensions,
        };

        // A clipped range crossing both replacement edges was split and needs
        // one additional ownership reference for its new right-hand annotation.
        var generated_count: usize = 0;
        var candidate_iterator = candidate.iterator();
        while (candidate_iterator.next() catch return TextBufferError.InvalidDimensions) |annotation| {
            generated_count += @intFromBool(self.annotations.get(annotation.id()) == null);
        }
        const rollback_count = std.math.add(usize, generated_count, chunks.len) catch return TextBufferError.InvalidDimensions;
        try acquired_styles.ensureTotalCapacity(self.global_allocator, rollback_count);

        candidate_iterator = candidate.iterator();
        while (candidate_iterator.next() catch return TextBufferError.InvalidDimensions) |annotation| {
            if (self.annotations.get(annotation.id()) == null) {
                try self.retainInternalStyle(annotation.payload.style_id);
                acquired_styles.appendAssumeCapacity(annotation.payload.style_id);
            }
        }

        for (chunks, 0..) |chunk, chunk_index| {
            const local_start = normalized_boundaries[chunk_index];
            const local_end = normalized_boundaries[chunk_index + 1];
            if (local_start >= local_end) continue;
            const style_id = try self.acquireInternalStyle(chunk);
            acquired_styles.appendAssumeCapacity(style_id);
            _ = candidate.addRange(.{
                .start_byte = std.math.add(u32, start_byte, local_start) catch return TextBufferError.InvalidDimensions,
                .end_byte = std.math.add(u32, start_byte, local_end) catch return TextBufferError.InvalidDimensions,
            }, .{
                .namespace = owner,
                .style_id = style_id,
                .priority = 1,
                .internal = true,
                .kind_flags = style_range_kind,
                .splice_policy = .delete_when_covered,
            }) catch |err| switch (err) {
                error.OutOfMemory => return TextBufferError.OutOfMemory,
                else => return TextBufferError.InvalidDimensions,
            };
        }

        const result = try self.replaceNormalizedBytesWithAnnotations(start_byte, end_byte, replacement[0..normalized_len], &candidate, false);
        candidate_owned = false;
        styles_committed = true;
        return result;
    }

    pub const PreparedDocumentOperations = struct {
        const PreparedStyleUpdate = struct {
            id: u64,
            old_style_id: u32,
            style_id: u32,
            old_kind_flags: u32,
            kind_flags: u32,
            first_line: u32,
            last_line: u32,
        };

        owner: *Self,
        annotations: TextAnnotations,
        transaction_arena: *std.heap.ArenaAllocator,
        rope: UnifiedRope,
        staged_storage: ?[]u8,
        staged_mem_id: ?u8,
        acquired_styles: std.ArrayListUnmanaged(u32),
        released_styles: std.ArrayListUnmanaged(u32),
        created_ids: []u64,
        content_changed: bool,
        annotations_changed: bool,
        initial_style_slot_len: usize,
        previous_syntax_style: ?*const SyntaxStyle,
        next_syntax_style: ?*const SyntaxStyle,
        syntax_listener_prepared: bool,
        prepared_link_releases: usize,
        style_update_storage: []PreparedStyleUpdate = &.{},
        style_updates: []PreparedStyleUpdate = &.{},
        style_only: bool = false,
        payload_only: bool = false,
        committed: bool = false,

        pub fn ids(self: *const PreparedDocumentOperations) []const u64 {
            return self.created_ids;
        }

        pub fn commit(self: *PreparedDocumentOperations, out_ids: []u64) void {
            std.debug.assert(!self.committed and out_ids.len == self.created_ids.len);
            const owner = self.owner;
            if (self.payload_only) {
                const id = owner.mem_registry.register(self.staged_storage.?, true) catch unreachable;
                std.debug.assert(id == self.staged_mem_id.?);
                owner.owned_backing_ids[id] = true;
                self.staged_storage = null;
                owner._rope = self.rope;
                owner.rope_transaction_arenas.appendAssumeCapacity(self.transaction_arena);
                owner.sweepUnreachableBacking();
                owner.markTextBytesDirty();
                self.committed = true;
                return;
            }
            if (self.style_only) {
                for (self.style_updates) |update| {
                    owner.annotations.commitPreparedStyle(update.id, update.style_id, update.kind_flags);
                    owner.invalidateProjectedLineRange(update.first_line, update.last_line);
                }
                for (self.released_styles.items) |style_id| owner.releaseInternalStyle(style_id);
                if (self.style_updates.len != 0) owner.annotation_epoch +%= 1;
                self.committed = true;
                return;
            }
            if (self.previous_syntax_style != self.next_syntax_style) {
                if (self.previous_syntax_style) |previous| {
                    owner.invalidateResolvedStyles(previous);
                    (@constCast(previous)).offDestroy(@ptrCast(owner), onSyntaxStyleDestroyed);
                }
                owner.syntax_style = self.next_syntax_style;
            }
            if (self.content_changed) {
                if (self.staged_storage) |storage| {
                    const id = owner.mem_registry.register(storage, true) catch unreachable;
                    std.debug.assert(id == self.staged_mem_id.?);
                    owner.owned_backing_ids[id] = true;
                    self.staged_storage = null;
                }
                owner._rope = self.rope;
                owner.rope_transaction_arenas.appendAssumeCapacity(self.transaction_arena);
                owner.sweepUnreachableBacking();
            } else {
                self.transaction_arena.deinit();
                owner.global_allocator.destroy(self.transaction_arena);
            }
            var old_annotations = owner.annotations;
            owner.annotations = self.annotations;
            old_annotations.deinit();
            for (self.released_styles.items) |style_id| owner.releaseInternalStyle(style_id);
            @memcpy(out_ids, self.created_ids);
            if (self.annotations_changed) owner.annotation_epoch +%= 1;
            if (self.content_changed) {
                owner.markAllViewsDirty();
            } else if (self.annotations_changed) {
                owner.projection_epoch +%= 1;
            }
            self.committed = true;
        }

        pub fn deinit(self: *PreparedDocumentOperations) void {
            const owner = self.owner;
            if (self.payload_only) {
                if (!self.committed) {
                    self.transaction_arena.deinit();
                    owner.global_allocator.destroy(self.transaction_arena);
                    owner.global_allocator.free(self.staged_storage.?);
                }
                self.* = undefined;
                return;
            }
            if (self.style_only) {
                if (!self.committed) {
                    for (self.acquired_styles.items) |style_id| owner.releaseInternalStyle(style_id);
                    owner.internal_style_slots.shrinkRetainingCapacity(self.initial_style_slot_len);
                }
                self.acquired_styles.deinit(owner.global_allocator);
                self.released_styles.deinit(owner.global_allocator);
                owner.global_allocator.free(self.style_update_storage);
                self.* = undefined;
                return;
            }
            if (!self.committed) {
                if (self.syntax_listener_prepared) {
                    (@constCast(self.next_syntax_style.?)).offDestroy(@ptrCast(owner), onSyntaxStyleDestroyed);
                }
                for (self.acquired_styles.items) |style_id| owner.releaseInternalStyle(style_id);
                owner.internal_style_slots.shrinkRetainingCapacity(self.initial_style_slot_len);
                self.annotations.deinit();
                self.transaction_arena.deinit();
                owner.global_allocator.destroy(self.transaction_arena);
                if (self.staged_storage) |storage| owner.global_allocator.free(storage);
            }
            self.acquired_styles.deinit(owner.global_allocator);
            self.released_styles.deinit(owner.global_allocator);
            owner.global_allocator.free(self.created_ids);
            self.* = undefined;
        }
    };

    fn invalidateProjectedLineRange(self: *Self, first_line: u32, last_line: u32) void {
        if (first_line > last_line or first_line >= self.line_projection_epochs.items.len) return;
        const end = @min(@as(usize, last_line) + 1, self.line_projection_epochs.items.len);
        for (self.line_projection_epochs.items[first_line..end]) |*epoch| epoch.* = self.projection_epoch -% 1;
    }

    fn prepareStyleOnlyDocumentOperations(
        self: *Self,
        operations: []const DocumentOperation,
        output_id_count: usize,
    ) TextBufferError!?PreparedDocumentOperations {
        if (operations.len == 0 or output_id_count != 0) return null;
        var next_syntax_style = self.syntax_style;
        for (operations) |operation| {
            if (operation.kind != .update_style or operation.chunks.len != 0 or operation.ranges.len != 0) return null;
            if (operation.style.style_kind == .registered) {
                if (next_syntax_style != self.syntax_style and next_syntax_style != operation.style.syntax_style) return TextBufferError.InvalidDimensions;
                next_syntax_style = operation.style.syntax_style;
            }
        }
        // Switching the document's registered source invalidates every resolved
        // slot, so retain the full candidate path for that uncommon operation.
        if (next_syntax_style != self.syntax_style) return null;

        const initial_style_slot_len = self.internal_style_slots.items.len;
        var acquired_styles: std.ArrayListUnmanaged(u32) = .empty;
        errdefer acquired_styles.deinit(self.global_allocator);
        var released_styles: std.ArrayListUnmanaged(u32) = .empty;
        errdefer released_styles.deinit(self.global_allocator);
        try acquired_styles.ensureTotalCapacity(self.global_allocator, operations.len);
        try released_styles.ensureTotalCapacity(self.global_allocator, operations.len);
        const updates = self.global_allocator.alloc(PreparedDocumentOperations.PreparedStyleUpdate, operations.len) catch return TextBufferError.OutOfMemory;
        errdefer self.global_allocator.free(updates);
        var acquired_owned = true;
        errdefer if (acquired_owned) {
            for (acquired_styles.items) |style_id| self.releaseInternalStyle(style_id);
            self.internal_style_slots.shrinkRetainingCapacity(initial_style_slot_len);
        };
        var pending_styles = std.AutoHashMap(u64, usize).init(self.global_allocator);
        defer pending_styles.deinit();
        try pending_styles.ensureTotalCapacity(@intCast(operations.len));

        var update_count: usize = 0;
        for (operations) |operation| {
            const existing = self.annotations.get(operation.target_id) orelse return TextBufferError.InvalidIndex;
            if (existing.payload.namespace != operation.owner or
                existing.payload.kind_flags & document_range_kind == 0 or existing.mark != .range)
            {
                return TextBufferError.InvalidIndex;
            }
            const styled = styleValuePaints(operation.style);
            const style_id = if (styled) try self.acquireInternalStyleFor(operation.style, next_syntax_style) else 0;
            const kind_flags = document_range_kind | if (styled) style_range_kind else 0;
            const pending_index = pending_styles.get(operation.target_id);
            const previous_style_id = if (pending_index) |index| updates[index].style_id else existing.payload.style_id;
            const previous_kind_flags = if (pending_index) |index| updates[index].kind_flags else existing.payload.kind_flags;
            if (style_id == previous_style_id and kind_flags == previous_kind_flags) {
                if (styled) self.releaseInternalStyle(style_id);
                continue;
            }
            if (styled) acquired_styles.appendAssumeCapacity(style_id);
            released_styles.appendAssumeCapacity(previous_style_id);
            if (pending_index) |index| {
                updates[index].style_id = style_id;
                updates[index].kind_flags = kind_flags;
                continue;
            }
            const range = existing.mark.range;
            const start = @min(range.start_byte, range.end_byte);
            const end = @max(range.start_byte, range.end_byte);
            var first_line: u32 = 1;
            var last_line: u32 = 0;
            if (start < end) {
                first_line = try self.normalizedByteRowInNode(self._rope.root, start, 0);
                last_line = try self.normalizedByteRowInNode(self._rope.root, end - 1, 0);
            }
            updates[update_count] = .{
                .id = operation.target_id,
                .old_style_id = existing.payload.style_id,
                .style_id = style_id,
                .old_kind_flags = existing.payload.kind_flags,
                .kind_flags = kind_flags,
                .first_line = first_line,
                .last_line = last_line,
            };
            pending_styles.putAssumeCapacity(operation.target_id, update_count);
            update_count += 1;
        }
        var compacted_count: usize = 0;
        for (updates[0..update_count]) |update| {
            if (update.style_id == update.old_style_id and update.kind_flags == update.old_kind_flags) continue;
            updates[compacted_count] = update;
            compacted_count += 1;
        }
        update_count = compacted_count;
        self.annotations.prepareStyleUpdates(update_count) catch return TextBufferError.InvalidDimensions;
        self.link_pool.prepareReleases(released_styles.items.len) catch return TextBufferError.OutOfMemory;

        acquired_owned = false;
        return .{
            .owner = self,
            .annotations = undefined,
            .transaction_arena = undefined,
            .rope = undefined,
            .staged_storage = null,
            .staged_mem_id = null,
            .acquired_styles = acquired_styles,
            .released_styles = released_styles,
            .created_ids = &.{},
            .content_changed = false,
            .annotations_changed = update_count != 0,
            .initial_style_slot_len = initial_style_slot_len,
            .previous_syntax_style = self.syntax_style,
            .next_syntax_style = self.syntax_style,
            .syntax_listener_prepared = false,
            .prepared_link_releases = released_styles.items.len,
            .style_update_storage = updates,
            .style_updates = updates[0..update_count],
            .style_only = true,
        };
    }

    /// Replaces one printable-ASCII byte run without transforming annotations.
    /// Equal normalized byte length keeps every MarkTree position and payload valid.
    fn preparePayloadOnlyDocumentOperation(
        self: *Self,
        operations: []const DocumentOperation,
        output_id_count: usize,
    ) TextBufferError!?PreparedDocumentOperations {
        if (operations.len != 1 or output_id_count != 0) return null;
        const operation = operations[0];
        if (operation.kind != .replace or !operation.before or !operation.use_target or
            operation.target_mode != .replace or operation.chunks.len != 1 or operation.ranges.len != 0 or
            styleValuePaints(operation.chunks[0])) return null;

        const target = self.annotations.get(operation.target_id) orelse return TextBufferError.InvalidIndex;
        if (target.payload.namespace != operation.owner or target.payload.kind_flags & document_range_kind == 0 or target.mark != .range) return TextBufferError.InvalidIndex;
        const target_mark = target.mark.range;
        const start = @min(target_mark.start_byte, target_mark.end_byte);
        const end = if (operation.anchor_id == 0) @max(target_mark.start_byte, target_mark.end_byte) else blk: {
            const anchor = self.annotations.get(operation.anchor_id) orelse return TextBufferError.InvalidIndex;
            if (anchor.payload.namespace != operation.owner or anchor.payload.kind_flags & document_range_kind == 0 or anchor.mark != .range) return TextBufferError.InvalidIndex;
            break :blk @max(anchor.mark.range.start_byte, anchor.mark.range.end_byte);
        };
        const replacement = operation.chunks[0].text_ptr[0..operation.chunks[0].text_len];
        if (start >= end or replacement.len != end - start) return TextBufferError.InvalidDimensions;

        const storage = self.global_allocator.alloc(u8, replacement.len) catch return TextBufferError.OutOfMemory;
        var storage_owned = true;
        defer if (storage_owned) self.global_allocator.free(storage);
        if (self.copyNormalizedByteRange(start, end, storage) != storage.len) return TextBufferError.InvalidByteOffset;
        for (storage, replacement) |old, new| {
            if (old < 0x20 or old > 0x7e or new < 0x20 or new > 0x7e) return TextBufferError.InvalidDimensions;
        }
        @memcpy(storage, replacement);

        try self.compactRopeTransactionArenasIfNeeded();
        self.mem_registry.prepareRegister() catch return TextBufferError.OutOfMemory;
        const mem_id = self.mem_registry.nextId() orelse return TextBufferError.OutOfMemory;
        try self.rope_transaction_arenas.ensureUnusedCapacity(self.global_allocator, 1);
        const transaction_arena = self.global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        var arena_owned = true;
        defer if (arena_owned) self.global_allocator.destroy(transaction_arena);
        transaction_arena.* = std.heap.ArenaAllocator.init(self.global_allocator);
        defer if (arena_owned) transaction_arena.deinit();
        var segments = try self.textToSegments(self.global_allocator, storage, mem_id, 0, true);
        defer segments.segments.deinit(segments.allocator);
        var candidate_rope = self._rope;
        candidate_rope.allocator = transaction_arena.allocator();
        const root = candidate_rope.prepareReplaceRangeByMetric(start, end, segments.segments.items, &self.byte_splitter) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            error.OutOfBounds => return TextBufferError.InvalidByteOffset,
        };
        candidate_rope.commitPreparedRoot(root);

        storage_owned = false;
        arena_owned = false;
        return .{
            .owner = self,
            .annotations = undefined,
            .transaction_arena = transaction_arena,
            .rope = candidate_rope,
            .staged_storage = storage,
            .staged_mem_id = mem_id,
            .acquired_styles = .empty,
            .released_styles = .empty,
            .created_ids = &.{},
            .content_changed = true,
            .annotations_changed = false,
            .initial_style_slot_len = self.internal_style_slots.items.len,
            .previous_syntax_style = self.syntax_style,
            .next_syntax_style = self.syntax_style,
            .syntax_listener_prepared = false,
            .prepared_link_releases = 0,
            .payload_only = true,
        };
    }

    /// Prepare an ordered operation log without changing live state. Stable IDs
    /// are resolved after each candidate edit; every commit action is reserved
    /// before this function returns.
    pub fn prepareDocumentOperations(
        self: *Self,
        operations: []const DocumentOperation,
        output_id_count: usize,
    ) TextBufferError!PreparedDocumentOperations {
        if (try self.prepareStyleOnlyDocumentOperations(operations, output_id_count)) |prepared| return prepared;
        if (try self.preparePayloadOnlyDocumentOperation(operations, output_id_count)) |prepared| return prepared;
        // Compaction is prepared and published before semantic preparation. If
        // it runs out of memory, this edit is wholly uncommitted and retryable.
        try self.compactRopeTransactionArenasIfNeeded();
        const initial_style_slot_len = self.internal_style_slots.items.len;
        errdefer self.internal_style_slots.shrinkRetainingCapacity(initial_style_slot_len);
        var next_syntax_style = self.syntax_style;
        for (operations) |operation| {
            const styles = [_]StyledChunk{operation.style};
            for (styles) |style_value| if (style_value.style_kind == .registered) {
                if (next_syntax_style != self.syntax_style and next_syntax_style != style_value.syntax_style) return TextBufferError.InvalidDimensions;
                next_syntax_style = style_value.syntax_style;
            };
            for (operation.chunks) |chunk| if (chunk.style_kind == .registered) {
                if (next_syntax_style != self.syntax_style and next_syntax_style != chunk.syntax_style) return TextBufferError.InvalidDimensions;
                next_syntax_style = chunk.syntax_style;
            };
            for (operation.ranges) |range| if (range.style.style_kind == .registered) {
                if (next_syntax_style != self.syntax_style and next_syntax_style != range.style.syntax_style) return TextBufferError.InvalidDimensions;
                next_syntax_style = range.style.syntax_style;
            };
        }
        var output_count: usize = 0;
        var replacement_bytes: usize = 0;
        var content_operation_count: usize = 0;
        for (operations) |operation| {
            output_count = std.math.add(usize, output_count, operation.ranges.len) catch return TextBufferError.InvalidDimensions;
            if (operation.kind == .replace) {
                content_operation_count += 1;
                for (operation.chunks) |chunk| {
                    replacement_bytes = std.math.add(usize, replacement_bytes, chunk.text_len) catch return TextBufferError.InvalidDimensions;
                }
            } else if (operation.ranges.len != 0 or operation.chunks.len != 0) {
                return TextBufferError.InvalidDimensions;
            }
        }
        if (output_count != output_id_count or operations.len == 0) return TextBufferError.InvalidDimensions;

        var candidate_annotations = self.annotations.clone(self.global_allocator) catch |err| switch (err) {
            error.OutOfMemory => return TextBufferError.OutOfMemory,
            else => return TextBufferError.InvalidDimensions,
        };
        var annotations_owned = true;
        defer if (annotations_owned) candidate_annotations.deinit();

        try self.rope_transaction_arenas.ensureUnusedCapacity(self.global_allocator, 1);
        const transaction_arena = self.global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
        var arena_owned = true;
        defer if (arena_owned) self.global_allocator.destroy(transaction_arena);
        transaction_arena.* = std.heap.ArenaAllocator.init(self.global_allocator);
        defer if (arena_owned) transaction_arena.deinit();

        var candidate_registry = self.mem_registry.cloneBorrowed(self.global_allocator) catch return TextBufferError.OutOfMemory;
        defer candidate_registry.deinit();

        const staged_mem_id: ?u8 = if (content_operation_count == 0)
            null
        else
            candidate_registry.nextId() orelse return TextBufferError.OutOfMemory;
        if (content_operation_count != 0) self.mem_registry.prepareRegister() catch return TextBufferError.OutOfMemory;

        var candidate_buffer = self.*;
        candidate_buffer.mem_registry = candidate_registry;
        var staged_storage: ?[]u8 = null;
        var storage_owned = false;
        defer if (storage_owned) self.global_allocator.free(staged_storage.?);
        var storage_used: usize = 0;
        if (content_operation_count != 0) {
            const required_storage = replacement_bytes;
            if (required_storage > std.math.maxInt(u32)) return TextBufferError.InvalidDimensions;
            staged_storage = self.global_allocator.alloc(u8, required_storage) catch return TextBufferError.OutOfMemory;
            storage_owned = true;
            candidate_buffer._rope = self._rope;
            candidate_buffer._rope.allocator = transaction_arena.allocator();
            const id = candidate_buffer.mem_registry.register(staged_storage.?, false) catch return TextBufferError.OutOfMemory;
            std.debug.assert(id == staged_mem_id.?);
            candidate_registry = candidate_buffer.mem_registry;
        } else {
            candidate_buffer._rope = self._rope;
            candidate_buffer._rope.allocator = transaction_arena.allocator();
        }
        candidate_buffer.byte_splitter.ctx = &candidate_buffer;
        candidate_buffer.segment_splitter.ctx = &candidate_buffer;

        var acquired_styles: std.ArrayListUnmanaged(u32) = .empty;
        defer acquired_styles.deinit(self.global_allocator);
        var styles_committed = false;
        defer if (!styles_committed) for (acquired_styles.items) |style_id| self.releaseInternalStyle(style_id);
        var released_styles: std.ArrayListUnmanaged(u32) = .empty;
        defer released_styles.deinit(self.global_allocator);
        const maximum_acquired_styles = std.math.add(usize, output_count + operations.len, self.annotations.count()) catch return TextBufferError.InvalidDimensions;
        try acquired_styles.ensureTotalCapacity(self.global_allocator, maximum_acquired_styles);
        const maximum_released_styles = std.math.add(usize, self.annotations.count(), maximum_acquired_styles) catch return TextBufferError.InvalidDimensions;
        try released_styles.ensureTotalCapacity(self.global_allocator, maximum_released_styles);
        const created_ids = self.global_allocator.alloc(u64, output_id_count) catch return TextBufferError.OutOfMemory;
        var created_ids_owned = true;
        defer if (created_ids_owned) self.global_allocator.free(created_ids);
        var output_index: usize = 0;
        var content_changed = false;
        var annotations_changed = false;

        var operation_index: usize = 0;
        while (operation_index < operations.len) : (operation_index += 1) {
            const operation = operations[operation_index];
            switch (operation.kind) {
                .replace => {
                    var start = operation.start_byte;
                    var end = operation.end_byte;
                    var target_range: ?DocumentRange = null;
                    if (operation.use_target) {
                        const annotation = candidate_annotations.get(operation.target_id) orelse return TextBufferError.InvalidIndex;
                        if (annotation.payload.namespace != operation.owner or annotation.payload.kind_flags & document_range_kind == 0 or annotation.mark != .range) return TextBufferError.InvalidIndex;
                        const mark = annotation.mark.range;
                        const target: DocumentRange = .{
                            .id = operation.target_id,
                            .owner = annotation.payload.namespace,
                            .start_byte = @min(mark.start_byte, mark.end_byte),
                            .end_byte = @max(mark.start_byte, mark.end_byte),
                            .styled = annotation.payload.kind_flags & style_range_kind != 0,
                        };
                        target_range = target;
                        switch (operation.target_mode) {
                            .replace => {
                                start = target.start_byte;
                                end = if (operation.anchor_id == 0) target.end_byte else blk: {
                                    const anchor = candidate_annotations.get(operation.anchor_id) orelse return TextBufferError.InvalidIndex;
                                    if (anchor.payload.namespace != operation.owner or anchor.payload.kind_flags & document_range_kind == 0 or anchor.mark != .range) return TextBufferError.InvalidIndex;
                                    break :blk @max(anchor.mark.range.start_byte, anchor.mark.range.end_byte);
                                };
                            },
                            .before => start = target.start_byte,
                            .after => start = target.end_byte,
                        }
                        if (operation.target_mode != .replace) end = start;
                        if (operation.anchor_id != 0 and target_range != null) target_range.?.end_byte = end;
                    }
                    if (start > end or end > candidate_buffer.getByteSize()) return TextBufferError.InvalidByteOffset;

                    var total_raw: usize = 0;
                    for (operation.chunks) |chunk| total_raw = std.math.add(usize, total_raw, chunk.text_len) catch return TextBufferError.InvalidDimensions;
                    const raw_start = storage_used;
                    const raw_capacity_end = std.math.add(usize, raw_start, total_raw) catch return TextBufferError.InvalidDimensions;
                    if (raw_capacity_end > staged_storage.?.len) return TextBufferError.InvalidDimensions;
                    const boundaries = self.global_allocator.alloc(u32, operation.chunks.len + 1) catch return TextBufferError.OutOfMemory;
                    defer self.global_allocator.free(boundaries);
                    const normalized_len = try normalizeStyledChunks(operation.chunks, staged_storage.?[raw_start..raw_capacity_end], boundaries);
                    const normalized_offset: u32 = @intCast(normalized_len);
                    const raw_end = raw_start + normalized_len;
                    storage_used = raw_end;

                    var segments = try candidate_buffer.textToSegments(
                        self.global_allocator,
                        staged_storage.?[raw_start..raw_end],
                        staged_mem_id.?,
                        @intCast(raw_start),
                        false,
                    );
                    defer segments.segments.deinit(segments.allocator);
                    const EnclosingRange = struct {
                        id: u64,
                        range: TextAnnotations.RangeInput,
                    };
                    var enclosing_ranges: std.ArrayListUnmanaged(EnclosingRange) = .empty;
                    defer enclosing_ranges.deinit(self.global_allocator);
                    if (target_range) |target| {
                        const EnclosingContext = struct {
                            allocator: Allocator,
                            output: *std.ArrayListUnmanaged(EnclosingRange),
                            target: DocumentRange,

                            fn visit(ctx: *@This(), annotation: TextAnnotations.Annotation) !void {
                                if (annotation.id() == ctx.target.id or annotation.payload.kind_flags & document_range_kind == 0 or annotation.mark != .range) return;
                                const mark = annotation.mark.range;
                                if (mark.start_byte > ctx.target.start_byte or mark.end_byte < ctx.target.end_byte) return;
                                try ctx.output.append(ctx.allocator, .{
                                    .id = annotation.id(),
                                    .range = .{
                                        .start_byte = mark.start_byte,
                                        .end_byte = mark.end_byte,
                                        .start_gravity = mark.start_gravity,
                                        .end_gravity = mark.end_gravity,
                                    },
                                });
                            }
                        };
                        var enclosing_context: EnclosingContext = .{
                            .allocator = self.global_allocator,
                            .output = &enclosing_ranges,
                            .target = target,
                        };
                        candidate_annotations.visitOverlapping(target.start_byte, target.end_byte, &enclosing_context, EnclosingContext.visit) catch return TextBufferError.OutOfMemory;
                    }
                    candidate_annotations.splice(start, end - start, normalized_offset) catch |err| switch (err) {
                        error.OutOfMemory => return TextBufferError.OutOfMemory,
                        else => return TextBufferError.InvalidDimensions,
                    };

                    if (target_range) |target| {
                        const transformed = candidate_annotations.get(target.id) orelse return TextBufferError.InvalidIndex;
                        if (transformed.mark != .range) return TextBufferError.InvalidIndex;
                        const transformed_range = transformed.mark.range;
                        if (!(candidate_annotations.updateRange(target.id, .{
                            .start_byte = start,
                            .end_byte = std.math.add(u32, start, normalized_offset) catch return TextBufferError.InvalidDimensions,
                            .start_gravity = transformed_range.start_gravity,
                            .end_gravity = transformed_range.end_gravity,
                        }) catch return TextBufferError.InvalidDimensions)) return TextBufferError.InvalidIndex;
                    }

                    for (enclosing_ranges.items) |enclosing| {
                        const retained_end = enclosing.range.end_byte - (end - start);
                        if (!(candidate_annotations.updateRange(enclosing.id, .{
                            .start_byte = enclosing.range.start_byte,
                            .end_byte = std.math.add(u32, retained_end, normalized_offset) catch return TextBufferError.InvalidDimensions,
                            .start_gravity = enclosing.range.start_gravity,
                            .end_gravity = enclosing.range.end_gravity,
                        }) catch return TextBufferError.InvalidDimensions)) return TextBufferError.InvalidIndex;
                    }

                    for (operation.ranges) |range| {
                        if (range.remove) {
                            if (range.id == 0) return TextBufferError.InvalidIndex;
                            const existing = candidate_annotations.get(range.id) orelse return TextBufferError.InvalidIndex;
                            if (existing.payload.namespace != operation.owner or existing.payload.kind_flags & document_range_kind == 0) return TextBufferError.InvalidIndex;
                            if (!(candidate_annotations.remove(range.id) catch return TextBufferError.InvalidDimensions)) return TextBufferError.InvalidIndex;
                            created_ids[output_index] = range.id;
                            output_index += 1;
                            annotations_changed = true;
                            continue;
                        }
                        if (range.start_chunk > range.end_chunk or range.end_chunk > operation.chunks.len) return TextBufferError.InvalidDimensions;
                        const style_id = if (range.styled) try self.acquireInternalStyleFor(range.style, next_syntax_style) else 0;
                        acquired_styles.appendAssumeCapacity(style_id);
                        const input: TextAnnotations.RangeInput = .{
                            .start_byte = std.math.add(u32, start, boundaries[range.start_chunk]) catch return TextBufferError.InvalidDimensions,
                            .end_byte = std.math.add(u32, start, boundaries[range.end_chunk]) catch return TextBufferError.InvalidDimensions,
                        };
                        if (range.id != 0) {
                            const existing = candidate_annotations.get(range.id) orelse return TextBufferError.InvalidIndex;
                            if (existing.payload.namespace != operation.owner or existing.payload.kind_flags & document_range_kind == 0) return TextBufferError.InvalidIndex;
                            if (!(candidate_annotations.updateRange(range.id, input) catch return TextBufferError.InvalidDimensions)) return TextBufferError.InvalidIndex;
                            if (!(candidate_annotations.updatePayload(range.id, .{
                                .namespace = operation.owner,
                                .style_id = style_id,
                                .priority = range.priority,
                                .internal = true,
                                .kind_flags = document_range_kind | if (range.styled) style_range_kind else 0,
                                .splice_policy = .retain,
                            }) catch return TextBufferError.InvalidDimensions)) return TextBufferError.InvalidIndex;
                            if (existing.payload.style_id == style_id) {
                                self.releaseInternalStyle(style_id);
                                _ = acquired_styles.pop();
                            }
                            created_ids[output_index] = range.id;
                        } else {
                            created_ids[output_index] = candidate_annotations.addRange(input, .{
                                .namespace = operation.owner,
                                .style_id = style_id,
                                .priority = range.priority,
                                .internal = true,
                                .kind_flags = document_range_kind | if (range.styled) style_range_kind else 0,
                                .splice_policy = .retain,
                            }) catch |err| switch (err) {
                                error.OutOfMemory => return TextBufferError.OutOfMemory,
                                else => return TextBufferError.InvalidDimensions,
                            };
                        }
                        output_index += 1;
                        annotations_changed = true;
                    }

                    const prepared = candidate_buffer._rope.prepareReplaceRangeByMetric(start, end, segments.segments.items, &candidate_buffer.byte_splitter) catch |err| switch (err) {
                        error.OutOfMemory => return TextBufferError.OutOfMemory,
                        error.OutOfBounds => return TextBufferError.InvalidByteOffset,
                    };
                    candidate_buffer._rope.commitPreparedRoot(prepared);
                    content_changed = true;
                    annotations_changed = true;
                },
                .update_style => {
                    const existing = candidate_annotations.get(operation.target_id) orelse return TextBufferError.InvalidIndex;
                    if (existing.payload.namespace != operation.owner or existing.payload.kind_flags & document_range_kind == 0) return TextBufferError.InvalidIndex;
                    const styled = styleValuePaints(operation.style);
                    const style_id = if (styled) try self.acquireInternalStyleFor(operation.style, next_syntax_style) else 0;
                    if (styled) acquired_styles.appendAssumeCapacity(style_id);
                    if (!(candidate_annotations.updatePayload(operation.target_id, .{
                        .namespace = existing.payload.namespace,
                        .style_id = style_id,
                        .priority = existing.payload.priority,
                        .internal = existing.payload.internal,
                        .kind_flags = document_range_kind | if (styled) style_range_kind else 0,
                        .splice_policy = existing.payload.splice_policy,
                    }) catch return TextBufferError.InvalidDimensions)) return TextBufferError.InvalidIndex;
                    if (styled and existing.payload.style_id == style_id) {
                        self.releaseInternalStyle(style_id);
                        _ = acquired_styles.pop();
                    }
                    annotations_changed = true;
                },
                .move => {
                    var run_end = operation_index + 1;
                    while (run_end < operations.len and operations[run_end].kind == .move) : (run_end += 1) {}

                    const annotation_snapshot = self.global_allocator.alloc(TextAnnotations.Annotation, candidate_annotations.count()) catch return TextBufferError.OutOfMemory;
                    defer self.global_allocator.free(annotation_snapshot);
                    var annotation_indices = std.AutoHashMap(u64, usize).init(self.global_allocator);
                    defer annotation_indices.deinit();
                    try annotation_indices.ensureTotalCapacity(@intCast(annotation_snapshot.len));
                    var snapshot_iterator = candidate_annotations.iterator();
                    var snapshot_index: usize = 0;
                    while (snapshot_iterator.next() catch return TextBufferError.InvalidDimensions) |annotation| : (snapshot_index += 1) {
                        annotation_snapshot[snapshot_index] = annotation;
                        annotation_indices.putAssumeCapacity(annotation.id(), snapshot_index);
                    }
                    std.debug.assert(snapshot_index == annotation_snapshot.len);

                    var moved = false;
                    for (operations[operation_index..run_end]) |move_operation| {
                        const source_annotation = annotation_snapshot[annotation_indices.get(move_operation.target_id) orelse return TextBufferError.InvalidIndex];
                        const anchor_annotation = annotation_snapshot[annotation_indices.get(move_operation.anchor_id) orelse return TextBufferError.InvalidIndex];
                        if (source_annotation.mark != .range or anchor_annotation.mark != .range or source_annotation.payload.namespace != move_operation.owner or anchor_annotation.payload.namespace != move_operation.owner) return TextBufferError.InvalidIndex;
                        const source = source_annotation.mark.range;
                        const anchor = anchor_annotation.mark.range;
                        const source_start = @min(source.start_byte, source.end_byte);
                        const source_end = @max(source.start_byte, source.end_byte);
                        const len = source_end - source_start;
                        if (len == 0 or move_operation.target_id == move_operation.anchor_id) continue;
                        const desired = if (move_operation.before) @min(anchor.start_byte, anchor.end_byte) else @max(anchor.start_byte, anchor.end_byte);
                        if (desired >= source_start and desired <= source_end) continue;
                        const destination = if (desired > source_end) desired - len else desired;
                        const affected_start = @min(source_start, desired);
                        const affected_end = @max(source_end, desired);
                        TextAnnotations.transformMoveSnapshot(
                            annotation_snapshot,
                            move_operation.target_id,
                            source_start,
                            len,
                            destination,
                            affected_start,
                            affected_end,
                            document_range_kind,
                        ) catch return TextBufferError.InvalidDimensions;
                        const prepared = candidate_buffer._rope.prepareMoveRegionByMetric(source_start, len, destination, &candidate_buffer.byte_splitter) catch |err| switch (err) {
                            error.OutOfMemory => return TextBufferError.OutOfMemory,
                            error.OutOfBounds => return TextBufferError.InvalidByteOffset,
                        };
                        candidate_buffer._rope.commitPreparedRoot(prepared);
                        moved = true;
                    }
                    if (moved) {
                        candidate_annotations.replaceSnapshotMarks(annotation_snapshot) catch |err| switch (err) {
                            error.OutOfMemory => return TextBufferError.OutOfMemory,
                            else => return TextBufferError.InvalidDimensions,
                        };
                        content_changed = true;
                        annotations_changed = true;
                    }
                    operation_index = run_end - 1;
                },
                .remove => {
                    const existing = candidate_annotations.get(operation.target_id) orelse return TextBufferError.InvalidIndex;
                    if (existing.payload.namespace != operation.owner or existing.payload.kind_flags & document_range_kind == 0) return TextBufferError.InvalidIndex;
                    if (!(candidate_annotations.remove(operation.target_id) catch return TextBufferError.InvalidDimensions)) return TextBufferError.InvalidIndex;
                    annotations_changed = true;
                },
                .clear_owner => {
                    _ = candidate_annotations.clearOwner(operation.owner) catch |err| switch (err) {
                        error.OutOfMemory => return TextBufferError.OutOfMemory,
                        else => return TextBufferError.InvalidDimensions,
                    };
                    annotations_changed = true;
                },
            }
        }

        // Reconcile ownership against the final candidate rather than the
        // operation log. Intermediate replace/style/remove combinations may
        // acquire styles that do not survive publication, while splices may
        // create retained fragments without an explicit acquisition.
        var available_acquisitions = std.AutoHashMap(u32, usize).init(self.global_allocator);
        defer available_acquisitions.deinit();
        try available_acquisitions.ensureTotalCapacity(@intCast(acquired_styles.items.len));
        for (acquired_styles.items) |style_id| {
            const entry = available_acquisitions.getOrPutAssumeCapacity(style_id);
            if (entry.found_existing) entry.value_ptr.* += 1 else entry.value_ptr.* = 1;
        }
        var candidate_iterator = candidate_annotations.iterator();
        while (candidate_iterator.next() catch return TextBufferError.InvalidDimensions) |annotation| {
            const current = self.annotations.get(annotation.id());
            if (current != null and current.?.payload.style_id == annotation.payload.style_id) continue;
            const available = available_acquisitions.getPtr(annotation.payload.style_id);
            if (available != null and available.?.* != 0) {
                available.?.* -= 1;
            } else {
                try self.retainInternalStyle(annotation.payload.style_id);
                acquired_styles.appendAssumeCapacity(annotation.payload.style_id);
            }
        }
        var current_iterator = self.annotations.iterator();
        while (current_iterator.next() catch return TextBufferError.InvalidDimensions) |annotation| {
            const next = candidate_annotations.get(annotation.id());
            if (next == null or next.?.payload.style_id != annotation.payload.style_id) {
                try released_styles.append(self.global_allocator, annotation.payload.style_id);
            }
        }
        var unused_acquisitions = available_acquisitions.iterator();
        while (unused_acquisitions.next()) |entry| {
            for (0..entry.value_ptr.*) |_| released_styles.appendAssumeCapacity(entry.key_ptr.*);
        }
        var style_switch_releases: usize = 0;
        if (next_syntax_style != self.syntax_style) {
            for (self.internal_style_slots.items) |slot| style_switch_releases += @intFromBool(slot.resolved_syntax_style != null and slot.link_id != 0);
        }
        const prepared_link_releases = std.math.add(usize, released_styles.items.len, style_switch_releases) catch return TextBufferError.InvalidDimensions;
        self.link_pool.prepareReleases(prepared_link_releases) catch return TextBufferError.OutOfMemory;
        var syntax_listener_prepared = false;
        errdefer if (syntax_listener_prepared) (@constCast(next_syntax_style.?)).offDestroy(@ptrCast(self), onSyntaxStyleDestroyed);
        if (next_syntax_style != self.syntax_style and next_syntax_style != null) {
            (@constCast(next_syntax_style.?)).onDestroy(@ptrCast(self), onSyntaxStyleDestroyed) catch return TextBufferError.OutOfMemory;
            syntax_listener_prepared = true;
        }

        var publication_arena = transaction_arena;
        var publication_rope = candidate_buffer._rope;
        var publication_arena_owned = false;
        defer if (publication_arena_owned) {
            publication_arena.deinit();
            self.global_allocator.destroy(publication_arena);
        };
        if (content_changed) {
            publication_arena = self.global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferError.OutOfMemory;
            publication_arena.* = std.heap.ArenaAllocator.init(self.global_allocator);
            publication_arena_owned = true;
            if (staged_mem_id) |final_mem_id| {
                const final_len: usize = candidate_buffer.getByteSize();
                const final_storage = self.global_allocator.alloc(u8, final_len) catch return TextBufferError.OutOfMemory;
                errdefer self.global_allocator.free(final_storage);
                if (candidate_buffer.copyCurrentNormalizedBytes(final_storage) != final_len) return TextBufferError.InvalidByteOffset;
                var final_segments = try candidate_buffer.textToSegments(
                    self.global_allocator,
                    final_storage,
                    final_mem_id,
                    0,
                    true,
                );
                defer final_segments.segments.deinit(final_segments.allocator);
                publication_rope = UnifiedRope.from_slice(
                    publication_arena.allocator(),
                    final_segments.segments.items,
                ) catch return TextBufferError.OutOfMemory;
                publication_rope.undo_history = candidate_buffer._rope.undo_history;
                publication_rope.redo_history = candidate_buffer._rope.redo_history;
                publication_rope.curr_history = candidate_buffer._rope.curr_history;
                publication_rope.config = candidate_buffer._rope.config;
                publication_rope.undo_depth = candidate_buffer._rope.undo_depth;
                publication_rope.version = candidate_buffer._rope.version;
                self.global_allocator.free(staged_storage.?);
                staged_storage = final_storage;
            } else {
                publication_rope = candidate_buffer._rope.cloneCurrent(
                    publication_arena.allocator(),
                    self.global_allocator,
                    null,
                    cloneSegmentIdentity,
                ) catch return TextBufferError.OutOfMemory;
            }
            transaction_arena.deinit();
            self.global_allocator.destroy(transaction_arena);
            arena_owned = false;
        }

        // Transfer every prepared resource to the returned candidate. Commit is
        // now infallible; deinit releases the same ownership on failure.
        annotations_owned = false;
        if (!content_changed) arena_owned = false;
        publication_arena_owned = false;
        storage_owned = false;
        styles_committed = true;
        created_ids_owned = false;
        const prepared = PreparedDocumentOperations{
            .owner = self,
            .annotations = candidate_annotations,
            .transaction_arena = publication_arena,
            .rope = publication_rope,
            .staged_storage = staged_storage,
            .staged_mem_id = staged_mem_id,
            .acquired_styles = acquired_styles,
            .released_styles = released_styles,
            .created_ids = created_ids,
            .content_changed = content_changed,
            .annotations_changed = annotations_changed,
            .initial_style_slot_len = initial_style_slot_len,
            .previous_syntax_style = self.syntax_style,
            .next_syntax_style = next_syntax_style,
            .syntax_listener_prepared = syntax_listener_prepared,
            .prepared_link_releases = prepared_link_releases,
        };
        acquired_styles = .empty;
        released_styles = .empty;
        return prepared;
    }

    pub fn applyDocumentOperations(
        self: *Self,
        operations: []const DocumentOperation,
        out_ids: []u64,
    ) TextBufferError!void {
        if (operations.len == 0) {
            if (out_ids.len != 0) return TextBufferError.InvalidDimensions;
            return;
        }
        var prepared = try self.prepareDocumentOperations(operations, out_ids.len);
        defer prepared.deinit();
        prepared.commit(out_ids);
    }

    /// Set styled text from chunks with individual styling
    /// Accepts StyledChunk array for FFI compatibility
    /// TODO: This is for backward compatibility, there should be a better way to do this.
    pub fn setStyledText(
        self: *Self,
        chunks: []const StyledChunk,
    ) TextBufferError!void {
        _ = try self.replaceStyledRangeBytes(0, self.getByteSize(), chunks, styled_text_owner);
        // Compatibility: full replacement clears public line highlights.
        for (self.external_line_highlights.items) |*highlights| highlights.clearRetainingCapacity();
        self.internal_highlight_count = 0;
        self._rope.clear_history();

        // Full replacements retain neither history nodes nor superseded blocks.
        self.storage_compaction_requested = true;
        try self.compactRopeTransactionArenasIfNeeded();
    }

    /// Load text from a file path (relative to cwd)
    /// The file content is allocated in the arena and will be freed when the buffer is destroyed
    pub fn loadFile(self: *Self, path: []const u8) TextBufferError!void {
        const file = std.Io.Dir.cwd().openFile(io, path, .{}) catch |err| {
            return switch (err) {
                error.FileNotFound => TextBufferError.InvalidIndex,
                error.AccessDenied => TextBufferError.InvalidIndex,
                else => TextBufferError.OutOfMemory,
            };
        };
        defer file.close(io);

        const stat = file.stat(io) catch return TextBufferError.OutOfMemory;
        const file_size = std.math.cast(usize, stat.size) orelse return TextBufferError.OutOfMemory;

        self.clear();

        const content = self.allocator.alloc(u8, file_size) catch return TextBufferError.OutOfMemory;
        var read_buffer: [4096]u8 = undefined;
        var reader = file.reader(io, &read_buffer);
        const bytes_read = reader.interface.readSliceShort(content) catch return TextBufferError.OutOfMemory;
        const text = content[0..bytes_read];
        const mem_id = try self.mem_registry.register(text, false);

        try self.setTextInternal(mem_id, text);
    }

    pub fn getTabWidth(self: *const Self) u8 {
        return self.tabWidth();
    }

    /// Set tab width, rounding up to nearest multiple of 2 (minimum 2).
    /// Marks all views dirty if the width actually changes, since tab width
    /// affects measured line widths and virtual line calculations.
    pub fn setTabWidth(self: *Self, width: u8) void {
        const clamped_width = @max(2, width);
        const new_width = if (clamped_width % 2 == 0) clamped_width else clamped_width + 1;
        if (self.tab_width == new_width) return;
        self.tab_width = new_width;
        self.markAllViewsDirty();
    }

    /// Debug log the rope structure using rope.toText
    pub fn debugLogRope(self: *const Self) void {
        logger.debug("=== TextBuffer Rope Debug ===", .{});
        logger.debug("Line count: {}", .{self.getLineCount()});
        logger.debug("Char count: {}", .{self.getLength()});
        logger.debug("Byte size: {}", .{self.getByteSize()});

        const rope_text = self._rope.toText(self.allocator) catch {
            logger.debug("Failed to generate rope text representation", .{});
            return;
        };
        logger.debug("Rope structure: {s}", .{rope_text});
        logger.debug("=== End Rope Debug ===", .{});
    }

    /// Get text within a range of display-width offsets
    /// Automatically snaps to grapheme boundaries:
    /// Returns number of bytes written to out_buffer
    pub fn getTextRange(self: *const Self, start_offset: u32, end_offset: u32, out_buffer: []u8) usize {
        if (start_offset >= end_offset) return 0;
        if (out_buffer.len == 0) return 0;

        const total_weight = self._rope.totalWeight();
        if (start_offset >= total_weight) return 0;

        const clamped_end = @min(end_offset, total_weight);

        return iter_mod.extractTextBetweenOffsets(
            &self._rope,
            &self.mem_registry,
            self.tab_width,
            start_offset,
            clamped_end,
            out_buffer,
            self.width_method,
        );
    }

    /// Get text within a range specified by row/col coordinates
    /// Automatically snaps to grapheme boundaries:
    /// Returns number of bytes written to out_buffer
    pub fn getTextRangeByCoords(self: *Self, start_row: u32, start_col: u32, end_row: u32, end_col: u32, out_buffer: []u8) usize {
        const start_offset = iter_mod.coordsToOffset(&self._rope, start_row, start_col) orelse return 0;
        const end_offset = iter_mod.coordsToOffset(&self._rope, end_row, end_col) orelse return 0;
        return self.getTextRange(start_offset, end_offset, out_buffer);
    }
};

/// Prepares both independent document candidates before publishing either one.
/// The two commits contain no allocation or validation and therefore cannot
/// expose a one-sided transfer.
pub fn applyTwoDocumentOperations(
    first: *UnifiedTextBuffer,
    first_operations: []const DocumentOperation,
    first_out_ids: []u64,
    second: *UnifiedTextBuffer,
    second_operations: []const DocumentOperation,
    second_out_ids: []u64,
) TextBufferError!void {
    if (first == second) return TextBufferError.InvalidDimensions;
    var first_prepared = try first.prepareDocumentOperations(first_operations, first_out_ids.len);
    defer first_prepared.deinit();
    var second_prepared = try second.prepareDocumentOperations(second_operations, second_out_ids.len);
    defer second_prepared.deinit();
    if (first.link_pool == second.link_pool) {
        const release_count = std.math.add(
            usize,
            first_prepared.prepared_link_releases,
            second_prepared.prepared_link_releases,
        ) catch return TextBufferError.InvalidDimensions;
        first.link_pool.prepareReleases(release_count) catch return TextBufferError.OutOfMemory;
    }
    first_prepared.commit(first_out_ids);
    second_prepared.commit(second_out_ids);
}
