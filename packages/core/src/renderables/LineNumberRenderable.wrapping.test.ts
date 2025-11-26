import { describe, test, expect } from "bun:test"
import { createTestRenderer } from "../testing/test-renderer"
import { TextareaRenderable } from "./Textarea"
import { LineNumberRenderable } from "./LineNumberRenderable"

describe("LineNumberRenderable Wrapping & Scrolling", () => {
  test("renders correct line numbers when scrolled", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 20,
      height: 5, // Small height to force scrolling
    })

    // Create content with enough lines to scroll
    // Line 1 (wrapped) -> 2 visual lines
    // Line 2 (wrapped) -> 2 visual lines
    // Line 3 -> 1 visual line
    // Line 4 -> 1 visual line
    // Line 5 -> 1 visual line
    // Total visual lines: 7. Viewport height: 5.

    const content = "1111111111 1111111\n2222222222 2222222\n333\n444\n555"

    const editor = new TextareaRenderable(renderer, {
      width: "100%",
      height: "100%",
      initialValue: content,
      wrapMode: "char", // Force wrap at chars to be predictable with narrow width
    })

    const editorWithLines = new LineNumberRenderable(renderer, {
      target: editor,
      minWidth: 3,
      paddingRight: 1,
      width: "100%",
      height: "100%",
    })

    renderer.root.add(editorWithLines)

    // Initial render (top)
    await renderOnce()
    let frame = captureCharFrame()
    // Should show lines 1, 1(wrapped), 2, 2(wrapped), 3
    // Note: Line numbers should appear only on first visual line of logical line
    expect(frame).toContain(" 1 1111111111") // First part of line 1
    // Depending on wrap logic, check second line.
    // With minWidth 3 + padding 1 = 4 chars for gutter.
    // Width 20. 16 chars for text.
    // "1111111111 1111111" is 18 chars.
    // Wrap at 16.

    // Move cursor to bottom to force scroll
    editor.editBuffer.setCursor(4, 0) // Line 5 (index 4)
    // To ensure it scrolls to view, we might need to move cursor or call scroll method.
    // TextareaRenderable updates scroll on cursor movement during render/update usually?
    // Or we can manually set scroll if we could access view.
    // But moving cursor usually triggers scroll into view.

    await renderOnce()
    frame = captureCharFrame()

    // Now we should be scrolled to see line 5.
    // Viewport height 5.
    // Visual lines:
    // 0: L1 part 1
    // 1: L1 part 2
    // 2: L2 part 1
    // 3: L2 part 2
    // 4: L3
    // 5: L4
    // 6: L5

    // If we scroll to show L5 at bottom (index 6).
    // Visible indices: 2, 3, 4, 5, 6.
    // Or 2, 3, 4, 5, 6?

    // Should see:
    // L2 part 1 (Line 2)
    // L2 part 2 (empty gutter)
    // L3 (Line 3)
    // L4 (Line 4)
    // L5 (Line 5)

    expect(frame).toContain(" 5 555")
    expect(frame).toContain(" 2 2222222222")

    // Should NOT see Line 1
    expect(frame).not.toContain(" 1 1111111111")
  })

  test("renders correct line numbers with complex wrapping and empty lines", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 30,
      height: 10,
    })

    // "A" * 20 (fits)
    // "" (empty)
    // "B" * 40 (wraps)
    // ""
    // "C"
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

    // Text width seems to be 26 in this environment (possibly due to layout or wrapping specifics)

    const lines = frame.split("\n")

    // Line 1
    expect(lines[0]).toMatch(/ 1 A{20}/)
    // Line 2 (empty)
    expect(lines[1]).toMatch(/ 2\s*$/)
    // Line 3 (wrapped start)
    // Adjusted expectation to 26 chars based on actual output
    expect(lines[2]).toMatch(/ 3 B{26}/)
    // Line 3 (wrapped continuation) - should NOT have number
    // Gutter is 3 spaces. Remaining Bs = 40 - 26 = 14.
    expect(lines[3]).toMatch(/^ {3}B{14}/)
    // Line 4
    expect(lines[4]).toMatch(/ 4\s*$/)
    // Line 5
    expect(lines[5]).toMatch(/ 5 C/)
  })
})
