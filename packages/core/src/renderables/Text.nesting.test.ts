import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
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
})
