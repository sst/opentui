# Core Render Runtime Benchmark

## Scope

This benchmark covers production rendering and Yoga FFI paths only. It contains no event bridge, callback-owner Worker, native producer thread, or `MessagePort` implementation.

The suite runs all existing `render-traversal-benchmark.ts` scenarios plus three focused production Yoga layout-read scenarios:

- `yoga_layout_reads_100`
- `yoga_layout_reads_1000`
- `yoga_layout_reads_10000`

The focused scenarios use the same `YogaNode.getComputedLayout()` and `FFIRenderLib.yogaNodeGetComputedLayout()` path as normal render traversal. A checksum consumes every returned layout.

## Method

Measured 2026-07-17 on macOS arm64, Apple M5 Max, Bun 1.3.14, Node 26.4.0, and Zig `ReleaseFast`.

- The baseline was current `main` (`0c8c4f7c`) plus benchmark commit `49391e38`, before either implementation change.
- Each phase used seven fresh child processes per runtime and scenario.
- Scenario and runtime order alternated by round.
- The 100- and 1,000-node scaling scenarios used 1,000 measured iterations after 200 warmups.
- The 5,000-node scenarios used 500 measured iterations after 100 warmups.
- The 10,000-node scenarios used 300 measured iterations after 100 warmups.
- Table values are medians of each child process's average iteration time. Lower is better.
- Node coefficient of variation was at most 8.1% at baseline, 7.2% after the wrapper change, and 5.6% after both changes.

Run the suite from `packages/core`:

```sh
bun run build:native
NODE26_PATH=/absolute/path/to/node-v26.4.0/bin/node \
  bun run bench:render-runtimes --runs=7 --suite=default --json=baseline.json
```

Compare two reports:

```sh
bun run bench:render-compare baseline.json current.json
```

## Changes

### Fixed-Arity Node FFI Wrappers

One-, two-, and three-argument pointer-bearing Node symbols now retain fixed JavaScript arity and use a common-value pointer normalization path. Wrong-arity calls still delegate to the raw Node function so its validation behavior is preserved. Four-or-more-argument functions retain the generic wrapper.

This reduced Node frame time by 21-28% in the 1,000- and 10,000-node culling scenarios. Direct layout reads improved by 6-9%; their remaining cost was dominated by output allocation and pointer resolution.

### Retained Yoga Layout Output

`FFIRenderLib` now owns one six-float output array and its pointer for its complete lifetime. Computed-layout reads are synchronous and non-reentrant, and each call still returns an independent JavaScript object.

This removed one typed-array allocation and one `ptr()`/`getRawPointer()` operation per node. Beyond the wrapper improvement, direct Node layout reads improved by another 76-83% and Bun reads by 28-29%.

## Results

| Scenario                          | Bun baseline | Bun final | Bun change | Node baseline | Node wrapper | Wrapper change | Node final | Total change | Final Node/Bun |
| --------------------------------- | -----------: | --------: | ---------: | ------------: | -----------: | -------------: | ---------: | -----------: | -------------: |
| `yoga_layout_reads_100`           |     0.0049ms |  0.0036ms |     -26.5% |      0.0169ms |     0.0156ms |          -7.7% |   0.0038ms |       -77.5% |         1.029x |
| `yoga_layout_reads_1000`          |     0.0296ms |  0.0209ms |     -29.4% |      0.1563ms |     0.1469ms |          -6.0% |   0.0263ms |       -83.2% |         1.268x |
| `yoga_layout_reads_10000`         |     0.3361ms |  0.2329ms |     -30.7% |      1.6155ms |     1.4781ms |          -8.5% |   0.2534ms |       -84.3% |         1.091x |
| `layout_only_opencode_wrappers`   |     0.0233ms |  0.0225ms |      -3.4% |      0.0242ms |     0.0241ms |          -0.4% |   0.0224ms |        -7.4% |         1.008x |
| `mixed_opencode_wrappers`         |     0.0383ms |  0.0367ms |      -4.2% |      0.0575ms |     0.0579ms |          +0.7% |   0.0555ms |        -3.5% |         1.512x |
| `scrollbox_viewport_culling`      |     0.0538ms |  0.0471ms |     -12.5% |      0.1525ms |     0.1206ms |         -20.9% |   0.0780ms |       -48.9% |         1.636x |
| `scrollbox_culling_scaling_100`   |     0.0980ms |  0.0943ms |      -3.8% |      0.1470ms |     0.1340ms |          -8.8% |   0.1201ms |       -18.3% |         1.275x |
| `scrollbox_culling_scaling_1000`  |     0.1610ms |  0.1506ms |      -6.5% |      0.4092ms |     0.3217ms |         -21.4% |   0.2012ms |       -50.8% |         1.337x |
| `scrollbox_culling_scaling_5000`  |     0.4720ms |  0.4144ms |     -12.2% |      1.4481ms |     1.2109ms |         -16.4% |   0.4525ms |       -68.8% |         1.110x |
| `scrollbox_culling_scaling_10000` |     0.9842ms |  0.8013ms |     -18.6% |      2.9121ms |     2.0926ms |         -28.1% |   1.5285ms |       -47.5% |         1.869x |
| `scrollbar_stack`                 |     0.2060ms |  0.1996ms |      -3.1% |      0.2294ms |     0.2352ms |          +2.5% |   0.2293ms |        -0.0% |         1.146x |

## Interpretation

- Direct layout reads are the clearest isolated result: Node improved by 78-84% and Bun by 27-31% across three scales.
- Existing culling scenarios improved substantially when they refreshed many child layouts: Node improved by 49-69% from 1,000 through 5,000 children and 48% at 10,000.
- Static wrapper trees changed by 3-7%, and `scrollbar_stack` was unchanged on Node. The optimization does not claim a universal frame-time improvement.
- `mixed_opencode_wrappers` remained 1.51x slower on Node. Its remaining work is not dominated by repeated computed-layout output allocation.
- The 10,000-child culling case remains 1.87x slower on Node despite direct layout reads reaching near parity. JavaScript traversal and other per-node work are now the next bottlenecks in that scenario.
