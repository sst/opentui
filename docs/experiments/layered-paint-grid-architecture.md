# Architecture Rework Checkpoint

This is an **incomplete experimental checkpoint**, not a no-regression result.
The feature remains off by default and PR1466 remains draft. Earlier reports
describe their pinned implementations, not this replacement candidate.

## Continuing Candidate

The current source continues beyond84133b76 with owned glyph spans, bulk fill
capture/replay, fused initial capture, and wide/inherited dependency closure
instead of a per-cell reverse index. It also skips redundant geometry scans and
measured redundant full-target clears, and extends draw-boundary specialization
to ordinary drawText/fill. See [continuation](layered-paint-grid-continuation.md).
The performance goal remains INCOMPLETE. The measurements and full-suite counts
below belong to84133b76, not the newer candidate.

## Previous Candidate

- D2+C replaces eager startup capture with ordinary full painting. Cell-index
  storage and invalid payload preparation happen only at the first actual paint
  scope, not before Root might select full rendering. Native owns this policy.
- Existing text draw-boundary specialization now reaches opaque/alpha blending
  and final setters, rather than specializing only transparent glyphs. Full text
  loops no longer perform the per-cell recording checks.
- Cold and continuously full-only scenes retain a192-byte recorder header in
  the current120x40 matrix. Selective scenes still build their full contributor
  grid; construction is included in first-update and mixed-transition timings.
  This is not a claim that caching is free, or that full fallback is incremental.
- Root ReleaseFast build, native13/Core14 focused checks, original normal and
  transition four-channel parity pass. Deferred-allocation OOM/retry is tested.
  Internal initial-cache timing tests now explicitly cover full startup, capture,
  then skipping; output/input/single-callback/rejection checks are preserved.
- [Fresh matched comparisons](layered-paint-grid-architecture-results.md) cover
  actual main and prior60a, all nine workloads, ON/OFF, cold and mixed transitions,
  seven1000-frame repeats at120x40 and five600-frame repeats at240x80/depth4.
  All means, p50/p95/p99 and repeat ranges are retained in compact JSON.
  Large selective gains coexist with full-workload and short-transition losses.
  This checkpoint does not meet the no-regression target.
- Full native2126 pass/8 skip, Bun Core5497/23 skip, guarded Node26.4 Core4754/6
  skip, packed Bun/Node consumers, React59, Solid271, format/lint pass locally.
  Exactly2016 captured normal/transition frames match newly captured main bytes.
  Local checks are not a claim that GitHub CI is green.

## Alternatives

Candidate A/A2/A3, saved in checkpoint4d70942c and local patches:

- Replace per-cell paint records with ordered row spans sharing preblend colors,
  opacity, mode and actual nested owner identity. Differing scalar glyphs use an
  owned u32 payload vector. Solid spans need no glyph payload. No caller-owned
  text/view/framebuffer pointers are retained.
- Capture fill rows at the existing clipped fill boundary. Ordinary custom paint
  outside layout remains supported. Wide glyphs and inherited backgrounds retain
  singleton dependencies; scalar span changes dirty only changed cells.
- Preserve raw/image/effect fallback, callback execution and publication behavior.
  Focused native13/Core14 tests and original normal/transition four-channel
  snapshot parity pass. New tests cover mutable text payload and precise damage.
- A3 additionally replays fill spans through the original native bulk fill
  implementation and hoists opacity per run. It was not retained in84133b76:
  reduced memory alone did not establish a consistent CPU advantage. The newer
  continuation combines it with removal of the reverse index and fused capture.
- B independently fused initial scalar raster/capture and deferred indexing.
  It passed parity but did not remove cold recording cost; it is not retained.

All variants remain experimental evidence, not a proof that other architectures
cannot improve the remaining workloads. No arbitrary new purity contract,
translation assumption or ordinary custom-paint exclusion is introduced.

## Research

- https://raw.githubusercontent.com/google/skia/main/src/core/SkRecord.h
  Separate typed draw commands from arena-owned payload; share style across
  raster cells rather than retaining a complete command for each one.
- https://raw.githubusercontent.com/chromium/chromium/main/cc/paint/paint_op_buffer.h
  Contiguous owned records, reusable backing capacity and ordered playback.
- https://raw.githubusercontent.com/neovim/neovim/master/src/nvim/grid.c
  Row-local glyph storage, precise changed-cell comparison and wide-cell repair.
- https://doc.servo.org/webrender/picture/index.html
  Primitive/clip/opacity dependencies and dirty-region replay. GPU tiles and
  quadtrees are not being imported into this CPU terminal experiment.

The local campaign ledger includes exact variant patches, binary/source/harness
pins and raw measurements. No external renderer speed numbers are claimed to
apply to OpenTUI.
