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
  incrementalCount: number
  resetCount: number
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
}

let nextBufferId = 0x7fffffff
let nextNamespace = 0xffffffff
let nextMergedStyleName = 1
const allocatedNamespaces = new Set<number>()
const mergedStyleCaches = new WeakMap<SyntaxStyle, Map<string, number>>()
const encoder = new TextEncoder()
const decoder = new TextDecoder()

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

function overlaps(startByte: number, endByte: number, windowStart: number, windowEnd: number): boolean {
  if (windowStart === windowEnd) return startByte <= windowStart && endByte >= windowEnd
  return startByte < windowEnd && endByte > windowStart
}

function applyUtf8Splice(previousContent: string, currentSnapshot: string, change: EditChange): string {
  const previousBytes = encoder.encode(previousContent)
  const snapshotBytes = encoder.encode(currentSnapshot)
  const insertedBytes = snapshotBytes.subarray(change.startIndex, change.newEndIndex)
  const nextBytes = new Uint8Array(
    change.startIndex + insertedBytes.byteLength + previousBytes.byteLength - change.oldEndIndex,
  )
  nextBytes.set(previousBytes.subarray(0, change.startIndex))
  nextBytes.set(insertedBytes, change.startIndex)
  nextBytes.set(previousBytes.subarray(change.oldEndIndex), change.startIndex + insertedBytes.byteLength)
  return decoder.decode(nextBytes)
}

export class NativeTreeSitterHighlighter {
  public readonly bufferId: number
  public readonly namespace: number

  private readonly editBuffer: EditBuffer
  private readonly syntaxStyle: SyntaxStyle
  private readonly client: IncrementalHighlightClient
  private readonly requestRender: () => void
  private readonly mergedStyleIds: Map<string, number>
  private generation = 1
  private readonly activeGeneration = this.generation
  private active = true
  private latestContent: string
  private latestVersion = 1
  private operationQueue: Promise<void>
  private disposePromise?: Promise<void>
  private stats: IncrementalHighlightStats = {
    parseKind: "pending",
    queryKind: "pending",
    incrementalCount: 0,
    resetCount: 0,
    changedByteCount: 0,
    queriedByteCount: 0,
    publicationCount: 0,
    version: 1,
  }

  private readonly handleHighlightResponse = (bufferId: number, version: number, response: HighlightResponse): void => {
    if (
      !this.active ||
      this.generation !== this.activeGeneration ||
      bufferId !== this.bufferId ||
      version !== this.latestVersion
    ) {
      return
    }

    const operations: TextAnnotationOperation[] = []
    if (response.queryKind === "full") {
      operations.push({ kind: "clearNamespace", namespace: this.namespace })
    } else {
      const annotations = this.editBuffer.queryAnnotations({ kind: "namespace", namespace: this.namespace })
      for (const annotation of annotations) {
        if (
          response.replacementRanges.some((range) =>
            overlaps(annotation.startByte, annotation.endByte, range.startIndex, range.endIndex),
          )
        ) {
          operations.push({ kind: "remove", id: annotation.id })
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

  private readonly handleContentChange = (change: EditChange): void => {
    if (!this.active || this.generation !== this.activeGeneration) return

    const currentSnapshot = this.editBuffer.getText()
    this.latestContent =
      change.kind === "reset" ? currentSnapshot : applyUtf8Splice(this.latestContent, currentSnapshot, change)
    const content = this.latestContent
    const version = ++this.latestVersion
    const generation = this.generation
    this.stats = {
      ...this.stats,
      incrementalCount: this.stats.incrementalCount + Number(change.kind === "splice"),
      resetCount: this.stats.resetCount + Number(change.kind === "reset"),
      version,
    }

    this.operationQueue = this.operationQueue
      .then(async () => {
        if (!this.active || this.generation !== generation) return
        if (change.kind === "reset") {
          await this.client.resetBuffer(this.bufferId, version, content)
        } else {
          await this.client.updateBufferUtf8(this.bufferId, [change], content, version)
        }
      })
      .catch((error) => this.recordError(error))
  }

  constructor(options: NativeTreeSitterHighlighterOptions) {
    this.editBuffer = options.editBuffer
    this.syntaxStyle = options.syntaxStyle
    this.client = options.client
    this.requestRender = options.requestRender
    this.mergedStyleIds = mergedStyleCaches.get(this.syntaxStyle) ?? new Map<string, number>()
    mergedStyleCaches.set(this.syntaxStyle, this.mergedStyleIds)
    this.latestContent = options.initialContent
    this.bufferId = allocateBufferId(this.client)
    this.namespace = allocateNamespace(this.editBuffer)

    this.client.on("highlights:response", this.handleHighlightResponse)
    this.editBuffer.on("content-changed", this.handleContentChange)
    this.operationQueue = this.client
      .createBuffer(this.bufferId, this.latestContent, "typescript", 1)
      .then((hasParser) => {
        if (!hasParser) throw new Error("TypeScript Tree-sitter parser is unavailable")
      })
      .catch((error) => this.recordError(error))
  }

  public getStats(): IncrementalHighlightStats {
    return { ...this.stats }
  }

  public getRangeCount(): number {
    if (!this.active) return 0
    return this.editBuffer.queryAnnotations({ kind: "namespace", namespace: this.namespace }).length
  }

  public whenIdle(): Promise<void> {
    return this.operationQueue
  }

  public dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.active = false
    this.generation++
    this.client.off("highlights:response", this.handleHighlightResponse)
    this.editBuffer.off("content-changed", this.handleContentChange)
    this.editBuffer.applyAnnotationOperations([{ kind: "clearNamespace", namespace: this.namespace }])

    this.disposePromise = this.operationQueue
      .catch(() => {})
      .then(() => this.client.removeBuffer(this.bufferId))
      .catch((error) => this.recordError(error))
    return this.disposePromise
  }

  private recordError(error: unknown): void {
    if (!this.active) return
    this.stats = { ...this.stats, error: error instanceof Error ? error.message : String(error) }
  }
}
