import { stringWidth, stripANSI } from "../platform/runtime.js"

export type ExternalOutputRendering = "emulated" | "terminal-native"

export interface ByteChunkExternalOutputCommit {
  kind: "bytes"
  snapshot?: undefined
  text: string
  bytes: Uint8Array
  rowWidths: Uint32Array
  startOnNewLine: false
  trailingNewline: boolean
}

const encoder = new TextEncoder()
const NEWLINE_CODE_POINT = "\n".charCodeAt(0)

function getByteChunkOutputRowWidth(line: string): number {
  const visibleLine = stripANSI(line).split("\r").at(-1) ?? ""
  return stringWidth(visibleLine)
}

function measureByteChunkRows(text: string): { rowWidths: Uint32Array; trailingNewline: boolean } | null {
  const rowWidths: number[] = []
  let rowStart = 0

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== NEWLINE_CODE_POINT) {
      continue
    }

    rowWidths.push(getByteChunkOutputRowWidth(text.slice(rowStart, index)))
    rowStart = index + 1
  }

  const trailingNewline = rowStart === text.length
  if (!trailingNewline) {
    rowWidths.push(getByteChunkOutputRowWidth(text.slice(rowStart)))
  }

  if (rowWidths.length === 0) {
    return null
  }

  return { rowWidths: Uint32Array.from(rowWidths), trailingNewline }
}

export function createByteChunkExternalOutputCommit(text: string): ByteChunkExternalOutputCommit | null {
  if (text.length === 0) {
    return null
  }

  const measuredRows = measureByteChunkRows(text)
  if (measuredRows === null) {
    return null
  }

  return {
    kind: "bytes",
    text,
    bytes: encoder.encode(text),
    rowWidths: measuredRows.rowWidths,
    startOnNewLine: false,
    trailingNewline: measuredRows.trailingNewline,
  }
}
