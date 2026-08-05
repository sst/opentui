# Landing Story

## Current Direction

> **The terminal is a programmable surface.**

OpenTUI is a rendering and UI library for terminal applications. It composes
serious text, custom graphics, layout, and input into terminal-cell frames, then
writes only the changes to an output stream.

The page should prove that definition by following one checked-in OpenTUI
specimen through the entire story. It should not move between unrelated product
screens or ask another product to establish OpenTUI's value.

The specimen is the equivalent of Observable Plot's recurring penguin example:
one understandable artifact that becomes more capable and more deeply explained
as the page progresses. Every recording, frame inspection, code excerpt, and test
must be generated from its real source.

### Specimen Contract

The recurring specimen is a **streaming log-query console**, checked in as
`packages/examples/src/landing-story-demo.ts`.

- A pinned query editor filters a stream of structured log records.
- The records contain syntax-highlighted fields, wrapped messages, and the fixed
  wide-grapheme text `東京 🌟 latency`.
- A cell-drawn rate histogram summarizes the currently visible records. It is a
  small custom renderable, not a GPU dependency or decorative animation.
- The recorded interaction focuses the editor, types `level:error`, and submits
  it. The result list, count, selection, and histogram all update from that one
  state transition.
- Submitting can commit the completed report into host-terminal scrollback while
  leaving the query editor and live stream status in a split footer.
- The same `mount(renderer, source)` application function runs against a local
  renderer, an SSH session renderer, and `createTestRenderer`.
- Native proof captures use `96 x 28` and `52 x 28` terminals. The narrow result
  is rendered at the narrow size rather than scaled in the browser.

The exact data set, dimensions, input sequence, and final state remain fixed so
the landing artifacts can be regenerated and compared in CI. If a capability
cannot arise naturally from this task, it does not belong in the specimen.

The ownership boundary stays explicit throughout:

> The application owns records, queries, and state transitions. OpenTUI owns
> renderables, layout, terminal-input routing, cell composition, and frame
> diffing. The terminal emulator owns glyph rasterization, cursor display,
> scrollback storage, selection, and the final screen.

The minimum rendering model is introduced once, after the visitor understands
the specimen's job:

`application state -> renderables -> cell frame -> terminal updates`

## Story

### 1. Show The Finished Surface

Open with the exact OpenTUI mark, one direct definition, and the running log-query
console. Show streaming records, the pinned `level:*` query, and the rate
histogram before code or architecture.

- **Claim:** A terminal can hold a deliberate, responsive interface rather than
  a stream of decorated strings.
- **Evidence:** One provenance-labelled PTY capture at `96 x 28`, accepting the
  exact interaction defined above. No browser window, fake editor, or decorative
  terminal chrome.
- **OpenTUI cause:** A renderable tree is laid out and composed into a terminal
  cell frame by `CliRenderer`.
- **Handoff:** What is the surface actually made of?

### 2. Inspect The Cells

Freeze the filtered result and magnify two regions instead of introducing another
demo. First inspect `東京 🌟 latency`. Then inspect a bar from the rate histogram.

- **Claim:** A terminal frame is structured cell data, not a screenshot and not
  an unstructured string.
- **Evidence:** The text inspector distinguishes source UTF-8, one grapheme, its
  start cell, continuation cell, and display width. The histogram inspector shows
  the glyph, foreground, background, and attributes in the same cell buffer.
- **OpenTUI cause:** Source UTF-8 is segmented into grapheme clusters and display
  widths. The buffer stores grapheme-start and continuation markers plus color
  and attributes. Resolved UTF-8 is produced when the frame is captured or
  serialized. The histogram writes cells through a custom renderable.
- **Handoff:** Once content has geometry, it must survive a changing terminal.

### 3. Change The Constraints

Resize the actual specimen from wide to narrow. Do not scale or crop a desktop
capture for mobile.

- **Claim:** Columns and rows are layout constraints, not a fixed canvas size.
- **Evidence:** The `96 x 28` two-column result becomes a `52 x 28` stacked
  result; records wrap on display-column boundaries and the histogram reduces
  from twelve buckets to six without clipping.
- **OpenTUI cause:** Yoga resolves renderable bounds, the text view wraps content
  by display-column width, and the histogram redraws against its computed content
  bounds.
- **Handoff:** Correct geometry is only useful if interaction follows it.

### 4. Follow One Input

Drive the fixed interaction through the resized specimen: focus the query editor,
type `level:error`, and submit it.

- **Claim:** The surface is an interface, not an animation.
- **Evidence:** Show the raw key input, focused editor, query state before and
  after, then the filtered records, count, selection, and histogram produced by
  submission.
- **OpenTUI cause:** OpenTUI parses terminal input and routes it to the focused
  editor. The application handler updates the query and result state; OpenTUI
  lays out and composes the resulting renderables.
- **Handoff:** Where should a completed result go?

This is where the original line becomes earned rather than asserted:

> **The terminal is a real interface.**

### 5. Keep The Terminal's Memory

Commit that filtered report into host-terminal scrollback while the query editor
and live stream status remain pinned in a split footer.

- **Claim:** A live interface can preserve normal terminal history and append
  rich output to host-terminal scrollback.
- **Evidence:** Select text continuously across earlier process output and the
  newly committed report, while the live query footer continues to respond
  below. The foreground shell is not presented as concurrently active.
- **OpenTUI cause:** Split-footer mode coordinates captured output, rendered
  scrollback, and a reserved live region.
- **Handoff:** Does rendering this result depend on process `stdin` and `stdout`?

This is the key medium-specific reveal. It should receive more narrative weight
than a gallery of downstream applications.

### 6. Change The Transport

Invoke the same `mount(renderer, source)` function in a new SSH session. Do not
imply that a running local process migrates.

- **Claim:** OpenTUI targets a terminal protocol boundary, not one terminal
  window.
- **Evidence:** Show the actual `ssh` command, remote PTY dimensions, the same
  query submission, one resize event, and a short excerpt of the ANSI output
  written to the channel.
- **OpenTUI cause:** `CliRenderer` accepts custom input, output, width, and height;
  `@opentui/ssh` binds those seams to a session.
- **Handoff:** What bytes crossed the remote channel for that state change?

### 7. Show The Engineering Receipt

Only now reveal the Zig core, differential rendering, and deterministic tests.
Each implementation fact must be paired with an observable consequence.

- **Claim:** The cell frame and the terminal updates produced from it are both
  inspectable.
- **Evidence:** Compare the frames before and after `level:error`, map changed
  cells to the emitted cursor-positioning, SGR, and glyph bytes, and show an
  unchanged render producing zero bytes. Then reproduce the same input with
  `createTestRenderer` and assert its captured frame.
- **OpenTUI cause:** The Zig renderer diffs the current and next cell buffers;
  `@opentui/core/testing` drives a real in-memory native renderer.
- **Handoff:** The visitor has seen enough to build one.

Avoid unmeasured performance numbers. The evidence is the actual cell diff,
output bytes, and passing frame assertion.

### 8. End With One Invitation

End with one command and one path into the rendering model:

```sh
bun create tui
```

React, Solid, the C ABI, and broader package links can remain discoverable here
without becoming new narrative chapters.

The existing terminal recording may remain as a quiet footer background after
the invitation. Label it accurately as a browser replay of captured terminal-cell
frames. It is not a story beat, the renderer itself, or technical proof. If it
competes with the specimen or blurs that distinction, link it as a separate lab
artifact instead.

## Downstream Work

OpenTUI does not need an OpenCode section. If production context is useful, keep
it to one late annotation after OpenTUI's own proof, such as: "The same renderer
also powers OpenCode." The page must remain equally persuasive when that sentence
is removed.

Authored work such as Tierra or Dispersive Prism can punctuate the story when a
specific mechanism is being explained. They should be linked to source and
capture provenance, not presented as a showcase gallery or as the page's main
argument.

## Quality Bar

Use these references for their storytelling mechanics, not their visual style:

- [Observable Plot: Why Plot](https://observablehq.com/plot/why-plot) for one
  artifact that progressively proves each claim through visible changes.
- [Three.js: Creating a scene](https://threejs.org/manual/en/creating-a-scene.html)
  for naming the minimum ontology only when the result makes it necessary.
- [D3: What is D3?](https://d3js.org/what-is-d3) for clearly defining what the
  library owns and what the underlying medium owns.

Judge every substantive beat with this chain:

`claim -> observable terminal evidence -> OpenTUI cause -> necessary next question`

The story is not ready if a beat cannot fill all four positions.

## Non-Negotiables

- OpenTUI remains the protagonist even when every downstream product name is
  removed.
- At least three important claims must stop making sense if "terminal" is
  replaced with "browser canvas."
- One source-owned specimen carries the story; there is no screenshot gallery.
- Every major visual advances a claim and identifies its OpenTUI mechanism.
- The central text example demonstrates real editing, selection, wrapping,
  Unicode, code, diff, markdown, or streaming output rather than decorative text.
- Recordings identify source revision, command, terminal dimensions, capability
  mode, and whether they use core or an optional package.
- Narrow output is rendered at a narrow terminal size, not browser-scaled.
- Zig, React, Solid, the C ABI, and testing appear only with user-visible
  consequences.
- Each section presents the observable result first, its one-line cause second,
  and code or architecture last.
- The story remains understandable without autoplay or motion.
- Avoid feature cards, testimonial strips, logo walls, repeated CTAs, fake editor
  chrome, and unsupported speed or portability claims.

## Proof Work Still Needed

- Check the specimen into the repository and generate every landing artifact
  from it.
- Capture native wide and narrow frames with structured cell metadata.
- Capture a real host-terminal split-footer sequence and a real SSH resize/input
  sequence.
- Measure changed cells and emitted bytes for changed and unchanged frames.
- Add a focused `TestRenderer` test for the interaction shown on the page.
- Provide static frames and transcripts for reduced-motion and no-JavaScript
  contexts.
