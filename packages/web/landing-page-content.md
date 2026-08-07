# Landing Page Content Draft

This draft writes into test6's existing editorial form. It does not prescribe a
new layout, remove the multi-column flow, replace the technical plates, or turn
the page into a sequence of product modules. Visual concepts come later; this
document settles content and language.

Revision note: this version is written for the visitor. The previous draft
explained how terminals work; this one explains how to use OpenTUI and what it
does with what you write. Every plate now leads with code the reader would
write or behavior the reader would observe, and only then explains the
mechanism. Concretely:

- The editorial flow opens with a new plate showing the same interface in the
  imperative, React, and Solid APIs.
- The remaining plates are reordered to follow the user's path: layout you
  declare, text you set, updates you make, images you render.
- The color-matrix plate is retired from the main flow. Its subject moves to
  one prose sentence and an index entry; the figure can be reused later on the
  color-matrix reference page.
- All code snippets are adapted from the published docs pages: they use only
  documented API, but they are condensed for the page. Each snippet cites the
  docs page it is adapted from, and API changes on those pages must be
  reflected here.

The only new major content block is the product hero. Everything after it is a
rewrite of the current test6 page in its existing order and treatment.

## 1. Product hero

### Masthead

OpenTUI / Documentation / GitHub

### Headline

# Terminal UIs on a native Zig core.

### Description

OpenTUI is a TypeScript library for building interactive terminal applications.
Write components with the imperative API, or with React and Solid over the same
renderer. Yoga resolves Flexbox layout, and a native Zig core turns each frame
into terminal output.

### Example

One short snippet, core flavor. This is the hero's proof that OpenTUI is a
library you use, not a system you study. Adapted from `/docs/getting-started`.

```typescript
import { createCliRenderer, Box, Text } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  Box(
    { borderStyle: "rounded", padding: 1 },
    Text({ content: "Hello, OpenTUI!" }),
  ),
)
```

### Start

```sh
bun create tui
```

Documentation / GitHub

### Optional supporting line

Components, Flexbox layout, input, Unicode text, images, testing, and SSH.

This line should remain secondary. It is a compact statement of range, not the
start of a feature-card section. Do not expand the hero into tabs, framework
badges, or multiple install variants.

## 2. Illustrated introduction front matter

This is the current test6 hero moved below the product hero and rewritten. It
should retain test6's publication treatment.

### Running label

HOW OPENTUI RENDERS // TYPESCRIPT API + ZIG CORE

### Title

# Between your code and the screen.

### Subtitle

An illustrated introduction to building terminal interfaces with OpenTUI, and
what the renderer does with them.

### Description

Five views of one interface on its way to the terminal: the components you
write, the layout you declare, the text you set, the updates you make, and the
images you render. Each plate starts from code or observable behavior and
points to the reference documentation behind it.

### Metadata

Open source under the MIT License / Documentation maintained with the source

Do not hard-code a package version unless it is read from package metadata. Do
not invent a chapter count, word count, authorial byline, or specification
status.

## 3. Editorial flow

The passages below keep test6's continuous multi-column essay. The order is
new: it follows the reader's work, not the terminal's anatomy.

### Opening passage

You describe an interface as objects: boxes, text, inputs, images. The terminal
accepts none of those. It accepts rows and columns of character cells, updated
by text and control sequences written to an output stream.

OpenTUI stands between the two. It takes the tree you build, resolves its
layout against the terminal's current dimensions, composes a frame of cells,
and writes the difference to the terminal. Keyboard input follows focus; mouse
input follows the geometry of what is on screen.

The five plates below follow one interface across that boundary, in the order
you would build it.

### FIG_01: The interface you write

#### Plate label

FIG_01 / ONE INTERFACE : THREE APIS

#### Figure

New figure: a source/output pairing. Three short listings of the same bordered
greeting — imperative, React, Solid — beside one captured output frame. Label
the output's origin once, quietly: captured with `createTestRenderer` at a
stated width and height. No fake editor chrome, no browser simulation. The
listings are condensed from the linked docs pages; each uses only API shown on
its page.

Imperative (adapted from `/docs/getting-started`):

```typescript
import { createCliRenderer, Box, Text } from "@opentui/core"

const renderer = await createCliRenderer()

renderer.root.add(
  Box(
    { borderStyle: "rounded", padding: 1 },
    Text({ content: "Hello, OpenTUI!" }),
  ),
)
```

React (adapted from `/docs/bindings/react`):

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

function App() {
  return (
    <box borderStyle="rounded" padding={1}>
      <text>Hello, OpenTUI!</text>
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

Solid (adapted from `/docs/bindings/solid`):

```tsx
import { render } from "@opentui/solid"

const App = () => (
  <box borderStyle="rounded" padding={1}>
    <text>Hello, OpenTUI!</text>
  </box>
)

render(App)
```

#### Caption

The same renderable tree expressed three ways. `@opentui/core` is the
imperative API; `@opentui/react` and `@opentui/solid` are optional declarative
APIs over the same renderer. JSX intrinsic elements map to core renderables.

#### Passage

Every OpenTUI interface is a tree of renderables. `Box` and `Text` are factory
functions: the first argument is props, the rest are children. You attach the
tree to `renderer.root` and the renderer owns it from there.

React and Solid do not replace that model; they drive it. Both bindings
reconcile JSX onto the same renderables the imperative API creates, so
components, layout, input, and testing behave the same regardless of which API
produced the tree. The native core also exposes a C ABI that can serve as the
foundation for additional bindings.

#### Continue reading

- Getting started: `/docs/getting-started`
- Renderables: `/docs/core-concepts/renderables`
- React: `/docs/bindings/react`
- Solid: `/docs/bindings/solid`

### FIG_02: The layout you declare

#### Plate label

FIG_02 / FLEX PROPS : TERMINAL BOUNDS

#### Caption

Yoga resolves Flexbox-like constraints — direction, grow, shrink, padding,
percentage widths — against the terminal's available rows and columns; OpenTUI
uses the resulting bounds to place renderables on the cell grid.

#### Passage

For ordinary layout, you position nothing by hand. You set `flexDirection`,
`flexGrow`, `padding`, and percentage sizes on containers, and Yoga resolves
the tree against the terminal's current width and height; absolute positioning
remains available when you need it. When the terminal is resized, the same
tree is resolved against the new constraints; your components do not change.

The resolved bounds determine more than where a border is drawn. They determine
where text wraps, how much of a scrollable region is visible, and where mouse
interaction lands. Layout is continuous while it is being described and
discrete when it reaches the terminal: the result must occupy whole columns and
rows.

#### Continue reading

- Layout: `/docs/core-concepts/layout`
- Renderables: `/docs/core-concepts/renderables`

#### Figure correction

Retain the existing layout plate. Do not claim an exact custom quantization
algorithm unless it is demonstrated in source. The plate explains the boundary
between flexible constraints and cell geometry.

### Interlude passage: input and focus

No figure. One short passage between the layout and text plates.

Rendering also establishes where interaction can happen. Focus a component and
keyboard events route to it; `renderer.keyInput` emits structured key events
with the parsed key name, modifiers, and the original terminal sequence, and
paste arrives as its own event. Mouse events follow the resolved bounds of
whatever is beneath the pointer. Input handling belongs to OpenTUI as a whole —
parsing, focus, and routing are part of the same renderer that draws the frame.

- Keyboard and input: `/docs/core-concepts/keyboard`
- Input component: `/docs/components/input`

### FIG_03: The text you set

#### Plate label

FIG_03 / YOUR STRING : ITS CELLS

#### Caption

The native buffer represents a terminal frame through parallel character,
color, and attribute data. A logical cell combines character or grapheme
information with foreground color, background color, and style attributes;
tagged values also represent image and continuation cells.

#### Passage

You set `content` on a text renderable and move on. OpenTUI's job is to make
that honest on a cell grid, because a cell is not the same thing as a character
in a JavaScript string. A grapheme is not a byte, a code point, or a UTF-16
code unit: several code points can form one grapheme, and a wide grapheme can
begin in one column and continue through another.

OpenTUI keeps those distinctions in the frame. The character field can identify
a direct scalar, a grapheme stored elsewhere, an image cell, or a continuation.
Foreground and background colors and text attributes travel with it. This is
why wrapping, truncation, and cursor movement stay correct when your strings
contain emoji, CJK text, or combining marks — and why tests can capture the
frame as plain text or inspect structured spans containing text, width, colors,
and attributes.

#### Continue reading

- Text: `/docs/components/text`
- Colors: `/docs/core-concepts/colors`
- Testing: `/docs/core-concepts/testing`

#### Figure correction

Retain the existing isometric cell plate, but revise its labels against the
current Zig `Cell` definition. Do not call the character field unconditionally
UTF-32, and do not describe internal RGBA storage as a 24-bit vector.

### FIG_04: The updates you make

#### Plate label

FIG_04 / PREVIOUS FRAME : CURRENT FRAME

#### Caption

For ordinary updates, the renderer compares the current cell frame with the
previous one and builds terminal output for the cells and terminal state that
changed.

#### Passage

You change state — a label, a cursor position, one row of results — and you are
done. You do not schedule redraws, track damage, or decide what to repaint.
OpenTUI composes the next frame as a complete surface, compares it with the
previous one, and writes output only for what changed.

Changed runs carry the cursor movement, color and attribute state, and encoded
text needed to update those positions. An unchanged render can produce no cell
updates; a resize or screen-mode transition can require more work than a small
cell diff. The useful property is not an absolute promise of "no redraws." It
is that the frame and its update are both explicit objects you can inspect:
tests capture frames with `createTestRenderer`, and frame-buffer operations
such as 4x4 color-matrix transforms act on the frame directly without touching
your component tree.

#### Continue reading

- Renderer: `/docs/core-concepts/renderer`
- Testing: `/docs/core-concepts/testing`
- Color matrix: `/docs/reference/color-matrix`

#### Figure correction

Retain the previous/current buffer plate. Replace fixed 45 KB labels and
unmeasured 60 FPS claims with neutral labels unless exact values are generated
from a named capture.

### FIG_05: The images you render

#### Plate label

FIG_05 / KITTY : SIXEL : UNICODE BLOCKS

#### Caption

With image protocol selection set to `auto`, OpenTUI resolves the configured
override and available terminal capabilities to Kitty graphics, Sixel, or
Unicode quadrant blocks.

#### Passage

You add an image component and point it at a file. Which bytes reach the
terminal depends on the terminal: some emulators accept Kitty graphics, some
accept Sixel, and every environment reports different capabilities during
startup, resize, remote transport, or multiplexing.

OpenTUI keeps that decision at the image-rendering boundary so your component
does not change per terminal. In automatic mode, the documented order is the
global override, then Kitty, then Sixel, then Unicode blocks. Sixel requires
terminal pixel geometry and temporarily falls back to blocks when that geometry
is unavailable; tmux and overlapping images introduce additional constraints
documented with the image component. The block path is not an error state — it
maps sampled image colors into the same foreground, background, and cell grid
used by the rest of the frame.

#### Continue reading

- Image component: `/docs/components/image`
- Native image loading: `/docs/reference/native-image`
- Environment overrides: `/docs/reference/env-vars`

#### Figure correction

Retain the protocol plate but make it three-way. Remove the unsupported ASCII
tier and the claim that generic device-attribute probing alone selects every
protocol.

### Closing passage

These mechanisms meet at `CliRenderer`. It manages the terminal session, input
events, the render loop, and the output boundary while loading the native Zig
rendering library underneath. A renderer takes responsibility for the terminal,
then gives it back: it enters the selected screen mode, configures terminal
features, receives input, writes frames, and restores the terminal's state
during cleanup. The details differ across local terminals, custom streams, and
SSH sessions; the boundary remains explicit.

You have already seen the whole surface area: `@opentui/core` for the
imperative API and component primitives, `@opentui/react` and `@opentui/solid`
for declarative APIs over the same renderer, and a native core with a C ABI
underneath all three. The index below follows each part into the documentation.

## 4. Reading index

This replaces the fictional chapter titles and word counts while preserving the
current table-of-contents presentation. Section names are editorial; every entry
is a real destination. The parts follow the same order as the essay: build,
style, interact, ship.

### PART I: FIRST FRAME

- Getting started - `/docs/getting-started`
- Renderer lifecycle - `/docs/core-concepts/renderer`
- Renderables - `/docs/core-concepts/renderables`
- Layout system - `/docs/core-concepts/layout`

### PART II: TEXT, COLOR, AND CELLS

- Text - `/docs/components/text`
- Colors - `/docs/core-concepts/colors`
- Frame buffer - `/docs/components/frame-buffer`
- Color matrix - `/docs/reference/color-matrix`

### PART III: INPUT AND COMPONENTS

- Keyboard and input - `/docs/core-concepts/keyboard`
- Input component - `/docs/components/input`
- Image component - `/docs/components/image`
- Testing - `/docs/core-concepts/testing`

### PART IV: APIS AND TRANSPORTS

- React - `/docs/bindings/react`
- Solid - `/docs/bindings/solid`
- SSH - `/docs/reference/ssh`
- Package entrypoints - `/docs/reference/package-entrypoints`

Do not add fictional word counts. If metadata appears beside an entry, use
something true and useful, such as `CORE CONCEPT`, `COMPONENT`, `BINDING`, or
`REFERENCE`.

## 5. Footer

### Identity

OpenTUI / Between your code and the screen

### Links

Documentation / Renderer / Layout / GitHub

### Colophon

Open source under the MIT License / Native Zig and TypeScript

The footer should close the editorial object already on the page. It does not
need another install CTA, product proof section, or OpenCode endorsement.

## 6. Figure inventory

Disposition of the five existing test6 plates against this draft:

| Existing plate            | Disposition                                        |
| ------------------------- | -------------------------------------------------- |
| Cell memory layout        | Retained as FIG_03, labels corrected               |
| Frame diff loop           | Retained as FIG_04, labels neutralized             |
| Yoga grid quantization    | Retained as FIG_02, quantization claim removed     |
| 4x4 SIMD color matrix     | Retired from flow; reuse on color-matrix reference |
| Graphics protocol tiers   | Retained as FIG_05, reduced to three-way           |

New figure required: FIG_01 source/output pairing (three listings, one captured
frame with stated dimensions and producer).

## 7. Voice rules for this page

- Lead every passage with what the reader writes or observes; mechanism second;
  documentation link third.
- Label an artifact's origin once. Do not repeat that output is "real."
- Say "ordinary updates are diffed cell by cell," not "no full redraws."
- No unsupported absolutes: blazing, seamless, flicker-free, universal,
  zero-allocation, any-language.
- OpenTUI is a library with documentation, not a specification, book, or
  58-chapter manual.
- Code snippets use only API documented on the page they cite, are labeled
  "adapted from" that page, and must be re-verified whenever that page
  changes.
