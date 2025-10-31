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

export interface HighlightMeta {
  isInjection?: boolean
  injectionLang?: string
  containsInjection?: boolean
  conceal?: string | null // Value from (#set! conceal "...") predicate
  concealLines?: string | null // Value from (#set! conceal_lines "...") predicate - indicates the whole line should be concealed
}

export type SimpleHighlight = [number, number, string, HighlightMeta?]

export interface InjectionMapping {
  // Maps tree-sitter node types to target filetypes
  nodeTypes?: { [nodeType: string]: string }
  // Maps info string content (e.g., from code blocks) to target filetypes
  infoStringMap?: { [infoString: string]: string }
}

export interface FiletypeParserOptions {
  filetype: string
  queries: {
    highlights: string[] // Array of URLs or local file paths to fetch highlight queries from
    injections?: string[] // Array of URLs or local file paths to fetch injection queries from
  }
  wasm: string // URL or local file path to the language parser WASM file
  injectionMapping?: InjectionMapping // Optional mapping for injection handling
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
  "worker:log": [logType: "log" | "error", message: string]
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
