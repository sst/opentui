import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { RGBA } from "../lib/RGBA.js"
import { StyledText } from "../lib/styled-text.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { TextBuffer } from "../text-buffer.js"
import { TextBufferView } from "../text-buffer-view.js"
import { TextAttributes, type CapturedFrame, type CapturedSpan } from "../types.js"
import { Renderable } from "../Renderable.js"
import { resolveRenderLib } from "../zig.js"
import { TextRenderable } from "./Text.js"
import { SyntaxStyle } from "../syntax-style.js"
import { treeSitterToTextChunks } from "../lib/tree-sitter-styled-text.js"

function findSpan(spans: CapturedSpan[], text: string): CapturedSpan | undefined {
  return spans.find((span) => span.text.includes(text))
}

describe("nested TextRenderable", () => {
  let renderer: TestRenderer
  let renderOnce: () => Promise<void>
  let captureSpans: () => CapturedFrame

  beforeEach(async () => {
    const setup = await createTestRenderer({ width: 40, height: 5 })
    renderer = setup.renderer
    renderOnce = setup.renderOnce
    captureSpans = setup.captureSpans
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("renders nested TextRenderables in one text flow with inherited styles", async () => {
    const root = new TextRenderable(renderer, { attributes: TextAttributes.DIM })
    const prefix = new TextRenderable(renderer, { content: "Hello " })
    const child = new TextRenderable(renderer, {
      content: "World",
      fg: "#ff0000",
      attributes: TextAttributes.UNDERLINE,
    })

    root.add(prefix)
    root.add(child)
    renderer.root.add(root)
    await renderOnce()

    expect(root.plainText).toBe("Hello World")

    const spans = captureSpans().lines[0]!.spans
    const hello = findSpan(spans, "Hello")
    const world = findSpan(spans, "World")

    expect(hello).toBeDefined()
    expect(world).toBeDefined()
    expect(hello!.attributes & TextAttributes.DIM).toBeTruthy()
    expect(world!.attributes & TextAttributes.DIM).toBeTruthy()
    expect(world!.attributes & TextAttributes.UNDERLINE).toBeTruthy()
    expect(world!.fg.toInts()).toEqual(RGBA.fromHex("#ff0000").toInts())
  })

  test("updates nested text and styles without rebuilding sibling identities", async () => {
    const root = new TextRenderable(renderer, {})
    const prefix = new TextRenderable(renderer, { content: "Status: " })
    const value = new TextRenderable(renderer, { content: "idle", fg: "#888888" })

    root.add(prefix)
    root.add(value)
    renderer.root.add(root)
    await renderOnce()

    const prefixIdentity = root.getTextChildren()[0]

    value.content = "ready"
    value.fg = "#00ff00"
    await renderOnce()

    expect(root.plainText).toBe("Status: ready")
    expect(root.getTextChildren()[0]).toBe(prefixIdentity)

    const ready = findSpan(captureSpans().lines[0]!.spans, "ready")
    expect(ready).toBeDefined()
    expect(ready!.fg.toInts()).toEqual(RGBA.fromHex("#00ff00").toInts())
  })

  test("supports insertion, removal, and nested descendants", async () => {
    const root = new TextRenderable(renderer, {})
    const first = new TextRenderable(renderer, { content: "A" })
    const middle = new TextRenderable(renderer, { attributes: TextAttributes.BOLD })
    const nested = new TextRenderable(renderer, { content: "B" })
    const last = new TextRenderable(renderer, { content: "C" })

    middle.add(nested)
    root.add(first)
    root.add(last)
    root.insertBefore(middle, last)
    renderer.root.add(root)
    await renderOnce()

    expect(root.plainText).toBe("ABC")
    const nestedSpan = findSpan(captureSpans().lines[0]!.spans, "B")
    expect(nestedSpan!.attributes & TextAttributes.BOLD).toBeTruthy()

    root.remove(middle)
    await renderOnce()

    expect(root.plainText).toBe("AC")
    expect(middle.parent).toBeNull()
  })

  test("keeps native document state only on the outer text and restores it after detach", async () => {
    const root = new TextRenderable(renderer, { content: "root" })
    const child = new TextRenderable(renderer, { content: "child", width: 7 })
    const yogaNode = child.getLayoutNode()

    expect((child as any).hasTextDocumentState).toBe(true)
    root.add(child)

    expect((root as any).hasTextDocumentState).toBe(true)
    expect((child as any).hasTextDocumentState).toBe(false)
    expect(child.getLayoutNode()).toBe(yogaNode)
    expect(child.width).toBe(7)

    root.remove(child)
    expect((child as any).hasTextDocumentState).toBe(true)
    expect(child.getLayoutNode()).toBe(yogaNode)
    expect(child.plainText).toBe("child")

    root.add(child)
    expect((child as any).hasTextDocumentState).toBe(false)
    renderer.root.add(root)
  })

  test("commits one range-local replacement for batched nested text and style changes", async () => {
    const applyDocumentOperations = spyOn(TextBuffer.prototype, "applyDocumentOperations")
    try {
      const root = new TextRenderable(renderer, {})
      const child = new TextRenderable(renderer, { content: "before" })
      root.add(child)
      renderer.root.add(root)
      await renderOnce()

      const callsBeforeUpdate = applyDocumentOperations.mock.calls.length
      const rangeId = (child as any)._nativeRangeId
      child.content = "after"
      child.fg = "#00ff00"
      child.attributes = TextAttributes.BOLD

      expect(applyDocumentOperations.mock.calls.length).toBe(callsBeforeUpdate)
      await renderOnce()
      expect(applyDocumentOperations.mock.calls.length).toBe(callsBeforeUpdate + 1)
      expect(applyDocumentOperations.mock.calls.at(-1)![0].filter((operation) => operation.kind === "replace")).toEqual(
        [expect.objectContaining({ targetId: rangeId })],
      )
      expect((child as any)._nativeRangeId).toBe(rangeId)
      expect(root.plainText).toBe("after")
    } finally {
      applyDocumentOperations.mockRestore()
    }
  })

  test("style-only updates preserve content epoch and range identity while toggling paint", async () => {
    const root = new TextRenderable(renderer, {})
    const child = new TextRenderable(renderer, { content: "stable" })
    root.add(child)
    renderer.root.add(root)
    await renderOnce()

    const rangeId = (child as any)._nativeRangeId
    const contentEpoch = (root as any).textBuffer.contentEpoch
    const annotationEpoch = (root as any).textBuffer.annotationEpoch
    expect((root as any).textBuffer.getDocumentRange(rangeId).styled).toBe(false)
    child.fg = "#00ff00"
    child.link = { url: "https://example.com" }
    await renderOnce()

    expect((child as any)._nativeRangeId).toBe(rangeId)
    expect((root as any).textBuffer.getDocumentRange(rangeId).styled).toBe(true)
    expect((root as any).textBuffer.contentEpoch).toBe(contentEpoch)
    expect((root as any).textBuffer.annotationEpoch).toBeGreaterThan(annotationEpoch)

    child.fg = undefined
    child.link = undefined
    await renderOnce()
    expect((child as any)._nativeRangeId).toBe(rangeId)
    expect((root as any).textBuffer.getDocumentRange(rangeId).styled).toBe(false)
    expect((root as any).textBuffer.contentEpoch).toBe(contentEpoch)
  })

  test("same-document reorder uses native move and preserves range IDs", async () => {
    const root = new TextRenderable(renderer, {})
    const first = new TextRenderable(renderer, { content: "A" })
    const second = new TextRenderable(renderer, { content: "B" })
    const third = new TextRenderable(renderer, { content: "C" })
    root.children = [first, second, third]
    renderer.root.add(root)
    await renderOnce()
    const ids = [first, second, third].map((child) => (child as any)._nativeRangeId)
    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations")
    try {
      root.children = [third, first, second]
      expect(apply).not.toHaveBeenCalled()
      await renderOnce()
      expect(apply).toHaveBeenCalledTimes(1)
      expect(apply.mock.calls[0]![0].some((operation) => operation.kind === "move")).toBe(true)
      expect(apply.mock.calls[0]![0].some((operation) => operation.kind === "replace")).toBe(false)
      expect(root.plainText).toBe("CAB")
      expect([first, second, third].map((child) => (child as any)._nativeRangeId)).toEqual(ids)
    } finally {
      apply.mockRestore()
    }
  })

  test("preflights move range queries and lifecycle scheduling before changing child order", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    root.children = children
    renderer.root.add(root)
    await renderOnce()
    const ids = children.map((child) => (child as any)._nativeRangeId)
    const dirty = root.isDirty

    const range = spyOn(TextBuffer.prototype, "getDocumentRange").mockImplementationOnce(() => {
      throw new Error("injected range query failure")
    })
    try {
      expect(() => root.add(children[0]!, root.getChildrenCount())).toThrow("range query failure")
      expect(root.children).toEqual(children)
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect((root as any)._pendingNativeMoves).toHaveLength(0)
      expect(root.isDirty).toBe(dirty)
      expect(root.plainText).toBe("ABC")
    } finally {
      range.mockRestore()
    }

    const request = spyOn(root, "requestRender").mockImplementationOnce(() => {
      throw new Error("injected lifecycle failure")
    })
    try {
      expect(() => root.add(children[0]!, root.getChildrenCount())).toThrow("lifecycle failure")
      expect(root.children).toEqual(children)
      expect((root as any)._pendingNativeMoves).toHaveLength(0)
      expect(root.isDirty).toBe(dirty)
    } finally {
      request.mockRestore()
    }
  })

  test("rolls back a failed move-log append before scheduling or changing order", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    root.children = children
    renderer.root.add(root)
    await renderOnce()
    const pending = (root as any)._pendingNativeMoves as Array<unknown> & { push: (...items: unknown[]) => number }
    const originalPush = pending.push
    const request = spyOn(root, "requestRender")
    pending.push = () => {
      throw new Error("injected move-log allocation failure")
    }
    try {
      expect(() => root.add(children[0]!, root.getChildrenCount())).toThrow("move-log allocation failure")
      expect(request).not.toHaveBeenCalled()
      expect(root.children).toEqual(children)
      expect(pending).toHaveLength(0)
      expect(root.plainText).toBe("ABC")
    } finally {
      pending.push = originalPush
      request.mockRestore()
    }
  })

  test("retains a queued structural move after native apply failure and retries without duplicate events", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    root.children = children
    renderer.root.add(root)
    await renderOnce()
    let events = 0
    root.on("line-info-change", () => events++)
    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations").mockImplementationOnce(() => {
      throw new Error("injected native apply failure")
    })
    try {
      root.add(children[0]!, root.getChildrenCount())
      expect(root.children).toEqual([children[1], children[2], children[0]])
      expect(() => root.plainText).toThrow("native apply failure")
      expect((root as any)._pendingNativeMoves).toHaveLength(1)
      expect(events).toBe(0)
      expect(root.plainText).toBe("BCA")
      expect((root as any)._pendingNativeMoves).toHaveLength(0)
      expect(events).toBe(1)
    } finally {
      apply.mockRestore()
    }
  })

  test("keeps reordered children when StyledText is added before flush", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    root.children = children
    renderer.root.add(root)
    await renderOnce()
    const ids = children.map((child) => (child as any)._nativeRangeId)
    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations")
    try {
      root.add(children[0]!, root.getChildrenCount())
      expect((root as any)._pendingNativeMoves).toHaveLength(1)

      root.add(new StyledText([{ __isChunk: true, text: "D" }]))
      const generated = root.getTextChildren()[3]!
      expect(root.getTextChildren()).toEqual([children[1], children[2], children[0], generated])
      expect(root.getChildrenCount()).toBe(4)
      expect(children.map((child) => child.parent)).toEqual([root, root, root])
      expect(generated.parent).toBe(root)
      expect((root as any)._pendingNativeMoves).toHaveLength(1)
      expect(apply).not.toHaveBeenCalled()

      await renderOnce()
      expect(apply).toHaveBeenCalledTimes(1)
      expect(apply.mock.calls[0]![0].map((operation) => operation.kind)).toEqual(["replace"])
      expect(root.plainText).toBe("BCAD")
      expect(root.getTextChildren()).toEqual([children[1], children[2], children[0], generated])
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect((root as any)._pendingNativeMoves).toHaveLength(0)
    } finally {
      apply.mockRestore()
    }
  })

  test("replaces a missing index after repeated pending moves in logical order", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
    root.children = children
    renderer.root.add(root)
    await renderOnce()
    const ids = children.map((child) => (child as any)._nativeRangeId)
    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations")

    try {
      root.add(children[0]!, 3)
      root.add(children[2]!, root.getChildrenCount())
      expect(root.children).toEqual([children[1], children[0], children[3], children[2]])
      expect((root as any)._pendingNativeMoves).toHaveLength(2)

      root.replace("E", 999)
      expect(root.children).toEqual([children[1], children[0], children[3], children[2], "E"])
      expect(children.every((child) => child.parent === root)).toBe(true)
      expect((root as any)._pendingNativeMoves).toHaveLength(2)
      await renderOnce()
      expect(root.plainText).toBe("BADCE")
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect(apply.mock.calls.flatMap(([operations]) => operations.map((operation) => operation.kind))).toEqual([
        "replace",
      ])
      expect((root as any)._pendingNativeMoves).toHaveLength(0)
    } finally {
      apply.mockRestore()
    }
  })

  test("replaces valid and missing indices with every supported value ownership", async () => {
    const valueKinds = ["string", "styled", "detached", "same-document", "cross-document"] as const
    const indexCases = [
      { index: 1, expected: "BEDC", childCount: 4 },
      { index: 999, expected: "BADCE", childCount: 5 },
      { index: -999, expected: "EBADC", childCount: 5 },
    ] as const

    for (const valueKind of valueKinds) {
      for (const indexCase of indexCases) {
        const target = new TextRenderable(renderer, {})
        const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
        target.children = children
        let mount = target
        let sourceDocument: TextRenderable | null = null
        let replacement: TextRenderable | null = null
        let value: string | StyledText | TextRenderable

        if (valueKind === "string") {
          value = "E"
        } else if (valueKind === "styled") {
          value = new StyledText([{ __isChunk: true, text: "E", attributes: TextAttributes.BOLD }])
        } else if (valueKind === "detached") {
          replacement = new TextRenderable({ content: "E" })
          value = replacement
        } else if (valueKind === "same-document") {
          replacement = new TextRenderable(renderer, { content: "E" })
          const source = new TextRenderable(renderer, { visible: false })
          source.add(replacement)
          mount = new TextRenderable(renderer, {})
          mount.children = [target, source]
          value = replacement
        } else {
          replacement = new TextRenderable(renderer, { content: "E" })
          sourceDocument = new TextRenderable(renderer, {})
          sourceDocument.add(replacement)
          value = replacement
        }

        renderer.root.add(mount)
        if (sourceDocument) renderer.root.add(sourceDocument)
        await renderOnce()
        const originalIds = children.map((child) => (child as any)._nativeRangeId)
        const replacementId = replacement ? (replacement as any)._nativeRangeId : null

        target.add(children[0]!, 3)
        target.add(children[2]!, target.getChildrenCount())
        expect((mount as any)._pendingNativeMoves).toHaveLength(2)
        target.replace(value, indexCase.index)
        expect((mount as any)._pendingNativeMoves).toHaveLength(valueKind === "cross-document" ? 0 : 2)
        expect(target.getChildrenCount()).toBe(indexCase.childCount)
        await renderOnce()
        expect(target.plainText).toBe(indexCase.expected)
        expect((mount as any)._pendingNativeMoves).toHaveLength(0)

        const retained = indexCase.index === 1 ? [children[1], children[2], children[3]] : children
        const retainedIds = indexCase.index === 1 ? [originalIds[1], originalIds[2], originalIds[3]] : originalIds
        expect(retained.map((child) => (child as any)._nativeRangeId)).toEqual(retainedIds)
        if (valueKind === "string") {
          const rawIndex = target.children.indexOf("E")
          expect((target as any)._leaves[rawIndex].rangeId).not.toBeNull()
        } else if (valueKind === "styled") {
          const generated = target.getTextChildren().find((child) => child.chunks[0]?.text === "E")!
          expect(generated.parent).toBe(target)
          expect((generated as any)._nativeRangeId).not.toBeNull()
          expect((target as any)._ownedChildren.has(generated)).toBe(true)
        } else if (replacement) {
          expect(replacement.parent).toBe(target)
          expect((replacement as any)._nativeRangeId).not.toBeNull()
          if (valueKind === "same-document") expect((replacement as any)._nativeRangeId).toBe(replacementId)
          if (valueKind === "cross-document") expect((replacement as any)._nativeRangeId).not.toBe(replacementId)
        }
      }
    }
  }, 15_000)

  test("preserves owner moves outside a rebuilt subtree", async () => {
    const owner = new TextRenderable(renderer, {})
    const before = new TextRenderable(renderer, { content: "X" })
    const target = new TextRenderable(renderer, {})
    const after = new TextRenderable(renderer, { content: "Y" })
    const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
    target.children = children
    owner.children = [before, target, after]
    renderer.root.add(owner)
    await renderOnce()

    owner.add(before, owner.getChildrenCount())
    target.add(children[0]!, 3)
    target.add(children[2]!, target.getChildrenCount())
    expect((owner as any)._pendingNativeMoves).toHaveLength(3)

    target.replace("E", 999)
    expect((owner as any)._pendingNativeMoves).toHaveLength(3)
    expect(owner.children).toEqual([target, after, before])
    await renderOnce()
    expect(owner.plainText).toBe("BADCEYX")
    expect((owner as any)._pendingNativeMoves).toHaveLength(0)
  })

  test("coalesces parent moves when a nested mutation rebuilds the document owner", async () => {
    const owner = new TextRenderable(renderer, {})
    const before = new TextRenderable(renderer, { content: "X" })
    const target = new TextRenderable(renderer, {})
    const after = new TextRenderable(renderer, { content: "Y" })
    const unaffected = new TextRenderable(renderer, { content: "Z" })
    const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
    target.children = children
    owner.children = [before, target, after, unaffected]
    renderer.root.add(owner)
    await renderOnce()

    owner.add(target, owner.getChildrenCount())
    owner.add(unaffected, 0)
    target.add(children[0]!, 3)
    target.add(children[2]!, target.getChildrenCount())
    expect(owner.getTextChildren()).toEqual([unaffected, before, after, target])
    expect(target.getTextChildren()).toEqual([children[1], children[0], children[3], children[2]])
    expect((owner as any)._pendingNativeMoves).toHaveLength(4)

    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations")
    try {
      target.replace("E", 999)
      await renderOnce()
      expect(owner.plainText).toBe("ZXYBADCE")
      expect((owner as any)._pendingNativeMoves).toHaveLength(0)
      expect(apply.mock.calls.flatMap(([operations]) => operations.map((operation) => operation.kind))).toEqual([
        "replace",
      ])
    } finally {
      apply.mockRestore()
    }
  })

  test("preserves boundary moves when only the nested replacement range is rebuilt", async () => {
    const owner = new TextRenderable(renderer, {})
    const before = new TextRenderable(renderer, { content: "X" })
    const target = new TextRenderable(renderer, {})
    const after = new TextRenderable(renderer, { content: "Y" })
    const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    target.children = children
    owner.children = [before, target, after]
    renderer.root.add(owner)
    await renderOnce()
    const targetId = (target as any)._nativeRangeId

    owner.add(target, owner.getChildrenCount())
    target.add(children[0]!, target.getChildrenCount())
    target.visible = false
    expect((owner as any)._pendingNativeMoves).toHaveLength(2)

    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations").mockImplementationOnce(() => {
      throw new Error("injected boundary replacement failure")
    })
    try {
      expect(() => owner.plainText).toThrow("boundary replacement failure")
      expect((owner as any)._pendingNativeMoves).toHaveLength(2)
      expect((owner as any).textBuffer.getPlainText()).toBe("XABCY")
      expect(owner.plainText).toBe("XY")
      expect((owner as any)._pendingNativeMoves).toHaveLength(0)
      expect(owner.getTextChildren()).toEqual([before, after, target])
      expect(target.getTextChildren()).toEqual([children[1], children[2], children[0]])
      const operations = apply.mock.calls.flatMap(([pending]) => pending)
      expect(operations.map((operation) => operation.kind)).toEqual(["replace", "move", "replace", "move"])
      expect(operations[0]!.targetId).toBe(targetId)
      expect(operations[2]!.targetId).toBe(targetId)

      target.visible = true
      await renderOnce()
      expect(owner.plainText).toBe("XYBCA")
    } finally {
      apply.mockRestore()
    }
  })

  test("coalesces moves at every nested level when the owner range is rebuilt", async () => {
    const owner = new TextRenderable(renderer, {})
    const before = new TextRenderable(renderer, { content: "X" })
    const outer = new TextRenderable(renderer, {})
    const outerBefore = new TextRenderable(renderer, { content: "Q" })
    const target = new TextRenderable(renderer, {})
    const outerAfter = new TextRenderable(renderer, { content: "R" })
    const after = new TextRenderable(renderer, { content: "Y" })
    const unaffected = new TextRenderable(renderer, { content: "Z" })
    const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
    target.children = children
    outer.children = [outerBefore, target, outerAfter]
    owner.children = [before, outer, after, unaffected]
    renderer.root.add(owner)
    await renderOnce()

    owner.add(outer, owner.getChildrenCount())
    owner.add(unaffected, 0)
    outer.add(target, 0)
    target.add(children[0]!, 3)
    target.add(children[2]!, target.getChildrenCount())
    target.replace("E", 999)

    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations")
    try {
      await renderOnce()
      expect(owner.plainText).toBe("ZXYBADCEQR")
      expect(apply.mock.calls.flatMap(([operations]) => operations.map((operation) => operation.kind))).toEqual([
        "replace",
      ])
    } finally {
      apply.mockRestore()
    }
  })

  test("keeps replacement coalescing isolated between document owners", async () => {
    const left = new TextRenderable(renderer, {})
    const leftChildren = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    const right = new TextRenderable(renderer, {})
    const rightChildren = ["D", "E", "F"].map((content) => new TextRenderable(renderer, { content }))
    left.children = leftChildren
    right.children = rightChildren
    renderer.root.add(left)
    renderer.root.add(right)
    await renderOnce()

    left.add(leftChildren[0]!, left.getChildrenCount())
    right.add(rightChildren[0]!, right.getChildrenCount())
    right.add("G")
    expect((left as any)._pendingNativeMoves).toHaveLength(1)
    expect((right as any)._pendingNativeMoves).toHaveLength(1)

    await renderOnce()
    expect(left.plainText).toBe("BCA")
    expect(right.plainText).toBe("EFDG")
    expect((left as any)._pendingNativeMoves).toHaveLength(0)
    expect((right as any)._pendingNativeMoves).toHaveLength(0)
  })

  test("coalesces whole-owner moves for remove, clear, and content replacement", async () => {
    const cases = [
      {
        mutate(target: TextRenderable, children: TextRenderable[]) {
          target.remove(children[1]!)
        },
        expected: "ZXYCA",
      },
      {
        mutate(target: TextRenderable) {
          target.clear()
        },
        expected: "ZXY",
      },
      {
        mutate(target: TextRenderable) {
          target.content = "E"
        },
        expected: "ZXYE",
      },
    ]

    for (const scenario of cases) {
      const owner = new TextRenderable(renderer, {})
      const before = new TextRenderable(renderer, { content: "X" })
      const target = new TextRenderable(renderer, {})
      const after = new TextRenderable(renderer, { content: "Y" })
      const unaffected = new TextRenderable(renderer, { content: "Z" })
      const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
      target.children = children
      owner.children = [before, target, after, unaffected]
      renderer.root.add(owner)
      await renderOnce()

      owner.add(target, owner.getChildrenCount())
      owner.add(unaffected, 0)
      target.add(children[0]!, target.getChildrenCount())
      scenario.mutate(target, children)
      await renderOnce()
      expect(owner.plainText).toBe(scenario.expected)
    }
  })

  test("coalesces forward, backward, and repeated moves before a missing replacement", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
    root.children = children
    renderer.root.add(root)
    await renderOnce()

    root.add(children[0]!, root.getChildrenCount())
    root.add(children[3]!, 0)
    root.add(children[0]!, 1)
    root.add(children[0]!, root.getChildrenCount())
    root.add(children[2]!, 0)
    expect(root.children).toEqual([children[2], children[3], children[1], children[0]])
    expect((root as any)._pendingNativeMoves).toHaveLength(5)

    root.replace("E", 999)
    expect((root as any)._pendingNativeMoves).toHaveLength(5)
    await renderOnce()
    expect(root.plainText).toBe("CDBAE")
    expect((root as any)._pendingNativeMoves).toHaveLength(0)
  })

  test("rolls back replacement preflight and scheduling failures and retries native apply", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
    const replacement = new TextRenderable({ content: "E" })
    root.children = children
    renderer.root.add(root)
    await renderOnce()
    const ids = children.map((child) => (child as any)._nativeRangeId)
    let events = 0
    root.on("line-info-change", () => events++)

    root.add(children[0]!, 3)
    root.add(children[2]!, root.getChildrenCount())
    ;(root as any)._dirty = false

    const preflight = spyOn(root as any, "assertCanInsertTextChild").mockImplementationOnce(() => {
      throw new Error("injected replacement preflight failure")
    })
    try {
      expect(() => root.replace(replacement, 999)).toThrow("replacement preflight failure")
      expect(root.children).toEqual([children[1], children[0], children[3], children[2]])
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect(replacement.parent).toBeNull()
      expect((replacement as any)._nativeRangeId).toBeNull()
      expect((root as any)._pendingNativeMoves).toHaveLength(2)
      expect(root.isDirty).toBe(false)
      expect(events).toBe(0)
    } finally {
      preflight.mockRestore()
    }

    const schedule = spyOn(root, "requestRender").mockImplementationOnce(() => {
      ;(root as any)._dirty = true
      throw new Error("injected replacement scheduling failure")
    })
    try {
      expect(() => root.replace(replacement, 999)).toThrow("replacement scheduling failure")
      expect(root.children).toEqual([children[1], children[0], children[3], children[2]])
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect(replacement.parent).toBeNull()
      expect((replacement as any)._nativeRangeId).toBeNull()
      expect((root as any)._pendingNativeMoves).toHaveLength(2)
      expect(root.isDirty).toBe(false)
      expect(events).toBe(0)
    } finally {
      schedule.mockRestore()
    }

    root.replace(replacement, 999)
    expect(root.children).toEqual([children[1], children[0], children[3], children[2], replacement])
    expect(replacement.parent).toBe(root)
    expect((root as any)._pendingNativeMoves).toHaveLength(2)
    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations").mockImplementationOnce(() => {
      throw new Error("injected replacement native apply failure")
    })
    try {
      expect(() => root.plainText).toThrow("replacement native apply failure")
      expect((root as any).textBuffer.getPlainText()).toBe("ABCD")
      expect(root.children).toEqual([children[1], children[0], children[3], children[2], replacement])
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect((replacement as any)._nativeRangeId).toBeNull()
      expect(replacement.parent).toBe(root)
      expect((root as any)._pendingNativeMoves).toHaveLength(2)
      expect(root.isDirty).toBe(true)
      expect(events).toBe(0)

      expect(root.plainText).toBe("BADCE")
      expect((root as any).textBuffer.getPlainText()).toBe("BADCE")
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect((replacement as any)._nativeRangeId).not.toBeNull()
      expect((root as any)._pendingNativeMoves).toHaveLength(0)
      expect(events).toBe(1)
    } finally {
      apply.mockRestore()
    }
  })

  test("restores a foreign range and both documents when replacement transfer fails", async () => {
    const target = new TextRenderable(renderer, {})
    const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
    const source = new TextRenderable(renderer, {})
    const replacement = new TextRenderable(renderer, { content: "E" })
    target.children = children
    source.add(replacement)
    renderer.root.add(target)
    renderer.root.add(source)
    await renderOnce()
    const ids = children.map((child) => (child as any)._nativeRangeId)
    const foreignId = (replacement as any)._nativeRangeId
    let targetEvents = 0
    let sourceEvents = 0
    target.on("line-info-change", () => targetEvents++)
    source.on("line-info-change", () => sourceEvents++)

    target.add(children[0]!, 3)
    target.add(children[2]!, target.getChildrenCount())
    const dirty = target.isDirty
    const transfer = spyOn(TextBuffer.prototype, "applyTwoDocumentOperations").mockImplementationOnce(() => {
      throw new Error("injected replacement transfer failure")
    })
    try {
      expect(() => target.replace(replacement, 999)).toThrow("replacement transfer failure")
      expect(target.children).toEqual([children[1], children[0], children[3], children[2]])
      expect((target as any).textBuffer.getPlainText()).toBe("ABCD")
      expect((source as any).textBuffer.getPlainText()).toBe("E")
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect(replacement.parent).toBe(source)
      expect((replacement as any)._nativeRangeId).toBe(foreignId)
      expect((target as any)._pendingNativeMoves).toHaveLength(2)
      expect(target.isDirty).toBe(dirty)
      expect(targetEvents).toBe(0)
      expect(sourceEvents).toBe(0)

      target.replace(replacement, 999)
      expect(target.children).toEqual([children[1], children[0], children[3], children[2], replacement])
      expect(target.plainText).toBe("BADCE")
      expect(source.plainText).toBe("")
      expect((target as any).textBuffer.getPlainText()).toBe("BADCE")
      expect((source as any).textBuffer.getPlainText()).toBe("")
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect(replacement.parent).toBe(target)
      expect((replacement as any)._nativeRangeId).not.toBe(foreignId)
      expect((target as any)._pendingNativeMoves).toHaveLength(0)
      expect(targetEvents).toBe(1)
      expect(sourceEvents).toBe(1)
    } finally {
      transfer.mockRestore()
    }
  })

  test("coalesces setter-planned moves across every structural publication path", async () => {
    const cases = [
      {
        mutate(root: TextRenderable, children: TextRenderable[]) {
          root.add("E")
        },
        expected: "BCDAE",
      },
      {
        mutate(root: TextRenderable, children: TextRenderable[]) {
          root.replace("E", 999)
        },
        expected: "BCDAE",
      },
      {
        mutate(root: TextRenderable, children: TextRenderable[]) {
          root.remove(children[2]!)
        },
        expected: "BDA",
      },
      {
        mutate(root: TextRenderable, children: TextRenderable[]) {
          root.clear()
        },
        expected: "",
      },
      {
        mutate(root: TextRenderable, children: TextRenderable[]) {
          root.content = "E"
        },
        expected: "E",
      },
    ]

    for (const scenario of cases) {
      const root = new TextRenderable(renderer, {})
      const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
      root.children = children
      renderer.root.add(root)
      await renderOnce()

      root.children = [children[1]!, children[2]!, children[3]!, children[0]!]
      expect((root as any)._pendingChildOrder).toBeNull()
      expect((root as any)._pendingNativeMoves.length).toBeGreaterThan(0)
      scenario.mutate(root, children)
      expect((root as any)._pendingNativeMoves.length).toBeGreaterThan(0)
      await renderOnce()
      expect(root.plainText).toBe(scenario.expected)
      expect((root as any)._pendingNativeMoves).toHaveLength(0)
    }
  })

  test("retains pending moves through structural no-ops after materialization", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C", "D"].map((content) => new TextRenderable(renderer, { content }))
    const missing = new TextRenderable({ content: "missing" })
    root.children = children
    renderer.root.add(root)
    await renderOnce()

    root.add(children[0]!, 3)
    root.add(children[2]!, root.getChildrenCount())
    expect((root as any)._pendingNativeMoves).toHaveLength(2)
    root.add(children[1]!, 0)
    expect((root as any)._pendingNativeMoves).toHaveLength(2)
    root.replace(children[1]!, 0)
    expect((root as any)._pendingNativeMoves).toHaveLength(2)

    const warn = spyOn(console, "warn").mockImplementation(() => {})
    try {
      root.remove(missing)
    } finally {
      warn.mockRestore()
    }
    expect((root as any)._pendingChildOrder).toBeNull()
    expect((root as any)._pendingNativeMoves).toHaveLength(2)
    expect(missing.parent).toBeNull()
    await renderOnce()
    expect(root.plainText).toBe("BADC")
    expect((root as any)._pendingNativeMoves).toHaveLength(0)
    missing.destroy()
  })

  test("adds every text child kind at every position after a pending reorder", async () => {
    const cases = [
      { kind: "string", index: 0 },
      { kind: "string", index: 1 },
      { kind: "string", index: 3 },
      { kind: "styled", index: 0 },
      { kind: "styled", index: 1 },
      { kind: "styled", index: 3 },
      { kind: "renderable", index: 0 },
      { kind: "renderable", index: 1 },
      { kind: "renderable", index: 3 },
    ] as const

    for (const scenario of cases) {
      const root = new TextRenderable(renderer, {})
      const original = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
      root.children = original
      renderer.root.add(root)
      await renderOnce()
      const ids = original.map((child) => (child as any)._nativeRangeId)

      root.add(original[0]!, root.getChildrenCount())
      expect((root as any)._structuralMoveMetrics.materializedChildren).toBe(0)
      const value =
        scenario.kind === "string"
          ? "D"
          : scenario.kind === "styled"
            ? new StyledText([{ __isChunk: true, text: "D", attributes: TextAttributes.BOLD }])
            : new TextRenderable(renderer, { content: "D" })
      root.add(value, scenario.index)

      const inserted =
        scenario.kind === "styled" ? root.getTextChildren().find((child) => child.chunks[0]?.text === "D")! : value
      const expected: Array<string | TextRenderable> = [original[1]!, original[2]!, original[0]!]
      expected.splice(scenario.index, 0, inserted as string | TextRenderable)
      expect(root.children).toEqual(expected)
      expect(root.getChildrenCount()).toBe(4)
      expect((root as any)._pendingNativeMoves).toHaveLength(1)
      expect((root as any)._structuralMoveMetrics.materializedChildren).toBe(3)
      expect((root as any)._leaves.map((leaf: any) => leaf?.text ?? null)).toEqual(
        expected.map((child) => (typeof child === "string" ? child : null)),
      )
      expect(original.every((child) => child.parent === root)).toBe(true)
      if (inserted instanceof TextRenderable) expect(inserted.parent).toBe(root)

      await renderOnce()
      expect(root.plainText).toBe(
        expected.map((child) => (typeof child === "string" ? child : child.plainText)).join(""),
      )
      expect(original.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
    }
  })

  test("applies structural, content, style, and visibility changes after a pending reorder", async () => {
    const structuralCases = [
      {
        mutate(root: TextRenderable, children: TextRenderable[]) {
          root.remove(children[2]!)
        },
        expected: "BA",
      },
      {
        mutate(root: TextRenderable) {
          root.replace(new TextRenderable(renderer, { content: "D" }), 1)
        },
        expected: "BDA",
      },
      {
        mutate(root: TextRenderable) {
          root.clear()
        },
        expected: "",
      },
      {
        mutate(root: TextRenderable) {
          root.content = "D"
        },
        expected: "D",
      },
    ]

    for (const scenario of structuralCases) {
      const root = new TextRenderable(renderer, {})
      const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
      root.children = children
      renderer.root.add(root)
      await renderOnce()
      root.add(children[0]!, root.getChildrenCount())
      scenario.mutate(root, children)
      expect((root as any)._pendingNativeMoves).toHaveLength(1)
      expect((root as any)._pendingChildOrder).toBeNull()
      await renderOnce()
      expect(root.plainText).toBe(scenario.expected)
    }

    const styledRoot = new TextRenderable(renderer, {})
    const styledChildren = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    styledRoot.children = styledChildren
    renderer.root.add(styledRoot)
    await renderOnce()
    const ids = styledChildren.map((child) => (child as any)._nativeRangeId)
    styledRoot.add(styledChildren[0]!, styledRoot.getChildrenCount())
    styledRoot.fg = "#00ff00"
    styledChildren[1]!.attributes = TextAttributes.BOLD
    styledChildren[2]!.visible = false
    expect((styledRoot as any)._pendingNativeMoves).toHaveLength(1)
    expect((styledRoot as any)._pendingChildOrder).not.toBeNull()
    await renderOnce()
    expect(styledRoot.plainText).toBe("BA")
    expect(styledRoot.getTextChildren()).toEqual([styledChildren[1], styledChildren[2], styledChildren[0]])
    expect(styledChildren.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
    expect((styledRoot as any)._pendingNativeMoves).toHaveLength(0)
  })

  test("materializes once per interleaved structural mutation target", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    const inserted = new TextRenderable(renderer, { content: "D" })
    root.children = children
    renderer.root.add(root)
    await renderOnce()

    root.add(children[0]!, 3)
    root.add(children[1]!, 3)
    expect((root as any)._structuralMoveMetrics).toEqual({ orderNodes: 3, orderMoves: 2, materializedChildren: 0 })
    root.add(inserted, 1)
    expect(root.plainText).toBe("CDAB")
    expect((root as any)._structuralMoveMetrics).toEqual({ orderNodes: 3, orderMoves: 2, materializedChildren: 3 })

    root.add(children[2]!, root.getChildrenCount())
    root.remove(children[0]!)
    expect(root.children).toEqual([inserted, children[1], children[2]])
    expect((root as any)._structuralMoveMetrics).toEqual({ orderNodes: 7, orderMoves: 3, materializedChildren: 7 })
    expect((root as any)._pendingNativeMoves).toHaveLength(1)
    await renderOnce()
    expect(root.plainText).toBe("DBC")
    expect(inserted.parent).toBe(root)
    expect(children[0]!.parent).toBeNull()
  })

  test("coalesces nested moves during same- and cross-document adoption", async () => {
    const left = new TextRenderable(renderer, {})
    const right = new TextRenderable(renderer, { content: "R" })
    const container = new TextRenderable(renderer, {})
    const nested = ["X", "Y"].map((content) => new TextRenderable(renderer, { content }))
    const sibling = new TextRenderable(renderer, { content: "Z" })
    container.children = nested
    left.children = [container, sibling]
    renderer.root.add(left)
    renderer.root.add(right)
    await renderOnce()

    container.add(nested[0]!, container.getChildrenCount())
    expect((left as any)._pendingNativeMoves).toHaveLength(1)
    right.add(container)
    expect((left as any)._pendingNativeMoves).toHaveLength(0)
    expect(container.parent).toBe(right)
    expect(container.getTextChildren()).toEqual([nested[1], nested[0]])
    expect(nested.every((child) => child.parent === container)).toBe(true)
    expect(left.plainText).toBe("Z")
    expect(right.plainText).toBe("RYX")

    const moved = new TextRenderable(renderer, { content: "A" })
    const second = new TextRenderable(renderer, { content: "B" })
    const third = new TextRenderable(renderer, { content: "C" })
    left.children = [moved, second, third]
    await renderOnce()
    left.add(moved, left.getChildrenCount())
    right.add(moved)
    expect((left as any)._pendingNativeMoves).toHaveLength(0)
    expect(left.plainText).toBe("BC")
    expect(right.plainText).toBe("RYXA")
    expect(moved.parent).toBe(right)
  })

  test("rolls back and retries mixed pending-order scheduling and native failures", async () => {
    const root = new TextRenderable(renderer, {})
    const children = ["A", "B", "C"].map((content) => new TextRenderable(renderer, { content }))
    root.children = children
    renderer.root.add(root)
    await renderOnce()
    const ids = children.map((child) => (child as any)._nativeRangeId)
    root.add(children[0]!, root.getChildrenCount())

    const range = spyOn(TextBuffer.prototype, "getDocumentRange").mockImplementationOnce(() => {
      throw new Error("injected mixed preflight failure")
    })
    try {
      expect(() => root.add(children[1]!, root.getChildrenCount())).toThrow("mixed preflight failure")
      expect((root as any)._pendingChildOrder).not.toBeNull()
      expect((root as any)._pendingNativeMoves).toHaveLength(1)
      expect(children.every((child) => child.parent === root)).toBe(true)
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
    } finally {
      range.mockRestore()
    }

    const request = spyOn(root, "requestRender").mockImplementationOnce(() => {
      throw new Error("injected mixed scheduling failure")
    })
    try {
      expect(() => root.add(new StyledText([{ __isChunk: true, text: "D" }]))).toThrow("mixed scheduling failure")
      expect(root.children).toEqual([children[1], children[2], children[0]])
      expect(children.every((child) => child.parent === root)).toBe(true)
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
      expect((root as any)._pendingNativeMoves).toHaveLength(1)
    } finally {
      request.mockRestore()
    }

    root.add(new StyledText([{ __isChunk: true, text: "D" }]))
    const generated = root.getTextChildren()[3]!
    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations").mockImplementationOnce(() => {
      throw new Error("injected mixed native failure")
    })
    try {
      expect(() => root.plainText).toThrow("mixed native failure")
      expect(root.getTextChildren()).toEqual([children[1], children[2], children[0], generated])
      expect(children.every((child) => child.parent === root)).toBe(true)
      expect(generated.parent).toBe(root)
      expect((root as any)._pendingNativeMoves).toHaveLength(1)
      expect(root.plainText).toBe("BCAD")
      expect((root as any)._pendingNativeMoves).toHaveLength(0)
      expect(children.map((child) => (child as any)._nativeRangeId)).toEqual(ids)
    } finally {
      apply.mockRestore()
    }
  })

  test("stages repeated reorder work without child-array reconciliation per move", async () => {
    const root = new TextRenderable(renderer, {})
    const children = Array.from({ length: 200 }, (_, index) => new TextRenderable(renderer, { content: `${index} ` }))
    root.children = children
    renderer.root.add(root)
    await renderOnce()
    const rangeQueries = spyOn(TextBuffer.prototype, "getDocumentRange")
    const apply = spyOn(TextBuffer.prototype, "applyDocumentOperations")
    const requests = spyOn(root, "requestRender")
    try {
      for (let index = 0; index < 100; index++) root.add(children[index]!, root.getChildrenCount())

      expect((root as any)._structuralMoveMetrics).toEqual({
        orderNodes: 200,
        orderMoves: 100,
        materializedChildren: 0,
      })
      expect((root as any)._pendingNativeMoves).toHaveLength(100)
      expect(rangeQueries).toHaveBeenCalledTimes(200)
      expect(requests).toHaveBeenCalledTimes(100)
      expect(apply).not.toHaveBeenCalled()
      await renderOnce()
      expect((root as any)._structuralMoveMetrics.materializedChildren).toBe(200)
      expect(apply).toHaveBeenCalledTimes(1)
      expect(apply.mock.calls[0]![0].filter((operation) => operation.kind === "move")).toHaveLength(100)
    } finally {
      rangeQueries.mockRestore()
      apply.mockRestore()
      requests.mockRestore()
    }
  })

  test("keeps 4k mixed move materialization counters linear", async () => {
    const root = new TextRenderable(renderer, {})
    const children = Array.from(
      { length: 4_000 },
      (_, index) => new TextRenderable(renderer, { content: String.fromCharCode(65 + (index % 26)) }, false),
    )
    root.children = children
    renderer.root.add(root)
    await renderOnce()

    for (let index = 0; index < 1_000; index++) root.add(children[index]!, root.getChildrenCount())
    expect((root as any)._structuralMoveMetrics).toEqual({
      orderNodes: 4_000,
      orderMoves: 1_000,
      materializedChildren: 0,
    })
    expect((root as any)._pendingNativeMoves).toHaveLength(1_000)

    root.add("!")
    expect((root as any)._structuralMoveMetrics.materializedChildren).toBe(4_000)
    expect((root as any)._pendingNativeMoves).toHaveLength(1_000)
    expect(root.getChildrenCount()).toBe(4_001)
    await renderOnce()
    expect(root.plainText.length).toBe(4_001)
  }, 15_000)

  test("keeps coalesced structural move scaling within a generous near-linear ratio", async () => {
    const measure = async (childCount: number, moveCount: number): Promise<number> => {
      const root = new TextRenderable(renderer, {})
      const children = Array.from(
        { length: childCount },
        (_, index) => new TextRenderable(renderer, { content: String.fromCharCode(65 + (index % 26)) }),
      )
      root.children = children
      renderer.root.add(root)
      await renderOnce()
      const start = performance.now()
      for (let index = 0; index < moveCount; index++) root.add(children[index]!, root.getChildrenCount())
      await renderOnce()
      return performance.now() - start
    }

    const small = await measure(500, 100)
    const large = await measure(2000, 400)
    expect(large).toBeLessThan(small * 12 + 10)
  })

  test("reorders empty and coextensive subtrees without moving text or changing IDs", async () => {
    const root = new TextRenderable(renderer, {})
    const first = new TextRenderable(renderer, { content: "" })
    const nested = new TextRenderable(renderer, {})
    const nestedPoint = new TextRenderable(renderer, { content: "" })
    nested.add(nestedPoint)
    const last = new TextRenderable(renderer, { content: "" })
    root.children = [first, nested, last]
    renderer.root.add(root)
    await renderOnce()

    const nodes = [root, first, nested, nestedPoint, last]
    const ids = nodes.map((node) => (node as any)._nativeRangeId)
    const contentEpoch = (root as any).textBuffer.contentEpoch
    for (let iteration = 0; iteration < 4; iteration++) {
      root.children = iteration % 2 === 0 ? [last, first, nested] : [nested, last, first]
      await renderOnce()
      expect(root.plainText).toBe("")
      expect(nodes.map((node) => (node as any)._nativeRangeId)).toEqual(ids)
    }
    expect((root as any).textBuffer.contentEpoch).toBe(contentEpoch)
    expect(root.getTextChildren()).toEqual([nested, last, first])
    expect(nested.getTextChildren()).toEqual([nestedPoint])
  })

  test("normalizes CRLF independently at structural child boundaries", async () => {
    const root = new TextRenderable(renderer, {})
    const carriageReturn = new TextRenderable(renderer, { content: "\r" })
    const lineFeed = new TextRenderable(renderer, { content: "\nC" })
    root.children = [carriageReturn, lineFeed]
    renderer.root.add(root)
    await renderOnce()

    expect(root.plainText).toBe("\n\nC")
    expect(carriageReturn.plainText).toBe("\n")
    expect(lineFeed.plainText).toBe("\nC")

    lineFeed.content = "\nD"
    await renderOnce()
    expect(root.plainText).toBe("\n\nD")
    expect(carriageReturn.plainText).toBe("\n")
    expect(lineFeed.plainText).toBe("\nD")
  })

  test("preserves CRLF, wide characters, tabs, and nested visibility", async () => {
    const root = new TextRenderable(renderer, { wrapMode: "none" })
    const child = new TextRenderable(renderer, { content: "A\r\n界\tB" })
    root.add(child)
    renderer.root.add(root)
    await renderOnce()

    expect(root.plainText).toBe("A\n界\tB")
    expect(root.lineCount).toBe(2)
    expect(root.width).toBeGreaterThanOrEqual(4)

    child.visible = false
    await renderOnce()
    expect(root.plainText).toBe("")

    child.visible = true
    await renderOnce()
    expect(root.plainText).toBe("A\n界\tB")
  })

  test("rejects self and ancestor cycles before mutating either tree", () => {
    const root = new TextRenderable(renderer, { content: "root" })
    const child = new TextRenderable(renderer, { content: "child" })
    const grandchild = new TextRenderable(renderer, { content: "grandchild" })
    root.add(child)
    child.add(grandchild)

    expect(() => grandchild.add(root)).toThrow("ancestors")
    expect(root.parent).toBeNull()
    expect(root.getTextChildren()).toEqual([child])
    expect(child.parent).toBe(root)
    expect(child.getTextChildren()).toEqual([grandchild])
    expect(grandchild.parent).toBe(child)
    expect(() => root.add(root)).toThrow("itself")
  })

  test("destroys deeply nested text without recursive stack growth", () => {
    const root = new TextRenderable({}, false)
    let current = root
    for (let index = 0; index < 12_000; index++) {
      const child = new TextRenderable({}, false)
      ;(current as any)._children.push(child)
      child.parent = current
      current = child
    }

    root.destroyRecursively()
    expect(root.isDestroyed).toBe(true)
    expect(current.isDestroyed).toBe(true)
  }, 15_000)

  test("keeps manual StyledText leaves private and releases them on replacement and destroy", () => {
    const text = new TextRenderable(renderer, {
      content: new StyledText([
        { __isChunk: true, text: "one" },
        { __isChunk: true, text: "two", attributes: TextAttributes.BOLD },
      ]),
    })
    const leaves = (text as any)._leaves

    expect(text.getTextChildren()).toEqual([])
    text.content = "replacement"
    expect((text as any)._leaves).toEqual([null])

    text.content = new StyledText([{ __isChunk: true, text: "three" }])
    expect((text as any)._leaves).not.toBe(leaves)
    text.destroy()
    expect((text as any)._leaves).toEqual([])
  })

  test("preserves StyledText identity and refreshes when the same object is assigned again", () => {
    const styled = new StyledText([{ __isChunk: true, text: "before" }])
    const text = new TextRenderable(renderer, { content: styled })
    expect(text.content).toBe(styled)

    styled.chunks[0]!.text = "after"
    text.content = styled
    expect(text.content).toBe(styled)
    expect(text.plainText).toBe("after")
  })

  test("emits line-info-change once per committed nested update", async () => {
    const root = new TextRenderable(renderer, {})
    const child = new TextRenderable(renderer, { content: "before" })
    root.add(child)
    renderer.root.add(root)
    await renderOnce()

    const listener = mock(() => {})
    root.on("line-info-change", listener)
    child.content = "after\nline"
    child.attributes = TextAttributes.BOLD
    expect(listener).not.toHaveBeenCalled()

    await renderOnce()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(root.plainText).toBe("after\nline")
    expect(root.lineInfo.lineStartCols).toHaveLength(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test("children snapshots cannot bypass structural mutation", () => {
    const root = new TextRenderable(renderer, { content: "root" })
    const child = new TextRenderable(renderer, { content: "child" })
    expect((child as any).hasTextDocumentState).toBe(true)

    const snapshot = root.children as (string | TextRenderable)[]
    snapshot.push(child)
    delete snapshot[0]
    Object.defineProperty(snapshot, 0, { value: child })
    expect(root.children).toEqual(["root"])
    expect(child.parent).toBeNull()
    expect((child as any).hasTextDocumentState).toBe(true)

    root.children = [...root.children, child]
    expect(child.parent).toBe(root)
    expect((child as any).hasTextDocumentState).toBe(false)
    expect(root.plainText).toBe("rootchild")

    root.remove(child)
    expect(child.parent).toBeNull()
    expect((child as any).hasTextDocumentState).toBe(true)
    child.destroy()
  })

  test("rejects sparse setter input without changing the tree", () => {
    const root = new TextRenderable(renderer, { content: "stable" })
    const sparse = new Array<string | TextRenderable>(2)
    sparse[1] = "tail"
    expect(() => {
      root.children = sparse
    }).toThrow("strings or TextRenderable")
    expect(root.children).toEqual(["stable"])
  })

  test("uses native normalization and terminal display width for public text getters", () => {
    const root = new TextRenderable(renderer, { content: "é\r\n界\t😀", wrapMode: "none" })
    expect(root.plainText).toBe("é\n界\t😀")
    expect(root.textLength).toBe(7)

    const child = new TextRenderable(renderer, { content: "界\t" })
    root.add(child)
    expect(child.plainText).toBe("界\t")
    expect(child.textLength).toBe(4)
    expect(child.lineInfo).toEqual(root.lineInfo)
  })

  test("keeps hidden outer content while excluding hidden nested content from flow", () => {
    const root = new TextRenderable(renderer, { content: "outer" })
    root.visible = false
    expect(root.plainText).toBe("outer")
    expect(root.content.chunks.map((chunk) => chunk.text).join("")).toBe("outer")

    root.visible = true
    const child = new TextRenderable(renderer, { content: "nested" })
    root.add(child)
    child.visible = false
    expect(root.plainText).toBe("outer")
    expect(child.plainText).toBe("nested")
  })

  test("releases a first-line claim when promotion fails without attaching to layout", () => {
    const claim = mock(() => 3)
    const release = mock(() => {})
    renderer.claimFirstLineOffset = claim
    renderer.releaseFirstLineOffset = release
    const text = new TextRenderable(renderer, { content: "candidate" }, false)
    text.allowLayoutTextDocumentPromotion()

    const create = spyOn(TextBuffer, "create").mockImplementationOnce(() => {
      throw new Error("injected allocation failure")
    })
    try {
      expect(() => renderer.root.add(text)).toThrow("injected allocation failure")
      expect(text.parent).toBeNull()
      expect(renderer.root.getChildren()).not.toContain(text)
      expect(claim).not.toHaveBeenCalled()
      expect(release).not.toHaveBeenCalled()
    } finally {
      create.mockRestore()
      delete (renderer as Partial<typeof renderer>).claimFirstLineOffset
      delete (renderer as Partial<typeof renderer>).releaseFirstLineOffset
      text.destroy()
    }
  })

  test("does not claim first-line ownership until layout attachment", () => {
    const claim = mock(() => 2)
    renderer.claimFirstLineOffset = claim
    const text = new TextRenderable(renderer, { content: "detached owner" })
    try {
      expect((text as any).hasTextDocumentState).toBe(true)
      expect(claim).not.toHaveBeenCalled()
      renderer.root.add(text)
      expect(claim).toHaveBeenCalledTimes(1)
    } finally {
      text.destroy()
      delete (renderer as Partial<typeof renderer>).claimFirstLineOffset
    }
  })

  test("publishes promotion events only after parent insertion commits", () => {
    const text = new TextRenderable(renderer, { content: "candidate" }, false)
    text.allowLayoutTextDocumentPromotion()
    const listener = mock(() => {
      expect(text.parent).toBe(renderer.root)
      expect(renderer.root.getChildren()).toContain(text)
    })
    text.on("line-info-change", listener)

    renderer.root.add(text)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test("unwinds native promotion resources and releases a claim after late failure", () => {
    const claim = mock(() => 3)
    const release = mock(() => {})
    renderer.claimFirstLineOffset = claim
    renderer.releaseFirstLineOffset = release
    const text = new TextRenderable(renderer, { content: "candidate" }, false)
    text.allowLayoutTextDocumentPromotion()

    const originalSetOffset = TextBufferView.prototype.setFirstLineOffset
    const setOffset = spyOn(TextBufferView.prototype, "setFirstLineOffset").mockImplementation(function (offset) {
      if (offset === 3) throw new Error("injected offset failure")
      return originalSetOffset.call(this, offset)
    })
    const destroyBuffer = spyOn(TextBuffer.prototype, "destroy")
    const destroyView = spyOn(TextBufferView.prototype, "destroy")
    try {
      expect(() => renderer.root.add(text)).toThrow("injected offset failure")
      expect(text.parent).toBeNull()
      expect((text as any).hasTextDocumentState).toBe(false)
      expect(claim).toHaveBeenCalledTimes(1)
      expect(release).toHaveBeenCalledTimes(1)
      expect(destroyView).toHaveBeenCalledTimes(1)
      expect(destroyBuffer).toHaveBeenCalledTimes(1)
    } finally {
      setOffset.mockRestore()
      destroyBuffer.mockRestore()
      destroyView.mockRestore()
      delete (renderer as Partial<typeof renderer>).claimFirstLineOffset
      delete (renderer as Partial<typeof renderer>).releaseFirstLineOffset
      text.destroy()
    }
  })

  test("stores StyledText as canonical private styled leaves", () => {
    const text = new TextRenderable(renderer, {
      content: new StyledText([
        { __isChunk: true, text: "red", fg: RGBA.fromHex("#ff0000") },
        { __isChunk: true, text: " bold", attributes: TextAttributes.BOLD },
      ]),
    })
    renderer.root.add(text)

    expect(text.children).toEqual([])
    expect(text.getTextChildren()).toEqual([])
    expect(text.chunks.map((chunk) => chunk.text)).toEqual(["red", " bold"])
  })

  test("does not allocate TextRenderables or Yoga nodes per manual StyledText chunk", () => {
    const chunks = Array.from({ length: 1_000 }, (_, index) => ({
      __isChunk: true as const,
      text: `${index}`,
      attributes: index === 1 ? TextAttributes.BOLD : 0,
    }))
    const before = TextRenderable.getDebugMetrics()
    const text = new TextRenderable(renderer, { content: new StyledText(chunks) })
    const afterCreate = TextRenderable.getDebugMetrics()
    const leaves = (text as any)._leaves

    expect(afterCreate.textRenderableAllocations - before.textRenderableAllocations).toBe(1)
    expect(afterCreate.yogaNodeAllocations - before.yogaNodeAllocations).toBe(1)
    expect(text.children).toEqual([])

    text.content = new StyledText(chunks.map((chunk) => ({ ...chunk, text: `next-${chunk.text}` })))
    const afterReplace = TextRenderable.getDebugMetrics()
    expect((text as any)._leaves[0]).toBe(leaves[0])
    expect(afterReplace.styledLeafAllocations).toBe(afterCreate.styledLeafAllocations)
    text.destroy()
  })

  test("preserves authoritative registered style IDs through canonical text ranges", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: "#ffffff" },
      keyword: { fg: "#ff0000", bold: true },
    })
    try {
      const keywordId = syntaxStyle.getStyleId("keyword")!
      const chunks = treeSitterToTextChunks("key plain", [[0, 3, "keyword", {}]], syntaxStyle)
      const text = new TextRenderable(renderer, { content: new StyledText(chunks) })
      renderer.root.add(text)
      await renderOnce()

      const highlights = (text as any).textBuffer.getLineHighlights(0)
      expect(highlights.some((highlight) => highlight.styleId === keywordId && highlight.start === 0)).toBe(true)
      expect(text.chunks[0]!.styleId).toBe(keywordId)
    } finally {
      syntaxStyle.destroy()
    }
  })

  test("composes registered descendants with inherited values without losing precedence", async () => {
    const syntaxStyle = SyntaxStyle.fromStyles({
      keyword: { fg: "#ff0000", bold: true },
      container: { bg: "#0000ff" },
    })
    try {
      const keywordId = syntaxStyle.getStyleId("keyword")!
      const containerId = syntaxStyle.getStyleId("container")!
      const root = new TextRenderable(renderer, { fg: "#00ff00" })
      const child = new TextRenderable(renderer, {
        content: "key",
        styleId: keywordId,
        styleSource: syntaxStyle,
      })
      root.add(child)
      renderer.root.add(root)
      const effectiveChildChunk = () =>
        child.toChunks(root.mergeStyles({ fg: undefined, bg: undefined, attributes: 0 }))[0]!
      await renderOnce()

      expect(effectiveChildChunk().styleId).toBe(keywordId)
      expect(
        (root as any).textBuffer.getLineHighlights(0).some((highlight: any) => highlight.styleId === keywordId),
      ).toBe(true)

      root.bg = "#0000ff"
      await renderOnce()
      expect(effectiveChildChunk().styleId).toBeUndefined()
      expect(effectiveChildChunk().fg?.equals(RGBA.fromHex("#ff0000"))).toBe(true)
      expect(effectiveChildChunk().bg?.equals(RGBA.fromHex("#0000ff"))).toBe(true)
      expect(effectiveChildChunk().attributes).toBe(TextAttributes.BOLD)
      expect(
        (root as any).textBuffer.getLineHighlights(0).some((highlight: any) => highlight.styleId === keywordId),
      ).toBe(false)

      root.bg = undefined
      root.attributes = TextAttributes.BOLD
      await renderOnce()
      expect(effectiveChildChunk().styleId).toBe(keywordId)

      root.attributes = TextAttributes.UNDERLINE
      root.link = { url: "https://ancestor.test" }
      await renderOnce()
      expect(effectiveChildChunk().styleId).toBeUndefined()
      expect(effectiveChildChunk().attributes).toBe(TextAttributes.BOLD | TextAttributes.UNDERLINE)
      expect(effectiveChildChunk().link).toEqual({ url: "https://ancestor.test" })

      const registeredParent = new TextRenderable({ styleId: containerId, styleSource: syntaxStyle })
      const registeredChild = new TextRenderable({
        content: "nested",
        styleId: keywordId,
        styleSource: syntaxStyle,
      })
      registeredParent.add(registeredChild)
      const nested = registeredParent.chunks[0]!
      expect(nested.styleId).toBeUndefined()
      expect(nested.fg?.equals(RGBA.fromHex("#ff0000"))).toBe(true)
      expect(nested.bg?.equals(RGBA.fromHex("#0000ff"))).toBe(true)
      registeredParent.destroy()
    } finally {
      syntaxStyle.destroy()
    }
  })

  test("moves a nested node between outer documents without retaining transient state", async () => {
    const left = new TextRenderable(renderer, { content: "L" })
    const right = new TextRenderable(renderer, { content: "R" })
    const child = new TextRenderable(renderer, { id: "duplicate", content: "X" })
    const sibling = new TextRenderable(renderer, { id: "duplicate", content: "Y" })

    left.add(child)
    left.add(sibling)
    renderer.root.add(left)
    renderer.root.add(right)
    await renderOnce()

    const oldId = (child as any)._nativeRangeId
    const transfer = spyOn(TextBuffer.prototype, "applyTwoDocumentOperations")
    try {
      right.add(child)
      await renderOnce()

      expect(transfer).toHaveBeenCalledTimes(1)
      expect(left.plainText).toBe("LY")
      expect(right.plainText).toBe("RX")
      expect(left.getTextChildren()).toEqual([sibling])
      expect(child.parent).toBe(right)
      expect((child as any).hasTextDocumentState).toBe(false)
      expect((child as any)._nativeRangeId).not.toBe(oldId)
    } finally {
      transfer.mockRestore()
    }
  })

  test("leaves both native documents and pending tree state unchanged when transfer preparation fails", async () => {
    const left = new TextRenderable(renderer, { content: "L" })
    const right = new TextRenderable(renderer, { content: "R" })
    const child = new TextRenderable(renderer, { content: "X" })
    const sibling = new TextRenderable(renderer, { content: "Y" })
    left.add(child)
    left.add(sibling)
    renderer.root.add(left)
    renderer.root.add(right)
    await renderOnce()
    const oldId = (child as any)._nativeRangeId
    const leftEpoch = (left as any).textBuffer.contentEpoch
    const rightEpoch = (right as any).textBuffer.contentEpoch

    const transfer = spyOn(TextBuffer.prototype, "applyTwoDocumentOperations").mockImplementationOnce(() => {
      throw new Error("injected destination preparation failure")
    })
    try {
      expect(() => right.add(child)).toThrow("destination preparation failure")
      expect(left.plainText).toBe("LXY")
      expect(right.plainText).toBe("R")
      expect(left.getTextChildren()).toEqual([child, sibling])
      expect(right.getTextChildren()).toEqual([])
      expect(child.parent).toBe(left)
      expect((child as any)._nativeRangeId).toBe(oldId)
      expect((left as any).textBuffer.contentEpoch).toBe(leftEpoch)
      expect((right as any).textBuffer.contentEpoch).toBe(rightEpoch)

      child.content = "Z"
      await renderOnce()
      expect(left.plainText).toBe("LZY")
      expect(right.plainText).toBe("R")
    } finally {
      transfer.mockRestore()
    }
  })

  test("rolls back a multi-child setter when a later adoption fails", () => {
    const source = new TextRenderable(renderer, { content: "source" })
    const first = new TextRenderable(renderer, { content: "first" })
    const second = new TextRenderable(renderer, { content: "second" })
    const target = new TextRenderable(renderer, {
      content: new StyledText([{ __isChunk: true, text: "old" }]),
    })
    const oldContent = target.content
    source.add(first)
    source.add(second)

    const detach = spyOn(second as any, "detachTextDocumentState").mockImplementationOnce(() => {
      throw new Error("injected adoption failure")
    })
    try {
      expect(() => {
        target.children = [first, second]
      }).toThrow("injected adoption failure")
      expect(target.getTextChildren()).toEqual([])
      expect(target.content).toBe(oldContent)
      expect(source.getTextChildren()).toEqual([first, second])
      expect(first.parent).toBe(source)
      expect(second.parent).toBe(source)
    } finally {
      detach.mockRestore()
      source.destroyRecursively()
      target.destroyRecursively()
    }
  })

  test("rejects invalid private styled leaves without changing content or allocating renderables", () => {
    const text = new TextRenderable(renderer, { content: "old" })
    const before = TextRenderable.getDebugMetrics()
    try {
      expect(() => {
        text.content = new StyledText([{ __isChunk: true, text: "new-a", styleId: 999, styleSource: undefined }])
      }).toThrow("Registered text styles require both styleId and styleSource")
      expect(text.plainText).toBe("old")
      const after = TextRenderable.getDebugMetrics()
      expect(after.textRenderableAllocations).toBe(before.textRenderableAllocations)
      expect(after.yogaNodeAllocations).toBe(before.yogaNodeAllocations)
      expect(after.styledLeafAllocations).toBe(before.styledLeafAllocations)
    } finally {
      text.destroy()
    }
  })

  test("rolls back content when restoring a later displaced owner fails", () => {
    const text = new TextRenderable(renderer, {})
    const first = new TextRenderable(renderer, { content: "first" })
    const second = new TextRenderable(renderer, { content: "second" })
    text.add(first)
    text.add(second)
    const attach = spyOn(second as any, "attachTextDocumentState").mockImplementationOnce(() => {
      throw new Error("injected displaced owner failure")
    })
    try {
      expect(() => {
        text.content = "replacement"
      }).toThrow("injected displaced owner failure")
      expect(text.getTextChildren()).toEqual([first, second])
      expect(first.parent).toBe(text)
      expect(second.parent).toBe(text)
      expect((first as any).hasTextDocumentState).toBe(false)
      expect((second as any).hasTextDocumentState).toBe(false)
      expect(text.plainText).toBe("firstsecond")
    } finally {
      attach.mockRestore()
      text.destroyRecursively()
    }
  })

  test("cleans all constructor resources when initial range creation fails", () => {
    const before = new Set(Renderable.renderablesByNumber.keys())
    const destroyBuffer = spyOn(TextBuffer.prototype, "destroy")
    const destroyView = spyOn(TextBufferView.prototype, "destroy")
    const applyDocumentOperations = spyOn(TextBuffer.prototype, "applyDocumentOperations").mockImplementationOnce(
      () => {
        throw new Error("injected range failure")
      },
    )
    try {
      expect(() => new TextRenderable(renderer, { content: "failure" })).toThrow("injected range failure")
      expect(destroyView).toHaveBeenCalled()
      expect(destroyBuffer).toHaveBeenCalled()
      expect(new Set(Renderable.renderablesByNumber.keys())).toEqual(before)
    } finally {
      applyDocumentOperations.mockRestore()
      destroyView.mockRestore()
      destroyBuffer.mockRestore()
    }
  })

  test("destroys a local native handle when either attach call throws", () => {
    const lib = resolveRenderLib()
    const destroyNative = spyOn(lib, "destroyNativeRenderable")
    const attachYoga = spyOn(lib, "nativeRenderableAttachYogaNode").mockImplementationOnce(() => {
      throw new Error("injected yoga attach failure")
    })
    try {
      expect(() => new TextRenderable(renderer, {})).toThrow("injected yoga attach failure")
      expect(destroyNative).toHaveBeenCalledTimes(1)
    } finally {
      attachYoga.mockRestore()
      destroyNative.mockRestore()
    }

    const destroyNativeTarget = spyOn(lib, "destroyNativeRenderable")
    const attachTarget = spyOn(lib, "nativeRenderableSetMeasureTarget").mockImplementationOnce(() => {
      throw new Error("injected measure attach failure")
    })
    try {
      expect(() => new TextRenderable(renderer, {})).toThrow("injected measure attach failure")
      expect(destroyNativeTarget).toHaveBeenCalledTimes(1)
    } finally {
      attachTarget.mockRestore()
      destroyNativeTarget.mockRestore()
    }
  })

  test("keeps detached aliases backend-free for local text getters", () => {
    const createBuffer = spyOn(TextBuffer, "create")
    const createNative = spyOn(resolveRenderLib(), "createNativeRenderable")
    const text = new TextRenderable({ content: "detached" })
    try {
      expect((text as any).hasTextDocumentState).toBe(false)
      expect(createBuffer).not.toHaveBeenCalled()
      expect(createNative).not.toHaveBeenCalled()
      expect(text.plainText).toBe("detached")
      expect(createBuffer).not.toHaveBeenCalled()
      expect(createNative).not.toHaveBeenCalled()
      expect(() => text.focus()).not.toThrow()
    } finally {
      text.destroy()
      createNative.mockRestore()
      createBuffer.mockRestore()
    }
  })

  test("does not allocate temporary native text state for detached getters", () => {
    const text = new TextRenderable({ content: "detached" })
    const createBuffer = spyOn(TextBuffer, "create")
    const createView = spyOn(TextBufferView, "create")
    try {
      expect(text.plainText).toBe("detached")
      expect(text.textLength).toBe(8)
      expect(createBuffer).not.toHaveBeenCalled()
      expect(createView).not.toHaveBeenCalled()
    } finally {
      createView.mockRestore()
      createBuffer.mockRestore()
      text.destroy()
    }
  })

  test("lets a mounted candidate reclaim the first-line offset after release", () => {
    let owner: TextRenderable | null = null
    renderer.claimFirstLineOffset = mock((candidate?: TextRenderable) => {
      if (owner === candidate) return 4
      if (owner) return 0
      owner = candidate ?? null
      return 4
    })
    renderer.releaseFirstLineOffset = mock((candidate: TextRenderable) => {
      if (owner === candidate) owner = null
    })
    const first = new TextRenderable(renderer, { content: "first" })
    const second = new TextRenderable(renderer, { content: "second" })
    try {
      renderer.root.add(first)
      renderer.root.add(second)
      expect((first as any)._firstLineOffset).toBe(4)
      expect((second as any)._firstLineOffset).toBe(0)

      renderer.root.remove(first)
      second.onLifecyclePass?.()
      expect((second as any)._firstLineOffset).toBe(4)
    } finally {
      first.destroy()
      second.destroy()
      delete (renderer as Partial<typeof renderer>).claimFirstLineOffset
      delete (renderer as Partial<typeof renderer>).releaseFirstLineOffset
    }
  })

  test("continues post-order text destruction after node cleanup errors", () => {
    const root = new TextRenderable({}, false)
    const first = new TextRenderable({}, false)
    const second = new TextRenderable({}, false)
    root.add(first)
    root.add(second)
    const calls: string[] = []
    const firstDestroy = first.destroy.bind(first)
    const secondDestroy = second.destroy.bind(second)
    first.destroy = () => {
      calls.push("first")
      firstDestroy()
      throw new Error("first cleanup failure")
    }
    second.destroy = () => {
      calls.push("second")
      secondDestroy()
      throw new Error("second cleanup failure")
    }

    expect(() => root.destroyRecursively()).toThrow(AggregateError)
    expect(calls).toEqual(["first", "second"])
    expect(root.isDestroyed).toBe(true)
    expect(first.isDestroyed).toBe(true)
    expect(second.isDestroyed).toBe(true)
  })
})
