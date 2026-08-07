# OpenTUI Website Content Analysis

This document collects the useful language and framing from the six website
explorations for the next version of `ot-website-test6`.

It is a content brief, not a visual redesign brief.

## The assignment

Test6 remains the starting point. Its type, editorial density, multi-column
essay, technical plates, masthead, and index-like navigation are part of the
concept, not decoration to remove.

The content work is:

1. Add a direct product hero above the existing test6 experience, close to the
   language used by the current website.
2. Move the current test6 page below that hero as an illustrated, one-page
   introduction to OpenTUI.
3. Rewrite that introduction with correct OpenTUI language and verified claims.
4. Replace Making Software-derived rhetoric and fictional book metadata with an
   editorial system that belongs to OpenTUI.
5. Use the existing index treatment to direct readers into real documentation.

The content work is not permission to replace test6 with a standard sequence of
benefit cards, framework badges, social proof, and repeated calls to action.
Visual alternatives can be explored later.

## What must remain recognizable

- The EB Garamond and Berkeley Mono pairing.
- The quiet masthead and publication-like front matter.
- The responsive multi-column essay.
- Technical figures embedded in the reading flow.
- Figure labels, annotations, and dense captions.
- An index or contents structure at the end.
- The sense that OpenTUI's implementation is something worth inspecting.

Individual details can eventually evolve, but this phase should write for this
form rather than write a different page and leave the typeface behind.

## What makes it OpenTUI's own

The page should be organized around the boundary OpenTUI crosses:

`application objects -> layout -> terminal cells -> terminal updates`

That is more specific than a general software reference manual and more useful
than a list of product benefits. It gives the existing plates a shared subject:
the construction of one terminal frame.

The editorial identity should come from OpenTUI's own artifacts and vocabulary:

- renderables and their bounds;
- terminal cells and grapheme continuations;
- current and previous frame buffers;
- Yoga layout resolved against rows and columns;
- foreground and background color transforms;
- Kitty, Sixel, and Unicode block image output;
- renderer lifecycle and terminal ownership;
- imperative, React, and Solid APIs over the same renderer.

The voice can remain authored, technical, and curious without reproducing the
specific Making Software formula of "A reference manual for...", "Written and
illustrated by...", "Have you ever wondered...", chapter counts, and word
counts.

## Contributions from each exploration

### `ot-website`: product clarity and narrative discipline

Use:

- "Terminal UIs on a native Zig core" as the clearest current category line.
- A simple `bun create tui` starting point.
- The separation between evidence, mechanism, and reference.
- The compact rendering description: application objects become renderables,
  layout resolves their bounds, renderables write cells, and the renderer
  produces terminal updates.
- The rule from `landing-story.md` that a claim should lead to an observable
  consequence and then its OpenTUI cause.

Do not import:

- A new recurring specimen as a decided visual concept during this phase.
- Repeated assurances that output is "real" or "not invented."
- Hard-coded build status or future-product claims.
- The complete hero/evidence/mechanism/reference layout. Test6 already has its
  own editorial structure.

### `ot-website-test2`: provenance and the cell model

Use:

- The distinction between a structured cell frame, a screenshot, and an
  unstructured string.
- Source, command, dimensions, and producer as quiet provenance for captured
  output.
- Source/output pairings where they clarify an API.
- Short definitions for unavoidable terms such as Yoga, grapheme, C ABI, and
  reconciler.

Do not import:

- Fake editor chrome.
- Three competing install choices in the hero.
- "A C ABI for everything else" or other portability absolutes.
- A reductive cell description that omits graphemes, continuations, attributes,
  or terminal state.

### `ot-website-test3`: the strongest technical voice

Use this exploration most heavily when rewriting test6's essay. Its best lines
turn implementation details into ideas without sounding like marketing:

- "What happens between your objects and the screen."
- "A grapheme is not a byte, a code point, or a UTF-16 code unit."
- "Rendering also establishes where interaction can happen."
- "A renderer takes responsibility for the terminal, then gives it back."

Also use its restraint:

- Say "ordinary updates are diffed cell by cell" rather than "no full redraws."
- Separate an explanatory illustration from captured renderer evidence.
- Link each technical passage to the relevant documentation.

Do not import its whole page structure. Test3 is a useful source of prose, not a
replacement layout for test6.

### `ot-website-test4`: concise hero language

Use:

- The current category line: "Terminal UIs on a native Zig core."
- A short explanation that names TypeScript, React, and Solid.
- "How a frame gets to your terminal" as a plain-language rendering question.

Do not import:

- The feature-card taxonomy.
- The tabbed install control or agent-skill command in the hero.
- Browser simulations described as live renderer output.
- "Any language," "no flicker," "no full redraws," or similar absolutes.

### `ot-website-test5`: architectural boundaries

Use:

- "A native core first, a TypeScript library second."
- "React and Solid are optional reconcilers over an imperative core."
- "OpenTUI asks your terminal what it can do before it draws anything."
- Its distinction between Zig core, C ABI, TypeScript API, and optional bindings.
- Its concrete package descriptions when routing to deeper documentation.

Do not import:

- An implementation-heavy hero.
- The architecture stack as a new card section.
- Repeated "real" labels.
- Unqualified claims that only changed cells ever reach the terminal.

### `ot-website-test6`: the form and the subject

Keep:

- The editorial page as an object in its own right.
- The multi-column reading flow.
- The five-plate sequence: cells, frame comparison, layout, color transforms,
  and image protocols.
- The serif/mono contrast and annotated figures.
- The closing index as a bridge from introduction to reference material.

Rewrite:

- The existing hero becomes the front matter for the illustrated introduction,
  below the new product hero.
- "Reference manual" and "specification" become language appropriate to a
  one-page illustrated introduction unless a real manual is being published.
- The opening should start from OpenTUI's rendering boundary, not "Have you ever
  wondered..."
- The index must describe actual docs and contain no invented word counts.
- Captions should describe what the figures explain, without presenting diagrams
  as proof of runtime behavior.

## Recommended page composition

This is a content hierarchy inside the existing design direction, not a visual
layout prescription.

### 1. Product hero

One direct definition, one short explanation, one install command, and paths to
documentation and GitHub. This is the only newly required section.

### 2. Illustrated introduction

The current test6 hero and editorial flow move here. They become the title and
opening of a one-page account of how OpenTUI turns application objects into
terminal output.

The existing five subjects remain in their current order:

1. Character-cell representation
2. Differential frame output
3. Yoga layout on a terminal grid
4. Frame-buffer color transforms
5. Image protocol selection

The final paragraph connects the native renderer to the imperative TypeScript,
React, and Solid APIs.

### 3. Reading index

The current table-of-contents design remains, but its entries become truthful
routes into the existing documentation. The index should feel like the rest of
the publication, not like a grid of product cards.

### 4. Footer

Keep the restrained existing footer. Its naming should match the final identity
chosen for the illustrated introduction.

## Voice

Write like an engineer showing another engineer how the system fits together.
The page can be literary in rhythm, but it should be concrete in its claims.

Prefer:

- "Every OpenTUI application eventually crosses the same boundary."
- "The renderer does not send application objects to the terminal."
- "A grapheme can occupy more than one cell; several code points can form one
  grapheme."
- "Layout is continuous while it is being resolved and discrete when it reaches
  the terminal."
- "The frame can change without the component tree changing."
- "The terminal decides which image protocol is available."

Avoid:

- Generic invitations such as "Use the API that fits your application."
- Generic depth claims such as "Go as deep as you need."
- Conversion language such as "Build the first frame."
- Unsupported adjectives such as blazing, seamless, flicker-free, universal,
  or zero-allocation.
- Repeated claims that an artifact is real. Label its origin once.
- Calling OpenTUI a specification, book, or 58-chapter manual when those things
  do not exist.

## Claim corrections for the current test6 copy

### Cell representation

Current test6 treats `char` as an ordinary UTF-32 codepoint. The field is tagged
and can represent a direct scalar, a grapheme-pool entry, an image cell, or a
continuation. Any exact byte-layout annotation must be checked against the
current Zig source before publication.

Internal foreground and background storage must not be conflated with terminal
24-bit truecolor serialization.

### Frame updates

Do not promise universal 60 FPS, no tearing, or no full-screen repaint. Describe
the current/previous frame comparison and changed-cell output as the ordinary
update path. If exact changed-cell or byte counts appear, they must come from a
specific measured capture.

### Layout

OpenTUI uses Yoga for Flexbox-like layout. Do not claim a special "exact
quantization pass" or universal edge-collision behavior without direct source
evidence. Describe the observable result: bounds resolve against terminal rows
and columns, and text wraps within those bounds.

### Color matrices

Keep this plate. `FrameBuffer.colorMatrix(...)` and
`colorMatrixUniform(...)` apply 4x4 transforms to normalized RGBA foreground,
background, or both. The uniform implementation has an optimized path processing
four pixels at a time and a scalar remainder. It is an explicit frame-buffer
operation, not a mandatory stage applied to every frame before serialization.

### Image protocols

The documented automatic order is global override, then Kitty, then Sixel, then
Unicode blocks. ASCII is not a documented fourth protocol. Sixel falls back to
blocks when terminal pixel resolution is unavailable, and tmux has additional
rules. The plate should explain that actual three-way policy rather than a
fictional four-tier hierarchy.

### APIs and runtimes

Attribute input handling to OpenTUI as a whole, not exclusively to the Zig core.
Describe the C ABI as a foundation for additional bindings rather than proof of
complete support for any language. React and Solid are optional APIs over the
imperative core.

## Documentation routes for the index

These routes exist in the current content tree and can replace the fictional
chapters without changing the index presentation:

- `/docs/getting-started`
- `/docs/core-concepts/renderer`
- `/docs/core-concepts/renderables`
- `/docs/core-concepts/layout`
- `/docs/core-concepts/colors`
- `/docs/core-concepts/keyboard`
- `/docs/core-concepts/testing`
- `/docs/components/text`
- `/docs/components/input`
- `/docs/components/image`
- `/docs/components/frame-buffer`
- `/docs/reference/color-matrix`
- `/docs/bindings/react`
- `/docs/bindings/solid`
- `/docs/reference/ssh`
- `/docs/reference/package-entrypoints`

## Content test

The next draft is aligned if:

- removing the new hero reveals something recognizably descended from test6;
- the three-column essay and five-plate progression still make sense;
- removing the typeface does not turn the prose into generic SaaS copy;
- every technical statement can be traced to source or documentation;
- the index points to content that exists;
- the page has one obvious starting action rather than a conversion funnel;
- OpenTUI remains the subject even if OpenCode is never mentioned.
