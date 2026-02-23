import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { run, destroy } from "./simple-table-demo"
import { createTestRenderer, type MockInput, type MockMouse, type TestRenderer } from "../testing/test-renderer"
import { SimpleTableRenderable } from "../renderables/SimpleTable"

let renderer: TestRenderer
let mockInput: MockInput
let mockMouse: MockMouse
let renderOnce: () => Promise<void>
let captureFrame: () => string

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 20, height: 40 })
  renderer = testRenderer.renderer
  mockInput = testRenderer.mockInput
  mockMouse = testRenderer.mockMouse
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
})

afterEach(() => {
  destroy(renderer)
  renderer.destroy()
})

describe("simple-table-demo narrow layout", () => {
  test("renders tables without right scrollbar overlap", async () => {
    run(renderer)
    await renderOnce()

    const frame = captureFrame()
    expect(frame).toMatchSnapshot("narrow no selection")
    expect(frame).toContain("┌───┬────┬───────┐")
    expect(frame).toContain("│api│OK  │latency│")
    expect(frame).toContain("└────────────────┘")
    expect(frame).not.toContain("█")
  })

  test("selection status updates without collapsing table area", async () => {
    run(renderer)
    await renderOnce()

    const primaryTable = renderer.root.findDescendantById("simple-table-demo-primary")
    expect(primaryTable).toBeDefined()

    await mockMouse.drag(primaryTable!.x + 1, primaryTable!.y + 1, primaryTable!.x + 7, primaryTable!.y + 7)
    await renderOnce()

    const frame = captureFrame()
    expect(frame).toMatchSnapshot("narrow with selection")
    expect(frame).toContain("Selected")
    expect(frame).toContain("┌───┬────┬───────┐")
    expect(frame).toContain("└────────────────┘")
    expect(frame).not.toContain("█")
  })

  test("toggles column width mode with keyboard", async () => {
    run(renderer)
    await renderOnce()

    mockInput.pressKey("m")
    await renderOnce()

    const primaryTable = renderer.root.findDescendantById("simple-table-demo-primary")
    expect(primaryTable).toBeInstanceOf(SimpleTableRenderable)
    expect((primaryTable as SimpleTableRenderable).columnWidthMode).toBe("fill")

    const frame = captureFrame()
    expect(frame).toMatchSnapshot("narrow width fill mode")
    expect(frame).toContain("width fill")
  })
})
