export interface HighlightRange {
  startCol: number
  endCol: number
  group: string
}

export interface HighlightResponse {
  line: number
  highlights: HighlightRange[]
  droppedHighlights: HighlightRange[]
}

export type SimpleHighlight = [number, number, string]

export interface FiletypeParserOptions {
  filetype: string
  queries: {
    highlights: string // URL or local file path to fetch the highlight query from
  }
  language: string // URL or local file path to the language parser WASM file
}

export interface BufferState {
  id: number
  version: number
  content: string
  filetype: string
  hasParser: boolean
}

export interface ParsedBuffer extends BufferState {
  hasParser: true
}

export interface TreeSitterClientEvents {
  "highlights:response": [bufferId: number, version: number, highlights: HighlightResponse[]]
  "buffer:initialized": [bufferId: number, hasParser: boolean]
  "buffer:disposed": [bufferId: number]
  error: [error: string, bufferId?: number]
  warning: [warning: string, bufferId?: number]
}

export interface TreeSitterClientOptions {
  dataPath: string // Directory for storing downloaded parsers and queries
  workerPath?: string | URL
  initTimeout?: number // Timeout in milliseconds for worker initialization, defaults to 10000
}

export interface Edit {
  startIndex: number
  oldEndIndex: number
  newEndIndex: number
  startPosition: { row: number; column: number }
  oldEndPosition: { row: number; column: number }
  newEndPosition: { row: number; column: number }
}

export interface PerformanceStats {
  averageParseTime: number
  parseTimes: number[]
  averageQueryTime: number
  queryTimes: number[]
}
