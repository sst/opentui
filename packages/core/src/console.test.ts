import { test, expect, describe, mock, beforeEach } from "bun:test"
import { TerminalConsole, ConsolePosition } from "./console"

interface MockRenderer {
  terminalWidth: number
  terminalHeight: number
  width: number
  height: number
  isRunning: boolean
  widthMethod: string
  requestRender: () => void
  keyInput: {
    on: (event: string, handler: any) => void
    off: (event: string, handler: any) => void
  }
}

describe("TerminalConsole", () => {
  let mockRenderer: MockRenderer
  let terminalConsole: TerminalConsole

  beforeEach(() => {
    mockRenderer = {
      terminalWidth: 100,
      terminalHeight: 30,
      width: 100,
      height: 30,
      isRunning: false,
      widthMethod: "cell",
      requestRender: mock(() => {}),
      keyInput: {
        on: mock(() => {}),
        off: mock(() => {}),
      },
    }
  })

  describe("resize", () => {
    test("should use provided width and height parameters", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      const initialWidth = terminalConsole["consoleWidth"]
      expect(initialWidth).toBe(100)

      terminalConsole.resize(80, 50)

      expect(terminalConsole["consoleWidth"]).toBe(80)
      expect(terminalConsole["consoleHeight"]).toBe(15) // 30% of 50
    })

    test("should apply sizePercent correctly for different positions", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.TOP,
        sizePercent: 40,
      })

      terminalConsole.resize(100, 50)

      expect(terminalConsole["consoleHeight"]).toBe(20) // 40% of 50
      expect(terminalConsole["consoleY"]).toBe(0) // TOP position
    })

    test("should position console correctly for BOTTOM position", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      terminalConsole.resize(100, 50)

      const consoleHeight = terminalConsole["consoleHeight"]
      expect(terminalConsole["consoleY"]).toBe(50 - consoleHeight)
    })

    test("should position console correctly for RIGHT position", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.RIGHT,
        sizePercent: 30,
      })

      terminalConsole.resize(100, 50)

      const consoleWidth = terminalConsole["consoleWidth"]
      expect(terminalConsole["consoleX"]).toBe(100 - consoleWidth)
    })

    test("should enforce minimum dimension of 1", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 5,
      })

      terminalConsole.resize(100, 10)

      expect(terminalConsole["consoleHeight"]).toBeGreaterThanOrEqual(1)
    })
  })

  describe("Console Selection", () => {
    test("should have no selection initially", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      expect(terminalConsole["hasSelection"]()).toBe(false)
      expect(terminalConsole["getSelectedText"]()).toBe("")
    })

    test("should set selection on mouse down in log area", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })
      // Manually set visible state without calling show() to avoid native buffer creation
      terminalConsole["isVisible"] = true

      terminalConsole["_displayLines"] = [
        { text: "Hello World", level: "LOG" as any, indent: false },
        { text: "Second Line", level: "LOG" as any, indent: false },
      ]

      const bounds = terminalConsole.bounds
      terminalConsole.handleMouse(bounds.x + 5, bounds.y + 1, "down", 0)

      expect(terminalConsole["_selectionStart"]).not.toBeNull()
      expect(terminalConsole["_isSelecting"]).toBe(true)
    })

    test("should extend selection on drag", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })
      terminalConsole["isVisible"] = true

      terminalConsole["_displayLines"] = [
        { text: "Hello World", level: "LOG" as any, indent: false },
        { text: "Second Line", level: "LOG" as any, indent: false },
      ]

      const bounds = terminalConsole.bounds
      terminalConsole.handleMouse(bounds.x + 1, bounds.y + 1, "down", 0)
      terminalConsole.handleMouse(bounds.x + 10, bounds.y + 1, "drag", 0)

      expect(terminalConsole["_selectionEnd"]?.col).toBe(9)
    })

    test("should finalize selection on mouse up", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })
      terminalConsole["isVisible"] = true

      terminalConsole["_displayLines"] = [
        { text: "Hello World", level: "LOG" as any, indent: false },
      ]

      const bounds = terminalConsole.bounds
      terminalConsole.handleMouse(bounds.x + 1, bounds.y + 1, "down", 0)
      terminalConsole.handleMouse(bounds.x + 5, bounds.y + 1, "drag", 0)
      terminalConsole.handleMouse(bounds.x + 5, bounds.y + 1, "up", 0)

      expect(terminalConsole["_isSelecting"]).toBe(false)
      expect(terminalConsole["hasSelection"]()).toBe(true)
    })

    test("should normalize reverse selection", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      terminalConsole["_selectionStart"] = { line: 5, col: 10 }
      terminalConsole["_selectionEnd"] = { line: 2, col: 5 }

      const normalized = terminalConsole["normalizeSelection"]()

      expect(normalized?.startLine).toBe(2)
      expect(normalized?.startCol).toBe(5)
      expect(normalized?.endLine).toBe(5)
      expect(normalized?.endCol).toBe(10)
    })

    test("should extract correct text for single-line selection", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      terminalConsole["_displayLines"] = [
        { text: "Hello World Test", level: "LOG" as any, indent: false },
      ]
      terminalConsole["_selectionStart"] = { line: 0, col: 0 }
      terminalConsole["_selectionEnd"] = { line: 0, col: 5 }

      expect(terminalConsole["getSelectedText"]()).toBe("Hello")
    })

    test("should extract correct text for multi-line selection", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      terminalConsole["_displayLines"] = [
        { text: "First Line", level: "LOG" as any, indent: false },
        { text: "Second Line", level: "LOG" as any, indent: false },
        { text: "Third Line", level: "LOG" as any, indent: false },
      ]
      terminalConsole["_selectionStart"] = { line: 0, col: 6 }
      terminalConsole["_selectionEnd"] = { line: 2, col: 5 }

      const text = terminalConsole["getSelectedText"]()
      expect(text).toBe("Line\nSecond Line\nThird")
    })

    test("should clear selection on clearSelection", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      terminalConsole["_selectionStart"] = { line: 0, col: 0 }
      terminalConsole["_selectionEnd"] = { line: 0, col: 5 }
      terminalConsole["_isSelecting"] = true

      terminalConsole["clearSelection"]()

      expect(terminalConsole["_selectionStart"]).toBeNull()
      expect(terminalConsole["_selectionEnd"]).toBeNull()
      expect(terminalConsole["_isSelecting"]).toBe(false)
    })
  })

  describe("Copy Button", () => {
    test("should trigger onCopySelection callback on click when selection exists", () => {
      const onCopy = mock(() => {})
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
        onCopySelection: onCopy,
      })
      terminalConsole["isVisible"] = true
      // Set up copy button bounds manually since we're not calling show()
      terminalConsole["_copyButtonBounds"] = { x: 93, y: 0, width: 6, height: 1 }

      terminalConsole["_displayLines"] = [
        { text: "Hello World", level: "LOG" as any, indent: false },
      ]
      terminalConsole["_selectionStart"] = { line: 0, col: 0 }
      terminalConsole["_selectionEnd"] = { line: 0, col: 5 }

      const bounds = terminalConsole.bounds
      const copyButtonX = bounds.x + terminalConsole["_copyButtonBounds"].x
      terminalConsole.handleMouse(copyButtonX, bounds.y, "down", 0)

      expect(onCopy).toHaveBeenCalledWith("Hello")
    })

    test("should not trigger callback when no selection", () => {
      const onCopy = mock(() => {})
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
        onCopySelection: onCopy,
      })
      terminalConsole["isVisible"] = true
      terminalConsole["_copyButtonBounds"] = { x: 93, y: 0, width: 6, height: 1 }

      const bounds = terminalConsole.bounds
      const copyButtonX = bounds.x + terminalConsole["_copyButtonBounds"].x
      terminalConsole.handleMouse(copyButtonX, bounds.y, "down", 0)

      expect(onCopy).not.toHaveBeenCalled()
    })
  })

  describe("Copy Keyboard Shortcut", () => {
    test("should trigger copy on Ctrl+Shift+C when focused with selection", () => {
      const onCopy = mock(() => {})
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
        onCopySelection: onCopy,
      })

      terminalConsole["_displayLines"] = [
        { text: "Hello World", level: "LOG" as any, indent: false },
      ]
      terminalConsole["_selectionStart"] = { line: 0, col: 0 }
      terminalConsole["_selectionEnd"] = { line: 0, col: 5 }

      terminalConsole["handleKeyPress"]({ name: "c", ctrl: true, shift: true } as any)

      expect(onCopy).toHaveBeenCalledWith("Hello")
    })

    test("should not trigger when no selection", () => {
      const onCopy = mock(() => {})
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
        onCopySelection: onCopy,
      })

      terminalConsole["handleKeyPress"]({ name: "c", ctrl: true, shift: true } as any)

      expect(onCopy).not.toHaveBeenCalled()
    })

    test("should respect custom copyShortcut config", () => {
      const onCopy = mock(() => {})
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
        onCopySelection: onCopy,
        copyShortcut: { key: "y", ctrl: true, shift: false },
      })

      terminalConsole["_displayLines"] = [
        { text: "Test", level: "LOG" as any, indent: false },
      ]
      terminalConsole["_selectionStart"] = { line: 0, col: 0 }
      terminalConsole["_selectionEnd"] = { line: 0, col: 4 }

      terminalConsole["handleKeyPress"]({ name: "c", ctrl: true, shift: true } as any)
      expect(onCopy).not.toHaveBeenCalled()

      terminalConsole["handleKeyPress"]({ name: "y", ctrl: true, shift: false } as any)
      expect(onCopy).toHaveBeenCalledWith("Test")
    })
  })

  describe("Mouse Event Bounds", () => {
    test("should handle mouse events based on console bounds", () => {
      terminalConsole = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })
      terminalConsole["isVisible"] = true

      // Outside bounds
      expect(terminalConsole.handleMouse(0, 0, "down", 0)).toBe(false)

      // Inside bounds
      const bounds = terminalConsole.bounds
      expect(terminalConsole.handleMouse(bounds.x + 1, bounds.y + 1, "down", 0)).toBe(true)
    })
  })
})
