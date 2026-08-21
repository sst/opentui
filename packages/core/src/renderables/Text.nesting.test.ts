import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { RGBA } from "../lib/RGBA.js"
import { StyledText } from "../lib/styled-text.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { TextBuffer } from "../text-buffer.js"
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

    expect(root.plainText).toBe("A\r\n界\tB")
    expect(root.lineCount).toBe(2)
    expect(root.width).toBeGreaterThanOrEqual(4)

    child.visible = false
    await renderOnce()
    expect(root.plainText).toBe("")

    child.visible = true
    await renderOnce()
    expect(root.plainText).toBe("A\r\n界\tB")
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
