# Portable FFI Fast-Path Benchmark

This benchmark measures the public production wrappers for the 19 OpenTUI calls that miss Node 26.4's x86-64 SysV Fast
API path. It does not introduce or exercise a benchmark-only ABI.

## Scenarios

The 24 scenarios split behaviorally distinct inputs while mapping to 19 calls:

- `setPendingSplitFooterTransition` and `commitSplitFooterSnapshot`
- `drawFrameBuffer`, as full-buffer and explicit-region copies
- `bufferDrawText`, with short ASCII, long ASCII, and Unicode inputs
- `bufferSetCellWithAlphaBlending` and `bufferSetCell`
- `bufferDrawChar`, with a scalar and a retained packed grapheme from `encodeUnicode`
- `bufferDrawSuperSampleBuffer`, with one-cell and 80x24 terminal images, and `bufferDrawPackedBuffer`
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

## Decision Log

### Split Footer Transition Descriptor

The one-pointer transition descriptor was evaluated on Node 26.4.0 x86-64 and Bun 1.3.14 arm64 over 9 process rounds.
It was rejected because it failed Bun non-inferiority.

| Runtime |    Baseline |  Descriptor |  Change |             95% CI | Decision |
| ------- | ----------: | ----------: | ------: | -----------------: | -------- |
| Node    | 363.2 ns/op | 271.9 ns/op |  -25.1% |   [-31.3%, -16.7%] | Pass     |
| Bun     |  21.5 ns/op | 128.8 ns/op | +498.2% | [+491.0%, +509.6%] | Fail     |

### Packed Split Footer Commit

The three-scalar packed commit ABI was evaluated over 9 process rounds. It was rejected because it failed Bun
non-inferiority.

| Runtime |     Baseline |       Packed | Change |           95% CI | Decision |
| ------- | -----------: | -----------: | -----: | ---------------: | -------- |
| Node    | 1478.0 ns/op | 1199.6 ns/op | -18.8% |  [-25.2%, -8.7%] | Pass     |
| Bun     |  466.3 ns/op |  539.3 ns/op | +15.6% | [+12.6%, +17.9%] | Fail     |

### Frame Buffer Full And Region Split

The three-scalar full-blit path and one-pointer region descriptor were evaluated together over 9 process rounds. Both
were rejected because they failed the acceptance gate.

| Scenario | Runtime |    Baseline |    Candidate |  Change |             95% CI | Decision |
| -------- | ------- | ----------: | -----------: | ------: | -----------------: | -------- |
| Full     | Node    | 434.1 ns/op |  181.4 ns/op |  -58.2% |   [-64.1%, -48.4%] | Pass     |
| Full     | Bun     |  27.9 ns/op |   40.8 ns/op |  +46.1% |   [+45.0%, +47.4%] | Fail     |
| Region   | Node    | 444.2 ns/op | 1053.5 ns/op | +137.2% |  [-28.6%, +187.9%] | Fail     |
| Region   | Bun     |  29.7 ns/op |  147.4 ns/op | +396.1% | [+391.8%, +402.0%] | Fail     |

### Text Draw Metadata Descriptor

The three-argument text-owner and metadata-descriptor ABI was evaluated over 9 process rounds. It was rejected because
all workloads failed the acceptance gate.

| Scenario | Runtime |     Baseline |    Candidate |  Change |             95% CI | Decision |
| -------- | ------- | -----------: | -----------: | ------: | -----------------: | -------- |
| Short    | Node    | 1326.2 ns/op | 1215.3 ns/op |   -8.4% |  [-10.7%, +139.9%] | Fail     |
| Short    | Bun     |   71.8 ns/op |  530.1 ns/op | +637.9% | [+631.3%, +653.0%] | Fail     |
| Long     | Node    | 2982.8 ns/op | 4446.1 ns/op |  +49.1% |  [-10.7%, +107.7%] | Fail     |
| Long     | Bun     | 1229.4 ns/op | 1737.1 ns/op |  +41.3% |   [+39.8%, +43.0%] | Fail     |
| Unicode  | Node    | 7751.5 ns/op | 8531.0 ns/op |  +10.1% |  [+4.0%, +1243.0%] | Fail     |
| Unicode  | Bun     | 4330.1 ns/op | 5253.9 ns/op |  +21.3% |   [+17.2%, +22.7%] | Fail     |

### Scalar Cell ABI

The six-scalar cell ABI was evaluated over 9 process rounds. It was rejected because every workload failed Bun
non-inferiority; the scalar `bufferDrawChar` Node interval also crossed zero.

| Scenario        | Runtime |    Baseline |   Candidate |  Change |             95% CI | Decision |
| --------------- | ------- | ----------: | ----------: | ------: | -----------------: | -------- |
| Alpha set       | Node    | 955.3 ns/op | 636.2 ns/op |  -33.4% |   [-45.3%, -15.6%] | Pass     |
| Alpha set       | Bun     |  51.3 ns/op | 208.2 ns/op | +305.6% | [+301.4%, +309.8%] | Fail     |
| Direct set      | Node    | 842.2 ns/op | 562.3 ns/op |  -33.2% |   [-91.4%, -19.2%] | Pass     |
| Direct set      | Bun     |  37.1 ns/op | 190.8 ns/op | +414.1% | [+410.1%, +417.7%] | Fail     |
| Scalar char     | Node    | 775.3 ns/op | 554.7 ns/op |  -28.5% |   [-91.2%, +27.8%] | Fail     |
| Scalar char     | Bun     |  36.9 ns/op | 185.3 ns/op | +401.9% | [+396.1%, +407.6%] | Fail     |
| Packed grapheme | Node    | 878.4 ns/op | 601.2 ns/op |  -31.6% |   [-90.3%, -26.8%] | Pass     |
| Packed grapheme | Bun     |  45.8 ns/op | 200.5 ns/op | +338.1% | [+327.7%, +345.7%] | Fail     |

### Supersample Metadata Descriptor

The three-argument supersample descriptor was evaluated over 9 process rounds at one-cell and 80x24 frame sizes. It was
rejected because neither size passed both runtime gates.

| Scenario    | Runtime |      Baseline |     Candidate |  Change |             95% CI | Decision |
| ----------- | ------- | ------------: | ------------: | ------: | -----------------: | -------- |
| One cell    | Node    |   626.6 ns/op |   316.8 ns/op |  -49.4% |    [-57.4%, -1.6%] | Pass     |
| One cell    | Bun     |    35.5 ns/op |   144.8 ns/op | +308.2% | [+296.0%, +319.2%] | Fail     |
| 80x24 frame | Node    | 31356.6 ns/op | 31335.9 ns/op |   -0.1% |     [-0.5%, +1.3%] | Fail     |
| 80x24 frame | Bun     | 21789.3 ns/op | 21982.1 ns/op |   +0.9% |     [+0.5%, +1.2%] | Pass     |
