import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import { EventEmitter } from "events"
import { Buffer } from "node:buffer"

let renderer: TestRenderer

beforeEach(async () => {
  ;({ renderer } = await createTestRenderer({}))
})

afterEach(() => {
  renderer.destroy()
})

describe("Palette detection and caching", () => {
  test("getPalette returns a palette array", async () => {
    const palette = await renderer.getPalette(100)
    expect(Array.isArray(palette)).toBe(true)
  })

  test("getPalette returns cached palette on subsequent calls", async () => {
    // First call - should detect palette
    const palette1 = await renderer.getPalette(100)

    // Second call - should return cached palette without detection
    const palette2 = await renderer.getPalette(100)

    expect(palette1).toBe(palette2) // Same reference
    expect(palette1).toEqual(palette2) // Same values
  })

  test("cached palette is returned immediately without timeout delay", async () => {
    // First call with short timeout
    const start1 = Date.now()
    await renderer.getPalette(100)
    const duration1 = Date.now() - start1

    // Second call should be instant since it's cached
    const start2 = Date.now()
    await renderer.getPalette(5000) // Even with longer timeout
    const duration2 = Date.now() - start2

    // Second call should be significantly faster (cached)
    expect(duration2).toBeLessThan(50) // Should be nearly instant
  })

  test("palette detector is created only once", async () => {
    // @ts-expect-error - accessing private property for testing
    expect(renderer._paletteDetector).toBeNull()

    await renderer.getPalette(100)
    // @ts-expect-error - accessing private property for testing
    const detector1 = renderer._paletteDetector
    expect(detector1).not.toBeNull()

    await renderer.getPalette(100)
    // @ts-expect-error - accessing private property for testing
    const detector2 = renderer._paletteDetector

    // Should be the same detector instance
    expect(detector1).toBe(detector2)
  })

  test("multiple concurrent getPalette calls return the same result", async () => {
    // Start multiple palette detection requests simultaneously
    const [palette1, palette2, palette3] = await Promise.all([
      renderer.getPalette(100),
      renderer.getPalette(100),
      renderer.getPalette(100),
    ])

    // All should return the same cached palette
    expect(palette1).toBe(palette2)
    expect(palette2).toBe(palette3)
  })

  test("palette cache persists across different timeout values", async () => {
    const palette1 = await renderer.getPalette(100)
    const palette2 = await renderer.getPalette(500)
    const palette3 = await renderer.getPalette(1000)

    expect(palette1).toBe(palette2)
    expect(palette2).toBe(palette3)
  })

  test("palette array has expected length", async () => {
    const palette = await renderer.getPalette(100)

    // Should have at least 16 colors (basic ANSI) or up to 256 (extended)
    expect(palette.length).toBeGreaterThanOrEqual(16)
    expect(palette.length).toBeLessThanOrEqual(256)
  })

  test("palette entries are either hex strings or null", async () => {
    const palette = await renderer.getPalette(100)

    for (const color of palette) {
      if (color !== null) {
        expect(typeof color).toBe("string")
        expect((color as string)).toMatch(/^#[0-9a-f]{6}$/)
      } else {
        expect(color).toBeNull()
      }
    }
  })

  test("cached palette is preserved after renderer operations", async () => {
    const palette1 = await renderer.getPalette(100)

    // Perform some renderer operations
    renderer.requestRender()
    renderer.start()
    renderer.pause()

    const palette2 = await renderer.getPalette(100)

    // Cache should still be valid
    expect(palette1).toBe(palette2)
  })
})

describe("Palette detection with OSC responses", () => {
  test("handles OSC 4 color responses", async () => {
    // Create a new renderer with mocked stdin for this test
    const mockStdin = new EventEmitter() as any
    mockStdin.isTTY = true
    mockStdin.setRawMode = () => {}
    mockStdin.resume = () => {}
    mockStdin.pause = () => {}
    mockStdin.setEncoding = () => {}

    const mockStdout = {
      isTTY: true,
      columns: 80,
      rows: 24,
      write: () => true,
    } as any

    const { renderer: testRenderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // Simulate OSC response after getPalette is called
    const palettePromise = testRenderer.getPalette(200)

    // Simulate terminal sending back OSC 4 response for color 0
    setTimeout(() => {
      mockStdin.emit("data", Buffer.from("\x1b]4;0;rgb:0000/0000/0000\x07"))
    }, 10)

    const palette = await palettePromise

    expect(Array.isArray(palette)).toBe(true)

    testRenderer.destroy()
  })

  test("handles multiple OSC 4 responses", async () => {
    const mockStdin = new EventEmitter() as any
    mockStdin.isTTY = true
    mockStdin.setRawMode = () => {}
    mockStdin.resume = () => {}
    mockStdin.pause = () => {}
    mockStdin.setEncoding = () => {}

    const mockStdout = {
      isTTY: true,
      columns: 80,
      rows: 24,
      write: () => true,
    } as any

    const { renderer: testRenderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palettePromise = testRenderer.getPalette(200)

    // Simulate multiple color responses
    setTimeout(() => {
      mockStdin.emit("data", Buffer.from("\x1b]4;0;rgb:0000/0000/0000\x07"))
      mockStdin.emit("data", Buffer.from("\x1b]4;1;rgb:ffff/0000/0000\x07"))
      mockStdin.emit("data", Buffer.from("\x1b]4;2;rgb:0000/ffff/0000\x07"))
    }, 10)

    const palette = await palettePromise
    expect(palette.length).toBeGreaterThan(0)

    // Verify caching works after OSC responses
    const cachedPalette = await testRenderer.getPalette(100)
    expect(palette).toBe(cachedPalette)

    testRenderer.destroy()
  })

  test("palette detection times out gracefully", async () => {
    // This test should complete even if no OSC responses are received
    const start = Date.now()
    const palette = await renderer.getPalette(100)
    const duration = Date.now() - start

    expect(Array.isArray(palette)).toBe(true)
    expect(duration).toBeLessThan(500) // Should timeout within reasonable time
  })

  test("cached palette is not affected by subsequent timeout changes", async () => {
    const palette1 = await renderer.getPalette(50)

    // Even with a longer timeout, should return cached result immediately
    const start = Date.now()
    const palette2 = await renderer.getPalette(5000)
    const duration = Date.now() - start

    expect(palette1).toBe(palette2)
    expect(duration).toBeLessThan(50) // Should be instant
  })
})

describe("Palette caching across renderer lifecycle", () => {
  test("palette cache survives start/stop cycles", async () => {
    const palette1 = await renderer.getPalette(100)

    renderer.start()
    await new Promise((resolve) => setTimeout(resolve, 10))
    renderer.stop()

    const palette2 = await renderer.getPalette(100)
    expect(palette1).toBe(palette2)
  })

  test("palette cache survives suspend/resume cycles", async () => {
    const palette1 = await renderer.getPalette(100)

    renderer.start()
    renderer.suspend()
    renderer.resume()

    const palette2 = await renderer.getPalette(100)
    expect(palette1).toBe(palette2)
  })

  test("palette cache is available immediately after creation", async () => {
    // Fresh renderer, no previous detection
    const start = Date.now()
    const palette = await renderer.getPalette(100)
    const firstCallDuration = Date.now() - start

    // Second call should be cached and fast
    const start2 = Date.now()
    const cachedPalette = await renderer.getPalette(100)
    const secondCallDuration = Date.now() - start2

    expect(palette).toBe(cachedPalette)
    // Second call should be <= first call (cached should never be slower)
    expect(secondCallDuration).toBeLessThanOrEqual(firstCallDuration)
  })
})

describe("Palette detection edge cases", () => {
  test("handles getPalette with default timeout", async () => {
    const palette = await renderer.getPalette()
    expect(Array.isArray(palette)).toBe(true)

    // Should be cached
    const cached = await renderer.getPalette()
    expect(palette).toBe(cached)
  })

  test("handles getPalette with zero timeout", async () => {
    const palette = await renderer.getPalette(0)
    expect(Array.isArray(palette)).toBe(true)
  })

  test("handles getPalette with very long timeout", async () => {
    const start = Date.now()
    const palette = await renderer.getPalette(10000)
    const duration = Date.now() - start

    expect(Array.isArray(palette)).toBe(true)
    // Should not actually wait the full timeout if already cached or detected
    expect(duration).toBeLessThan(2000)
  })

  test("palette detection creates detector before detection", async () => {
    // @ts-expect-error - accessing private property for testing
    expect(renderer._paletteDetector).toBeNull()

    const palettePromise = renderer.getPalette(100)

    // Detector should be created synchronously
    // @ts-expect-error - accessing private property for testing
    expect(renderer._paletteDetector).not.toBeNull()

    await palettePromise
  })
})

describe("Palette integration with renderer", () => {
  test("getPalette works with different renderer configurations", async () => {
    const configs = [
      { width: 40, height: 10 },
      { width: 120, height: 40 },
      { useMouse: false },
      { exitOnCtrlC: false },
    ]

    for (const config of configs) {
      const { renderer: testRenderer } = await createTestRenderer(config)

      const palette = await testRenderer.getPalette(100)
      expect(Array.isArray(palette)).toBe(true)

      // Verify caching
      const cached = await testRenderer.getPalette(100)
      expect(palette).toBe(cached)

      testRenderer.destroy()
    }
  })

  test("palette detection does not interfere with rendering", async () => {
    renderer.start()

    // Get palette while renderer is running
    const palette = await renderer.getPalette(100)
    expect(Array.isArray(palette)).toBe(true)

    renderer.stop()
  })

  test("palette detection does not interfere with input handling", async () => {
    let keyReceived = false
    renderer.keyInput.once("keypress", () => {
      keyReceived = true
    })

    // Get palette
    const palettePromise = renderer.getPalette(100)

    // Simulate key input
    renderer.stdin.emit("data", Buffer.from("a"))

    await palettePromise

    expect(keyReceived).toBe(true)
  })
})
