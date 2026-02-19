import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { RGBA } from "../lib/RGBA"
import { bold, green, red } from "../lib/styled-text"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import type { CapturedFrame } from "../types"
import { SimpleTableRenderable, type SimpleTableContent } from "./SimpleTable"

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let captureSpans: () => CapturedFrame

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
})
