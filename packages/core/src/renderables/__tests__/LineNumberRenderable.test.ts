import { describe, test, expect } from "bun:test"
import { createTestRenderer } from "../../testing/test-renderer"
import { TextBufferRenderable } from "../TextBufferRenderable"
import { LineNumberRenderable } from "../LineNumberRenderable"
import { BoxRenderable } from "../Box"
import { TextareaRenderable } from "../Textarea"
import { t, fg, bold, cyan } from "../../lib/styled-text"

const initialContent = `Welcome to the TextareaRenderable Demo!

This is an interactive text editor powered by EditBuffer and EditorView.

\tThis is a tab
\t\t\tMultiple tabs

Emojis:
👩🏽‍💻  👨‍👩‍👧‍👦  🏳️‍🌈  🇺🇸  🇩🇪  🇯🇵  🇮🇳

NAVIGATION:
  • Arrow keys to move cursor
  • Home/End for line navigation
  • Ctrl+A/Ctrl+E for buffer start/end
  • Alt+F/Alt+B for word forward/backward
  • Alt+Left/Alt+Right for word forward/backward

SELECTION:
  • Shift+Arrow keys to select
  • Shift+Home/End to select to line start/end
  • Alt+Shift+F/B to select word forward/backward
  • Alt+Shift+Left/Right to select word forward/backward

EDITING:
  • Type any text to insert
  • Backspace/Delete to remove text
  • Enter to create new lines
  • Ctrl+D to delete current line
  • Ctrl+K to delete to line end
  • Alt+D to delete word forward
  • Alt+Backspace or Ctrl+W to delete word backward

UNDO/REDO:
  • Ctrl+Z to undo
  • Ctrl+Shift+Z or Ctrl+Y to redo

VIEW:
  • Shift+W to toggle wrap mode (word/char/none)
  • Shift+L to toggle line numbers

FEATURES:
  ✓ Grapheme-aware cursor movement
  ✓ Unicode (emoji 🌟 and CJK 世界, 你好世界, 中文, 한글)
  ✓ Incremental editing
  ✓ Text wrapping and viewport management
  ✓ Undo/redo support
  ✓ Word-based navigation and deletion
  ✓ Text selection with shift keys

Press ESC to return to main menu`

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

  test("renders line colors for diff highlighting", async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 20,
      height: 10,
    })

    const text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
    const textRenderable = new MockTextBuffer(renderer, {
      text,
      width: "100%",
      height: "100%",
    })

    const lineColors = new Map<number, string>()
    lineColors.set(1, "#2d4a2e") // Green for line 2 (index 1)
    lineColors.set(3, "#4a2d2d") // Red for line 4 (index 3)

    const lineNumberRenderable = new LineNumberRenderable(renderer, {
      target: textRenderable,
      minWidth: 3,
      paddingRight: 1,
      fg: "#ffffff",
      bg: "#000000",
      lineColors: lineColors,
      width: "100%",
      height: "100%",
    })

    renderer.root.add(lineNumberRenderable)

    await renderOnce()

    const buffer = renderer.currentRenderBuffer
    const bgBuffer = buffer.buffers.bg

    // Helper to get RGBA values from buffer at position
    const getBgColor = (x: number, y: number) => {
      const offset = (y * buffer.width + x) * 4
      return {
        r: bgBuffer[offset],
        g: bgBuffer[offset + 1],
        b: bgBuffer[offset + 2],
        a: bgBuffer[offset + 3],
      }
    }

    // Check line 2 (index 1) has green background in gutter (x=2 is in the gutter)
    const line2GutterBg = getBgColor(2, 1)
    expect(line2GutterBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line2GutterBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line2GutterBg.b).toBeCloseTo(0x2e / 255, 2)

    // Check line 2 (index 1) has green background in content area (x=10 is in content)
    const line2ContentBg = getBgColor(10, 1)
    expect(line2ContentBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line2ContentBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line2ContentBg.b).toBeCloseTo(0x2e / 255, 2)

    // Check line 4 (index 3) has red background in gutter
    const line4GutterBg = getBgColor(2, 3)
    expect(line4GutterBg.r).toBeCloseTo(0x4a / 255, 2)
    expect(line4GutterBg.g).toBeCloseTo(0x2d / 255, 2)
    expect(line4GutterBg.b).toBeCloseTo(0x2d / 255, 2)

    // Check line 4 (index 3) has red background in content area
    const line4ContentBg = getBgColor(10, 3)
    expect(line4ContentBg.r).toBeCloseTo(0x4a / 255, 2)
    expect(line4ContentBg.g).toBeCloseTo(0x2d / 255, 2)
    expect(line4ContentBg.b).toBeCloseTo(0x2d / 255, 2)

    // Check line 1 (index 0) has default black background in gutter
    const line1GutterBg = getBgColor(2, 0)
    expect(line1GutterBg.r).toBeCloseTo(0, 2)
    expect(line1GutterBg.g).toBeCloseTo(0, 2)
    expect(line1GutterBg.b).toBeCloseTo(0, 2)
  })

  test("can dynamically update line colors", async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 20,
      height: 10,
    })

    const text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
    const textRenderable = new MockTextBuffer(renderer, {
      text,
      width: "100%",
      height: "100%",
    })

    const lineNumberRenderable = new LineNumberRenderable(renderer, {
      target: textRenderable,
      minWidth: 3,
      paddingRight: 1,
      fg: "#ffffff",
      bg: "#000000",
      width: "100%",
      height: "100%",
    })

    renderer.root.add(lineNumberRenderable)

    await renderOnce()

    const buffer = renderer.currentRenderBuffer
    const bgBuffer = buffer.buffers.bg

    // Helper to get RGBA values from buffer at position
    const getBgColor = (x: number, y: number) => {
      const offset = (y * buffer.width + x) * 4
      return {
        r: bgBuffer[offset],
        g: bgBuffer[offset + 1],
        b: bgBuffer[offset + 2],
        a: bgBuffer[offset + 3],
      }
    }

    // Initially no colors
    const line2InitialBg = getBgColor(2, 1)
    expect(line2InitialBg.r).toBeCloseTo(0, 2)
    expect(line2InitialBg.g).toBeCloseTo(0, 2)
    expect(line2InitialBg.b).toBeCloseTo(0, 2)

    // Set line color using setter
    lineNumberRenderable.setLineColor(1, "#2d4a2e")
    await renderOnce()

    const line2AfterSetBg = getBgColor(2, 1)
    expect(line2AfterSetBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line2AfterSetBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line2AfterSetBg.b).toBeCloseTo(0x2e / 255, 2)

    // Clear the line color
    lineNumberRenderable.clearLineColor(1)
    await renderOnce()

    const line2AfterClearBg = getBgColor(2, 1)
    expect(line2AfterClearBg.r).toBeCloseTo(0, 2)
    expect(line2AfterClearBg.g).toBeCloseTo(0, 2)
    expect(line2AfterClearBg.b).toBeCloseTo(0, 2)

    // Set multiple colors
    const newColors = new Map<number, string>()
    newColors.set(0, "#2d4a2e") // Green for line 1
    newColors.set(2, "#4a2d2d") // Red for line 3
    lineNumberRenderable.setLineColors(newColors)
    await renderOnce()

    const line1Bg = getBgColor(2, 0)
    expect(line1Bg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line1Bg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line1Bg.b).toBeCloseTo(0x2e / 255, 2)

    const line3Bg = getBgColor(2, 2)
    expect(line3Bg.r).toBeCloseTo(0x4a / 255, 2)
    expect(line3Bg.g).toBeCloseTo(0x2d / 255, 2)
    expect(line3Bg.b).toBeCloseTo(0x2d / 255, 2)

    // Clear all colors
    lineNumberRenderable.clearAllLineColors()
    await renderOnce()

    const line1AfterClearAllBg = getBgColor(2, 0)
    expect(line1AfterClearAllBg.r).toBeCloseTo(0, 2)
    expect(line1AfterClearAllBg.g).toBeCloseTo(0, 2)
    expect(line1AfterClearAllBg.b).toBeCloseTo(0, 2)
  })

  test("renders line colors for wrapped lines", async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 20,
      height: 10,
    })

    const text = "Line 1 is very long and should wrap around multiple lines\nLine 2"
    const textRenderable = new MockTextBuffer(renderer, {
      text,
      width: "auto",
      height: "100%",
      wrapMode: "char",
    })

    const lineColors = new Map<number, string>()
    lineColors.set(0, "#2d4a2e") // Green for line 1 (index 0, which wraps)

    const lineNumberRenderable = new LineNumberRenderable(renderer, {
      target: textRenderable,
      minWidth: 3,
      paddingRight: 1,
      fg: "#ffffff",
      bg: "#000000",
      lineColors: lineColors,
      width: "100%",
      height: "100%",
    })

    renderer.root.add(lineNumberRenderable)

    await renderOnce()

    const buffer = renderer.currentRenderBuffer
    const bgBuffer = buffer.buffers.bg

    // Helper to get RGBA values from buffer at position
    const getBgColor = (x: number, y: number) => {
      const offset = (y * buffer.width + x) * 4
      return {
        r: bgBuffer[offset],
        g: bgBuffer[offset + 1],
        b: bgBuffer[offset + 2],
        a: bgBuffer[offset + 3],
      }
    }

    // First visual line of logical line 0 should have green background in gutter
    const line0Visual0GutterBg = getBgColor(2, 0)
    expect(line0Visual0GutterBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line0Visual0GutterBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line0Visual0GutterBg.b).toBeCloseTo(0x2e / 255, 2)

    // First visual line of logical line 0 should have green background in content
    const line0Visual0ContentBg = getBgColor(10, 0)
    expect(line0Visual0ContentBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line0Visual0ContentBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line0Visual0ContentBg.b).toBeCloseTo(0x2e / 255, 2)

    // Second visual line of logical line 0 should also have green background (wrapped continuation)
    const line0Visual1Bg = getBgColor(10, 1)
    expect(line0Visual1Bg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line0Visual1Bg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line0Visual1Bg.b).toBeCloseTo(0x2e / 255, 2)

    // Third visual line of logical line 0 should also have green background (wrapped continuation)
    const line0Visual2Bg = getBgColor(10, 2)
    expect(line0Visual2Bg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line0Visual2Bg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line0Visual2Bg.b).toBeCloseTo(0x2e / 255, 2)
  })

  test("renders line colors correctly within a box with borders", async () => {
    const { renderer, renderOnce } = await createTestRenderer({
      width: 30,
      height: 10,
    })

    const text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
    const textRenderable = new MockTextBuffer(renderer, {
      text,
      width: "100%",
      height: "100%",
    })

    const lineColors = new Map<number, string>()
    lineColors.set(1, "#2d4a2e") // Green for line 2 (index 1)
    lineColors.set(3, "#4a2d2d") // Red for line 4 (index 3)

    const lineNumberRenderable = new LineNumberRenderable(renderer, {
      target: textRenderable,
      minWidth: 3,
      paddingRight: 1,
      fg: "#ffffff",
      bg: "#000000",
      lineColors: lineColors,
      width: "100%",
      height: "100%",
    })

    const box = new BoxRenderable(renderer, {
      border: true,
      borderStyle: "single",
      borderColor: "#ffffff",
      backgroundColor: "#000000",
      width: "100%",
      height: "100%",
      padding: 1,
    })

    box.add(lineNumberRenderable)
    renderer.root.add(box)

    await renderOnce()

    const buffer = renderer.currentRenderBuffer
    const bgBuffer = buffer.buffers.bg
    const charBuffer = buffer.buffers.char

    // Helper to get RGBA values from buffer at position
    const getBgColor = (x: number, y: number) => {
      const offset = (y * buffer.width + x) * 4
      return {
        r: bgBuffer[offset],
        g: bgBuffer[offset + 1],
        b: bgBuffer[offset + 2],
        a: bgBuffer[offset + 3],
      }
    }

    const getChar = (x: number, y: number) => {
      return charBuffer[y * buffer.width + x]
    }

    // Box has borders at x=0 (left) and x=29 (right)
    // Box has padding of 1, so content starts at x=2 (after left border + padding)
    // Gutter is about 5 chars wide (minWidth 3 + padding + margin)
    // Content starts around x=7

    // Line 2 (y=3, accounting for top border + padding + 1 line)
    const line2Y = 3

    // Check that left border is NOT colored (should be white border)
    const leftBorderChar = getChar(0, line2Y)
    expect(leftBorderChar).toBe(0x2502) // Vertical line character │

    // Check that right border is NOT colored (should be white border)
    const rightBorderChar = getChar(29, line2Y)
    expect(rightBorderChar).toBe(0x2502) // Vertical line character │

    // Check that gutter area (inside padding) has green background
    const gutterBg = getBgColor(4, line2Y)
    expect(gutterBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(gutterBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(gutterBg.b).toBeCloseTo(0x2e / 255, 2)

    // Check that content area has green background
    const contentBg = getBgColor(15, line2Y)
    expect(contentBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(contentBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(contentBg.b).toBeCloseTo(0x2e / 255, 2)

    // Check that area near right border (but not the border itself) has green background
    const nearRightBg = getBgColor(27, line2Y)
    expect(nearRightBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(nearRightBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(nearRightBg.b).toBeCloseTo(0x2e / 255, 2)

    // Verify line without color (line 1, y=2) doesn't have green background
    const line1Y = 2
    const line1ContentBg = getBgColor(15, line1Y)
    expect(line1ContentBg.r).toBeCloseTo(0, 2)
    expect(line1ContentBg.g).toBeCloseTo(0, 2)
    expect(line1ContentBg.b).toBeCloseTo(0, 2)
  })

  test("renders full-width line colors when line numbers are hidden", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 20,
      height: 10,
    })

    const text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5"
    const textRenderable = new MockTextBuffer(renderer, {
      text,
      width: "100%",
      height: "100%",
    })

    const lineColors = new Map<number, string>()
    lineColors.set(1, "#2d4a2e") // Green for line 2 (index 1)

    const lineNumberRenderable = new LineNumberRenderable(renderer, {
      target: textRenderable,
      minWidth: 3,
      paddingRight: 1,
      fg: "#ffffff",
      bg: "#000000",
      lineColors: lineColors,
      width: "100%",
      height: "100%",
    })

    renderer.root.add(lineNumberRenderable)

    // First render with line numbers visible
    await renderOnce()
    const frameWithLineNumbers = captureCharFrame()

    // Hide line numbers
    lineNumberRenderable.showLineNumbers = false

    await renderOnce()
    const frameWithoutLineNumbers = captureCharFrame()

    const buffer = renderer.currentRenderBuffer
    const bgBuffer = buffer.buffers.bg

    // Helper to get RGBA values from buffer at position
    const getBgColor = (x: number, y: number) => {
      const offset = (y * buffer.width + x) * 4
      return {
        r: bgBuffer[offset],
        g: bgBuffer[offset + 1],
        b: bgBuffer[offset + 2],
        a: bgBuffer[offset + 3],
      }
    }

    // Debug: check if text moved to x=0
    expect(frameWithoutLineNumbers).toContain("Line 1")
    expect(frameWithoutLineNumbers.split("\n")[1]).toMatch(/^Line 2/)

    // When line numbers are hidden, the background should start at x=0
    const line2LeftEdgeBg = getBgColor(0, 1)
    expect(line2LeftEdgeBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line2LeftEdgeBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line2LeftEdgeBg.b).toBeCloseTo(0x2e / 255, 2)

    // Check middle of line also has background
    const line2MiddleBg = getBgColor(10, 1)
    expect(line2MiddleBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line2MiddleBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line2MiddleBg.b).toBeCloseTo(0x2e / 255, 2)

    // Check right edge has background
    const line2RightEdgeBg = getBgColor(19, 1)
    expect(line2RightEdgeBg.r).toBeCloseTo(0x2d / 255, 2)
    expect(line2RightEdgeBg.g).toBeCloseTo(0x4a / 255, 2)
    expect(line2RightEdgeBg.b).toBeCloseTo(0x2e / 255, 2)
  })

  test("reproduce issue with layout shifting when typing", async () => {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width: 35,
      height: 30,
    })

    const parentContainer = new BoxRenderable(renderer, {
      id: "parent-container",
      zIndex: 10,
      padding: 1,
    })
    renderer.root.add(parentContainer)

    const editorBox = new BoxRenderable(renderer, {
      id: "editor-box",
      borderStyle: "single",
      borderColor: "#6BCF7F",
      backgroundColor: "#0D1117",
      title: "Interactive Editor (TextareaRenderable)",
      titleAlignment: "left",
      paddingLeft: 1,
      paddingRight: 1,
      border: true,
    })
    parentContainer.add(editorBox)

    const editor = new TextareaRenderable(renderer, {
      id: "editor",
      initialValue: initialContent,
      textColor: "#F0F6FC",
      selectionBg: "#264F78",
      selectionFg: "#FFFFFF",
      wrapMode: "word",
      showCursor: true,
      cursorColor: "#4ECDC4",
      placeholder: t`${fg("#333333")("Enter")} ${cyan(bold("text"))} ${fg("#333333")("here...")}`,
      tabIndicator: "→",
      tabIndicatorColor: "#30363D",
    })

    const editorWithLines = new LineNumberRenderable(renderer, {
      id: "editor-lines",
      target: editor,
      minWidth: 3,
      paddingRight: 1,
      fg: "#4b5563", // gray-600
      width: "100%",
      height: "100%",
    })

    editorBox.add(editorWithLines)

    // Initial render
    await renderOnce()

    const lineInfoInitial = editor.editorView.getLogicalLineInfo()
    const visualLinesInitial = lineInfoInitial.lineStarts.length

    // Move cursor to bottom - THIS IS WHERE THE BUG HAPPENS
    editor.gotoBufferEnd()
    await renderOnce()

    const lineInfoAfterScroll = editor.editorView.getLogicalLineInfo()
    const visualLinesAfterScroll = lineInfoAfterScroll.lineStarts.length

    const frame1 = captureCharFrame()
    expect(frame1).toMatchSnapshot()

    // THE BUG: visualLines changed from initial render to after scroll!
    // This happens because measureFunc is called with wrong width
    console.log(`Initial visual lines: ${visualLinesInitial}`)
    console.log(`After scroll visual lines: ${visualLinesAfterScroll}`)
    expect(visualLinesInitial).toBe(visualLinesAfterScroll)

    // Move cursor to line 49 (index 48) which is an empty line and insert a character
    editor.editBuffer.setCursor(48, 0)
    editor.insertChar("a")
    await renderOnce()

    const lineInfoAfterTyping = editor.editorView.getLogicalLineInfo()
    const visualLinesAfterTyping = lineInfoAfterTyping.lineStarts.length

    const frame2 = captureCharFrame()
    expect(frame2).toMatchSnapshot()

    // Visual lines should remain stable after typing
    expect(visualLinesAfterScroll).toBe(visualLinesAfterTyping)

    // Verify borders are intact
    const checkBorder = (frame: string, frameName: string) => {
      const lines = frame.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.startsWith(" │")) {
          if (!line.trimEnd().endsWith("│")) {
            throw new Error(`${frameName}: Line ${i} missing right border: "${line}"`)
          }
        }
      }
    }
    checkBorder(frame2, "Frame2")
  })
})
