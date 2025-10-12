# OpenTUI Benchmarks

This directory contains benchmarks for the OpenTUI core library.

## Running Benchmarks

From the `packages/core` directory:

```bash
# Using the npm script (recommended)
bun bench:native

# Include memory statistics
bun bench:native --mem

# Or from packages/core/src/zig directory:
zig build bench -Doptimize=ReleaseFast
zig build bench -Doptimize=ReleaseFast -- --mem
```

## Adding New Benchmarks

To add a new benchmark:

1. Create a new `*_bench.zig` file in the `bench/` directory
2. Implement a `pub fn run(allocator: std.mem.Allocator, show_mem: bool) !void` function
   - Set up any benchmark-specific dependencies (grapheme pool, Unicode data, etc.)
   - The `show_mem` flag indicates whether to display memory statistics
3. Import it in `bench.zig`:
   ```zig
   const my_new_bench = @import("bench/my_new_bench.zig");
   ```
4. Call it in `main()`:
   ```zig
   try my_new_bench.run(allocator, show_mem);
   ```

Each benchmark manages its own dependencies, so you only set up what you need.

See `bench/text-buffer-view_bench.zig` for a complete example.
