# WalkLines Performance Issue - Root Cause

## The Problem

Current approach:
```zig
walkLines(rope, callback) {
    rope.walk() {  // O(n) - visits all segments
        for each segment {
            if (break) emit line
        }
    }
}

// Then in the callback:
callback(line_info) {
    walkSegments(rope, line.seg_start, line.seg_end) {  
        for i in seg_start..seg_end {
            rope.get(i)  // O(log n) per segment!
        }
    }
}
```

**Total complexity:** O(n) walk × O(k log n) per line = O(n × k log n)
With 5000 lines and k=1-3 segments per line, this is **5000-15000 tree traversals!**

## The Real Solution

We're ALREADY walking the rope once in walkLines. We should emit segments DURING that walk, not afterwards with get()!

```zig
walkLinesWithSegments(rope, ctx, line_callback, segment_callback) {
    rope.walk() {  // Single O(n) pass
        for each segment {
            if (text) {
                segment_callback(segment)  // Emit segment immediately
            }
            if (break) {
                line_callback(accumulated_line_info)  // Emit line
            }
        }
    }
}
```

**Total complexity:** O(n) - single pass, no tree traversals!

## Implementation

```zig
pub fn walkLinesAndSegments(
    rope: *const UnifiedRope,
    ctx: *anyopaque,
    line_callback: fn(ctx, line_info) void,
    segment_callback: fn(ctx, line_idx, segment, seg_idx_in_line) void,
) void {
    rope.walk() {
        // For each segment:
        if (text) emit to segment_callback
        if (break) emit accumulated line to line_callback
    }
}
```

This way the view can build virtual lines and chunks in ONE rope walk!

