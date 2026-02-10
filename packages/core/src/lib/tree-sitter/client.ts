import { EventEmitter } from "events"
import { createDebounce, clearDebounceScope, DebounceController } from "../debounce"
import { ProcessQueue } from "../queue"
import type {
  TreeSitterClientOptions,
  TreeSitterClientEvents,
  BufferState,
  ParsedBuffer,
  FiletypeParserOptions,
  Edit,
  PerformanceStats,
  SimpleHighlight,
} from "./types"
import { getParsers } from "./default-parsers"
import { resolve, isAbsolute, parse } from "path"
import { existsSync } from "fs"
import { registerEnvVar, env } from "../env"
import { isBunfsPath, normalizeBunfsPath } from "../bunfs"

registerEnvVar({
  name: "OTUI_TREE_SITTER_WORKER_PATH",
  description: "Path to the TreeSitter worker",
  type: "string",
  default: "",
})

declare global {
  const OTUI_TREE_SITTER_WORKER_PATH: string
}

interface EditQueueItem {
  edits: Edit[]
  newContent: string
  version: number
  isReset?: boolean
}

let DEFAULT_PARSERS: FiletypeParserOptions[] = getParsers()

export function addDefaultParsers(parsers: FiletypeParserOptions[]): void {
  for (const parser of parsers) {
    const existingIndex = DEFAULT_PARSERS.findIndex((p) => p.filetype === parser.filetype)

    if (existingIndex >= 0) {
      DEFAULT_PARSERS[existingIndex] = parser
    } else {
      DEFAULT_PARSERS.push(parser)
    }
  }
}

const isUrl = (path: string) => path.startsWith("http://") || path.startsWith("https://")

// Parser options now support both URLs and local file paths
// TODO: TreeSitterClient should have a setOptions method, passing it on to the worker etc.
export class TreeSitterClient extends EventEmitter<TreeSitterClientEvents> {
  private initialized = false
  private worker: Worker | undefined
  private buffers: Map<number, BufferState> = new Map()
  private initializePromise: Promise<void> | undefined
  private initializeResolvers:
    | { resolve: () => void; reject: (error: Error) => void; timeoutId: ReturnType<typeof setTimeout> }
    | undefined
  private messageCallbacks: Map<string, (response: any) => void> = new Map()
  private messageIdCounter: number = 0
  private editQueues: Map<number, ProcessQueue<EditQueueItem>> = new Map()
  private debouncer: DebounceController
  private options: TreeSitterClientOptions

  constructor(options: TreeSitterClientOptions) {
    super()
    this.options = options
    this.debouncer = createDebounce("tree-sitter-client")
    this.startWorker()
  }

  private emitError(error: string, bufferId?: number): void {
    if (this.listenerCount("error") > 0) {
      this.emit("error", error, bufferId)
    }
  }

  private emitWarning(warning: string, bufferId?: number): void {
    if (this.listenerCount("warning") > 0) {
      this.emit("warning", warning, bufferId)
    }
  }

  private startWorker() {
    if (this.worker) {
      return
    }

    let worker_path: string | URL

    if (env.OTUI_TREE_SITTER_WORKER_PATH) {
      worker_path = env.OTUI_TREE_SITTER_WORKER_PATH
    } else if (typeof OTUI_TREE_SITTER_WORKER_PATH !== "undefined") {
      worker_path = OTUI_TREE_SITTER_WORKER_PATH
    } else if (this.options.workerPath) {
      worker_path = this.options.workerPath
    } else {
      worker_path = new URL("./parser.worker.js", import.meta.url).href
      if (!existsSync(resolve(import.meta.dirname, "parser.worker.js"))) {
        worker_path = new URL("./parser.worker.ts", import.meta.url).href
      }
    }

    this.worker = new Worker(worker_path)

    // @ts-ignore - onmessage exists
    this.worker.onmessage = this.handleWorkerMessage.bind(this)

    // @ts-ignore - onerror exists
    this.worker.onerror = (error: ErrorEvent) => {
      console.error("TreeSitter worker error:", error.message)

      // If we're still initializing, reject the init promise
      if (this.initializeResolvers) {
        clearTimeout(this.initializeResolvers.timeoutId)
        this.initializeResolvers.reject(new Error(`Worker error: ${error.message}`))
        this.initializeResolvers = undefined
      }

      this.emitError(`Worker error: ${error.message}`)
    }
  }

  private stopWorker() {
    if (!this.worker) {
      return
    }

    this.worker.terminate()
    this.worker = undefined
  }

  // NOTE: Unused, but useful for debugging and testing
  private handleReset() {
    this.buffers.clear()
    this.stopWorker()
    this.startWorker()
    this.initializePromise = undefined
    this.initializeResolvers = undefined
    return this.initialize()
  }

  async initialize(): Promise<void> {
    if (this.initializePromise) {
      return this.initializePromise
    }

    this.initializePromise = new Promise((resolve, reject) => {
      const timeoutMs = this.options.initTimeout ?? 10000 // Default to 10 seconds
      const timeoutId = setTimeout(() => {
        const error = new Error("Worker initialization timed out")
        console.error("TreeSitter client:", error.message)
        this.initializeResolvers = undefined
        reject(error)
      }, timeoutMs)

      this.initializeResolvers = { resolve, reject, timeoutId }
      this.worker?.postMessage({
        type: "INIT",
        dataPath: this.options.dataPath,
      })
    })

    await this.initializePromise
    await this.registerDefaultParsers()

    return this.initializePromise
  }

  private async registerDefaultParsers(): Promise<void> {
    for (const parser of DEFAULT_PARSERS) {
      this.addFiletypeParser(parser)
    }
  }

  private resolvePath(path: string): string {
    if (isUrl(path)) {
      return path
    }
    if (isBunfsPath(path)) {
      return normalizeBunfsPath(parse(path).base)
    }
    if (!isAbsolute(path)) {
      return resolve(path)
    }
    return path
  }

  public addFiletypeParser(filetypeParser: FiletypeParserOptions): void {
    const resolvedParser: FiletypeParserOptions = {
      ...filetypeParser,
      wasm: this.resolvePath(filetypeParser.wasm),
      queries: {
        highlights: filetypeParser.queries.highlights.map((path) => this.resolvePath(path)),
        injections: filetypeParser.queries.injections?.map((path) => this.resolvePath(path)),
      },
    }
    this.worker?.postMessage({ type: "ADD_FILETYPE_PARSER", filetypeParser: resolvedParser })
  }

  public async getPerformance(): Promise<PerformanceStats> {
    const messageId = `performance_${this.messageIdCounter++}`
    return new Promise<PerformanceStats>((resolve) => {
      this.messageCallbacks.set(messageId, resolve)
      this.worker?.postMessage({ type: "GET_PERFORMANCE", messageId })
    })
  }

  public async highlightOnce(
    content: string,
    filetype: string,
  ): Promise<{ highlights?: SimpleHighlight[]; warning?: string; error?: string }> {
    if (!this.initialized) {
      try {
        await this.initialize()
      } catch (error) {
        return { error: "Could not highlight because of initialization error" }
      }
    }

    const messageId = `oneshot_${this.messageIdCounter++}`
    return new Promise((resolve) => {
      this.messageCallbacks.set(messageId, resolve)
      this.worker?.postMessage({
        type: "ONESHOT_HIGHLIGHT",
        content,
        filetype,
        messageId,
      })
    })
  }

  private handleWorkerMessage(event: MessageEvent) {
    const { type, bufferId, error, highlights, warning, messageId, hasParser, performance, version } = event.data

    if (type === "HIGHLIGHT_RESPONSE") {
      const buffer = this.buffers.get(bufferId)
      if (!buffer || !buffer.hasParser) return
      if (buffer.version !== version) {
        this.resetBuffer(bufferId, buffer.version, buffer.content)
        return
      }
      this.emit("highlights:response", bufferId, version, highlights)
    }

    if (type === "INIT_RESPONSE") {
      if (this.initializeResolvers) {
        clearTimeout(this.initializeResolvers.timeoutId)
        if (error) {
          console.error("TreeSitter client initialization failed:", error)
          this.initializeResolvers.reject(new Error(error))
        } else {
          this.initialized = true
          this.initializeResolvers.resolve()
        }
        this.initializeResolvers = undefined
        return
      }
    }

    if (type === "PARSER_INIT_RESPONSE") {
      const callback = this.messageCallbacks.get(messageId)
      if (callback) {
        this.messageCallbacks.delete(messageId)
        callback({ hasParser, warning, error })
      }
      return
    }

    if (type === "PRELOAD_PARSER_RESPONSE") {
      const callback = this.messageCallbacks.get(messageId)
      if (callback) {
        this.messageCallbacks.delete(messageId)
        callback({ hasParser })
      }
      return
    }

    if (type === "BUFFER_DISPOSED") {
      const callback = this.messageCallbacks.get(`dispose_${bufferId}`)
      if (callback) {
        this.messageCallbacks.delete(`dispose_${bufferId}`)
        callback(true)
      }
      this.emit("buffer:disposed", bufferId)
      return
    }

    if (type === "PERFORMANCE_RESPONSE") {
      const callback = this.messageCallbacks.get(messageId)
      if (callback) {
        this.messageCallbacks.delete(messageId)
        callback(performance)
      }
      return
    }

    if (type === "ONESHOT_HIGHLIGHT_RESPONSE") {
      const callback = this.messageCallbacks.get(messageId)
      if (callback) {
        this.messageCallbacks.delete(messageId)
        callback({ highlights, warning, error })
      }
      return
    }

    if (type === "UPDATE_DATA_PATH_RESPONSE") {
      const callback = this.messageCallbacks.get(messageId)
      if (callback) {
        this.messageCallbacks.delete(messageId)
        callback({ error })
      }
      return
    }

    if (type === "CLEAR_CACHE_RESPONSE") {
      const callback = this.messageCallbacks.get(messageId)
      if (callback) {
        this.messageCallbacks.delete(messageId)
        callback({ error })
      }
      return
    }

    if (warning) {
      this.emitWarning(warning, bufferId)
      return
    }

    if (error) {
      this.emitError(error, bufferId)
      return
    }

    if (type === "WORKER_LOG") {
      const { logType, data } = event.data
      const message = data.join(" ")

      this.emit("worker:log", logType, message)

      if (logType === "log") {
        console.log("TSWorker:", ...data)
      } else if (logType === "error") {
        console.error("TSWorker:", ...data)
      } else if (logType === "warn") {
        console.warn("TSWorker:", ...data)
      }
      return
    }
  }

  public async preloadParser(filetype: string): Promise<boolean> {
    const messageId = `has_parser_${this.messageIdCounter++}`
    const response = await new Promise<{ hasParser: boolean; warning?: string; error?: string }>((resolve) => {
      this.messageCallbacks.set(messageId, resolve)
      this.worker?.postMessage({
        type: "PRELOAD_PARSER",
        filetype,
        messageId,
      })
    })
    return response.hasParser
  }

  public async createBuffer(
    id: number,
    content: string,
    filetype: string,
    version: number = 1,
    autoInitialize: boolean = true,
  ): Promise<boolean> {
    if (!this.initialized) {
      if (!autoInitialize) {
        this.emitError("Could not create buffer because client is not initialized")
        return false
      }
      try {
        await this.initialize()
      } catch (error) {
        this.emitError("Could not create buffer because of initialization error")
        return false
      }
    }

    if (this.buffers.has(id)) {
      throw new Error(`Buffer with id ${id} already exists`)
    }

    // Set buffer state immediately to avoid race conditions
    this.buffers.set(id, { id, content, filetype, version, hasParser: false })

    const messageId = `init_${this.messageIdCounter++}`
    const response = await new Promise<{ hasParser: boolean; warning?: string; error?: string }>((resolve) => {
      this.messageCallbacks.set(messageId, resolve)
      this.worker?.postMessage({
        type: "INITIALIZE_PARSER",
        bufferId: id,
        version,
        content,
        filetype,
        messageId,
      })
    })

    if (!response.hasParser) {
      this.emit("buffer:initialized", id, false)
      if (filetype !== "plaintext") {
        this.emitWarning(response.warning || response.error || "Buffer has no parser", id)
      }
      return false
    }

    // Update buffer state to indicate it has a parser
    const bufferState: ParsedBuffer = { id, content, filetype, version, hasParser: true }
    this.buffers.set(id, bufferState)

    this.emit("buffer:initialized", id, true)
    return true
  }

  public async updateBuffer(id: number, edits: Edit[], newContent: string, version: number): Promise<void> {
    if (!this.initialized) {
      return
    }

    const buffer = this.buffers.get(id)
    if (!buffer || !buffer.hasParser) {
      return
    }

    // Update buffer state
    this.buffers.set(id, { ...buffer, content: newContent, version })

    if (!this.editQueues.has(id)) {
      this.editQueues.set(
        id,
        new ProcessQueue<EditQueueItem>((item) =>
          this.processEdit(id, item.edits, item.newContent, item.version, item.isReset),
        ),
      )
    }

    const bufferQueue = this.editQueues.get(id)!
    bufferQueue.enqueue({ edits, newContent, version })
  }

  private async processEdit(
    bufferId: number,
    edits: Edit[],
    newContent: string,
    version: number,
    isReset = false,
  ): Promise<void> {
    this.worker?.postMessage({
      type: isReset ? "RESET_BUFFER" : "HANDLE_EDITS",
      bufferId,
      version,
      content: newContent,
      edits,
    })
  }

  public async removeBuffer(bufferId: number): Promise<void> {
    if (!this.initialized) {
      return
    }

    this.buffers.delete(bufferId)

    if (this.editQueues.has(bufferId)) {
      this.editQueues.get(bufferId)?.clear()
      this.editQueues.delete(bufferId)
    }

    if (this.worker) {
      await new Promise<boolean>((resolve) => {
        const messageId = `dispose_${bufferId}`
        this.messageCallbacks.set(messageId, resolve)
        try {
          this.worker!.postMessage({
            type: "DISPOSE_BUFFER",
            bufferId,
          })
        } catch (error) {
          console.error("Error disposing buffer", error)
          resolve(false)
        }

        // Add a timeout in case the worker doesn't respond
        setTimeout(() => {
          if (this.messageCallbacks.has(messageId)) {
            this.messageCallbacks.delete(messageId)
            console.warn({ bufferId }, "Timed out waiting for buffer to be disposed")
            resolve(false)
          }
        }, 3000)
      })
    }

    this.debouncer.clearDebounce(`reset-${bufferId}`)
  }

  public async destroy(): Promise<void> {
    if (this.initializeResolvers) {
      clearTimeout(this.initializeResolvers.timeoutId)
      // Reject pending initialization promise to prevent hanging awaits
      this.initializeResolvers.reject(new Error("Client destroyed during initialization"))
      this.initializeResolvers = undefined
    }

    for (const [messageId, callback] of this.messageCallbacks.entries()) {
      if (typeof callback === "function") {
        try {
          callback({ error: "Client destroyed" })
        } catch (e) {
          // Ignore errors during cleanup
        }
      }
    }
    this.messageCallbacks.clear()

    clearDebounceScope("tree-sitter-client")
    this.debouncer.clear()

    this.editQueues.clear()
    this.buffers.clear()

    this.stopWorker()

    this.initialized = false
    this.initializePromise = undefined
  }

  public async resetBuffer(bufferId: number, version: number, content: string): Promise<void> {
    if (!this.initialized) {
      return
    }

    const buffer = this.buffers.get(bufferId)
    if (!buffer || !buffer.hasParser) {
      this.emitError("Cannot reset buffer with no parser", bufferId)
      return
    }

    // Update buffer state
    this.buffers.set(bufferId, { ...buffer, content, version })

    // Use debouncer to avoid excessive resets
    this.debouncer.debounce(`reset-${bufferId}`, 10, () => this.processEdit(bufferId, [], content, version, true))
  }

  public getBuffer(bufferId: number): BufferState | undefined {
    return this.buffers.get(bufferId)
  }

  public getAllBuffers(): BufferState[] {
    return Array.from(this.buffers.values())
  }

  public isInitialized(): boolean {
    return this.initialized
  }

  public async setDataPath(dataPath: string): Promise<void> {
    if (this.options.dataPath === dataPath) {
      return
    }

    this.options.dataPath = dataPath

    if (this.initialized && this.worker) {
      const messageId = `update_datapath_${this.messageIdCounter++}`
      return new Promise<void>((resolve, reject) => {
        this.messageCallbacks.set(messageId, (response: any) => {
          if (response.error) {
            reject(new Error(response.error))
          } else {
            resolve()
          }
        })
        this.worker!.postMessage({
          type: "UPDATE_DATA_PATH",
          dataPath,
          messageId,
        })
      })
    }
  }

  public async clearCache(): Promise<void> {
    if (!this.initialized || !this.worker) {
      throw new Error("Cannot clear cache: client is not initialized")
    }

    const messageId = `clear_cache_${this.messageIdCounter++}`
    return new Promise<void>((resolve, reject) => {
      this.messageCallbacks.set(messageId, (response: any) => {
        if (response.error) {
          reject(new Error(response.error))
        } else {
          resolve()
        }
      })
      this.worker!.postMessage({
        type: "CLEAR_CACHE",
        messageId,
      })
    })
  }
}
