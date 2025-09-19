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

export interface FiletypeParserOptions {
  filetype: string
  queries: {
    highlights: string // URL to fetch the highlight query from
  }
  language: string
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
  dataPath: string
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
