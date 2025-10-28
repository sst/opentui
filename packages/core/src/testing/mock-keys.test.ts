import { describe, test, expect } from "bun:test"
import { createMockKeys, KeyCodes } from "./mock-keys"
import { PassThrough } from "stream"

class MockRenderer {
  public stdin: PassThrough
  public emittedData: Buffer[] = []

  constructor() {
    this.stdin = new PassThrough()

    this.stdin.on("data", (chunk: Buffer) => {
      this.emittedData.push(chunk)
    })
  }

  getEmittedData(): string {
    return Buffer.concat(this.emittedData).toString()
  }
}

describe("mock-keys", () => {
  test("pressKeys with string keys", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKeys(["h", "e", "l", "l", "o"])

    expect(mockRenderer.getEmittedData()).toBe("hello")
  })

  test("pressKeys with KeyCodes", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKeys([KeyCodes.RETURN, KeyCodes.TAB])

    expect(mockRenderer.getEmittedData()).toBe("\r\t")
  })

  test("pressKey with string", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("a")

    expect(mockRenderer.getEmittedData()).toBe("a")
  })

  test("pressKey with KeyCode", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.ESCAPE)

    expect(mockRenderer.getEmittedData()).toBe("\x1b")
  })

  test("typeText", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.typeText("hello world")

    expect(mockRenderer.getEmittedData()).toBe("hello world")
  })

  test("convenience methods", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressEnter()
    mockKeys.pressEscape()
    mockKeys.pressTab()
    mockKeys.pressBackspace()

    expect(mockRenderer.getEmittedData()).toBe("\r\x1b\t\b")
  })

  test("pressArrow", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressArrow("up")
    mockKeys.pressArrow("down")
    mockKeys.pressArrow("left")
    mockKeys.pressArrow("right")

    expect(mockRenderer.getEmittedData()).toBe("\x1b[A\x1b[B\x1b[D\x1b[C")
  })

  test("pressCtrlC", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressCtrlC()

    expect(mockRenderer.getEmittedData()).toBe("\x03")
  })

  test("arbitrary string keys work", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("x")
    mockKeys.pressKey("y")
    mockKeys.pressKey("z")

    expect(mockRenderer.getEmittedData()).toBe("xyz")
  })

  test("KeyCodes enum values work", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.RETURN)
    mockKeys.pressKey(KeyCodes.TAB)
    mockKeys.pressKey(KeyCodes.ESCAPE)

    expect(mockRenderer.getEmittedData()).toBe("\r\t\x1b")
  })

  test("data events are properly emitted", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    const receivedData: Buffer[] = []
    mockRenderer.stdin.on("data", (chunk: Buffer) => {
      receivedData.push(chunk)
    })

    mockKeys.pressKey("a")
    mockKeys.pressKey(KeyCodes.RETURN)

    expect(receivedData).toHaveLength(2)
    expect(receivedData[0].toString()).toBe("a")
    expect(receivedData[1].toString()).toBe("\r")
  })

  test("multiple data events accumulate correctly", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    const receivedData: string[] = []
    mockRenderer.stdin.on("data", (chunk: Buffer) => {
      receivedData.push(chunk.toString())
    })

    mockKeys.typeText("hello")
    mockKeys.pressEnter()

    expect(receivedData).toEqual(["h", "e", "l", "l", "o", "\r"])
  })

  test("stream write method emits data events correctly", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    const emittedChunks: Buffer[] = []
    mockRenderer.stdin.on("data", (chunk: Buffer) => {
      emittedChunks.push(chunk)
    })

    // Directly test the stream write method that mock-keys uses
    mockRenderer.stdin.write("test")
    mockRenderer.stdin.write(KeyCodes.RETURN)

    expect(emittedChunks).toHaveLength(2)
    expect(emittedChunks[0].toString()).toBe("test")
    expect(emittedChunks[1].toString()).toBe("\r")
  })

  test("pressKeys with delay works", async () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    const timestamps: number[] = []
    mockRenderer.stdin.on("data", () => {
      timestamps.push(Date.now())
    })

    const startTime = Date.now()
    await mockKeys.pressKeys(["a", "b"], 10) // 10ms delay between keys

    expect(timestamps).toHaveLength(2)
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(8) // Allow some tolerance
    expect(timestamps[1] - timestamps[0]).toBeLessThan(20)
  })

  test("pressKey with shift modifier", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.ARROW_RIGHT, { shift: true })

    // Arrow right with shift: \x1b[1;2C
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;2C")
  })

  test("pressKey with ctrl modifier", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.ARROW_LEFT, { ctrl: true })

    // Arrow left with ctrl: \x1b[1;5D (1 base + 4 ctrl = 5)
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;5D")
  })

  test("pressKey with shift+ctrl modifiers", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.ARROW_UP, { shift: true, ctrl: true })

    // Arrow up with shift+ctrl: \x1b[1;6A (1 base + 1 shift + 4 ctrl = 6)
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;6A")
  })

  test("pressKey with meta modifier", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.ARROW_DOWN, { meta: true })

    // Arrow down with meta: \x1b[1;3B (1 base + 2 meta = 3)
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;3B")
  })

  test("pressArrow with shift modifier", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressArrow("right", { shift: true })

    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;2C")
  })

  test("pressArrow without modifiers still works", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressArrow("left")

    expect(mockRenderer.getEmittedData()).toBe("\x1b[D")
  })

  test("pressKey with modifiers on HOME key", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.HOME, { shift: true })

    // HOME with shift: \x1b[1;2H
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;2H")
  })

  test("pressKey with modifiers on END key", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.END, { shift: true })

    // END with shift: \x1b[1;2F
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;2F")
  })

  test("pressKey with meta on regular character", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("a", { meta: true })

    // Meta+a: \x1ba (escape + a)
    expect(mockRenderer.getEmittedData()).toBe("\x1ba")
  })

  test("pressKey with meta+shift on character", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("a", { meta: true, shift: true })

    // Meta+Shift+a: \x1bA (escape + uppercase A)
    expect(mockRenderer.getEmittedData()).toBe("\x1bA")
  })

  test("pressKey with meta+ctrl on arrow", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.ARROW_RIGHT, { meta: true, ctrl: true })

    // Arrow right with meta+ctrl: \x1b[1;7C (1 base + 2 meta + 4 ctrl = 7)
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;7C")
  })

  test("pressKey with meta+shift+ctrl on arrow", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey(KeyCodes.ARROW_UP, { meta: true, shift: true, ctrl: true })

    // Arrow up with all modifiers: \x1b[1;8A (1 base + 1 shift + 2 meta + 4 ctrl = 8)
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;8A")
  })

  test("pressArrow with meta modifier", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressArrow("left", { meta: true })

    // Arrow left with meta: \x1b[1;3D
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;3D")
  })

  test("pressArrow with meta+shift modifiers", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressArrow("down", { meta: true, shift: true })

    // Arrow down with meta+shift: \x1b[1;4B (1 base + 1 shift + 2 meta = 4)
    expect(mockRenderer.getEmittedData()).toBe("\x1b[1;4B")
  })

  test("meta modifier produces escape sequences", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("a", { meta: true })
    mockKeys.pressKey("z", { meta: true })

    expect(mockRenderer.getEmittedData()).toBe("\x1ba\x1bz")
  })

  test("pressEnter with modifiers", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressEnter({ meta: true })

    expect(mockRenderer.getEmittedData()).toBe("\x1b\r")
  })

  test("pressTab with shift modifier", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressTab({ shift: true })

    expect(mockRenderer.getEmittedData()).toBe("\t")
  })

  test("pressEscape with ctrl modifier", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressEscape({ ctrl: true })

    expect(mockRenderer.getEmittedData()).toBe("\x1b")
  })

  test("pressBackspace with meta modifier", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressBackspace({ meta: true })

    expect(mockRenderer.getEmittedData()).toBe("\x1b\b")
  })

  test("pressKey with ctrl on letter produces control code", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("a", { ctrl: true })
    mockKeys.pressKey("z", { ctrl: true })

    expect(mockRenderer.getEmittedData()).toBe("\x01\x1a")
  })

  test("pressKey with ctrl on uppercase letter", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("A", { ctrl: true })

    expect(mockRenderer.getEmittedData()).toBe("\x01")
  })

  test("pressKey with ctrl+meta combination", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("a", { ctrl: true, meta: true })

    expect(mockRenderer.getEmittedData()).toBe("\x1b\x01")
  })

  test("ctrl modifier produces control codes", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("a", { ctrl: true })
    mockKeys.pressKey("c", { ctrl: true })
    mockKeys.pressKey("d", { ctrl: true })

    expect(mockRenderer.getEmittedData()).toBe("\x01\x03\x04")
  })

  test("meta modifier produces escape sequences", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    mockKeys.pressKey("a", { meta: true })
    mockKeys.pressKey("z", { meta: true })

    expect(mockRenderer.getEmittedData()).toBe("\x1ba\x1bz")
  })

  test("all CTRL_* letters produce correct control codes", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)

    const letters = "abcdefghijklmnopqrstuvwxyz"
    for (const letter of letters) {
      mockKeys.pressKey(letter, { ctrl: true })
    }

    const expected = letters
      .split("")
      .map((c) => String.fromCharCode(c.charCodeAt(0) - 96))
      .join("")
    expect(mockRenderer.getEmittedData()).toBe(expected)
  })

  test("pressKey with ctrl modifier produces control code", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)
    mockKeys.pressKey("c", { ctrl: true })

    expect(mockRenderer.getEmittedData()).toBe("\x03")
  })

  test("pressKey with meta modifier on letters produces escape sequences", () => {
    const mockRenderer = new MockRenderer()
    const mockKeys = createMockKeys(mockRenderer as any)
    mockKeys.pressKey("x", { meta: true })

    expect(mockRenderer.getEmittedData()).toBe("\x1bx")
  })
})
