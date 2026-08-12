# Landing page: feature showcase plan (progress log)

Context: `landing-page-content.md` and `website-content-analysis.md` (this
directory) cover an earlier ask — turn test6's hero into an illustrated,
mechanism-first walkthrough of the render pipeline. That shipped and is live
as "Building a terminal app." (FIG_01&ndash;06 in `src/pages/index.astro`).

This doc covers a later, different ask: show what OpenTUI can actually
*build*, not how it works — feature-forward, not a rendering-internals
tour, and explicitly not SaaS-feature-card copy. **The content lives
directly in `index.astro`**, in the section titled "It's not just boxes and
text." (right after the hero, before the walkthrough) — this file is the
map, not the draft.

## First attempt missed the brief — here's the correction

The first pass at this section led with implementation internals: grapheme
clusters vs. UTF-16 code units, a color-matrix formula walkthrough, dense
"FIG_XX" plates with source/output code grids, reused as one template for
every subject. All true, none of it something a person deciding whether to
use a terminal UI library actually weighs — correctness of Unicode handling
is table stakes, not a feature to sell. It also placed everything after the
existing walkthrough and copied that walkthrough's own visual language
wholesale, instead of asking what presentation actually suited each
capability.

The correction, in place now:

- **Cut the internals.** No grapheme/code-point/UTF-16 table, no color-matrix
  formula, no "FIG_XX [ TAG ]" plates for this content. That convention stays
  where it already worked (the walkthrough), and isn't reused here.
- **Feature-forward framing.** Three headlines: "It can make sound," "It can
  show you a photograph," "It can even do this" (3D/WebGPU). Each is what you
  could build, not how the renderer computes it.
- **A different kind of evidence per feature, not one template three
  times**: real playable audio players, a real captured photograph, a real
  copy-pasteable terminal command. See the table below.
- **Moved earlier.** Right after the hero, before the walkthrough: excite
  first (what can this do), then teach (how do you build with it), then
  reference (the index). The old placement — after the walkthrough, right
  before the index — buried it.

## What's in the page now

| Feature | Evidence | Presentation |
| --- | --- | --- |
| Audio | **Real, playable** `.wav` files (`public/audio/`) — byte-identical synthesis to `native-audio-demo.ts`'s own sound effects | Three inline `<audio controls>` players, front and center |
| Images | **Real captured photograph** (`public/images/dragon-mosaic.svg`) — `dragon.jpg` through `ImageRenderable`'s actual `protocol: "blocks"` path, captured with `captureSpans()`, redrawn as an SVG at the exact captured colors, cell for cell | One image, no code-grid framing |
| 3D / WebGPU | No capture (honest reason given inline: WebGPU needs a real GPU, not available to the process building this page) | A real, copy-pasteable `curl \| sh` + `./opentui-examples` command, styled like a terminal prompt, in place of a screenshot standing in for one |

Regenerate the audio/image assets with `bun scripts/generate-landing-evidence.ts`
(from `packages/web`) if the cited source changes; its header comment
explains both pieces. The image-mosaic generator is worth knowing about even
outside this page: it maps OpenTUI's real block-quadrant glyph output back
to pixels, which is a reasonable trick anywhere you want to show real
terminal-rendered output in a browser without a video.

Deliberately cut from the previous draft, not carried forward: the Unicode
grapheme figure, the color-matrix sepia/protanopia figure. Both were real
and correct; neither is in the page anymore because neither is a reason to
choose OpenTUI. If a future pass wants an "engineering craft" beat, it
belongs in the existing walkthrough's voice (mechanism, docs-linked), not
here.

## Why audio, images, and 3D — not more, not others

Audio was the seed idea from the original brief, verbatim: "a section on
audio, including the player showing + playing audio while showing it." This
page now does exactly that, with real sound. Images and 3D are the strongest
"OpenTUI can do *that*?" material found in the research pass (WebGPU shaders
and physics rendering inside a terminal cell grid is genuinely unusual
among TUI libraries). Three was chosen over five-plus so each one gets real
attention instead of becoming another repeated card; rich text/Markdown/code
highlighting was considered and cut for this pass — the walkthrough already
demonstrates real components, and a fourth entry didn't have real evidence
behind it in the time available (tried a real syntax-highlighting capture
via `CodeRenderable`; Tree-sitter highlighting didn't complete in the test
renderer in time to debug further, so it was dropped rather than shipped
unhighlighted and mislabeled).

## Explicitly not touched

The hero (`<header class="editorial-hero">`, `TerminalIllustration.astro`,
`terminal-illustration.js/css`, `public/recordings/*`) — someone else has
been actively iterating on it throughout this work (recordings swapped
twice over the course of writing this). Checked via `git diff` before and
after every edit; not one line there is mine.

## Verified before calling this done

- `bun run build` (astro build, in `packages/web`) completes clean, all 60
  pages including `/`.
- Screenshotted at desktop (1440px) and mobile (390px) width with headless
  Chromium (not the user's browser) — caught and fixed a real mobile
  overflow bug in the 3D command block's long URL this way, not by
  assumption.
- `/audio/*.wav` serve as `audio/wav`; `/images/dragon-mosaic.svg` serves and
  renders (verify by opening `/` and actually pressing play / looking at the
  photo — that's the point of this section).
- New doc links (`/docs/core-concepts/audio`, `/docs/reference/three`,
  `/docs/components/image`) return 200.

## Open follow-ups (need you, not more agent time)

1. **Read the three feature blocks and rewrite in your own voice** — same
   as before, this is draft copy, not final.
2. **The 3D section has no visual at all**, by design, given the honest
   constraint (no GPU here). If that's not an acceptable trade for you, the
   real fix is a recording: the asciinema-based pipeline at
   `~/src/tuiexperiments/player` (documented in `public/recordings/README.md`)
   already works in this environment for terminal content that doesn't need
   a GPU-backed example; whether it can record a `@opentui/three` demo
   depends on whether `bun-webgpu` actually initializes on the machine doing
   the recording, which is unverified.
3. **Decide if three features is the right number.** Rich text/Markdown/code
   was cut for lack of real evidence in time, not because it's uninteresting
   — OpenTUI's Markdown renderer streaming token-by-token is literally how
   OpenCode renders its own output, which is a strong, authentic hook if
   someone gets a real capture working.
4. Both real assets (`public/audio/*.wav`, `public/images/dragon-mosaic.svg`)
   are checked-in static files, not generated at build time — if `dragon.jpg`
   or the audio presets change upstream, re-run the generator script by hand.
