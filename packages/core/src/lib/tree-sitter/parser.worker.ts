import { Parser, Query, Tree, Language } from "web-tree-sitter"
import type { Edit, QueryCapture, Range } from "web-tree-sitter"
import { mkdir, readdir, writeFile } from "fs/promises"
import * as fs from "fs"
import * as path from "path"
import type { HighlightRange, HighlightResponse } from "./types"

const self = globalThis

type ParserState = {
  parser: Parser
  tree: Tree
  queries: {
    highlights: Query
  }
}

interface FiletypeParserOptions {
  filetype: string
  queries: {
    highlights: string
  }
  language: string
}

interface FiletypeParser {
  filetype: string
  queries: {
    highlights: Query
  }
  language: Language
}

interface PerformanceStats {
  averageParseTime: number
  parseTimes: number[]
  averageQueryTime: number
  queryTimes: number[]
}

export class ParserWorker {
  private bufferParsers: Map<number, ParserState> = new Map()
  private filetypeParserOptions: Map<string, FiletypeParserOptions> = new Map()
  private filetypeParsers: Map<string, FiletypeParser> = new Map()
  private languageFiles: Set<string> = new Set()
  private initializePromise: Promise<void> | undefined
  public performance: PerformanceStats
  private dataPath: string | undefined
  private initialized: boolean = false

  constructor() {
    this.performance = {
      averageParseTime: 0,
      parseTimes: [],
      averageQueryTime: 0,
      queryTimes: [],
    }
  }

  private async fetchHighlightQuery(url: string): Promise<string> {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch highlight query from ${url}: ${response.statusText}`)
      }
      return await response.text()
    } catch (error) {
      console.error(`Error fetching highlight query from ${url}:`, error)
      // Return empty query as fallback
      return ""
    }
  }

  async initialize({ dataPath }: { dataPath: string }) {
    if (this.initializePromise) {
      return this.initializePromise
    }
    this.initializePromise = new Promise(async (resolve, reject) => {
      this.dataPath = dataPath

      try {
        const languagesPath = path.join(dataPath, "languages")
        await mkdir(languagesPath, { recursive: true })
        const languageFiles = await readdir(languagesPath, { withFileTypes: true })
        for (const languageFile of languageFiles) {
          if (languageFile.isFile()) {
            this.languageFiles.add(languageFile.name)
          }
        }

        // Let web-tree-sitter handle wasm loading internally
        await Parser.init()

        this.initialized = true
        resolve()
      } catch (error) {
        reject(error)
      }
    })
    return this.initializePromise
  }

  public addFiletypeParser(filetypeParser: FiletypeParserOptions) {
    this.filetypeParserOptions.set(filetypeParser.filetype, filetypeParser)
  }

  private async createQueries(
    filetypeParser: FiletypeParserOptions,
    language: Language,
  ): Promise<
    | {
        highlights: Query
      }
    | undefined
  > {
    try {
      // Fetch the highlight query from URL
      const highlightQueryContent = await this.fetchHighlightQuery(filetypeParser.queries.highlights)
      if (!highlightQueryContent) {
        console.error("Failed to fetch highlight query for:", filetypeParser.filetype)
        return undefined
      }

      const query = new Query(language, highlightQueryContent)
      return {
        highlights: query,
      }
    } catch (error) {
      console.error(error)
      return undefined
    }
  }

  private async loadLanguage(languageSource: string): Promise<Language | undefined> {
    if (!this.initialized || !this.dataPath) {
      return undefined
    }
    const languageFileName = path.basename(languageSource)
    if (this.languageFiles.has(languageFileName)) {
      return Language.load(path.join(this.dataPath, "languages", languageFileName))
    }
    try {
      await fetch(languageSource)
        .then((response) => response.arrayBuffer())
        .then((buffer) => {
          if (!this.dataPath) {
            throw new Error("Data path not initialized")
          }
          return writeFile(path.join(this.dataPath, "languages", languageFileName), Buffer.from(buffer))
        })
    } catch (error) {
      return undefined
    }
    const language = await Language.load(path.join(this.dataPath, "languages", languageFileName))
    this.languageFiles.add(languageFileName)
    return language
  }

  private async resolveFiletypeParser(filetype: string): Promise<FiletypeParser | undefined> {
    if (this.filetypeParsers.has(filetype)) {
      return this.filetypeParsers.get(filetype)
    }
    const filetypeParserOptions = this.filetypeParserOptions.get(filetype)
    if (!filetypeParserOptions) {
      return undefined
    }
    const language = await this.loadLanguage(filetypeParserOptions.language)
    if (!language) {
      return undefined
    }
    const queries = await this.createQueries(filetypeParserOptions, language)
    if (!queries) {
      console.error("Failed to create queries for:", filetype)
      return undefined
    }
    const filetypeParser: FiletypeParser = {
      ...filetypeParserOptions,
      queries,
      language,
    }
    this.filetypeParsers.set(filetype, filetypeParser)
    return filetypeParser
  }

  public async preloadParser(filetype: string) {
    return this.resolveFiletypeParser(filetype)
  }

  async handleInitializeParser(
    bufferId: number,
    version: number,
    content: string,
    filetype: string,
    messageId: string,
  ) {
    const filetypeParser = await this.resolveFiletypeParser(filetype)

    if (!filetypeParser) {
      self.postMessage({
        type: "PARSER_INIT_RESPONSE",
        bufferId,
        messageId,
        hasParser: false,
        warning: `No parser available for filetype ${filetype}`,
      })
      return
    }

    const parser = new Parser()
    parser.setLanguage(filetypeParser.language)
    const tree = parser.parse(content)
    if (!tree) {
      self.postMessage({
        type: "PARSER_INIT_RESPONSE",
        bufferId,
        messageId,
        hasParser: false,
        error: "Failed to parse buffer",
      })
      return
    }

    const parserState = { parser, tree, queries: filetypeParser.queries }
    this.bufferParsers.set(bufferId, parserState)

    self.postMessage({
      type: "PARSER_INIT_RESPONSE",
      bufferId,
      messageId,
      hasParser: true,
    })
    const highlights = this.initialQuery(parserState)
    self.postMessage({
      type: "HIGHLIGHT_RESPONSE",
      bufferId,
      version,
      ...highlights,
    })
  }

  private initialQuery(parserState: ParserState) {
    const query = parserState.queries.highlights
    const matches: QueryCapture[] = query.captures(parserState.tree.rootNode)
    return this.getHighlights(parserState, matches)
  }

  private editToRange(edit: Edit): Range {
    return {
      startPosition: {
        column: edit.startPosition.column,
        row: edit.startPosition.row,
      },
      endPosition: {
        column: edit.newEndPosition.column,
        row: edit.newEndPosition.row,
      },
      startIndex: edit.startIndex,
      endIndex: edit.newEndIndex,
    }
  }

  async handleEdits(
    bufferId: number,
    content: string,
    edits: Edit[],
  ): Promise<{ highlights?: HighlightResponse[]; warning?: string; error?: string }> {
    const parserState = this.bufferParsers.get(bufferId)
    if (!parserState) {
      return { warning: "No parser state found for buffer" }
    }

    for (const edit of edits) {
      parserState.tree.edit(edit)
    }

    // Parse the buffer
    const startParse = performance.now()

    const newTree = parserState.parser.parse(content, parserState.tree)

    const endParse = performance.now()
    const parseTime = endParse - startParse
    this.performance.parseTimes.push(parseTime)
    if (this.performance.parseTimes.length > 10) {
      this.performance.parseTimes.shift()
    }
    this.performance.averageParseTime =
      this.performance.parseTimes.reduce((acc, time) => acc + time, 0) / this.performance.parseTimes.length

    if (!newTree) {
      return { error: "Failed to parse buffer" }
    }

    // Get changed ranges between old and new tree
    const changedRanges = parserState.tree.getChangedRanges(newTree)
    parserState.tree = newTree

    // Query the buffer
    const startQuery = performance.now()
    const matches: QueryCapture[] = []

    // If no changed ranges detected, use the edit ranges as fallback
    if (changedRanges.length === 0) {
      edits.forEach((edit) => {
        const range = this.editToRange(edit)
        changedRanges.push(range)
      })
    }

    for (const range of changedRanges) {
      let node = parserState.tree.rootNode.descendantForPosition(range.startPosition, range.endPosition)

      if (!node) {
        continue
      }

      // If we got the root node, query with range to limit scope
      if (node.equals(parserState.tree.rootNode)) {
        // WHY ARE RANGES NOT WORKING!?
        // The changed ranges are not returning anything in some cases
        // Even this shit somehow returns many lines before the actual range,
        // and even though expanded by 1000 bytes it does not capture much beyond the actual range.
        // So freaking weird.
        const rangeCaptures = parserState.queries.highlights.captures(
          node,
          // WTF!?
          {
            startIndex: range.startIndex - 100,
            endIndex: range.endIndex + 1000,
          },
        )
        matches.push(...rangeCaptures)
        continue
      }

      // For smaller nodes, walk up until we find a node that fully contains the range
      while (node && !this.nodeContainsRange(node, range)) {
        node = node.parent
      }

      if (!node) {
        node = parserState.tree.rootNode
      }

      // Query the containing node
      const nodeCaptures = parserState.queries.highlights.captures(node)
      matches.push(...nodeCaptures)
    }

    const endQuery = performance.now()
    const queryTime = endQuery - startQuery
    this.performance.queryTimes.push(queryTime)
    if (this.performance.queryTimes.length > 10) {
      this.performance.queryTimes.shift()
    }
    this.performance.averageQueryTime =
      this.performance.queryTimes.reduce((acc, time) => acc + time, 0) / this.performance.queryTimes.length

    return this.getHighlights(parserState, matches)
  }

  private nodeContainsRange(node: any, range: any): boolean {
    return (
      node.startPosition.row <= range.startPosition.row &&
      node.endPosition.row >= range.endPosition.row &&
      (node.startPosition.row < range.startPosition.row || node.startPosition.column <= range.startPosition.column) &&
      (node.endPosition.row > range.endPosition.row || node.endPosition.column >= range.endPosition.column)
    )
  }

  private getHighlights(parserState: ParserState, matches: QueryCapture[]): { highlights: HighlightResponse[] } {
    const lineHighlights: Map<number, Map<number, HighlightRange>> = new Map()
    const droppedHighlights: Map<number, Map<number, HighlightRange>> = new Map()

    for (const match of matches) {
      const node = match.node
      const startLine = node.startPosition.row
      const endLine = node.endPosition.row

      const highlight = {
        startCol: node.startPosition.column,
        endCol: node.endPosition.column,
        group: match.name,
      }

      if (!lineHighlights.has(startLine)) {
        lineHighlights.set(startLine, new Map())
        droppedHighlights.set(startLine, new Map())
      }
      if (lineHighlights.get(startLine)?.has(node.id)) {
        droppedHighlights.get(startLine)?.set(node.id, lineHighlights.get(startLine)?.get(node.id)!)
      }
      lineHighlights.get(startLine)?.set(node.id, highlight)

      if (startLine !== endLine) {
        for (let line = startLine + 1; line <= endLine; line++) {
          if (!lineHighlights.has(line)) {
            lineHighlights.set(line, new Map())
          }
          const hl: HighlightRange = {
            startCol: 0,
            endCol: node.endPosition.column,
            group: match.name,
          }
          lineHighlights.get(line)?.set(node.id, hl)
        }
      }
    }

    return {
      highlights: Array.from(lineHighlights.entries()).map(([line, lineHighlights]) => ({
        line,
        highlights: Array.from(lineHighlights.values()),
        droppedHighlights: droppedHighlights.get(line) ? Array.from(droppedHighlights.get(line)!.values()) : [],
      })),
    }
  }

  async handleResetBuffer(
    bufferId: number,
    version: number,
    content: string,
  ): Promise<{ highlights?: HighlightResponse[]; warning?: string; error?: string }> {
    const parserState = this.bufferParsers.get(bufferId)
    if (!parserState) {
      return { warning: "No parser state found for buffer" }
    }

    const newTree = parserState.parser.parse(content)

    if (!newTree) {
      return { error: "Failed to parse buffer during reset" }
    }

    parserState.tree = newTree
    const matches = parserState.queries.highlights.captures(parserState.tree.rootNode)

    return this.getHighlights(parserState, matches)
  }

  disposeBuffer(bufferId: number): void {
    const parserState = this.bufferParsers.get(bufferId)
    if (!parserState) {
      return
    }

    parserState.tree.delete()
    parserState.parser.delete()

    this.bufferParsers.delete(bufferId)
  }
}

const worker = new ParserWorker()

function logMessage(type: "log" | "error", ...args: any[]) {
  self.postMessage({
    type: "WORKER_LOG",
    logType: type,
    data: args,
  })
}
console.log = (...args) => logMessage("log", ...args)
console.error = (...args) => logMessage("error", ...args)

// @ts-ignore - we'll fix this in the future for sure
self.onmessage = async (e: MessageEvent) => {
  const { type, bufferId, version, content, filetype, edits, filetypeParser, messageId, dataPath } = e.data

  try {
    switch (type) {
      case "INIT":
        try {
          await worker.initialize({ dataPath })
          self.postMessage({ type: "INIT_RESPONSE" })
        } catch (error) {
          self.postMessage({
            type: "INIT_RESPONSE",
            error: error instanceof Error ? error.stack || error.message : String(error),
          })
        }
        break

      case "ADD_FILETYPE_PARSER":
        worker.addFiletypeParser(filetypeParser)
        break

      case "PRELOAD_PARSER":
        const maybeParser = await worker.preloadParser(filetype)
        self.postMessage({ type: "PRELOAD_PARSER_RESPONSE", messageId, hasParser: !!maybeParser })
        break

      case "INITIALIZE_PARSER":
        await worker.handleInitializeParser(bufferId, version, content, filetype, messageId)
        break

      case "HANDLE_EDITS":
        const response = await worker.handleEdits(bufferId, content, edits)
        if (response.highlights && response.highlights.length > 0) {
          self.postMessage({ type: "HIGHLIGHT_RESPONSE", bufferId, version, ...response })
        } else if (response.warning) {
          self.postMessage({ type: "WARNING", bufferId, warning: response.warning })
        } else if (response.error) {
          self.postMessage({ type: "ERROR", bufferId, error: response.error })
        }
        break

      case "GET_PERFORMANCE":
        self.postMessage({ type: "PERFORMANCE_RESPONSE", performance: worker.performance, messageId })
        break

      case "RESET_BUFFER":
        const resetResponse = await worker.handleResetBuffer(bufferId, version, content)
        if (resetResponse.highlights && resetResponse.highlights.length > 0) {
          self.postMessage({ type: "HIGHLIGHT_RESPONSE", bufferId, version, ...resetResponse })
        } else if (resetResponse.warning) {
          self.postMessage({ type: "WARNING", bufferId, warning: resetResponse.warning })
        } else if (resetResponse.error) {
          self.postMessage({ type: "ERROR", bufferId, error: resetResponse.error })
        }
        break

      case "DISPOSE_BUFFER":
        worker.disposeBuffer(bufferId)
        self.postMessage({ type: "BUFFER_DISPOSED", bufferId })
        break

      default:
        self.postMessage({
          type: "ERROR",
          bufferId,
          error: `Unknown message type: ${type}`,
        })
    }
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      bufferId,
      error: error instanceof Error ? error.stack || error.message : String(error),
    })
  }
}
