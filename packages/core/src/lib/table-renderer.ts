import type { TextChunk } from "../text-buffer"
import type { SyntaxStyle, StyleDefinition } from "../syntax-style"
import { createTextAttributes } from "../utils"
import type { SimpleHighlight } from "./tree-sitter/types"

const BOX_CHARS = {
  unicode: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    leftT: "├",
    rightT: "┤",
    topT: "┬",
    bottomT: "┴",
    cross: "┼",
    headerHorizontal: "─",
    headerLeftT: "├",
    headerRightT: "┤",
    headerCross: "┼",
  },
  ascii: {
    topLeft: "+",
    topRight: "+",
    bottomLeft: "+",
    bottomRight: "+",
    horizontal: "-",
    vertical: "|",
    leftT: "+",
    rightT: "+",
    topT: "+",
    bottomT: "+",
    cross: "+",
    headerHorizontal: "-",
    headerLeftT: "+",
    headerRightT: "+",
    headerCross: "+",
  },
  compact: {
    topLeft: "",
    topRight: "",
    bottomLeft: "",
    bottomRight: "",
    horizontal: "",
    vertical: " ",
    leftT: "",
    rightT: "",
    topT: "",
    bottomT: "",
    cross: "",
    headerHorizontal: "─",
    headerLeftT: "",
    headerRightT: "",
    headerCross: "─",
  },
} as const

export type TableStyle = keyof typeof BOX_CHARS
export type TextAlign = "left" | "center" | "right"

export interface TableRenderOptions {
  style?: TableStyle
  maxColumnWidth?: number
  minColumnWidth?: number
  cellPadding?: number
}

export interface TableCell {
  content: string
  displayWidth: number
  align: TextAlign
}

export interface TableRow {
  cells: TableCell[]
  isHeader: boolean
  isDelimiter: boolean
}

export interface ParsedTable {
  rows: TableRow[]
  columnWidths: number[]
  columnAligns: TextAlign[]
  startOffset: number
  endOffset: number
}

export interface TableRange {
  start: number
  end: number
}

export function getDisplayWidth(str: string): number {
  if (typeof Bun !== "undefined" && typeof Bun.stringWidth === "function") {
    return Bun.stringWidth(str)
  }

  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0) || 0

    // CJK Unified Ideographs: U+4E00–U+9FFF
    if (code >= 0x4e00 && code <= 0x9fff) {
      width += 2
      continue
    }
    // CJK Extension A: U+3400–U+4DBF
    if (code >= 0x3400 && code <= 0x4dbf) {
      width += 2
      continue
    }
    // CJK Compatibility Ideographs: U+F900–U+FAFF
    if (code >= 0xf900 && code <= 0xfaff) {
      width += 2
      continue
    }
    // Fullwidth Forms: U+FF00–U+FF60
    if (code >= 0xff00 && code <= 0xff60) {
      width += 2
      continue
    }
    // CJK Symbols and Punctuation: U+3000–U+303F
    if (code >= 0x3000 && code <= 0x303f) {
      width += 2
      continue
    }
    // Hiragana: U+3040–U+309F
    if (code >= 0x3040 && code <= 0x309f) {
      width += 2
      continue
    }
    // Katakana: U+30A0–U+30FF
    if (code >= 0x30a0 && code <= 0x30ff) {
      width += 2
      continue
    }
    // Hangul Syllables: U+AC00–U+D7AF
    if (code >= 0xac00 && code <= 0xd7af) {
      width += 2
      continue
    }
    // Emoji: U+1F300–U+1F9FF
    if (code >= 0x1f300 && code <= 0x1f9ff) {
      width += 2
      continue
    }
    // Emoji Emoticons: U+1F600–U+1F64F
    if (code >= 0x1f600 && code <= 0x1f64f) {
      width += 2
      continue
    }

    width += 1
  }

  return width
}

export function padToWidth(str: string, targetWidth: number, align: TextAlign): string {
  const currentWidth = getDisplayWidth(str)
  const padding = targetWidth - currentWidth

  if (padding <= 0) return str

  switch (align) {
    case "right":
      return " ".repeat(padding) + str
    case "center": {
      const left = Math.floor(padding / 2)
      const right = padding - left
      return " ".repeat(left) + str + " ".repeat(right)
    }
    default:
      return str + " ".repeat(padding)
  }
}

export function truncateToWidth(str: string, maxWidth: number): string {
  if (maxWidth < 3) return str.slice(0, maxWidth)

  const width = getDisplayWidth(str)
  if (width <= maxWidth) return str

  let result = ""
  let currentWidth = 0
  const ellipsis = "…"
  const targetWidth = maxWidth - 1

  for (const char of str) {
    const charWidth = getDisplayWidth(char)
    if (currentWidth + charWidth > targetWidth) break
    result += char
    currentWidth += charWidth
  }

  return result + ellipsis
}

function parseAlignment(delimiterCell: string): TextAlign {
  const trimmed = delimiterCell.trim().replace(/\|/g, "")
  const hasLeftColon = trimmed.startsWith(":")
  const hasRightColon = trimmed.endsWith(":")

  if (hasLeftColon && hasRightColon) return "center"
  if (hasRightColon) return "right"
  return "left"
}

export function detectTableRanges(content: string, highlights: SimpleHighlight[]): TableRange[] {
  const ranges: TableRange[] = []
  const lines = content.split("\n")
  let tableStart: number | null = null
  let currentOffset = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineStart = currentOffset
    const isTableLine = line.includes("|") && !line.trim().startsWith("```")

    if (isTableLine) {
      if (tableStart === null) {
        tableStart = lineStart
      }
    } else {
      if (tableStart !== null) {
        ranges.push({ start: tableStart, end: currentOffset - 1 })
        tableStart = null
      }
    }

    currentOffset = lineStart + line.length + 1
  }

  if (tableStart !== null) {
    ranges.push({ start: tableStart, end: content.length })
  }

  return ranges.filter((range) => {
    const tableContent = content.slice(range.start, range.end)
    const tableLines = tableContent.split("\n").filter((l) => l.trim())

    if (tableLines.length < 2) return false

    const hasDelimiter = tableLines.some((line) => /\|[\s-:]+\|/.test(line) || /^[\s-:|]+$/.test(line.trim()))

    return hasDelimiter
  })
}

export function parseTable(content: string, startOffset: number = 0): ParsedTable | null {
  const lines = content.split("\n").filter((l) => l.trim())

  if (lines.length < 2) return null

  let delimiterIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^[\s|:-]+$/.test(line) && line.includes("-")) {
      delimiterIdx = i
      break
    }
  }

  if (delimiterIdx === -1 || delimiterIdx === 0) {
    return null
  }

  const delimiterCells = parseRowCells(lines[delimiterIdx])
  const columnAligns: TextAlign[] = delimiterCells.map(parseAlignment)

  const rows: TableRow[] = []
  const columnWidths: number[] = new Array(columnAligns.length).fill(0)

  for (let i = 0; i < lines.length; i++) {
    if (i === delimiterIdx) {
      rows.push({
        cells: delimiterCells.map((c, idx) => ({
          content: c.trim(),
          displayWidth: getDisplayWidth(c.trim()),
          align: columnAligns[idx] || "left",
        })),
        isHeader: false,
        isDelimiter: true,
      })
      continue
    }

    const cells = parseRowCells(lines[i])
    const isHeader = i < delimiterIdx

    const rowCells: TableCell[] = []
    for (let j = 0; j < columnAligns.length; j++) {
      const cellContent = (cells[j] || "").trim()
      const displayWidth = getDisplayWidth(cellContent)

      rowCells.push({
        content: cellContent,
        displayWidth,
        align: columnAligns[j] || "left",
      })

      if (!lines[i].includes("---")) {
        columnWidths[j] = Math.max(columnWidths[j], displayWidth)
      }
    }

    rows.push({
      cells: rowCells,
      isHeader,
      isDelimiter: false,
    })
  }

  return {
    rows,
    columnWidths,
    columnAligns,
    startOffset,
    endOffset: startOffset + content.length,
  }
}

function parseRowCells(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1)
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1)

  return trimmed.split("|").map((c) => c.trim())
}

function createChunk(text: string, style?: StyleDefinition): TextChunk {
  return {
    __isChunk: true,
    text,
    fg: style?.fg,
    bg: style?.bg,
    attributes: style
      ? createTextAttributes({
          bold: style.bold,
          italic: style.italic,
          underline: style.underline,
          dim: style.dim,
        })
      : 0,
  }
}

export function renderTable(
  table: ParsedTable,
  syntaxStyle: SyntaxStyle,
  options: TableRenderOptions = {},
): TextChunk[] {
  const { style = "unicode", maxColumnWidth = 50, minColumnWidth = 3, cellPadding = 1 } = options

  const chars = BOX_CHARS[style]
  const chunks: TextChunk[] = []

  const borderStyle = syntaxStyle.getStyle("punctuation.special") || syntaxStyle.getStyle("default")
  const headerStyle = syntaxStyle.getStyle("markup.heading") || syntaxStyle.getStyle("default")
  const cellStyle = syntaxStyle.getStyle("default")

  const columnWidths = table.columnWidths.map(
    (w) => Math.min(maxColumnWidth, Math.max(minColumnWidth, w)) + cellPadding * 2,
  )

  const addBorder = (text: string) => {
    chunks.push(createChunk(text, borderStyle))
  }

  const addCell = (content: string, width: number, align: TextAlign, isHeader: boolean) => {
    const truncated = truncateToWidth(content, width - cellPadding * 2)
    const padded = padToWidth(truncated, width - cellPadding * 2, align)
    const paddedContent = " ".repeat(cellPadding) + padded + " ".repeat(cellPadding)
    chunks.push(createChunk(paddedContent, isHeader ? headerStyle : cellStyle))
  }

  if (style !== "compact") {
    addBorder(chars.topLeft)
    for (let i = 0; i < columnWidths.length; i++) {
      addBorder(chars.horizontal.repeat(columnWidths[i]))
      if (i < columnWidths.length - 1) {
        addBorder(chars.topT)
      }
    }
    addBorder(chars.topRight)
    chunks.push(createChunk("\n"))
  }

  for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
    const row = table.rows[rowIdx]

    if (row.isDelimiter) {
      if (style !== "compact") {
        addBorder(chars.headerLeftT)
        for (let i = 0; i < columnWidths.length; i++) {
          addBorder(chars.headerHorizontal.repeat(columnWidths[i]))
          if (i < columnWidths.length - 1) {
            addBorder(chars.headerCross)
          }
        }
        addBorder(chars.headerRightT)
        chunks.push(createChunk("\n"))
      } else {
        for (let i = 0; i < columnWidths.length; i++) {
          addBorder(chars.headerHorizontal.repeat(columnWidths[i]))
          if (i < columnWidths.length - 1) {
            addBorder(" ")
          }
        }
        chunks.push(createChunk("\n"))
      }
      continue
    }

    if (style !== "compact") {
      addBorder(chars.vertical)
    }

    for (let i = 0; i < columnWidths.length; i++) {
      const cell = row.cells[i] || { content: "", displayWidth: 0, align: "left" as TextAlign }
      addCell(cell.content, columnWidths[i], cell.align, row.isHeader)

      if (i < columnWidths.length - 1) {
        addBorder(chars.vertical)
      }
    }

    if (style !== "compact") {
      addBorder(chars.vertical)
    }
    chunks.push(createChunk("\n"))
  }

  if (style !== "compact") {
    addBorder(chars.bottomLeft)
    for (let i = 0; i < columnWidths.length; i++) {
      addBorder(chars.horizontal.repeat(columnWidths[i]))
      if (i < columnWidths.length - 1) {
        addBorder(chars.bottomT)
      }
    }
    addBorder(chars.bottomRight)
  }

  return chunks
}

export function processContentWithTables(
  content: string,
  highlights: SimpleHighlight[],
  syntaxStyle: SyntaxStyle,
  options: TableRenderOptions = {},
  processNonTable: (content: string, highlights: SimpleHighlight[], syntaxStyle: SyntaxStyle) => TextChunk[],
): TextChunk[] {
  const tableRanges = detectTableRanges(content, highlights)

  if (tableRanges.length === 0) {
    return processNonTable(content, highlights, syntaxStyle)
  }

  const chunks: TextChunk[] = []
  let lastEnd = 0

  for (const range of tableRanges) {
    if (range.start > lastEnd) {
      const nonTableContent = content.slice(lastEnd, range.start)
      const adjustedHighlights = highlights
        .filter((h) => h[0] >= lastEnd && h[1] <= range.start)
        .map((h): SimpleHighlight => [h[0] - lastEnd, h[1] - lastEnd, h[2], h[3]])

      chunks.push(...processNonTable(nonTableContent, adjustedHighlights, syntaxStyle))
    }

    const tableContent = content.slice(range.start, range.end)
    const parsedTable = parseTable(tableContent, range.start)

    if (parsedTable) {
      chunks.push(...renderTable(parsedTable, syntaxStyle, options))
    } else {
      const tableHighlights = highlights
        .filter((h) => h[0] >= range.start && h[1] <= range.end)
        .map((h): SimpleHighlight => [h[0] - range.start, h[1] - range.start, h[2], h[3]])

      chunks.push(...processNonTable(tableContent, tableHighlights, syntaxStyle))
    }

    lastEnd = range.end
  }

  if (lastEnd < content.length) {
    const remainingContent = content.slice(lastEnd)
    const adjustedHighlights = highlights
      .filter((h) => h[0] >= lastEnd)
      .map((h): SimpleHighlight => [h[0] - lastEnd, h[1] - lastEnd, h[2], h[3]])

    chunks.push(...processNonTable(remainingContent, adjustedHighlights, syntaxStyle))
  }

  return chunks
}
