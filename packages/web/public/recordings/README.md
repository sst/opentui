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
  real, legible terminal, or where the recording's own color is the point
  (see `dispersive-prism.json`/`color-space-explorer.json` below).
- **`background`**: `"transparent"` (default) paints no cell backgrounds, so
  the page shows through everywhere. `"recorded"` paints the recording's own
  captured cell backgrounds too, i.e. it looks like an actual terminal window
  sitting on the page.
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
  Column-based fade (`fadeLeft`/`fadeRight`) is computed per _run_ (a
  contiguous same-styled span), using each run's midpoint — fine for abstract
  content where runs are short and frequent, but a poor fit for real prose,
  where one line is often one long run: set `fadeLeft`/`fadeRight` to `0` for
  that kind of content instead (see the git history for the retired
  `ot-proportional-terminal.json` for the full story on why).
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

| File                        | Source                                                                                                                                                                                                                                                                              | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dispersive-prism.json`     | `~/src/tuiexperiments/dispersive-prism` on its "Minimum deviation" preset (one `S` keypress after launch, then it flows on its own), 200×46, trimmed to a clean 26s window past the preset-switch caption's fade                                                                    | Used in the live hero with `tone="recorded"` — real color is the entire point of a dispersion recording; recoloring by luminance would throw it away.                                                                                                                                                                                                                                                                                                                                                       |
| `color-space-explorer.json` | `~/src/tuiexperiments/color-space-explorer` at 2× particle flow (four `]` keypresses after launch), riding its own built-in ~28s auto-cinematic loop, 190×50, trimmed to a clean 26s window                                                                                         | Used in the live hero with `tone="recorded"` — same reasoning: chromaticity/color-volume/RGB-split diagrams are only legible in their own real color.                                                                                                                                                                                                                                                                                                                                                       |
| `rubiks.json`               | `~/src/tuiexperiments/rubiks` (a WebGPU-rendered Rubik's cube), stepping through all 7 solving lessons via number key + `Space`, then cropped to just the cube itself — see "Cropping out UI chrome" below                                                                          | Used in the live hero with `tone` left at its ambient default — the default is exactly what makes the crop below matter.                                                                                                                                                                                                                                                                                                                                                                                    |
| `anomaly.json`              | `~/src/tuiexperiments/anomaly` (brand wordmark treatments) in "original" non-neon colors (`N` keypress, confirmed against the actual captured colors — see "Verify the keypress actually landed" below) while actively playing (`Space`), 210×40, trimmed to one ~3.1s cycle, 472KB | Used in the live hero with `tone="inherit"` (recolors into this element's own ink, so it bleeds/tracks light-dark mode) or `tone="recorded" background="recorded"` (paints the captured white-on-black verbatim, a literal boxed look) — either reads as clean and non-neon now; see the comment in `index.astro` for the live choice. The animation is fully deterministic (31 treatments × 100ms, then repeats exactly) — capturing more than one cycle duplicates bytes for zero new content; see below. |

Retired this round — real recordings, just not ones that compose well into a
responsive bleed box (kept in git history, not on disk, since nothing
references them anymore): `terminal-story.json`/`terminal-story-trimmed.json`
(the original aurora loop) and `ot-proportional-terminal.json` (a scrolling
prose document) both read as legible foreground text once `background:
"recorded"` or a long on-screen hold made them easy to actually read — next to
the hero's own copy, that plays as "text on text" rather than as ambiance.
`noise-sanctuary.json` (procedural noise field) is compositionally edge-to-edge
by design, with no focal point to crop around — it's already using its whole
rectangle when captured, and the responsive crop below then cuts a _different_
amount of it at every viewport width. Content whose composition treats the
terminal's own edges as a meaningful frame fights a box that crops however
much of it happens to fit at a given size; content with an actual subject (a
shape, a diagram, a wordmark) can be cropped _around_ instead, and still reads
as intentional at any width.

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

**App animates fully on its own (no input needed at all)** — use `--headless`
and wrap the command in `timeout Ns` for a fixed duration. Prefer a wide/short
`--window-size` (see "Aspect ratio" below for why) if the recording is meant
to bleed edge-to-edge in a wide, shallow box:

```bash
cd ~/src/tuiexperiments/some-headless-app
../player/bin/record --headless --window-size 210x42 /tmp/my-recording.cast \
  -- timeout 16 bun src/app.ts
```

**App needs a short setup (a few keypresses), then animates on its own** —
most `@opentui/core` demo apps have no CLI flags at all; every mode/preset is
a keybinding read live from stdin (check the app's own `?`/help overlay or
grep its source for `key.name ===` to find the exact keys). `--headless` can't
help here since there's no TTY to receive input, but a real pty via `tmux`
works and is simpler than scripting a PTY fork by hand:

```bash
tmux new-session -d -s rec -x 200 -y 46          # real pty, sized as recorded
tmux send-keys -t rec -l 'cd ~/src/tuiexperiments/some-app && ../player/bin/record /tmp/my-recording.cast -- bun start'
tmux send-keys -t rec Enter
sleep 3                                          # let the renderer actually start
tmux send-keys -t rec -l 's'                     # whatever keys select the mode/preset
sleep 30                                         # let it run
tmux send-keys -t rec -l 'q'                     # most of these quit on q/Escape/Ctrl+C
tmux kill-session -t rec
```

**Verify the keypress actually landed before trusting a long recording.**
`tmux capture-pane -p` (plain text) is not enough to confirm a _color_-mode
toggle took effect — text/shape can look identical while the color is wrong.
`anomaly.json`'s first version shipped with its `N` (neon-off) keypress never
having actually registered (sent too soon after launch, before the renderer
was ready for input), so the whole recording stayed in neon colors despite
looking, in a plain-text pane capture, exactly like a correct one. Check
colors directly instead, either live (`tmux capture-pane -e -p`, which
preserves escape codes, then grep for SGR color codes) or against the built
cast with the same replay library `bin/build` uses (see "A transient shell
announcement" below for the `createReplay(...).sample(t)` pattern — check
`rows`, not just `text`, for the actual per-cell colors present at each `t`).
An app that's still idling in its _default_ state can keep emitting that
default state's frames for as long as it's idle — the fix isn't just a
longer delay before the keypress, it's confirming with real data exactly
when the switch happened, then setting `atMs` past that point, not just past
the shell-announcement frame.

**App needs continuous real interaction** (scrolling, ongoing keypresses) —
prefer recording it live and naturally instead of scripting fake input:

```bash
cd ~/src/tuiexperiments/some-app
../player/bin/record /tmp/my-recording.cast -- bun src/app.ts
```

Interact normally, press `ctrl+x` to drop a chapter marker at good boundaries,
exit when done. If motion needs to read as continuous rather than a slideshow
(e.g. scrolling a document), favor many small input ticks over few large ones
— `bin/build` only keeps frames that actually changed, so a handful of big
jumps produces a handful of frames no matter how long you record. (If an app
truly can't be driven live in this environment, a PTY-forking scripted-input
script is a last resort, not the default path — it's real work to get right
and `tmux send-keys` covers the "a few keys, then self-sustaining" case above
without it.)

### 2. Build the story.json

```bash
cd ~/src/tuiexperiments/player
cp /tmp/my-recording.cast ./my-recording.cast
node bin/build my-recording.cast
```

This generates `my-recording.story.config.json` (a single chapter starting at
`atMs: 0`, running to the end of the cast). **Immediately edit its
`output.story` path** from the default `assets/story.json` to something
recording-specific (e.g. `assets/my-recording.story.json`) — otherwise a
second build run overwrites the repo's shared demo asset. Also edit the
chapter's `atMs`/`durationMs` per "Sanity-check" below before your final
build; re-run with:

```bash
node bin/build my-recording.story.config.json
```

### 3. Sanity-check before shipping it

Scan the frames for anything that'll look wrong once every row is visible
(the player's `fit="cover"` mode fits font size to the box's full height, so
nothing is cropped vertically):

- **A transient shell announcement in frame 0.** `bun run <script>` (i.e.
  `bin/record ... -- bun start`) prints a literal `$ bun src/app.ts` line for
  ~100ms before the real app takes over — a real but useless frame that (since
  it's non-blank) becomes the story's `startIndex`/first-played frame if
  `atMs` is left at `0`. Every recording made this session hit this. Find the
  real start with a throwaway script against the same replay library
  `bin/build` uses (`~/src/tuiexperiments/player/lib/{cast,replay}.mjs`):
  `createReplay(cast, theme).sample(t)` for a few candidate `t` values, and
  look at the returned `text`. Set `atMs` just past wherever real content
  reliably starts.
- **Persistent on-screen chrome** (title bars, borders, HUD labels, an
  instructional side panel) baked into every frame — reads as an unwanted hard
  rectangle, or as a document to read once recolored/legible. Either crop the
  offending row(s)/column(s) (see "Cropping out UI chrome" below) or trim to a
  clean frame range.
- **Exactly-periodic content.** If an animation is a deterministic cycle (a
  fixed number of steps on a fixed timer, no randomness), capturing more than
  one cycle just repeats the same bytes for zero new content — `bin/build`'s
  frame dedup only compares each sample to its immediate predecessor, so it
  won't collapse a second lap on its own. Cap `durationMs` to one cycle (plus
  a little slack); the site's own playback already loops a story's frames
  forever, so nothing is lost. (`anomaly.json`'s 31-treatments-×-100ms cycle
  is the example: an early build captured ~29s uncapped and came out to 24MB;
  capped to one ~3.1s cycle, 472KB — plain white-on-black compresses far
  better than the neon colors that same recording shipped with at first, see
  "Verify the keypress actually landed" above, so this number reflects both
  fixes, not just the cap.)
- **Aspect ratio.** `fit="cover"` sets font size from the box's height alone
  and lets width be whatever `cols * chToEm` comes out to at that font size —
  so if `cols / rows` is too small for the box, it leaves the recording
  floating with dead space and hard-cut edges instead of bleeding off the
  box's edge. The exact threshold is measurable, not a guess: in a browser,
  `chToEm` = a 1ch probe's width at a large font size, divided by that font
  size (typically ~0.6 for a monospace font); `lineToEm` is hardcoded to `1.5`
  in `fitScreenToBox`. The requirement is
  `cols / rows >= (boxWidth / boxHeight) * (lineToEm / chToEm)` — for the
  hero's own bleed box (`boxWidth/boxHeight` ~1.2-1.3) and a typical
  `chToEm` of `0.6`, that's `cols / rows >= ~3.0-3.3`. Re-record wider/shorter
  to fix this, or crop rows (fewer rows raises the ratio without a new
  capture) — **recompute this after any crop**, not just at record time: it's
  about the _shipped_ grid, and cropping columns without also adjusting rows
  can easily take a comfortably-wide recording below the threshold (this is
  exactly what happened cropping `rubiks.json` down to just its cube — see
  below).
- **Real prose/tables in `tone: "inherit"` (mono) mode** — recolors as flat,
  legible-looking streaks rather than ambient texture, _if_ the source colors
  are muted. If the source colors are high-luminance (plain white/bright
  foreground text, which is exactly what a legible terminal UI needs to be
  legible in the first place), luminance recoloring maps that brightness to
  _high_ alpha and it stays just as readable as `tone: "recorded"` would make
  it — recoloring alone does not reliably turn real text into ambient
  texture. Either use `tone: "recorded"` (optionally `background: "recorded"`
  too) so it reads as an actual document/terminal on purpose, or crop the text
  out entirely rather than relying on `tone` to hide it.

#### Cropping out UI chrome

For a fixed-layout app (panels/borders in the same place every frame), you can
crop columns and/or rows out of every frame directly in the built
`story.json`, keeping only the part worth showing. Runs don't align to column
boundaries, so a column crop has to split/trim runs at the boundary, not just
slice `row.slice(startCol, endCol)`:

```js
function sliceRow(row, startCol, endCol) {
  const result = []
  let col = 0
  for (const run of row) {
    const runStart = col
    const runEnd = col + run.t.length
    col = runEnd
    if (runEnd <= startCol || runStart >= endCol) continue
    const sliceStart = Math.max(0, startCol - runStart)
    const sliceEnd = Math.min(run.t.length, endCol - runStart)
    if (sliceStart >= sliceEnd) continue
    result.push({ ...run, t: run.t.slice(sliceStart, sliceEnd) })
  }
  return result
}
// frame.rows = frame.rows.slice(rowStart, rowEnd).map((row) => sliceRow(row, colStart, colEnd))
// s.cols = colEnd - colStart; s.rows = rowEnd - rowStart
```

`rubiks.json` is the example: the recording's own layout is two side-by-side
bordered panels (an instructional step guide on the left, the algorithm
notation + cube on the right), split at a stable column across every frame.
Dropping the left panel (`cols 47-99` of the original 100) removes all of the
prose, but also drops the ratio from a comfortable `100/30 = 3.33` to
`53/30 = 1.77` — well under the ~3.0-3.3 threshold above. Also cropping rows
tightly around just the cube (`rows 8-23`, dropping the header/footer/notation
text too) brings it back to `53/16 = 3.31`. The result is a pure cube with no
text at all, which composes far better under `tone: "inherit"` than the
un-cropped panel did (see "Real prose/tables" above for why `tone` alone
didn't fix it).

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
