import type { RGBA } from "./RGBA.js"

export interface SelectionCoordinateBounds {
  anchor: { x: number; y: number }
  focus: { x: number; y: number }
}

export interface ProbedVisualLine {
  text: string
  width: number
  getPrefixText: (x: number) => string
}

export interface SelectionProbeView {
  getSelection(): { start: number; end: number } | null
  setSelection(start: number, end: number, bgColor?: RGBA, fgColor?: RGBA): void
  resetSelection(): void
  setLocalSelection(
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor?: RGBA,
    fgColor?: RGBA,
    ...extra: unknown[]
  ): boolean
  getSelectedText(): string
}

type GraphemeClass = "word" | "cjk-word" | "whitespace" | "other"

const PROBE_MAX_X = 1_000_000
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function classifyGrapheme(grapheme: string): GraphemeClass {
  if (/^\s+$/u.test(grapheme)) return "whitespace"
  if (/^[A-Za-z0-9_]+$/u.test(grapheme)) return "word"
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(grapheme)) {
    return "cjk-word"
  }
  if (/^[\p{Letter}\p{Number}\p{Mark}_]+$/u.test(grapheme)) return "word"
  // Punctuation/symbols intentionally remain their own class so double-click
  // behavior splits tokens like "foo-bar" or "foo/bar" at punctuation boundaries.
  return "other"
}

function getGraphemeBounds(text: string): Array<{ segment: string; start: number; end: number; kind: GraphemeClass }> {
  const bounds: Array<{ segment: string; start: number; end: number; kind: GraphemeClass }> = []

  for (const part of graphemeSegmenter.segment(text)) {
    bounds.push({
      segment: part.segment,
      start: part.index,
      end: part.index + part.segment.length,
      kind: classifyGrapheme(part.segment),
    })
  }

  return bounds
}

function findGraphemeIndexAt(textIndex: number, graphemes: Array<{ start: number; end: number }>): number {
  for (let i = 0; i < graphemes.length; i += 1) {
    const grapheme = graphemes[i]!

    if (textIndex <= grapheme.end) {
      return i
    }
  }

  return graphemes.length - 1
}

function findStartXForTextIndex(line: ProbedVisualLine, startTextIndex: number): number {
  if (startTextIndex <= 0) return 0

  let low = 0
  let high = line.width

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (line.getPrefixText(mid).length > startTextIndex) {
      high = mid
    } else {
      low = mid + 1
    }
  }

  return clamp(low - 1, 0, line.width)
}

function findEndXForTextIndex(line: ProbedVisualLine, endTextIndex: number): number {
  if (endTextIndex <= 0) return 0

  let low = 0
  let high = line.width

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (line.getPrefixText(mid).length >= endTextIndex) {
      high = mid
    } else {
      low = mid + 1
    }
  }

  return clamp(low, 0, line.width)
}

export function getWordSelectionBoundsForVisualLine(
  line: ProbedVisualLine,
  localX: number,
): { startX: number; endX: number } | null {
  if (line.width <= 0 || line.text.length === 0) return null

  const clickTextIndex = line.getPrefixText(clamp(localX, 0, line.width)).length
  const graphemes = getGraphemeBounds(line.text)

  if (graphemes.length === 0) return null

  const clickedIndex = findGraphemeIndexAt(clickTextIndex, graphemes)
  const clicked = graphemes[clickedIndex]
  if (!clicked) return null

  let startIndex = clickedIndex
  while (startIndex > 0 && graphemes[startIndex - 1]?.kind === clicked.kind) {
    startIndex -= 1
  }

  let endIndex = clickedIndex
  while (endIndex + 1 < graphemes.length && graphemes[endIndex + 1]?.kind === clicked.kind) {
    endIndex += 1
  }

  const startTextIndex = graphemes[startIndex]?.start ?? 0
  const endTextIndex = graphemes[endIndex]?.end ?? line.text.length

  return {
    startX: findStartXForTextIndex(line, startTextIndex),
    endX: findEndXForTextIndex(line, endTextIndex),
  }
}

function withSelectionProbe<T>(view: SelectionProbeView, selectionBg: RGBA | undefined, selectionFg: RGBA | undefined, run: () => T): T {
  const previousSelection = view.getSelection()

  try {
    return run()
  } finally {
    if (previousSelection) {
      view.setSelection(previousSelection.start, previousSelection.end, selectionBg, selectionFg)
    } else {
      view.resetSelection()
    }
  }
}

export function createVisualLineProbe(
  view: SelectionProbeView,
  localY: number,
  height: number,
  selectionBg: RGBA | undefined,
  selectionFg: RGBA | undefined,
): (ProbedVisualLine & { localY: number }) | null {
  // We currently "probe" line content by temporarily setting a local selection,
  // reading selected text, then restoring the prior selection in a finally block.
  // This keeps behavior correct with wrapping/continuation cells but mutates view
  // selection state briefly and can be chatty over FFI when called repeatedly.
  // TODO: replace this path with a dedicated native API for coordinate-range text.
  if (height <= 0) return null

  const clampedY = Math.max(0, Math.min(Math.floor(localY), height - 1))
  const line = withSelectionProbe(view, selectionBg, selectionFg, () => {
    view.setLocalSelection(0, clampedY, PROBE_MAX_X, clampedY, selectionBg, selectionFg)

    const selection = view.getSelection()
    return {
      text: view.getSelectedText(),
      width: selection ? selection.end - selection.start : 0,
    }
  })

  const prefixCache = new Map<number, string>([
    [0, ""],
    [line.width, line.text],
  ])

  return {
    ...line,
    localY: clampedY,
    getPrefixText: (x: number) => {
      const clampedX = Math.max(0, Math.min(Math.floor(x), line.width))
      const cached = prefixCache.get(clampedX)
      if (cached !== undefined) return cached

      const prefix = withSelectionProbe(view, selectionBg, selectionFg, () => {
        view.setLocalSelection(0, clampedY, clampedX, clampedY, selectionBg, selectionFg)
        return view.getSelectedText()
      })

      prefixCache.set(clampedX, prefix)
      return prefix
    },
  }
}
