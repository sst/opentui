import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "./test-renderer"
import { TextRenderable } from "../renderables/Text"
import { BoxRenderable } from "../renderables/Box"
import { VTermStyleFlags, TextAttributes, type VTermData } from "../types"
import { RGBA } from "../lib"

describe("captureSpans", () => {
  let renderer: TestRenderer
  let renderOnce: () => Promise<void>
  let captureSpans: () => VTermData

  beforeEach(async () => {
    const setup = await createTestRenderer({ width: 40, height: 10 })
    renderer = setup.renderer
    renderOnce = setup.renderOnce
    captureSpans = setup.captureSpans
  })

  afterEach(() => {
    renderer.destroy()
  })

  test("returns correct dimensions and line count", async () => {
    await renderOnce()
    const data = captureSpans()

    expect(data.cols).toBe(40)
    expect(data.rows).toBe(10)
    expect(data.lines.length).toBe(10)
  })

  test("captures text content in spans", async () => {
    const text = new TextRenderable(renderer, { content: "Hello World" })
    renderer.root.add(text)
    await renderOnce()

    const data = captureSpans()
    const firstLine = data.lines[0]
    const textContent = firstLine.spans.map((s) => s.text).join("")

    expect(textContent).toContain("Hello World")
  })

  test("groups consecutive cells with same styling into single span", async () => {
    const text = new TextRenderable(renderer, { content: "AAAA" })
    renderer.root.add(text)
    await renderOnce()

    const data = captureSpans()
    const firstLine = data.lines[0]
    const aaaSpan = firstLine.spans.find((s) => s.text.includes("AAAA"))

    expect(aaaSpan).toBeDefined()
    expect(aaaSpan!.width).toBeGreaterThanOrEqual(4)
  })

  test("captures foreground color", async () => {
    const text = new TextRenderable(renderer, {
      content: "Red Text",
      fg: RGBA.fromHex("#ff0000"),
    })
    renderer.root.add(text)
    await renderOnce()

    const data = captureSpans()
    const firstLine = data.lines[0]
    const redSpan = firstLine.spans.find((s) => s.text.includes("Red"))

    expect(redSpan).toBeDefined()
    expect(redSpan!.fg).toBe("#ff0000")
  })

  test("captures background color", async () => {
    const box = new BoxRenderable(renderer, {
      width: 10,
      height: 3,
      backgroundColor: RGBA.fromHex("#00ff00"),
    })
    renderer.root.add(box)
    await renderOnce()

    const data = captureSpans()
    const secondLine = data.lines[1]
    const greenSpan = secondLine.spans.find((s) => s.bg === "#00ff00")

    expect(greenSpan).toBeDefined()
  })

  test("returns null for transparent colors", async () => {
    await renderOnce()

    const data = captureSpans()
    const firstLine = data.lines[0]
    const transparentSpan = firstLine.spans.find((s) => s.bg === null)

    expect(transparentSpan).toBeDefined()
  })

  test("captures text attributes", async () => {
    const text = new TextRenderable(renderer, {
      content: "Styled",
      attributes: TextAttributes.BOLD | TextAttributes.ITALIC | TextAttributes.UNDERLINE | TextAttributes.DIM,
    })
    renderer.root.add(text)
    await renderOnce()

    const data = captureSpans()
    const firstLine = data.lines[0]
    const styledSpan = firstLine.spans.find((s) => s.text.includes("Styled"))

    expect(styledSpan).toBeDefined()
    expect(styledSpan!.flags & VTermStyleFlags.BOLD).toBeTruthy()
    expect(styledSpan!.flags & VTermStyleFlags.ITALIC).toBeTruthy()
    expect(styledSpan!.flags & VTermStyleFlags.UNDERLINE).toBeTruthy()
    expect(styledSpan!.flags & VTermStyleFlags.FAINT).toBeTruthy()
  })

  test("includes cursor position", async () => {
    await renderOnce()
    const data = captureSpans()

    expect(data.cursor).toEqual([expect.any(Number), expect.any(Number)])
  })

  test("splits spans when styling changes", async () => {
    const text1 = new TextRenderable(renderer, {
      content: "AAA",
      fg: RGBA.fromHex("#ff0000"),
    })
    const text2 = new TextRenderable(renderer, {
      content: "BBB",
      fg: RGBA.fromHex("#00ff00"),
    })
    renderer.root.add(text1)
    renderer.root.add(text2)
    await renderOnce()

    const data = captureSpans()
    const allSpans = data.lines.flatMap((l) => l.spans)

    expect(allSpans.some((s) => s.fg === "#ff0000")).toBe(true)
    expect(allSpans.some((s) => s.fg === "#00ff00")).toBe(true)
  })
})
