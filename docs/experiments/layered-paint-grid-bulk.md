# Bulk Text Inputs And Bounded Closure

Continuation from `c5493f5d`. The owner no-regression goal is still incomplete;
this is an implementation checkpoint, not an acceptance claim.

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
- Current root ReleaseFast build, native 2134 pass/8 skip and Bun Core suite pass.
  Short fresh-process trial shows materially lower ordinary text-render medians
  and first capture around 0.82-0.89 ms for small plain-text scenes. Full rotating
  main/prior controls and final verification follow; do not extrapolate acceptance.
- Native fixture allocation traffic is 16 backing allocations/106240 requested
  bytes, with 94240 retained bytes including arena slack. Small outside-layout
  retained storage is 173360 bytes. These are not RSS measurements.

Historical reports remain unchanged. Local reproducible diagnostics, rejected
trial pins and raw data are under the `lifecycle` continuation artifacts.
