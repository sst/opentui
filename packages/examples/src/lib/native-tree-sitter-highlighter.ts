import {
  TEXT_ANNOTATION_KIND_STYLE,
  resolveTreeSitterHighlightRanges,
  type EditBuffer,
  type EditChange,
  type HighlightResponse,
  type StyleDefinition,
  type SyntaxStyle,
  type TextAnnotationOperation,
  type TreeSitterClient,
} from "@opentui/core"

export interface IncrementalHighlightClient {
  createBuffer(id: number, content: string, filetype: string, version: number): Promise<boolean>
  updateBufferUtf8(id: number, edits: readonly EditChange[], newContent: string, version: number): Promise<void>
  resetBuffer(id: number, version: number, content: string): Promise<void>
  removeBuffer(id: number): Promise<void>
  getBuffer(id: number): unknown
  on(
    event: "highlights:response",
    listener: (bufferId: number, version: number, response: HighlightResponse) => void,
  ): unknown
  off(
    event: "highlights:response",
    listener: (bufferId: number, version: number, response: HighlightResponse) => void,
  ): unknown
}

export interface IncrementalHighlightStats {
  parseKind: HighlightResponse["parseKind"] | "pending"
  queryKind: HighlightResponse["queryKind"] | "pending"
  receivedEditCount: number
  incrementalCount: number
  resetCount: number
  coalescedEditCount: number
  queueDepth: number
  maxQueueDepth: number
  queueLatencyMs: number
  changedByteCount: number
  queriedByteCount: number
  publicationCount: number
  version: number
  error?: string
}

export interface NativeTreeSitterHighlighterOptions {
  editBuffer: EditBuffer
  syntaxStyle: SyntaxStyle
  client: IncrementalHighlightClient | TreeSitterClient
  requestRender: () => void
  initialContent: string
  onFailure?: (error: Error) => void
}

interface PendingSnapshot {
  change: EditChange
  content: string
  receivedAt: number
}

let nextBufferId = 0x7fffffff
let nextNamespace = 0xffffffff
let nextMergedStyleName = 1
const allocatedNamespaces = new Set<number>()
const mergedStyleCaches = new WeakMap<SyntaxStyle, Map<string, number>>()

function allocateBufferId(client: IncrementalHighlightClient): number {
  while (nextBufferId > 0) {
    const candidate = nextBufferId--
    if (!client.getBuffer(candidate)) return candidate
  }
  throw new Error("Tree-sitter demo buffer ID space exhausted")
}

function allocateNamespace(editBuffer: EditBuffer): number {
  const occupied = new Set(editBuffer.queryAnnotations().map((annotation) => annotation.namespace))
  while (nextNamespace > 0) {
    const candidate = nextNamespace--
    if (!allocatedNamespaces.has(candidate) && !occupied.has(candidate)) {
      allocatedNamespaces.add(candidate)
      return candidate
    }
  }
  throw new Error("Tree-sitter demo annotation namespace space exhausted")
}

function styleDefinitionKey(definition: StyleDefinition): string {
  const color = (value: StyleDefinition["fg"]): string => (value ? Array.from(value.buffer).join(",") : "")
  return [
    color(definition.fg),
    color(definition.bg),
    definition.bold === undefined ? "" : Number(definition.bold),
    definition.italic === undefined ? "" : Number(definition.italic),
    definition.underline === undefined ? "" : Number(definition.underline),
    definition.dim === undefined ? "" : Number(definition.dim),
  ].join("|")
}

function isIncrementalChange(change: EditChange, previousEpoch: bigint | undefined): boolean {
  return (
    change.kind === "splice" &&
    (previousEpoch === undefined || change.epoch === previousEpoch + 1n) &&
    Number.isSafeInteger(change.startIndex) &&
    Number.isSafeInteger(change.oldEndIndex) &&
    Number.isSafeInteger(change.newEndIndex) &&
    change.startIndex >= 0 &&
    change.oldEndIndex >= change.startIndex &&
    change.newEndIndex >= change.startIndex
  )
}

export class NativeTreeSitterHighlighter {
  public readonly bufferId: number
  public readonly namespace: number

  private readonly editBuffer: EditBuffer
  private readonly syntaxStyle: SyntaxStyle
  private readonly client: IncrementalHighlightClient
  private readonly requestRender: () => void
  private readonly onFailure?: (error: Error) => void
  private readonly mergedStyleIds: Map<string, number>
  private generation = 1
  private active = true
  private listenersAttached = true
  private namespaceAllocated = true
  private initialContent?: string
  private latestVersion = 1
  private latestReceivedEpoch?: bigint
  private lastSubmittedEpoch?: bigint
  private pending?: PendingSnapshot
  private draining = true
  private drainPromise: Promise<void>
  private unsubscribeContentSnapshots?: () => void
  private disposePromise?: Promise<void>
  private removePromise?: Promise<void>
  private stats: IncrementalHighlightStats = {
    parseKind: "pending",
    queryKind: "pending",
    receivedEditCount: 0,
    incrementalCount: 0,
    resetCount: 0,
    coalescedEditCount: 0,
    queueDepth: 1,
    maxQueueDepth: 1,
    queueLatencyMs: 0,
    changedByteCount: 0,
    queriedByteCount: 0,
    publicationCount: 0,
    version: 1,
  }

  private readonly handleHighlightResponse = (bufferId: number, version: number, response: HighlightResponse): void => {
    if (
      !this.active ||
      bufferId !== this.bufferId ||
      version !== this.latestVersion ||
      this.pending !== undefined ||
      this.latestReceivedEpoch !== this.lastSubmittedEpoch
    ) {
      return
    }

    const operations: TextAnnotationOperation[] = []
    if (response.queryKind === "full") {
      operations.push({ kind: "clearNamespace", namespace: this.namespace })
    } else {
      const removedIds = new Set<bigint>()
      for (const range of response.replacementRanges) {
        const annotations = this.editBuffer.queryAnnotations(
          range.startIndex === range.endIndex
            ? { kind: "containingByte", byte: range.startIndex }
            : { kind: "overlap", startByte: range.startIndex, endByte: range.endIndex },
        )
        for (const annotation of annotations) {
          if (annotation.namespace === this.namespace && !removedIds.has(annotation.id)) {
            removedIds.add(annotation.id)
            operations.push({ kind: "remove", id: annotation.id })
          }
        }
      }
    }

    for (const range of resolveTreeSitterHighlightRanges(response.highlights, this.syntaxStyle)) {
      if (range.startIndex >= range.endIndex) continue
      let styleId = range.styleId
      if (styleId === undefined && range.definition) {
        const key = styleDefinitionKey(range.definition)
        styleId = this.mergedStyleIds.get(key)
        if (styleId === undefined) {
          styleId = this.syntaxStyle.registerStyle(`demo.tree-sitter.merged.${nextMergedStyleName++}`, range.definition)
          this.mergedStyleIds.set(key, styleId)
        }
      }
      if (styleId === undefined) continue
      operations.push({
        kind: "addRange",
        startByte: range.startIndex,
        endByte: range.endIndex,
        startGravity: "right",
        endGravity: "left",
        namespace: this.namespace,
        styleId,
        kindFlags: TEXT_ANNOTATION_KIND_STYLE,
        splicePolicy: "deleteWhenCovered",
      })
    }

    this.editBuffer.applyAnnotationOperations(operations)
    this.stats = {
      ...this.stats,
      parseKind: response.parseKind,
      queryKind: response.queryKind,
      changedByteCount: response.changedByteCount,
      queriedByteCount: response.queriedByteCount,
      publicationCount: this.stats.publicationCount + 1,
      version,
      error: undefined,
    }
    this.requestRender()
  }

  private readonly handleContentSnapshot = (change: EditChange, content: string): void => {
    if (!this.active) return

    const coalesced = this.pending === undefined ? 0 : 1
    this.pending = { change, content, receivedAt: performance.now() }
    this.latestReceivedEpoch = change.epoch
    const queueDepth = Number(this.draining) + 1
    this.stats = {
      ...this.stats,
      receivedEditCount: this.stats.receivedEditCount + 1,
      coalescedEditCount: this.stats.coalescedEditCount + coalesced,
      queueDepth,
      maxQueueDepth: Math.max(this.stats.maxQueueDepth, queueDepth),
    }
    if (!this.draining) this.startDrain()
  }

  constructor(options: NativeTreeSitterHighlighterOptions) {
    this.editBuffer = options.editBuffer
    this.syntaxStyle = options.syntaxStyle
    this.client = options.client
    this.requestRender = options.requestRender
    this.onFailure = options.onFailure
    this.mergedStyleIds = mergedStyleCaches.get(this.syntaxStyle) ?? new Map<string, number>()
    mergedStyleCaches.set(this.syntaxStyle, this.mergedStyleIds)
    this.initialContent = options.initialContent
    this.latestReceivedEpoch = this.editBuffer.getLastChange()?.epoch
    this.lastSubmittedEpoch = this.latestReceivedEpoch
    this.bufferId = allocateBufferId(this.client)
    this.namespace = allocateNamespace(this.editBuffer)

    this.client.on("highlights:response", this.handleHighlightResponse)
    this.unsubscribeContentSnapshots = this.editBuffer.subscribeContentSnapshots(this.handleContentSnapshot)
    this.drainPromise = this.initializeAndDrain(this.generation)
  }

  public getStats(): IncrementalHighlightStats {
    return { ...this.stats }
  }

  public isActive(): boolean {
    return this.active
  }

  public getRangeCount(): number {
    return this.editBuffer.queryAnnotations({ kind: "namespace", namespace: this.namespace }).length
  }

  public whenIdle(): Promise<void> {
    return this.drainPromise
  }

  public dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    if (this.active) {
      this.active = false
      this.generation++
      this.pending = undefined
      this.stats = { ...this.stats, queueDepth: Number(this.draining) }
      this.releaseLocalState()
    }

    this.disposePromise = this.drainPromise
      .catch(() => {})
      .then(() => this.removeBuffer())
      .catch((error) => this.recordError(error, true))
    return this.disposePromise
  }

  private startDrain(): void {
    if (this.draining || !this.active) return
    this.draining = true
    this.drainPromise = this.drain(this.generation)
  }

  private async initializeAndDrain(generation: number): Promise<void> {
    const content = this.initialContent ?? ""
    this.initialContent = undefined
    try {
      const hasParser = await this.client.createBuffer(this.bufferId, content, "typescript", 1)
      if (!hasParser) throw new Error("TypeScript Tree-sitter parser is unavailable")
      await this.drainPending(generation)
    } catch (error) {
      await this.fail(error, generation)
    } finally {
      this.finishDrain()
    }
  }

  private async drain(generation: number): Promise<void> {
    try {
      await this.drainPending(generation)
    } catch (error) {
      await this.fail(error, generation)
    } finally {
      this.finishDrain()
    }
  }

  private async drainPending(generation: number): Promise<void> {
    while (this.active && this.generation === generation && this.pending) {
      const snapshot = this.pending
      this.pending = undefined
      const incremental = isIncrementalChange(snapshot.change, this.lastSubmittedEpoch)
      const version = ++this.latestVersion
      this.lastSubmittedEpoch = snapshot.change.epoch
      this.stats = {
        ...this.stats,
        queueDepth: 1,
        queueLatencyMs: performance.now() - snapshot.receivedAt,
        version,
      }

      if (incremental) {
        try {
          await this.client.updateBufferUtf8(this.bufferId, [snapshot.change], snapshot.content, version)
          this.stats = { ...this.stats, incrementalCount: this.stats.incrementalCount + 1 }
        } catch {
          if (!this.active || this.generation !== generation) return
          const resetSnapshot = this.pending ?? snapshot
          this.pending = undefined
          const resetVersion = ++this.latestVersion
          this.lastSubmittedEpoch = resetSnapshot.change.epoch
          this.stats = {
            ...this.stats,
            resetCount: this.stats.resetCount + 1,
            queueDepth: 1,
            queueLatencyMs: performance.now() - resetSnapshot.receivedAt,
            version: resetVersion,
          }
          await this.client.resetBuffer(this.bufferId, resetVersion, resetSnapshot.content)
        }
      } else {
        this.stats = { ...this.stats, resetCount: this.stats.resetCount + 1 }
        await this.client.resetBuffer(this.bufferId, version, snapshot.content)
      }
    }
  }

  private finishDrain(): void {
    this.draining = false
    this.stats = { ...this.stats, queueDepth: Number(this.pending !== undefined) }
    if (this.pending && this.active) this.startDrain()
  }

  private async fail(error: unknown, generation: number): Promise<void> {
    if (!this.active || this.generation !== generation) return
    const failure = error instanceof Error ? error : new Error(String(error))
    this.recordError(failure)
    this.active = false
    this.generation++
    this.pending = undefined
    this.releaseLocalState()
    await this.removeBuffer().catch((removeError) => this.recordError(removeError, true))
    this.requestRender()
    try {
      this.onFailure?.(failure)
    } catch (callbackError) {
      this.recordError(callbackError, true)
    }
  }

  private releaseLocalState(): void {
    if (this.listenersAttached) {
      this.listenersAttached = false
      this.client.off("highlights:response", this.handleHighlightResponse)
      this.unsubscribeContentSnapshots?.()
      this.unsubscribeContentSnapshots = undefined
    }
    if (this.namespaceAllocated) {
      this.namespaceAllocated = false
      allocatedNamespaces.delete(this.namespace)
      try {
        this.editBuffer.applyAnnotationOperations([{ kind: "clearNamespace", namespace: this.namespace }])
      } catch (error) {
        this.recordError(error, true)
      }
    }
  }

  private removeBuffer(): Promise<void> {
    this.removePromise ??= Promise.resolve().then(() => this.client.removeBuffer(this.bufferId))
    return this.removePromise
  }

  private recordError(error: unknown, includeExisting = false): void {
    const message = error instanceof Error ? error.message : String(error)
    const existing = includeExisting ? this.stats.error : undefined
    this.stats = { ...this.stats, error: message }
    if (existing) this.stats.error = `${existing}; cleanup failed: ${message}`
  }
}
