# UTF-8 Width-Aware Word Wrap Position Finding

Fast grapheme-aware text wrapping based on visual display width.

## Build & Run

```bash
cd packages/core/src/zig/dev/utf8-scan

# Run tests
zig build test

# Build benchmark (defaults to ReleaseFast)
zig build

# Run benchmark with default width (80)
./zig-out/bin/utf8-wrap-by-width-bench

# Run benchmark with custom width
./zig-out/bin/utf8-wrap-by-width-bench 120
```

## Features

- All methods accept an `isASCIIOnly` parameter for optimized ASCII-only processing
- Benchmark uses in-memory line pools (no file I/O)
- **Focused scenarios**: 12 total scenarios (6 ASCII + 6 Mixed Unicode)
- **Exponentially growing line lengths**: 60B → 600B → 6KB → 60KB → 600KB → 6MB
- Reproducible pseudo-random test generation
- Measures both per-line avg time and total batch time
- **Comprehensive summary** with key insights and performance comparisons

## Benchmark Output

The benchmark provides:

1. Detailed per-scenario results with speedup comparisons
2. Summary tables grouped by content type (ASCII vs Mixed Unicode)
3. Key insights including:
   - Win rates for each method
   - Average speedup metrics
   - Performance characteristics
   - Unicode impact analysis
