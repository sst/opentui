# Startup Lifecycle Checkpoint

Status: **INCOMPLETE**. This is a measured implementation checkpoint, not a
no-regression solution. Runtime source `6890fe68` follows the historical
[bulk checkpoint](layered-paint-grid-bulk.md). See the
[current measurements](layered-paint-grid-startup-results.md) and
[all results](layered-paint-grid-startup-results.json).

The owner now allows one or two 1-3% benchmark losses when the remaining gains are
substantial, and requires low complexity across the entire branch. The linked
6890fe68 measurements precede the final simplification of redundant per-op owner
metadata and identical raw/direct modes; new-source measurements are pending.

## Whole-Branch Review

The full runtime diff against main retains one target-local command list, one
payload arena, two streams for comparing old/new inputs, and bounded dirty-cell
closure. Native publication owns target validity; TypeScript only owns pending
render intent and recording obligations. Recording and ordinary raster paths share
the existing setters through compile-time specialization, not separate renderer
implementations. There is no reverse cell index, strategy framework, retained
caller pointer or abandoned trial flag.

Nested scopes always make their enclosing command volatile, and replay does not
use per-operation owners. Those duplicate owners and their scope copies were
removed. Raw/direct replay modes had identical behavior and were merged. Existing
scope cleanup, volatile rerecording, raw lifetime and exact-output tests remain.

## Retained Changes

- Ordinary initial/full-only frames no longer allocate a grid or enter native
  begin/end transactions. The existing buffer paint flag tracks an outstanding
  recording obligation, not an assumed native cache-valid bit.
- A transition from retained to ordinary rendering still visits native code.
  Native validity decides whether the preserved target needs clearing. This
  preserves externally written raw cells between ordinary frames, even if native
  state was invalidated independently of TypeScript.
- Planned full transitions retire immediately only outside painter scopes.
  Late fallback keeps the painter's scissor/opacity stack until its existing
  finally-pop. Raw/unsupported access still releases owned recordings.
- Unsupported-operation observation belongs to the target buffer, so ordinary
  image/effect frames inform the next capture decision without allocating a grid.
- Root's existing render-list revision comparison also selects already-known
  geometry-full frames before recording entry. Changes discovered by layout keep
  the existing late fallback. No second layout pass or revision cache was added.

## Rejected Trials

- Eager first-frame capture with the current bulk engine increased cold time and
  worsened raw/image mixed sequences. Moving first-use cost was not accepted.
- A single typed nullable scope input for push/pop did not consistently improve
  first-three-frame or mixed totals and worsened some selective warm means. Its
  staging array and ABI change were removed.
- Temporary native entry instrumentation was removed before final timings. In
  five fresh processes, 81 initial native pushes took 33.6-45.2 microseconds total,
  compared with 208-264 microseconds in inclusive JS wrappers. Native pops took
  2.2-2.4 microseconds. These include observer effects and do not establish that
  every difference is FFI or JIT time.

## Evidence

- Final rotating matrices cover all nine workloads, ON/OFF, 120x40 and 240x80 at
  depth4, with seven/five repeats and 1000/600 steady frames. Each process includes
  the entire 28-frame startup/full/recovery sequence. No forced GC or dropped tails.
- Strong selective warm gains remain. First capture and several cold/mixed
  sequences still lose. Large layout warm mean is +3.5% versus main in this matrix,
  with p50 -2.2%; broad p50 is +0.8% at both sizes. These are not all-warm-wins results.
- The original driver is reported separately, with its stats observer and older
  pinned control timings. All 2016 new four-channel captures match pinned main.
- A separate full-mode/callback diagnostic distinguishes ordinary full frames
  from native fallback counters. With no transaction, a zero fallback counter
  does not mean no full rendering occurred.
- Initial retained allocation is zero. Small warm plain/outside retained storage
  is 94232/173352 bytes; large is 242906/541788 bytes. These are not RSS figures.

## Verification

- Root ReleaseFast build, native2134/8skip, Bun Core5500/23skip, Node26 Core4757/6skip,
  packed Bun/Node and React59 passed. New tests cover transaction-free full bursts,
  raw writes, geometry transition/recovery and late scoped fallback parity.
- Solid's first full run crashed in Bun with a segmentation fault banner; the
  immediate full rerun passed271. Both logs are retained. No unsupported root-cause
  claim is made for the crash.
- Source/binary pins and primary-worktree preservation are checked after controls
  and final tools. The PR remains draft; test success does not satisfy the unmet
  performance goal.
