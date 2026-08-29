# Bulk Text Drawing

This branch adds 32 lines to the existing `drawTextBufferInternal` function in
`packages/native/src/buffer.zig`. Printable ASCII is traversed in runs bounded by
styles, chunks, special clusters, viewport, buffer and scissor edges. Each run
reuses the existing cell writers, including alpha blending, links, wide-cell
overwrites and transparent spaces. Selection and truncation keep scalar traversal.

There are no new APIs, allocations, persistent fields, caches, revisions or FFI
calls. This is independent of the layered-paint-grid experiment and does not
include its Issue1465 fixes. It trades a small extra loop for less repeated
per-glyph metadata work, rather than introducing a rendering subsystem.

## Comparison

Baseline is actual main `202e1e6a0013252b6d0cd08c034e25f21d55f220`, built locally
with `zig build -Doptimize=ReleaseFast` through the root build. Both sides use
identical TypeScript runtime sources and the feature-free benchmark in
`packages/core/src/benchmark/bulk-text-drawing.ts`. Neither side uses allocator
instrumentation for timing. Linux x86_64, four-vCPU AMD EPYC 9554P KVM guest,
Bun 1.3.14, Zig 0.16.0.

The primary comparison uses eight paired fresh processes per workload, alternating
main/candidate order and rotating workload order, at 120x40/depth1. Each process
measures an initial mixed 28-frame sequence followed by 1,000 warm frames. No
concurrent builds/tests, forced GC, pause subtraction, filtering or outlier removal.
Durations are wall-clock time around mutation plus `renderOnce`, not module import
or scene construction. The raw/image labels are historical fixture names: without
a grid, these are ordinary rendering controls, not fallbacks.

Warm mean milliseconds, main to candidate; positive percentages mean faster:

- Unchanged: 0.1009 to 0.0864, 14.3%.
- Localized text: 0.2107 to 0.1904, 9.6%.
- Transparent custom paint: 0.2225 to 0.2308, -3.7%.
- Layout move: 0.2526 to 0.2207, 12.6%.
- All changed: 1.6932 to 1.6337, 3.5%.
- Generic request: 0.1057 to 0.0860, 18.7%.
- Raw-buffer control: 0.1050 to 0.0913, 13.0%.
- Image control: 0.1086 to 0.0880, 18.9%.
- Scrollbox: 0.1434 to 0.1347, 6.1%.

The equal-weight geometric-mean improvement is 10.6%. This weighting is explicitly
synthetic; there is no application-frequency telemetry. The sensitivity run at
240x80/depth4 uses six pairs and 600 warm frames. Improvements in the same order
are 20.5%, 15.4%, -1.4%, 6.6%, 0.7%, 14.8%, 10.8%, 3.1%, and 9.8%; its equal-weight
geometric-mean improvement is 9.2%. Full-content mutation is largely dominated by
work outside this drawing loop.

The transparent control does not call the changed TextBuffer path. Its primary
median changed from 0.1993 to 0.2011 ms (+0.9%); trial-mean ranges were
0.2167-0.2275 ms and 0.2206-0.2474 ms. The original mean regression above is retained,
not filtered away.

A separate eight-pair confirmation with 3,000 warm frames measured this untouched
control at 0.2110 to 0.2137 ms (-1.3%; p50 -0.7%). The simultaneously repeated
unchanged-text workload improved 18.0%. These longer runs support a small residual
control loss rather than a large regression; they do not replace the primary data.

## Cold And Mixed

Cold frame 0 and mixed28 total means at 120x40, in milliseconds, main to candidate:

- Unchanged: cold 3.414 to 3.557; mixed 9.499 to 9.070.
- Localized text: cold 3.768 to 4.075; mixed 11.514 to 10.871.
- Transparent custom paint: cold 4.724 to 5.354; mixed 19.346 to 21.313.
- Layout move: cold 3.214 to 3.348; mixed 10.770 to 10.501.
- All changed: cold 3.120 to 3.033; mixed 29.062 to 29.155.
- Generic request: cold 3.084 to 3.311; mixed 8.722 to 9.035.
- Raw-buffer control: cold 3.603 to 4.320; mixed 9.590 to 11.228.
- Image control: cold 3.677 to 3.610; mixed 10.208 to 8.902.
- Scrollbox: cold 4.464 to 4.105; mixed 12.758 to 12.184.

Cold samples are noisy and do not establish a consistent startup improvement.
This branch has no cache construction or first-capture work, but that is not a
claim that every first frame is faster than main.

## Memory

The production change adds no allocator calls or persistent fields. The measured
normal shared library grows from 26,324,696 to 26,328,744 bytes (+4,048 bytes on disk);
that is not an RSS measurement.

Separate `-Dgpa-safe-stats=true` builds of main and candidate produced identical
valid requested-byte and active-allocation counts at creation, after 128 frames,
and after destruction in all nine workloads. The additional native retained bytes
measured at those checkpoints were zero. Both sides returned to the same 8-byte,
one-allocation process baseline after destruction; arena bytes were zero throughout.
This checks retained allocations, not every transient peak. Single-pair JS heap
and RSS samples varied, so no RSS or JS-heap improvement is claimed.

## Correctness

- Ten high-level output-parity tests pass on actual main and candidate (58 assertions), including editor viewport prefill, styles, links, reverse, alpha, scissor, negative origin, viewport offsets, wrapping, truncation, Unicode, tabs and selection recovery.
- Every typed-buffer SHA256 matches main across 32 frames of all nine workloads at both measured dimensions. Snapshots are separate from timing.
- Focused native tests: 64 passed. Full native suite: 2,111 passed, eight skipped; native example smoke also passed.
- Core: 5,493 passed, 23 skipped. Guarded Node 26 suite: 4,750 passed, six skipped, including the new parity tests.
- Root ReleaseFast build, packed Bun/Node distribution smoke, formatting, lint and Zig formatting passed.
- Final source/native hashes match the exact measured candidate after diagnostic builds were removed from the active outputs.

## Reproduce

Build each revision with `bun run build` at the repository root, and run the same
benchmark source in both revisions. From each `packages/core` directory, launch
one workload per fresh process and alternate revisions between samples:

```sh
PAINT_REPEATS=1 PAINT_FRAMES=1000 WORKLOAD=unchanged bun src/benchmark/bulk-text-drawing.ts
PAINT_REPEATS=1 PAINT_FRAMES=600 PAINT_WIDTH=240 PAINT_HEIGHT=80 PAINT_DEPTH=4 WORKLOAD=unchanged bun src/benchmark/bulk-text-drawing.ts
```

Repeat for the nine `workloads` in the source. `times[0]` is cold; `times[0..28)`
sum to mixed28; later samples are warm. The benchmark emits every sample, mean,
p50 and range. Snapshot hashes (`SNAPSHOTS=1`) and allocator/heap/RSS diagnostics
(`DIAGNOSTICS=1`) must be run separately from CPU comparisons. Trust requested-byte
allocator statistics only when `requestedBytesValid` is true; instrumented builds
must never be substituted into timing runs.
