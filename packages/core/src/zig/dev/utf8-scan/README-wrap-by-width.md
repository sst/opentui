# UTF-8 Width-Aware Word Wrap Position Finding

Fast grapheme-aware text wrapping based on visual display width.

## Build & Run

```bash
cd packages/core/src/zig/dev/utf8-scan

# Run tests
zig build test

# Build benchmark
zig build

# Run benchmark on a file
./zig-out/bin/utf8-wrap-by-width-bench <file> <width>

# Generate test files
./zig-out/bin/utf8-wrap-by-width-bench --generate-tests

# Benchmark all test files
./zig-out/bin/utf8-wrap-by-width-bench --bench-all 80
```

## Methods

- **Baseline**: Reference implementation
- **StdLib**: ASCII fast path (currently delegates to baseline)
- **SIMD16**: 16-byte SIMD chunked scanning (fastest)
- **Bitmask128**: 128-byte bitmask approach (currently delegates to baseline)

All methods produce identical results and respect grapheme cluster boundaries.
