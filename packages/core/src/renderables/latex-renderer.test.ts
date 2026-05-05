import { afterEach, beforeEach, expect, test } from "bun:test"
import { RGBA } from "../lib/RGBA.js"
import { createTestRenderer, type MockMouse, type TestRenderer } from "../testing/test-renderer.js"
import { LatexRenderable } from "./Latex.js"
import {
  clearLatexRenderCache,
  getLatexRenderCacheSize,
  renderLatexToText,
  replaceInlineLatex,
} from "./latex-renderer.js"

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let mockMouse: MockMouse

beforeEach(async () => {
  clearLatexRenderCache()
  const testRenderer = await createTestRenderer({ width: 30, height: 10 })
  renderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
  mockMouse = testRenderer.mockMouse
})

afterEach(() => {
  renderer.destroy()
})

test("renders scripts with unicode glyphs", () => {
  expect(renderLatexToText("x^2 + y_1", { displayMode: false }).text).toBe("x² + y₁")
})

test("renders display fractions as stacked text", () => {
  expect(renderLatexToText("\\frac{1}{y}", { displayMode: true }).text).toBe("1\n─\ny")
})

test("renders square roots and simple matrices", () => {
  expect(renderLatexToText("\\sqrt{x+1}", { displayMode: false }).text).toBe("√(x + 1)")
  expect(renderLatexToText("\\begin{matrix}a&b\\\\c&d\\end{matrix}", { displayMode: true }).text).toBe(
    "[ a  b ]\n[ c  d ]",
  )
})

test("renders compound limits and large operators compactly", () => {
  expect(renderLatexToText("\\lim_{x\\to 0} \\frac{\\sin x}{x}=1", { displayMode: true }).text).toBe(
    "lim(x → 0) sin x/x = 1",
  )
  expect(renderLatexToText("\\sum_{n=1}^{\\infty} \\frac{1}{n^2}", { displayMode: true }).text).toBe("Σ[n=1..∞] 1/n²")
})

test("invalid latex returns source text unless throwOnError is true", () => {
  const result = renderLatexToText("\\definitelybad", { throwOnError: false })
  expect(result.text).toBe("\\definitelybad")
  expect(typeof result.error).toBe("string")
  expect(() => renderLatexToText("\\definitelybad", { throwOnError: true })).toThrow()
})

test("caches rendered latex results", () => {
  expect(getLatexRenderCacheSize()).toBe(0)
  expect(renderLatexToText("x^2", { displayMode: false }).text).toBe("x²")
  expect(getLatexRenderCacheSize()).toBe(1)
  expect(renderLatexToText("x^2", { displayMode: false }).text).toBe("x²")
  expect(getLatexRenderCacheSize()).toBe(1)
})

test("replaceInlineLatex skips code spans and escaped dollars", () => {
  const replaced = replaceInlineLatex("Keep `$x^2$`, \\$5, render $y_1$.", { conceal: true })
  expect(replaced).toBe("Keep `$x^2$`, \\$5, render y₁.")
})

test("LatexRenderable renders and updates content", async () => {
  const latex = new LatexRenderable(renderer, {
    id: "latex",
    content: "x^2",
    displayMode: false,
    fg: RGBA.fromInts(255, 255, 255),
  })
  renderer.root.add(latex)
  await renderOnce()

  expect(captureFrame()).toContain("x²")
  expect(latex.width).toBeGreaterThan(0)

  latex.content = "\\frac{1}{2}"
  latex.displayMode = true
  await renderOnce()

  expect(captureFrame()).toContain("─")
})

test("LatexRenderable selection uses rendered text", async () => {
  const latex = new LatexRenderable(renderer, {
    id: "latex-selection",
    content: "x^2",
    displayMode: false,
    selectable: true,
  })
  renderer.root.add(latex)
  await renderOnce()

  await mockMouse.drag(latex.x, latex.y, latex.x + 2, latex.y)
  await renderOnce()

  expect(latex.getSelectedText()).toBe("x²")
})
