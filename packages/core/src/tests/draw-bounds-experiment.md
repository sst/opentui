# Draw-Derived Bounds Experiment

This branch layers native row-extent observations onto PR1398's existing row
damage compositor. It retains no cells, glyphs, draw commands, or input payloads.

The current optimization scope is deliberately narrow: ordinary unbuffered Boxes
with `shouldFill: false`, unchanged paint methods, and stable render-list inputs.
Their observed border/title rows can be smaller than their layout rectangle.
Native collection includes scalar writes, wide-span cleanup, direct text stores,
fill/copy operations, and direct Box/Grid paths. Empty and unknown observations
are distinct. Raw aliases and nested collection reject precision; effects reject
the current observation. All application and screen clipping remains native.

The collector is not a declaration that arbitrary painters are pure. Unknown
unchanged painters retain PR1398's conservative selection. Unknown dirty painters
still force complete composition before callbacks. Layout/list/context changes
retain the existing full path. Dirty sources and ancestors lose observations
before callbacks; partial damage paints never refresh full-paint observations.
Failures discard observations and force recovery. Input hit testing is separate.

Why not all Boxes or text? `shouldFill` is publicly mutable without invalidation,
and text exposes mutable native text/view inputs. Layout-boundedness alone does
not prove those inputs unchanged. No revision/payload cache has been added to
broaden eligibility. Filling Boxes, text, images, effects, buffered painters, and
custom overrides retain the existing selection rules.

The four Box scissor guards in the preceding foundation commit are required:
without them a transparent border's footprint depends on unrelated grapheme
tracker state. The regression was reproduced against the unmodified rebased
control before that fix. Framebuffer mode changes from #1465 are not included.

Verification and three-way timing results are maintained separately in the
workspace artifact report. A reduction in drawing calls is not itself a runtime
speed claim. This is an experiment, not a merge recommendation.

## Measured Outcome

The bounds addition is not recommended as a general performance PR. It helps the
sparse-border case, but ordinary workload losses exceed the accepted one or two
small regressions. Both the scope-call prototype and the final folded-output
variant are preserved in branch history; no further tuning campaign was run.

- Measured runtime: `62b29e71f695bfe019ba8b5778b21cd06e5f3f8f`.
- Actual main: `202e1e6a0013252b6d0cd08c034e25f21d55f220`.
- Patch-equivalent rebased PR1398: `1354b9ede6d9adb235ac7870c1737eb4b5b551ce`.
- Measured corrected PR1398 control: `9900f05187e2326ea547bf16f990ada5d1723308`.
- Matrix: 360 independent, balanced Bun processes; ten fixtures including the
  targeted sparse-border case; 120x40 and 240x80/depth4; six processes per control
  and fixture, 28 mixed frames plus 300 warm frames. Tails and GC pauses retained.
- Sparse borders versus corrected PR1398: warm mean -21.2% / -36.3%, cold first
  paint +1.5% / +10.1%, mixed28 -9.3% / -1.6% (small / large).
- Ordinary nine fixtures: bounds-only warm means range -10.0% to +13.0% small and
  -1.5% to +19.2% large. No-op values are small and noisy; non-no-op regressions
  include scrollbox +13.0% / +8.2% and large all-changed +9.2%.
- Whole branch versus actual main: sparse-border warm -58.4% / -77.5%, mixed28
  -55.1% / -52.7%, cold +11.9% / +39.3%. Large retained-frame gains mostly belong
  to PR1398, not bounds. Whole-branch warm losses include small layout-move +12.0%
  and scrollbox +23.4%.
- The bounds delta is 173 production lines added, 10 removed, across seven files.
  The whole branch is 826 added, 106 removed, across 32 production source files,
  excluding tests, benchmarks, scripts, and docs. No retained-payload engine.
- Native buffer size rises from 288 to 304 bytes: +32 live native bytes for the
  two buffers in these scenes. GPA-boundary allocation/resize/free traffic during
  painting matches corrected PR1398 in all 20 fixture/size pairs.
- Sparse observations retain 80 / 160 two-number row objects; Bun JSC estimates
  those objects at 2,560 / 5,120 shallow bytes, plus a 60-byte output-view estimate
  and other command/root/set metadata. These are not deep-heap or RSS estimates.
- In separate 128-frame diagnostics, sparse Box calls drop 8,880 to 160 small and
  17,760 to 320 large. Row-clear counts stay 109 and area stays 13,080 / 26,160
  cells. Text/custom callback counts remain 487 / 647 on both sides.
- Full checks: native 2,120 pass (8 skip); Core 5,515 pass (23 skip); Node 26.4
  4,772 pass (6 skip); React 60; Solid 272; packed Bun/Node consumers; root
  ReleaseFast build; formatting/lint/Zig formatting. All four published buffer
  channels match across all controls for every fixture and size in separate runs.

Cold is first paint after scene construction, not whole-process startup. The
mixed sequence is a test weighting, not a claimed application-frequency model.
Native draw errors reject observations, but not every OOM site was fault-injected.
No speed or zero-regression claim is made for every possible custom frame.

Full per-workload means, p50s, ranges, cold/first-two/first-three/mixed totals,
allocator/metadata/callback/crossing data, exact library/harness pins, and raw
artifacts are in the shared workspace at
`artifacts/opentui-draw-derived-paint-bounds/REPORT.md` and its sibling directories.
