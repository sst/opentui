# Unified Rope Migration Plan

## Overview

Migrate from nested rope architecture (lines → chunks) to a single unified rope containing both text segments and break markers. This eliminates double indirection, reduces memory overhead, and simplifies multi-line operations.

## Current Architecture Problems

### Double Indirection

```zig
TextBuffer(LineStorage, ChunkStorage) {
    lines: LineStorage,  // Rope of lines
    // Each line has:
    TextLine {
        chunks: ChunkStorage,  // Rope of chunks PER LINE
        width: u32,
        char_offset: u32,
        highlights: ...,
        spans: ...,
    }
}
```

**Issues:**

- Two tree traversals for any operation
- Per-line metadata duplication
- Multi-line edits require manipulating both structures
- 10.9x memory overhead (32.87 MiB vs 3.02 MiB in benchmarks)

### View Iteration

Current view must:

1. Walk line rope
2. For each line, walk chunk rope
3. Build virtual lines from chunks

This creates nested iteration and poor cache locality.

### Editing

Multi-line operations like:

```zig
deleteAcrossLines(start, end) {
    // 1. Split chunk rope at start.col
    // 2. Split chunk rope at end.col in different line
    // 3. Concat chunks from start line + end line
    // 4. Delete middle lines from line rope
    // 5. Update all char offsets
}
```

## Target Architecture

### Unified Segment Type

```zig
pub const Segment = union(enum) {
    text: TextChunk,
    brk: void,  // Line break marker

    pub const Metrics = struct {
        total_width: u32,        // Sum of display widths (excludes breaks)
        break_count: u32,        // Number of break segments
        first_line_width: u32,   // Width from start to first break (or total if none)
        last_line_width: u32,    // Width from last break to end (or total if none)
        max_line_width: u32,     // Maximum line width in subtree
        ascii_only: bool,        // AND-reduction for fast paths

        pub fn add(self: *Metrics, other: Metrics) void;
        pub fn weight(self: *const Metrics) u32;
    };

    pub fn measure(self: *const Segment) Metrics;
    pub fn empty() Segment;
    pub fn is_empty(self: *const Segment) bool;
};
```

### TextChunk (unchanged)

```zig
pub const TextChunk = struct {
    mem_id: u8,
    byte_start: u32,
    byte_end: u32,
    width: u16,
    flags: u8,
    graphemes: ?[]GraphemeInfo,      // Lazy cache
    wrap_offsets: ?[]utf8.WrapBreak, // Lazy cache

    // Unchanged methods
    pub fn getBytes(...) []const u8;
    pub fn getGraphemes(...) []const GraphemeInfo;
    pub fn getWrapOffsets(...) []const utf8.WrapBreak;
};
```

### Aggregation Rules

For two child nodes A and B:

```zig
fn combineMetrics(left: Metrics, right: Metrics) Metrics {
    return .{
        .break_count = left.break_count + right.break_count,
        .total_width = left.total_width + right.total_width,

        // first_line_width: if left has breaks, use left's first, else combine
        .first_line_width = if (left.break_count > 0)
            left.first_line_width
        else
            left.first_line_width + right.first_line_width,

        // last_line_width: if right has breaks, use right's last, else combine
        .last_line_width = if (right.break_count > 0)
            right.last_line_width
        else
            left.last_line_width + right.last_line_width,

        // max_line_width: max of any individual line or the join at boundary
        .max_line_width = @max(
            left.max_line_width,
            right.max_line_width,
            left.last_line_width + right.first_line_width
        ),

        .ascii_only = left.ascii_only and right.ascii_only,
    };
}
```

### Leaf Metrics

For `Segment.text`:

```zig
.break_count = 0,
.total_width = chunk.width,
.first_line_width = chunk.width,
.last_line_width = chunk.width,
.max_line_width = chunk.width,
.ascii_only = (chunk.flags & TextChunk.Flags.ASCII_ONLY) != 0,
```

For `Segment.brk`:

```zig
.break_count = 1,
.total_width = 0,
.first_line_width = 0,
.last_line_width = 0,
.max_line_width = 0,
.ascii_only = true,
```

## Implementation Phases

### Phase 1: Foundation (Read-Only)

**Goal:** Create unified rope and make views work without touching edits.

1. **Create `Segment` type** in new file `text-buffer-segment.zig`
   - Union of `text: TextChunk` and `brk: void`
   - Implement `Metrics` struct with aggregation
   - Implement `measure()`, `empty()`, `is_empty()`

2. **Create `UnifiedRope` type alias**

   ```zig
   pub const UnifiedRope = Rope(Segment);
   ```

3. **Build iterators** in new file `text-buffer-iterators.zig`

   ```zig
   pub const LineIterator = struct {
       // Yields line info: (start_offset, width, segment_range)
       pub fn next(self: *LineIterator) ?LineInfo;
   };

   pub const SegmentIterator = struct {
       // Yields only text segments in a line range
       pub fn next(self: *SegmentIterator) ?*const TextChunk;
   };
   ```

4. **Add UnifiedBuffer variant to TextBuffer**
   - Add compile-time flag `use_unified: bool`
   - When `use_unified = true`:
     - Store `unified_rope: UnifiedRope` instead of `lines: LineStorage`
     - Implement `walkLines` using `LineIterator`
     - Implement `walkChunks` using `SegmentIterator`
   - Keep existing nested API surface unchanged

5. **Test Phase 1**
   - Run `bun test:native` - all tests should pass
   - Run `bun bench:native --mem` with both implementations
   - Compare view wrapping performance

### Phase 2: Write Operations

**Goal:** Port EditBuffer to use unified rope operations.

1. **Implement setText for unified rope**

   ```zig
   pub fn setText(self: *Self, text: []const u8) !void {
       // Parse into segments with breaks
       var segments = std.ArrayList(Segment).init(self.allocator);

       // Use SIMD line break detection as before
       const break_result = utf8.findLineBreaksSIMD16(text, ...);

       var line_start: u32 = 0;
       for (break_result.breaks.items) |line_break| {
           // Add text segment for line content
           if (line_end > line_start) {
               const chunk = self.createChunk(mem_id, line_start, line_end);
               try segments.append(.{ .text = chunk });
           }
           // Add break segment
           try segments.append(.{ .brk = {} });
           line_start = break_pos + 1;
       }

       // Build rope from segments
       self.unified_rope = try UnifiedRope.from_slice(self.allocator, segments.items);
   }
   ```

2. **Implement coordinate mapping**

   ```zig
   pub fn coordsToOffset(self: *Self, row: u32, col: u32) ?u32 {
       // Use break_count and first/last metrics to descend tree
       // O(log n) instead of O(n) scan
   }

   pub fn offsetToCoords(self: *Self, offset: u32) ?struct { row: u32, col: u32 } {
       // Inverse using same metrics
   }
   ```

3. **Port EditBuffer operations**
   - `insertText`: Split rope at offset, insert segment(s), concat
   - `deleteRange`: Convert cursors to offsets, single `deleteRangeByWeight`
   - `backspace`: Map cursor to offset, delete one weight unit
   - No more separate line/chunk manipulation!

4. **Test Phase 2**
   - Run `bun test:native` - all edit tests should pass
   - Run EditBuffer benchmarks
   - Verify multi-line delete speedup

### Phase 3: Highlights and Polish

1. **Adapt highlight system**
   - Keep global char range storage
   - Compute line spans on-demand or cache with line iterator
   - Invalidate caches on edit via dirty flags

2. **Optimize hot paths**
   - Cache line starts array for view (computed once per dirty cycle)
   - Use ASCII-only flag for fast wrapping paths
   - Pre-compute frequently accessed aggregates

3. **Final Testing**
   - Full test suite: `bun test:native`
   - Full benchmarks: `bun bench:native --mem`
   - Compare to baseline in `BASELINE_BENCH_RESULTS.md`

### Phase 4: Cleanup

1. **Remove nested types** (only if unified is superior)
   - Delete old `TextBufferRope` with nested structure
   - Remove compile-time flag, make unified the only implementation
   - Update all examples and documentation

2. **Update public API docs**
   - Document that line breaks are implicit
   - Update iteration examples
   - Note performance characteristics

## Testing Strategy

### Unit Tests (Continuous)

```bash
cd packages/core && bun test:native
```

Expected: 526/527 tests pass (1 skipped) throughout migration

### Benchmarks (After Each Phase)

```bash
cd packages/core && bun bench:native --mem
```

Compare:

- Phase 1: View operations should be ±10% of baseline
- Phase 2: Multi-line edits should improve >30%
- Phase 3: Memory usage should drop >50% for Rope variant

### Regression Checks

1. **Memory:** Rope TB memory should drop from 32.87 MiB to <15 MiB
2. **Speed:** No operation should regress >10% except where improved
3. **Correctness:** All text extraction, selection, and wrapping must match baseline

## Rollback Plan

If unified approach shows issues:

1. Keep compile-time flag
2. Default back to nested implementation
3. Investigate specific bottleneck
4. Consider hybrid approach (unified for large files, nested for small)

## Success Metrics

✅ **Memory:** >50% reduction in Rope TB memory (32.87 → <15 MiB)
✅ **Multi-line edits:** >30% faster (88μs → <60μs for 50-line delete)
✅ **View wrapping:** Within 90-110% of baseline times
✅ **All tests pass:** 526/527 tests continue to pass
✅ **Code simplicity:** EditBuffer multi-line operations <50% current LOC

## Timeline Estimate

- Phase 1 (Read-only): 4-6 hours
- Phase 2 (Write ops): 3-4 hours
- Phase 3 (Highlights): 2-3 hours
- Phase 4 (Cleanup): 1-2 hours
- **Total: 10-15 hours**

Given context window limits and testing cycles, this will likely span 2-3 continuation windows.
