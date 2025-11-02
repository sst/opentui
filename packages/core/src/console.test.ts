import { test, expect, describe, mock, beforeEach } from "bun:test"
import { TerminalConsole, ConsolePosition } from "./console"

interface MockRenderer {
  terminalWidth: number
  terminalHeight: number
  isRunning: boolean
  widthMethod: string
  requestRender: () => void
}

describe("TerminalConsole", () => {
  let mockRenderer: MockRenderer
  let console: TerminalConsole

  beforeEach(() => {
    mockRenderer = {
      terminalWidth: 100,
      terminalHeight: 30,
      isRunning: false,
      widthMethod: "cell",
      requestRender: mock(() => {}),
    }
  })

  describe("resize", () => {
    test("should use provided width and height parameters", () => {
      console = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      const initialWidth = console["consoleWidth"]
      expect(initialWidth).toBe(100)

      console.resize(80, 50)

      expect(console["consoleWidth"]).toBe(80)
      expect(console["consoleHeight"]).toBe(15) // 30% of 50
    })

    test("should apply sizePercent correctly for different positions", () => {
      console = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.TOP,
        sizePercent: 40,
      })

      console.resize(100, 50)

      expect(console["consoleHeight"]).toBe(20) // 40% of 50
      expect(console["consoleY"]).toBe(0) // TOP position
    })

    test("should position console correctly for BOTTOM position", () => {
      console = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 30,
      })

      console.resize(100, 50)

      const consoleHeight = console["consoleHeight"]
      expect(console["consoleY"]).toBe(50 - consoleHeight)
    })

    test("should position console correctly for RIGHT position", () => {
      console = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.RIGHT,
        sizePercent: 30,
      })

      console.resize(100, 50)

      const consoleWidth = console["consoleWidth"]
      expect(console["consoleX"]).toBe(100 - consoleWidth)
    })

    test("should enforce minimum dimension of 1", () => {
      console = new TerminalConsole(mockRenderer as any, {
        position: ConsolePosition.BOTTOM,
        sizePercent: 5,
      })

      console.resize(100, 10)

      expect(console["consoleHeight"]).toBeGreaterThanOrEqual(1)
    })
  })
})
