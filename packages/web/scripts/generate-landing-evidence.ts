#!/usr/bin/env bun
/**
 * Regenerates the real (not simulated) assets used in the landing page's
 * "what you can build" section (src/pages/index.astro, search "It's not
 * just boxes and text."). Re-run this and diff against those assets
 * whenever the cited source changes.
 *
 *   1. public/audio/{jump,coin,thud}.wav — the exact sine + exponential-
 *      decay synthesis from packages/examples/src/native-audio-demo.ts's
 *      buildMonoPcm16Wav()/PRESETS, reproduced here because that file is a
 *      CLI demo, not an importable module.
 *   2. public/images/dragon-mosaic.svg — a real photograph
 *      (packages/examples/src/assets/dragon.jpg), rendered through
 *      ImageRenderable with protocol: "blocks" exactly as OpenTUI's
 *      terminal fallback path would, captured with createTestRenderer +
 *      captureSpans(), and redrawn as an SVG using the captured colors
 *      cell-for-cell (see QUADRANTS below for the glyph -> sub-cell-color
 *      mapping). Not a filter or a screenshot of a terminal — the actual
 *      colors OpenTUI's renderer computed for this photo.
 *
 * Usage (from packages/web, so @opentui/core resolves to the workspace build):
 *   bun scripts/generate-landing-evidence.ts
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { createTestRenderer } from "@opentui/core/testing"
import { ImageRenderable } from "@opentui/core"

// ---------------------------------------------------------------------------
// 1. Audio SFX WAVs (exact copy of native-audio-demo.ts's synthesis)
// ---------------------------------------------------------------------------
function buildMonoPcm16Wav(options: { frequency: number; durationMs: number; amplitude: number; decay: number }) {
  const sampleRate = 48000
  const sampleCount = Math.max(1, Math.floor((sampleRate * options.durationMs) / 1000))
  const dataSize = sampleCount * 2
  const out = new Uint8Array(44 + dataSize)
  const view = new DataView(out.buffer)

  out.set([0x52, 0x49, 0x46, 0x46], 0)
  view.setUint32(4, out.length - 8, true)
  out.set([0x57, 0x41, 0x56, 0x45], 8)
  out.set([0x66, 0x6d, 0x74, 0x20], 12)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  out.set([0x64, 0x61, 0x74, 0x61], 36)
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate
    const envelope = Math.pow(Math.max(0, 1 - i / sampleCount), options.decay)
    const value = Math.sin(2 * Math.PI * options.frequency * t) * options.amplitude * envelope
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true)
  }
  return out
}

// Exact PRESETS entries from native-audio-demo.ts; amplitude 0.95 is from
// that file's PRESETS.map(...) call site.
const SFX_PRESETS = [
  { name: "jump", frequency: 540, durationMs: 120, decay: 0.82 },
  { name: "coin", frequency: 980, durationMs: 90, decay: 0.86 },
  { name: "thud", frequency: 140, durationMs: 200, decay: 0.75 },
]

function writeAudioAssets() {
  const outDir = join(import.meta.dir, "../public/audio")
  mkdirSync(outDir, { recursive: true })
  for (const preset of SFX_PRESETS) {
    const wav = buildMonoPcm16Wav({ ...preset, amplitude: 0.95 })
    writeFileSync(join(outDir, `${preset.name}.wav`), wav)
    console.log(`wrote public/audio/${preset.name}.wav (${wav.length} bytes)`)
  }
}

// ---------------------------------------------------------------------------
// 2. Real photograph -> blocks-protocol mosaic (SVG)
// ---------------------------------------------------------------------------
// [topLeft, topRight, bottomLeft, bottomRight]; true = fg, false = bg.
// The full Unicode "block elements" quadrant set, matching
// packages/core/src/zig/buffer.zig's quadrantChars table.
const QUADRANTS: Record<string, [boolean, boolean, boolean, boolean]> = {
  " ": [false, false, false, false],
  "\u2598": [true, false, false, false], // ▘ upper left
  "\u259D": [false, true, false, false], // ▝ upper right
  "\u2596": [false, false, true, false], // ▖ lower left
  "\u2597": [false, false, false, true], // ▗ lower right
  "\u2580": [true, true, false, false], // ▀ upper half
  "\u2584": [false, false, true, true], // ▄ lower half
  "\u258C": [true, false, true, false], // ▌ left half
  "\u2590": [false, true, false, true], // ▐ right half
  "\u259A": [true, false, false, true], // ▚ diagonal
  "\u259E": [false, true, true, false], // ▞ diagonal
  "\u2599": [true, false, true, true], // ▙
  "\u259B": [true, true, true, false], // ▛
  "\u259C": [true, true, false, true], // ▜
  "\u259F": [false, true, true, true], // ▟
  "\u2588": [true, true, true, true], // █ full
}

async function writeImageMosaic() {
  const cols = 84
  const rows = 42
  const { renderer, renderOnce, captureSpans } = await createTestRenderer({ width: cols, height: rows })

  const source = join(import.meta.dir, "../../examples/src/assets/dragon.jpg")
  const img = new ImageRenderable(renderer, {
    id: "img",
    source,
    width: cols,
    height: rows,
    fit: "cover",
    protocol: "blocks",
  })
  renderer.root.add(img)
  await img.loadPromise
  await renderOnce()
  await renderOnce()

  const spans = captureSpans()
  const toHex = (r: number, g: number, b: number) =>
    `#${[r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`

  const px: string[][] = Array.from({ length: rows * 2 }, () => Array(cols * 2).fill("#000000"))
  const unmapped = new Set<string>()

  for (let r = 0; r < spans.lines.length; r++) {
    const line = spans.lines[r]
    let c = 0
    for (const span of line.spans) {
      const fgHex = toHex(span.fg.r, span.fg.g, span.fg.b)
      const bgHex = toHex(span.bg.r, span.bg.g, span.bg.b)
      for (const ch of span.text) {
        const q = QUADRANTS[ch]
        if (!q) unmapped.add(ch)
        const [tl, tr, bl, br] = q ?? [false, false, false, false]
        const y = r * 2
        const x = c * 2
        if (y < px.length && x < px[0].length) {
          px[y][x] = tl ? fgHex : bgHex
          px[y][x + 1] = tr ? fgHex : bgHex
          px[y + 1][x] = bl ? fgHex : bgHex
          px[y + 1][x + 1] = br ? fgHex : bgHex
        }
        c += 1
      }
    }
  }
  if (unmapped.size) {
    console.warn(
      "WARNING: unmapped glyphs in image capture:",
      [...unmapped].map((c) => c.codePointAt(0)?.toString(16)),
    )
  }

  const cell = 4
  const svgW = cols * 2 * cell
  const svgH = rows * 2 * cell
  // Merge adjacent same-color pixels in each row into wider rects to keep
  // the SVG small; dragon.jpg has large enough flat-ish regions for this to
  // help a lot without losing per-cell accuracy (it's still one <rect> per
  // distinct run, not an approximation).
  let rects = ""
  for (let y = 0; y < px.length; y++) {
    let x = 0
    while (x < px[y].length) {
      const color = px[y][x]
      let x2 = x + 1
      while (x2 < px[y].length && px[y][x2] === color) x2 += 1
      rects += `<rect x="${x * cell}" y="${y * cell}" width="${(x2 - x) * cell}" height="${cell}" fill="${color}"/>`
      x = x2
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" shape-rendering="crispEdges">${rects}</svg>`

  const outDir = join(import.meta.dir, "../public/images")
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, "dragon-mosaic.svg")
  writeFileSync(outPath, svg)
  console.log(`wrote public/images/dragon-mosaic.svg (${svg.length} bytes, ${cols}x${rows} cells, ${svgW}x${svgH}px)`)
}

writeAudioAssets()
await writeImageMosaic()
process.exit(0)
