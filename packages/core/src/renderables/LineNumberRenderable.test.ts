import { describe, test, expect } from "bun:test"
import { createTestRenderer } from "../testing/test-renderer"
import { TextBufferRenderable } from "./TextBufferRenderable"
import { LineNumberRenderable } from "./LineNumberRenderable"

class MockTextBuffer extends TextBufferRenderable {
  constructor(ctx: any, options: any) {
    super(ctx, options)
    this.textBuffer.setText(options.text || "")
  }
}

describe("LineNumberRenderable", () => {
  test("renders line numbers correctly", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 20,
      height: 10,
    })

    const text = "Line 1\nLine 2\nLine 3"
    const textRenderable = new MockTextBuffer(renderer, {
      text,
      width: "100%",
      height: "100%",
    })

    const lineNumberRenderable = new LineNumberRenderable(renderer, {
      target: textRenderable,
      minWidth: 3,
      paddingRight: 1,
      fg: "white",
      width: "100%",
      height: "100%",
    })

    renderer.root.add(lineNumberRenderable)

    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).toMatchSnapshot()

    expect(frame).toContain(" 1 Line 1")
    expect(frame).toContain(" 2 Line 2")
    expect(frame).toContain(" 3 Line 3")
  })

  test("renders line numbers for wrapping text", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 20,
      height: 10,
    })

    const text = "Line 1 is very long and should wrap around multiple lines"
    const textRenderable = new MockTextBuffer(renderer, {
      text,
      width: "auto",
      height: "100%",
      wrapMode: "char",
    })

    const lineNumberRenderable = new LineNumberRenderable(renderer, {
      target: textRenderable,
      minWidth: 3,
      paddingRight: 1,
      fg: "white",
      width: "100%",
      height: "100%",
    })

    renderer.root.add(lineNumberRenderable)

    await renderOnce()

    const frame = captureCharFrame()
    expect(frame).toMatchSnapshot()

    expect(frame).toContain(" 1 Line 1")
  })
})
