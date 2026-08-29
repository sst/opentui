# Span Capture Continuation

INCOMPLETE performance goal. Experimental feature remains off by default; PR1466
remains draft. This is an architectural continuation, not a no-regression claim.

## Architecture

- Ordered row spans share preblend style and own differing u32 glyph payloads.
  Wide glyphs and inherited backgrounds retain exact dependencies and pool refs.
  No text, framebuffer, or caller-owned pointers outlive their draw call.
- Fill rows capture/replay through the existing bulk fillRect implementation.
  Invalid retained frames paint while capturing, avoiding a second full replay.
  Late fallback continues the already-painted prefix without rerunning callbacks.
- A dirty-cell bitset/list replaces the full reverse cell-to-command index.
  Only commands with wide/inherited dependencies participate in closure; scalar
  spans dirty and replay exact cells. Covered/transitively overlapping wide spans
  are tested, including dependencies absent from the final visible pixels.
- Root checks geometry before scanning painter dirtiness. Planned full fallback
  does not clear a target again when publication already cleared it and no
  commands were captured. A retained target, including a changed background,
  still clears. Raw exposure and publication rejection retain full fallback.
- Existing shared comptime drawing bodies specialize both text APIs and fill
  alpha setters. Full/off rendering need not run a recorder check per cell.

No new custom-render purity rule, translation rule, transparency exclusion,
callback reexecution, or image support claim. Images/raw/effects keep full fallback.
Initial forced painting remains ordinary full rendering; first retained capture
and recovery costs stay inside complete measured sequences.

## Evidence So Far

Focused native16 tests and original four-channel normal/transition parity pass.
The ReleaseFast root build, native2129 (8 skipped), Bun Core5497 (23 skipped),
guarded Node26.4 Core4754 (6 skipped), packed Bun/Node, React59, Solid271 and lint
pass. New matched main/prior matrices are pending at this checkpoint. These are
local checks, not a claim of green GitHub CI.

Separate diagnostic counters found layout/scroll performed two target clears per
frame versus one OFF; the new path performs one. Current generic TextBuffer
frames have zero per-cell recorder checks, not the historical7840. Outside-layout
OFF still had8692 checks before the drawText/fill specialization.

The native allocation fixture retains126296 bytes with coarse spans/no reverse
index, versus scalar MB-scale payloads. This is not RSS or total allocator traffic.
Five1000-frame fresh-process trials show selective gains and lower full-path
overhead, but still expose first-cache costs and workload-specific regressions.
No averages, forced GC, or discarded tails are used as acceptance criteria.

Exact variant patches, native/source/harness pins, failures, diagnostic counters,
raw timings and the finite ledger are preserved in the local continuation
artifacts. Research sources remain in the architecture document.
