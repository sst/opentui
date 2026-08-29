# Layered Paint Grid Optimization

This is the historical first optimization campaign. The completed second pass
and entire final branch versus actual main are reported in
[Final Branch Versus Actual Main](layered-paint-grid-main-comparison.md), with
[compact measurements](layered-paint-grid-main-results.json). That comparison
finds 14.3% lower equal-weight warm frame time across the nine fixtures, but
remaining workload, cold, OFF-path and short-sequence regressions. The numbers
below describe the earlier runtime and must not be read as the final result.

Completed the bounded research-driven matrix: 14 concrete entries, 13 implemented
and measured, one proven inapplicable; combinations, competing run compression,
ablations, size/overlap sensitivity, memory and correctness checks. This remains
a disabled-by-default experiment, not a production recommendation.

Draft PR: https://github.com/anomalyco/opentui/pull/1466

## Outcome

Final versus initial prototype, 120x40, seven balanced repeats of 300 frames:

- Unchanged: 0.04695 -> 0.03769 ms, 19.7% lower frame time.
- Localized text: 0.12009 -> 0.11431 ms, 4.8% lower.
- Transparent/out-of-layout overlap: 0.08459 -> 0.07303 ms, 13.7% lower.
- Layout movement: 0.45548 -> 0.40533 ms, 11.0% lower.
- Broad content change: 1.79282 -> 1.70401 ms, 5.0% lower.
- Generic request: 0.13583 -> 0.13821 ms, 1.8% higher, within broad repeat variance.
- Raw fallback: 0.12891 -> 0.12073 ms, 6.3% lower.
- Image fallback: 0.12851 -> 0.12718 ms, 1.0% lower, not a robust standalone win.
- Real ScrollBox scrolling: 0.24815 -> 0.22327 ms, 10.0% lower.

The equal-weight geometric mean of final/initial frame-time ratios across these
nine named workloads is 0.9203: **8.0% lower time**, or 1.087x throughput. There
is no production frequency telemetry. Small differences should not be read as
precise improvements: repeat ranges are preserved below and in the JSON data.

Against corrected full rendering, final time changes are respectively -59.2%,
-30.8%, -64.9%, +80.9%, +10.7%, +59.3%, +22.3%, +46.5%, +65.3%. The equal-weight
ratio is 0.9926, effectively unchanged within uncertainty, not a useful universal
speedup. The three successful scene types do not justify hiding the remaining
layout/scroll/generic/fallback regressions. Broad text mutation is mostly outside
the grid and remains dominated by text updates.

Final OFF versus corrected full changes are +9.3%, +21.3%, +10.9%, +5.9%, +1.7%,
+13.8%, -1.5%, +13.1%, -4.5%. Changing scenes vary substantially between runs;
stable/generic/image cases still show roughly 9-14% disabled-path overhead.
There is no zero-overhead claim. Final production changes are native-grid-only,
so the existing OFF hooks/TS dispatch remain, rather than being hidden by a
different harness. All fallback frames are labeled, never counted as skips.

## Kept

- T02: release aborted/fallback payload and index capacity once, rather than
  retaining it and scanning empty lists each fallback frame.
- T04 + T08: one contiguous reference array instead of thousands of per-cell
  allocations; retain that index when exact operation footprints are unchanged.
  Neither alone captures the combined tradeoff: flat rebuilds alone hurt local
  updates, while payload-only reuse removes that rebuild in the common case.
- T05 + T06: no-damage exit and a bounded sparse dirty-cell frontier with existing
  duplicate guards. The frontier costs 19,200 bytes at 120x40. It closes actual
  wide-cell dependencies and clears only visited flags, not layout rectangles.
  T05 is valuable alone; after the other changes its marginal finish-time saving
  is only about 0.2 microseconds, retained as an explicit simple no-work exit.
- T07: summarize actual recorded index ranges and whether inherited-background
  operations exist; avoid unrelated replay/dependency scans. Summaries refresh
  on payload changes even when footprints are identical.
- T10: clear the native target in bulk and replay retained operations when damage
  is broad. This is full native recomposition, not a callback fallback: callbacks
  are never repeated. A bounded half/quarter-screen trial chose one quarter,
  reducing ScrollBox finish time from about 104 to 83 microseconds at 120x40.

No strategy flags, abandoned algorithms or debug profiling code remain in the
library. Nested operation owner identity, payload resource ownership, ordering,
outside-layout custom drawing, clips/opacity, inherited backgrounds, wide spans,
mutable buffers/editors, input registration and native publication retain the
original experiment's contracts.

## Rejected

- T01 forced inlining: no reliable OFF or ON improvement, no memory saving.
- T03 removing per-operation owner: not implemented or timed. Native nested
  attribution tests explicitly require different inner/outer owners, so the
  field is not redundant. Op remains 48 bytes; no narrowing of colors or IDs.
- T09 repeated-cell runs: substantial deep-overlap memory/cold wins, but 52-byte
  scalar Ops and slower general replay. Combined at 120x40, layout finish rose
  from 144 to 180 microseconds and broad finish from 125 to 163. At 240x80/depth4,
  overlap memory fell 2.52MB -> 1.26MB, but layout/broad finish rose 327/286 ->
  483/481 microseconds. Kept simpler scalar records rather than workload-specific
  complexity. The first coarse-damage implementation failed the existing exact
  recomposition-count assertion; refined per-cell run replay passed without
  weakening tests, and is the measured run candidate.
- T11 exact occlusion: conservatively disallowed across wide/inherit dependencies,
  retained hidden payloads, and did not produce a useful gain in these scenes.
  Its scan overhead remained. This does not claim occlusion can never help an
  opaque-only scene with much greater overdraw.
- T12 native skip-pop batching: removes an FFI call for skipped commands, but no
  robust total-frame gain here; rejected extra split push/pop contract.
- T13 initial/generic full-render selection: benchmark output parity passed, but
  it delays initial cache creation and changes existing cache/recovery assertions.
  Both initial-force and warm-only alternatives were measured and rejected.
  Separate 70-frame transition parity traces quantify the hidden work: ordinary
  text first bypass 0.630ms, next eligible construction 1.999ms; generic bypass
  0.183ms followed by 2.726ms reconstruction. These are cold transition diagnostics,
  not steady-state timings. Ordinary inherited text DOES recover in that trace;
  the warm-only variant's immediate post-resize recovery assertion failed, not
  proof of a permanent freeze. No recovery test was weakened in final source.
- T14 existing transparent-text fast helper during replay: independently tested
  after profiling the combined path, no useful measured gain; not kept.

## Research

Primary sources were read, not just search summaries. No external project's
performance numbers are applied to OpenTUI.

- Chromium ordered paint artifacts, cached items/subsequences, property snapshots,
  and repaint-only updates motivated T08/T12 and exact old/new footprint handling:
  https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/graphics/paint/README.md
- WebRender dependency comparisons and dirty regions motivated T05-T07; its
  historical nonbenefiting-scene overhead motivated T10/T13. Large GPU tiles,
  quadtrees and surface promotion do not match a small CPU terminal-cell grid:
  https://doc.servo.org/webrender/picture/index.html
  https://github.com/servo/webrender/issues/3446
- Skia's contiguous record index and arena-owned payload motivated T03/T04/T09,
  not importing the entire SkCanvas command vocabulary:
  https://raw.githubusercontent.com/google/skia/main/src/core/SkRecord.h
- Neovim's dirty line ranges, wide-cell repair and row-offset scrolling motivated
  T06/T09 and the actual ScrollBox fixture. Its window-grid scrolling contract
  does not permit translating arbitrary OpenTUI callbacks:
  https://raw.githubusercontent.com/neovim/neovim/master/src/nvim/grid.c

Explicitly inapplicable families: pure transform replay without invoking arbitrary
changed painters (screen coordinates and absolute drawing are observable);
discovery/replay by calling callbacks twice; hash-only equality or unchecked
width truncation; GPU rasterization/full command VMs/framework-owned dirty state.
These were eliminated by source/contract evidence, not called benchmarked rejects.
Movement remains supported through rerecording and exact index/replay work.

## Profiling And Method

Bun 1.3.14, Zig 0.16.0, Linux x64, ReleaseFast native library, TestRenderer memory
output backend. Root build logs verify ReleaseFast; allocator stats flags are
false for timing. perf was absent; no host permissions, toolchains or services
were modified. Supported Bun CPU profile over the mixed matrix attributed 30.2%
to styled-text mutation, 18.3% text-view drawing, 9.9% native render and 8.9% grid
finish. These samples are neither application weights nor isolated grid costs.
The harness separately times root painting and native finish. A temporary native
phase-counter build showed cold index/allocation dominance and repeated scan
work; native tests build Debug despite -Doptimize, so its phase nanoseconds are
NOT used as ReleaseFast timing claims. Profiling code was removed before timing.

Every concrete timing trial used the common initial runtime c2b5d5d9, except
explicitly named combinations/ablations. Five repeats, 20 warmup frames, 100
measured frames, alternating OFF/ON order; 108 paired exact char/fg/bg/attribute
frames pass before timing. Original eight 120x40 scenes are unchanged, plus a
real ScrollBox.scrollTo fixture. Timings include mutation, framework/native
painting, composition and publication. They do not infer speed from paint-call
counts. Stable frames are explicitly rendered, not an idle-CPU claim.

Final controls use seven repeats/300 frames, run sequentially with matched
harness/source pins: corrected e14c2d6a full, c2b5d5d9 initial, a55beed9 final
runtime. No timings overlapped builds/tests. One 240x80/depth4 sensitivity matrix
for both controls and both finalists checks larger size/deeper overlap without
turning each trial into an unrelated application benchmark. All five/seven
repeat ranges, cold values, OFF controls, fallback counts and hashes are in the
machine-readable comparison; individual samples/logs stay local.

## Memory And Cold

Recorder capacity, initial -> final, bytes in workload order:
916832 -> 450960; 920272 -> 454128; 1205408 -> 762696;
1192032 -> 704400; 1192032 -> 704400; 1170272 -> 704400;
383712 -> 150352; 383712 -> 150352; 658592 -> 430752.
This is 34.6-60.8% less retained recorder memory, including the new sparse queue.
The separate ReleaseFast safe-allocator run's ON-minus-OFF live requested bytes
agree exactly with these capacities in all nine scenes. Base frame growth and
recorder capacity are not summed as separate allocations. No RSS claim.

The same native 80-command allocation fixture now performs 412 cold allocations
instead of 4331 (-90.5%), requesting 724568 instead of 1190432 bytes (-39.1%).
The next 23 localized frames remain 5 allocations/6432 requested bytes; retained
fixture capacity is 454136 instead of 920000 bytes. Counts are measured separately
from speed with FailingAllocator, not inferred from allocator active-count stats.

Final cold medians in workload order are 1.371, 1.142, 5.327, 1.377, 1.112, 1.287,
1.147, 1.204, 0.843ms. Equal-weight cold time is 13.0% lower than the initial
prototype, but cold overlap and image medians regressed in this campaign and
ranges are wide. Cold still materially loses to full rendering. Cache construction
is included, never silently moved into warmup for a claimed final improvement.

## Correctness And Limits

- Final root native/cross-package ReleaseFast build passed; restored library hashes
  match the final timed binary after temporary controls/instrumentation.
- Native: 2123 pass, 8 skip; includes new injected flat-index allocation failure,
  owned linked-wide payload cleanup, repeated abort and successful retry.
- Bun Core: 5496 pass, 23 skip, 239 snapshots. Focused grid suite: 13 pass.
- Portable Node 26.4.0 through repository script: 4753 pass, 6 skip. Initial
  command lacked Node in PATH; explicitly selected the already-installed portable
  runtime, no install or runtime changes. Packed Bun/Node consumers passed.
- React: 59 pass. Solid: 271 pass. One initial Solid run hit a Bun 1.3.14 process
  segmentation fault during worker teardown; the implicated file and a sequential
  full rerun passed unchanged. The crash log is retained, not silently discarded.
- Root fmt/lint, Zig fmt and git diff checks passed. No framework invalidation,
  FFI signature, public config or fallback policy changes in the optimization.

Raw/image scenes fall back every measured frame in every final repeat. Native
broad replay retains recording validity and is NOT labeled fallback. No universal
performance claim, no application-frequency weighting, no GPU/other-OS coverage,
and no claim that all possible optimizations have been exhausted.

## Reproduction

Build from the repository root with `bun run build`, then from packages/core:

```sh
bun src/benchmark/layered-paint-grid.ts
PAINT_REPEATS=7 PAINT_FRAMES=300 bun src/benchmark/layered-paint-grid.ts
PAINT_WIDTH=240 PAINT_HEIGHT=80 PAINT_DEPTH=4 bun src/benchmark/layered-paint-grid.ts
bun run test:native '-Dtest-filter=paint grid'
```

Use `--off-only` for the corrected full-runtime control e14c2d6a with the same
harness from a19122d8. For memory only, native `zig build -Doptimize=ReleaseFast
-Dgpa-safe-stats=true`, Core `bun scripts/build.ts --native --skip-zig`, then
`bun src/benchmark/layered-paint-grid.ts --memory-only`; restore normal root build
before timing. Native allocation traffic is in the focused test log.

Committed compact data: `layered-paint-grid-results.json` next to this report.
Each variant carries source base/patch hash, native binary and harness hashes,
dimensions/repeats/frames/parity and both modes' complete summarized results.
Local investigation directory `artifacts/opentui-paint-grid-optimization/` also
contains PLAN.md, run.ts, raw logs/JSON, exact source patches (including rejected
variants), profiler outputs and transition harness. No raw logs, binaries,
lockfiles or credentials are added to the PR. Historical controls before final
reruns are preserved there as well. Draft remains experimental and related to
#1465, without automatically closing that issue.

## Full Comparison

All vectors use the same workload order: unchanged, localized text, transparent/outside, layout move, broad change, generic request, raw fallback, image fallback, ScrollBox. Values are medians of repeat means; cold values are separate first-frame medians. The JSON retains all repeat ranges and both modes.

### Independent Trials

- **initial-matched** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04360, 0.11837, 0.08941, 0.50111, 1.88406, 0.13877, 0.12043, 0.12643, 0.28927. Cold ms: 1.851, 1.685, 3.956, 1.888, 1.475, 1.646, 1.136, 1.142, 1.170. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.
- **t01** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04443, 0.12181, 0.08094, 0.51853, 1.93553, 0.13595, 0.12179, 0.12588, 0.26396. Cold ms: 1.687, 1.727, 3.889, 1.799, 1.549, 1.617, 1.209, 1.314, 1.261. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.
- **t02** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04486, 0.11823, 0.08800, 0.47165, 1.84472, 0.13864, 0.11835, 0.12232, 0.24725. Cold ms: 1.779, 1.488, 3.868, 1.702, 1.491, 1.457, 1.087, 1.142, 1.018. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 130272, 130272, 658592.
- **t04** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04149, 0.14511, 0.13670, 0.46379, 1.84001, 0.13538, 0.12217, 0.12509, 0.27850. Cold ms: 1.463, 1.194, 4.579, 1.365, 1.196, 1.187, 1.120, 1.250, 0.957. Retained bytes: 430904, 434072, 741560, 684344, 684344, 684344, 383736, 383736, 410984.
- **t05** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03635, 0.12916, 0.08883, 0.48757, 1.89317, 0.13526, 0.12794, 0.12663, 0.31735. Cold ms: 1.549, 1.491, 5.440, 1.665, 1.547, 1.698, 1.192, 1.384, 1.059. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.
- **t06** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03950, 0.10935, 0.07946, 0.46865, 1.82467, 0.13667, 0.12191, 0.12939, 0.28347. Cold ms: 1.814, 1.504, 4.459, 1.664, 1.519, 1.419, 1.270, 1.273, 1.174. Retained bytes: 936056, 939496, 1224632, 1211256, 1211256, 1189496, 402936, 402936, 677816.
- **t07** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03594, 0.10841, 0.06900, 0.46494, 1.88243, 0.13329, 0.12089, 0.13240, 0.31253. Cold ms: 1.683, 1.477, 5.657, 1.633, 1.409, 1.478, 1.085, 1.110, 1.038. Retained bytes: 917664, 921104, 1207320, 1192864, 1192864, 1171104, 384544, 384544, 659136.
- **t08** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04256, 0.10830, 0.08081, 0.45955, 1.81959, 0.13881, 0.12094, 0.12294, 0.23653. Cold ms: 1.739, 1.433, 4.274, 1.478, 1.529, 1.525, 1.090, 1.144, 1.015. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.
- **t09** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04681, 0.11474, 0.07244, 0.53401, 1.87479, 0.20150, 0.12322, 0.12691, 0.26869. Cold ms: 1.757, 1.657, 2.596, 1.533, 1.595, 1.452, 1.120, 1.133, 1.173. Retained bytes: 937952, 941656, 830984, 1234272, 1234272, 1212512, 404832, 404832, 680240.
- **t10** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04544, 0.10821, 0.08902, 0.40520, 1.82270, 0.13835, 0.12029, 0.12407, 0.25036. Cold ms: 1.583, 1.731, 4.559, 1.813, 1.392, 1.365, 1.177, 1.191, 1.002. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.
- **t11** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04414, 0.10895, 0.10995, 0.46599, 1.86893, 0.13985, 0.12044, 0.12174, 0.28176. Cold ms: 1.653, 1.393, 4.084, 1.894, 1.498, 1.475, 1.085, 1.147, 1.030. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.
- **t12** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04349, 0.11786, 0.08832, 0.46700, 1.81321, 0.15089, 0.12165, 0.12377, 0.26225. Cold ms: 1.547, 1.547, 4.857, 1.620, 1.394, 1.437, 1.088, 1.082, 1.072. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.
- **t13** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04631, 0.12420, 0.08022, 0.45780, 1.65136, 0.12096, 0.12108, 0.12262, 0.26493. Cold ms: 0.574, 0.543, 0.792, 0.549, 0.538, 0.518, 0.548, 0.559, 0.659. Retained bytes: 916832, 920272, 1205408, 1192032, 120144, 120144, 120144, 120144, 658592.
- **t13-warm** (ON, 120x40, depth 1, 5x100). Frame ms: 0.08367, 0.13895, 0.08291, 0.46846, 1.73123, 0.12036, 0.11924, 0.12311, 0.24976. Cold ms: 1.596, 1.756, 5.446, 1.602, 1.406, 1.706, 1.059, 1.137, 0.988. Retained bytes: 916832, 920272, 1205408, 1192032, 916832, 916832, 383712, 383712, 658592.
- **t14** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04369, 0.10897, 0.08310, 0.47244, 1.83839, 0.14255, 0.12396, 0.12645, 0.26419. Cold ms: 1.687, 1.487, 6.605, 1.530, 1.675, 1.482, 1.132, 1.202, 1.207. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.

### Combinations And Ablations

- **pair-index** (ON, 120x40, depth 1, 5x100). Frame ms: 0.04404, 0.11451, 0.08760, 0.45230, 1.81059, 0.14145, 0.12297, 0.12566, 0.24493. Cold ms: 1.506, 1.207, 4.187, 1.471, 1.167, 1.541, 1.121, 1.133, 0.913. Retained bytes: 430904, 434072, 741560, 684344, 684344, 684344, 383736, 383736, 410984.
- **combined** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03169, 0.10944, 0.08150, 0.40592, 1.88935, 0.14173, 0.12615, 0.12258, 0.29399. Cold ms: 1.465, 1.192, 5.185, 1.311, 1.127, 1.261, 1.402, 1.196, 0.777. Retained bytes: 431736, 434904, 743472, 685176, 685176, 685176, 131128, 131128, 411528.
- **combined-sparse** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03173, 0.10744, 0.07382, 0.40010, 1.78596, 0.12845, 0.12054, 0.12038, 0.24365. Cold ms: 1.311, 1.233, 3.738, 1.429, 1.367, 1.227, 1.270, 1.203, 0.834. Retained bytes: 450960, 454128, 762696, 704400, 704400, 704400, 150352, 150352, 430752.
- **combined-runs** (ON, 120x40, depth 1, 5x100). Frame ms: 0.02983, 0.12082, 0.06103, 0.45942, 1.85026, 0.13794, 0.13028, 0.12180, 0.28078. Cold ms: 1.528, 1.177, 2.369, 1.329, 1.204, 1.280, 1.173, 1.390, 0.862. Retained bytes: 472080, 475512, 388272, 746640, 746640, 746640, 150352, 150352, 452400.
- **ablate02** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03116, 0.10433, 0.09322, 0.40160, 1.72778, 0.17136, 0.12399, 0.12950, 0.25739. Cold ms: 1.324, 1.227, 5.174, 1.394, 1.075, 1.273, 1.125, 1.328, 0.804. Retained bytes: 450960, 454128, 762696, 704400, 704400, 704400, 403792, 403792, 430752.
- **ablate04** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03197, 0.10019, 0.07254, 0.41284, 1.78967, 0.13300, 0.12286, 0.13028, 0.23059. Cold ms: 1.545, 1.614, 4.560, 1.633, 1.422, 1.545, 1.279, 1.122, 0.967. Retained bytes: 936888, 940328, 1226544, 1212088, 1212088, 1190328, 150328, 150328, 678360.
- **ablate05** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03255, 0.11130, 0.06553, 0.40509, 1.80463, 0.13682, 0.12262, 0.12771, 0.25153. Cold ms: 1.467, 1.241, 4.285, 1.224, 1.140, 1.147, 1.124, 1.474, 0.915. Retained bytes: 450960, 454128, 762696, 704400, 704400, 704400, 150352, 150352, 430752.
- **ablate07** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03184, 0.13251, 0.08519, 0.40154, 1.88314, 0.12812, 0.11952, 0.12645, 0.25230. Cold ms: 1.532, 1.366, 4.519, 1.730, 1.137, 1.680, 1.165, 1.516, 0.886. Retained bytes: 450128, 453296, 760784, 703568, 703568, 703568, 149520, 149520, 430208.
- **ablate08** (ON, 120x40, depth 1, 5x100). Frame ms: 0.02945, 0.15320, 0.12163, 0.40982, 1.82648, 0.13383, 0.12176, 0.12616, 0.25039. Cold ms: 1.276, 1.306, 4.514, 1.185, 1.387, 1.138, 1.154, 1.115, 0.834. Retained bytes: 450960, 454128, 762696, 704400, 704400, 704400, 150352, 150352, 430752.
- **ablate10** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03398, 0.12247, 0.07569, 0.46170, 1.88468, 0.13182, 0.12124, 0.12660, 0.28242. Cold ms: 1.193, 1.182, 4.997, 1.229, 1.165, 1.267, 1.203, 1.162, 0.886. Retained bytes: 450960, 454128, 762696, 704400, 704400, 704400, 150352, 150352, 430752.
- **combined-quarter** (ON, 120x40, depth 1, 5x100). Frame ms: 0.03300, 0.10987, 0.06696, 0.41088, 1.74167, 0.14009, 0.12158, 0.12479, 0.23793. Cold ms: 1.341, 1.133, 5.162, 1.457, 1.149, 1.458, 1.176, 1.101, 0.793. Retained bytes: 450960, 454128, 762696, 704400, 704400, 704400, 150352, 150352, 430752.

### Final And Sensitivity Controls

- **full** (OFF-only, 120x40, depth 1, 5x100). Frame ms: 0.08592, 0.15799, 0.25192, 0.23348, 1.68227, 0.09001, 0.08904, 0.08963, 0.13732. Cold ms: 0.476, 0.460, 0.800, 0.574, 0.485, 0.467, 0.730, 0.507, 0.623. Retained bytes: 0, 0, 0, 0, 0, 0, 0, 0, 0.
- **initial-final** (ON, 120x40, depth 1, 7x300). Frame ms: 0.04695, 0.12009, 0.08459, 0.45548, 1.79282, 0.13583, 0.12891, 0.12851, 0.24815. Cold ms: 1.693, 1.488, 4.559, 1.822, 1.449, 1.477, 1.272, 1.141, 1.032. Retained bytes: 916832, 920272, 1205408, 1192032, 1192032, 1170272, 383712, 383712, 658592.
- **full-final** (OFF-only, 120x40, depth 1, 7x300). Frame ms: 0.09237, 0.16519, 0.20828, 0.22400, 1.53949, 0.08675, 0.09868, 0.08684, 0.13511. Cold ms: 0.438, 0.462, 0.725, 0.499, 0.445, 0.453, 0.505, 0.491, 0.577. Retained bytes: 0, 0, 0, 0, 0, 0, 0, 0, 0.
- **final** (ON, 120x40, depth 1, 7x300). Frame ms: 0.03769, 0.11431, 0.07303, 0.40533, 1.70401, 0.13821, 0.12073, 0.12718, 0.22327. Cold ms: 1.371, 1.142, 5.327, 1.377, 1.112, 1.287, 1.147, 1.204, 0.843. Retained bytes: 450960, 454128, 762696, 704400, 704400, 704400, 150352, 150352, 430752.
- **initial-large** (ON, 240x80, depth 4, 5x100). Frame ms: 0.12208, 0.24997, 0.33724, 1.08664, 3.90226, 0.30704, 0.28017, 0.28859, 0.59011. Cold ms: 4.133, 3.888, 18.186, 4.927, 3.933, 3.803, 2.923, 3.108, 3.151. Retained bytes: 2084512, 2087952, 3277312, 2634912, 2626752, 2591392, 1010112, 1010112, 1564152.
- **full-large** (OFF-only, 240x80, depth 4, 5x100). Frame ms: 0.21427, 0.39826, 0.90087, 0.56957, 3.32742, 0.20982, 0.24521, 0.21014, 0.36354. Cold ms: 1.144, 1.146, 2.929, 1.367, 1.209, 1.178, 1.266, 1.177, 1.266. Retained bytes: 0, 0, 0, 0, 0, 0, 0, 0, 0.
- **final-large** (ON, 240x80, depth 4, 5x100). Frame ms: 0.09324, 0.21283, 0.27609, 0.92581, 3.66689, 0.30290, 0.27849, 0.28530, 0.57514. Cold ms: 3.340, 2.932, 16.783, 3.130, 2.922, 4.269, 2.958, 4.045, 2.911. Retained bytes: 1183800, 1186968, 2524992, 1690680, 1690680, 1690680, 581992, 581992, 1138416.
- **runs-large** (ON, 240x80, depth 4, 5x100). Frame ms: 0.07953, 0.19784, 0.24688, 1.08594, 3.91759, 0.29845, 0.28064, 0.28231, 0.62570. Cold ms: 3.191, 3.127, 6.553, 3.249, 4.164, 4.396, 2.975, 3.002, 3.060. Retained bytes: 1226040, 1229472, 1255528, 1775160, 1775160, 1775160, 581992, 581992, 1181904.

### Final Ranges

Final 120x40 frame-time median and range of seven run means, milliseconds:

- unchanged: corrected full 0.09237 (0.08271-0.10818); initial grid 0.04695 (0.04014-0.06458); final grid 0.03769 (0.02582-0.05987).
- localized-text: corrected full 0.16519 (0.15834-0.20454); initial grid 0.12009 (0.10836-0.14698); final grid 0.11431 (0.09724-0.14413).
- transparent-outside: corrected full 0.20828 (0.20475-0.24535); initial grid 0.08459 (0.07656-0.12680); final grid 0.07303 (0.06263-0.08593).
- layout-move: corrected full 0.22400 (0.22005-0.23110); initial grid 0.45548 (0.44880-0.47096); final grid 0.40533 (0.39910-0.41929).
- all-changed: corrected full 1.53949 (1.46923-1.82705); initial grid 1.79282 (1.72039-1.88162); final grid 1.70401 (1.64755-1.77917).
- generic-request: corrected full 0.08675 (0.08301-0.11920); initial grid 0.13583 (0.13333-0.14724); final grid 0.13821 (0.12011-0.19879).
- raw-fallback: corrected full 0.09868 (0.08286-0.12198); initial grid 0.12891 (0.11696-0.17110); final grid 0.12073 (0.11665-0.17573).
- image-fallback: corrected full 0.08684 (0.08319-0.09622); initial grid 0.12851 (0.11928-0.14426); final grid 0.12718 (0.12116-0.13587).
- scrollbox: corrected full 0.13511 (0.11635-0.15855); initial grid 0.24815 (0.23790-0.27627); final grid 0.22327 (0.21390-0.25544).
