import { stringWidth, stripANSI } from "../platform/runtime.js"

export type ExternalOutputRendering = "emulated" | "terminal-native"

export interface ByteChunkExternalOutputCommit {
  kind: "bytes"
  snapshot?: undefined
  text: string
  bytes: Uint8Array
  rowColumnsByRow: Uint32Array
  startOnNewLine: false
  trailingNewline: boolean
}

const encoder = new TextEncoder()
const NEWLINE_CODE_POINT = "\n".charCodeAt(0)

function getByteChunkOutputRowWidth(line: string): number {
  const visibleLine = stripANSI(line).split("\r").at(-1) ?? ""
  return stringWidth(visibleLine)
}

function measureByteChunkRows(text: string): { rowColumnsByRow: Uint32Array; trailingNewline: boolean } | null {
  const rowColumnsByRow: number[] = []
  let rowStart = 0

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== NEWLINE_CODE_POINT) {
      continue
    }

    rowColumnsByRow.push(getByteChunkOutputRowWidth(text.slice(rowStart, index)))
    rowStart = index + 1
  }

  const trailingNewline = rowStart === text.length
  if (!trailingNewline) {
    rowColumnsByRow.push(getByteChunkOutputRowWidth(text.slice(rowStart)))
  }

  if (rowColumnsByRow.length === 0) {
    return null
  }

  return { rowColumnsByRow: Uint32Array.from(rowColumnsByRow), trailingNewline }
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
    rowColumnsByRow: measuredRows.rowColumnsByRow,
    startOnNewLine: false,
    trailingNewline: measuredRows.trailingNewline,
  }
}
