import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BoxRenderable } from "../renderables/Box.js"
import { TextareaRenderable } from "../renderables/Textarea.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { MeasureMode } from "../yoga.js"

interface ExpectedMeasureOptions {
  availableWidth: number
  availableHeight: number
  position?: "relative" | "absolute"
}

let renderer: TestRenderer
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, renderOnce } = await createTestRenderer({ width: 80, height: 30 }))
})

afterEach(() => {
  renderer.destroy()
})

function expectCloseToLayout(actual: number, expected: number): void {
  expect(actual).toBeCloseTo(expected, 5)
}

function expectLayout(renderable: TextRenderable | TextareaRenderable, expected: { width: number; height: number }): void {
  expectCloseToLayout(renderable.width, expected.width)
  expectCloseToLayout(renderable.height, expected.height)

  const layout = renderable.getLayoutNode().getComputedLayout()
  expectCloseToLayout(layout.width, expected.width)
  expectCloseToLayout(layout.height, expected.height)
}

function expectedFromMeasureResult(
  measureResult: { lineCount: number; widthColsMax: number } | null,
  options: ExpectedMeasureOptions,
): { width: number; height: number } {
  const measuredWidth = measureResult ? Math.max(1, measureResult.widthColsMax) : 1
  const measuredHeight = measureResult ? Math.max(1, measureResult.lineCount) : 1

  if (options.position !== "absolute") {
    return {
      width: Math.min(options.availableWidth, measuredWidth),
      height: Math.min(options.availableHeight, measuredHeight),
    }
  }

  return { width: measuredWidth, height: measuredHeight }
}

function expectedTextLayout(text: TextRenderable, options: ExpectedMeasureOptions): { width: number; height: number } {
  const view = (text as unknown as { textBufferView: { measureForDimensions(width: number, height: number): { lineCount: number; widthColsMax: number } | null } }).textBufferView
  const measureResult = view.measureForDimensions(Math.floor(options.availableWidth), Math.floor(options.availableHeight))
  return expectedFromMeasureResult(measureResult, options)
}

function expectedTextareaLayout(
  textarea: TextareaRenderable,
  options: ExpectedMeasureOptions,
): { width: number; height: number } {
  const measureResult = textarea.editorView.measureForDimensions(
    Math.floor(options.availableWidth),
    Math.floor(options.availableHeight),
  )
  return expectedFromMeasureResult(measureResult, options)
}

async function renderInConstrainedColumn(renderable: TextRenderable | TextareaRenderable): Promise<void> {
  renderer.root.add(renderable)
  await renderOnce()
}

async function renderInParent(
  renderable: TextRenderable | TextareaRenderable,
  options: { width: number; height?: number },
): Promise<void> {
  const parent = new BoxRenderable(renderer, {
    width: options.width,
    ...(options.height === undefined ? {} : { height: options.height }),
    alignItems: "flex-start",
  })
  parent.add(renderable)
  renderer.root.add(parent)
  await renderOnce()
}

describe("native-backed measurement parity preconditions", () => {
  describe("TextRenderable", () => {
    test("matches native char-wrap measurement with relative AtMost clamping", async () => {
      const text = new TextRenderable(renderer, {
        content: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      const expected = expectedTextLayout(text, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(text)

      expect(expected).toEqual({ width: 20, height: 1 })
      expectLayout(text, expected)
    })

    test("matches native word-wrap measurement with relative AtMost clamping", async () => {
      const text = new TextRenderable(renderer, {
        content: "Hello wonderful world from OpenTUI",
        wrapMode: "word",
        alignSelf: "flex-start",
      })

      const expected = expectedTextLayout(text, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(text)

      expect(expected.width).toBeGreaterThan(1)
      expect(expected.height).toBe(1)
      expectLayout(text, expected)
    })

    test("matches native no-wrap measurement", async () => {
      const text = new TextRenderable(renderer, {
        content: "Short\nAVeryLongLineHere\nMedium",
        wrapMode: "none",
        alignSelf: "flex-start",
      })

      const expected = expectedTextLayout(text, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(text)

      expect(expected).toEqual({ width: "AVeryLongLineHere".length, height: 3 })
      expectLayout(text, expected)
    })

    test("clamps relative AtMost measurement to a narrower parent", async () => {
      const text = new TextRenderable(renderer, {
        content: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        alignSelf: "flex-start",
      })

      const expected = expectedTextLayout(text, { availableWidth: 10, availableHeight: 30 })
      await renderInParent(text, { width: 10 })

      expect(expected).toEqual({ width: 10, height: 1 })
      expectLayout(text, expected)
    })

    test("stretches relative text to the root width by default", async () => {
      const text = new TextRenderable(renderer, {
        content: "Short",
        wrapMode: "char",
      })

      await renderInConstrainedColumn(text)

      expectLayout(text, { width: 80, height: 1 })
    })

    test("preserves minimum Yoga measurement size for empty content", async () => {
      const text = new TextRenderable(renderer, {
        content: "",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      const expected = expectedTextLayout(text, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(text)

      expect(expected).toEqual({ width: 1, height: 1 })
      expectLayout(text, expected)
    })

    test("does not apply relative AtMost clamping for absolute-positioned text", async () => {
      const text = new TextRenderable(renderer, {
        content: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        position: "absolute",
        left: 0,
        top: 0,
      })

      const expected = expectedTextLayout(text, { availableWidth: 80, availableHeight: 30, position: "absolute" })
      await renderInConstrainedColumn(text)

      expect(expected).toEqual({ width: 20, height: 1 })
      expectLayout(text, expected)
    })

    test("recomputes measurement after content changes", async () => {
      const text = new TextRenderable(renderer, {
        content: "Short",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(text)
      const before = expectedTextLayout(text, { availableWidth: 80, availableHeight: 30 })
      expectLayout(text, before)

      text.content = "ABCDEFGHIJKLMNOPQRST"
      const after = expectedTextLayout(text, { availableWidth: 80, availableHeight: 30 })
      await renderOnce()

      expect(before).toEqual({ width: 5, height: 1 })
      expect(after).toEqual({ width: 20, height: 1 })
      expectLayout(text, after)
    })
  })

  describe("TextareaRenderable", () => {
    test("matches native char-wrap editor measurement with relative AtMost clamping", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      const expected = expectedTextareaLayout(textarea, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(textarea)

      expect(expected).toEqual({ width: 20, height: 1 })
      expectLayout(textarea, expected)
    })

    test("matches native word-wrap editor measurement with relative AtMost clamping", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "Hello wonderful world from OpenTUI",
        wrapMode: "word",
        alignSelf: "flex-start",
      })

      const expected = expectedTextareaLayout(textarea, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(textarea)

      expect(expected.width).toBeGreaterThan(1)
      expect(expected.height).toBe(1)
      expectLayout(textarea, expected)
    })

    test("matches native no-wrap editor measurement", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "Short\nAVeryLongLineHere\nMedium",
        wrapMode: "none",
        alignSelf: "flex-start",
      })

      const expected = expectedTextareaLayout(textarea, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(textarea)

      expect(expected).toEqual({ width: "AVeryLongLineHere".length, height: 3 })
      expectLayout(textarea, expected)
    })

    test("clamps relative editor AtMost measurement to a narrower parent", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        alignSelf: "flex-start",
      })

      const expected = expectedTextareaLayout(textarea, { availableWidth: 10, availableHeight: 30 })
      await renderInParent(textarea, { width: 10 })

      expect(expected).toEqual({ width: 10, height: 1 })
      expectLayout(textarea, expected)
    })

    test("stretches relative editors to the root width by default", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "Short",
        wrapMode: "char",
      })

      await renderInConstrainedColumn(textarea)

      expectLayout(textarea, { width: 80, height: 1 })
    })

    test("preserves minimum Yoga measurement size for an empty editor", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      const expected = expectedTextareaLayout(textarea, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(textarea)

      expect(expected).toEqual({ width: 1, height: 1 })
      expectLayout(textarea, expected)
    })

    test("does not apply relative AtMost clamping for absolute-positioned editors", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        position: "absolute",
        left: 0,
        top: 0,
      })

      const expected = expectedTextareaLayout(textarea, { availableWidth: 80, availableHeight: 30, position: "absolute" })
      await renderInConstrainedColumn(textarea)

      expect(expected).toEqual({ width: 20, height: 1 })
      expectLayout(textarea, expected)
    })

    test("recomputes editor measurement after text changes", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "Short",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(textarea)
      const before = expectedTextareaLayout(textarea, { availableWidth: 80, availableHeight: 30 })
      expectLayout(textarea, before)

      textarea.setText("ABCDEFGHIJKLMNOPQRST")
      const after = expectedTextareaLayout(textarea, { availableWidth: 80, availableHeight: 30 })
      await renderOnce()

      expect(before).toEqual({ width: 5, height: 1 })
      expect(after).toEqual({ width: 20, height: 1 })
      expectLayout(textarea, after)
    })

    test("captures current placeholder measurement behavior", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "",
        placeholder: "Placeholder text that is longer than content",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      const expected = expectedTextareaLayout(textarea, { availableWidth: 80, availableHeight: 30 })
      await renderInConstrainedColumn(textarea)

      expect(expected).toEqual({ width: "Placeholder text that is longer than content".length, height: 1 })
      expectLayout(textarea, expected)
    })
  })
})
