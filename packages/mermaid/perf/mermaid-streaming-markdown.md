# Mermaid streaming Markdown benchmark

`src/benchmark/streaming-markdown-benchmark.ts` measures Mermaid fences through the real OpenTUI integration path: a test `CliRenderer`, `MarkdownRenderable`, Mermaid's Markdown node renderer, reconciliation, diagram rendering, and frame production.

## Workload

One cycle applies four revisions to the same streaming Markdown renderable:

1. `reset_valid` replaces the fence with a small valid flowchart.
2. `valid_growth` appends a valid node and edge.
3. `invalid_partial_fallback` appends an incomplete edge and must retain the last valid rendered diagram.
4. `final_completion` completes that edge and renders the new diagram.

Before timing, a correctness preflight captures every phase's frame. It verifies that valid labels appear, Mermaid source does not leak into valid output, the incomplete revision retains the previous diagram rather than falling back to code, and the completed label appears in the final phase.

The primary result is median nanoseconds per complete four-update cycle. Per-phase nanoseconds per update are diagnostics collected inside the same cycles, preserving the state and cache behavior of actual streaming. Phase values need not sum exactly to the cycle result because the outer measurement includes loop and promise bookkeeping.

## Protocol

- Clock: `process.hrtime.bigint()` around awaited renderer updates.
- Calibration: whole-cycle batch size grows until the suite's target batch duration.
- Warmup: two calibrated batches by default.
- Measurement: seven calibrated batches by default.
- Center: median nanoseconds per cycle or phase update.
- Spread: `(maximum - minimum) / median` across measured batches.
- RME: two-sided 95% Student's t relative margin of error around the sample mean.
- Cleanup: the renderer is destroyed in a `finally` block on success or failure.

## Commands

From `packages/mermaid`:

```sh
# Fast smoke test
bun run bench:streaming --suite=quick

# Calibrated default run
bun run bench:streaming

# Machine-readable artifact
bun run bench:streaming --json=/tmp/mermaid-streaming-markdown.json
```

Useful overrides are `--target-batch-ms=<ms>`, `--warmup-rounds=<n>`, `--rounds=<n>`, and `--no-output`. `--json=<path>` writes environment, workload, raw-round, summary, and checksum data.

The stable primary line is:

```text
METRIC mermaid_streaming_markdown_ns_per_cycle=<median> unit=ns/cycle ...
```

Each phase also emits a `METRIC mermaid_streaming_markdown_phase_<phase>_ns_per_update=...` diagnostic. Lower is better.

## Quick baseline

Quick-mode numbers are smoke-test references. They use three short measured rounds and are intentionally less stable than the default protocol.

Local introduction run on 2026-08-07 with Bun 1.3.14 on macOS arm64:

| Measurement                      |    Median ns | Spread |    RME |
| -------------------------------- | -----------: | -----: | -----: |
| `streaming_cycle`                | 1,417,747.00 | 21.20% | 26.20% |
| `phase_reset_valid`              |   332,220.29 | 24.05% | 34.23% |
| `phase_valid_growth`             |   389,223.21 | 20.71% | 25.73% |
| `phase_invalid_partial_fallback` |   182,794.71 | 10.43% | 14.24% |
| `phase_final_completion`         |   519,788.79 | 56.01% | 68.28% |

The cycle is the stable comparison target. Short phase samples are more sensitive to scheduler and timer noise, especially the cheaper fallback update.

## Calibrated introduction baseline

Default protocol on 2026-08-07 with Bun 1.3.14 on macOS arm64:

| Measurement                      |  Median ns | Spread |    RME |
| -------------------------------- | ---------: | -----: | -----: |
| `streaming_cycle`                | 948,453.33 | 39.30% | 12.50% |
| `phase_reset_valid`              | 209,643.80 | 29.07% |  9.19% |
| `phase_valid_growth`             | 267,323.74 | 29.32% |  8.65% |
| `phase_invalid_partial_fallback` | 128,199.72 | 51.73% | 15.81% |
| `phase_final_completion`         | 339,424.63 | 52.44% | 16.56% |

The individual update phases are diagnostic only. Keep an optimization only when the complete-cycle improvement is comfortably larger than the observed process-level noise and repeats in a fresh run.

## Experiments

### Pass block identity without constructing the default renderable

- Hypothesis: creating and immediately destroying a default `CodeRenderable` only to read its ID adds avoidable work to every custom Mermaid update.
- Change: expose the assigned block ID on `RenderNodeContext` and consume it directly in the Mermaid adapter.
- Before: 948,453 ns/cycle.
- After: 911,507 ns/cycle.
- Result: 3.9% lower median cycle latency, with the invalid-fallback phase 7.8% lower. Kept because it also removes an allocation-heavy no-op path for every custom Markdown renderer.

### Measure only the rendered height

- Hypothesis: the Markdown adapter scans and measures every rendered row's width even though it only consumes the diagram height.
- Change: add a trim-aware `getTextHeight()` canvas query; use direct canvas height for sequence diagrams.
- Before: 911,507 ns/cycle.
- After: 869,267 ns/cycle.
- Result: 4.6% lower median cycle latency with 1.2% RME. Kept.

### Track visible row extents during drawing

- Hypothesis: trimming and styled-run conversion repeatedly scan blank tails across the full canvas width.
- Change: track each row's rightmost visible cell as cells are written or cleared.
- Before: 869,267 ns/cycle.
- After: 762,564 ns/cycle.
- Result: 12.3% lower median cycle latency with 1.3% RME. Kept.

### Reuse custom renderables in place

- Hypothesis: destroying and recreating the Mermaid `TextRenderable` on every revision adds avoidable Yoga, listener, and reconciliation work.
- Change: expose the previous custom block renderable during reconciliation; update Mermaid content and height in place while retaining cache ownership and scroll state.
- Before: 762,564 ns/cycle.
- After: 675,101 ns/cycle.
- Result: 11.5% lower median cycle latency with 0.73% RME. Invalid partial fallback dropped from 112,315 to 40,504 ns/update. Kept.

## Dead ends

### Share one empty cell object across the canvas

- Hypothesis: replacing one object allocation per empty cell with a shared sentinel would reduce construction and GC cost.
- Result: regressed from 762,564 ns/cycle to 813,423 ns and 1,143,976 ns in two runs.
- Decision: discarded. The aliased rows appear less optimization-friendly than independently allocated cells in Bun's JavaScript engine.

### Avoid metadata spread when no metadata is present

- Hypothesis: constructing a smaller incoming cell object would reduce write-path allocation cost.
- Result: regressed from 762,564 ns/cycle to 779,613 ns/cycle with 1.9% RME.
- Decision: discarded; the branch harms object-shape consistency more than it saves.
