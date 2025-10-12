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

1. Create a new `*_bench.zig` file in this directory
2. Import it in `bench.zig`
3. Call benchmark functions from `main()`
4. Follow the existing pattern for result reporting
