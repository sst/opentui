# Portable FFI Fast-Path Benchmark

This benchmark measures the public production wrappers for the 19 OpenTUI calls that miss Node 26.4's x86-64 SysV Fast
API path. It does not introduce or exercise a benchmark-only ABI.

## Scenarios

The 23 scenarios split behaviorally distinct inputs while mapping to 19 calls:

- `setPendingSplitFooterTransition` and `commitSplitFooterSnapshot`
- `drawFrameBuffer`, as full-buffer and explicit-region copies
- `bufferDrawText`, with short ASCII, long ASCII, and Unicode inputs
- `bufferSetCellWithAlphaBlending` and `bufferSetCell`
- `bufferDrawChar`, with a scalar and a retained packed grapheme from `encodeUnicode`
- `bufferDrawSuperSampleBuffer` and `bufferDrawPackedBuffer`, with valid retained input layouts
- `bufferDrawGrayscaleBuffer` and `bufferDrawGrayscaleBufferSupersampled`
- `bufferDrawGrid` and `bufferDrawBox`
- `textBufferGetTextRangeByCoords` and `editBufferGetTextRangeByCoords`
- TextBufferView `setLocalSelection` and `updateLocalSelection`
- EditorView `setLocalSelection` and `updateLocalSelection`

Every child process creates a headless renderer with `createTestRenderer`, obtains the production library through
`resolveRenderLib`, and passes live native handles to the public wrappers. Pointer backing arrays and encoded graphemes
remain alive until teardown. Views are destroyed before their buffers, scenario-owned buffers are destroyed before the
renderer, and renderer-owned borrowed buffers are never destroyed by the benchmark.

## Running

Run from `packages/core`:

```sh
bun run bench:ffi-fast-path --suite=default --json=/tmp/ffi-baseline.json
bun run bench:ffi-fast-path --suite=default --json=/tmp/ffi-candidate.json
bun run bench:ffi-fast-path-compare /tmp/ffi-baseline.json /tmp/ffi-candidate.json --json=/tmp/ffi-compare.json
```

Options:

- `--list-scenarios` prints scenario names without building the Node child.
- `--scenario=name[,name...]` selects scenarios.
- `--suite=quick|default|long` selects 15 ms, 75 ms, or 250 ms target samples, with corresponding warmup budgets.
- `--runs=N` sets process rounds and defaults to 9.
- `--json=path` writes the complete report, including raw process-round samples.
- `--no-output` suppresses progress and tables but still writes `--json` output.

The runner uses `NODE26_PATH` when set and otherwise resolves `node` from `PATH`. It requires Node 26.4.0. Set it to an
x86-64 Node binary when measuring the x86-64 SysV signatures on Apple Silicon. The runner records each child runtime's
architecture. It builds the child with Bun's Node target; the child itself uses only portable Node APIs and OpenTUI's
shared runtime path.
Each process round runs every selected scenario once under each runtime. Runtime order alternates Bun/Node then Node/Bun,
and scenario order reverses on alternating rounds.

## Measurement

Setup and teardown are outside the sample. The child warms each live scenario, scales an inner-loop operation count from
the latest warmup batch, and uses bounded calibration retries before retaining one batch near the suite target, timed
with `process.hrtime.bigint()`. `operations` is the number of direct target-wrapper invocations in that retained batch;
`nsPerOp` is elapsed nanoseconds divided by that count. Each sample also records an observable checksum derived from
return values or resulting native object state. Calibration and observation calls are not included in the reported
operation count.

The JSON report includes raw process-round values, operation counts, checksums, runtime/version/platform/architecture,
and median/mean/min/max summaries. Process startup and setup are retained separately as `wallMs`, not charged to
`nsPerOp`.

## Acceptance Protocol

Collect baseline and candidate reports from separate revisions on the same otherwise-idle machine, with no concurrent
benchmark or other sustained workload. Use the same suite, scenario set, Node binary, Bun version, platform, and
architecture. Collect at least 9 process rounds per revision; do not concatenate repeated samples from one process or
treat baseline and candidate rounds as paired observations.

The compare script calculates, per scenario and runtime:

1. Point estimate: `median(candidate ns/op) / median(baseline ns/op)`. Change is ratio minus one.
2. A deterministic percentile 95% bootstrap interval over that change. Each replicate independently resamples baseline
   process rounds and candidate process rounds with replacement, computes both medians, then computes their ratio minus
   one. The process round is the sampling unit. There is no fabricated baseline/candidate pairing.
3. Node acceptance: median improvement is at least 10% and the interval upper bound is below 0%, excluding zero
   regression.
4. Bun acceptance: median regression is no more than 3% and the interval upper bound is no greater than 3%.

The compare script marks acceptance false when either input has fewer than 9 process rounds. The deterministic bootstrap
seed is derived from scenario and runtime names and uses 20,000 replicates. Bootstrap determinism makes reports
reproducible; it does not remove environmental noise, which is why isolated alternating process rounds and the
same-machine requirement remain mandatory.
