import { expect, test } from "bun:test"
import { Renderable } from "../Renderable.js"
import { OptimizedBuffer } from "../buffer.js"
import { EditBuffer } from "../edit-buffer.js"
import { EditorView } from "../editor-view.js"
import { RGBA } from "../lib/RGBA.js"
import { StyledText } from "../lib/styled-text.js"
import { SyntaxStyle } from "../syntax-style.js"
import { createTestRenderer } from "../testing.js"
import { TextBuffer } from "../text-buffer.js"
import { TextBufferView } from "../text-buffer-view.js"

const white = RGBA.fromInts(230, 240, 250)
const blue = RGBA.fromInts(20, 40, 90)

test("EditorView ASCII runs preserve prefilled viewport backgrounds", async () => {
  const setup = await createTestRenderer({ width: 24, height: 3 })
  const edit = EditBuffer.create("wcwidth")
  const view = EditorView.create(edit, 24, 3)
  class Drawing extends Renderable {
    protected renderSelf(buffer: OptimizedBuffer) {
      buffer.drawEditorView(view, 0, 0)
    }
  }
  const drawing = new Drawing(setup.renderer, { width: 24, height: 3 })
  setup.renderer.root.add(drawing)
  try {
    edit.setText("ASCII row followed by wrapped text\nsecond row")
    edit.setDefaultFg(white)
    for (const alpha of [255, 100]) {
      edit.setDefaultBg(RGBA.fromInts(20, 40, 90, alpha))
      view.resetSelection()
      drawing.requestRender()
      await setup.renderOnce()
      const runs = setup.captureSpans()
      expect(setup.captureCharFrame()).toContain("ASCII row")
      view.setSelection(0, 0)
      drawing.requestRender()
      await setup.renderOnce()
      expect(setup.captureSpans()).toEqual(runs)
    }
  } finally {
    setup.renderer.destroy()
    view.destroy()
    edit.destroy()
  }
})

for (const scenario of [
  "opaque",
  "transparent",
  "opacity",
  "scissor",
  "negative-origin",
  "viewport",
  "wrap",
  "truncate",
  "unicode-tab",
] as const) {
  test(`TextBuffer ASCII runs match scalar drawing: ${scenario}`, async () => {
    const setup = await createTestRenderer({ width: 38, height: 5 })
    const { renderer } = setup
    const text = TextBuffer.create("wcwidth")
    const view = TextBufferView.create(text)
    const style = SyntaxStyle.create()
    text.setSyntaxStyle(style)
    text.setDefaultFg(white)
    text.setDefaultBg(scenario === "transparent" ? RGBA.fromInts(0, 0, 0, 0) : blue)
    text.setStyledText(
      new StyledText([
        { __isChunk: true, text: "first ASCII run " },
        {
          __isChunk: true,
          text: scenario === "unicode-tab" ? "ab\u754cCD\te\u0301FG" : "styled ASCII run",
          fg: RGBA.fromInts(240, 80, 30, 170),
          bg: RGBA.fromInts(20, 100, 60, 100),
          attributes: 1,
          link: { url: "https://example.com/run" },
        },
        { __isChunk: true, text: " reverse run", attributes: 1 << 5 },
        { __isChunk: true, text: "\nsecond row with ASCII and boundary~" },
      ]),
    )
    view.setViewport(scenario === "viewport" ? 7 : 0, 0, scenario === "viewport" ? 19 : 38, 5)
    if (scenario === "wrap") {
      view.setWrapMode("char")
      view.setWrapWidth(17)
    }
    if (scenario === "truncate") view.setTruncate(true)
    view.setTabIndicator(">")
    view.setTabIndicatorColor(white)

    class Drawing extends Renderable {
      protected renderSelf(buffer: OptimizedBuffer) {
        // Include existing wide cells and links so overwriting uses normal ownership rules.
        buffer.drawText("underlay \u754c repeated across row", 0, 0, white, blue)
        buffer.pushOpacity(scenario === "opacity" ? 0.4 : 1)
        if (scenario === "scissor") buffer.pushScissorRect(4, 0, 21, 3)
        buffer.drawTextBuffer(view, scenario === "negative-origin" ? -6 : 0, 0)
        if (scenario === "scissor") buffer.popScissorRect()
        buffer.popOpacity()
      }
    }
    const drawing = new Drawing(renderer, { width: 38, height: 5 })
    renderer.root.add(drawing)
    try {
      await setup.renderOnce()
      const runs = setup.captureSpans()
      const chars = setup.captureCharFrame()
      const attributes = Array.from(renderer.nextRenderBuffer.buffers.attributes)
      expect(chars.trim().length).toBeGreaterThan(0)

      // An empty native selection forces scalar traversal without changing any cell.
      view.setSelection(0, 0)
      drawing.requestRender()
      await setup.renderOnce()
      expect(setup.captureSpans()).toEqual(runs)
      expect(setup.captureCharFrame()).toEqual(chars)
      expect(Array.from(renderer.nextRenderBuffer.buffers.attributes)).toEqual(attributes)

      // Return to runs after a selected frame, exercising repeated overwrites and link lifetimes.
      view.setSelection(2, 10, white, blue)
      drawing.requestRender()
      await setup.renderOnce()
      expect(setup.captureSpans()).not.toEqual(runs)
      view.resetSelection()
      drawing.requestRender()
      await setup.renderOnce()
      expect(setup.captureSpans()).toEqual(runs)
    } finally {
      renderer.destroy()
      view.destroy()
      text.destroy()
      style.destroy()
    }
  })
}
