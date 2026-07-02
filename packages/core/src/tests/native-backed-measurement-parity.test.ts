import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { BoxRenderable } from "../renderables/Box.js"
import { TextareaRenderable } from "../renderables/Textarea.js"
import { TextRenderable } from "../renderables/Text.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"

// These tests lock the measurement behavior of the old TypeScript Yoga measure
// functions at the renderable/Yoga boundary, now that TextRenderable and
// TextareaRenderable use native-backed measurement. All expectations are
// hardcoded so the tests stay valid across implementation refactors.

const WORD_WRAP_CONTENT = "Hello wonderful world from OpenTUI"
const PLACEHOLDER_CONTENT = "Placeholder text that is longer than content"

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

function expectLayout(
  renderable: TextRenderable | TextareaRenderable,
  expected: { width: number; height: number },
): void {
  expectCloseToLayout(renderable.width, expected.width)
  expectCloseToLayout(renderable.height, expected.height)

  const layout = renderable.getLayoutNode().getComputedLayout()
  expectCloseToLayout(layout.width, expected.width)
  expectCloseToLayout(layout.height, expected.height)
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

describe("native-backed measurement parity", () => {
  describe("TextRenderable", () => {
    test("matches native char-wrap measurement with relative AtMost clamping", async () => {
      const text = new TextRenderable(renderer, {
        content: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(text)

      expectLayout(text, { width: 20, height: 1 })
    })

    test("matches native word-wrap measurement with relative AtMost clamping", async () => {
      const text = new TextRenderable(renderer, {
        content: WORD_WRAP_CONTENT,
        wrapMode: "word",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(text)

      expectLayout(text, { width: WORD_WRAP_CONTENT.length, height: 1 })
    })

    test("matches native no-wrap measurement", async () => {
      const text = new TextRenderable(renderer, {
        content: "Short\nAVeryLongLineHere\nMedium",
        wrapMode: "none",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(text)

      expectLayout(text, { width: "AVeryLongLineHere".length, height: 3 })
    })

    test("clamps relative AtMost measurement to a narrower parent", async () => {
      const text = new TextRenderable(renderer, {
        content: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        alignSelf: "flex-start",
      })

      await renderInParent(text, { width: 10 })

      expectLayout(text, { width: 10, height: 1 })
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

      await renderInConstrainedColumn(text)

      expectLayout(text, { width: 1, height: 1 })
    })

    test("does not apply relative AtMost clamping for absolute-positioned text", async () => {
      const text = new TextRenderable(renderer, {
        content: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        position: "absolute",
        left: 0,
        top: 0,
      })

      await renderInConstrainedColumn(text)

      expectLayout(text, { width: 20, height: 1 })
    })

    test("recomputes measurement after content changes", async () => {
      const text = new TextRenderable(renderer, {
        content: "Short",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(text)
      expectLayout(text, { width: 5, height: 1 })

      text.content = "ABCDEFGHIJKLMNOPQRST"
      await renderOnce()

      expectLayout(text, { width: 20, height: 1 })
    })

    test("applies and removes AtMost clamping when position changes at runtime", async () => {
      const text = new TextRenderable(renderer, {
        content: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        alignSelf: "flex-start",
        left: 0,
        top: 0,
      })

      await renderInParent(text, { width: 10 })
      expectLayout(text, { width: 10, height: 1 })

      text.position = "absolute"
      await renderOnce()
      expectLayout(text, { width: 20, height: 1 })

      text.position = "relative"
      await renderOnce()
      expectLayout(text, { width: 10, height: 1 })
    })
  })

  describe("TextareaRenderable", () => {
    test("matches native char-wrap editor measurement with relative AtMost clamping", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(textarea)

      expectLayout(textarea, { width: 20, height: 1 })
    })

    test("matches native word-wrap editor measurement with relative AtMost clamping", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: WORD_WRAP_CONTENT,
        wrapMode: "word",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(textarea)

      expectLayout(textarea, { width: WORD_WRAP_CONTENT.length, height: 1 })
    })

    test("matches native no-wrap editor measurement", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "Short\nAVeryLongLineHere\nMedium",
        wrapMode: "none",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(textarea)

      expectLayout(textarea, { width: "AVeryLongLineHere".length, height: 3 })
    })

    test("clamps relative editor AtMost measurement to a narrower parent", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        alignSelf: "flex-start",
      })

      await renderInParent(textarea, { width: 10 })

      expectLayout(textarea, { width: 10, height: 1 })
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

      await renderInConstrainedColumn(textarea)

      expectLayout(textarea, { width: 1, height: 1 })
    })

    test("does not apply relative AtMost clamping for absolute-positioned editors", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        position: "absolute",
        left: 0,
        top: 0,
      })

      await renderInConstrainedColumn(textarea)

      expectLayout(textarea, { width: 20, height: 1 })
    })

    test("recomputes editor measurement after text changes", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "Short",
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(textarea)
      expectLayout(textarea, { width: 5, height: 1 })

      textarea.setText("ABCDEFGHIJKLMNOPQRST")
      await renderOnce()

      expectLayout(textarea, { width: 20, height: 1 })
    })

    test("captures current placeholder measurement behavior", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "",
        placeholder: PLACEHOLDER_CONTENT,
        wrapMode: "char",
        alignSelf: "flex-start",
      })

      await renderInConstrainedColumn(textarea)

      expectLayout(textarea, { width: PLACEHOLDER_CONTENT.length, height: 1 })
    })

    test("applies and removes AtMost clamping when position changes at runtime", async () => {
      const textarea = new TextareaRenderable(renderer, {
        initialValue: "ABCDEFGHIJKLMNOPQRST",
        wrapMode: "none",
        alignSelf: "flex-start",
        left: 0,
        top: 0,
      })

      await renderInParent(textarea, { width: 10 })
      expectLayout(textarea, { width: 10, height: 1 })

      textarea.position = "absolute"
      await renderOnce()
      expectLayout(textarea, { width: 20, height: 1 })

      textarea.position = "relative"
      await renderOnce()
      expectLayout(textarea, { width: 10, height: 1 })
    })
  })
})
