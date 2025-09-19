import { describe, test, expect } from "bun:test"
import { createMockMouse, MouseButtons } from "./mock-mouse"
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

  getLastEmittedData(): string {
    return this.emittedData.length > 0 ? this.emittedData[this.emittedData.length - 1].toString() : ""
  }
}

describe("mock-mouse", () => {
  test("click generates correct mouse events", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.click(10, 5)

    expect(mockRenderer.emittedData).toHaveLength(2)
    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<0;11;6M") // down event
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<0;11;6m") // up event
  })

  test("click with different button", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.click(10, 5, MouseButtons.RIGHT)

    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<2;11;6M") // right button down
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<2;11;6m") // right button up
  })

  test("click with modifiers", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.click(10, 5, MouseButtons.LEFT, { modifiers: { ctrl: true, shift: true } })

    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<20;11;6M") // 0 + 16 (ctrl) + 4 (shift) = 20
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<20;11;6m")
  })

  test("moveTo generates move event", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.moveTo(15, 8)

    expect(mockRenderer.getEmittedData()).toBe("\x1b[<35;16;9m") // 32 (motion) + 3 (button 3 for move) = 35
  })

  test("moveTo with modifiers", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.moveTo(15, 8, { modifiers: { alt: true } })

    expect(mockRenderer.getEmittedData()).toBe("\x1b[<43;16;9m") // 32 + 3 + 8 (alt) = 43
  })

  test("doubleClick generates four events", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.doubleClick(10, 5)

    expect(mockRenderer.emittedData).toHaveLength(4)
    // Two down events and two up events
    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<0;11;6M")
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<0;11;6m")
    expect(mockRenderer.emittedData[2].toString()).toBe("\x1b[<0;11;6M")
    expect(mockRenderer.emittedData[3].toString()).toBe("\x1b[<0;11;6m")
  })

  test("pressDown and release work separately", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.pressDown(10, 5, MouseButtons.MIDDLE)
    await mockMouse.release(10, 5, MouseButtons.MIDDLE)

    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<1;11;6M") // middle button down
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<1;11;6m") // middle button up
  })

  test("drag generates drag events", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.drag(10, 5, 20, 10)

    // Should have: down, several drag events, up
    expect(mockRenderer.emittedData.length).toBeGreaterThan(3)
    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<0;11;6M") // initial down

    // Check that drag events have the motion flag (32)
    for (let i = 1; i < mockRenderer.emittedData.length - 1; i++) {
      const event = mockRenderer.emittedData[i].toString()
      expect(event).toMatch(/\x1b\[<32;\d+;\d+m/) // Should have motion flag (32) and release (m)
    }

    const lastEvent = mockRenderer.emittedData[mockRenderer.emittedData.length - 1].toString()
    expect(lastEvent).toBe("\x1b[<0;21;11m") // final up
  })

  test("scroll events work", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.scroll(10, 5, "up")
    await mockMouse.scroll(10, 5, "down")

    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<64;11;6M") // wheel up (64 = scroll flag)
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<65;11;6M") // wheel down (64 + 1)
  })

  test("scroll with modifiers", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.scroll(10, 5, "left", { modifiers: { shift: true } })

    expect(mockRenderer.getEmittedData()).toBe("\x1b[<70;11;6M") // 66 (wheel left) + 4 (shift) = 70
  })

  test("moveTo becomes drag when button is pressed", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.pressDown(5, 5)
    await mockMouse.moveTo(15, 8)

    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<0;6;6M") // down
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<32;16;9m") // drag (32 = motion flag, no button 3)
  })

  test("getCurrentPosition tracks position", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    expect(mockMouse.getCurrentPosition()).toEqual({ x: 0, y: 0 })

    await mockMouse.moveTo(10, 5)
    expect(mockMouse.getCurrentPosition()).toEqual({ x: 10, y: 5 })

    await mockMouse.click(15, 8)
    expect(mockMouse.getCurrentPosition()).toEqual({ x: 15, y: 8 })
  })

  test("getPressedButtons tracks button state", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    expect(mockMouse.getPressedButtons()).toEqual([])

    await mockMouse.pressDown(10, 5, MouseButtons.LEFT)
    expect(mockMouse.getPressedButtons()).toEqual([MouseButtons.LEFT])

    await mockMouse.pressDown(10, 5, MouseButtons.RIGHT)
    expect(mockMouse.getPressedButtons()).toEqual([MouseButtons.LEFT, MouseButtons.RIGHT])

    await mockMouse.release(10, 5, MouseButtons.LEFT)
    expect(mockMouse.getPressedButtons()).toEqual([MouseButtons.RIGHT])

    await mockMouse.release(10, 5, MouseButtons.RIGHT)
    expect(mockMouse.getPressedButtons()).toEqual([])
  })

  test("delay works correctly", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    const startTime = Date.now()
    await mockMouse.click(10, 5, MouseButtons.LEFT, { delayMs: 20 })

    expect(Date.now() - startTime).toBeGreaterThanOrEqual(15) // Allow some tolerance
  })

  test("coordinates are 1-based in ANSI output", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.click(0, 0) // 0-based coordinates

    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<0;1;1M") // 1-based in ANSI
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<0;1;1m")
  })

  test("all scroll directions work", async () => {
    const mockRenderer = new MockRenderer()
    const mockMouse = createMockMouse(mockRenderer as any)

    await mockMouse.scroll(10, 5, "up")
    await mockMouse.scroll(10, 5, "down")
    await mockMouse.scroll(10, 5, "left")
    await mockMouse.scroll(10, 5, "right")

    expect(mockRenderer.emittedData[0].toString()).toBe("\x1b[<64;11;6M") // up
    expect(mockRenderer.emittedData[1].toString()).toBe("\x1b[<65;11;6M") // down
    expect(mockRenderer.emittedData[2].toString()).toBe("\x1b[<66;11;6M") // left
    expect(mockRenderer.emittedData[3].toString()).toBe("\x1b[<67;11;6M") // right
  })
})
