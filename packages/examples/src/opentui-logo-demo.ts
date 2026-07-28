import {
  BoxRenderable,
  CliRenderEvents,
  type CliRenderer,
  type KeyEvent,
  ScrollBoxRenderable,
  type Selection,
  StyledText,
  TextAttributes,
  TextRenderable,
  type ThemeMode,
  createCliRenderer,
  fg,
} from "@opentui/core"

import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

interface LogoVariant {
  name: string
  category: string
  content: string
  note: string
}

interface MatrixStyle {
  name: string
  matrix: PixelMatrix
}

interface LogoCategory {
  name: string
  description: string
  includes: (item: LogoVariant, index: number) => boolean
}

interface PlaybackSpeed {
  name: string
  interval: number
}

type PixelMatrix = boolean[][]

export type LogoAnimationKind = "typeset" | "combine" | "invert" | "braille" | "pack" | "trace" | "density" | "build"

interface DemoPalette {
  border: string
  strongBorder: string
  text: string
  mutedText: string
  subtleText: string
  accent: string
  warning: string
  success: string
  spectrum: readonly string[]
}

const DARK_PALETTE: DemoPalette = {
  border: "#252A34",
  strongBorder: "#343B49",
  text: "#F8FAFC",
  mutedText: "#8B949E",
  subtleText: "#667085",
  accent: "#748FFC",
  warning: "#FFE066",
  success: "#69DB7C",
  spectrum: ["#FF6B6B", "#FFA94D", "#FFE066", "#69DB7C", "#4DABF7", "#748FFC", "#DA77F2"],
}

const LIGHT_PALETTE: DemoPalette = {
  border: "#D5DBE5",
  strongBorder: "#B8C1CF",
  text: "#172033",
  mutedText: "#526077",
  subtleText: "#6B7280",
  accent: "#4056B4",
  warning: "#8A5A00",
  success: "#18794E",
  spectrum: ["#C92A2A", "#C45D00", "#8A6500", "#18794E", "#1971C2", "#4056B4", "#9C36B5"],
}

let palette = DARK_PALETTE
const WORD = "OPENTUI"
const ORIGINAL_LOGO = ["▄▄▄ ▄▄▄ ▄▄▄ ▄▄  █▄▄ ▄ ▄ ▄", "█ █ █ █ █ ▀ █ █ █ ▄ █ █ █", "▀▀▀ █▀▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀ ▀"].join("\n")
const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = [
  { name: "Slow", interval: 1500 },
  { name: "Normal", interval: 750 },
  { name: "Fast", interval: 200 },
  { name: "Faster", interval: 100 },
  { name: "Fastest", interval: 50 },
]
const ANIMATION_LABELS: Readonly<Record<LogoAnimationKind, string>> = {
  typeset: "italic → roman",
  combine: "add combining marks",
  invert: "flip polarity",
  braille: "set Braille dots",
  pack: "pack subcells",
  trace: "trace connections",
  density: "condense shades",
  build: "set half-cells",
}
const ANIMATION_DURATIONS: Readonly<Record<LogoAnimationKind, number>> = {
  typeset: 460,
  combine: 560,
  invert: 520,
  braille: 720,
  pack: 640,
  trace: 820,
  density: 620,
  build: 720,
}
const ANIMATION_STAGGER: Readonly<Record<LogoAnimationKind, readonly [spread: number, activeDuration: number]>> = {
  typeset: [0.28, 0.56],
  combine: [0.38, 0.54],
  invert: [0.32, 0.54],
  braille: [0.34, 0.58],
  pack: [0.3, 0.58],
  trace: [0.45, 0.5],
  density: [0.32, 0.56],
  build: [0.32, 0.56],
}

const TINY_FONT: Record<string, readonly string[]> = {
  O: ["111", "101", "101", "101", "101", "111"],
  P: ["110", "101", "110", "100", "100", "100"],
  E: ["111", "100", "110", "100", "100", "111"],
  N: ["101", "101", "111", "111", "101", "101"],
  T: ["111", "010", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "101", "111"],
  I: ["111", "010", "010", "010", "010", "111"],
}

const MICRO_FONTS: ReadonlyArray<Record<string, readonly string[]>> = [
  {
    O: ["11", "10", "01", "11"],
    P: ["11", "11", "10", "10"],
    E: ["11", "10", "10", "11"],
    N: ["10", "11", "11", "01"],
    T: ["11", "01", "01", "01"],
    U: ["10", "10", "10", "11"],
    I: ["11", "01", "01", "11"],
  },
  {
    O: ["01", "10", "10", "01"],
    P: ["11", "10", "11", "10"],
    E: ["11", "10", "11", "11"],
    N: ["10", "11", "11", "01"],
    T: ["11", "01", "01", "01"],
    U: ["10", "10", "10", "01"],
    I: ["11", "01", "01", "11"],
  },
]

const HALF_CELL_SETS = [
  ["Half blocks", [" ", "▀", "▄", "█"]],
  ["Heavy stems", [" ", "╹", "╻", "┃"]],
  ["Thin stems", [" ", "╵", "╷", "│"]],
  ["Double stems", [" ", "╵", "╷", "║"]],
  ["Left blocks", [" ", "▘", "▖", "▌"]],
  ["Right blocks", [" ", "▝", "▗", "▐"]],
  ["Triangles", [" ", "▲", "▼", "◆"]],
  ["Small triangles", [" ", "▴", "▾", "♦"]],
  ["ASCII marks", [" ", "'", ".", ":"]],
  ["ASCII strokes", [" ", "^", "_", "|"]],
  ["Shade levels", [" ", "░", "▒", "▓"]],
  ["Squares", [" ", "▪", "▫", "■"]],
  ["Circles", [" ", "•", "◦", "●"]],
  ["Diamonds", [" ", "◢", "◤", "◆"]],
  ["Math marks", [" ", "˄", "˅", "×"]],
] as const

const QUADRANTS = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"]
const SEXTANT_EXISTING = new Map<number, string>([
  [0x00, " "],
  [0x15, "▌"],
  [0x2a, "▐"],
  [0x3f, "█"],
])
const OCTANT_EXISTING = new Map<number, string>([
  [0x00, " "],
  [0x01, "𜺨"],
  [0x02, "𜺫"],
  [0x03, "🮂"],
  [0x05, "▘"],
  [0x0a, "▝"],
  [0x0f, "▀"],
  [0x14, "🯦"],
  [0x28, "🯧"],
  [0x3f, "🮅"],
  [0x40, "𜺣"],
  [0x50, "▖"],
  [0x55, "▌"],
  [0x5a, "▞"],
  [0x5f, "▛"],
  [0x80, "𜺠"],
  [0xa0, "▗"],
  [0xa5, "▚"],
  [0xaa, "▐"],
  [0xaf, "▜"],
  [0xc0, "▂"],
  [0xf0, "▄"],
  [0xf5, "▙"],
  [0xfa, "▟"],
  [0xfc, "▆"],
  [0xff, "█"],
])

const WORDMARKS = [
  ["Seven plain cells", "OpenTUI"],
  ["Seven uppercase cells", "OPENTUI"],
  ["Seven lowercase cells", "opentui"],
  ["Small capitals", "ᴏᴘᴇɴᴛᴜɪ"],
  ["Fullwidth", "ＯＰＥＮＴＵＩ"],
  ["Circled", "ⓄⓅⒺⓃⓉⓊⒾ"],
  ["Squared", "🄾🄿🄴🄽🅃🅄🄸"],
  ["Monospace math", "𝙾𝙿𝙴𝙽𝚃𝚄𝙸"],
  ["Double-struck", "𝕆ℙ𝔼ℕ𝕋𝕌𝕀"],
  ["Leetspeak", "0P3N7U1"],
  ["Geometric", "○PΞN┬∪I"],
  ["Command", ">_opentui"],
  ["Namespace", "OPEN::TUI"],
  ["Path", "open/tui"],
  ["Prompt", "$ opentui"],
  ["Bracketed", "[OpenTUI]"],
  ["Terminal tab", "┤OpenTUI├"],
] as const

function buildMatrix(font: Record<string, readonly string[]>, spacing: number): PixelMatrix {
  const height = font.O!.length
  const rows: PixelMatrix = Array.from({ length: height }, () => [])
  for (const [letterIndex, letter] of [...WORD].entries()) {
    const glyph = font[letter]!
    for (let row = 0; row < height; row++) {
      if (letterIndex > 0) rows[row]!.push(...Array<boolean>(spacing).fill(false))
      rows[row]!.push(...[...glyph[row]!].map((pixel) => pixel === "1"))
    }
  }
  return rows
}

function shear(matrix: PixelMatrix, direction: number): PixelMatrix {
  const offsets = matrix.map((_row, y) => Math.floor(y / 2) * direction)
  const left = Math.min(...offsets)
  const right = Math.max(...offsets)
  const width = matrix[0]!.length + right - left
  return matrix.map((row, y) => {
    const output = Array<boolean>(width).fill(false)
    const offset = offsets[y]! - left
    row.forEach((pixel, x) => (output[x + offset] = pixel))
    return output
  })
}

function stencil(matrix: PixelMatrix, period: number): PixelMatrix {
  return matrix.map((row, y) => row.map((pixel, x) => pixel && (x + y * 2) % period !== 0))
}

function shadow(matrix: PixelMatrix): PixelMatrix {
  return matrix.map((row, y) => row.map((pixel, x) => pixel || (matrix[y - 1]?.[x - 1] ?? false)))
}

function outline(matrix: PixelMatrix): PixelMatrix {
  return matrix.map((row, y) =>
    row.map((pixel, x) => {
      if (!pixel) return false
      return !(matrix[y - 1]?.[x] && matrix[y + 1]?.[x] && matrix[y]?.[x - 1] && matrix[y]?.[x + 1])
    }),
  )
}

function matrixStyles(): MatrixStyle[] {
  const tracked = buildMatrix(TINY_FONT, 1)
  const tight = buildMatrix(TINY_FONT, 0)
  return [
    { name: "tracked", matrix: tracked },
    { name: "tight", matrix: tight },
    { name: "forward slant", matrix: shear(tracked, 1) },
    { name: "back slant", matrix: shear(tracked, -1) },
    { name: "tight forward slant", matrix: shear(tight, 1) },
    { name: "stencil two", matrix: stencil(tracked, 2) },
    { name: "stencil three", matrix: stencil(tracked, 3) },
    { name: "diagonal shadow", matrix: shadow(tracked) },
    { name: "outline", matrix: outline(tracked) },
  ]
}

function renderHalfCells(matrix: PixelMatrix, glyphs: readonly string[], invert = false): string {
  const lines: string[] = []
  for (let y = 0; y < matrix.length; y += 2) {
    let line = ""
    for (let x = 0; x < matrix[0]!.length; x++) {
      const top = matrix[y]?.[x] ?? false
      const bottom = matrix[y + 1]?.[x] ?? false
      const mask = (top ? 1 : 0) | (bottom ? 2 : 0)
      line += glyphs[invert ? 3 - mask : mask]
    }
    lines.push(line.trimEnd())
  }
  return lines.join("\n")
}

function renderQuadrants(matrix: PixelMatrix, invert = false): string {
  const lines: string[] = []
  for (let y = 0; y < matrix.length; y += 2) {
    let line = ""
    for (let x = 0; x < matrix[0]!.length; x += 2) {
      const mask =
        (matrix[y]?.[x] ? 1 : 0) |
        (matrix[y]?.[x + 1] ? 2 : 0) |
        (matrix[y + 1]?.[x] ? 4 : 0) |
        (matrix[y + 1]?.[x + 1] ? 8 : 0)
      line += QUADRANTS[invert ? 15 - mask : mask]
    }
    lines.push(line.trimEnd())
  }
  return lines.join("\n")
}

function renderBraille(matrix: PixelMatrix, invert = false): string {
  const dots = [
    [0, 0, 0],
    [0, 1, 1],
    [0, 2, 2],
    [1, 0, 3],
    [1, 1, 4],
    [1, 2, 5],
    [0, 3, 6],
    [1, 3, 7],
  ] as const
  const lines: string[] = []
  for (let y = 0; y < matrix.length; y += 4) {
    let line = ""
    for (let x = 0; x < matrix[0]!.length; x += 2) {
      let mask = 0
      for (const [dx, dy, bit] of dots) {
        if ((matrix[y + dy]?.[x + dx] ?? false) !== invert) mask |= 1 << bit
      }
      line += String.fromCodePoint(0x2800 + mask)
    }
    lines.push(line.trimEnd())
  }
  return lines.join("\n")
}

function compressToFourRows(matrix: PixelMatrix, method: "merge" | "sample"): PixelMatrix {
  if (matrix.length !== 6) throw new Error(`Expected a six-row matrix, received ${matrix.length}`)
  if (method === "sample") return [matrix[0]!, matrix[2]!, matrix[3]!, matrix[5]!].map((row) => [...row])
  return [
    [...matrix[0]!],
    matrix[1]!.map((pixel, x) => pixel || matrix[2]![x]!),
    matrix[3]!.map((pixel, x) => pixel || matrix[4]![x]!),
    [...matrix[5]!],
  ]
}

function renderHorizontalPairs(matrix: PixelMatrix, invert = false): string {
  const glyphs = [" ", "▌", "▐", "█"]
  return matrix
    .map((row) => {
      let line = ""
      for (let x = 0; x < row.length; x += 2) {
        const mask = (row[x] ? 1 : 0) | (row[x + 1] ? 2 : 0)
        line += glyphs[invert ? 3 - mask : mask]
      }
      return line.trimEnd()
    })
    .join("\n")
}

function mosaicGlyph(mask: number, bits: number, start: number, existing: Map<number, string>): string {
  const maximum = (1 << bits) - 1
  if (mask < 0 || mask > maximum) throw new RangeError(`Invalid ${bits}-bit mosaic mask: ${mask}`)
  const assigned = existing.get(mask)
  if (assigned !== undefined) return assigned
  const omittedBefore = [...existing.keys()].filter((omitted) => omitted < mask).length
  return String.fromCodePoint(start + mask - omittedBefore)
}

function renderMosaic(matrix: PixelMatrix, cellHeight: 3 | 4, invert = false): string {
  const bitCount = cellHeight * 2
  const maximum = (1 << bitCount) - 1
  const lines: string[] = []
  for (let y = 0; y < matrix.length; y += cellHeight) {
    let line = ""
    for (let x = 0; x < matrix[0]!.length; x += 2) {
      let mask = 0
      for (let dy = 0; dy < cellHeight; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (matrix[y + dy]?.[x + dx]) mask |= 1 << (dy * 2 + dx)
        }
      }
      if (invert) mask = maximum - mask
      line +=
        cellHeight === 3
          ? mosaicGlyph(mask, 6, 0x1fb00, SEXTANT_EXISTING)
          : mosaicGlyph(mask, 8, 0x1cd00, OCTANT_EXISTING)
    }
    lines.push(line.trimEnd())
  }
  return lines.join("\n")
}

function renderConnectedLines(matrix: PixelMatrix, weight: "light" | "heavy" | "double"): string {
  const glyphSets = {
    light: ["•", "╵", "╴", "┘", "╷", "│", "┐", "┤", "╶", "└", "─", "┴", "┌", "├", "┬", "┼"],
    heavy: ["▪", "╹", "╸", "┛", "╻", "┃", "┓", "┫", "╺", "┗", "━", "┻", "┏", "┣", "┳", "╋"],
    double: ["◆", "║", "═", "╝", "║", "║", "╗", "╣", "═", "╚", "═", "╩", "╔", "╠", "╦", "╬"],
  } as const
  const glyphs = glyphSets[weight]
  return matrix
    .map((row, y) =>
      row
        .map((active, x) => {
          if (!active) return " "
          const mask =
            (matrix[y - 1]?.[x] ? 1 : 0) |
            (matrix[y]?.[x - 1] ? 2 : 0) |
            (matrix[y + 1]?.[x] ? 4 : 0) |
            (matrix[y]?.[x + 1] ? 8 : 0)
          return glyphs[mask]
        })
        .join("")
        .trimEnd(),
    )
    .join("\n")
}

function variant(name: string, category: string, content: string, note: string): LogoVariant {
  return { name, category, content, note }
}

export function logoAnimationKind(item: Pick<LogoVariant, "name" | "category">): LogoAnimationKind {
  if (item.name.startsWith("Combining")) return "combine"
  if (item.name.startsWith("Inverse") || item.name.includes(" inverse")) return "invert"
  if (item.name.includes("Braille") || item.name.startsWith("Semantic")) return "braille"
  if (
    item.category === "One row / typography" ||
    item.category === "One-cell capability probes" ||
    item.name.includes("slant")
  )
    return "typeset"
  if (item.category === "Connected stroke topology") return "trace"
  if (item.category === "Legacy mosaics / two rows" || item.category.includes("half width")) return "pack"
  if (/shade|density|solid/i.test(item.name)) return "density"
  return "build"
}

export function logoAnimationDuration(kind: LogoAnimationKind): number {
  return ANIMATION_DURATIONS[kind]
}

export function logoAnimationProgress(elapsed: number, duration: number): number {
  return Math.max(0, Math.min(1, elapsed / duration))
}

export function shouldAutoPlayLogoAnimation(options: {
  enabled: boolean
  previousIndex: number
  nextIndex: number
  isPlaying: boolean
  scrollMode: boolean
  hasComparison: boolean
}): boolean {
  return (
    options.enabled &&
    options.previousIndex !== options.nextIndex &&
    (options.isPlaying || (!options.scrollMode && !options.hasComparison))
  )
}

function remapOriginal(
  replacements: Readonly<Record<string, string>>,
  transform?: (character: string, row: number, column: number) => string,
): string {
  return ORIGINAL_LOGO.split("\n")
    .map((line, row) =>
      [...line]
        .map((character, column) => transform?.(character, row, column) ?? replacements[character] ?? character)
        .join("")
        .trimEnd(),
    )
    .join("\n")
}

function inverseOriginal(fill = "█"): string {
  const width = Math.max(...ORIGINAL_LOGO.split("\n").map((line) => [...line].length))
  const inverse: Readonly<Record<string, string>> = { " ": fill, "▀": "▄", "▄": "▀", "█": " " }
  return ORIGINAL_LOGO.split("\n")
    .map((line) => [...line.padEnd(width)].map((character) => inverse[character] ?? character).join(""))
    .join("\n")
}

function originalShadow(glyph: string, offset = 0, spread = 0): string {
  const lines = ORIGINAL_LOGO.split("\n").map((line) => [...line])
  const width = Math.max(...lines.map((line) => line.length))
  const footprint = Array.from({ length: width }, (_, column) => lines.some((line) => line[column] !== " "))
  const shadow = footprint
    .map((_, column) =>
      footprint.some((active, sourceColumn) => active && Math.abs(sourceColumn - column) <= spread) ? glyph : " ",
    )
    .join("")
    .trimEnd()
  return `${" ".repeat(offset)}${shadow}`
}

function buildVariants(): LogoVariant[] {
  const variants = [
    variant("Original six-pixel alphabet", "Three rows", ORIGINAL_LOGO, "3 rows × 27 columns. The HEAD concept."),
  ]

  variants.push(
    variant(
      "Lower-eighth contact shadow",
      "Original shadow studies",
      `${ORIGINAL_LOGO}\n${originalShadow("▁")}`,
      "#001 unchanged, grounded by a one-eighth block projection directly below each letter.",
    ),
    variant(
      "Braille lower-dot shadow",
      "Original shadow studies",
      `${ORIGINAL_LOGO}\n${originalShadow("⣀")}`,
      "#001 unchanged, with Braille dots 7 and 8 forming a fine baseline shadow.",
    ),
    variant(
      "Offset Braille stipple",
      "Original shadow studies",
      `${ORIGINAL_LOGO}\n${originalShadow("⠤", 1)}`,
      "#001 unchanged, with a one-cell rightward cast made from sparse Braille dots.",
    ),
    variant(
      "Soft expanded floor shadow",
      "Original shadow studies",
      `${ORIGINAL_LOGO}\n${originalShadow("░", 1, 1)}`,
      "#001 unchanged, with a widened light-shade projection creating a soft floor plane.",
    ),
    variant(
      "Two-step falling shadow",
      "Original shadow studies",
      `${ORIGINAL_LOGO}\n${originalShadow("▒", 1)}\n${originalShadow("░", 2, 1)}`,
      "#001 unchanged, with a denser contact row fading down and to the right.",
    ),
  )

  const styles = matrixStyles()
  for (const [setName, glyphs] of HALF_CELL_SETS) {
    for (const style of styles.slice(0, 5)) {
      variants.push(
        variant(
          `${setName}, ${style.name}`,
          "Three rows",
          renderHalfCells(style.matrix, glyphs),
          `6-pixel alphabet packed vertically with ${glyphs.slice(1).join(" ")}; ${style.name}.`,
        ),
      )
    }
  }

  for (const style of styles) {
    variants.push(
      variant(
        `Quadrants, ${style.name}`,
        "Three rows / half width",
        renderQuadrants(style.matrix),
        `Four source pixels per cell; ${style.name}.`,
      ),
      variant(
        `Inverse quadrants, ${style.name}`,
        "Three rows / half width",
        renderQuadrants(style.matrix, true),
        `Negative-space quadrant packing; ${style.name}.`,
      ),
    )
  }

  for (const style of styles) {
    variants.push(
      variant(
        `Braille, ${style.name}`,
        "Two rows / half width",
        renderBraille(style.matrix),
        `Eight source pixels per terminal cell; ${style.name}.`,
      ),
      variant(
        `Inverse Braille, ${style.name}`,
        "Two rows / half width",
        renderBraille(style.matrix, true),
        `Negative-space eight-dot packing; ${style.name}.`,
      ),
    )
  }

  for (const [index, font] of MICRO_FONTS.entries()) {
    const micro = buildMatrix(font, 0)
    variants.push(
      variant(
        `Braille microfont ${index + 1}`,
        "One row / seven cells",
        renderBraille(micro),
        "A custom 2×4 alphabet: every complete letter occupies one Braille cell.",
      ),
      variant(
        `Inverse Braille microfont ${index + 1}`,
        "One row / seven cells",
        renderBraille(micro, true),
        "The same seven-cell wordmark carved out of full Braille cells.",
      ),
    )
  }

  for (const style of styles.slice(0, 5)) {
    variants.push(
      variant(
        `Side-packed, ${style.name}`,
        "Six rows / half width",
        renderHorizontalPairs(style.matrix),
        `Two horizontal pixels per cell using left and right half blocks; ${style.name}.`,
      ),
      variant(
        `Inverse side-packed, ${style.name}`,
        "Six rows / half width",
        renderHorizontalPairs(style.matrix, true),
        `Negative-space horizontal packing; ${style.name}.`,
      ),
    )
  }

  for (const [name, content] of WORDMARKS) {
    variants.push(variant(name, "One row / typography", content, "A direct one-row terminal wordmark."))
  }

  const originalBlockStudies: ReadonlyArray<readonly [string, Readonly<Record<string, string>>, string]> = [
    ["Dark-shade cores", { "█": "▓" }, "Only full blocks become dark shade; half-block contours remain unchanged."],
    ["Medium-shade cores", { "█": "▒" }, "Only full blocks become medium shade."],
    ["Light-shade cores", { "█": "░" }, "Only full blocks become light shade."],
    ["Dark-shade lower cells", { "▄": "▓" }, "Lower half blocks become dark-shade cells."],
    ["Dark-shade upper cells", { "▀": "▓" }, "Upper half blocks become dark-shade cells."],
    ["Dark-shade half cells", { "▀": "▓", "▄": "▓" }, "Both half-block contours become dark shade."],
    ["Medium-shade half cells", { "▀": "▒", "▄": "▒" }, "Both half-block contours become medium shade."],
    ["Light-shade half cells", { "▀": "░", "▄": "░" }, "Both half-block contours become light shade."],
    [
      "Dark-shade silhouette",
      { "▀": "▓", "▄": "▓", "█": "▓" },
      "The exact #001 silhouette rendered entirely with dark shade.",
    ],
    [
      "Medium-shade silhouette",
      { "▀": "▒", "▄": "▒", "█": "▒" },
      "The exact #001 silhouette rendered entirely with medium shade.",
    ],
    [
      "Light-shade silhouette",
      { "▀": "░", "▄": "░", "█": "░" },
      "The exact #001 silhouette rendered entirely with light shade.",
    ],
    [
      "One-eighth edges",
      { "▀": "▔", "▄": "▁" },
      "Half blocks collapse to the thinnest upper and lower Block Element edges.",
    ],
    ["Lower-quarter edges", { "▀": "▔", "▄": "▂" }, "Hairline tops paired with two-eighth lower blocks."],
    ["Lower-three-eighth edges", { "▀": "▔", "▄": "▃" }, "Hairline tops paired with three-eighth lower blocks."],
    ["Asymmetric heavy edges", { "▀": "▀", "▄": "▆" }, "Upper halves paired with six-eighth lower blocks."],
    ["Near-solid lower edges", { "▀": "▀", "▄": "▇" }, "Upper halves paired with seven-eighth lower blocks."],
    [
      "Thin horizontal strokes",
      { "▀": "▔", "▄": "▁", "█": "━" },
      "All three block states become thin or heavy horizontal strokes.",
    ],
    ["Left-half rotation", { "▀": "▌", "▄": "▐" }, "The same cell map rotated into opposing left and right halves."],
    ["Right-half rotation", { "▀": "▐", "▄": "▌" }, "The opposing horizontal half-block rotation."],
    [
      "Left quadrant stack",
      { "▀": "▘", "▄": "▖", "█": "▌" },
      "Each source cell is narrowed to its left-hand quadrants.",
    ],
    [
      "Right quadrant stack",
      { "▀": "▝", "▄": "▗", "█": "▐" },
      "Each source cell is narrowed to its right-hand quadrants.",
    ],
    ["Diagonal falling", { "▀": "▝", "▄": "▖", "█": "▞" }, "Half cells become a top-right to bottom-left diagonal."],
    ["Diagonal rising", { "▀": "▘", "▄": "▗", "█": "▚" }, "Half cells become a top-left to bottom-right diagonal."],
    [
      "Upper corner cuts",
      { "▀": "▛", "▄": "▙", "█": "█" },
      "Three-quarter quadrant blocks introduce right-side notches.",
    ],
    [
      "Opposite corner cuts",
      { "▀": "▜", "▄": "▟", "█": "█" },
      "Three-quarter quadrant blocks introduce left-side notches.",
    ],
    ["Square texture", { "▀": "▪", "▄": "▫", "█": "■" }, "Half and full blocks become a three-weight square texture."],
    ["Round texture", { "▀": "•", "▄": "◦", "█": "●" }, "Half and full blocks become a three-weight circular texture."],
    ["Diamond texture", { "▀": "◢", "▄": "◤", "█": "◆" }, "Half and full blocks become directional diamond fragments."],
    ["Triangular caps", { "▀": "▲", "▄": "▼", "█": "◆" }, "Upper and lower cells become opposing triangular caps."],
    [
      "Outlined geometry",
      { "▀": "△", "▄": "▽", "█": "◇" },
      "An airy outlined counterpart to the triangular treatment.",
    ],
  ]

  for (const [name, replacements, note] of originalBlockStudies) {
    variants.push(variant(name, "Original block studies", remapOriginal(replacements), note))
  }

  variants.push(
    variant(
      "Solid inverse",
      "Original block studies",
      inverseOriginal(),
      "The exact #001 cell mask reversed against full blocks.",
    ),
    variant(
      "Dark-shade inverse",
      "Original block studies",
      inverseOriginal("▓"),
      "The exact #001 cell mask reversed against dark shade.",
    ),
    variant(
      "Medium-shade inverse",
      "Original block studies",
      inverseOriginal("▒"),
      "The exact #001 cell mask reversed against medium shade.",
    ),
    variant(
      "Light-shade inverse",
      "Original block studies",
      inverseOriginal("░"),
      "The exact #001 cell mask reversed against light shade.",
    ),
    variant(
      "Alternating block density",
      "Original block studies",
      remapOriginal({}, (character, row, column) => {
        if (character === " ") return character
        return (row + column) % 2 === 0 ? character : character === "█" ? "▓" : character
      }),
      "Every second full cell is dark shade; geometry remains identical.",
    ),
    variant(
      "Horizontal density bands",
      "Original block studies",
      remapOriginal({}, (character, row) => {
        if (character === " " || row === 0) return character
        if (row === 1) return character === "█" ? "▓" : character
        return character === "█" ? "▒" : character
      }),
      "Full blocks fade from solid to dark and medium shade across the three rows.",
    ),
    variant(
      "Vertical density sweep",
      "Original block studies",
      remapOriginal({}, (character, _row, column) => {
        if (character !== "█") return character
        return ["█", "▓", "▒", "░"][Math.floor((column * 4) / 27) % 4]!
      }),
      "Full blocks sweep through all four terminal density levels from left to right.",
    ),
    variant(
      "Checker quadrants",
      "Original block studies",
      remapOriginal({}, (character, row, column) => {
        if (character === " ") return character
        if (character === "█") return (row + column) % 2 ? "▞" : "▚"
        return character === "▀" ? ((row + column) % 2 ? "▝" : "▘") : (row + column) % 2 ? "▖" : "▗"
      }),
      "Each source block is reduced to alternating diagonal quadrants.",
    ),
  )

  for (const style of styles) {
    variants.push(
      variant(
        `Sextant mosaic, ${style.name}`,
        "Legacy mosaics / two rows",
        renderMosaic(style.matrix, 3),
        `Unicode 13 solid 2×3-cell packing; ${style.name}. Font support varies by terminal.`,
      ),
      variant(
        `Inverse sextant mosaic, ${style.name}`,
        "Legacy mosaics / two rows",
        renderMosaic(style.matrix, 3, true),
        `Negative-space Unicode 13 sextant packing; ${style.name}.`,
      ),
      variant(
        `Octant mosaic, ${style.name}`,
        "Legacy mosaics / two rows",
        renderMosaic(style.matrix, 4),
        `Unicode 16 solid 2×4-cell packing; ${style.name}. Experimental font-support probe.`,
      ),
      variant(
        `Inverse octant mosaic, ${style.name}`,
        "Legacy mosaics / two rows",
        renderMosaic(style.matrix, 4, true),
        `Negative-space Unicode 16 octant packing; ${style.name}. Experimental font-support probe.`,
      ),
    )
  }

  for (const style of styles.slice(0, 5)) {
    for (const weight of ["light", "heavy", "double"] as const) {
      variants.push(
        variant(
          `${weight} connected strokes, ${style.name}`,
          "Connected stroke topology",
          renderConnectedLines(style.matrix, weight),
          `Neighbor-aware ${weight} box-drawing paths; ${style.name}.`,
        ),
      )
    }
  }

  const capabilityWordmarks = [
    ["Semantic Braille", "⠕⠏⠑⠝⠞⠥⠊", "The literal lowercase word opentui in standard uncontracted Braille."],
    ["Semantic uppercase Braille", "⠠⠠⠕⠏⠑⠝⠞⠥⠊", "The standard all-capital Braille indicator followed by opentui."],
    [
      "Unicode 16 outlined Latin",
      "𜳤𜳥𜳚𜳣𜳩𜳪𜳞",
      "Seven Unicode 16 outlined capital letters; experimental font-support probe.",
    ],
    ["Combining underline", "O̲P̲E̲N̲T̲U̲I̲", "ASCII letters with zero-width combining low lines."],
    ["Combining overline", "O̅P̅E̅N̅T̅U̅I̅", "ASCII letters with zero-width combining overlines."],
    ["Combining double overline", "O̿P̿E̿N̿T̿U̿I̿", "ASCII letters with zero-width combining double overlines."],
    ["Combining strike", "O̶P̶E̶N̶T̶U̶I̶", "ASCII letters with combining long-stroke overlays."],
    ["Combining slash", "O̸P̸E̸N̸T̸U̸I̸", "ASCII letters with combining solidus overlays."],
    ["Combining circles", "O⃝P⃝E⃝N⃝T⃝U⃝I⃝", "ASCII letters with combining enclosing circles."],
    ["Combining squares", "O⃞P⃞E⃞N⃞T⃞U⃞I⃞", "ASCII letters with combining enclosing squares."],
    ["Combining diamonds", "O⃟P⃟E⃟N⃟T⃟U⃟I⃟", "ASCII letters with combining enclosing diamonds."],
  ] as const
  for (const [name, content, note] of capabilityWordmarks) {
    variants.push(variant(name, "One-cell capability probes", content, note))
  }

  for (const style of styles) {
    for (const method of ["merge", "sample"] as const) {
      const compressed = compressToFourRows(style.matrix, method)
      variants.push(
        variant(
          `One-row Braille ${method}, ${style.name}`,
          "One row / compressed Braille",
          renderBraille(compressed),
          `${method === "merge" ? "Merged" : "Sampled"} six source rows into four, eliminating the sparse second Braille line; ${style.name}.`,
        ),
        variant(
          `Inverse one-row Braille ${method}, ${style.name}`,
          "One row / compressed Braille",
          renderBraille(compressed, true),
          `Inverse ${method} compression into one Braille row; ${style.name}.`,
        ),
      )
    }
  }

  return variants
}

const VARIANTS = buildVariants()
const CATEGORIES: readonly LogoCategory[] = [
  {
    name: "Original block studies",
    description: "#001 and direct substitutions of its exact three-row silhouette",
    includes: (item, index) => index === 0 || item.category === "Original block studies",
  },
  {
    name: "Original shadow studies",
    description: "Grounding treatments projected below the unchanged #001 silhouette",
    includes: (item) => item.category === "Original shadow studies",
  },
  {
    name: "Three-row cell alphabets",
    description: "Alternate six-pixel alphabets using half cells, stems, shades, and geometry",
    includes: (item, index) => index !== 0 && item.category === "Three rows",
  },
  {
    name: "Quadrant packing",
    description: "Four source pixels per cell for three-row, half-width marks",
    includes: (item) => item.category === "Three rows / half width",
  },
  {
    name: "Horizontal packing",
    description: "Left/right half blocks compressing two source columns into one cell",
    includes: (item) => item.category === "Six rows / half width",
  },
  {
    name: "Sextant and octant mosaics",
    description: "Solid Unicode 13/16 mosaics packing six or eight pixels per cell",
    includes: (item) => item.category === "Legacy mosaics / two rows",
  },
  {
    name: "Braille bitmap packing",
    description: "Eight-dot bitmap cells producing compact two-row marks",
    includes: (item) => item.category === "Two rows / half width",
  },
  {
    name: "One-cell microfonts",
    description: "Single-row custom, semantic, and vertically compressed Braille",
    includes: (item) =>
      item.category === "One row / seven cells" ||
      item.category === "One row / compressed Braille" ||
      item.name.startsWith("Semantic"),
  },
  {
    name: "Connected stroke topology",
    description: "Neighbor-aware light, heavy, and double box-drawing paths",
    includes: (item) => item.category === "Connected stroke topology",
  },
  {
    name: "Terminal wordmarks",
    description: "Readable one-row typographic and terminal-syntax treatments",
    includes: (item) => item.category === "One row / typography",
  },
  {
    name: "Unicode capability probes",
    description: "Outlined Unicode 16 letters and combining-mark experiments",
    includes: (item) => item.category === "One-cell capability probes" && !item.name.startsWith("Semantic"),
  },
]
const CATEGORY_INDICES = CATEGORIES.map((category) =>
  VARIANTS.flatMap((item, index) => (category.includes(item, index) ? [index] : [])),
)
const ALL_INDICES = CATEGORY_INDICES.flat()

if (ALL_INDICES.length !== VARIANTS.length || new Set(ALL_INDICES).size !== VARIANTS.length) {
  throw new Error("Logo category taxonomy must include every permutation exactly once")
}

let view: BoxRenderable | null = null
let rendererInstance: CliRenderer | null = null
let stageHost: BoxRenderable | null = null
let proofLayout: BoxRenderable | null = null
let rainbowText: TextRenderable | null = null
let lightText: TextRenderable | null = null
let darkText: TextRenderable | null = null
let counterText: TextRenderable | null = null
let titleText: TextRenderable | null = null
let noteText: TextRenderable | null = null
let controlsText: TextRenderable | null = null
let filterText: TextRenderable | null = null
let scrollBox: ScrollBoxRenderable | null = null
const scrollCards = new Map<number, BoxRenderable>()
const scrollLabels = new Map<number, TextRenderable>()
let activeIndex = 0
let categoryFilter: number | null = null
let filterInput: string | null = null
let scrollMode = false
let isPlaying = false
let playbackSpeedIndex = 1
let playbackTimer: ReturnType<typeof setInterval> | null = null
let logoAnimationFrameHandler: ((deltaTime: number) => Promise<void>) | null = null
let autoPlayLogoAnimations = false
let animateNextBrowseRender = false
const comparisonSlots: Array<number | null> = [null, null, null]
let keyHandler: ((key: KeyEvent) => void) | null = null
let resizeHandler: ((width: number) => void) | null = null
let revealHandler: (() => void) | null = null
let selectionHandler: ((selection: Selection) => void) | null = null
let themeModeHandler: ((mode: ThemeMode) => void) | null = null

function rainbow(content: string): StyledText {
  const chunks = []
  const lines = content.split("\n")
  const width = Math.max(...lines.map((line) => [...line].length))
  for (const [lineIndex, line] of lines.entries()) {
    for (const [column, character] of [...line].entries()) {
      const colorIndex = Math.min(palette.spectrum.length - 1, Math.floor((column * palette.spectrum.length) / width))
      chunks.push(
        character === " "
          ? { __isChunk: true as const, text: character }
          : fg(palette.spectrum[colorIndex]!)(character),
      )
    }
    if (lineIndex < lines.length - 1) chunks.push({ __isChunk: true as const, text: "\n" })
  }
  return new StyledText(chunks)
}

function staggeredProgress(progress: number, score: number, kind: LogoAnimationKind): number {
  const [spread, activeDuration] = ANIMATION_STAGGER[kind]
  const delay = score * spread
  const localProgress = Math.max(0, Math.min(1, (progress - delay) / activeDuration))
  return localProgress * localProgress * (3 - 2 * localProgress)
}

function animatedBraille(character: string, progress: number): string {
  const codePoint = character.codePointAt(0)!
  if (codePoint < 0x2800 || codePoint > 0x28ff) return progress < 0.75 ? "⠂" : character
  const dotOrder = [0, 1, 2, 6, 3, 4, 5, 7]
  const dotsToShow = Math.min(dotOrder.length, Math.floor(progress * (dotOrder.length + 1)))
  let revealMask = 0
  for (let index = 0; index < dotsToShow; index++) revealMask |= 1 << dotOrder[index]!
  return String.fromCodePoint(0x2800 + ((codePoint - 0x2800) & revealMask))
}

function animatedHalfBlock(
  character: string,
  progress: number,
  column: number,
  row: number,
  width: number,
  height: number,
): string | null {
  if (character !== "▀" && character !== "▄" && character !== "█") return null
  const sourceHeight = height * 2
  const axisCount = Number(width > 1) + Number(sourceHeight > 1)
  const horizontal = width > 1 ? column / (width - 1) : 0
  const topVertical = sourceHeight > 1 ? (row * 2) / (sourceHeight - 1) : 0
  const bottomVertical = sourceHeight > 1 ? (row * 2 + 1) / (sourceHeight - 1) : 0
  const topVisible = progress >= (horizontal + topVertical) / axisCount
  const bottomVisible = progress >= (horizontal + bottomVertical) / axisCount
  const top = character !== "▄" && topVisible
  const bottom = character !== "▀" && bottomVisible
  if (top && bottom) return "█"
  if (top) return "▀"
  if (bottom) return "▄"
  return " "
}

export function animatedLogo(item: LogoVariant, progress: number, foreground: string | null): StyledText {
  const chunks = []
  const lines = item.content.split("\n")
  const height = lines.length
  const width = Math.max(...lines.map((line) => [...line].filter((character) => !/\p{Mark}/u.test(character)).length))
  const kind = logoAnimationKind(item)

  for (const [row, line] of lines.entries()) {
    let column = 0
    for (const character of [...line]) {
      const isMark = /\p{Mark}/u.test(character)
      const effectiveColumn = isMark ? Math.max(0, column - 1) : column
      const horizontalScore = effectiveColumn / Math.max(1, width - 1)
      const centerScore = Math.abs(effectiveColumn - (width - 1) / 2) / Math.max(1, (width - 1) / 2)
      const pathScore = (row * width + effectiveColumn) / Math.max(1, height * width - 1)
      const bottomUpScore = ((height - 1 - row) * width + effectiveColumn) / Math.max(1, height * width - 1)
      const score =
        kind === "pack" || kind === "invert"
          ? centerScore
          : kind === "trace"
            ? pathScore
            : kind === "build"
              ? bottomUpScore
              : horizontalScore
      const localProgress = staggeredProgress(progress, score, kind)
      const colorIndex = Math.min(
        palette.spectrum.length - 1,
        Math.floor((effectiveColumn * palette.spectrum.length) / width),
      )
      const color = foreground ?? palette.spectrum[colorIndex]!
      let renderedCharacter = character
      let attributes = TextAttributes.NONE

      if (kind === "typeset") {
        if (localProgress < 0.66) attributes |= TextAttributes.ITALIC
      } else if (kind === "combine") {
        if (isMark && localProgress < 0.38) renderedCharacter = ""
        else if (isMark && localProgress < 0.72) attributes |= TextAttributes.DIM
      } else if (kind === "invert") {
        if (localProgress < 0.56) attributes |= TextAttributes.INVERSE
      } else if (kind === "braille") {
        renderedCharacter = animatedBraille(character, localProgress)
      } else if (kind === "pack") {
        renderedCharacter = localProgress < 0.26 ? "·" : localProgress < 0.62 ? "▪" : character
      } else if (kind === "trace") {
        renderedCharacter = localProgress < 0.34 ? "•" : character
        if (localProgress < 0.68) attributes |= TextAttributes.DIM
      } else if (kind === "density") {
        renderedCharacter =
          localProgress < 0.2 ? "░" : localProgress < 0.42 ? "▒" : localProgress < 0.66 ? "▓" : character
      } else if (character !== " ") {
        const halfBlock = animatedHalfBlock(character, progress, effectiveColumn, row, width, height)
        if (halfBlock !== null) {
          renderedCharacter = halfBlock
        } else if (localProgress < 0.5) {
          renderedCharacter = " "
        }
      }

      chunks.push(
        character === " "
          ? { __isChunk: true as const, text: character }
          : { ...fg(color)(renderedCharacter), attributes },
      )
      if (!isMark) column++
    }
    if (row < height - 1) chunks.push({ __isChunk: true as const, text: "\n" })
  }

  return new StyledText(chunks)
}

function applyLogoAnimation(item: LogoVariant, progress: number): void {
  if (rainbowText) rainbowText.content = animatedLogo(item, progress, null)
  if (lightText) lightText.content = animatedLogo(item, progress, "#000000")
  if (darkText) darkText.content = animatedLogo(item, progress, "#FFFFFF")
}

function stopLogoAnimation(): void {
  if (logoAnimationFrameHandler && rendererInstance) rendererInstance.removeFrameCallback(logoAnimationFrameHandler)
  logoAnimationFrameHandler = null
}

function startLogoAnimation(): void {
  const renderer = rendererInstance
  if (!renderer || !rainbowText || !lightText || !darkText) return
  stopLogoAnimation()

  const item = VARIANTS[activeIndex]!
  const duration = isPlaying
    ? Math.min(logoAnimationDuration(logoAnimationKind(item)), PLAYBACK_SPEEDS[playbackSpeedIndex]!.interval * 0.8)
    : logoAnimationDuration(logoAnimationKind(item))
  let elapsed = 0
  applyLogoAnimation(item, 0)
  logoAnimationFrameHandler = async (deltaTime: number) => {
    elapsed += deltaTime
    const progress = logoAnimationProgress(elapsed, duration)
    applyLogoAnimation(item, progress)
    if (progress === 1) stopLogoAnimation()
  }
  renderer.setFrameCallback(logoAnimationFrameHandler)
}

function createProof(
  renderer: CliRenderer,
  id: string,
  label: string,
  foreground: string,
  background: string,
): [BoxRenderable, TextRenderable] {
  const isLightProof = id.endsWith("-light")
  const isDarkProof = id.endsWith("-dark")
  const box = new BoxRenderable(renderer, {
    id: `logo-proof-${id}`,
    flexGrow: 1,
    minWidth: 20,
    minHeight: 5,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    backgroundColor: background,
    border: true,
    borderColor: isLightProof ? "#D1D5DB" : isDarkProof ? "#252A34" : palette.border,
  })
  box.add(
    new TextRenderable(renderer, {
      id: `logo-proof-label-${id}`,
      content: label,
      fg: isLightProof ? "#6B7280" : isDarkProof ? "#667085" : palette.subtleText,
      selectable: false,
    }),
  )
  const text = new TextRenderable(renderer, {
    id: `logo-copy-proof-${id}`,
    content: "",
    fg: foreground,
    selectable: true,
  })
  box.add(text)
  return [box, text]
}

function filteredIndices(): number[] {
  return categoryFilter === null ? ALL_INDICES : CATEGORY_INDICES[categoryFilter]!
}

function categoryIndexFor(variantIndex: number): number {
  return CATEGORY_INDICES.findIndex((indices) => indices.includes(variantIndex))
}

function categoryFor(variantIndex: number): LogoCategory {
  return CATEGORIES[categoryIndexFor(variantIndex)]!
}

function filterMenu(): string {
  const entries = CATEGORIES.map(
    (category, index) => `${index + 1} ${category.name} (${CATEGORY_INDICES[index]!.length})`,
  )
  return [
    `FILTER / ${filterInput ?? ""}█   0 All (${VARIANTS.length})`,
    entries.slice(0, 5).join("  ·  "),
    entries.slice(5).join("  ·  "),
  ].join("\n")
}

function clearStage(): void {
  stopLogoAnimation()
  if (revealHandler && rendererInstance) rendererInstance.off(CliRenderEvents.FRAME, revealHandler)
  revealHandler = null
  scrollBox = null
  scrollCards.clear()
  scrollLabels.clear()
  proofLayout = null
  rainbowText = null
  lightText = null
  darkText = null
  for (const child of stageHost?.getChildren() ?? []) child.destroyRecursively()
}

function createProofRow(renderer: CliRenderer, id: string, item: LogoVariant, compact = false): BoxRenderable {
  const row = new BoxRenderable(renderer, {
    id: `logo-proof-row-${id}`,
    width: "100%",
    flexDirection: renderer.width >= 100 ? "row" : "column",
    flexGrow: compact ? 0 : 1,
    gap: compact ? 0 : 1,
    flexShrink: 0,
  })
  const [rainbowProof, rainbowRenderable] = createProof(
    renderer,
    `${id}-rainbow`,
    "01  SPECTRUM / THEME",
    palette.text,
    "transparent",
  )
  const [lightProof, lightRenderable] = createProof(renderer, `${id}-light`, "02  BLACK / WHITE", "#000000", "#FFFFFF")
  const [darkProof, darkRenderable] = createProof(renderer, `${id}-dark`, "03  WHITE / BLACK", "#FFFFFF", "#000000")
  rainbowRenderable.content = rainbow(item.content)
  lightRenderable.content = item.content
  darkRenderable.content = item.content
  if (id === "browse") {
    rainbowText = rainbowRenderable
    lightText = lightRenderable
    darkText = darkRenderable
  }
  row.add(rainbowProof)
  row.add(lightProof)
  row.add(darkProof)
  return row
}

function renderBrowseStage(renderer: CliRenderer): void {
  const item = VARIANTS[activeIndex]!
  proofLayout = createProofRow(renderer, "browse", item)
  if (animateNextBrowseRender) {
    animateNextBrowseRender = false
    startLogoAnimation()
  }
  if (renderer.width >= 100) {
    stageHost?.add(proofLayout)
    return
  }
  proofLayout.flexGrow = 0
  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "logo-browse-scroll",
    rootOptions: { backgroundColor: "transparent" },
    viewportOptions: { backgroundColor: "transparent" },
    contentOptions: { backgroundColor: "transparent" },
    scrollbarOptions: { trackOptions: { foregroundColor: palette.accent, backgroundColor: "transparent" } },
  })
  scrollBox.add(proofLayout)
  stageHost?.add(scrollBox)
  scrollBox.focus()
}

function renderComparisonStage(renderer: CliRenderer): void {
  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "logo-comparison-scroll",
    width: "100%",
    height: "100%",
    flexGrow: 1,
    rootOptions: { backgroundColor: "transparent" },
    viewportOptions: { backgroundColor: "transparent" },
    contentOptions: {
      backgroundColor: "transparent",
      flexDirection: "column",
      justifyContent: "center",
      gap: 1,
      paddingTop: 1,
      paddingBottom: 1,
    },
    scrollbarOptions: { trackOptions: { foregroundColor: palette.accent, backgroundColor: "transparent" } },
  })
  if (!comparisonSlots.includes(activeIndex)) {
    const candidate = VARIANTS[activeIndex]!
    const candidateCard = new BoxRenderable(renderer, {
      id: "comparison-candidate",
      width: "100%",
      flexDirection: "column",
      alignItems: "center",
      flexShrink: 0,
      border: true,
      borderColor: palette.warning,
      paddingTop: 1,
      paddingBottom: 1,
    })
    candidateCard.add(
      new TextRenderable(renderer, {
        content: `BROWSING CANDIDATE   #${String(activeIndex + 1).padStart(3, "0")}   ${candidate.name}   ·   press 1, 2, or 3 to assign`,
        fg: palette.warning,
        selectable: false,
      }),
    )
    candidateCard.add(
      new TextRenderable(renderer, {
        id: `logo-copy-candidate-${activeIndex + 1}`,
        content: rainbow(candidate.content),
        selectable: true,
      }),
    )
    scrollBox.add(candidateCard)
  }
  comparisonSlots.forEach((variantIndex, slotIndex) => {
    if (variantIndex === null) return
    const item = VARIANTS[variantIndex]!
    const card = new BoxRenderable(renderer, {
      id: `comparison-slot-${slotIndex + 1}`,
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
      border: true,
      borderColor: palette.strongBorder,
      paddingLeft: 1,
      paddingRight: 1,
    })
    card.add(
      new TextRenderable(renderer, {
        content: `SLOT ${slotIndex + 1}   #${String(variantIndex + 1).padStart(3, "0")}   ${item.name}`,
        fg: palette.spectrum[slotIndex * 2]!,
        selectable: false,
      }),
    )
    card.add(createProofRow(renderer, `compare-${slotIndex + 1}`, item, true))
    scrollBox?.add(card)
  })
  stageHost?.add(scrollBox)
  scrollBox.focus()
}

function renderScrollStage(renderer: CliRenderer): void {
  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "logo-gallery-scroll",
    rootOptions: { backgroundColor: "transparent", border: true, borderColor: palette.border },
    viewportOptions: { backgroundColor: "transparent" },
    contentOptions: { backgroundColor: "transparent", flexDirection: "column", gap: 1, padding: 1 },
    scrollbarOptions: { trackOptions: { foregroundColor: palette.success, backgroundColor: "transparent" } },
  })
  let previousCategory = -1
  for (const variantIndex of filteredIndices()) {
    const item = VARIANTS[variantIndex]!
    const itemCategory = categoryIndexFor(variantIndex)
    if (itemCategory !== previousCategory) {
      const category = CATEGORIES[itemCategory]!
      const section = new BoxRenderable(renderer, {
        id: `scroll-category-${itemCategory + 1}`,
        width: "100%",
        flexDirection: "column",
        flexShrink: 0,
        paddingLeft: 1,
        border: ["bottom"],
        borderColor: palette.strongBorder,
      })
      section.add(
        new TextRenderable(renderer, {
          content: `${String(itemCategory + 1).padStart(2, "0")}  ${category.name.toUpperCase()}   ${CATEGORY_INDICES[itemCategory]!.length} LOGOS`,
          fg: palette.warning,
          selectable: false,
        }),
      )
      section.add(
        new TextRenderable(renderer, { content: category.description, fg: palette.subtleText, selectable: false }),
      )
      scrollBox.add(section)
      previousCategory = itemCategory
    }
    const card = new BoxRenderable(renderer, {
      id: `scroll-logo-${variantIndex + 1}`,
      width: "100%",
      flexDirection: "column",
      alignItems: "center",
      flexShrink: 0,
      border: true,
      borderColor: variantIndex === activeIndex ? palette.accent : palette.border,
      paddingTop: 1,
      paddingBottom: 1,
    })
    const label = new TextRenderable(renderer, {
      content: "",
      fg: variantIndex === activeIndex ? palette.text : palette.mutedText,
      selectable: false,
    })
    card.add(label)
    card.add(
      new TextRenderable(renderer, {
        id: `logo-copy-scroll-${variantIndex + 1}`,
        content: rainbow(item.content),
        selectable: true,
      }),
    )
    scrollBox.add(card)
    scrollCards.set(variantIndex, card)
    scrollLabels.set(variantIndex, label)
  }
  updateScrollSelection()
  stageHost?.add(scrollBox)
  scrollBox.focus()
  const gallery = scrollBox
  revealHandler = () => {
    revealHandler = null
    if (scrollBox === gallery) gallery.scrollChildIntoView(`scroll-logo-${activeIndex + 1}`)
  }
  renderer.once(CliRenderEvents.FRAME, revealHandler)
}

function scrollLabel(variantIndex: number): string {
  const item = VARIANTS[variantIndex]!
  const slots = comparisonSlots.flatMap((slot, index) => (slot === variantIndex ? [String(index + 1)] : []))
  const slotLabel = slots.length > 0 ? `  [SLOT ${slots.join("+")}]` : ""
  const cursor = variantIndex === activeIndex ? "▶ " : "  "
  return `${cursor}#${String(variantIndex + 1).padStart(3, "0")}  ${item.name}${slotLabel}`
}

function updateScrollSelection(previousIndex?: number): void {
  if (previousIndex !== undefined) {
    const previousCard = scrollCards.get(previousIndex)
    const previousLabel = scrollLabels.get(previousIndex)
    if (previousCard) previousCard.borderColor = palette.border
    if (previousLabel) {
      previousLabel.fg = palette.mutedText
      previousLabel.content = scrollLabel(previousIndex)
    }
  }
  for (const [variantIndex, label] of scrollLabels) label.content = scrollLabel(variantIndex)
  const activeCard = scrollCards.get(activeIndex)
  const activeLabel = scrollLabels.get(activeIndex)
  if (activeCard) activeCard.borderColor = palette.accent
  if (activeLabel) activeLabel.fg = palette.text
}

function renderStage(): void {
  const renderer = rendererInstance
  if (!renderer || !stageHost) return
  clearStage()
  if (isPlaying) renderBrowseStage(renderer)
  else if (scrollMode) renderScrollStage(renderer)
  else if (comparisonSlots.some((slot) => slot !== null)) renderComparisonStage(renderer)
  else renderBrowseStage(renderer)
}

function updateFooter(): void {
  const category = categoryFilter === null ? null : CATEGORIES[categoryFilter]!
  if (filterInput !== null) {
    if (filterText) filterText.content = filterMenu()
    if (controlsText) controlsText.content = "Type category number, Enter apply, Backspace edit, Esc cancel"
    return
  }
  if (filterText) {
    filterText.content = category
      ? `CATEGORY ${categoryFilter! + 1}: ${category.name}   ·   ${filteredIndices().length} logos   ·   ${category.description}`
      : `ALL 10 COLLECTIONS   ·   ${VARIANTS.length} logos   ·   / opens the collection filter`
  }
  if (controlsText) {
    const speed = PLAYBACK_SPEEDS[playbackSpeedIndex]!
    const playback = `Space ${isPlaying ? "pause" : "play"}  ·  -/+ speed: ${speed.name} (${speed.interval}ms)`
    const animation = `A animate: ${ANIMATION_LABELS[logoAnimationKind(VARIANTS[activeIndex]!)]}`
    const canAnimate = !isPlaying && !scrollMode && comparisonSlots.every((slot) => slot === null)
    const canAutoPlay = isPlaying || (!scrollMode && comparisonSlots.every((slot) => slot === null))
    const autoPlay = `Shift+A auto: ${autoPlayLogoAnimations ? "ON" : "OFF"}`
    controlsText.content =
      scrollMode && !isPlaying
        ? `J/K select  ·  ↑/↓/PgUp/PgDn scroll  ·  ${playback}  ·  S exit scroll  ·  / filter`
        : `←/→ browse  ·  ${canAnimate ? `${animation}  ·  ` : ""}${canAutoPlay ? `${autoPlay}  ·  ` : ""}${playback}  ·  1/2/3 compare  ·  S scroll  ·  / filter`
  }
}

function updateHeader(): void {
  const indices = filteredIndices()
  const item = VARIANTS[activeIndex]!
  const number = String(activeIndex + 1).padStart(3, "0")
  const filteredPosition = indices.indexOf(activeIndex) + 1
  const category = categoryFor(activeIndex)
  if (counterText)
    counterText.content = `${String(filteredPosition).padStart(3, "0")} / ${indices.length}   GLOBAL #${number}   ${category.name.toUpperCase()}`
  if (titleText) {
    const slots = comparisonSlots
      .map((slot, index) => (slot === null ? `${index + 1}:—` : `${index + 1}:#${String(slot + 1).padStart(3, "0")}`))
      .join("  ")
    titleText.content = isPlaying
      ? `PLAYING ${PLAYBACK_SPEEDS[playbackSpeedIndex]!.name.toUpperCase()}   ${slots}`
      : scrollMode
        ? `SCROLL SELECT   ${slots}`
        : comparisonSlots.some((slot) => slot !== null)
          ? `COMPARE   ${slots}`
          : item.name
  }
  if (noteText) noteText.content = item.note
}

function showVariant(index: number): void {
  const indices = filteredIndices()
  if (indices.length === 0) return
  const previousIndex = activeIndex
  const currentPosition = indices.indexOf(activeIndex)
  const requestedPosition = currentPosition === -1 ? index : currentPosition + index
  activeIndex = indices[((requestedPosition % indices.length) + indices.length) % indices.length]!
  animateNextBrowseRender = shouldAutoPlayLogoAnimation({
    enabled: autoPlayLogoAnimations,
    previousIndex,
    nextIndex: activeIndex,
    isPlaying,
    scrollMode,
    hasComparison: comparisonSlots.some((slot) => slot !== null),
  })
  updateHeader()
  renderStage()
  updateFooter()
}

function clearPlaybackTimer(): void {
  if (playbackTimer) clearInterval(playbackTimer)
  playbackTimer = null
}

function stopPlayback(): void {
  clearPlaybackTimer()
  if (!isPlaying) return
  isPlaying = false
  updateHeader()
  renderStage()
  updateFooter()
}

function startPlayback(): void {
  clearPlaybackTimer()
  isPlaying = true
  playbackTimer = setInterval(() => showVariant(1), PLAYBACK_SPEEDS[playbackSpeedIndex]!.interval)
  updateHeader()
  renderStage()
  updateFooter()
}

function changePlaybackSpeed(delta: number): void {
  playbackSpeedIndex = (playbackSpeedIndex + delta + PLAYBACK_SPEEDS.length) % PLAYBACK_SPEEDS.length
  if (isPlaying) startPlayback()
  else updateFooter()
}

function moveScrollSelection(delta: number): void {
  const indices = filteredIndices()
  const currentPosition = indices.indexOf(activeIndex)
  const previousIndex = activeIndex
  activeIndex = indices[(currentPosition + delta + indices.length) % indices.length]!
  updateScrollSelection(previousIndex)
  updateHeader()
  updateFooter()
  scrollBox?.scrollChildIntoView(`scroll-logo-${activeIndex + 1}`)
}

function applyFilter(): void {
  if (filterInput === null || filterInput === "") return
  const requested = Number(filterInput)
  if (!Number.isInteger(requested) || requested < 0 || requested > CATEGORIES.length) return
  categoryFilter = requested === 0 ? null : requested - 1
  filterInput = null
  activeIndex = filteredIndices()[0] ?? 0
  showVariant(0)
}

function isUnmodified(key: KeyEvent): boolean {
  return !key.ctrl && !key.shift && !key.meta && !key.super && !key.hyper
}

function handleLogoSelection(renderer: CliRenderer, selection: Selection): void {
  const selected = selection.selectedRenderables
  if (selected.length === 0 || selected.some((renderable) => !renderable.id.startsWith("logo-copy-"))) return
  const text = selection.getSelectedText()
  if (!text) return
  renderer.copyToClipboardOSC52(text)
}

export function run(renderer: CliRenderer): void {
  clearPlaybackTimer()
  isPlaying = false
  autoPlayLogoAnimations = false
  animateNextBrowseRender = false
  rendererInstance = renderer
  renderer.start()
  palette = renderer.themeMode === "light" ? LIGHT_PALETTE : DARK_PALETTE
  renderer.setBackgroundColor("transparent")
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
  if (selectionHandler) renderer.off(CliRenderEvents.SELECTION, selectionHandler)
  if (themeModeHandler) renderer.off("theme_mode", themeModeHandler)
  view?.destroyRecursively()

  view = new BoxRenderable(renderer, {
    id: "opentui-logo-demo",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: "transparent",
    padding: 1,
  })
  const header = new BoxRenderable(renderer, {
    id: "logo-header",
    alignItems: "center",
    flexDirection: "column",
    flexShrink: 0,
  })
  counterText = new TextRenderable(renderer, {
    id: "logo-counter",
    content: "",
    fg: palette.subtleText,
    selectable: false,
  })
  titleText = new TextRenderable(renderer, { id: "logo-title", content: "", fg: palette.text, selectable: false })
  header.add(counterText)
  header.add(titleText)

  stageHost = new BoxRenderable(renderer, {
    id: "logo-stage-host",
    width: "100%",
    flexGrow: 1,
    marginTop: 1,
    marginBottom: 1,
  })

  const footer = new BoxRenderable(renderer, {
    id: "logo-footer",
    alignItems: "center",
    flexDirection: "column",
    flexShrink: 0,
  })
  noteText = new TextRenderable(renderer, { id: "logo-note", content: "", fg: palette.mutedText, selectable: false })
  filterText = new TextRenderable(renderer, { id: "logo-filter", content: "", fg: palette.accent, selectable: false })
  controlsText = new TextRenderable(renderer, {
    id: "logo-controls",
    content: "",
    fg: palette.subtleText,
    selectable: false,
  })
  footer.add(noteText)
  footer.add(filterText)
  footer.add(controlsText)

  view.add(header)
  view.add(stageHost)
  view.add(footer)
  renderer.root.add(view)
  showVariant(0)

  keyHandler = (key: KeyEvent) => {
    if (filterInput !== null) {
      if (key.name === "escape") {
        filterInput = null
        updateFooter()
      } else if (key.name === "backspace") {
        filterInput = filterInput.slice(0, -1)
        updateFooter()
      } else if (key.name === "return") {
        applyFilter()
      } else if (/^\d$/.test(key.sequence)) {
        filterInput += key.sequence
        updateFooter()
      }
      return
    }
    if (key.sequence === "/") {
      stopPlayback()
      filterInput = ""
      updateFooter()
    } else if (key.name === "space" && isUnmodified(key)) {
      if (isPlaying) stopPlayback()
      else startPlayback()
      key.preventDefault()
    } else if (key.sequence === "-" && isUnmodified(key)) {
      changePlaybackSpeed(-1)
    } else if (key.sequence === "+" && !key.ctrl && !key.meta && !key.super && !key.hyper) {
      changePlaybackSpeed(1)
    } else if (key.sequence === "A" && key.shift && !key.ctrl && !key.meta && !key.super && !key.hyper) {
      autoPlayLogoAnimations = !autoPlayLogoAnimations
      updateFooter()
    } else if (
      key.name === "a" &&
      isUnmodified(key) &&
      !isPlaying &&
      !scrollMode &&
      comparisonSlots.every((slot) => slot === null)
    ) {
      startLogoAnimation()
    } else if (/^[123]$/.test(key.sequence) && isUnmodified(key)) {
      comparisonSlots[Number(key.sequence) - 1] = activeIndex
      if (scrollMode && !isPlaying) {
        updateScrollSelection()
        updateHeader()
        updateFooter()
      } else {
        showVariant(0)
      }
    } else if (key.name === "c" && isUnmodified(key)) {
      comparisonSlots.fill(null)
      showVariant(0)
    } else if (key.name === "s" && isUnmodified(key)) {
      scrollMode = !scrollMode
      showVariant(0)
    } else if (
      (!scrollMode || isPlaying) &&
      (!comparisonSlots.some((slot) => slot !== null) || isPlaying) &&
      renderer.width < 100 &&
      key.name === "down"
    ) {
      scrollBox?.scrollBy(3)
      key.preventDefault()
    } else if (
      (!scrollMode || isPlaying) &&
      (!comparisonSlots.some((slot) => slot !== null) || isPlaying) &&
      renderer.width < 100 &&
      key.name === "up"
    ) {
      scrollBox?.scrollBy(-3)
      key.preventDefault()
    } else if (scrollMode && !isPlaying) {
      if (key.name === "j" || key.name === "right") {
        moveScrollSelection(1)
        key.preventDefault()
      } else if (key.name === "k" || key.name === "left") {
        moveScrollSelection(-1)
        key.preventDefault()
      }
      return
    } else if (key.name === "right" || key.name === "j" || key.name === "n") {
      showVariant(1)
      key.preventDefault()
    } else if (key.name === "left" || key.name === "k" || key.name === "p") {
      showVariant(-1)
      key.preventDefault()
    } else if (key.name === "pagedown") {
      showVariant(10)
      key.preventDefault()
    } else if (key.name === "pageup") {
      showVariant(-10)
      key.preventDefault()
    } else if (key.name === "home") {
      activeIndex = filteredIndices()[0] ?? 0
      showVariant(0)
      key.preventDefault()
    } else if (key.name === "end") {
      activeIndex = filteredIndices().at(-1) ?? 0
      showVariant(0)
      key.preventDefault()
    } else if (key.name === "r") {
      const indices = filteredIndices()
      activeIndex = indices[Math.floor(Math.random() * indices.length)] ?? 0
      showVariant(0)
    }
  }
  resizeHandler = (width: number) => {
    void width
    renderStage()
  }
  renderer.keyInput.on("keypress", keyHandler)
  renderer.on("resize", resizeHandler)
  selectionHandler = (selection: Selection) => handleLogoSelection(renderer, selection)
  renderer.on(CliRenderEvents.SELECTION, selectionHandler)
  themeModeHandler = (mode: ThemeMode) => {
    palette = mode === "light" ? LIGHT_PALETTE : DARK_PALETTE
    if (counterText) counterText.fg = palette.subtleText
    if (titleText) titleText.fg = palette.text
    if (noteText) noteText.fg = palette.mutedText
    if (filterText) filterText.fg = palette.accent
    if (controlsText) controlsText.fg = palette.subtleText
    renderStage()
  }
  renderer.on("theme_mode", themeModeHandler)
}

export function destroy(renderer: CliRenderer): void {
  clearPlaybackTimer()
  stopLogoAnimation()
  isPlaying = false
  autoPlayLogoAnimations = false
  animateNextBrowseRender = false
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
  if (revealHandler) renderer.off(CliRenderEvents.FRAME, revealHandler)
  if (selectionHandler) renderer.off(CliRenderEvents.SELECTION, selectionHandler)
  if (themeModeHandler) renderer.off("theme_mode", themeModeHandler)
  keyHandler = null
  resizeHandler = null
  revealHandler = null
  selectionHandler = null
  themeModeHandler = null
  view?.destroyRecursively()
  view = null
  rendererInstance = null
  stageHost = null
  proofLayout = null
  rainbowText = null
  lightText = null
  darkText = null
  counterText = null
  titleText = null
  noteText = null
  controlsText = null
  filterText = null
  scrollBox = null
  scrollCards.clear()
  scrollLabels.clear()
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    onDestroy: () => {
      clearPlaybackTimer()
      stopLogoAnimation()
      isPlaying = false
      view = null
    },
  })
  setupCommonDemoKeys(renderer)
  run(renderer)
}
