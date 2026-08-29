# Architecture Rework Checkpoint

This is an **incomplete experimental checkpoint**, not a no-regression result.
The feature remains off by default and PR1466 remains draft. Earlier reports
describe their pinned implementations, not this replacement candidate.

## Candidate A

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
- Initial measurements do **not** establish a regression-free CPU improvement.
  Do not infer a speed claim from memory savings. Full main/60a comparisons,
  remaining alternatives and final build/distribution validation are pending.

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

Next alternatives are fused initial paint/capture with measured deferred index
cost, and draw-boundary dispatch into genuinely recorder-free full-render loops.
No new purity contract, translation assumption or custom-paint exclusion is used.
