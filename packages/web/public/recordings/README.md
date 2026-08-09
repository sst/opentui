# Terminal illustration recordings

These `.json` files are recorded terminal sessions ("story" files) rendered by
`<TerminalIllustration>` (`src/components/TerminalIllustration.astro` +
`src/scripts/terminal-illustration.js`). That player is chrome-free: no window
frame, it paints cells directly on the page background so it can bleed into a
layout. Unlike a single fixed look, each **story** independently picks:

- **`tone`**: `"inherit"` (default) recolors every cell by luminance into this
  element's own computed `color` (or an explicit `ink`/`inkShadow`/
  `inkHighlight` override) — the ambient, abstract look, and the one that
  automatically tracks light/dark mode. `"recorded"` paints the recording's
  own captured foreground colors verbatim, for content meant to read as a
  real, legible terminal.
- **`background`**: `"transparent"` (default) paints no cell backgrounds, so
  the page shows through everywhere. `"recorded"` paints the recording's own
  captured cell backgrounds too, i.e. it looks like an actual terminal window
  sitting on the page (see `ot-proportional-terminal.json` below).
- **`fadeTop`/`fadeRight`/`fadeBottom`/`fadeLeft`**: each a fraction (0-1) of
  that edge's own extent (rows for top/bottom, columns for left/right) over
  which per-cell opacity ramps to 0 at the true edge, for composing the
  illustration into a layout (e.g. dissolving into a copy column, or into the
  next section) without a hard cut. This is computed per cell in JS, **not**
  CSS `mask-image` or an overlay div — both visibly soften/blur the monospace
  glyphs (the browser has to composite the whole illustration through an
  offscreen layer to apply either), which reads as noticeably less crisp than
  the same content unmasked. Per-cell opacity has neither problem, since it's
  just more of the same inline styling already used for the mono recolor.
- A `title`/`caption` shown in the controls panel (see below) when present.

Multiple stories cycle in order, looping forever, with a short crossfade
between each. An optional controls panel (per-story segment dots with
click-to-jump, a play/pause toggle, the caption) can stay fully out of the
DOM's visible flow (`controls="hidden"`, the default), reveal on hover/focus
(`controls="hover"`, used in the hero), or stay always visible
(`controls="visible"`, for a more prominent future placement). Loading is
lazy: each illustration only fetches its recordings once it's within
`rootMargin: "800px 0px"` of the viewport, so an instance hidden entirely below
a breakpoint (the hero's, on narrow viewports) or far down a long page never
pays for the fetch at all.

This doc is the recipe for producing more of these. The recording/build
tooling itself lives **outside this repo**, in a sibling checkout:
`~/src/tuiexperiments/player` (an asciinema-cast → story.json pipeline). If
that path doesn't exist for you, you need that project checked out alongside
this one to make new recordings; only the built `story.json` output belongs
here.

## Files here

| File                            | Source                                                                                                                                                                          | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `terminal-story.json`           | Original "Take4" aurora recording (120×34, 262 frames)                                                                                                                          | Has a persistent UI border baked into frames 0–63. Kept for reference/diffing; don't use directly in new work.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `terminal-story-trimmed.json`   | `terminal-story.json` trimmed to frames 64–261                                                                                                                                  | Border-free clean loop. Used in the live hero (`tone`/`background` left at their ambient defaults).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `noise-sanctuary.json`          | Headless recording of `~/src/tuiexperiments/noise-sanctuary` (procedural fbm noise/light field, animates on its own), recorded **wide** (210×42, then row 1 cropped to 41 rows) | Used in the live hero. The width matters: an earlier 100×56 capture was narrower than the hero's own bleed box at most viewport sizes, which — since `fit="cover"` only ever fits _height_ (so every row stays visible) and lets width do whatever it does — left the recording floating as an island with hard-cut edges and dead space on both sides, instead of bleeding cleanly off the box's edge. Re-recording at a wide/short aspect (`--window-size 210x42`) fixed this: `cols*chToEm / (rows*lineToEm)` needs to be at least the bleed box's own width:height ratio (roughly 1.1–2× depending on viewport) for `cover` to crop width instead of leaving a gap. |
| `ot-proportional-terminal.json` | PTY-driven, continuous-scroll recording of `~/src/tuiexperiments/ot-proportional-terminal` (a real prose/typography document), 100×34                                           | Used in the live hero with `tone="recorded" background="recorded"` — a legible boxed document panel, deliberately different in register from the two abstract/ambient stories. An earlier capture drove the scroll via big `PageDown` jumps (1/2 viewport per key), which is a slideshow, not motion: `bin/build` only keeps _distinct_ frames, and jumping a half-screen at a time produced only ~14 of them over 16s. Driving small `Down`-arrow ticks (`ScrollBoxRenderable` scrolls 1/5 viewport per `down` keypress) every ~0.26s instead produced 44 frames over 22s — real, continuous-reading motion instead of a series of cuts.                               |

## How to record a new one

### 1. Capture a `.cast` with `bin/record`

`~/src/tuiexperiments/player/bin/record` wraps `asciinema rec` with sane
defaults (chapter markers, overwrite, headless/window-size passthrough):

```bash
bin/record out.cast                                 # record an interactive shell
bin/record out.cast -- node demo.mjs                 # record a specific command, interactive
bin/record --headless out.cast -- node demo.mjs      # scripted, no TTY needed
bin/record --window-size 100x56 out.cast -- bun src/app.ts
```

**App animates on its own (no input needed)** — e.g. `noise-sanctuary`: use
`--headless` and wrap the command in `timeout Ns` for a fixed duration. Prefer
a wide/short `--window-size` (see the `noise-sanctuary.json` row above for
why) if the recording is meant to bleed edge-to-edge in a wide, shallow box:

```bash
cd ~/src/tuiexperiments/noise-sanctuary
../player/bin/record --headless --window-size 210x42 /tmp/my-recording.cast \
  -- timeout 16 bun src/app.ts
```

**App needs real interaction** (scrolling, keypresses) — prefer recording it
live and naturally instead of scripting fake input:

```bash
cd ~/src/tuiexperiments/some-app
../player/bin/record /tmp/my-recording.cast -- bun src/app.ts
```

Interact normally, press `ctrl+x` to drop a chapter marker at good boundaries,
exit when done. If motion needs to read as continuous rather than a slideshow
(e.g. scrolling a document), favor many small input ticks over few large ones
— `bin/build` only keeps frames that actually changed, so a handful of big
jumps produces a handful of frames no matter how long you record. (If an app
truly can't be driven live in this environment, see `ot-proportional-terminal`'s
recording for a PTY-forking scripted-input fallback — synthesizes keys via a
real pseudo-terminal. Last resort, not the default path.)

### 2. Build the story.json

```bash
cd ~/src/tuiexperiments/player
cp /tmp/my-recording.cast ./my-recording.cast
node bin/build my-recording.cast
```

This generates `my-recording.story.config.json` (chapters inferred from
markers/on-screen text/timestamps). **Immediately edit its `output.story`
path** from the default `assets/story.json` to something recording-specific
(e.g. `assets/my-recording.story.json`) — otherwise a second build run
overwrites the repo's shared demo asset. Then rebuild from the edited config:

```bash
node bin/build my-recording.story.config.json
```

### 3. Sanity-check before shipping it

Scan the frames for anything that'll look wrong once every row is visible
(the player's `fit="cover"` mode fits font size to the box's full height, so
nothing is cropped vertically):

- **Persistent on-screen chrome** (title bars, borders, HUD labels) baked into
  every frame — reads as an unwanted hard rectangle or leaks legible text once
  recolored. Either crop the offending row(s) or trim to a clean frame range.
- **A narrower-than-box aspect ratio** — with `cols*chToEm / (rows*lineToEm)`
  less than the target box's own width:height ratio, `cover` leaves the
  recording floating with dead space and hard-cut edges instead of bleeding
  off the box. Re-record wider/shorter, or crop rows to reshape it (fewer rows
  raises the ratio without needing a new capture).
- **A slideshow instead of motion** — big, infrequent input jumps produce few
  distinct frames (see `ot-proportional-terminal.json` above). Prefer many
  small ticks.
- **Real prose/tables in `tone: "inherit"` (mono) mode** — recolors as flat,
  legible-looking streaks rather than ambient texture. Either use
  `tone: "recorded"` (optionally `background: "recorded"` too) so it reads as
  an actual document/terminal instead, or don't use it as an abstract/ambient
  piece.

Small throwaway scripts for these (scan for border chars, drop a row index by
cropping `frame.rows`, trim a frame range and rebase timestamps) were used
ad hoc in `/tmp` while building the current set; there's no checked-in tool
for this yet, since it's been a small one-off per recording so far.

### 4. Ship it

```bash
cp my-recording.story.json packages/web/public/recordings/my-recording.json
```

Add it to `/lab/hero-illustration` first to preview in isolation (including
against the real hero bleed geometry), then wire it into the live hero via
`<TerminalIllustration stories={[{ src: "...", tone, background, fadeLeft,
fadeBottom, title, caption, ... }, ...]} controls="hover" />` in
`src/pages/index.astro`. Each story in the array can set its own `tone`,
`background`, `fit`, `scale`, `gamma`, `minAlpha`, `maxAlpha`, `holdMs`, and
fade fractions — see the `StoryConfig`/`Props` interfaces in
`TerminalIllustration.astro` for the full list and their defaults.
