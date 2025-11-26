import { describe, test, expect } from "bun:test"
import { createTestRenderer } from "../../testing/test-renderer"
import { TextareaRenderable } from "../Textarea"
import { LineNumberRenderable } from "../LineNumberRenderable"

describe("LineNumberRenderable Wrapping & Scrolling", () => {
  test("renders correct line numbers when scrolled", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 20,
      height: 5, // Small height to force scrolling
    })

    const content = "1111111111 1111111\n2222222222 2222222\n333\n444\n555"

    const editor = new TextareaRenderable(renderer, {
      width: "100%",
      height: "100%",
      initialValue: content,
      wrapMode: "char",
    })

    const editorWithLines = new LineNumberRenderable(renderer, {
      target: editor,
      minWidth: 3,
      paddingRight: 1,
      width: "100%",
      height: "100%",
    })

    renderer.root.add(editorWithLines)

    await renderOnce()
    let frame = captureCharFrame()
    // Note: Line numbers should appear only on first visual line of logical line
    expect(frame).toContain(" 1 1111111111")

    // Move cursor to bottom to force scroll
    editor.editBuffer.setCursor(4, 0)

    await renderOnce()
    frame = captureCharFrame()

    expect(frame).toContain(" 5 555")
    expect(frame).toContain(" 2 2222222222")
    expect(frame).not.toContain(" 1 1111111111")
  })

  test("renders correct line numbers with complex wrapping and empty lines", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 30,
      height: 10,
    })

    const content = "A".repeat(20) + "\n\n" + "B".repeat(40) + "\n\nC"

    const editor = new TextareaRenderable(renderer, {
      width: "100%",
      height: "100%",
      initialValue: content,
      wrapMode: "char",
    })

    const editorWithLines = new LineNumberRenderable(renderer, {
      target: editor,
      minWidth: 3,
      paddingRight: 1,
      width: "100%",
      height: "100%",
    })

    renderer.root.add(editorWithLines)

    await renderOnce()
    const frame = captureCharFrame()

    const lines = frame.split("\n")

    expect(lines[0]).toMatch(/ 1 A{20}/)
    expect(lines[1]).toMatch(/ 2\s*$/)
    expect(lines[2]).toMatch(/ 3 B{26}/)
    expect(lines[3]).toMatch(/^ {3}B{14}/)
    expect(lines[4]).toMatch(/ 4\s*$/)
    expect(lines[5]).toMatch(/ 5 C/)
  })
})
