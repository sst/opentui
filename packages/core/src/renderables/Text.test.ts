import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { TextRenderable, type TextOptions } from "./Text"
import { TextNodeRenderable } from "./TextNode"
import { RGBA } from "../lib/RGBA"
import { stringToStyledText, StyledText } from "../lib/styled-text"
import { createTestRenderer, type MockMouse, type TestRenderer } from "../testing/test-renderer"

let currentRenderer: TestRenderer
let renderOnce: () => Promise<void>
let currentMouse: MockMouse
let captureFrame: () => string

// Helper function to setup TextRenderable with proper layout
async function createTextRenderable(
  renderer: TestRenderer,
  options: TextOptions,
): Promise<{ text: TextRenderable; root: any }> {
  const textRenderable = new TextRenderable(renderer, { left: 0, top: 0, ...options })
  renderer.root.add(textRenderable)
  await renderOnce()

  return { text: textRenderable, root: renderer.root }
}

describe("TextRenderable Selection", () => {
  describe("Native getSelectedText", () => {
    it("should use native implementation", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        selectable: true,
      })

      // Simulate a selection from start to position 5 (selecting "Hello")
      await currentMouse.drag(text.x, text.y, text.x + 5, text.y)
      await renderOnce()

      const selectedText = text.getSelectedText()
      expect(selectedText).toBe("Hello")
    })

    it("should handle graphemes correctly", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Hello 🌍 World",
        selectable: true,
      })

      // Select "Hello 🌍" (7 characters: H,e,l,l,o, ,🌍)
      await currentMouse.drag(text.x, text.y, text.x + 7, text.y)
      await renderOnce()

      const selectedText = text.getSelectedText()
      expect(selectedText).toBe("Hello 🌍")
    })
  })

  beforeEach(async () => {
    ;({
      renderer: currentRenderer,
      renderOnce,
      mockMouse: currentMouse,
      captureCharFrame: captureFrame,
    } = await createTestRenderer({
      width: 20,
      height: 5,
    }))
  })

  afterEach(() => {
    currentRenderer.destroy()
  })

  describe("Initialization", () => {
    it("should initialize properly", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        selectable: true,
      })

      expect(text.x).toBeDefined()
      expect(text.y).toBeDefined()
      expect(text.width).toBeGreaterThan(0)
      expect(text.height).toBeGreaterThan(0)
    })
  })

  describe("Basic Selection Flow", () => {
    it("should handle selection from start to end", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        selectable: true,
      })

      // Initially no selection
      expect(text.hasSelection()).toBe(false)
      expect(text.getSelection()).toBe(null)
      expect(text.getSelectedText()).toBe("")

      // Start selection at position 6 (start of "World")
      expect(text.shouldStartSelection(6, 0)).toBe(true)

      // Set selection from 6 to 11 (selecting "World")
      await currentMouse.drag(text.x + 6, text.y, text.x + 11, text.y)
      await renderOnce()

      expect(text.hasSelection()).toBe(true)

      // Verify getSelection returns correct start/end
      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(6)
      expect(selection!.end).toBe(11)

      // Verify getSelectedText returns correct substring
      expect(text.getSelectedText()).toBe("World")
    })

    it("should handle selection with newline characters", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Line 1\nLine 2\nLine 3",
        selectable: true,
      })

      // Select from middle of line 2 to middle of line 3
      await currentMouse.drag(text.x + 2, text.y + 1, text.x + 4, text.y + 2)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(9) // Position of "n" in "Line 2"
      expect(selection!.end).toBe(18) // Position after "Line"

      expect(text.getSelectedText()).toBe("ne 2\nLine")
    })

    it("should handle selection spanning multiple lines completely", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "First\nSecond\nThird",
        selectable: true,
      })

      // Select from start of line 1 to end of line 2 (actually selecting Second)
      await currentMouse.drag(text.x, text.y + 1, text.x + 6, text.y + 1)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(text.getSelectedText()).toBe("Second")
    })

    it("should handle selection including multiple line breaks", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "A\nB\nC\nD",
        selectable: true,
      })

      // Select from middle of first line to middle of last line
      await currentMouse.drag(text.x, text.y + 1, text.x + 1, text.y + 2)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      const selectedText = text.getSelectedText()
      expect(selectedText).toContain("\n")
      expect(selectedText).toContain("B")
      expect(selectedText).toContain("C")
    })

    it("should handle selection that includes line breaks at boundaries", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Line1\nLine2\nLine3",
        selectable: true,
      })

      // Select across line boundaries
      await currentMouse.drag(text.x + 4, text.y, text.x + 2, text.y + 1)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      const selectedText = text.getSelectedText()
      expect(selectedText).toContain("1")
      expect(selectedText).toContain("\n")
      expect(selectedText).toContain("Li")
    })

    it("should handle reverse selection (end before start)", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        selectable: true,
      })

      // Start selection from end to beginning (drag from right to left)
      await currentMouse.drag(text.x + 11, text.y, text.x + 6, text.y)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      // Selection should be normalized: start < end
      expect(selection!.start).toBe(6)
      expect(selection!.end).toBe(11)

      expect(text.getSelectedText()).toBe("World")
    })
  })

  describe("Selection Edge Cases", () => {
    it("should handle empty text", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      // Try to create a zero-width selection
      await currentMouse.drag(text.x, text.y, text.x, text.y)
      await renderOnce()

      expect(text.hasSelection()).toBe(false)
      expect(text.getSelection()).toBe(null)
      expect(text.getSelectedText()).toBe("")
    })

    it("should handle single character selection", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "A",
        selectable: true,
      })

      await currentMouse.drag(text.x, text.y, text.x + 1, text.y)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(0)
      expect(selection!.end).toBe(1)

      expect(text.getSelectedText()).toBe("A")
    })

    it("should handle zero-width selection", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        selectable: true,
      })

      // Create zero-width selection
      await currentMouse.drag(text.x + 5, text.y, text.x + 5, text.y)
      await renderOnce()

      // Zero-width selection should be considered no selection
      expect(text.hasSelection()).toBe(false)
      expect(text.getSelection()).toBe(null)
      expect(text.getSelectedText()).toBe("")
    })

    it("should handle selection beyond text bounds", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Hi",
        selectable: true,
      })

      // Try to select beyond text bounds
      await currentMouse.drag(text.x, text.y, text.x + 10, text.y)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(0)
      expect(selection!.end).toBe(2) // Clamped to text length

      expect(text.getSelectedText()).toBe("Hi")
    })
  })

  describe("Selection with Styled Text", () => {
    it("should handle styled text selection", async () => {
      const styledText = stringToStyledText("Hello World")
      // Add some styling to make it more realistic
      styledText.chunks[0].fg = RGBA.fromValues(1, 0, 0, 1) // Red text

      const { text, root } = await createTextRenderable(currentRenderer, {
        content: styledText,
        selectable: true,
      })

      await currentMouse.drag(text.x + 6, text.y, text.x + 11, text.y)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(6)
      expect(selection!.end).toBe(11)

      expect(text.getSelectedText()).toBe("World")
    })

    it("should handle selection with different text colors", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Red and Blue",
        selectable: true,
        selectionBg: RGBA.fromValues(1, 1, 0, 1), // Yellow selection background
        selectionFg: RGBA.fromValues(0, 0, 0, 1), // Black selection text
      })

      await currentMouse.drag(text.x + 8, text.y, text.x + 12, text.y)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(8)
      expect(selection!.end).toBe(12)

      expect(text.getSelectedText()).toBe("Blue")
    })
  })

  describe("Selection State Management", () => {
    it("should clear selection when selection is cleared", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        selectable: true,
      })

      // Set initial selection
      await currentMouse.drag(text.x + 6, text.y, text.x + 11, text.y)
      await renderOnce()
      expect(text.hasSelection()).toBe(true)

      // Clear selection by setting to null via renderer
      currentRenderer.clearSelection()
      await renderOnce()

      expect(text.hasSelection()).toBe(false)
      expect(text.getSelection()).toBe(null)
      expect(text.getSelectedText()).toBe("")
    })

    it("should handle multiple selection changes", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Hello World Test",
        selectable: true,
      })

      // First selection: "Hello"
      await currentMouse.drag(text.x + 0, text.y, text.x + 5, text.y)
      await renderOnce()
      expect(text.getSelectedText()).toBe("Hello")
      expect(text.getSelection()).toEqual({ start: 0, end: 5 })

      // Second selection: "World"
      await currentMouse.drag(text.x + 6, text.y, text.x + 11, text.y)
      await renderOnce()
      expect(text.getSelectedText()).toBe("World")
      expect(text.getSelection()).toEqual({ start: 6, end: 11 })

      // Third selection: "Test"
      await currentMouse.drag(text.x + 12, text.y, text.x + 16, text.y)
      await renderOnce()
      expect(text.getSelectedText()).toBe("Test")
      expect(text.getSelection()).toEqual({ start: 12, end: 16 })
    })
  })

  describe("shouldStartSelection", () => {
    it("should return false for non-selectable text", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        selectable: false,
      })

      expect(text.shouldStartSelection(0, 0)).toBe(false)
      expect(text.shouldStartSelection(5, 0)).toBe(false)
    })

    it("should return true for selectable text within bounds", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        selectable: true,
      })

      expect(text.shouldStartSelection(0, 0)).toBe(true) // Start of text
      expect(text.shouldStartSelection(5, 0)).toBe(true) // Middle of text
      expect(text.shouldStartSelection(10, 0)).toBe(true) // End of text
    })

    it("should handle shouldStartSelection with multi-line text", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Line 1\nLine 2\nLine 3",
        selectable: true,
      })

      expect(text.shouldStartSelection(0, 0)).toBe(true) // Line 1 start
      expect(text.shouldStartSelection(2, 1)).toBe(true) // Line 2 middle
      expect(text.shouldStartSelection(5, 2)).toBe(true) // Line 3 end
    })
  })

  describe("Selection with Custom Dimensions", () => {
    it("should handle selection in constrained width", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "This is a very long text that should wrap to multiple lines",
        selectable: true,
      })

      // Note: In a real scenario, the TextRenderable would handle width constraints
      // For this test, we're just verifying that selection works with multi-line content

      await currentMouse.drag(text.x, text.y, text.x + 10, text.y + 1)
      await renderOnce()

      // The exact start/end positions will depend on how text wraps,
      // but we verify the selection exists and has valid bounds
      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBeGreaterThanOrEqual(0)
      expect(selection!.end).toBeGreaterThan(selection!.start)
      expect(text.getSelectedText().length).toBeGreaterThan(0)
    })
  })

  describe("Cross-Renderable Selection in Nested Boxes", () => {
    it("should handle selection across multiple nested text renderables in boxes", async () => {
      // Create a mock box structure similar to the status box in text-selection-demo.ts
      // We'll create multiple text renderables that simulate the status box layout

      const { text: statusText } = await createTextRenderable(currentRenderer, {
        content: "Selected 5 chars:",
        selectable: true,
        fg: "#f0f6fc",
        top: 0,
      })

      const { text: selectionStartText } = await createTextRenderable(currentRenderer, {
        content: '"Hello"',
        selectable: true,
        fg: "#7dd3fc",
        top: 1,
      })

      const { text: selectionMiddleText } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
        fg: "#94a3b8",
        top: 2,
      })

      const { text: selectionEndText } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
        fg: "#7dd3fc",
        top: 3,
      })

      const { text: debugText } = await createTextRenderable(currentRenderer, {
        content: "Selected renderables: 2/5",
        selectable: true,
        fg: "#e6edf3",
        top: 4,
      })

      // Simulate starting selection above the box and ending below/right of the box
      // This should cover all renderables in the "box"
      const allRenderables = [statusText, selectionStartText, selectionMiddleText, selectionEndText, debugText]

      // Use a single mouse drag that covers all renderables from top-left to bottom-right
      await currentMouse.drag(0, 0, 50, 10)
      await renderOnce()

      // Verify that each renderable has the expected selection
      expect(statusText.hasSelection()).toBe(true)
      expect(statusText.getSelectedText()).toBe("Selected 5 chars:")

      expect(selectionStartText.hasSelection()).toBe(true)
      expect(selectionStartText.getSelectedText()).toBe('"Hello"')

      // Empty text renderables should not have selections since there's no content to select
      expect(selectionMiddleText.hasSelection()).toBe(false)
      expect(selectionMiddleText.getSelectedText()).toBe("")

      expect(selectionEndText.hasSelection()).toBe(false)
      expect(selectionEndText.getSelectedText()).toBe("")

      expect(debugText.hasSelection()).toBe(true)
      expect(debugText.getSelectedText()).toBe("Selected renderables: 2/5")

      // Use the renderer's global selection to get combined selected text
      const globalSelectedText = currentRenderer.getSelection()?.getSelectedText()

      expect(globalSelectedText).toContain("Selected 5 chars:")
      expect(globalSelectedText).toContain('"Hello"')
      expect(globalSelectedText).toContain("Selected renderables: 2/5")
    })

    it("should automatically update selection when text content changes within covered area", async () => {
      // Create renderables similar to the status box
      const { text: statusText } = await createTextRenderable(currentRenderer, {
        content: "Selected 5 chars:",
        selectable: true,
        fg: "#f0f6fc",
        top: 0,
        wrap: false,
      })

      const { text: selectionStartText } = await createTextRenderable(currentRenderer, {
        top: 1,
        content: '"Hello"',
        selectable: true,
        fg: "#7dd3fc",
        wrap: false,
      })

      const { text: debugText } = await createTextRenderable(currentRenderer, {
        top: 2,
        content: "Selected renderables: 2/5",
        selectable: true,
        fg: "#e6edf3",
        wrap: false,
      })

      // Establish initial selection covering all renderables
      await currentMouse.drag(0, 0, 50, 5)
      await renderOnce()

      // Verify initial selection
      expect(statusText.getSelectedText()).toBe("Selected 5 chars:")
      expect(selectionStartText.getSelectedText()).toBe('"Hello"')
      expect(debugText.getSelectedText()).toBe("Selected renderables: 2/5")

      selectionStartText.content = '"Hello World Extended Selection"'

      // Verify the selection now includes the extended content
      expect(statusText.getSelectedText()).toBe("Selected 5 chars:")
      expect(selectionStartText.getSelectedText()).toBe('"Hello World Extended Selection"')
      expect(debugText.getSelectedText()).toBe("Selected renderables: 2/5")

      // Global selected text should include the changed content
      const updatedGlobalSelectedText = currentRenderer.getSelection()?.getSelectedText()

      expect(updatedGlobalSelectedText).toContain('"Hello World Extended Selection"')
      expect(updatedGlobalSelectedText).toContain("Selected 5 chars:")
      expect(updatedGlobalSelectedText).toContain("Selected renderables: 2/5")

      // Change content of another renderable
      debugText.content = "Selected renderables: 3/5 | Container: statusBox"

      expect(debugText.getSelectedText()).toBe("Selected renderables: 3/5 | Container: statusBox")

      const finalGlobalSelectedText = currentRenderer.getSelection()?.getSelectedText()

      expect(finalGlobalSelectedText).toContain("Selected renderables: 3/5 | Container: statusBox")
    })

    it("should handle selection that starts above box and ends below/right of box", async () => {
      const { text: statusText } = await createTextRenderable(currentRenderer, {
        content: "Status: Selection active",
        selectable: true,
        fg: "#f0f6fc",
        top: 2,
        wrap: false,
      })

      const { text: selectionStartText } = await createTextRenderable(currentRenderer, {
        content: "Start: (10,5)",
        selectable: true,
        fg: "#7dd3fc",
        top: 3,
        wrap: false,
      })

      const { text: selectionEndText } = await createTextRenderable(currentRenderer, {
        content: "End: (45,12)",
        selectable: true,
        fg: "#7dd3fc",
        top: 4,
        wrap: false,
      })

      const { text: debugText } = await createTextRenderable(currentRenderer, {
        content: "Debug: Cross-renderable selection spanning 3 elements",
        selectable: true,
        fg: "#e6edf3",
        top: 5,
        wrap: false,
      })

      const allRenderables = [statusText, selectionStartText, selectionEndText, debugText]

      await currentMouse.drag(statusText.x, statusText.y, 60, 10)
      await renderOnce()

      // Verify all renderables are selected
      allRenderables.forEach((renderable) => {
        expect(renderable.hasSelection()).toBe(true)
      })

      // Verify the selected text from each renderable
      expect(statusText.getSelectedText()).toBe("Status: Selection active")
      expect(selectionStartText.getSelectedText()).toBe("Start: (10,5)")
      expect(selectionEndText.getSelectedText()).toBe("End: (45,12)")
      expect(debugText.getSelectedText()).toBe("Debug: Cross-renderable selection spanning 3 elements")

      // Use the renderer's global selection to get combined selected text
      const globalSelectedText = currentRenderer.getSelection()?.getSelectedText()

      expect(globalSelectedText).toContain("Status: Selection active")
      expect(globalSelectedText).toContain("Start: (10,5)")
      expect(globalSelectedText).toContain("End: (45,12)")
      expect(globalSelectedText).toContain("Debug: Cross-renderable selection spanning 3 elements")
    })
  })

  describe("TextNode Integration with getPlainText", () => {
    it("should render correct plain text after adding TextNodes", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      // Create TextNodeRenderables
      const node1 = new TextNodeRenderable({
        fg: RGBA.fromValues(1, 0, 0, 1),
        bg: RGBA.fromValues(0, 0, 0, 1),
      })
      node1.add("Hello")

      const node2 = new TextNodeRenderable({
        fg: RGBA.fromValues(0, 1, 0, 1),
        bg: RGBA.fromValues(0, 0, 0, 1),
      })
      node2.add(" World")

      // Add TextNodes to TextRenderable
      text.add(node1)
      text.add(node2)

      // Trigger render to apply commands
      await renderOnce()

      expect(text.plainText).toBe("Hello World")
    })

    it("should render correct plain text after inserting TextNodes", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      const node1 = new TextNodeRenderable({})
      node1.add("Hello")

      const node2 = new TextNodeRenderable({})
      node2.add(" World")

      const node3 = new TextNodeRenderable({})
      node3.add("!")

      // Add first two nodes
      text.add(node1)
      text.add(node2)

      // Insert third node before second node
      text.insertBefore(node3, node2)

      // Trigger render to apply commands
      await renderOnce()

      expect(text.plainText).toBe("Hello! World")
    })

    it("should render correct plain text after removing TextNodes", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      const node1 = new TextNodeRenderable({})
      node1.add("Hello")

      const node2 = new TextNodeRenderable({})
      node2.add(" Cruel")

      const node3 = new TextNodeRenderable({})
      node3.add(" World")

      // Add all nodes
      text.add(node1)
      text.add(node2)
      text.add(node3)

      // Trigger initial render
      await renderOnce()
      expect(text.plainText).toBe("Hello Cruel World")

      // Remove middle node - this generates remove commands
      text.remove(node2.id)

      // Trigger render to apply the remove commands
      await renderOnce()

      // After removing " Cruel", should be "Hello World"
      expect(text.plainText).toBe("Hello World")
    })

    it("should handle simple add and remove operations", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      const node = new TextNodeRenderable({})
      node.add("Test")

      // Add node
      text.add(node)

      // Trigger render
      await renderOnce()
      expect(text.plainText).toBe("Test")

      // Remove node
      text.remove(node.id)

      // Trigger render
      await renderOnce()
      expect(text.plainText).toBe("")
    })

    it("should render correct plain text after clearing all TextNodes", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      // Add initial content via TextNodes
      const node1 = new TextNodeRenderable({})
      node1.add("Hello")

      const node2 = new TextNodeRenderable({})
      node2.add(" World")

      text.add(node1)
      text.add(node2)

      // Trigger render to apply commands
      await renderOnce()
      expect(text.plainText).toBe("Hello World")

      // Clear all content
      text.clear()

      // Trigger render to apply commands
      await renderOnce()

      expect(text.plainText).toBe("")
    })

    it("should handle nested TextNode structures correctly", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      // Create nested structure: Parent -> [Child1, Child2]
      const parent = new TextNodeRenderable({
        fg: RGBA.fromValues(1, 1, 0, 1),
      })

      const child1 = new TextNodeRenderable({
        fg: RGBA.fromValues(1, 0, 0, 1),
      })
      child1.add("Red")

      const child2 = new TextNodeRenderable({
        fg: RGBA.fromValues(0, 1, 0, 1),
      })
      child2.add(" Green")

      parent.add(child1)
      parent.add(child2)

      const standalone = new TextNodeRenderable({
        fg: RGBA.fromValues(0, 0, 1, 1),
      })
      standalone.add(" Blue")

      text.add(parent)
      text.add(standalone)

      // Trigger render to apply commands
      await renderOnce()

      expect(text.plainText).toBe("Red Green Blue")
    })

    it("should handle mixed string and TextNode content", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      // Add initial string content via TextNode
      const startNode = new TextNodeRenderable({})
      startNode.add("Start ")

      const node1 = new TextNodeRenderable({})
      node1.add("middle")

      const node2 = new TextNodeRenderable({})
      node2.add(" end")

      text.add(startNode)
      text.add(node1)
      text.add(node2)

      // Trigger render to apply commands
      await renderOnce()

      expect(text.plainText).toBe("Start middle end")
    })

    it("should handle TextNode operations with inherited styles", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
        fg: RGBA.fromValues(1, 1, 1, 1), // White default
      })

      // Create parent with red color
      const redParent = new TextNodeRenderable({
        fg: RGBA.fromValues(1, 0, 0, 1), // Red
      })

      // Child inherits red color but has no text
      const redChild = new TextNodeRenderable({})

      // Grandchild with green color and text
      const greenGrandchild = new TextNodeRenderable({
        fg: RGBA.fromValues(0, 1, 0, 1), // Green
      })
      greenGrandchild.add("Green")

      redChild.add(greenGrandchild)
      redParent.add(redChild)

      const blueNode = new TextNodeRenderable({
        fg: RGBA.fromValues(0, 0, 1, 1), // Blue
      })
      blueNode.add(" Blue")

      text.add(redParent)
      text.add(blueNode)

      // Trigger render to apply commands
      await renderOnce()

      expect(text.plainText).toBe("Green Blue")
    })

    it("should handle empty TextNodes correctly", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      const emptyNode1 = new TextNodeRenderable({})
      const nodeWithText = new TextNodeRenderable({})
      nodeWithText.add("Text")
      const emptyNode2 = new TextNodeRenderable({})

      text.add(emptyNode1)
      text.add(nodeWithText)
      text.add(emptyNode2)

      // Trigger render to apply commands
      await renderOnce()

      expect(text.plainText).toBe("Text")
    })

    it("should handle complex TextNode operations sequence", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      // Create initial content node
      const initialNode = new TextNodeRenderable({})
      initialNode.add("Initial")

      // Create multiple nodes
      const nodeA = new TextNodeRenderable({})
      nodeA.add(" A")

      const nodeB = new TextNodeRenderable({})
      nodeB.add(" B")

      const nodeC = new TextNodeRenderable({})
      nodeC.add(" C")

      const nodeD = new TextNodeRenderable({})
      nodeD.add(" D")

      // Add all nodes
      text.add(initialNode)
      text.add(nodeA)
      text.add(nodeB)
      text.add(nodeC)
      text.add(nodeD)

      // Trigger render
      await renderOnce()
      expect(text.plainText).toBe("Initial A B C D")

      // Remove middle node
      text.remove(nodeB.id)

      // Trigger render
      await renderOnce()
      expect(text.plainText).toBe("Initial A C D")

      // Insert new node before nodeC
      const nodeX = new TextNodeRenderable({})
      nodeX.add(" X")
      text.insertBefore(nodeX, nodeC)

      // Trigger render
      await renderOnce()
      expect(text.plainText).toBe("Initial A X C D")

      // Add more content to existing node
      nodeX.add(" Y")

      // Trigger render
      await renderOnce()
      expect(text.plainText).toBe("Initial A X Y C D")
    })

    it("should inherit fg/bg colors from TextRenderable to TextNode children", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
        fg: RGBA.fromValues(1, 0, 0, 1),
        bg: RGBA.fromValues(0, 0, 1, 1),
      })

      const child1 = new TextNodeRenderable({})
      child1.add("Child1")

      const child2 = new TextNodeRenderable({})
      child2.add(" Child2")

      // Add children to TextRenderable
      text.add(child1)
      text.add(child2)

      await renderOnce()

      expect(text.plainText).toBe("Child1 Child2")

      const chunks = text.textNode.gatherWithInheritedStyle()

      expect(chunks).toHaveLength(2)

      chunks.forEach((chunk) => {
        expect(chunk.fg).toEqual(RGBA.fromValues(1, 0, 0, 1))
        expect(chunk.bg).toEqual(RGBA.fromValues(0, 0, 1, 1))
        expect(chunk.attributes).toBe(0)
      })

      expect(chunks[0].text).toBe("Child1")
      expect(chunks[1].text).toBe(" Child2")
    })

    it("should allow TextNode children to override parent TextRenderable colors", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
        fg: RGBA.fromValues(1, 0, 0, 1),
        bg: RGBA.fromValues(0, 0, 1, 1),
      })

      const inheritingChild = new TextNodeRenderable({})
      inheritingChild.add("Inherit")

      const overridingChild = new TextNodeRenderable({
        fg: RGBA.fromValues(0, 1, 0, 1),
        bg: RGBA.fromValues(1, 1, 0, 1),
      })
      overridingChild.add(" Override")

      const partialOverrideChild = new TextNodeRenderable({
        fg: RGBA.fromValues(0, 0, 1, 1),
      })
      partialOverrideChild.add(" Partial")

      text.add(inheritingChild)
      text.add(overridingChild)
      text.add(partialOverrideChild)

      await renderOnce()

      expect(text.plainText).toBe("Inherit Override Partial")

      const chunks = text.textNode.gatherWithInheritedStyle()

      expect(chunks).toHaveLength(3)

      // First child: inherits both fg and bg from parent
      expect(chunks[0].text).toBe("Inherit")
      expect(chunks[0].fg).toEqual(RGBA.fromValues(1, 0, 0, 1))
      expect(chunks[0].bg).toEqual(RGBA.fromValues(0, 0, 1, 1))

      // Second child: overrides both fg and bg
      expect(chunks[1].text).toBe(" Override")
      expect(chunks[1].fg).toEqual(RGBA.fromValues(0, 1, 0, 1))
      expect(chunks[1].bg).toEqual(RGBA.fromValues(1, 1, 0, 1))

      // Third child: overrides fg, inherits bg
      expect(chunks[2].text).toBe(" Partial")
      expect(chunks[2].fg).toEqual(RGBA.fromValues(0, 0, 1, 1))
      expect(chunks[2].bg).toEqual(RGBA.fromValues(0, 0, 1, 1))
    })

    it("should inherit TextRenderable colors through nested TextNode hierarchies", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
        fg: RGBA.fromValues(0, 1, 0, 1),
        bg: RGBA.fromValues(0, 0, 0, 1),
      })

      const grandparent = new TextNodeRenderable({})
      const parent = new TextNodeRenderable({})
      const child = new TextNodeRenderable({})

      child.add("Deep")
      parent.add("Nested ")
      parent.add(child)
      grandparent.add("Very ")
      grandparent.add(parent)

      text.add(grandparent)

      await renderOnce()

      expect(text.plainText).toBe("Very Nested Deep")

      const chunks = text.textNode.gatherWithInheritedStyle()

      expect(chunks).toHaveLength(3)

      // All chunks should inherit the TextRenderable's green fg and black bg
      chunks.forEach((chunk) => {
        expect(chunk.fg).toEqual(RGBA.fromValues(0, 1, 0, 1))
        expect(chunk.bg).toEqual(RGBA.fromValues(0, 0, 0, 1))
        expect(chunk.attributes).toBe(0)
      })

      expect(chunks[0].text).toBe("Very ")
      expect(chunks[1].text).toBe("Nested ")
      expect(chunks[2].text).toBe("Deep")
    })

    it("should handle TextRenderable color changes affecting existing TextNode children", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
        fg: RGBA.fromValues(1, 0, 0, 1),
        bg: RGBA.fromValues(0, 0, 0, 1),
      })

      const child1 = new TextNodeRenderable({})
      child1.add("Before")

      const child2 = new TextNodeRenderable({})
      child2.add(" Change")

      text.add(child1)
      text.add(child2)

      await renderOnce()
      expect(text.plainText).toBe("Before Change")

      text.fg = RGBA.fromValues(0, 0, 1, 1)
      text.bg = RGBA.fromValues(1, 1, 1, 1)

      await renderOnce()

      const chunks = text.textNode.gatherWithInheritedStyle()

      expect(chunks).toHaveLength(2)

      chunks.forEach((chunk) => {
        expect(chunk.fg).toEqual(RGBA.fromValues(0, 0, 1, 1))
        expect(chunk.bg).toEqual(RGBA.fromValues(1, 1, 1, 1))
      })

      expect(chunks[0].text).toBe("Before")
      expect(chunks[1].text).toBe(" Change")
    })

    it("should handle TextNode commands with multiple operations per render", async () => {
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      // Create nodes and perform multiple operations before rendering
      const node1 = new TextNodeRenderable({})
      node1.add("First")

      const node2 = new TextNodeRenderable({})
      node2.add("Second")

      const node3 = new TextNodeRenderable({})
      node3.add("Third")

      text.add(node1)
      text.add(node2)
      text.insertBefore(node3, node1) // Insert before node1, so order will be: node3, node1, node2

      // Modify node2 after adding - this should generate additional commands
      // Note: This test may fail if modifications after adding don't get tracked
      node2.add(" Modified")

      // Trigger single render to apply all commands
      await renderOnce()

      // The order should be: Third (inserted before node1), First, Second Modified
      // TODO: This may need to be updated based on actual behavior
      expect(text.plainText).toBe("ThirdFirstSecond Modified")
    })
  })

  describe("StyledText Integration", () => {
    it("should render StyledText content correctly", async () => {
      const styledText = stringToStyledText("Hello World")
      // Add some styling to make it more realistic
      styledText.chunks[0].fg = RGBA.fromValues(1, 0, 0, 1) // Red text
      styledText.chunks[0].bg = RGBA.fromValues(0, 0, 0, 1) // Black background

      const { text, root } = await createTextRenderable(currentRenderer, {
        content: styledText,
        selectable: true,
      })

      // Trigger render to apply styling
      await renderOnce()

      expect(text.plainText).toBe("Hello World")
      expect(text.width).toBeGreaterThan(0)
      expect(text.height).toBeGreaterThan(0)
    })

    it("should handle selection with StyledText content", async () => {
      const styledText = stringToStyledText("Hello World")
      styledText.chunks[0].fg = RGBA.fromValues(1, 0, 0, 1) // Red text

      const { text } = await createTextRenderable(currentRenderer, {
        content: styledText,
        selectable: true,
      })

      // Select "World" (positions 6-11)
      await currentMouse.drag(text.x + 6, text.y, text.x + 11, text.y)
      await renderOnce()

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(6)
      expect(selection!.end).toBe(11)
      expect(text.getSelectedText()).toBe("World")
    })

    it("should handle empty StyledText", async () => {
      const emptyStyledText = stringToStyledText("")

      const { text, root } = await createTextRenderable(currentRenderer, {
        content: emptyStyledText,
        selectable: true,
      })

      // Trigger render
      await renderOnce()

      expect(text.plainText).toBe("")
      expect(text.hasSelection()).toBe(false)
      expect(text.getSelectedText()).toBe("")
    })

    it("should handle StyledText with multiple chunks", async () => {
      // Create a StyledText with multiple chunks manually using the constructor
      const styledText = new StyledText([
        { __isChunk: true, text: "Red", fg: RGBA.fromValues(1, 0, 0, 1), attributes: 1 },
        { __isChunk: true, text: " ", fg: undefined, attributes: 0 },
        { __isChunk: true, text: "Green", fg: RGBA.fromValues(0, 1, 0, 1), attributes: 2 },
        { __isChunk: true, text: " ", fg: undefined, attributes: 0 },
        { __isChunk: true, text: "Blue", fg: RGBA.fromValues(0, 0, 1, 1), attributes: 0 },
      ])

      const { text, root } = await createTextRenderable(currentRenderer, {
        content: styledText,
        selectable: true,
      })

      // Trigger render
      await renderOnce()

      expect(text.plainText).toBe("Red Green Blue")

      // Select "Green"
      await currentMouse.drag(text.x + 4, text.y, text.x + 9, text.y)
      await renderOnce()

      expect(text.getSelectedText()).toBe("Green")
    })

    it("should handle StyledText with TextNodeRenderable children", async () => {
      // Create TextRenderable with empty content (following existing test pattern)
      const { text, root } = await createTextRenderable(currentRenderer, {
        content: "",
        selectable: true,
      })

      // Add base content as a TextNodeRenderable
      const baseNode = new TextNodeRenderable({})
      baseNode.add("Base ")
      text.add(baseNode)

      // Add TextNodeRenderable children with StyledText
      const styledNode = new TextNodeRenderable({
        fg: RGBA.fromValues(1, 0, 0, 1),
      })

      // Create a proper StyledText instance for the node
      const nodeStyledText = new StyledText([
        { __isChunk: true, text: "Styled", fg: RGBA.fromValues(0, 1, 0, 1), attributes: 1 },
      ])

      styledNode.add(nodeStyledText)
      text.add(styledNode)

      // Trigger render
      await renderOnce()

      expect(text.plainText).toBe("Base Styled")

      // Test that we can select text from the combined content
      await currentMouse.drag(text.x + 5, text.y, text.x + 11, text.y)
      await renderOnce()
      expect(text.getSelectedText()).toBe("Styled")
    })
  })

  describe("Text Content Snapshots", () => {
    it("should render basic text content correctly", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
        left: 5,
        top: 3,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render multiline text content correctly", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Line 1: Hello\nLine 2: World\nLine 3: Testing\nLine 4: Multiline",
        left: 1,
        top: 1,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render text with graphemes/emojis correctly", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Hello 🌍 World 👋\n Test 🚀 Emoji",
        left: 0,
        top: 2,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render TextNode text composition correctly", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "",
        left: 0,
        top: 0,
      })

      const node1 = new TextNodeRenderable({})
      node1.add("First")

      const node2 = new TextNodeRenderable({})
      node2.add(" Second")

      const node3 = new TextNodeRenderable({})
      node3.add(" Third")

      text.add(node1)
      text.add(node2)
      text.add(node3)

      await renderOnce()

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render text positioning correctly", async () => {
      const { text: text1 } = await createTextRenderable(currentRenderer, {
        content: "Top",
        position: "absolute",
        left: 0,
        top: 0,
      })

      const { text: text2 } = await createTextRenderable(currentRenderer, {
        content: "Mid",
        position: "absolute",
        left: 8,
        top: 2,
      })

      const { text: text3 } = await createTextRenderable(currentRenderer, {
        content: "Bot",
        position: "absolute",
        left: 16,
        top: 4,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render empty buffer correctly", async () => {
      currentRenderer.currentRenderBuffer.clear()
      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render text with character wrapping correctly", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "This is a very long text that should wrap to multiple lines when wrap is enabled",
        wrap: true,
        wrapMode: "char", // Explicitly test character wrapping
        width: 15, // Force wrapping at 15 characters width
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render wrapped text with different content", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789",
        wrap: true,
        wrapMode: "char", // Explicitly test character wrapping
        width: 10, // Force wrapping at 10 characters width
        left: 2,
        top: 1,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render wrapped text with emojis and graphemes", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Hello 🌍 World 👋 This is a test with emojis 🚀 that should wrap properly",
        wrap: true,
        wrapMode: "char", // Explicitly test character wrapping
        width: 12, // Force wrapping at 12 characters width
        left: 1,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should render wrapped multiline text correctly", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "First line with long content\nSecond line also with content\nThird line",
        wrap: true,
        wrapMode: "char", // Explicitly test character wrapping
        width: 8, // Force wrapping at 8 characters width
        left: 0,
        top: 1,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })
  })

  describe("Word Wrapping", () => {
    it("should default to word wrap mode", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Hello World",
      })

      expect(text.wrapMode).toBe("word")
    })

    it("should wrap at word boundaries when using word mode", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "The quick brown fox jumps over the lazy dog",
        wrap: true,
        wrapMode: "word",
        width: 15,
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should wrap at character boundaries when using char mode", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "The quick brown fox jumps over the lazy dog",
        wrap: true,
        wrapMode: "char",
        width: 15,
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should handle word wrapping with punctuation", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "Hello,World.Test-Example/Path",
        wrap: true,
        wrapMode: "word",
        width: 10,
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should handle word wrapping with hyphens and dashes", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "self-contained multi-line text-wrapping example",
        wrap: true,
        wrapMode: "word",
        width: 12,
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should dynamically change wrap mode", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "The quick brown fox jumps",
        wrap: true,
        wrapMode: "char",
        width: 10,
        left: 0,
        top: 0,
      })

      expect(text.wrapMode).toBe("char")

      // Change to word mode
      text.wrapMode = "word"
      await renderOnce()

      expect(text.wrapMode).toBe("word")
      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should handle long words that exceed wrap width in word mode", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        wrap: true,
        wrapMode: "word",
        width: 10,
        left: 0,
        top: 0,
      })

      // Since there's no word boundary, it should fall back to character wrapping
      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should preserve empty lines with word wrapping", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "First line\n\nThird line",
        wrap: true,
        wrapMode: "word",
        width: 8,
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should handle word wrapping with single character words", async () => {
      const { text } = await createTextRenderable(currentRenderer, {
        content: "a b c d e f g h i j k l m n o p",
        wrap: true,
        wrapMode: "word",
        width: 8,
        left: 0,
        top: 0,
      })

      const frame = captureFrame()
      expect(frame).toMatchSnapshot()
    })

    it("should compare char vs word wrapping with same content", async () => {
      const content = "Hello wonderful world of text wrapping"

      // Test with char mode
      const { text: charText } = await createTextRenderable(currentRenderer, {
        content,
        wrap: true,
        wrapMode: "char",
        width: 12,
        left: 0,
        top: 0,
      })

      const charFrame = captureFrame()

      // Remove the char text and add word text
      currentRenderer.root.remove(charText.id)
      await renderOnce()

      const { text: wordText } = await createTextRenderable(currentRenderer, {
        content,
        wrap: true,
        wrapMode: "word",
        width: 12,
        left: 0,
        top: 0,
      })

      const wordFrame = captureFrame()

      // The frames should be different as word wrapping preserves word boundaries
      expect(charFrame).not.toBe(wordFrame)
      expect(wordFrame).toMatchSnapshot()
    })
  })
})
