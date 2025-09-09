import { describe, expect, it, beforeEach, afterEach, afterAll } from "bun:test"
import { TextRenderable, type TextOptions } from "./Text"
import { TextNodeRenderable } from "./TextNode"
import { RGBA } from "../lib/RGBA"
import { stringToStyledText } from "../lib/styled-text"
import { RootRenderable } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import type { RenderContext } from "../types"
import { Selection, type LocalSelectionBounds } from "../lib/selection"

// Minimal mock render context for testing
class MockRenderContext {
  widthMethod: "wcwidth" | "unicode" = "wcwidth"
  width = 80
  height = 24

  // Mock buffer methods
  getNextBuffer() {
    return {
      width: 80,
      height: 24,
    }
  }

  addToHitGrid() {}
  checkHit() {
    return 0
  }
  requestRender() {
    // Mock render request - do nothing
  }
}

let ctx: RenderContext
let root: RootRenderable
let testBuffer: OptimizedBuffer

// Helper function to setup TextRenderable with proper layout
function createTextRenderable(options: TextOptions): TextRenderable {
  // Create root renderable for layout
  root = new RootRenderable(ctx)

  // Create text renderable
  const textRenderable = new TextRenderable(ctx, options)

  // Add text to root to enable layout
  root.add(textRenderable)

  // Create test buffer and trigger layout by rendering
  testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
  root.render(testBuffer, 0)

  return textRenderable
}

// Helper function to create Selection objects for testing
function createSelection(
  textRenderable: TextRenderable,
  anchor: { x: number; y: number },
  focus: { x: number; y: number },
  isActive: boolean = true,
  isSelecting: boolean = false,
): Selection {
  const selection = new Selection(textRenderable, anchor, focus)
  selection.isActive = isActive
  selection.isSelecting = isSelecting
  return selection
}

describe("TextRenderable Selection", () => {
  describe("Native getSelectedText", () => {
    it("should use native implementation", () => {
      text = createTextRenderable({
        content: "Hello World",
        selectable: true,
      })

      // Simulate a selection from start to position 5 (selecting "Hello")
      const selection = createSelection(text, { x: 0, y: 0 }, { x: 5, y: 0 }, true, false)

      text.onSelectionChanged(selection)

      const selectedText = text.getSelectedText()
      expect(selectedText).toBe("Hello")
    })

    it("should handle graphemes correctly", () => {
      text = createTextRenderable({
        content: "Hello 🌍 World",
        selectable: true,
      })

      // Select "Hello 🌍" (7 characters: H,e,l,l,o, ,🌍)
      const selection = createSelection(text, { x: 0, y: 0 }, { x: 7, y: 0 }, true, false)

      text.onSelectionChanged(selection)

      const selectedText = text.getSelectedText()
      expect(selectedText).toBe("Hello 🌍")
    })
  })

  let text: TextRenderable

  beforeEach(() => {
    ctx = new MockRenderContext() as any
  })

  describe("Initialization", () => {
    it("should initialize properly", () => {
      text = createTextRenderable({
        content: "Hello World",
        selectable: true,
      })

      expect(text.x).toBeDefined()
      expect(text.y).toBeDefined()
      expect(text.width).toBeGreaterThan(0)
      expect(text.height).toBeGreaterThan(0)
    })
  })

  afterEach(() => {
    if (text) {
      text.destroy()
    }
    if (root) {
      root.destroy()
    }
    if (testBuffer) {
      testBuffer.destroy()
    }
  })

  afterAll(() => {
    if (testBuffer) {
      testBuffer.destroy()
    }
  })

  describe("Basic Selection Flow", () => {
    it("should handle selection from start to end", () => {
      text = createTextRenderable({
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
      const selectionObj = createSelection(text, { x: 6, y: 0 }, { x: 11, y: 0 }, true, false)

      const hasSelection = text.onSelectionChanged(selectionObj)
      expect(hasSelection).toBe(true)
      expect(text.hasSelection()).toBe(true)

      // Verify getSelection returns correct start/end
      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(6)
      expect(selection!.end).toBe(11)

      // Verify getSelectedText returns correct substring
      expect(text.getSelectedText()).toBe("World")
    })

    it("should handle selection with newline characters", () => {
      text = createTextRenderable({
        content: "Line 1\nLine 2\nLine 3",
        selectable: true,
      })

      // Select from middle of line 2 to middle of line 3
      const selectionObj = createSelection(text, { x: 2, y: 1 }, { x: 4, y: 2 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(9) // Position of "n" in "Line 2"
      expect(selection!.end).toBe(18) // Position after "Line"

      expect(text.getSelectedText()).toBe("ne 2\nLine")
    })

    it("should handle selection spanning multiple lines completely", () => {
      text = createTextRenderable({
        content: "First\nSecond\nThird",
        selectable: true,
      })

      // Select from start of line 1 to end of line 2
      const selectionObj = createSelection(text, { x: 0, y: 1 }, { x: 6, y: 1 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(text.getSelectedText()).toBe("Second")
    })

    it("should handle selection including multiple line breaks", () => {
      text = createTextRenderable({
        content: "A\nB\nC\nD",
        selectable: true,
      })

      // Select from middle of first line to middle of last line
      const selectionObj = createSelection(text, { x: 0, y: 1 }, { x: 1, y: 2 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      const selectedText = text.getSelectedText()
      expect(selectedText).toContain("\n")
      expect(selectedText).toContain("B")
      expect(selectedText).toContain("C")
    })

    it("should handle selection that includes line breaks at boundaries", () => {
      text = createTextRenderable({
        content: "Line1\nLine2\nLine3",
        selectable: true,
      })

      // Select across line boundaries
      const selectionObj = createSelection(text, { x: 4, y: 0 }, { x: 2, y: 1 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      const selectedText = text.getSelectedText()
      expect(selectedText).toContain("1")
      expect(selectedText).toContain("\n")
      expect(selectedText).toContain("Li")
    })

    it("should handle reverse selection (end before start)", () => {
      text = createTextRenderable({
        content: "Hello World",
        selectable: true,
      })

      // Start selection from end to beginning
      const selectionObj = createSelection(text, { x: 11, y: 0 }, { x: 6, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      // Selection should be normalized: start < end
      expect(selection!.start).toBe(6)
      expect(selection!.end).toBe(11)

      expect(text.getSelectedText()).toBe("World")
    })
  })

  describe("Selection Edge Cases", () => {
    it("should handle empty text", () => {
      text = createTextRenderable({
        content: "",
        selectable: true,
      })

      const selectionObj = createSelection(text, { x: 0, y: 0 }, { x: 0, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)

      expect(text.hasSelection()).toBe(false)
      expect(text.getSelection()).toBe(null)
      expect(text.getSelectedText()).toBe("")
    })

    it("should handle single character selection", () => {
      text = createTextRenderable({
        content: "A",
        selectable: true,
      })

      const selectionObj = createSelection(text, { x: 0, y: 0 }, { x: 1, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(0)
      expect(selection!.end).toBe(1)

      expect(text.getSelectedText()).toBe("A")
    })

    it("should handle zero-width selection", () => {
      text = createTextRenderable({
        content: "Hello World",
        selectable: true,
      })

      const selectionObj = createSelection(text, { x: 5, y: 0 }, { x: 5, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)

      // Zero-width selection should be considered no selection
      expect(text.hasSelection()).toBe(false)
      expect(text.getSelection()).toBe(null)
      expect(text.getSelectedText()).toBe("")
    })

    it("should handle selection beyond text bounds", () => {
      text = createTextRenderable({
        content: "Hi",
        selectable: true,
      })

      const selectionObj = createSelection(text, { x: 0, y: 0 }, { x: 10, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(0)
      expect(selection!.end).toBe(2) // Clamped to text length

      expect(text.getSelectedText()).toBe("Hi")
    })
  })

  describe("Selection with Styled Text", () => {
    it("should handle styled text selection", () => {
      const styledText = stringToStyledText("Hello World")
      // Add some styling to make it more realistic
      styledText.chunks[0].fg = RGBA.fromValues(1, 0, 0, 1) // Red text

      text = createTextRenderable({
        content: styledText,
        selectable: true,
      })

      const selectionObj = createSelection(text, { x: 6, y: 0 }, { x: 11, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(6)
      expect(selection!.end).toBe(11)

      expect(text.getSelectedText()).toBe("World")
    })

    it("should handle selection with different text colors", () => {
      text = createTextRenderable({
        content: "Red and Blue",
        selectable: true,
        selectionBg: RGBA.fromValues(1, 1, 0, 1), // Yellow selection background
        selectionFg: RGBA.fromValues(0, 0, 0, 1), // Black selection text
      })

      const selectionObj = createSelection(text, { x: 8, y: 0 }, { x: 12, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)

      const selection = text.getSelection()
      expect(selection).not.toBe(null)
      expect(selection!.start).toBe(8)
      expect(selection!.end).toBe(12)

      expect(text.getSelectedText()).toBe("Blue")
    })
  })

  describe("Selection State Management", () => {
    it("should clear selection when null passed to onSelectionChanged", () => {
      text = createTextRenderable({
        content: "Hello World",
        selectable: true,
      })

      // Set initial selection
      const selectionObj = createSelection(text, { x: 6, y: 0 }, { x: 11, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)
      expect(text.hasSelection()).toBe(true)

      // Clear selection
      text.onSelectionChanged(null)
      expect(text.hasSelection()).toBe(false)
      expect(text.getSelection()).toBe(null)
      expect(text.getSelectedText()).toBe("")
    })

    it("should handle multiple selection changes", () => {
      text = createTextRenderable({
        content: "The quick brown fox jumps over the lazy dog",
        selectable: true,
      })

      // First selection: "quick"
      let selectionObj = createSelection(text, { x: 4, y: 0 }, { x: 9, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)
      expect(text.getSelectedText()).toBe("quick")
      expect(text.getSelection()).toEqual({ start: 4, end: 9 })

      // Second selection: "brown fox"
      selectionObj = createSelection(text, { x: 10, y: 0 }, { x: 19, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)
      expect(text.getSelectedText()).toBe("brown fox")
      expect(text.getSelection()).toEqual({ start: 10, end: 19 })

      // Third selection: "lazy dog"
      selectionObj = createSelection(text, { x: 35, y: 0 }, { x: 43, y: 0 }, true, false)

      text.onSelectionChanged(selectionObj)
      expect(text.getSelectedText()).toBe("lazy dog")
      expect(text.getSelection()).toEqual({ start: 35, end: 43 })
    })
  })

  describe("shouldStartSelection", () => {
    it("should return false for non-selectable text", () => {
      text = createTextRenderable({
        content: "Hello World",
        selectable: false,
      })

      expect(text.shouldStartSelection(0, 0)).toBe(false)
      expect(text.shouldStartSelection(5, 0)).toBe(false)
    })

    it("should return true for selectable text within bounds", () => {
      text = createTextRenderable({
        content: "Hello World",
        selectable: true,
      })

      expect(text.shouldStartSelection(0, 0)).toBe(true) // Start of text
      expect(text.shouldStartSelection(5, 0)).toBe(true) // Middle of text
      expect(text.shouldStartSelection(10, 0)).toBe(true) // End of text
    })

    it("should handle shouldStartSelection with multi-line text", () => {
      text = createTextRenderable({
        content: "Line 1\nLine 2\nLine 3",
        selectable: true,
      })

      expect(text.shouldStartSelection(0, 0)).toBe(true) // Line 1 start
      expect(text.shouldStartSelection(2, 1)).toBe(true) // Line 2 middle
      expect(text.shouldStartSelection(5, 2)).toBe(true) // Line 3 end
    })
  })

  describe("Selection with Custom Dimensions", () => {
    it("should handle selection in constrained width", () => {
      text = createTextRenderable({
        content: "This is a very long text that should wrap to multiple lines",
        selectable: true,
      })

      // Note: In a real scenario, the TextRenderable would handle width constraints
      // For this test, we're just verifying that selection works with multi-line content

      const selectionObj = createSelection(text, { x: 0, y: 0 }, { x: 10, y: 1 }, true, false)

      text.onSelectionChanged(selectionObj)

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
    it("should handle selection across multiple nested text renderables in boxes", () => {
      // Create a mock box structure similar to the status box in text-selection-demo.ts
      // We'll create multiple text renderables that simulate the status box layout

      const statusText = createTextRenderable({
        content: "Selected 5 chars:",
        selectable: true,
        fg: "#f0f6fc",
      })

      const selectionStartText = createTextRenderable({
        content: '"Hello"',
        selectable: true,
        fg: "#7dd3fc",
      })

      const selectionMiddleText = createTextRenderable({
        content: "",
        selectable: true,
        fg: "#94a3b8",
      })

      const selectionEndText = createTextRenderable({
        content: "",
        selectable: true,
        fg: "#7dd3fc",
      })

      const debugText = createTextRenderable({
        content: "Selected renderables: 2/5",
        selectable: true,
        fg: "#e6edf3",
      })

      // Simulate starting selection above the box and ending below/right of the box
      // This should cover all renderables in the "box"
      const allRenderables = [statusText, selectionStartText, selectionMiddleText, selectionEndText, debugText]

      // Mock the global selection system by simulating selection states for each renderable
      // In the real system, this would be handled by the renderer's global selection manager

      // Start selection at the beginning of the first text
      const startSelection = createSelection(statusText, { x: 0, y: 0 }, { x: 18, y: 0 }, true, false)
      statusText.onSelectionChanged(startSelection)

      // Continue selection to the second text
      const continueSelection1 = createSelection(selectionStartText, { x: 0, y: 0 }, { x: 7, y: 0 }, true, false)
      selectionStartText.onSelectionChanged(continueSelection1)

      // Continue to third text (empty) - use same wide bounds
      const continueSelection2 = createSelection(selectionMiddleText, { x: 0, y: 0 }, { x: 18, y: 0 }, true, false)
      selectionMiddleText.onSelectionChanged(continueSelection2)

      // Continue to fourth text (empty) - use same wide bounds
      const continueSelection3 = createSelection(selectionEndText, { x: 0, y: 0 }, { x: 18, y: 0 }, true, false)
      selectionEndText.onSelectionChanged(continueSelection3)

      // End selection at the last text
      const endSelection = createSelection(debugText, { x: 0, y: 0 }, { x: 25, y: 0 }, true, false)
      debugText.onSelectionChanged(endSelection)

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

      // Simulate the global getSelectedText behavior (concatenated from all renderables)
      const globalSelectedText = allRenderables.map((r) => r.getSelectedText()).join("\n")

      expect(globalSelectedText).toBe('Selected 5 chars:\n"Hello"\n\n\nSelected renderables: 2/5')
    })

    it("should automatically update selection when text content changes within covered area", () => {
      // Create renderables similar to the status box
      const statusText = createTextRenderable({
        content: "Selected 5 chars:",
        selectable: true,
        fg: "#f0f6fc",
      })

      const selectionStartText = createTextRenderable({
        content: '"Hello"',
        selectable: true,
        fg: "#7dd3fc",
      })

      const debugText = createTextRenderable({
        content: "Selected renderables: 2/5",
        selectable: true,
        fg: "#e6edf3",
      })

      const allRenderables = [statusText, selectionStartText, debugText]

      // Establish initial selection covering all renderables
      // Apply the same selection state to all renderables (simulating global selection)
      allRenderables.forEach((renderable) => {
        const initialSelection = createSelection(renderable, { x: 0, y: 0 }, { x: 50, y: 0 }, true, false)
        renderable.onSelectionChanged(initialSelection)
      })

      // Verify initial selection
      expect(statusText.getSelectedText()).toBe("Selected 5 chars:")
      expect(selectionStartText.getSelectedText()).toBe('"Hello"')
      expect(debugText.getSelectedText()).toBe("Selected renderables: 2/5")

      // Change content of middle renderable (making it longer)
      // In real implementation, this would trigger a re-render and selection update
      selectionStartText.content = '"Hello World Extended Selection"'

      // The selection should automatically adjust to include the new content
      // since the anchor/focus covers the entire area
      allRenderables.forEach((renderable) => {
        const updatedSelection = createSelection(renderable, { x: 0, y: 0 }, { x: 60, y: 0 }, true, false)
        renderable.onSelectionChanged(updatedSelection)
      })

      // Verify the selection now includes the extended content
      expect(statusText.getSelectedText()).toBe("Selected 5 chars:")
      expect(selectionStartText.getSelectedText()).toBe('"Hello World Extended Selection"')
      expect(debugText.getSelectedText()).toBe("Selected renderables: 2/5")

      // Global selected text should include the changed content
      const updatedGlobalSelectedText = allRenderables.map((r) => r.getSelectedText()).join("\n")

      expect(updatedGlobalSelectedText).toContain('"Hello World Extended Selection"')
      expect(updatedGlobalSelectedText).toContain("Selected 5 chars:")
      expect(updatedGlobalSelectedText).toContain("Selected renderables: 2/5")

      // Change content of another renderable
      debugText.content = "Selected renderables: 3/5 | Container: statusBox"

      // Selection should update again
      allRenderables.forEach((renderable) => {
        const finalSelection = createSelection(renderable, { x: 0, y: 0 }, { x: 70, y: 0 }, true, false)
        renderable.onSelectionChanged(finalSelection)
      })

      expect(debugText.getSelectedText()).toBe("Selected renderables: 3/5 | Container: statusBox")

      const finalGlobalSelectedText = allRenderables.map((r) => r.getSelectedText()).join("\n")

      expect(finalGlobalSelectedText).toContain("Selected renderables: 3/5 | Container: statusBox")
    })

    it("should handle selection that starts above box and ends below/right of box", () => {
      // Simulate the physical layout where selection starts above the status box
      // and ends below/right of it, covering all text renderables within

      const statusText = createTextRenderable({
        content: "Status: Selection active",
        selectable: true,
        fg: "#f0f6fc",
      })

      const selectionStartText = createTextRenderable({
        content: "Start: (10,5)",
        selectable: true,
        fg: "#7dd3fc",
      })

      const selectionEndText = createTextRenderable({
        content: "End: (45,12)",
        selectable: true,
        fg: "#7dd3fc",
      })

      const debugText = createTextRenderable({
        content: "Debug: Cross-renderable selection spanning 3 elements",
        selectable: true,
        fg: "#e6edf3",
      })

      const allRenderables = [statusText, selectionStartText, selectionEndText, debugText]

      // Simulate selection that starts above the box (negative Y coordinate relative to box)
      // and ends below/right of the box (coordinates beyond the box boundaries)

      // In a real implementation, the renderer would determine which renderables
      // are covered by this selection and apply appropriate local selections
      allRenderables.forEach((renderable) => {
        const crossBoxSelection = createSelection(renderable, { x: 5, y: -2 }, { x: 60, y: 15 }, true, false)
        renderable.onSelectionChanged(crossBoxSelection)
      })

      // Verify all renderables are selected
      allRenderables.forEach((renderable) => {
        expect(renderable.hasSelection()).toBe(true)
      })

      // Verify the selected text from each renderable
      expect(statusText.getSelectedText()).toBe("Status: Selection active")
      expect(selectionStartText.getSelectedText()).toBe("Start: (10,5)")
      expect(selectionEndText.getSelectedText()).toBe("End: (45,12)")
      expect(debugText.getSelectedText()).toBe("Debug: Cross-renderable selection spanning 3 elements")

      // Global selected text should concatenate all selections with newlines
      const globalSelectedText = allRenderables.map((r) => r.getSelectedText()).join("\n")

      expect(globalSelectedText).toBe(
        "Status: Selection active\n" +
          "Start: (10,5)\n" +
          "End: (45,12)\n" +
          "Debug: Cross-renderable selection spanning 3 elements",
      )
    })
  })

  describe("TextNode Integration with getPlainText", () => {
    it("should render correct plain text after adding TextNodes", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      expect(text.plainText).toBe("Hello World")
    })

    it("should render correct plain text after inserting TextNodes", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      expect(text.plainText).toBe("Hello! World")
    })

    it("should render correct plain text after removing TextNodes", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)
      expect(text.plainText).toBe("Hello Cruel World")

      // Remove middle node - this generates remove commands
      text.remove(node2.id)

      // Trigger render to apply the remove commands
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      // After removing " Cruel", should be "Hello World"
      expect(text.plainText).toBe("Hello World")
    })

    it("should handle simple add and remove operations", () => {
      text = createTextRenderable({
        content: "",
        selectable: true,
      })

      const node = new TextNodeRenderable({})
      node.add("Test")

      // Add node
      text.add(node)

      // Trigger render
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)
      expect(text.plainText).toBe("Test")

      // Remove node
      text.remove(node.id)

      // Trigger render
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)
      expect(text.plainText).toBe("")
    })

    it("should render correct plain text after clearing all TextNodes", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)
      expect(text.plainText).toBe("Hello World")

      // Clear all content
      text.clear()

      // Trigger render to apply commands
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      expect(text.plainText).toBe("")
    })

    it("should handle nested TextNode structures correctly", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      expect(text.plainText).toBe("Red Green Blue")
    })

    it("should handle mixed string and TextNode content", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      expect(text.plainText).toBe("Start middle end")
    })

    it("should handle TextNode operations with inherited styles", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      expect(text.plainText).toBe("Green Blue")
    })

    it("should handle empty TextNodes correctly", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      expect(text.plainText).toBe("Text")
    })

    it("should handle complex TextNode operations sequence", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)
      expect(text.plainText).toBe("Initial A B C D")

      // Remove middle node
      text.remove(nodeB.id)

      // Trigger render
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)
      expect(text.plainText).toBe("Initial A C D")

      // Insert new node before nodeC
      const nodeX = new TextNodeRenderable({})
      nodeX.add(" X")
      text.insertBefore(nodeX, nodeC)

      // Trigger render
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)
      expect(text.plainText).toBe("Initial A X C D")

      // Add more content to existing node
      nodeX.add(" Y")

      // Trigger render
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)
      expect(text.plainText).toBe("Initial A X Y C D")
    })

    it("should handle TextNode commands with multiple operations per render", () => {
      text = createTextRenderable({
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
      testBuffer = OptimizedBuffer.create(ctx.width, ctx.height, ctx.widthMethod)
      text.render(testBuffer, 0)

      // The order should be: Third (inserted before node1), First, Second Modified
      // TODO: This may need to be updated based on actual behavior
      expect(text.plainText).toBe("ThirdFirstSecond Modified")
    })
  })
})
