import katex, { type KatexOptions } from "katex"
import { XMLParser } from "fast-xml-parser"
import stringWidth from "string-width"
import { parseColor, type ColorInput } from "../lib/RGBA.js"
import { StyledText } from "../lib/styled-text.js"
import type { TextChunk } from "../text-buffer.js"

export type LatexStrictMode = boolean | "ignore" | "warn" | "error"

export interface LatexRenderOptions {
  displayMode?: boolean
  macros?: Record<string, string>
  throwOnError?: boolean
  strict?: LatexStrictMode
  maxSize?: number
  maxExpand?: number
}

export interface LatexStyledRenderOptions extends LatexRenderOptions {
  errorFg?: ColorInput
}

export interface LatexRenderResult {
  text: string
  error?: string
}

interface Layout {
  lines: string[]
  width: number
  baseline: number
}

type OrderedXmlNode = Record<string, unknown>

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
})

const MAX_CACHE_ENTRIES = 500
const renderCache = new Map<string, LatexRenderResult>()

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  f: "ᶠ",
  g: "ᵍ",
  h: "ʰ",
  i: "ⁱ",
  j: "ʲ",
  k: "ᵏ",
  l: "ˡ",
  m: "ᵐ",
  n: "ⁿ",
  o: "ᵒ",
  p: "ᵖ",
  r: "ʳ",
  s: "ˢ",
  t: "ᵗ",
  u: "ᵘ",
  v: "ᵛ",
  w: "ʷ",
  x: "ˣ",
  y: "ʸ",
  z: "ᶻ",
  "∞": "∞",
  "→": "→",
}

const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
  "∞": "∞",
  "→": "→",
}

const INVISIBLE_OPERATORS = new Set(["\u2061", "\u2062", "\u2063", "\u2064"])
const PADDED_OPERATORS = new Set(["+", "-", "−", "=", "≈", "≠", "<", ">", "≤", "≥", "→", "↦", "±"])
const FUNCTION_NAMES = new Set(["sin", "cos", "tan", "log", "ln", "exp", "min", "max", "sup", "inf"])
const SPACED_SCRIPT_BASES = new Set(["∫", "∑", "∏", "lim"])
const SPACE_RE = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }

  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`
}

function cacheKey(content: string, options: LatexRenderOptions): string {
  return stableStringify({
    content,
    displayMode: options.displayMode ?? true,
    macros: options.macros ?? {},
    maxExpand: options.maxExpand,
    maxSize: options.maxSize,
    strict: options.strict,
    throwOnError: options.throwOnError ?? false,
  })
}

function setCachedResult(key: string, result: LatexRenderResult): void {
  renderCache.set(key, result)
  if (renderCache.size <= MAX_CACHE_ENTRIES) return

  const firstKey = renderCache.keys().next().value
  if (firstKey) {
    renderCache.delete(firstKey)
  }
}

function makeKatexOptions(options: LatexRenderOptions): KatexOptions {
  return {
    displayMode: options.displayMode ?? true,
    output: "mathml",
    throwOnError: true,
    macros: options.macros,
    strict: options.strict,
    maxSize: options.maxSize,
    maxExpand: options.maxExpand,
    trust: false,
    globalGroup: false,
  }
}

function displayWidth(text: string): number {
  return stringWidth(text)
}

function repeatSpaces(count: number): string {
  return " ".repeat(Math.max(0, count))
}

function padRight(text: string, width: number): string {
  return text + repeatSpaces(width - displayWidth(text))
}

function centerText(text: string, width: number): string {
  const remaining = width - displayWidth(text)
  if (remaining <= 0) return text
  const left = Math.floor(remaining / 2)
  return repeatSpaces(left) + text + repeatSpaces(remaining - left)
}

function textLayout(text: string): Layout {
  const normalized = normalizeMathText(text)
  return {
    lines: [normalized],
    width: displayWidth(normalized),
    baseline: 0,
  }
}

function emptyLayout(): Layout {
  return textLayout("")
}

function layoutToString(layout: Layout): string {
  return layout.lines
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
}

function layoutToInlineString(layout: Layout): string {
  return layoutToString(layout)
    .replace(/\s*\n\s*/g, " ")
    .trim()
}

function boundText(layout: Layout): string {
  return layoutToInlineString(layout)
    .replace(/\s+/g, " ")
    .replace(/\s*=\s*/g, "=")
    .replace(/\s*([<>≤≥])\s*/g, "$1")
    .replace(/\s*→\s*/g, " → ")
    .trim()
}

function rangeText(subscript: Layout | null, superscript: Layout | null): string {
  const subscriptText = subscript ? boundText(subscript) : ""
  const superscriptText = superscript ? boundText(superscript) : ""

  if (subscriptText && superscriptText) {
    return `${subscriptText}..${superscriptText}`
  }

  return subscriptText || (superscriptText ? `..${superscriptText}` : "")
}

function hstack(layouts: Layout[]): Layout {
  const visible = layouts.filter((layout) => layout.lines.length > 0)
  if (visible.length === 0) return emptyLayout()

  const baseline = Math.max(...visible.map((layout) => layout.baseline))
  const below = Math.max(...visible.map((layout) => layout.lines.length - layout.baseline - 1))
  const height = baseline + below + 1
  const lines: string[] = []

  for (let row = 0; row < height; row += 1) {
    let line = ""
    for (const layout of visible) {
      const sourceRow = row - (baseline - layout.baseline)
      line +=
        sourceRow >= 0 && sourceRow < layout.lines.length
          ? padRight(layout.lines[sourceRow], layout.width)
          : repeatSpaces(layout.width)
    }
    lines.push(line)
  }

  return {
    lines,
    width: visible.reduce((sum, layout) => sum + layout.width, 0),
    baseline,
  }
}

function fractionLayout(numerator: Layout, denominator: Layout, displayMode: boolean, compact: boolean): Layout {
  if (compact || (!displayMode && numerator.lines.length === 1 && denominator.lines.length === 1)) {
    const numeratorText = layoutToInlineString(numerator)
    const denominatorText = layoutToInlineString(denominator)
    const suffix = numeratorText === "d" && denominatorText.startsWith("d") ? " " : ""
    return textLayout(`${numeratorText}/${denominatorText}${suffix}`)
  }

  const width = Math.max(1, numerator.width, denominator.width)
  return {
    lines: [
      centerText(layoutToString(numerator), width),
      "─".repeat(width),
      centerText(layoutToString(denominator), width),
    ],
    width,
    baseline: 1,
  }
}

function matrixLayout(rows: Layout[][], compact: boolean): Layout {
  if (rows.length === 0) return emptyLayout()

  const columnCount = Math.max(...rows.map((row) => row.length))
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(0, ...rows.map((row) => row[columnIndex]?.width ?? 0)),
  )

  if (compact) {
    const rowTexts = rows.map((row) =>
      columnWidths
        .map((width, columnIndex) => padRight(layoutToInlineString(row[columnIndex] ?? emptyLayout()), width))
        .join(" "),
    )
    return textLayout(`[${rowTexts.join("; ")}]`)
  }

  const innerLines = rows.map((row) => {
    const cells = columnWidths.map((width, columnIndex) =>
      padRight(layoutToString(row[columnIndex] ?? emptyLayout()), width),
    )
    return cells.join("  ")
  })
  const innerWidth = Math.max(0, ...innerLines.map(displayWidth))
  const lines = innerLines.map((line) => `[ ${padRight(line, innerWidth)} ]`)

  return {
    lines,
    width: Math.max(0, ...lines.map(displayWidth)),
    baseline: Math.floor(lines.length / 2),
  }
}

function scriptText(layout: Layout, map: Record<string, string>): string | null {
  if (layout.lines.length !== 1) return null

  let mapped = ""
  for (const char of layout.lines[0]) {
    if (char === " ") continue
    const next = map[char]
    if (!next) return null
    mapped += next
  }
  return mapped
}

function scriptFallback(base: Layout, subscript: Layout | null, superscript: Layout | null): Layout {
  const pieces = [base]
  if (subscript) {
    pieces.push(textLayout(`_(${layoutToInlineString(subscript)})`))
  }
  if (superscript) {
    pieces.push(textLayout(`^(${layoutToInlineString(superscript)})`))
  }
  return hstack(pieces)
}

function scriptedLayout(base: Layout, subscript: Layout | null, superscript: Layout | null): Layout {
  const mappedSubscript = subscript ? scriptText(subscript, SUBSCRIPT) : ""
  const mappedSuperscript = superscript ? scriptText(superscript, SUPERSCRIPT) : ""
  const baseText = layoutToInlineString(base)
  const suffix = SPACED_SCRIPT_BASES.has(baseText) ? " " : ""

  if (subscript || superscript) {
    const range = rangeText(subscript, superscript)
    if (baseText === "∫") {
      return textLayout(range ? `∫[${range}] ` : "∫ ")
    }
    if (baseText === "∑") {
      return textLayout(range ? `Σ[${range}] ` : "Σ ")
    }
    if (baseText === "∏") {
      return textLayout(range ? `Π[${range}] ` : "Π ")
    }
    if (baseText === "lim" && subscript) {
      return textLayout(`lim(${boundText(subscript)}) `)
    }
  }

  if ((subscript === null || mappedSubscript !== null) && (superscript === null || mappedSuperscript !== null)) {
    return textLayout(`${baseText}${mappedSubscript ?? ""}${mappedSuperscript ?? ""}${suffix}`)
  }

  const fallback = scriptFallback(base, subscript, superscript)
  return suffix ? textLayout(`${layoutToInlineString(fallback)}${suffix}`) : fallback
}

function normalizeMathText(text: string): string {
  let normalized = ""
  for (const char of text.replace(SPACE_RE, " ")) {
    if (INVISIBLE_OPERATORS.has(char)) continue
    normalized += char
  }
  return normalized
}

function formatOperator(text: string, compact: boolean): string {
  const normalized = normalizeMathText(text)
  if (normalized.length === 0) return ""
  if (compact && PADDED_OPERATORS.has(normalized)) {
    return ` ${normalized} `
  }
  return normalized
}

function formatIdentifier(text: string, compact: boolean): string {
  const normalized = normalizeMathText(text)
  if (compact && FUNCTION_NAMES.has(normalized)) {
    return `${normalized} `
  }
  return normalized
}

function nodeName(node: OrderedXmlNode): string | null {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text") ?? null
}

function nodeChildren(node: OrderedXmlNode, name: string): OrderedXmlNode[] {
  const value = node[name]
  return Array.isArray(value) ? (value as OrderedXmlNode[]) : []
}

function textContent(nodes: OrderedXmlNode[]): string {
  let text = ""
  for (const node of nodes) {
    if (typeof node["#text"] === "string") {
      text += node["#text"]
      continue
    }

    const name = nodeName(node)
    if (name) {
      text += textContent(nodeChildren(node, name))
    }
  }
  return text
}

function findElement(nodes: OrderedXmlNode[], target: string): OrderedXmlNode | null {
  for (const node of nodes) {
    const name = nodeName(node)
    if (!name) continue
    if (name === target) return node

    const found = findElement(nodeChildren(node, name), target)
    if (found) return found
  }

  return null
}

function firstRenderableChild(children: OrderedXmlNode[]): OrderedXmlNode | null {
  return (
    children.find((child) => {
      const name = nodeName(child)
      return !!name && name !== "annotation"
    }) ?? null
  )
}

function renderableChildCount(children: OrderedXmlNode[]): number {
  return children.reduce((count, child) => (nodeName(child) && nodeName(child) !== "annotation" ? count + 1 : count), 0)
}

function renderChildren(children: OrderedXmlNode[], displayMode: boolean, compact: boolean = false): Layout {
  const nextCompact = compact || renderableChildCount(children) > 1
  return hstack(children.map((child) => renderNode(child, displayMode, nextCompact)))
}

function renderSqrt(children: OrderedXmlNode[], displayMode: boolean, compact: boolean): Layout {
  const inner = renderChildren(children, displayMode, compact)
  if (inner.lines.length === 1) {
    const text = layoutToInlineString(inner)
    return textLayout(text.length <= 1 ? `√${text}` : `√(${text})`)
  }

  return hstack([textLayout("√("), inner, textLayout(")")])
}

function overUnderLayout(
  base: Layout,
  under: Layout | null,
  over: Layout | null,
  displayMode: boolean,
  compact: boolean,
): Layout {
  if (compact || !displayMode) {
    return scriptedLayout(base, under, over)
  }

  const width = Math.max(1, base.width, under?.width ?? 0, over?.width ?? 0) + 1
  const lines: string[] = []
  if (over) {
    lines.push(centerText(layoutToString(over), width))
  }

  const baseline = lines.length
  lines.push(centerText(layoutToString(base), width))

  if (under) {
    lines.push(centerText(layoutToString(under), width))
  }

  return {
    lines,
    width,
    baseline,
  }
}

function renderNode(node: OrderedXmlNode, displayMode: boolean, compact: boolean = false): Layout {
  if (typeof node["#text"] === "string") {
    return textLayout(node["#text"])
  }

  const name = nodeName(node)
  if (!name) return emptyLayout()

  const children = nodeChildren(node, name)

  switch (name) {
    case "math":
    case "mrow":
    case "mpadded":
    case "mstyle":
      return renderChildren(children, displayMode, compact)

    case "semantics": {
      const child = firstRenderableChild(children)
      return child ? renderNode(child, displayMode, compact) : emptyLayout()
    }

    case "mn":
    case "mtext":
      return textLayout(textContent(children))

    case "mi":
      return textLayout(formatIdentifier(textContent(children), compact))

    case "mo":
      return textLayout(formatOperator(textContent(children), compact))

    case "mspace":
      return textLayout(" ")

    case "msup":
      return scriptedLayout(
        renderNode(children[0] ?? {}, displayMode, compact),
        null,
        renderNode(children[1] ?? {}, displayMode, true),
      )

    case "msub":
      return scriptedLayout(
        renderNode(children[0] ?? {}, displayMode, compact),
        renderNode(children[1] ?? {}, displayMode, true),
        null,
      )

    case "msubsup":
      return scriptedLayout(
        renderNode(children[0] ?? {}, displayMode, compact),
        renderNode(children[1] ?? {}, displayMode, true),
        renderNode(children[2] ?? {}, displayMode, true),
      )

    case "mfrac":
      return fractionLayout(
        renderNode(children[0] ?? {}, displayMode, true),
        renderNode(children[1] ?? {}, displayMode, true),
        displayMode,
        compact,
      )

    case "msqrt":
      return renderSqrt(children, displayMode, compact)

    case "mroot": {
      const inner = renderNode(children[0] ?? {}, displayMode, true)
      const index = scriptText(renderNode(children[1] ?? {}, displayMode, true), SUPERSCRIPT)
      return textLayout(`${index ?? ""}√${layoutToInlineString(inner)}`)
    }

    case "munder":
      return overUnderLayout(
        renderNode(children[0] ?? {}, displayMode, compact),
        renderNode(children[1] ?? {}, displayMode, true),
        null,
        displayMode,
        compact,
      )

    case "mover":
      return overUnderLayout(
        renderNode(children[0] ?? {}, displayMode, compact),
        null,
        renderNode(children[1] ?? {}, displayMode, true),
        displayMode,
        compact,
      )

    case "munderover":
      return overUnderLayout(
        renderNode(children[0] ?? {}, displayMode, compact),
        renderNode(children[1] ?? {}, displayMode, true),
        renderNode(children[2] ?? {}, displayMode, true),
        displayMode,
        compact,
      )

    case "mtable": {
      const rows = children
        .filter((child) => {
          const childName = nodeName(child)
          return childName === "mtr" || childName === "mlabeledtr"
        })
        .map((row) => {
          const rowName = nodeName(row)!
          return nodeChildren(row, rowName)
            .filter((cell) => nodeName(cell) === "mtd")
            .map((cell) => renderChildren(nodeChildren(cell, "mtd"), displayMode, compact))
        })
      return matrixLayout(rows, compact)
    }

    case "mtd":
      return renderChildren(children, displayMode, compact)

    case "annotation":
    case "none":
      return emptyLayout()

    default:
      return textLayout(textContent(children))
  }
}

function mathmlToText(mathml: string, displayMode: boolean): string {
  const parsed = parser.parse(mathml) as OrderedXmlNode[]
  const mathNode = findElement(parsed, "math")
  if (!mathNode) return ""

  const layout = renderNode(mathNode, displayMode)
  return layoutToString(layout)
}

export function clearLatexRenderCache(): void {
  renderCache.clear()
}

export function getLatexRenderCacheSize(): number {
  return renderCache.size
}

export function renderLatexToText(content: string, options: LatexRenderOptions = {}): LatexRenderResult {
  const key = cacheKey(content, options)
  const cached = renderCache.get(key)
  if (cached) return cached

  const displayMode = options.displayMode ?? true

  try {
    const mathml = katex.renderToString(content, makeKatexOptions(options))
    const text = mathmlToText(mathml, displayMode) || content
    const result = { text } satisfies LatexRenderResult
    setCachedResult(key, result)
    return result
  } catch (error) {
    if (options.throwOnError) {
      throw error
    }

    const result = {
      text: content,
      error: error instanceof Error ? error.message : String(error),
    } satisfies LatexRenderResult
    setCachedResult(key, result)
    return result
  }
}

export function renderLatexToStyledText(content: string, options: LatexStyledRenderOptions = {}): StyledText {
  const result = renderLatexToText(content, options)
  const chunk: TextChunk = {
    __isChunk: true,
    text: result.text,
    attributes: 0,
  }

  if (result.error) {
    chunk.fg = parseColor(options.errorFg ?? "red")
  }

  return new StyledText([chunk])
}

function findClosingInlineDollar(source: string, startIndex: number): number {
  for (let i = startIndex; i < source.length; i += 1) {
    const char = source[i]
    if (char === "\n" || char === "\r") return -1
    if (char === "\\") {
      i += 1
      continue
    }
    if (char !== "$" || source[i + 1] === "$") continue
    if (/\d/.test(source[i + 1] ?? "")) continue
    return i
  }

  return -1
}

export function replaceInlineLatex(
  source: string,
  options: LatexStyledRenderOptions & { conceal?: boolean } = {},
): string {
  let output = ""
  let index = 0

  while (index < source.length) {
    const char = source[index]

    if (char === "\\") {
      output += source.slice(index, index + 2)
      index += 2
      continue
    }

    if (char === "`") {
      const run = source.slice(index).match(/^`+/)?.[0] ?? "`"
      const closing = source.indexOf(run, index + run.length)
      if (closing === -1) {
        output += char
        index += 1
      } else {
        output += source.slice(index, closing + run.length)
        index = closing + run.length
      }
      continue
    }

    if (char !== "$" || source[index + 1] === "$" || /\s/.test(source[index + 1] ?? "")) {
      output += char
      index += 1
      continue
    }

    const closing = findClosingInlineDollar(source, index + 1)
    if (closing === -1) {
      output += char
      index += 1
      continue
    }

    const latex = source.slice(index + 1, closing)
    if (latex.trim().length === 0 || /\s$/.test(latex)) {
      output += char
      index += 1
      continue
    }

    const rendered = renderLatexToText(latex, {
      ...options,
      displayMode: false,
    }).text
    output += options.conceal === false ? `$${rendered}$` : rendered
    index = closing + 1
  }

  return output
}
