import { describe, expect, it, beforeEach, afterEach, afterAll } from "bun:test"
import { TextRenderable, type TextOptions } from "./Text"
import { RGBA } from "../lib/RGBA"
import { stringToStyledText } from "../lib/styled-text"
import { RootRenderable } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import type { RenderContext, SelectionState } from "../types"

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

describe("TextRenderable Selection", () => {
  describe("Native getSelectedText", () => {
    it("should use native implementation", () => {
      text = createTextRenderable({
        content: "Hello World",
        selectable: true,
      })

      // Simulate a selection from start to position 5 (selecting "Hello")
      const selectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 5, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

      const selectedText = text.getSelectedText()
      expect(selectedText).toBe("Hello")
    })

    it("should handle graphemes correctly", () => {
      text = createTextRenderable({
        content: "Hello 🌍 World",
        selectable: true,
      })

      // Select "Hello 🌍" (7 characters: H,e,l,l,o, ,🌍)
      const selectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 7, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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
      const selectionState: SelectionState = {
        anchor: { x: 6, y: 0 },
        focus: { x: 11, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      const hasSelection = text.onSelectionChanged(selectionState)
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
      const selectionState: SelectionState = {
        anchor: { x: 2, y: 1 }, // "ne" in "Line 2"
        focus: { x: 4, y: 2 }, // "e 3" in "Line 3"
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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
      const selectionState: SelectionState = {
        anchor: { x: 0, y: 1 }, // Start of "Second"
        focus: { x: 6, y: 1 }, // End of "Second"
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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
      const selectionState: SelectionState = {
        anchor: { x: 0, y: 1 }, // Start of line 2
        focus: { x: 1, y: 2 }, // Middle of line 3
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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
      const selectionState: SelectionState = {
        anchor: { x: 4, y: 0 }, // End of "Line1"
        focus: { x: 2, y: 1 }, // Middle of "Line2"
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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
      const selectionState: SelectionState = {
        anchor: { x: 11, y: 0 }, // End of text
        focus: { x: 6, y: 0 }, // Start of "World"
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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

      const selectionState: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 0, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

      expect(text.hasSelection()).toBe(false)
      expect(text.getSelection()).toBe(null)
      expect(text.getSelectedText()).toBe("")
    })

    it("should handle single character selection", () => {
      text = createTextRenderable({
        content: "A",
        selectable: true,
      })

      const selectionState: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 1, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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

      const selectionState: SelectionState = {
        anchor: { x: 5, y: 0 },
        focus: { x: 5, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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

      const selectionState: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 10, y: 0 }, // Beyond text length
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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

      const selectionState: SelectionState = {
        anchor: { x: 6, y: 0 },
        focus: { x: 11, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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

      const selectionState: SelectionState = {
        anchor: { x: 8, y: 0 }, // Start of "Blue"
        focus: { x: 12, y: 0 }, // End of "Blue"
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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
      const selectionState: SelectionState = {
        anchor: { x: 6, y: 0 },
        focus: { x: 11, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)
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
      let selectionState: SelectionState = {
        anchor: { x: 4, y: 0 },
        focus: { x: 9, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)
      expect(text.getSelectedText()).toBe("quick")
      expect(text.getSelection()).toEqual({ start: 4, end: 9 })

      // Second selection: "brown fox"
      selectionState = {
        anchor: { x: 10, y: 0 },
        focus: { x: 19, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)
      expect(text.getSelectedText()).toBe("brown fox")
      expect(text.getSelection()).toEqual({ start: 10, end: 19 })

      // Third selection: "lazy dog"
      selectionState = {
        anchor: { x: 35, y: 0 },
        focus: { x: 43, y: 0 },
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)
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

      const selectionState: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 10, y: 1 }, // Select across line boundary
        isActive: true,
        isSelecting: false,
      }

      text.onSelectionChanged(selectionState)

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
      const startSelection: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 18, y: 0 }, // Select full "Selected 5 chars:"
        isActive: true,
        isSelecting: false,
      }
      statusText.onSelectionChanged(startSelection)

      // Continue selection to the second text
      const continueSelection1: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 7, y: 0 }, // Select full '"Hello"'
        isActive: true,
        isSelecting: false,
      }
      selectionStartText.onSelectionChanged(continueSelection1)

      // Continue to third text (empty) - use same wide bounds
      const continueSelection2: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 18, y: 0 }, // Same wide bounds as first text
        isActive: true,
        isSelecting: false,
      }
      selectionMiddleText.onSelectionChanged(continueSelection2)

      // Continue to fourth text (empty) - use same wide bounds
      const continueSelection3: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 18, y: 0 }, // Same wide bounds as first text
        isActive: true,
        isSelecting: false,
      }
      selectionEndText.onSelectionChanged(continueSelection3)

      // End selection at the last text
      const endSelection: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 25, y: 0 }, // Select full "Selected renderables: 2/5"
        isActive: true,
        isSelecting: false,
      }
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
      const initialSelection: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 50, y: 0 }, // Wide selection covering all
        isActive: true,
        isSelecting: false,
      }

      // Apply the same selection state to all renderables (simulating global selection)
      allRenderables.forEach((renderable) => {
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
      const updatedSelection: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 60, y: 0 }, // Extended to cover new content
        isActive: true,
        isSelecting: false,
      }

      allRenderables.forEach((renderable) => {
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
      const finalSelection: SelectionState = {
        anchor: { x: 0, y: 0 },
        focus: { x: 70, y: 0 }, // Extended further
        isActive: true,
        isSelecting: false,
      }

      allRenderables.forEach((renderable) => {
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
      const crossBoxSelection: SelectionState = {
        anchor: { x: 5, y: -2 }, // Above the box
        focus: { x: 60, y: 15 }, // Below and to the right of the box
        isActive: true,
        isSelecting: false,
      }

      // In a real implementation, the renderer would determine which renderables
      // are covered by this selection and apply appropriate local selections
      allRenderables.forEach((renderable) => {
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
})
