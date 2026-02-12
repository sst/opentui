# NativeSpanFeed Benchmarks

## Benchmark

### Build

The benchmark library (`libnative_span_feed_bench`) is built by the Zig bench-ffi step
with `ReleaseFast` by default. Override with `-Dbench-optimize=` if needed.

```bash
cd packages/core/src/zig
zig build bench-ffi
```

This installs `zig-out/lib/libnative_span_feed_bench.*`, which
`src/benchmark/native-span-feed-benchmark.ts` loads by default.

You can also run `zig build bench` to build the bench runner and install the FFI bench library in one step.

### Run

```bash
cd packages/core
zig build bench-ffi
```

```bash
bun bench:ts
```

```bash
bun src/benchmark/native-span-feed-benchmark.ts --bytes=100000 --iters=1000 --chunk=65536 --initial=2
```

### Options

Defaults are optimized (batch drain + reserve path + chunk release flags) with no
additional flags required.

- `--bytes=<n>` total bytes produced by Zig per iteration (default: 100000)
- `--iters=<n>` base iteration count (suite scenarios scale from this; defaults are optimized)
- `--suite=<quick|default|large|all>` run a scenario suite
- `--chunk=<n>` chunk size in bytes
- `--initial=<n>` initial chunk count
- `--auto=<0|1>` enable auto-commit on full chunks (default: 1)
- `--commit=<n>` commit every N bytes (0 disables)
- `--pattern=<str>` override the default ANSI pattern (single-run)
- `--pattern-type=<ansi|ascii|binary|random>` choose pattern kind (single-run)
- `--pattern-size=<n>` pattern size in bytes (single-run)
- `--stdout` write received bytes to stdout
- `--reuse` reuse a single stream across iterations (may grow memory)
- `--mem` enable memory tracking
- `--mem-sample=<n>` sample memory every N iterations (default: 1)
- `--mem` enable memory tracking
- `--mem-sample=<n>` sample memory every N iterations (default: 1)
- `--json[=<path>]` write results to JSON (default: `latest-<suite>-bench-run.json` when `--suite` is set, otherwise `latest-bench-run.json`)
