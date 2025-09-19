import { EventEmitter } from "events"
import { createDebounce, clearDebounceScope, DebounceController } from "../debounce"
import { ProcessQueue } from "../queue"
import type {
  TreeSitterClientOptions,
  TreeSitterClientEvents,
  BufferState,
  ParsedBuffer,
  FiletypeParserOptions,
  HighlightResponse,
  Edit,
  PerformanceStats,
} from "./types"

interface EditQueueItem {
  edits: Edit[]
  newContent: string
  version: number
  isReset?: boolean
}

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

  private startWorker() {
    if (this.worker) {
      return
    }

    const workerPath = this.options.workerPath || new URL("./parser.worker.ts", import.meta.url)
    this.worker = new Worker(workerPath)

    // @ts-ignore - onmessage exists
    this.worker.onmessage = this.handleWorkerMessage.bind(this)
  }

  private stopWorker() {
    if (!this.worker) {
      return
    }
    this.worker.terminate()
    this.worker = undefined
  }

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
        this.initializeResolvers = undefined
        reject(new Error("Worker initialization timed out"))
      }, timeoutMs)

      this.initializeResolvers = { resolve, reject, timeoutId }
      this.worker?.postMessage({ type: "INIT", dataPath: this.options.dataPath })
    })

    await this.initializePromise

    // Register default parsers after initialization
    await this.registerDefaultParsers()

    return this.initializePromise
  }

  private async registerDefaultParsers(): Promise<void> {
    const defaultParsers = [
      {
        filetype: "javascript",
        queries: {
          highlights:
            "https://raw.githubusercontent.com/tree-sitter/tree-sitter-javascript/refs/heads/master/queries/highlights.scm",
        },
        language:
          "https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.23.1/tree-sitter-javascript.wasm",
      },
      {
        filetype: "typescript",
        queries: {
          highlights:
            "https://raw.githubusercontent.com/tree-sitter/tree-sitter-typescript/refs/heads/master/queries/highlights.scm",
        },
        language:
          "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
      },
    ]

    for (const parser of defaultParsers) {
      this.addFiletypeParser(parser)
    }
  }

  public addFiletypeParser(filetypeParser: FiletypeParserOptions): void {
    this.worker?.postMessage({ type: "ADD_FILETYPE_PARSER", filetypeParser })
  }

  public async getPerformance(): Promise<PerformanceStats> {
    const messageId = `performance_${this.messageIdCounter++}`
    return new Promise<PerformanceStats>((resolve) => {
      this.messageCallbacks.set(messageId, resolve)
      this.worker?.postMessage({ type: "GET_PERFORMANCE", messageId })
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

    if (warning) {
      this.emit("warning", warning, bufferId)
      return
    }

    if (error) {
      this.emit("error", error, bufferId)
      return
    }

    if (type === "PERFORMANCE_RESPONSE") {
      const callback = this.messageCallbacks.get(messageId)
      if (callback) {
        this.messageCallbacks.delete(messageId)
        callback(performance)
      }
    }

    if (type === "WORKER_LOG") {
      const { logType, data } = event.data
      if (logType === "log") {
        console.log("Worker stdout:", ...data)
      } else if (logType === "error") {
        console.error("Worker stderr:", ...data)
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
        this.emit("error", "Could not create buffer because client is not initialized")
        return false
      }
      try {
        await this.initialize()
      } catch (error) {
        this.emit("error", "Could not create buffer because of initialization error")
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
        this.emit("warning", response.warning || response.error || "Buffer has no parser", id)
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
      this.initializeResolvers = undefined
    }

    clearDebounceScope("tree-sitter-client")
    this.stopWorker()
    this.buffers.clear()
    this.editQueues.clear()

    // Reset initialization state
    this.initialized = false
    this.initializePromise = undefined
  }

  public async resetBuffer(bufferId: number, version: number, content: string): Promise<void> {
    if (!this.initialized) {
      return
    }

    const buffer = this.buffers.get(bufferId)
    if (!buffer || !buffer.hasParser) {
      this.emit("error", "Cannot reset buffer with no parser", bufferId)
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
}
