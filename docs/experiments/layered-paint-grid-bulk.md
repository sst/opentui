# Bulk Text Inputs And Bounded Closure

Continuation from `c5493f5d`. The owner no-regression goal is still incomplete;
this is a verified implementation checkpoint, not an acceptance claim. Full
[measurements](layered-paint-grid-bulk-results.md) include all workloads, OFF,
cold, first capture, mixed totals, tails, counters and memory.

## Changes

- TextBuffer printable ASCII runs are bounded by chunk, style, viewport, scissor,
  and screen edges. Each eligible run copies its immutable glyph inputs into the
  target-owned arena once, with one style/owner/link reference per operation.
- Initial capture uses the ordinary nonrecording raster loop, rather than calling
  the recorder's scalar apply path for each glyph. It still paints once.
- Printable `drawText` uses the same owned-run seam. Omitted-background inputs
  sample each destination cell independently at replay time; tab clusters retain
  their original shared-background dependency semantics.
- Ordinary rendering also shares this run traversal, avoiding repeated per-glyph
  style/selection/cluster work. This is a common renderer optimization, not a
  selective-grid gain. Selection, truncation and complex clusters keep the
  existing scalar path; no public drawing contract changes.
- Dependency closure always permits its initial scan. Further scans are limited
  to one screen's worth of span-cell work before ordered full replay. No reverse
  cell index or new persistent metadata is introduced.

## Evidence

- OFF-only main-Root traversal ablation with the current native library showed
  modest, inconsistent gains. It was removed, not shipped as a copied renderer.
- A caller-owned overlapping wide-glyph chain exposed quadratic rescanning:
  selective finish was approximately 52/193/3143 microseconds at widths
  120/240/960 before the bound, versus full drawing at 3/6/27 microseconds.
  The bounded implementation sharply reduces this cost but still costs more than
  full drawing on this deliberately unfavorable fixture. This remains a limitation.
- An initial overly strict scan bound made independent inherited layers replay
  all cells. That trial was rejected. The corrected bound allows the first scan,
  with a regression test preserving precise damage for independent layers.
- Focused tests cover source destruction after capture, linked input ownership,
  alpha/opacity, clipping, exact one-cell damage and scalar-control equivalence.
  Existing allocation-failure tests cover materialization and retry.
- Root ReleaseFast build, native2134/8skip, Bun Core5497/23skip, guarded
  Node26.4 Core4754/6skip, packed Bun/Node, React59, Solid271 and static checks pass.
- Final rotating controls cover7x1000 small and5x600 large runs,540 fresh processes.
  All nine warm mean/p50 medians improve against actual main at both sizes; some
  paired repeats still lose. Cold and mixed losses remain, especially first capture.
  The separate original driver verifies2016 four-channel frames against pinned main.
- Native fixture allocation traffic is 16 backing allocations/106240 requested
  bytes, with 94240 retained bytes including arena slack. Small outside-layout
  retained storage is 173360 bytes. These are not RSS measurements.

Historical reports remain unchanged. Local reproducible diagnostics, rejected
trial pins and raw data are under the `lifecycle` continuation artifacts.

## Remaining Work

- Attribute cold full-frame overhead on this source using actual renderer method
  boundaries. Earlier generic per-cell-check and redundant-clear diagnoses are
  obsolete. No evidence justifies dropping issue1465 correctness or hiding tails.
- Native TextBuffer capture drawing dropped from274 to64 microseconds in the
  small boundary diagnostic; scope/FFI/first-use costs remain. That diagnostic is
  not headline CPU and did not move work into unmeasured setup.
- Main-Root OFF ablation and a retained-painter helper extraction were measured
  and removed. The latter did not consistently improve cold/full/selective work.
- Explore lifecycle simplification only with measured evidence and exact proofs
  for raw between-frame writes, planned-full ownership, one callback execution,
  rejection retry and input publication. No redundant JS/native state machine.
