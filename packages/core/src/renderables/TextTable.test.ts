import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { OptimizedBuffer } from "../buffer"
import { RGBA } from "../lib/RGBA"
import { bold, green, red } from "../lib/styled-text"
import { createTestRenderer, type MockMouse, type TestRenderer } from "../testing/test-renderer"
import type { CapturedFrame } from "../types"
import { TextTableRenderable, type TextTableCellContent, type TextTableContent } from "./TextTable"

const VERTICAL_BORDER_CP = "│".codePointAt(0)!
const BORDER_CHAR_PATTERN = /[┌┐└┘├┤┬┴┼│─]/

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let captureSpans: () => CapturedFrame
let mockMouse: MockMouse

function getCharAt(buffer: TestRenderer["currentRenderBuffer"], x: number, y: number): number {
  return buffer.buffers.char[y * buffer.width + x] ?? 0
}

function getFgAt(buffer: TestRenderer["currentRenderBuffer"], x: number, y: number): RGBA {
  const index = (y * buffer.width + x) * 4
  return RGBA.fromValues(
    buffer.buffers.fg[index] ?? 0,
    buffer.buffers.fg[index + 1] ?? 0,
    buffer.buffers.fg[index + 2] ?? 0,
    buffer.buffers.fg[index + 3] ?? 0,
  )
}

function getBgAt(buffer: TestRenderer["currentRenderBuffer"], x: number, y: number): RGBA {
  const index = (y * buffer.width + x) * 4
  return RGBA.fromValues(
    buffer.buffers.bg[index] ?? 0,
    buffer.buffers.bg[index + 1] ?? 0,
    buffer.buffers.bg[index + 2] ?? 0,
    buffer.buffers.bg[index + 3] ?? 0,
  )
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

function cell(text: string): TextTableCellContent {
  return [
    {
      __isChunk: true,
      text,
    },
  ]
}

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 60, height: 16 })
  renderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
  captureSpans = testRenderer.captureSpans
  mockMouse = testRenderer.mockMouse
})

afterEach(() => {
  renderer.destroy()
})

describe("TextTableRenderable", () => {
  test("renders a basic table with styled cell chunks", async () => {
    const content: TextTableContent = [
      [[bold("Name")], [bold("Status")], [bold("Notes")]],
      [cell("Alpha"), [green("OK")], cell("All systems nominal")],
      [cell("Bravo"), [red("WARN")], cell("Pending checks")],
    ]

    const table = new TextTableRenderable(renderer, {
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
    const content: TextTableContent = [
      [[bold("ID")], [bold("Description")]],
      [cell("1"), cell("This is a long sentence that should wrap across multiple visual lines")],
      [cell("2"), cell("Short")],
    ]

    const table = new TextTableRenderable(renderer, {
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

  test("keeps intrinsic width by default when extra space is available", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      width: 34,
      wrapMode: "word",
      content: [
        [cell("A"), cell("B")],
        [cell("1"), cell("2")],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    const lines = captureFrame().split("\n")
    const headerY = lines.findIndex((line) => line.includes("A") && line.includes("B"))
    expect(headerY).toBeGreaterThanOrEqual(0)

    const buffer = renderer.currentRenderBuffer
    const borderXs = findVerticalBorderXs(buffer, headerY)

    expect(borderXs.length).toBe(3)
    expect(borderXs[0]).toBe(0)
    expect(borderXs[borderXs.length - 1]).toBeLessThan(33)
  })

  test("fills available width when columnWidthMode is fill", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      width: 34,
      wrapMode: "word",
      columnWidthMode: "fill",
      content: [
        [cell("A"), cell("B")],
        [cell("1"), cell("2")],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    const lines = captureFrame().split("\n")
    const headerY = lines.findIndex((line) => line.includes("A") && line.includes("B"))
    expect(headerY).toBeGreaterThanOrEqual(0)

    const buffer = renderer.currentRenderBuffer
    const borderXs = findVerticalBorderXs(buffer, headerY)

    expect(borderXs).toEqual([0, 17, 33])
  })

  test("fills available width in no-wrap mode when columnWidthMode is fill", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      width: 24,
      wrapMode: "none",
      columnWidthMode: "fill",
      content: [
        [cell("Key"), cell("Value")],
        [cell("A"), cell("B")],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    const lines = captureFrame().split("\n")
    const headerY = lines.findIndex((line) => line.includes("Key") && line.includes("Value"))
    expect(headerY).toBeGreaterThanOrEqual(0)

    const buffer = renderer.currentRenderBuffer
    const borderXs = findVerticalBorderXs(buffer, headerY)

    expect(borderXs).toEqual([0, 11, 23])
  })

  test("preserves bordered layout when border glyphs are hidden", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      border: true,
      outerBorder: true,
      showBorders: false,
      content: [[cell("A"), cell("B")]],
    })

    renderer.root.add(table)
    await renderOnce()

    const frame = captureFrame()
    expect(BORDER_CHAR_PATTERN.test(frame)).toBe(false)

    const row = frame.split("\n").find((line) => line.includes("A") && line.includes("B"))
    expect(row).toBeDefined()
    expect(row?.indexOf("A")).toBe(1)
    expect(row?.indexOf("B")).toBe(3)
  })

  test("applies cell padding when provided", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      cellPadding: 1,
      content: [
        [cell("A"), cell("B")],
        [cell("1"), cell("2")],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    const frame = captureFrame()
    expect(frame).toContain("│   │   │")
    expect(frame).toContain("│ A │ B │")

    const lines = frame.split("\n")
    const headerY = lines.findIndex((line) => line.includes(" A ") && line.includes(" B "))
    expect(headerY).toBeGreaterThanOrEqual(0)

    const borderXs = findVerticalBorderXs(renderer.currentRenderBuffer, headerY)
    expect(borderXs).toEqual([0, 4, 8])
  })

  test("reflows when columnWidthMode is changed after initial render", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      width: 34,
      wrapMode: "word",
      content: [
        [cell("A"), cell("B")],
        [cell("1"), cell("2")],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    let lines = captureFrame().split("\n")
    let headerY = lines.findIndex((line) => line.includes("A") && line.includes("B"))
    expect(headerY).toBeGreaterThanOrEqual(0)

    let borderXs = findVerticalBorderXs(renderer.currentRenderBuffer, headerY)
    expect(borderXs[borderXs.length - 1]).toBeLessThan(33)

    table.columnWidthMode = "fill"
    await renderOnce()

    lines = captureFrame().split("\n")
    headerY = lines.findIndex((line) => line.includes("A") && line.includes("B"))
    expect(headerY).toBeGreaterThanOrEqual(0)

    borderXs = findVerticalBorderXs(renderer.currentRenderBuffer, headerY)
    expect(borderXs).toEqual([0, 17, 33])
  })

  test("uses native border draw for inner-only mode", async () => {
    const originalDrawGrid = OptimizedBuffer.prototype.drawGrid
    let nativeCalls = 0

    OptimizedBuffer.prototype.drawGrid = function (...args: Parameters<OptimizedBuffer["drawGrid"]>) {
      nativeCalls += 1
      return originalDrawGrid.apply(this, args)
    }

    try {
      const table = new TextTableRenderable(renderer, {
        left: 0,
        top: 0,
        border: true,
        outerBorder: false,
        content: [
          [cell("A"), cell("B")],
          [cell("1"), cell("2")],
        ],
      })

      renderer.root.add(table)
      await renderOnce()

      const frame = captureFrame()
      expect(frame).not.toContain("┌")
      expect(frame).not.toContain("┐")
      expect(frame).not.toContain("└")
      expect(frame).not.toContain("┘")
      expect(frame).toContain("┼")
      expect(nativeCalls).toBe(1)

      const lines = frame.split("\n")
      const rowY = lines.findIndex((line) => line.includes("A") && line.includes("B"))
      expect(rowY).toBeGreaterThanOrEqual(0)

      const borderXs = findVerticalBorderXs(renderer.currentRenderBuffer, rowY)
      expect(borderXs).toEqual([1])
    } finally {
      OptimizedBuffer.prototype.drawGrid = originalDrawGrid
    }
  })

  test("defaults outerBorder to false when border is false", async () => {
    const originalDrawGrid = OptimizedBuffer.prototype.drawGrid
    let nativeCalls = 0

    OptimizedBuffer.prototype.drawGrid = function (...args: Parameters<OptimizedBuffer["drawGrid"]>) {
      nativeCalls += 1
      return originalDrawGrid.apply(this, args)
    }

    try {
      const table = new TextTableRenderable(renderer, {
        left: 0,
        top: 0,
        border: false,
        content: [
          [cell("A"), cell("B")],
          [cell("1"), cell("2")],
        ],
      })

      renderer.root.add(table)
      await renderOnce()

      const frame = captureFrame()
      expect(table.outerBorder).toBe(false)
      expect(BORDER_CHAR_PATTERN.test(frame)).toBe(false)
      expect(frame).toContain("AB")
      expect(nativeCalls).toBe(0)
    } finally {
      OptimizedBuffer.prototype.drawGrid = originalDrawGrid
    }
  })

  test("allows outer border even when inner border is off", async () => {
    const originalDrawGrid = OptimizedBuffer.prototype.drawGrid
    let nativeCalls = 0

    OptimizedBuffer.prototype.drawGrid = function (...args: Parameters<OptimizedBuffer["drawGrid"]>) {
      nativeCalls += 1
      return originalDrawGrid.apply(this, args)
    }

    try {
      const table = new TextTableRenderable(renderer, {
        left: 0,
        top: 0,
        border: false,
        outerBorder: true,
        content: [
          [cell("A"), cell("B")],
          [cell("1"), cell("2")],
        ],
      })

      renderer.root.add(table)
      await renderOnce()

      const frame = captureFrame()
      expect(frame).toContain("┌")
      expect(frame).toContain("┐")
      expect(frame).toContain("└")
      expect(frame).toContain("┘")
      expect(frame).not.toContain("┼")
      expect(nativeCalls).toBe(1)
    } finally {
      OptimizedBuffer.prototype.drawGrid = originalDrawGrid
    }
  })

  test("rebuilds table when content setter is used", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      content: [[cell("A"), cell("B")]],
    })

    renderer.root.add(table)
    await renderOnce()

    const before = captureFrame()

    table.content = [
      [[bold("Col 1")], [bold("Col 2")]],
      [cell("row-1"), cell("updated")],
      [cell("row-2"), [green("active")]],
    ]

    await renderOnce()

    const after = captureFrame()
    expect(before).not.toBe(after)
    expect(after).toMatchSnapshot("content setter update")
  })

  test("renders a final bottom border", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      content: [
        [[bold("A")], [bold("B")]],
        [cell("1"), cell("2")],
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
    const content: TextTableContent = [
      [[bold("Locale")], [bold("Sample")]],
      [cell("ja-JP"), cell("東京で寿司 🍣")],
      [cell("zh-CN"), cell("你好世界 🚀")],
      [cell("ko-KR"), cell("한글 테스트 😄")],
    ]

    const table = new TextTableRenderable(renderer, {
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
    const content: TextTableContent = [
      [[bold("Item")], [bold("Details")]],
      [cell("mixed"), cell("東京界 🌍 emoji wrapping continues across lines for width checks")],
      [cell("emoji"), cell("Faces 😀😃😄 should remain stable")],
    ]

    const table = new TextTableRenderable(renderer, {
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

  test("starts selection only on table cell content", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      content: [
        [[bold("A")], [bold("B")]],
        [cell("1"), cell("2")],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    expect(table.shouldStartSelection(table.x, table.y)).toBe(false)
    expect(table.shouldStartSelection(table.x + 1, table.y)).toBe(false)
    expect(table.shouldStartSelection(table.x, table.y + 1)).toBe(false)
    expect(table.shouldStartSelection(table.x + 1, table.y + 1)).toBe(true)
  })

  test("selection text excludes border glyphs", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      content: [
        [[bold("c1")], [bold("c2")]],
        [cell("aa"), cell("bb")],
        [cell("cc"), cell("dd")],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    await mockMouse.drag(table.x + 1, table.y + 1, table.x + 5, table.y + 3)
    await renderOnce()

    expect(table.hasSelection()).toBe(true)

    const selected = table.getSelectedText()
    expect(selected).toContain("c1\tc2")
    expect(selected).toContain("aa\tb")
    expect(selected).not.toContain("│")
    expect(selected).not.toContain("┌")
    expect(selected).not.toContain("┼")

    const rendererSelection = renderer.getSelection()
    expect(rendererSelection).not.toBeNull()
    expect(rendererSelection?.getSelectedText()).not.toContain("│")
  })

  test("selection colors reset when drag retracts back to the anchor", async () => {
    const defaultFg = RGBA.fromHex("#111111")
    const defaultBg = RGBA.fromValues(0, 0, 0, 0)
    const selectionFg = RGBA.fromHex("#fefefe")
    const selectionBg = RGBA.fromHex("#cc5500")

    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      fg: defaultFg,
      bg: "transparent",
      selectionFg,
      selectionBg,
      content: [
        ["A", "B"],
        ["C", "D"],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    const anchorX = table.x + 1
    const anchorY = table.y + 1
    const farX = table.x + 3
    const farY = table.y + 3

    await mockMouse.pressDown(anchorX, anchorY)
    await mockMouse.moveTo(farX, farY)
    await renderOnce()

    expect(table.hasSelection()).toBe(true)

    let buffer = renderer.currentRenderBuffer
    const selectedCells: Array<{ x: number; y: number }> = []

    for (let y = table.y; y < table.y + table.height; y++) {
      for (let x = table.x; x < table.x + table.width; x++) {
        if (getBgAt(buffer, x, y).equals(selectionBg)) {
          selectedCells.push({ x, y })
        }
      }
    }

    expect(selectedCells.length).toBeGreaterThan(1)

    await mockMouse.moveTo(anchorX, anchorY)
    await renderOnce()

    const assertDeselectedCellsRestored = (frameBuffer: TestRenderer["currentRenderBuffer"]): void => {
      const mismatches: string[] = []

      for (const { x, y } of selectedCells) {
        if (x === anchorX && y === anchorY) continue

        const cp = getCharAt(frameBuffer, x, y)
        if (cp === 0 || cp === VERTICAL_BORDER_CP) continue

        if (!getFgAt(frameBuffer, x, y).equals(defaultFg)) {
          mismatches.push(`fg@${x},${y}`)
        }

        if (!getBgAt(frameBuffer, x, y).equals(defaultBg)) {
          mismatches.push(`bg@${x},${y}`)
        }
      }

      expect(mismatches).toEqual([])
    }

    buffer = renderer.currentRenderBuffer
    expect(table.getSelectedText()).toBe("")
    assertDeselectedCellsRestored(buffer)

    await mockMouse.release(anchorX, anchorY)
    await renderOnce()

    buffer = renderer.currentRenderBuffer
    assertDeselectedCellsRestored(buffer)
    expect(getCharAt(buffer, farX, farY)).toBe("D".codePointAt(0))
  })

  test("does not start selection when drag begins on border", async () => {
    const table = new TextTableRenderable(renderer, {
      left: 0,
      top: 0,
      content: [
        [[bold("A")], [bold("B")]],
        [cell("1"), cell("2")],
      ],
    })

    renderer.root.add(table)
    await renderOnce()

    await mockMouse.drag(table.x, table.y, table.x + 4, table.y + 1)
    await renderOnce()

    expect(table.hasSelection()).toBe(false)
    expect(table.getSelectedText()).toBe("")
  })
})
