import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../../testing/test-renderer"
import { createTextareaRenderable } from "./renderable-test-utils"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMockInput: MockInput

describe("Check if deleteToLineEnd caches EOL incorrectly", () => {
  beforeEach(async () => {
    ;({ renderer: currentRenderer, renderOnce, mockInput: currentMockInput } = await createTestRenderer({
      width: 80,
      height: 24,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  it("should test if calling deleteToLineEnd gets stale EOL", async () => {
    const { textarea: editor } = await createTextareaRenderable(currentRenderer, renderOnce, {
      initialValue: "Line 1 content\nLine 2",
      width: 40,
      height: 10,
      keyBindings: [{ name: "u", action: "undo" }],
    })

    editor.focus()
    
    // Move to middle of line
    for (let i = 0; i < 7; i++) {
      editor.moveCursorRight()
    }
    
    console.log("Before delete:")
    console.log("  Cursor:", editor.logicalCursor)
    console.log("  EOL:", editor.editBuffer.getEOL())
    
    // Call deleteToLineEnd directly instead of via ctrl+k
    console.log("\nCalling deleteToLineEnd()")
    editor.deleteToLineEnd()
    
    console.log("After delete:")
    console.log("  Text:", JSON.stringify(editor.plainText))
    console.log("  Cursor:", editor.logicalCursor)
    console.log("  EOL:", editor.editBuffer.getEOL())
    
    // Undo
    console.log("\nCalling undo()")
    editor.undo()
    
    console.log("After undo:")
    console.log("  Text:", JSON.stringify(editor.plainText))
    console.log("  Cursor:", editor.logicalCursor)
    console.log("  EOL (stale?):", editor.editBuffer.getEOL())
    
    // Now call deleteToLineEnd again - it should get fresh EOL
    console.log("\nCalling deleteToLineEnd() again")
    const eolBeforeSecondDelete = editor.editBuffer.getEOL()
    console.log("  EOL before second delete:", eolBeforeSecondDelete)
    
    editor.deleteToLineEnd()
    
    console.log("After second delete:")
    console.log("  Text:", JSON.stringify(editor.plainText))
    console.log("  Expected: 'Line 1 \\nLine 2'")
    
    expect(editor.plainText).toBe("Line 1 \nLine 2")
  })
})
