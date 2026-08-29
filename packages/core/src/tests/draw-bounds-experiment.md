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
