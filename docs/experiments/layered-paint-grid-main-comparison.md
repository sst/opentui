# Paint Grid: Final Branch Versus Actual Main

Second, regression-focused pass. Draft PR: https://github.com/anomalyco/opentui/pull/1466

## Answer

The final opt-in mode has **14.3% lower equal-weight geometric-mean warm frame time** than actual main across the nine named workloads (0.8575 time ratio, 1.166x throughput). **It is not a general speedup without regressions.** Layout, broad changes, generic requests, raw/image fallback and scrolling still cost more. Cold creation and short mixed sequences also retain substantial costs. The feature remains OFF by default.

Versus the previous optimized branch, equal-weight warm time is -15.2%. This is the entire final runtime, including issue1465 correctness fixes and both optimization passes, not a comparison to the original prototype alone. No application-frequency weighting is assumed.

## Pins And Method

- Actual remote main: `202e1e6a0013252b6d0cd08c034e25f21d55f220`.
- Previous optimized branch: `29ca3ced7cd0c237b2bb1af52f2f94c0acff7351`.
- Final measured runtime: `5dddbd67259467fe6acf7041dca99d3ff701e794` (the later documentation commit does not alter runtime code).
- Corrected full control: `e14c2d6a208eb927e31c6cbd8d80eb21f51fb5e2`, explicitly NOT main.
- Final ReleaseFast library SHA256: `ec8b15f1d363f31b46362445f2ea7ef14559f7e5376a202135eab19bfa6bb5df`.
- Identical harness SHA256: `ebb5843072c3fef6ac12bd0d81be6bb7aa33fe29fd60a823dc19f65bba4d43fa`. Every control's binary/source SHA and settings are in the accompanying JSON.
- Linux x64, Bun 1.3.14, Zig 0.16.0, native ReleaseFast, TestRenderer memory-output backend. Allocator instrumentation is OFF for CPU measurements. No concurrent builds/tests/timings; one worktree and one cache tree.
- 120x40: main and final each have two seven-repeat runs of 300 frames (14 repeat means); prior and corrected full have seven. OFF/ON order alternates per repeat. Controls and confirmations run sequentially, with actual main measured twice; prior/control snapshots are rebuilt from actual committed sources, not inferred from a baseline label.
- 240x80/depth4: five repeats of 100 frames for actual main, prior and final. Same nine fixtures, including a real ScrollBox.scrollTo scene. Warmup 20 frames is explicit; cold and recovery are reported separately.
- Exact char/fg/bg/attribute bytes match actual main for all nine fixtures in 252 normal and 252 mixed frames per mode, at both sizes. This is in addition to the 108 paired ON/OFF frames before each timing run. No unequal-output scene is counted as an equivalent-work speedup.
- Issue1465 framebuffer-opacity/tracker independence and clipped transparent-border fixes remain. Their corner-case behavior intentionally differs from main; these nine performance fixtures do not trigger those bugs. Existing dedicated correctness tests cover the fixes.
- Values below are medians of repeat means, not individual fastest frames. Full min/max ranges are retained. Small changes within overlapping ranges are not robust standalone wins.

## Warm Comparison

Milliseconds per frame. ON denotes the experimental mode even when that frame deliberately takes full fallback.

| Workload            |    Main | Prior ON | Final ON | Final/Main | Final/Prior | Final OFF/Main |
| ------------------- | ------: | -------: | -------: | ---------: | ----------: | -------------: |
| unchanged           | 0.08523 |  0.03770 |  0.03508 |     -58.8% |       -7.0% |         +13.1% |
| localized-text      | 0.16373 |  0.11711 |  0.12709 |     -22.4% |       +8.5% |          +9.6% |
| transparent-outside | 0.20684 |  0.07215 |  0.07105 |     -65.7% |       -1.5% |         +10.5% |
| layout-move         | 0.22597 |  0.40092 |  0.25755 |     +14.0% |      -35.8% |          +6.1% |
| all-changed         | 1.50892 |  1.71071 |  1.62470 |      +7.7% |       -5.0% |          +7.5% |
| generic-request     | 0.08751 |  0.13221 |  0.10837 |     +23.8% |      -18.0% |          +8.6% |
| raw-fallback        | 0.08808 |  0.11849 |  0.09883 |     +12.2% |      -16.6% |         +16.5% |
| image-fallback      | 0.08765 |  0.12119 |  0.10142 |     +15.7% |      -16.3% |         +10.0% |
| scrollbox           | 0.12649 |  0.22435 |  0.14642 |     +15.7% |      -34.7% |          +1.9% |

Against corrected full, the equal-weight warm ratio is 0.8669. Actual-main results, not that attribution control, determine the headline. Disabled paths still have measurable overhead; there is no zero-overhead claim.

### Repeat Ranges

- unchanged: main 0.08523 (0.08210-0.14135); prior 0.03770 (0.03079-0.04602); final 0.03508 (0.02775-0.04435); OFF 0.09642 (0.09226-0.11844).
- localized-text: main 0.16373 (0.14865-0.25600); prior 0.11711 (0.10979-0.19126); final 0.12709 (0.11436-0.16223); OFF 0.17951 (0.16552-0.21432).
- transparent-outside: main 0.20684 (0.20184-0.27436); prior 0.07215 (0.06220-0.08551); final 0.07105 (0.06667-0.09376); OFF 0.22852 (0.22261-0.26486).
- layout-move: main 0.22597 (0.22021-0.23275); prior 0.40092 (0.39742-0.41595); final 0.25755 (0.24865-0.32168); OFF 0.23973 (0.23368-0.26634).
- all-changed: main 1.50892 (1.44674-1.80276); prior 1.71071 (1.65252-1.83057); final 1.62470 (1.53256-1.99202); OFF 1.62160 (1.45767-1.68536).
- generic-request: main 0.08751 (0.08267-0.11039); prior 0.13221 (0.12517-0.15212); final 0.10837 (0.09842-0.12812); OFF 0.09505 (0.09202-0.15019).
- raw-fallback: main 0.08808 (0.08277-0.13342); prior 0.11849 (0.11700-0.12869); final 0.09883 (0.09529-0.13004); OFF 0.10261 (0.09159-0.13961).
- image-fallback: main 0.08765 (0.08388-0.10632); prior 0.12119 (0.11846-0.12798); final 0.10142 (0.09763-0.11123); OFF 0.09637 (0.09300-0.10565).
- scrollbox: main 0.12649 (0.11527-0.16903); prior 0.22435 (0.21267-0.23134); final 0.14642 (0.13269-0.20973); OFF 0.12889 (0.11934-0.15219).

### Actual Work

| Workload            | Final painter calls/frame | Full-fallback frames/300 | Last recomposed cells | Retained recorder bytes |
| ------------------- | ------------------------: | -----------------------: | --------------------: | ----------------------: |
| unchanged           |                         0 |                        0 |                     0 |                  450960 |
| localized-text      |                         1 |                        0 |                     1 |                  454128 |
| transparent-outside |                         1 |                        0 |                    52 |                  762696 |
| layout-move         |                        80 |                      300 |                     0 |                  450960 |
| all-changed         |                        80 |                      300 |                     0 |                  450960 |
| generic-request     |                        80 |                      300 |                     0 |                  450960 |
| raw-fallback        |                        81 |                      300 |                     0 |                  150352 |
| image-fallback      |                        81 |                      300 |                     0 |                  150352 |
| scrollbox           |                        40 |                      300 |                     0 |                  300864 |

The layout/broad/generic/scroll improvements are cheaper full rendering, NOT incremental grid wins. Raw/image remain approved full fallback on every measured frame. Zero recomposed grid cells on a full fallback does not mean zero painting; the call counts show the work. Stable/localized/outside scenes retain genuine clean-paint skipping and independent hit registration.

## Cold And Transitions

Cold is the first rendered frame, including initial cache construction. Its equal-weight nine-workload time ratio is 2.606x main. The final policy eagerly constructs the initial cache: a cheap-first-frame alternative was rejected after measuring the deferred work. Normal cold values are separate from the mixed trace's first-three-frame totals.

| Workload            | Main cold ms | Prior cold ms | Final cold ms | Final/Main |
| ------------------- | -----------: | ------------: | ------------: | ---------: |
| unchanged           |        0.499 |         1.367 |         1.275 |    +155.7% |
| localized-text      |        0.480 |         1.100 |         1.219 |    +154.2% |
| transparent-outside |        0.723 |         4.332 |         4.948 |    +584.8% |
| layout-move         |        0.510 |         1.367 |         1.269 |    +149.0% |
| all-changed         |        0.451 |         1.106 |         1.124 |    +149.3% |
| generic-request     |        0.458 |         1.191 |         1.192 |    +160.1% |
| raw-fallback        |        0.515 |         1.486 |         1.254 |    +143.6% |
| image-fallback      |        0.496 |         1.145 |         1.183 |    +138.6% |
| scrollbox           |        0.619 |         1.038 |         0.822 |     +32.7% |

The 28-frame mixed trace starts cold, leaves two unchanged frames, mutates the named workload on frames 3-10, rests 11-15, requests a generic full frame 16, rests 17-21, makes one localized update 22, then rests 23-27. All mutation/render/publication time is included. Snapshot capture is a SEPARATE process from transition timing, avoiding retained base64 data/GC contamination.

| Workload            | Main total28 ms | Prior total28 ms | Final total28 ms | Final/Main | Final startup3 ms | First burst recovery2 ms | Generic recovery2 ms |
| ------------------- | --------------: | ---------------: | ---------------: | ---------: | ----------------: | -----------------------: | -------------------: |
| unchanged           |           3.080 |            3.153 |            2.892 |      -6.1% |             1.533 |                    0.064 |                0.285 |
| localized-text      |           3.621 |            4.139 |            3.542 |      -2.2% |             1.351 |                    0.071 |                0.282 |
| transparent-outside |           6.619 |            9.367 |            6.696 |      +1.2% |             4.559 |                    0.088 |                0.652 |
| layout-move         |           4.126 |            5.594 |            4.909 |     +19.0% |             1.421 |                    0.290 |                0.276 |
| all-changed         |          16.076 |           18.698 |           20.275 |     +26.1% |             1.454 |                    0.306 |                0.285 |
| generic-request     |           2.901 |            4.576 |            3.619 |     +24.8% |             1.414 |                    0.277 |                0.279 |
| raw-fallback        |           2.962 |            4.770 |            4.295 |     +45.0% |             1.712 |                    0.201 |                0.197 |
| image-fallback      |           3.051 |            4.883 |            4.365 |     +43.0% |             1.500 |                    0.202 |                0.211 |
| scrollbox           |           4.419 |            5.418 |            5.030 |     +13.8% |             1.256 |                    0.847 |                0.291 |

The JSON preserves per-phase ranges, including the full forced frame itself and localized recovery. Local artifacts also retain all 28 per-frame timings/calls/fallback/recomposition counts. The short mixed trace is not an application usage model; its remaining regressions must not be hidden by the warm aggregate.

## Larger Sensitivity

240x80, overlap depth4, five repeats x100. Warm milliseconds:

| Workload            |    Main | Prior ON | Final ON | Final/Main | Final/Prior |
| ------------------- | ------: | -------: | -------: | ---------: | ----------: |
| unchanged           | 0.20585 |  0.08989 |  0.08299 |     -59.7% |       -7.7% |
| localized-text      | 0.36382 |  0.19057 |  0.21851 |     -39.9% |      +14.7% |
| transparent-outside | 0.88509 |  0.26208 |  0.33110 |     -62.6% |      +26.3% |
| layout-move         | 0.54711 |  0.95998 |  0.62864 |     +14.9% |      -34.5% |
| all-changed         | 3.23867 |  3.69972 |  3.31562 |      +2.4% |      -10.4% |
| generic-request     | 0.21491 |  0.28726 |  0.22861 |      +6.4% |      -20.4% |
| raw-fallback        | 0.21728 |  0.27378 |  0.22948 |      +5.6% |      -16.2% |
| image-fallback      | 0.23885 |  0.27911 |  0.23868 |      -0.1% |      -14.5% |
| scrollbox           | 0.36971 |  0.58891 |  0.37766 |      +2.2% |      -35.9% |

Equal-weight large warm final/main ratio: 0.7917. Larger localized and deep-overlap updates regress versus the prior branch even while still beating main. Cold/transition/OFF ranges for this sensitivity are also in the JSON; this is not evidence of regression-free scaling.

## Memory

Separate safe-allocator ReleaseFast builds measured native live requested bytes, not RSS. The native allocation-traffic fixture remains 412 cold allocations/724568 requested bytes, versus 4331/1190432 in the initial prototype; the next 23 localized frames remain 5 allocations/6432 bytes. The first campaign's flat index/resource work is preserved. The new same-capacity linked-wide recovery fixture asserts zero additional allocations while rerecording, followed by useful skipping and release on unsupported fallback.

| Workload            | Main native live delta | Final OFF native live delta | Prior recorder | Final recorder |
| ------------------- | ---------------------: | --------------------------: | -------------: | -------------: |
| unchanged           |                 224982 |                      224982 |         450960 |         450960 |
| localized-text      |                 224960 |                      224960 |         454128 |         454128 |
| transparent-outside |                  67717 |                       67717 |         762696 |         762696 |
| layout-move         |                 517914 |                      517914 |         704400 |         450960 |
| all-changed         |                 384022 |                      384022 |         704400 |         450960 |
| generic-request     |                 224982 |                      224982 |         704400 |         450960 |
| raw-fallback        |                 224982 |                      224982 |         150352 |         150352 |
| image-fallback      |                 225703 |                      225703 |         150352 |         150352 |
| scrollbox           |                 216808 |                      216808 |         430752 |         300864 |

Final ON-minus-OFF live requested bytes equal the recorder capacities exactly in these fixtures. The delta is measured after scene setup, so it does not measure all base-object storage, JS allocations or process peak memory. Planned full paints retain the previously owned recorder capacity rather than freeing it every frame; memory is bounded by prior recorded scene sizes and released on unsupported fallback, resize, explicit abort or destruction. This can retain more memory during an isolated forced full frame than the rejected free-on-full candidate, but avoids allocation bursts on recovery. Raw/image release behavior remains unchanged. No RSS or zero-memory-cost claim.

## Focused Pass

The first campaign remains documented separately in layered-paint-grid.md. This second pass targeted the actual remaining regressions, not a repeat of the research matrix:

- R1 kept: inline the inactive native recorder check, but keep allocation/ownership recording out of line. Prior T01 only forced inlining and did not isolate that body. The standalone OFF result was inconclusive; the combination removed much of the full-fallback cell-write penalty.
- R2 kept with refinement: later forced frames, changed render-list geometry, and majority-dirty rebuilt lists take full rendering before callbacks are painted. Already reusable lists are not rescanned solely to make this choice. No new exclusion of ordinary custom/outside-layout painters; no callbacks are invoked twice.
- R3 kept: skip screen-sized dirty initialization when full fallback is already known. Small, directly avoided work; no robust standalone CPU gain is claimed.
- R4 kept: retain existing owned capacity across planned full paints; on recovery, invalidate all recordings, release old payload ownership, reuse that allocation for pending writes, and rebuild the invalid index. Existing raw/image/effect/abort cleanup remains. A focused red/green test also prevents a later full-paint decision from reclassifying already-unsupported access as retained.
- Rejected intermediate policies: unconditional render-list scans penalized deep stable scenes; free-on-full increased reconstruction; first-frame bypass improved the first latency number but shifted construction to the next frame. These exact patches and results are retained locally, not left as strategy flags.
- Native/JS causal profile: styled text mutation, text-view drawing and publication dominate; grid finish remains material. RootTS/push samples were much smaller, and there was no JS snapshot/map-construction hot path in the actual implementation. Profiling is separate from ReleaseFast timing and no perf/host permission changes were made.
- The initial mixed diagnostic captured snapshots during every repeat, creating avoidable GC pressure and a large-run process disconnect. Those early transition numbers are NOT final CPU evidence. The final harness separates capture from timing; all final controls were repeated with that corrected harness. The initial main-control timeout interrupted restoration only; it was inspected and rebuilt before further timing.

A final restoration check found a different normal-library byte hash after memory instrumentation, despite matching source hashes and disabled allocator flags. Rather than assume binary equivalence, the final 14x300 and large 5x100 timing/correctness confirmations were repeated on the restored binary named above; its byte hash is checked again at publication. Earlier binary pins/results remain diagnostic artifacts, not the final headline dataset.

## Verification

- Final root native/cross-package ReleaseFast build passed; restored source and both library hashes match the final timed pins after temporary controls and memory instrumentation.
- Native: 2124 pass, 8 skip. Focused paint-grid: 11 pass, including planned-full linked-wide ownership and allocation-free recovery; no test allocator leaks.
- Bun Core: 5497 pass, 23 skip, 239 snapshots. Focused renderer grid: 14 pass, including 34-frame output/callback/recovery proof and input preservation.
- Portable Node 26.4.0 through the repository-enforced script: 4754 pass, 6 skip. Packed Bun/Node consumers passed.
- React: 59 pass; Solid: 271 pass. Root fmt/lint, Zig fmt and git diff checks passed. No new framework invalidation contract or configuration default change.
- Internal cache timing assertions were changed only with explicit policy and exact-output/recovery coverage. Initial eager-cache expectations are preserved in final code; resize/forced-frame tests require bounded useful recovery, not immediate-next-frame recording.
- Local test results are not a claim that current GitHub CI is green. The PR remains draft; publication records one CI snapshot, not polling.

## Reproduction And Scope

From the repository root, run `bun run build`; from packages/core:

```sh
PAINT_REPEATS=7 PAINT_FRAMES=300 bun src/benchmark/layered-paint-grid.ts
bun src/benchmark/layered-paint-grid.ts --snapshots
bun src/benchmark/layered-paint-grid.ts --transition-snapshots
PAINT_REPEATS=7 bun src/benchmark/layered-paint-grid.ts --transitions
PAINT_WIDTH=240 PAINT_HEIGHT=80 PAINT_DEPTH=4 bun src/benchmark/layered-paint-grid.ts
```

For actual main/corrected controls use the identical committed harness with `--off-only` and rebuild that exact runtime. For memory use native `zig build -Doptimize=ReleaseFast -Dgpa-safe-stats=true`, copy with Core `bun scripts/build.ts --native --skip-zig`, and run `--memory-only`; restore normal root build before timing.

Committed compact data: [layered-paint-grid-main-results.json](layered-paint-grid-main-results.json). Local artifacts under artifacts/opentui-paint-grid-regressions contain PLAN.md, exact patches, raw timings, snapshots, profiler, hashes, allocation data and verification logs. The previous campaign remains distinguishable. No raw logs, binaries, lockfiles or credentials are committed; no main/other PR changes, merge, rebase, force push or ready-for-review transition.

Remaining costs are real: native OFF hooks/dispatch; full-paint selection/guards; eager scalar command capture/index construction; and rerecord/recomposition when returning from full rendering. Eliminating every cost would require more than this bounded simplification pass. This report does not promise that all regressions are eliminable.

### Implementation Size

Second-pass production diff versus 29ca3ced (tests/benchmark/docs excluded):

```text
14	0	packages/core/src/Renderable.ts
7	0	packages/core/src/buffer.ts
1	0	packages/core/src/renderer.ts
6	0	packages/core/src/zig.ts
6	2	packages/native/src/buffer.zig
9	0	packages/native/src/lib.zig
23	6	packages/native/src/paint-grid.zig
```

One small internal full-paint FFI operation and one retained-full flag were added; no strategy framework, duplicate render-command representation, hash collision tradeoff or narrowed IDs/colors. Tests and harness changes are separate from production size.

Entire branch production diff versus actual main (including issue1465 fixes, initial grid and both optimization passes):

```text
44	2	packages/core/src/Renderable.ts
40	0	packages/core/src/buffer.ts
31	1	packages/core/src/renderer.ts
1	1	packages/core/src/types.ts
54	0	packages/core/src/zig.ts
2	0	packages/native/src/buffer-methods.zig
143	35	packages/native/src/buffer.zig
53	0	packages/native/src/lib.zig
494	0	packages/native/src/paint-grid.zig
1	1	packages/native/src/renderer.zig
```
