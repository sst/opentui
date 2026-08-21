import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { RGBA } from "../lib/RGBA.js"
import { StyledText } from "../lib/styled-text.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { TextBuffer } from "../text-buffer.js"
import { TextBufferView } from "../text-buffer-view.js"
import { TextAttributes, type CapturedFrame, type CapturedSpan } from "../types.js"
import { TextRenderable } from "./Text.js"

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

  test("commits one canonical snapshot for batched nested text and style changes", async () => {
    const setStyledText = spyOn(TextBuffer.prototype, "setStyledText")
    try {
      const root = new TextRenderable(renderer, {})
      const child = new TextRenderable(renderer, { content: "before" })
      root.add(child)
      renderer.root.add(root)
      await renderOnce()

      const callsBeforeUpdate = setStyledText.mock.calls.length
      child.content = "after"
      child.fg = "#00ff00"
      child.attributes = TextAttributes.BOLD

      expect(setStyledText.mock.calls.length).toBe(callsBeforeUpdate)
      await renderOnce()
      expect(setStyledText.mock.calls.length).toBe(callsBeforeUpdate + 1)
      expect(root.plainText).toBe("after")
    } finally {
      setStyledText.mockRestore()
    }
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
  })

  test("cleans up parent-owned StyledText children on replacement and destroy", () => {
    const text = new TextRenderable(renderer, {
      content: new StyledText([
        { __isChunk: true, text: "one" },
        { __isChunk: true, text: "two", attributes: TextAttributes.BOLD },
      ]),
    })
    const generated = text.getTextChildren()

    text.content = "replacement"
    expect(generated.every((child) => child.isDestroyed)).toBe(true)

    text.content = new StyledText([{ __isChunk: true, text: "three" }])
    const finalGenerated = text.getTextChildren()[0]!
    text.destroy()
    expect(finalGenerated.isDestroyed).toBe(true)
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

  test("mutable children demote adopted backends without leaving duplicates", () => {
    const root = new TextRenderable(renderer, { content: "root" })
    const child = new TextRenderable(renderer, { content: "child" })
    expect((child as any).hasTextDocumentState).toBe(true)

    root.children.push(child)
    expect(child.parent).toBe(root)
    expect((child as any).hasTextDocumentState).toBe(false)
    expect(root.plainText).toBe("rootchild")

    root.children.splice(root.children.indexOf(child), 1)
    expect(child.parent).toBeNull()
    expect((child as any).hasTextDocumentState).toBe(true)
    child.destroy()
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

  test("unwinds native promotion resources and releases a claim after late failure", () => {
    const claim = mock(() => 3)
    const release = mock(() => {})
    renderer.claimFirstLineOffset = claim
    renderer.releaseFirstLineOffset = release
    const text = new TextRenderable(renderer, { content: "candidate" }, false)
    text.allowLayoutTextDocumentPromotion()

    const setOffset = spyOn(TextBufferView.prototype, "setFirstLineOffset").mockImplementationOnce(() => {
      throw new Error("injected offset failure")
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

  test("converts StyledText into canonical styled children", () => {
    const text = new TextRenderable(renderer, {
      content: new StyledText([
        { __isChunk: true, text: "red", fg: RGBA.fromHex("#ff0000") },
        { __isChunk: true, text: " bold", attributes: TextAttributes.BOLD },
      ]),
    })
    renderer.root.add(text)

    expect(text.children).toHaveLength(2)
    expect(text.children.every((child) => child instanceof TextRenderable)).toBe(true)
    expect(text.chunks.map((chunk) => chunk.text)).toEqual(["red", " bold"])
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

    right.add(child)
    await renderOnce()

    expect(left.plainText).toBe("LY")
    expect(right.plainText).toBe("RX")
    expect(left.getTextChildren()).toEqual([sibling])
    expect(child.parent).toBe(right)
    expect((child as any).hasTextDocumentState).toBe(false)
  })
})
