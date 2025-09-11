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

    mockKeys.pressKeys([KeyCodes.ENTER, KeyCodes.TAB])

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

    mockKeys.pressKey(KeyCodes.ENTER)
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
    mockKeys.pressKey(KeyCodes.ENTER)

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
    mockRenderer.stdin.write(KeyCodes.ENTER)

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
})
