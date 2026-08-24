import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  EditBuffer,
  SyntaxStyle,
  TEXT_ANNOTATION_KIND_STYLE,
  type EditChange,
  type HighlightResponse,
} from "@opentui/core"
import { NativeTreeSitterHighlighter, type IncrementalHighlightClient } from "./native-tree-sitter-highlighter.js"

class FakeIncrementalClient extends EventEmitter implements IncrementalHighlightClient {
  public readonly createCalls: Array<{ id: number; content: string; filetype: string; version: number }> = []
  public readonly updateCalls: Array<{ id: number; edits: readonly EditChange[]; content: string; version: number }> =
    []
  public readonly resetCalls: Array<{ id: number; content: string; version: number }> = []
  public readonly removeCalls: number[] = []
  public listenerWasRegisteredBeforeCreate = false
  public deferCreate = false
  public deferOperations = false
  public updateError?: Error
  public createResult = true
  public createError?: Error
  private readonly buffers = new Map<number, { content: string; version: number }>()
  private createResolver?: (value: boolean) => void
  private readonly operationResolvers: Array<() => void> = []

  public createBuffer(id: number, content: string, filetype: string, version: number): Promise<boolean> {
    this.listenerWasRegisteredBeforeCreate = this.listenerCount("highlights:response") > 0
    this.createCalls.push({ id, content, filetype, version })
    if (this.createError) throw this.createError
    this.buffers.set(id, { content, version })
    if (!this.deferCreate) return Promise.resolve(this.createResult)
    return new Promise<boolean>((resolve) => {
      this.createResolver = resolve
    })
  }

  public async updateBufferUtf8(
    id: number,
    edits: readonly EditChange[],
    content: string,
    version: number,
  ): Promise<void> {
    if (this.updateError) {
      const error = this.updateError
      this.updateError = undefined
      throw error
    }
    const previous = this.buffers.get(id)
    if (!previous || version !== previous.version + 1)
      throw new Error("update did not receive the prior client version")
    let expected = previous.content
    for (const edit of edits) {
      const previousBytes = new TextEncoder().encode(expected)
      const contentBytes = new TextEncoder().encode(content)
      const inserted = contentBytes.subarray(edit.startIndex, edit.newEndIndex)
      const next = new Uint8Array(edit.startIndex + inserted.byteLength + previousBytes.byteLength - edit.oldEndIndex)
      next.set(previousBytes.subarray(0, edit.startIndex))
      next.set(inserted, edit.startIndex)
      next.set(previousBytes.subarray(edit.oldEndIndex), edit.startIndex + inserted.byteLength)
      expected = new TextDecoder().decode(next)
    }
    if (expected !== content) throw new Error("update content does not match its edit and prior client content")
    this.updateCalls.push({ id, edits, content, version })
    this.buffers.set(id, { content, version })
    if (this.deferOperations) await new Promise<void>((resolve) => this.operationResolvers.push(resolve))
  }

  public async resetBuffer(id: number, version: number, content: string): Promise<void> {
    const previous = this.buffers.get(id)
    if (!previous || version <= previous.version) throw new Error("reset did not receive a newer client version")
    this.resetCalls.push({ id, content, version })
    this.buffers.set(id, { content, version })
    if (this.deferOperations) await new Promise<void>((resolve) => this.operationResolvers.push(resolve))
  }

  public async removeBuffer(id: number): Promise<void> {
    this.removeCalls.push(id)
    this.buffers.delete(id)
  }

  public getBuffer(id: number): unknown {
    return this.buffers.get(id)
  }

  public resolveCreate(hasParser = true): void {
    this.createResolver?.(hasParser)
    this.createResolver = undefined
  }

  public getContent(id: number): string | undefined {
    return this.buffers.get(id)?.content
  }

  public resolveNextOperation(): void {
    this.operationResolvers.shift()?.()
  }

  public respond(bufferId: number, version: number, response: HighlightResponse): void {
    this.emit("highlights:response", bufferId, version, response)
  }
}

function response(overrides: Partial<HighlightResponse> = {}): HighlightResponse {
  return {
    highlights: [],
    replacementRanges: [],
    parseKind: "incremental",
    queryKind: "partial",
    changedByteCount: 1,
    queriedByteCount: 8,
    ...overrides,
  }
}

async function flushNativeEvents(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("NativeTreeSitterHighlighter", () => {
  let editBuffer: EditBuffer
  let syntaxStyle: SyntaxStyle
  let client: FakeIncrementalClient
  let highlighter: NativeTreeSitterHighlighter | undefined
  let renderCount: number

  beforeEach(async () => {
    editBuffer = EditBuffer.create("unicode")
    editBuffer.setText("one + two")
    await flushNativeEvents()
    syntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: "#ffffff" },
      keyword: { fg: "#ff0000", bold: true },
      string: { fg: "#00ff00" },
      number: { fg: "#0000ff" },
    })
    editBuffer.setSyntaxStyle(syntaxStyle)
    client = new FakeIncrementalClient()
    renderCount = 0
  })

  afterEach(async () => {
    await highlighter?.dispose()
    editBuffer.destroy()
    syntaxStyle.destroy()
  })

  function createHighlighter(): NativeTreeSitterHighlighter {
    highlighter = new NativeTreeSitterHighlighter({
      editBuffer,
      syntaxStyle,
      client,
      requestRender: () => renderCount++,
      initialContent: editBuffer.getText(),
    })
    return highlighter
  }

  test("replaces only partial windows and clears only its namespace for full responses", async () => {
    const value = createHighlighter()
    await value.whenIdle()
    expect(client.listenerWasRegisteredBeforeCreate).toBe(true)
    editBuffer.applyAnnotationOperations([
      {
        kind: "addRange",
        startByte: 3,
        endByte: 4,
        namespace: 42,
        styleId: syntaxStyle.getStyleId("default")!,
        kindFlags: TEXT_ANNOTATION_KIND_STYLE,
      },
    ])

    client.respond(
      value.bufferId,
      1,
      response({
        queryKind: "full",
        parseKind: "reset",
        replacementRanges: [{ startIndex: 0, endIndex: 9 }],
        highlights: [
          { startIndex: 0, endIndex: 3, group: "keyword" },
          { startIndex: 6, endIndex: 9, group: "string" },
        ],
      }),
    )
    expect(value.getRangeCount()).toBe(2)

    const originalQueryAnnotations = editBuffer.queryAnnotations.bind(editBuffer)
    const queryKinds: string[] = []
    editBuffer.queryAnnotations = (query = { kind: "all" }) => {
      queryKinds.push(query.kind)
      return originalQueryAnnotations(query)
    }

    client.respond(
      value.bufferId,
      1,
      response({
        replacementRanges: [{ startIndex: 0, endIndex: 3 }],
        highlights: [{ startIndex: 0, endIndex: 2, group: "number" }],
      }),
    )
    expect(
      editBuffer
        .queryAnnotations({ kind: "namespace", namespace: value.namespace })
        .map(({ startByte, endByte }) => [startByte, endByte]),
    ).toEqual([
      [0, 2],
      [6, 9],
    ])
    expect(editBuffer.queryAnnotations({ kind: "namespace", namespace: 42 })).toHaveLength(1)
    expect(queryKinds.filter((kind) => kind === "overlap")).toHaveLength(1)
    expect(queryKinds.filter((kind) => kind === "namespace")).toHaveLength(2)

    queryKinds.length = 0
    expect(value.getRangeCount()).toBe(2)
    expect(queryKinds).toEqual(["namespace"])

    client.respond(
      value.bufferId,
      1,
      response({
        queryKind: "full",
        replacementRanges: [{ startIndex: 0, endIndex: 9 }],
        highlights: [{ startIndex: 4, endIndex: 5, group: "keyword" }],
      }),
    )
    expect(value.getRangeCount()).toBe(1)
    expect(editBuffer.queryAnnotations({ kind: "namespace", namespace: 42 })).toHaveLength(1)
    expect(renderCount).toBe(3)
  })

  test("removes containing syntax ranges for deduplicated zero-width replacement windows", async () => {
    const value = createHighlighter()
    await value.whenIdle()
    client.respond(
      value.bufferId,
      1,
      response({
        queryKind: "full",
        highlights: [
          { startIndex: 0, endIndex: 3, group: "keyword" },
          { startIndex: 6, endIndex: 9, group: "string" },
        ],
      }),
    )

    const originalQueryAnnotations = editBuffer.queryAnnotations.bind(editBuffer)
    const queryKinds: string[] = []
    editBuffer.queryAnnotations = (query = { kind: "all" }) => {
      queryKinds.push(query.kind)
      return originalQueryAnnotations(query)
    }
    client.respond(
      value.bufferId,
      1,
      response({
        replacementRanges: [
          { startIndex: 1, endIndex: 1 },
          { startIndex: 2, endIndex: 2 },
        ],
      }),
    )

    expect(
      originalQueryAnnotations({ kind: "namespace", namespace: value.namespace }).map(({ startByte, endByte }) => [
        startByte,
        endByte,
      ]),
    ).toEqual([[6, 9]])
    expect(queryKinds).toEqual(["containingByte", "containingByte"])
    expect(value.getRangeCount()).toBe(1)
  })

  test("rejects stale and disposed responses", async () => {
    const value = createHighlighter()
    await value.whenIdle()
    editBuffer.insertText("x")
    await flushNativeEvents()
    await value.whenIdle()
    expect(value.getStats().version).toBe(2)

    client.respond(value.bufferId, 1, response({ highlights: [{ startIndex: 0, endIndex: 1, group: "keyword" }] }))
    expect(value.getRangeCount()).toBe(0)
    expect(value.getStats().publicationCount).toBe(0)

    await value.dispose()
    client.respond(value.bufferId, 2, response({ highlights: [{ startIndex: 0, endIndex: 1, group: "keyword" }] }))
    expect(editBuffer.queryAnnotations({ kind: "namespace", namespace: value.namespace })).toEqual([])
    expect(renderCount).toBe(0)
  })

  test("forwards typed splices and reset changes without diffing", async () => {
    const value = createHighlighter()
    await value.whenIdle()

    editBuffer.insertText("界")
    await flushNativeEvents()
    await value.whenIdle()
    expect(client.updateCalls).toHaveLength(1)
    expect(client.updateCalls[0]).toMatchObject({ content: "界one + two", version: 2 })
    expect(client.updateCalls[0]!.edits[0]).toMatchObject({
      kind: "splice",
      startIndex: 0,
      oldEndIndex: 0,
      newEndIndex: 3,
    })

    editBuffer.setText("const reset = true")
    await flushNativeEvents()
    await value.whenIdle()
    expect(client.resetCalls).toEqual([{ id: value.bufferId, content: "const reset = true", version: 3 }])
    expect(value.getStats()).toMatchObject({ incrementalCount: 1, resetCount: 1, version: 3 })
  })

  test("coalesces character bursts to one incremental update and one latest reset", async () => {
    const value = createHighlighter()
    await value.whenIdle()

    editBuffer.insertChar("a")
    editBuffer.insertChar("b")
    editBuffer.insertChar("c")
    await value.whenIdle()

    expect(client.updateCalls.map(({ content, version }) => ({ content, version }))).toEqual([
      { content: "aone + two", version: 2 },
    ])
    expect(client.resetCalls).toEqual([{ id: value.bufferId, content: "abcone + two", version: 3 }])
    expect(value.getStats()).toMatchObject({
      receivedEditCount: 3,
      incrementalCount: 1,
      resetCount: 1,
      coalescedEditCount: 1,
      maxQueueDepth: 2,
      queueDepth: 0,
    })
  })

  test("submits an exact contiguous insert-before snapshot incrementally", async () => {
    editBuffer.setText("")
    await flushNativeEvents()
    const value = createHighlighter()
    await value.whenIdle()

    editBuffer.insertChar("a")
    editBuffer.setCursor(0, 0)
    editBuffer.insertChar("b")
    await value.whenIdle()

    expect(client.updateCalls.map(({ content, version }) => ({ content, version }))).toEqual([
      { content: "a", version: 2 },
      { content: "ba", version: 3 },
    ])
    expect(client.resetCalls).toEqual([])
    expect(client.getContent(value.bufferId)).toBe(editBuffer.getText())
  })

  test("observes reentrant edits after the active snapshot when subscribed second", async () => {
    editBuffer.setText("")
    await flushNativeEvents()
    const unsubscribe = editBuffer.subscribeContentSnapshots((_change, content) => {
      if (content === "A") editBuffer.insertChar("B")
    })
    const value = createHighlighter()
    await value.whenIdle()

    try {
      editBuffer.insertChar("A")
      await value.whenIdle()
      expect(client.updateCalls.map(({ content }) => content)).toEqual(["A", "AB"])
      expect(client.resetCalls).toEqual([])
      expect(client.getContent(value.bufferId)).toBe("AB")
    } finally {
      unsubscribe()
    }
  })

  test("coalesces rapid Unicode delete, undo, redo, reset, and edits to the exact final snapshot", async () => {
    editBuffer.setText("A界\nB")
    await flushNativeEvents()
    const value = createHighlighter()
    await value.whenIdle()

    editBuffer.deleteRange(0, 1, 1, 0)
    editBuffer.undo()
    editBuffer.redo()
    editBuffer.setText("λ")
    editBuffer.setCursor(0, 1)
    editBuffer.insertText("界")
    await value.whenIdle()

    expect(client.updateCalls.map(({ content }) => content).slice(0, 1)).toEqual(["AB"])
    expect(client.resetCalls).toEqual([{ id: value.bufferId, content: "λ界", version: 3 }])
    expect(client.getContent(value.bufferId)).toBe(editBuffer.getText())
    expect(value.getStats()).toMatchObject({ receivedEditCount: 5, incrementalCount: 1, resetCount: 1, version: 3 })
  })

  test("uses an ordered reset when an epoch is not contiguous", async () => {
    const value = createHighlighter()
    await value.whenIdle()
    const lastEpoch = editBuffer.getLastChange()!.epoch

    ;(value as any).handleContentSnapshot(
      {
        kind: "splice",
        epoch: lastEpoch + 2n,
        startIndex: 0,
        oldEndIndex: 0,
        newEndIndex: 1,
        startPosition: { row: 0, column: 0 },
        oldEndPosition: { row: 0, column: 0 },
        newEndPosition: { row: 0, column: 1 },
      } satisfies EditChange,
      "xone + two",
    )
    await value.whenIdle()

    expect(client.updateCalls).toEqual([])
    expect(client.resetCalls).toEqual([{ id: value.bufferId, content: "xone + two", version: 2 }])
    expect(value.getStats()).toMatchObject({ incrementalCount: 0, resetCount: 1, version: 2 })
  })

  test("recovers a failed incremental conversion with one ordered reset", async () => {
    const value = createHighlighter()
    await value.whenIdle()
    client.updateError = new Error("invalid UTF-8 edit conversion")

    editBuffer.insertChar("x")
    await value.whenIdle()

    expect(value.isActive()).toBe(true)
    expect(client.updateCalls).toEqual([])
    expect(client.resetCalls).toEqual([{ id: value.bufferId, content: "xone + two", version: 3 }])
    expect(client.getContent(value.bufferId)).toBe(editBuffer.getText())
    expect(value.getStats()).toMatchObject({ incrementalCount: 0, resetCount: 1, version: 3 })
  })

  test("keeps paced typing incremental without resets", async () => {
    const value = createHighlighter()
    await value.whenIdle()

    for (const char of "paced") {
      editBuffer.insertChar(char)
      await value.whenIdle()
    }

    expect(client.updateCalls).toHaveLength(5)
    expect(client.resetCalls).toEqual([])
    expect(value.getStats()).toMatchObject({
      receivedEditCount: 5,
      incrementalCount: 5,
      resetCount: 0,
      coalescedEditCount: 0,
      maxQueueDepth: 1,
    })
  })

  test("bounds pending state and reaches the exact final content for 10, 100, 600, and 10k edit bursts", async () => {
    for (const editCount of [10, 100, 600, 10_000]) {
      await highlighter?.dispose()
      editBuffer.destroy()
      syntaxStyle.destroy()

      editBuffer = EditBuffer.create("unicode")
      editBuffer.setText("")
      await flushNativeEvents()
      syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" }, keyword: { fg: "#ff0000" } })
      editBuffer.setSyntaxStyle(syntaxStyle)
      client = new FakeIncrementalClient()
      const value = createHighlighter()
      await value.whenIdle()

      for (let index = 0; index < editCount; index++) {
        if (index % 2 === 0) editBuffer.insertChar("x")
        else editBuffer.deleteCharBackward()
      }
      await value.whenIdle()

      expect(client.getContent(value.bufferId)).toBe(editBuffer.getText())
      expect(client.updateCalls).toHaveLength(1)
      expect(client.resetCalls).toHaveLength(1)
      expect(value.getStats()).toMatchObject({
        receivedEditCount: editCount,
        coalescedEditCount: editCount - 2,
        incrementalCount: 1,
        resetCount: 1,
        maxQueueDepth: 2,
        queueDepth: 0,
      })
    }
  }, 20_000)

  test("does not publish an in-flight response after a newer editor snapshot", async () => {
    client.deferOperations = true
    const value = createHighlighter()
    await value.whenIdle()

    editBuffer.insertChar("a")
    editBuffer.insertChar("b")
    client.respond(value.bufferId, 2, response({ highlights: [{ startIndex: 0, endIndex: 1, group: "keyword" }] }))
    expect(value.getStats().publicationCount).toBe(0)
    expect(value.getRangeCount()).toBe(0)

    client.resolveNextOperation()
    await flushNativeEvents()
    client.respond(value.bufferId, 3, response({ highlights: [{ startIndex: 0, endIndex: 2, group: "keyword" }] }))
    expect(value.getStats().publicationCount).toBe(1)
    client.resolveNextOperation()
    await value.whenIdle()
    expect(value.getRangeCount()).toBe(1)
  })

  test("reports the live namespace count after native splice deletion before a response", async () => {
    const value = createHighlighter()
    await value.whenIdle()
    client.respond(
      value.bufferId,
      1,
      response({
        queryKind: "full",
        highlights: [
          { startIndex: 0, endIndex: 3, group: "keyword" },
          { startIndex: 6, endIndex: 9, group: "string" },
        ],
      }),
    )
    expect(value.getRangeCount()).toBe(2)

    editBuffer.deleteRange(0, 0, 0, 3)
    expect(value.getRangeCount()).toBe(1)
    await value.whenIdle()
    client.respond(value.bufferId, 2, response())
    expect(value.getRangeCount()).toBe(1)
  })

  test("keeps the exact live count when annotation publication fails", async () => {
    const value = createHighlighter()
    await value.whenIdle()
    client.respond(
      value.bufferId,
      1,
      response({ queryKind: "full", highlights: [{ startIndex: 0, endIndex: 3, group: "keyword" }] }),
    )
    expect(value.getRangeCount()).toBe(1)
    const applyAnnotationOperations = editBuffer.applyAnnotationOperations.bind(editBuffer)
    editBuffer.applyAnnotationOperations = () => {
      throw new Error("annotation apply failed")
    }

    try {
      expect(() =>
        client.respond(
          value.bufferId,
          1,
          response({ queryKind: "full", highlights: [{ startIndex: 6, endIndex: 9, group: "string" }] }),
        ),
      ).toThrow("annotation apply failed")
      expect(value.getRangeCount()).toBe(1)
      expect(value.getStats().publicationCount).toBe(1)
    } finally {
      editBuffer.applyAnnotationOperations = applyAnnotationOperations
    }
  })

  test("uses authoritative style IDs and caches merged definitions", async () => {
    const value = createHighlighter()
    await value.whenIdle()
    const overlapping = response({
      queryKind: "full",
      replacementRanges: [{ startIndex: 0, endIndex: 3 }],
      highlights: [
        { startIndex: 0, endIndex: 3, group: "keyword" },
        { startIndex: 1, endIndex: 2, group: "string" },
      ],
    })
    client.respond(value.bufferId, 1, overlapping)
    const first = editBuffer.queryAnnotations({ kind: "namespace", namespace: value.namespace })
    const mergedStyleId = first.find(({ startByte, endByte }) => startByte === 1 && endByte === 2)?.styleId
    expect(first[0]?.styleId).toBe(syntaxStyle.getStyleId("keyword")!)
    expect(mergedStyleId).toBeDefined()
    const styleCount = syntaxStyle.getStyleCount()

    client.respond(value.bufferId, 1, overlapping)
    const second = editBuffer.queryAnnotations({ kind: "namespace", namespace: value.namespace })
    expect(second.find(({ startByte, endByte }) => startByte === 1 && endByte === 2)?.styleId).toBe(mergedStyleId)
    expect(syntaxStyle.getStyleCount()).toBe(styleCount)

    await value.dispose()
    highlighter = undefined
    const replacement = createHighlighter()
    await replacement.whenIdle()
    client.respond(replacement.bufferId, 1, overlapping)
    expect(syntaxStyle.getStyleCount()).toBe(styleCount)
    expect(
      editBuffer
        .queryAnnotations({ kind: "namespace", namespace: replacement.namespace })
        .find(({ startByte, endByte }) => startByte === 1 && endByte === 2)?.styleId,
    ).toBe(mergedStyleId)
  })

  test("cleans up a create race without publishing or destroying the client", async () => {
    client.deferCreate = true
    const value = createHighlighter()
    const disposal = value.dispose()
    client.respond(value.bufferId, 1, response({ highlights: [{ startIndex: 0, endIndex: 3, group: "keyword" }] }))
    expect(value.getRangeCount()).toBe(0)
    expect(client.listenerCount("highlights:response")).toBe(0)

    client.resolveCreate()
    await disposal
    expect(client.removeCalls).toEqual([value.bufferId])
    expect(client.getBuffer(value.bufferId)).toBeUndefined()

    editBuffer.insertText("x")
    await flushNativeEvents()
    expect(client.updateCalls).toEqual([])
    expect(client.resetCalls).toEqual([])
  })

  test("cleans up unavailable initialization and allows a retry", async () => {
    client.createResult = false
    const failed = createHighlighter()
    await failed.whenIdle()

    expect(failed.isActive()).toBe(false)
    expect(failed.getStats().error).toBe("TypeScript Tree-sitter parser is unavailable")
    expect(client.listenerCount("highlights:response")).toBe(0)
    expect((editBuffer as any).contentSnapshotSubscribers.size).toBe(0)
    expect(client.removeCalls).toEqual([failed.bufferId])
    expect(client.getBuffer(failed.bufferId)).toBeUndefined()
    await failed.dispose()
    expect(client.removeCalls).toEqual([failed.bufferId])

    client.createResult = true
    const retry = createHighlighter()
    await retry.whenIdle()
    expect(retry.isActive()).toBe(true)
    expect(client.listenerCount("highlights:response")).toBe(1)
    expect((editBuffer as any).contentSnapshotSubscribers.size).toBe(1)
  })

  test("cleans up a synchronous create throw without queueing updates", async () => {
    client.createError = new Error("create exploded")
    const value = createHighlighter()
    await value.whenIdle()

    expect(value.isActive()).toBe(false)
    expect(value.getStats().error).toBe("create exploded")
    expect(client.listenerCount("highlights:response")).toBe(0)
    expect((editBuffer as any).contentSnapshotSubscribers.size).toBe(0)
    expect(client.removeCalls).toEqual([value.bufferId])

    editBuffer.insertText("ignored")
    await flushNativeEvents()
    expect(client.updateCalls).toEqual([])
    expect(client.resetCalls).toEqual([])
  })
})
