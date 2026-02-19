import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { RGBA } from "../lib/RGBA"
import { bold, green, red } from "../lib/styled-text"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import type { CapturedFrame } from "../types"
import { SimpleTableRenderable, type SimpleTableContent } from "./SimpleTable"

const VERTICAL_BORDER_CP = "│".codePointAt(0)!

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let captureSpans: () => CapturedFrame

function getCharAt(buffer: TestRenderer["currentRenderBuffer"], x: number, y: number): number {
  return buffer.buffers.char[y * buffer.width + x] ?? 0
}

function findVerticalBorderXs(buffer: TestRenderer["currentRenderBuffer"], y: number): number[] {
  const xs: number[] = []

  for (let x = 0; x < buffer.width; x++) {
    if (getCharAt(buffer, x, y) === VERTICAL_BORDER_CP) {
      xs.push(x)
    }
  }

  return xs
}

function countChar(text: string, target: string): number {
  return [...text].filter((char) => char === target).length
}

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 60, height: 16 })
  renderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
  captureSpans = testRenderer.captureSpans
})

afterEach(() => {
  renderer.destroy()
})

describe("SimpleTableRenderable", () => {
  test("renders a basic table with styled cell chunks", async () => {
    const content: SimpleTableContent = [
      [[bold("Name")], [bold("Status")], [bold("Notes")]],
      ["Alpha", [green("OK")], "All systems nominal"],
      ["Bravo", [red("WARN")], "Pending checks"],
    ]

    const table = new SimpleTableRenderable(renderer, {
      left: 1,
      top: 1,
      content,
    })

    renderer.root.add(table)
    await renderOnce()

    const frame = captureFrame()
    expect(frame).toMatchSnapshot("basic table")
    expect(frame).toContain("Alpha")
    expect(frame).toContain("WARN")

    const spans = captureSpans().lines.flatMap((line) => line.spans)
    const okSpan = spans.find((span) => span.text.includes("OK"))

    expect(okSpan).toBeDefined()
    expect(okSpan?.fg.equals(RGBA.fromHex("#008000"))).toBe(true)
  })

  test("wraps content and fits columns when width is constrained", async () => {
    const content: SimpleTableContent = [
      [[bold("ID")], [bold("Description")]],
      ["1", "This is a long sentence that should wrap across multiple visual lines"],
      ["2", "Short"],
    ]

    const table = new SimpleTableRenderable(renderer, {
      left: 0,
      top: 0,
      width: 34,
      wrapMode: "word",
      content,
    })

    renderer.root.add(table)
    await renderOnce()

    const frame = captureFrame()
    expect(frame).toMatchSnapshot("wrapped constrained width")
    expect(frame).toContain("Description")
  })

  test("rebuilds table when content setter is used", async () => {
    const table = new SimpleTableRenderable(renderer, {
      left: 0,
      top: 0,
      content: [["A", "B"]],
    })

    renderer.root.add(table)
    await renderOnce()

    const before = captureFrame()

    table.content = [
      [[bold("Col 1")], [bold("Col 2")]],
      ["row-1", "updated"],
      ["row-2", [green("active")]],
    ]

    await renderOnce()

    const after = captureFrame()
    expect(before).not.toBe(after)
    expect(after).toMatchSnapshot("content setter update")
  })

  test("renders a final bottom border", async () => {
    const table = new SimpleTableRenderable(renderer, {
      left: 0,
      top: 0,
      content: [
        [[bold("A")], [bold("B")]],
        ["1", "2"],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    const frame = captureFrame()
    const lines = frame
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)

    const lastLine = lines[lines.length - 1] ?? ""

    expect(lastLine).toContain("└")
    expect(lastLine).toContain("┴")
    expect(lastLine).toContain("┘")
  })

  test("keeps borders aligned with CJK and emoji content", async () => {
    const content: SimpleTableContent = [
      [[bold("Locale")], [bold("Sample")]],
      ["ja-JP", "東京で寿司 🍣"],
      ["zh-CN", "你好世界 🚀"],
      ["ko-KR", "한글 테스트 😄"],
    ]

    const table = new SimpleTableRenderable(renderer, {
      left: 0,
      top: 0,
      width: 36,
      wrapMode: "none",
      content,
    })

    renderer.root.add(table)
    await renderOnce()

    const frame = captureFrame()
    expect(frame).toMatchSnapshot("unicode border alignment")
    expect(frame).toContain("東京で寿司")
    expect(frame).toContain("🚀")
    expect(frame).toContain("😄")

    const lines = frame.split("\n")
    const headerY = lines.findIndex((line) => line.includes("Locale"))
    expect(headerY).toBeGreaterThanOrEqual(0)

    const buffer = renderer.currentRenderBuffer
    const borderXs = findVerticalBorderXs(buffer, headerY)
    expect(borderXs.length).toBe(3)

    const sampleRowYs = [
      lines.findIndex((line) => line.includes("ja-JP")),
      lines.findIndex((line) => line.includes("zh-CN")),
      lines.findIndex((line) => line.includes("ko-KR")),
    ]

    for (const y of sampleRowYs) {
      expect(y).toBeGreaterThanOrEqual(0)
      for (const x of borderXs) {
        expect(getCharAt(buffer, x, y)).toBe(VERTICAL_BORDER_CP)
      }
    }
  })

  test("wraps CJK and emoji without grapheme duplication", async () => {
    const content: SimpleTableContent = [
      [[bold("Item")], [bold("Details")]],
      ["mixed", "東京界 🌍 emoji wrapping continues across lines for width checks"],
      ["emoji", "Faces 😀😃😄 should remain stable"],
    ]

    const table = new SimpleTableRenderable(renderer, {
      left: 0,
      top: 0,
      width: 30,
      wrapMode: "word",
      content,
    })

    renderer.root.add(table)
    await renderOnce()

    const frame = captureFrame()
    expect(frame).toMatchSnapshot("unicode wrapping")
    expect(frame).not.toContain("�")
    expect(countChar(frame, "界")).toBe(1)
    expect(countChar(frame, "🌍")).toBe(1)

    const lines = frame.split("\n")
    const wrappedRowStartY = lines.findIndex((line) => line.includes("mix") && line.includes("東京界"))
    const wrappedRowEndBorderY = lines.findIndex((line, idx) => idx > wrappedRowStartY && line.includes("├"))

    expect(wrappedRowStartY).toBeGreaterThanOrEqual(0)
    expect(wrappedRowEndBorderY).toBeGreaterThan(wrappedRowStartY)

    const wrappedRowYs: number[] = []
    for (let y = wrappedRowStartY; y < wrappedRowEndBorderY; y++) {
      wrappedRowYs.push(y)
    }

    expect(wrappedRowYs.length).toBeGreaterThan(1)

    const headerY = lines.findIndex((line) => line.includes("Ite") && line.includes("Details"))
    expect(headerY).toBeGreaterThanOrEqual(0)

    const buffer = renderer.currentRenderBuffer
    const borderXs = findVerticalBorderXs(buffer, headerY)
    expect(borderXs.length).toBe(3)

    for (const y of wrappedRowYs) {
      for (const x of borderXs) {
        expect(getCharAt(buffer, x, y)).toBe(VERTICAL_BORDER_CP)
      }
    }
  })
})
