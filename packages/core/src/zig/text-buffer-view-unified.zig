const std = @import("std");
const Allocator = std.mem.Allocator;
const unified_tb = @import("text-buffer-unified.zig");
const iter_mod = @import("text-buffer-iterators.zig");
const tb = @import("text-buffer.zig");
const gp = @import("grapheme.zig");
const gwidth = @import("gwidth.zig");
const utf8 = @import("utf8.zig");
const Graphemes = @import("Graphemes");
const DisplayWidth = @import("DisplayWidth");

const UnifiedTextBuffer = unified_tb.UnifiedTextBuffer;
const LineIterator = iter_mod.LineIterator;
const SegmentIterator = iter_mod.SegmentIterator;
const RGBA = tb.RGBA;
const TextSelection = tb.TextSelection;
const WrapMode = tb.WrapMode;
const TextChunk = tb.TextChunk;

pub const TextBufferViewError = error{
    OutOfMemory,
};

/// A virtual chunk references a portion of a real TextChunk for text wrapping
pub const VirtualChunk = struct {
    source_chunk: usize,
    grapheme_start: u32,
    grapheme_count: u32,
    width: u16,
};

/// A virtual line represents a display line after text wrapping
pub const VirtualLine = struct {
    chunks: std.ArrayListUnmanaged(VirtualChunk),
    width: u32,
    char_offset: u32,
    source_line: usize,
    source_col_offset: u32,

    pub fn init() VirtualLine {
        return .{
            .chunks = .{},
            .width = 0,
            .char_offset = 0,
            .source_line = 0,
            .source_col_offset = 0,
        };
    }

    pub fn deinit(self: *VirtualLine, allocator: Allocator) void {
        self.chunks.deinit(allocator);
    }
};

pub const LocalSelection = struct {
    anchorX: i32,
    anchorY: i32,
    focusX: i32,
    focusY: i32,
    isActive: bool,
};

/// TextBufferView for UnifiedTextBuffer
pub const UnifiedTextBufferView = struct {
    const Self = @This();

    text_buffer: *UnifiedTextBuffer,
    view_id: u32,

    // View-specific state
    selection: ?TextSelection,
    local_selection: ?LocalSelection,

    // Wrapping state
    wrap_width: ?u32,
    wrap_mode: WrapMode,
    virtual_lines: std.ArrayListUnmanaged(VirtualLine),
    virtual_lines_dirty: bool,

    // Cached line info
    cached_line_starts: std.ArrayListUnmanaged(u32),
    cached_line_widths: std.ArrayListUnmanaged(u32),
    cached_max_width: u32,

    // Memory management
    global_allocator: Allocator,
    virtual_lines_arena: *std.heap.ArenaAllocator,

    pub fn init(global_allocator: Allocator, text_buffer: *UnifiedTextBuffer) TextBufferViewError!*Self {
        const self = global_allocator.create(Self) catch return TextBufferViewError.OutOfMemory;
        errdefer global_allocator.destroy(self);

        const virtual_lines_internal_arena = global_allocator.create(std.heap.ArenaAllocator) catch return TextBufferViewError.OutOfMemory;
        errdefer global_allocator.destroy(virtual_lines_internal_arena);
        virtual_lines_internal_arena.* = std.heap.ArenaAllocator.init(global_allocator);

        const view_id = text_buffer.registerView() catch return TextBufferViewError.OutOfMemory;

        self.* = .{
            .text_buffer = text_buffer,
            .view_id = view_id,
            .selection = null,
            .local_selection = null,
            .wrap_width = null,
            .wrap_mode = .char,
            .virtual_lines = .{},
            .virtual_lines_dirty = true,
            .cached_line_starts = .{},
            .cached_line_widths = .{},
            .cached_max_width = 0,
            .global_allocator = global_allocator,
            .virtual_lines_arena = virtual_lines_internal_arena,
        };

        return self;
    }

    pub fn deinit(self: *Self) void {
        self.text_buffer.unregisterView(self.view_id);
        self.virtual_lines_arena.deinit();
        self.global_allocator.destroy(self.virtual_lines_arena);
        self.global_allocator.destroy(self);
    }

    pub fn setWrapWidth(self: *Self, width: ?u32) void {
        if (self.wrap_width != width) {
            self.wrap_width = width;
            self.virtual_lines_dirty = true;
        }
    }

    pub fn setWrapMode(self: *Self, mode: WrapMode) void {
        if (self.wrap_mode != mode) {
            self.wrap_mode = mode;
            self.virtual_lines_dirty = true;
        }
    }

    /// Update virtual lines - simplified version for now without wrapping
    pub fn updateVirtualLines(self: *Self) void {
        const buffer_dirty = self.text_buffer.isViewDirty(self.view_id);
        if (!self.virtual_lines_dirty and !buffer_dirty) return;

        _ = self.virtual_lines_arena.reset(.free_all);
        self.virtual_lines = .{};
        self.cached_line_starts = .{};
        self.cached_line_widths = .{};
        self.cached_max_width = 0;
        const virtual_allocator = self.virtual_lines_arena.allocator();

        if (self.wrap_width == null) {
            // No wrapping - create 1:1 mapping to real lines using single-pass API
            const Context = struct {
                view: *Self,
                virtual_allocator: Allocator,
                current_vline: ?VirtualLine = null,

                fn segment_callback(ctx_ptr: *anyopaque, line_idx: u32, chunk: *const TextChunk, chunk_idx_in_line: u32) void {
                    _ = line_idx;
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    // Append chunk to current virtual line
                    if (ctx.current_vline) |*vline| {
                        vline.chunks.append(ctx.virtual_allocator, VirtualChunk{
                            .source_chunk = chunk_idx_in_line,
                            .grapheme_start = 0,
                            .grapheme_count = chunk.width,
                            .width = chunk.width,
                        }) catch {};
                    }
                }

                fn line_end_callback(ctx_ptr: *anyopaque, line_info: iter_mod.LineInfo) void {
                    const ctx = @as(*@This(), @ptrCast(@alignCast(ctx_ptr)));

                    // If we have a pending vline from segments, finalize it
                    // Otherwise create empty vline
                    var vline = if (ctx.current_vline) |v| v else VirtualLine.init();
                    vline.width = line_info.width;
                    vline.char_offset = line_info.char_offset;
                    vline.source_line = line_info.line_idx;
                    vline.source_col_offset = 0;

                    ctx.view.virtual_lines.append(ctx.virtual_allocator, vline) catch {};
                    ctx.view.cached_line_starts.append(ctx.virtual_allocator, vline.char_offset) catch {};
                    ctx.view.cached_line_widths.append(ctx.virtual_allocator, vline.width) catch {};
                    ctx.view.cached_max_width = @max(ctx.view.cached_max_width, vline.width);

                    // Reset for next line
                    ctx.current_vline = VirtualLine.init();
                }
            };

            var ctx = Context{
                .view = self,
                .virtual_allocator = virtual_allocator,
                .current_vline = VirtualLine.init(),
            };

            iter_mod.walkLinesAndSegments(&self.text_buffer.rope, &ctx, Context.segment_callback, Context.line_end_callback);
        } else {
            // TODO: Implement wrapping (complex, will do after basic view works)
        }

        self.virtual_lines_dirty = false;
        self.text_buffer.clearViewDirty(self.view_id);
    }

    pub fn getVirtualLineCount(self: *Self) u32 {
        self.updateVirtualLines();
        return @intCast(self.virtual_lines.items.len);
    }

    pub fn getVirtualLines(self: *Self) []const VirtualLine {
        self.updateVirtualLines();
        return self.virtual_lines.items;
    }

    pub fn getCachedLineInfo(self: *Self) struct {
        starts: []const u32,
        widths: []const u32,
        max_width: u32,
    } {
        self.updateVirtualLines();

        return .{
            .starts = self.cached_line_starts.items,
            .widths = self.cached_line_widths.items,
            .max_width = self.cached_max_width,
        };
    }

    pub fn getPlainTextIntoBuffer(self: *const Self, out_buffer: []u8) usize {
        return self.text_buffer.getPlainTextIntoBuffer(out_buffer);
    }

    pub fn getArenaAllocatedBytes(self: *const Self) usize {
        return self.virtual_lines_arena.queryCapacity();
    }

    pub fn setSelection(self: *Self, start: u32, end: u32, bgColor: ?RGBA, fgColor: ?RGBA) void {
        self.selection = TextSelection{
            .start = start,
            .end = end,
            .bgColor = bgColor,
            .fgColor = fgColor,
        };
    }

    pub fn resetSelection(self: *Self) void {
        self.selection = null;
    }

    pub fn getSelection(self: *const Self) ?TextSelection {
        return self.selection;
    }
};
