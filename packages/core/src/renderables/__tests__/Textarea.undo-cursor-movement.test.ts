import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput

describe("Test ctrl+k undo with cursor movement", () => {
  beforeEach(async () => {
    ;({ renderer: currentRenderer, renderOnce, mockInput: currentMockInput } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  it("should handle cursor movement after ctrl+k and undo in multiline", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "Line 1 content\nLine 2 content\nLine 3 content",
      width: 40,
      height: 10,
      keyBindings: [{ name: "u", action: "undo" }],
    })

    editor.focus()
    
    console.log("=== Initial state ===")
    console.log("Text:", JSON.stringify(editor.plainText))
    console.log("Cursor:", editor.logicalCursor)
    console.log("Line count:", editor.plainText.split('\n').length)
    
    // Move to middle of line 1
    for (let i = 0; i < 7; i++) {
      editor.moveCursorRight()
    }
    
    console.log("\n=== After moving to position 7 on line 1 ===")
    console.log("Text:", JSON.stringify(editor.plainText))
    console.log("Cursor:", editor.logicalCursor)
    
    // Delete to end of line with ctrl+k
    console.log("\n=== Pressing ctrl+k ===")
    currentMockInput.pressKey("k", { ctrl: true })
    
    console.log("Text after ctrl+k:", JSON.stringify(editor.plainText))
    console.log("Cursor after ctrl+k:", editor.logicalCursor)
    console.log("Line count after ctrl+k:", editor.plainText.split('\n').length)
    
    // Undo
    console.log("\n=== Pressing undo ===")
    currentMockInput.pressKey("u")
    
    console.log("Text after undo:", JSON.stringify(editor.plainText))
    console.log("Cursor after undo:", editor.logicalCursor)
    console.log("Line count after undo:", editor.plainText.split('\n').length)
    
    // Now try moving cursor right
    console.log("\n=== Moving cursor right ===")
    for (let i = 0; i < 3; i++) {
      console.log(`\nBefore right ${i + 1}:`, editor.logicalCursor)
      editor.moveCursorRight()
      console.log(`After right ${i + 1}:`, editor.logicalCursor)
    }
    
    console.log("\n=== Final state ===")
    console.log("Text:", JSON.stringify(editor.plainText))
    console.log("Cursor:", editor.logicalCursor)
    
    // The cursor should still be on line 0, not line 1
    expect(editor.logicalCursor.row).toBe(0)
    expect(editor.logicalCursor.col).toBe(10)
  })

  it("should check what EOL is after undo", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "Line 1 content\nLine 2 content",
      width: 40,
      height: 10,
      keyBindings: [{ name: "u", action: "undo" }],
    })

    editor.focus()
    
    // Move to middle of line 1
    for (let i = 0; i < 7; i++) {
      editor.moveCursorRight()
    }
    
    console.log("\n=== Before delete ===")
    console.log("Text:", JSON.stringify(editor.plainText))
    console.log("Cursor:", editor.logicalCursor)
    const eolBefore = editor.editBuffer.getEOL()
    console.log("EOL before:", eolBefore)
    
    // Delete to end with ctrl+k
    currentMockInput.pressKey("k", { ctrl: true })
    
    console.log("\n=== After delete ===")
    console.log("Text:", JSON.stringify(editor.plainText))
    console.log("Cursor:", editor.logicalCursor)
    const eolAfter = editor.editBuffer.getEOL()
    console.log("EOL after delete:", eolAfter)
    
    // Undo
    currentMockInput.pressKey("u")
    
    console.log("\n=== After undo ===")
    console.log("Text:", JSON.stringify(editor.plainText))
    console.log("Cursor:", editor.logicalCursor)
    const eolAfterUndo = editor.editBuffer.getEOL()
    console.log("EOL after undo:", eolAfterUndo)
    
    // Try to get line length from edit buffer
    const line0Length = editor.plainText.split('\n')[0].length
    console.log("Line 0 actual length from plainText:", line0Length)
    
    // Move to what should be end of line
    while (editor.logicalCursor.col < line0Length) {
      console.log("Moving right, cursor:", editor.logicalCursor)
      editor.moveCursorRight()
    }
    
    console.log("\n=== After moving to end ===")
    console.log("Cursor:", editor.logicalCursor)
    console.log("Expected to be at row 0, col", line0Length)
  })
})
