# Startup Lifecycle Checkpoint

The [focused first-use continuation](layered-paint-grid-first-use.md) retains this
runtime and presents an explicit opt-in startup-cost decision. No later runtime
optimization was accepted; the measurements below remain historical final simple-\*.

Status: **INCOMPLETE**. This is a measured implementation checkpoint, not a
completed lifecycle solution. Runtime source `d86dd308` follows the historical
[bulk checkpoint](layered-paint-grid-bulk.md). See the
[current measurements](layered-paint-grid-startup-results.md) and
[all results](layered-paint-grid-startup-results.json).

The owner now allows one or two 1-3% benchmark losses when the remaining gains are
substantial, and requires low complexity across the entire branch. The linked
measurements include the final simplification of redundant per-op owner metadata
and identical raw/direct modes. Mild warm losses are not treated as an automatic
failure under that criterion; larger cold/mixed costs remain an explicit limit.

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

- Final rotating matrices cover all nine workloads, ON/OFF, 120x40/depth1 and
  240x80/depth4, with seven/five repeats and 1000/600 steady frames. Each process includes
  the entire 28-frame startup/full/recovery sequence. No forced GC or dropped tails.
- Strong selective warm gains remain. Small layout/scroll warm means are +2.7/+2.4%,
  with improving p50; broad is +0.6/+2.1% at the two sizes. First capture and several
  cold/mixed sequences still lose, including small layout mixed+17.4% and large
  generic mixed+11.6%. The report does not average these costs away.
- The original driver is reported separately, with its stats observer and older
  pinned control timings. All 2016 new four-channel captures match pinned main.
- A separate full-mode/callback diagnostic distinguishes ordinary full frames
  from native fallback counters. With no transaction, a zero fallback counter
  does not mean no full rendering occurred.
- Initial retained allocation is zero. Exact final native retained capacities are
  in the result JSON; they are not RSS or cumulative allocation traffic figures.

## Verification

- Root ReleaseFast build, native2134/8skip, Bun Core5500/23skip, Node26 Core4757/6skip,
  packed Bun/Node and React59 passed. New tests cover transaction-free full bursts,
  raw writes, geometry transition/recovery and late scoped fallback parity.
- Final simplified-source Solid271 passed. Earlier6890 first full run crashed in
  Bun with a segmentation fault banner; its immediate full rerun passed271. Both
  logs are retained. No unsupported root-cause claim is made for that crash.
- Source/binary pins and primary-worktree preservation are checked after controls
  and final tools. The PR remains draft; test success does not satisfy the unmet
  performance goal.
