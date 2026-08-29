# Paint Grid: Residual Overhead

Follow-up to the [previous actual-main comparison](layered-paint-grid-main-comparison.md).
Runtime `091fe171`, draft PR1466. **There was more removable cost. The branch is
still not regression-free.** No correctness fixes, custom painters, input
publication or eager first-frame recording were dropped.

## Kept Changes

- Specialize the existing shared text-view/editor draw implementation once per
  draw. Ordinary nonrecording transparent glyph writes no longer check the
  recorder per cell. Slow alpha/wide/link/image paths remain shared and guarded;
  recording can still stop safely midway through a draw on allocation failure.
- Reserve exactly 128 scalar Ops on the first actual append to a recording stream,
  then retain existing geometric growth. This avoids repeated cold reallocations
  without changing representation or delaying cache construction. The native
  fixture falls from 412 to 92 cold allocations, 724568 to 701528 requested bytes;
  subsequent localized frames fall from 5 to 1 allocations.

## Causal Evidence

Same-source diagnostics were removed, not exposed as supported feature modes:

- Compiling out recording branches with the same TS, native struct and issue1465
  fixes improved OFF unchanged 98.1 to 91.1us, generic 94.4 to 86.2us and outside 238.9
  to 216.3us against the adjacent control. Native hooks/code generation have
  removable cost; these are not an additive decomposition of every regression.
- Reverting TS request attribution/root traversal with the same current native
  binary did not reproduce that improvement. OFF does not call grid FFI or
  allocate recording payloads; it still executes feature/request checks.
- Eager capture followed by materialization, bypassing diff/index construction,
  did not materially fix cold startup. Retaining versus freeing those arrays
  changed repeated unchanged capture from 2.16 to 0.191ms. This motivated the small
  reservation change rather than another index redesign or hidden warmup.
- Nulling the grid pointer only during known full paints, while keeping TS and
  begin/end bookkeeping, did not give a convincing additional gain after the
  text specialization. That extra lifecycle state was rejected. Generic finish
  itself measures roughly 0.15-0.2us, not the entire observed generic slowdown.

Planned full frames already skip per-command push/pop. They still perform
begin/end scalar bookkeeping, full-selection scans on rebuilt lists, and shared
native drawing checks. Recovery invalidates and rerecords every stream before
skipping again. Raw/image discovery can materialize an already-recorded prefix.
The issue1465 framebuffer/border fixes remain; main/corrected-control differences
do not establish a fixed correctness-fix tax. Compiler/JIT/layout and timing
variation cannot be assigned to individual checks from sample names alone.

## Matched Results

Milliseconds per whole frame. Main `202e1e6a`, prior `fd92d9d9`, final `091fe171`.
Prior/final each 14 repeat means of 300 frames; main/corrected-full `e14c2d6a`
each 7x300 plus earlier 5x200 noise checks. OFF/ON order alternates. Same Linux x64,
Bun 1.3.14, Zig 0.16.0 ReleaseFast, harness and fixtures. No concurrent builds/tests.

| Workload            |    Main | Prior ON | Final ON | ON/Main | OFF/Main |
| ------------------- | ------: | -------: | -------: | ------: | -------: |
| unchanged           | 0.08533 |  0.04112 |  0.04074 |  -52.3% |    +6.6% |
| localized-text      | 0.16651 |  0.13236 |  0.12383 |  -25.6% |    +5.9% |
| transparent-outside | 0.21337 |  0.06897 |  0.06682 |  -68.7% |    +6.3% |
| layout-move         | 0.22564 |  0.25880 |  0.25311 |  +12.2% |    +6.1% |
| all-changed         | 1.53129 |  1.63186 |  1.56020 |   +1.9% |    +1.0% |
| generic-request     | 0.08483 |  0.11209 |  0.10611 |  +25.1% |    +7.3% |
| raw-fallback        | 0.08896 |  0.10026 |  0.09518 |   +7.0% |    +2.7% |
| image-fallback      | 0.09032 |  0.10116 |  0.09752 |   +8.0% |    +4.5% |
| scrollbox           | 0.12430 |  0.13805 |  0.14147 |  +13.8% |    -1.9% |

All six fallback workloads still use full rendering 300/300 frames. No claim of
incremental wins there. Equal-weight warm ratio is 0.8403 versus main and 0.9679
versus prior, not an application-frequency model or excuse for regressions.
Warm scroll is slightly worse than prior in these runs. Small changes and
overlapping ranges are not zero-overhead evidence. For example generic main
spans 0.08286-0.10644ms, final 0.09272-0.12244ms; scroll main 0.11634-0.15205ms,
final 0.13069-0.16543ms. Full per-workload ranges are in the linked data.

Cold equal-weight ratio is **1.63x main**, versus 2.52x for prior in this matched
rerun (the previous campaign measured 2.61x). Cold unchanged improves 1.300 to
0.804ms (final range 0.734-0.964); outside 3.705 to 1.575ms (1.438-2.425).
This is real eager startup work, not moved to the next frame.

The same 28-frame cold/burst/rest/forced/localized trace totals, final versus
main, are -28.8/-14.5/-42.2/-1.4/-4.8/-1.5/+17.9/+24.9/+10.8% in table order.
Raw/image/scroll remain regressions. Near-flat layout/broad/generic medians do
not imply guaranteed wins; raw totals are 3.592ms (3.383-7.104), image 3.937ms
(3.471-5.035), scroll 4.870ms (3.766-13.260). Snapshot capture is separate from
CPU timing, with no omitted construction frame.

At 240x80/depth4, matched 5x100 warm final/main changes are
-63.6/-43.6/-69.8/+6.9/-0.6/+8.1/+6.7/-0.4/+2.2%. Outside cold improves 18.659
to 6.555ms versus prior. The larger fixture does not establish regression-free
scaling; detailed cold/mixed/OFF ranges are retained in the data.

## Memory And Checks

Separate safe-allocator measurements show unchanged OFF native live deltas.
Recorder capacity increases: text 450960 to 689040 bytes; outside 762696 to 1255464;
scroll 300864 to 422880. Raw/image stay 150352. This is requested native storage,
not RSS. Small nonempty streams may reserve more than they use; empty ones do
not allocate. That memory tradeoff buys the measured reduction in allocation
traffic and startup time.

Root ReleaseFast build; native 2125 pass/8 skip; Bun Core 5497 pass/23 skip/239 snapshots;
Node 26.4 via the repository guard 4754 pass/6 skip; packed Bun/Node; root fmt/lint and
Zig format pass. New native proof covers one initial allocation, failed growth
mid-text, exact pixels, recovery and subsequent skipping. Existing custom,
out-of-layout, opacity/clip/wide/link, callback and input tests pass. No TS or
framework invalidation change was retained, so framework suites were not rerun.
Both sizes match actual-main four-channel bytes for 252 normal and 252 mixed
frames per mode, plus 108 paired frames before each ON/OFF timing run.

Final restored library SHA256:
`508db71b01b607d6cd1f2cb78eadce4daf49b1adbaf9f531ac36a7d9d60a143a`.
Harness SHA256:
`ebb5843072c3fef6ac12bd0d81be6bb7aa33fe29fd60a823dc19f65bba4d43fa`.
All temporary controls were restored and source/library pins checked again.
[Compact results, ranges, controls and pins](layered-paint-grid-residual-results.json).

## Next Options

The next small untested option is the same draw-level specialization for plain
drawText's inherited-background loop, which still performs per-cluster recorder
checks. Further cold reduction could use shared initial Op storage instead of
one allocation per stream, but that changes ownership/growth and warrants a
separate design decision. No command VM, new caller restriction or larger layer
framework was implemented. These trials do not prove the remaining costs
unavoidable, and this PR remains draft.
