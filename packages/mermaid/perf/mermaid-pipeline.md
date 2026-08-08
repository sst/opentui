# Mermaid pipeline benchmark

`src/benchmark/pipeline-benchmark.ts` measures the imported Mermaid renderer as a CPU and allocation pipeline. Its primary result is the median nanoseconds needed to detect, parse, draw, and convert one deterministic medium diagram to OpenTUI `StyledText`.

## Workload

The benchmark embeds one medium fixture for each supported family:

- Flowchart: subgraphs, mixed node shapes, labels, and solid/dashed/thick routes.
- State: composite states, transitions, terminal markers, and a note.
- Sequence: five participants, activations, request/response messages, a note, fragments, and a loop.

`pipeline_complete` cycles these fixtures and is the primary cross-family measurement. `pipeline_flowchart`, `pipeline_state`, and `pipeline_sequence` expose family end-to-end costs. The `stage_detect`, `stage_parse`, `stage_draw`, and `stage_styled_text` cases isolate likely sources of a regression; their values are diagnostics and are not expected to add up exactly to the complete pipeline.

Every measured operation returns a small value derived from its output. A module-level blackhole consumes those values after each batch so engines cannot safely discard the work.

## Protocol

- Clock: `process.hrtime.bigint()`.
- Calibration: each case increases its batch size until it reaches the suite's target batch duration. Cross-family batches remain multiples of three so every batch has the same family mix.
- Warmup: two calibrated batches by default.
- Measurement: seven calibrated batches by default.
- Center: median nanoseconds per diagram.
- Spread: `(maximum - minimum) / median` across measured batches.
- RME: two-sided 95% Student's t relative margin of error around the sample mean.

The default suite targets 400 ms per batch and normally completes in roughly 30 to 45 seconds on a developer machine. Run it on an otherwise idle machine, compare the same Bun version and architecture, and prefer repeated process-level runs when deciding whether a small change is real.

## Commands

From the repository root:

```sh
# Fast smoke test, approximately a few seconds
bun packages/mermaid/src/benchmark/pipeline-benchmark.ts --suite=quick

# Calibrated default run
bun packages/mermaid/src/benchmark/pipeline-benchmark.ts

# Machine-readable artifact
bun packages/mermaid/src/benchmark/pipeline-benchmark.ts --json=/tmp/mermaid-pipeline.json

# One or more comma-separated diagnostics
bun packages/mermaid/src/benchmark/pipeline-benchmark.ts --scenario=pipeline_complete,stage_draw
```

Useful overrides are `--target-batch-ms=<ms>`, `--warmup-rounds=<n>`, `--rounds=<n>`, `--no-output`, and `--list-scenarios`. `--json=<path>` writes environment, fixture, raw-round, summary, and checksum data.

The stable primary line is:

```text
METRIC mermaid_pipeline_ns_per_diagram=<median> unit=ns/diagram ...
```

Each selected case also emits a diagnostic `METRIC mermaid_pipeline_<case>_ns_per_diagram=...` line. Lower is better.

## Quick baseline

Record quick-mode numbers only as a smoke-test reference. They use three short measured rounds and are intentionally less stable than the default protocol.

Local introduction run on 2026-08-07 with Bun 1.3.14 on macOS arm64:

| Case                 | Median ns/diagram | Spread |    RME |
| -------------------- | ----------------: | -----: | -----: |
| `pipeline_complete`  |      1,508,694.40 |  7.73% | 10.72% |
| `stage_detect`       |          1,165.85 |  0.77% |  1.02% |
| `stage_parse`        |         15,588.65 |  3.19% |  4.46% |
| `stage_draw`         |      1,251,412.04 |  9.73% | 13.12% |
| `stage_styled_text`  |         87,082.19 |  2.89% |  3.80% |
| `pipeline_flowchart` |      1,378,309.70 | 16.07% | 20.23% |
| `pipeline_state`     |      1,210,609.70 | 11.46% | 14.21% |
| `pipeline_sequence`  |      1,227,606.93 |  1.14% |  1.52% |

## Calibrated introduction baseline

Default protocol on 2026-08-07 with Bun 1.3.14 on macOS arm64:

| Case                | Median ns/diagram | Spread |   RME |
| ------------------- | ----------------: | -----: | ----: |
| `pipeline_complete` |      1,411,422.72 | 10.89% | 3.89% |
| `stage_detect`      |          1,196.68 |  2.89% | 1.08% |
| `stage_parse`       |         14,790.87 |  6.08% | 1.92% |
| `stage_draw`        |      1,247,364.38 | 10.53% | 3.27% |
| `stage_styled_text` |         87,072.36 |  2.95% | 1.04% |
| `pipeline_state`    |      1,244,205.83 |  5.37% | 2.00% |
| `pipeline_sequence` |      1,443,938.89 |  3.89% | 1.38% |

The initial flowchart family sample was noisy, so it was repeated with nine 1-second rounds and three warmups:

| Case                 | Median ns/diagram | Spread |   RME |
| -------------------- | ----------------: | -----: | ----: |
| `pipeline_flowchart` |      1,340,340.12 | 11.53% | 2.70% |

The baseline confirms that AST-to-grid drawing dominates this workload. Parsing is approximately 1% of complete render time, so native experiments should start at the canvas/drawing boundary rather than the parser.
