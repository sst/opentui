# CodeRenderable performance

## Goal

Make `CodeRenderable` cheap enough that markdown streaming with fenced code
blocks doesn't pay O(N²) parse cost per appended token, and that
style-only changes don't trip the tree-sitter worker at all.

## Benchmark command

```
cd packages/core
bun src/benchmark/code-benchmark.ts --runs=9 --warmup=1 \
  --json=../../perf/code-baseline.json
```

Useful filters:

- `--only=b1,b2,b3,b4` to run a subset
- `--stream-chunks=200 --stream-chunk-size=40` to tune B2 size

## Primary metric

`b2_streaming_total_ms` — wall-clock time for the simulated streaming
append (200 chunks × 40 chars into a ~5.9 KB TypeScript snippet) to fully
settle. This is the scenario that dominates real-world cost (markdown
streaming, AI chat output).

## Secondary metrics

| Metric                       | What it measures                                                  |
| ---------------------------- | ----------------------------------------------------------------- |
| `b1_single_shot_ms`          | First highlight of a 5.9 KB snippet, end-to-end                   |
| `b1_single_shot_msgs`        | Worker round-trips for one content set                            |
| `b1_single_shot_bytes`       | Bytes posted to worker (JSON-stringified message length)          |
| `b2_streaming_total_ms`      | Streaming append end-to-end (chunk loop + final settle)           |
| `b2_streaming_settle_ms`     | Time after final append until last highlight applies (pure waste) |
| `b2_streaming_msgs`          | Round-trips during stream (200 expected baseline → want fewer)    |
| `b2_streaming_bytes`         | Bytes posted (~2 MB baseline → want orders less)                  |
| `b3_conceal_toggle_ms`       | Flipping `conceal` on stable content                              |
| `b3_conceal_toggle_msgs`     | Round-trips for conceal toggle (should be 0)                      |
| `b3_syntaxstyle_swap_ms`     | Swapping `syntaxStyle` on stable content                          |
| `b3_syntaxstyle_swap_msgs`   | Round-trips for style swap (should be 0)                          |
| `b4_content_reset_ms`        | Set content to X+space, then back to X                            |
| `b4_content_reset_msgs`      | Round-trips for the round-trip (cache hit should make second = 0) |
| `b4_conceal_pingpong_ms`     | Toggle conceal false then true                                    |
| `b4_conceal_pingpong_msgs`   | Round-trips (should be 0 with both cache and cheap-restyle)       |

## Baseline (main @ b2c885d9, code-primitive-perf branch)

See `perf/code-baseline.json` for the full record. Headline numbers:

| Metric                       | Median        | MAD    |
| ---------------------------- | ------------- | ------ |
| `b1_single_shot_ms`          | **15.82 ms**  | 0.46   |
| `b1_single_shot_msgs`        | 1             | 0      |
| `b1_single_shot_bytes`       | 6,270 B       | 0      |
| `b2_streaming_total_ms`      | **472.52 ms** | 8.76   |
| `b2_streaming_settle_ms`     | 456.28 ms     | 8.44   |
| `b2_streaming_msgs`          | **200**       | 0      |
| `b2_streaming_bytes`         | **2,058,600** | 0      |
| `b3_conceal_toggle_ms`       | 16.07 ms      | 0.15   |
| `b3_conceal_toggle_msgs`     | **1**         | 0      |
| `b3_syntaxstyle_swap_ms`     | 17.49 ms      | 0.13   |
| `b3_syntaxstyle_swap_msgs`   | **1**         | 0      |
| `b4_content_reset_ms`        | 31.60 ms      | 0.27   |
| `b4_content_reset_msgs`      | **2**         | 0      |
| `b4_conceal_pingpong_ms`     | 33.11 ms      | 0.21   |
| `b4_conceal_pingpong_msgs`   | **2**         | 0      |

### Reading the baseline

- **B2 confirms the streaming pathology.** 200 appends → 200 worker
  round-trips and ~2 MB posted for 8 KB of new content (~250× write
  amplification). 456 ms of the 472 ms wall clock is "settle" — the
  worker is still chewing through stale highlights *after* the user
  stopped typing. Every one of those stale results is discarded by the
  snapshot-id guard. That work is pure waste.

- **B3 confirms style-only changes hit the worker.** Toggling `conceal`
  or swapping `syntaxStyle` should never touch tree-sitter — these
  decisions live downstream of parsing. Today both fire a full reparse.

- **B4 confirms there is no cache.** Re-setting the same content twice
  parses twice. Pingponging `conceal` parses twice. Both should be 0
  round-trips after warmup.

## Files in scope

- `packages/core/src/renderables/Code.ts` — primary
- `packages/core/src/lib/tree-sitter/client.ts` — buffer/edit API exists
  but `CodeRenderable` ignores it
- `packages/core/src/lib/tree-sitter-styled-text.ts` — `treeSitterToTextChunks`
- `packages/core/src/renderables/Markdown.ts` — biggest streaming consumer

## Hypothesis loop

Ordered cheapest-and-likely-largest-win first.

### H1 — Content-keyed cache

`CodeRenderable` (or `TreeSitterClient.highlightOnce`) maintains a small
LRU keyed on `(filetype, hash(content))` → `SimpleHighlight[]`. Expect:

- `b4_content_reset_msgs`: 2 → 1
- `b4_conceal_pingpong_msgs`: 2 → 0 (once H3 lands; until then it
  still re-chunks)
- `b2_streaming_*`: ~no change (chunks are unique)

### H2 — Debounce / coalesce streaming

In streaming mode, replace per-edit `highlightOnce` calls with a small
debounce (e.g. 8–16 ms) keyed on the latest snapshot, so 200 quick
appends collapse to a handful of highlights. Expect:

- `b2_streaming_msgs`: 200 → 5–15
- `b2_streaming_bytes`: ~2 MB → tens of KB
- `b2_streaming_settle_ms`: 456 ms → ≤ 20 ms

### H3 — Cheap restyle path

`conceal`, `syntaxStyle`, `drawUnstyledText`, `onChunks` should not set
`_highlightsDirty`. Instead cache `_lastHighlights` after each successful
highlight and re-run `treeSitterToTextChunks` against the cached
highlights when only chunk-affecting state changes. Expect:

- `b3_conceal_toggle_msgs`: 1 → 0
- `b3_syntaxstyle_swap_msgs`: 1 → 0
- `b3_*_ms`: ~half the current cost (no worker hop, just chunking)

### H4 — Incremental edits

`CodeRenderable` opens a stateful buffer in `TreeSitterClient` and sends
`Edit[]` ranges on `set content`. Expect:

- `b1_single_shot_ms`: unchanged (first edit is still full content)
- `b2_streaming_total_ms`: further drop (incremental parse on tail)
- Better large-snippet scaling (untested by this harness today)

Add a B5 large-snippet scenario (~50 KB) once we touch H4 to verify
incremental parse actually wins.

## Signals to watch

- Stale results: the snapshot-id guard silently throws away work. If a
  fix increases `b2_streaming_msgs` but is "faster", we're probably
  measuring something we don't intend.
- Test suite (`bun run test:js` filtered to `Code`/`Markdown`) — these
  optimisations must not change visible output.
- Worker boot: B1 includes worker init the first time. We preload the
  parser before measuring, but watch the first run for outliers.

## Dead ends

(none yet)
