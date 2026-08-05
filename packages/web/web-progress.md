The staged changes are now split into independent, usable work instead of
replacing the homepage with the recording.

**Implemented**

- Replaced its placeholder square icon with the exact six-pixel OpenTUI wordmark.
- Added reusable `currentColor` and spectrum logo rendering through `OpenTUILogo.astro`.
- Added standalone black, white, and spectrum SVG assets.
- Moved the recording experiment to `/lab/terminal-story`.
- Added recorded-color, transparent host-surface, explicit light, and explicit dark demonstrations.
- Transparent mode omits recorded cell backgrounds; inherited-tone mode also lets the host control foreground color.
- Preserved looping, responsive fitting, reduced motion, visibility pausing, and accessible playback controls.
- Off-screen players now pause instead of continuing to repaint indefinitely.

The recording is `8.6MB` raw JSON but approximately `304KB` over gzip.

## Landing Story Iteration

### Goal

Make OpenTUI stand on its own as a terminal rendering and UI library. OpenCode
and other downstream applications may provide incidental context, but they do
not establish the page's premise or drive its sequence.

### Gauntlet Round 1: Diagnosis

- Rejected the existing order because placing OpenCode immediately after the
  definition made OpenTUI subordinate to another product.
- Reframed "The terminal is a real interface" as a conclusion that the page must
  earn through interaction, not an unsupported opening assertion.
- Identified stronger terminal-specific evidence already present in the
  repository: grapheme-aware cells, responsive layout, structured input,
  framebuffer composition, real scrollback with a live split footer, custom
  streams and SSH, native frame diffing, and deterministic renderer tests.
- Chose a causal proof chain as the judging rubric: every beat needs a claim,
  observable terminal evidence, the OpenTUI mechanism responsible, and a reason
  the next beat follows.

### Gauntlet Round 2: Competing Directions

- Explored an `80 x 24` constraint story, a command-output-to-application story,
  an autopsy of one frame, a follow-the-keystroke story, and a Unicode-star to
  WebGPU-star story.
- Rejected `80 x 24` as the main spine because it risks reducing OpenTUI to a
  responsive-layout exercise and leans on terminal nostalgia.
- Rejected command output as the whole spine because split-footer and full-screen
  modes solve different jobs; one is not an evolutionary upgrade from the other.
- Rejected the star transformation because a Unicode star and Three.js star do
  not share a causal path. Their only commonality is that both eventually write
  cells, so presenting one as becoming the other would be a visual pun rather
  than proof.

### Current Decision

- Use one checked-in OpenTUI specimen as the recurring evidence surface.
- Progress from finished result to cells, resize, input, terminal scrollback,
  transport, native diffing, and testing.
- Make split-footer scrollback the main terminal-specific reveal.
- Keep serious text and one custom-rendered region on the same surface so breadth
  is demonstrated without a gallery.
- Omit a dedicated OpenCode section. Any production note appears late and remains
  removable without weakening the story.
- Keep the existing recording as an atmospheric coda, accurately labeled as a
  browser replay rather than the renderer itself.

### Quality References

- Observable Plot's progressive code-to-result proof.
- Three.js's minimal explanation of the rendering ontology.
- D3's clear boundary between library abstractions and the underlying medium.

### Gauntlet Round 3: Specimen Critique

A fresh critic found that the story reused one visual surface but had not defined
one coherent application. That made the outline a feature itinerary rather than
progressive causal proof. It also blurred three ownership boundaries: application
state, OpenTUI rendering, and the terminal emulator's final display and history.

The story now commits to a streaming log-query console:

- A pinned editor filters structured Unicode log records.
- One custom cell-drawn histogram summarizes the same records.
- The fixed action types and submits `level:error`.
- The same action drives the filtered frame, committed host scrollback, remote
  SSH output, emitted ANSI inspection, and native-frame test.
- The same `mount(renderer, source)` function is used locally, remotely, and in
  `createTestRenderer`.
- Wide and narrow proof dimensions are fixed at `96 x 28` and `52 x 28`.

The narrative handoffs are now causal questions about that action: where the
completed result goes, whether rendering depends on process streams, which bytes
crossed the remote channel, and whether the exact interaction can be asserted
without a terminal window.

### Gauntlet Round 4: Story Pass

A second fresh critic found no remaining high-severity narrative gap. The story
passes the current bar for moving into evidence production:

- One semantic application and one exact action carry every beat.
- The minimum model stays `application state -> renderables -> cell frame ->
terminal updates`.
- Application, OpenTUI, and terminal-emulator ownership are explicit.
- Every major beat has a claim, observable proof, OpenTUI cause, and causal
  handoff.
- OpenCode is not required to make the argument persuasive.

Residual risks are now implementation evidence rather than story structure:

- Prove the filter submission and scrollback commit as one deterministic flow.
- Capture the exact ANSI emitted for a known cell-frame change.
- Verify continuous host-terminal selection across earlier output and the
  committed report.
- Verify remote input and PTY resize through the real SSH path.

### Next Work

Build the smallest `packages/examples/src/landing-story-demo.ts` that satisfies
the specimen contract. Generate one wide frame, one narrow frame, and one focused
test from that source before changing the homepage.
