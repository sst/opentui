# First-Use Tradeoff Decision

**Decision required, not universal performance acceptance.** Retain runtime
`d86dd308` as the best verified low-complexity opt-in candidate. Do not enable it
by default or mark the draft PR ready on the strength of warm gains alone.
The focused continuation from `a8801276` retains no new runtime code.

The owner permits one or two small 1-3% benchmark losses when other gains are
substantial. That resolves the minor warm losses, not the larger first-use cost.
The recommendation is to stop adding architecture for this checkpoint and ask
whether the measured startup cost is acceptable for an explicitly opt-in cache.
If not, this branch has not met the goal and should remain unaccepted, rather
than treating another recording strategy as a small finishing change.

## Evidence

- [Fresh focused results](layered-paint-grid-first-use-results.md) and
  [all distributions, OFF, mixed sequences, sampled stacks and rejected patch](layered-paint-grid-first-use-results.json)
  compare actual main `202e1e6a` with unchanged `a8801276` runtime. Two separate
  five-repeat batches cover local/layout/generic at 120x40 and 240x80, both depth4.
  Each fresh process includes 28 mixed frames then 1000/600 steady frames.
- First eligible capture, zero-based frame1 for these scenes, is 0.94-1.20 ms small
  versus main's ordinary frame 0.38-0.43 ms; large is 1.28-1.67 versus 0.63-0.75 ms.
  These are ranges of workload/batch medians, not per-run ranges or an aggregate
  acceptance score. Complete first2/3 totals and per-run ranges remain linked.
- Small generic mixed totals regress in both batches: 11.413 versus 8.628 ms
  (+32.3%), then 10.111 versus 8.335 ms (+21.3%). Small local mixed changes are
  +0.2/+4.4%; layout +1.8/+7.9%. Those are not silently rounded into tolerance.
- Large mixed signs differ from the earlier matrix: local +3.3/-27.7%, layout
  -4.9/-6.7%, generic -8.5/-11.9%. Cold main/current distributions are variable;
  all pauses remain included. This does not erase earlier large mixed losses or
  establish that they were GC. First capture loses in every focused workload.
- The [complete nine-workload warm matrix and separate original driver](layered-paint-grid-startup-results.md)
  remain the final `simple-*` measurements on identical source/binaries, not new
  results from this continuation. Selective warm mean gains are 49.5/22.3/67.9%
  small and 55.9/32.6/75.9% large. Small layout/scroll means lose 2.7/2.4%, broad
  0.6%; large broad loses 2.1%. The original driver's stats observers are not mixed
  into observer-free timings.

## Attribution And Trial

- Bun 1.3.14 exposes `bun:jsc.profile`, phase stack samples and `totalCompileTime`.
  Twenty fresh generic ON/OFF diagnostic processes sample each of the first four
  frames at a requested 50 us interval, without per-painter timing wrappers.
  Sampler/promise overhead is substantial; these times are not acceptance CPU.
- Small first-capture Root stack samples are LLInt; large first-capture Root
  samples are already Baseline. Samples occur in Root traversal, push/pop and
  native text draw. There is no basis to call the entire wrapper/native gap FFI,
  JIT, or allocation. Inclusive stack counts overlap and cannot be added as
  exclusive costs. The compile counter returned zero and is not useful here.
- A direct-binding trial removed the `FFIRenderLib` push/pop forwarding methods,
  using the existing portable numeric symbols. Dirty conversion and status2
  throwing moved to the sole Root caller, still before painter try/finally.
  There was no native ABI change, borrowed pointer, callback duplication or
  prewarming. Two constructor assignments were included in separate setup timing.
- Seventeen focused Core tests passed. Seven alternating baseline/trial repeats
  then showed capture improvements of about 1-11%, but small first3 worsened 3-6%
  and small/large layout mixed worsened 6.2/5.9%. Small generic mixed worsened 2.2%.
  Small setup plus first3 ON was 19.685 versus 20.300 ms in the separate five-repeat
  diagnostic. The trial was rejected and its exact patch/pins retained.
- Earlier eager-first-capture and typed-nullable-entry trials, plus Root OFF
  ablation/helper extraction, are already documented as rejected. This pass did
  not repeat them or add a strategy to compensate for their failures.

## Architecture Cost

The entire runtime diff against actual main is still **10 files, +1135/-72**:
623 lines of paint-grid engine, +260/-67 native buffer integration, and the
remaining lifecycle, scope ABI and option wiring. Tests, benchmarks and reports
are excluded from these runtime counts, not removed to make the design look small.

- [PaintGrid](../../packages/native/src/paint-grid.zig) owns one target-local
  ordered command list and arena payload, with old/new streams for exact changes.
  Dependency closure is bounded; shared raster setters handle rendering.
- [Native buffer integration](../../packages/native/src/buffer.zig) owns validity,
  invalidation and recovery. Owned glyph spans and bulk fills avoid per-glyph
  recording allocation. No borrowed caller storage or second renderer is kept.
- [Root](../../packages/core/src/Renderable.ts) brackets eligible painters, skips
  retained callbacks while preserving hit targets, and checks native push errors
  before try/finally. Its geometry arguments are existing cached JS fields/getters,
  not extra Yoga FFI. Geometry remains invalidation input, not a damage bound.
- [Buffer lifecycle](../../packages/core/src/buffer.ts) tracks the outstanding
  recording obligation, not duplicate cache validity. Initial/consecutive known
  full frames already avoid transactions. Late fallback preserves the active scope.
- No reverse index, extra strategy flag, opaque packet VM or redundant owner
  survived. Removing more scope calls would require reorganizing cleanup across
  callbacks/clips; moving capture would shift startup work or add scheduling state.
  Those are materially different designs, not justified by the binding trial.
- Initial grid allocation is zero. The final historical original-driver retained
  medians are about 94/173 KB small plain/outside and 243/542 KB large, including
  arena capacity. These are native retained capacity, not RSS or allocation traffic.
  This pass adds no runtime memory or persistent state.

This is an engineering stopping decision under the low-complexity requirement,
not a proof that no other renderer could improve startup. The explicit choice is
to accept the disclosed first-use cost for opt-in long-lived selective scenes, or
decline this candidate. Minor warm tolerance does not imply startup acceptance.

## Verification

- Restored source is byte-identical to all 705 final baseline pins, with both
  native libraries SHA256 `03acd5fa04a7c1040fb19e159e337d1231b2089c8a8c6532b9f65a37d02bcd48`.
  The restored focused Core suite passes 17 tests, 260 assertions.
- No native or runtime changes are retained. The prior full root/native/Core/
  Node26/packed/React/Solid gates therefore remain exact-source evidence, not
  newly rerun counts. Static checks and preservation are checked after reporting.
- No new worktree, cache, toolchain, host setting or cleanup was needed. Primary
  repository changes and unrelated refs remain untouched. PR1466 stays draft.
