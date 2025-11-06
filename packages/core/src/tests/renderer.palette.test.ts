import { test, expect, describe } from "bun:test"
import { createTestRenderer } from "../testing/test-renderer"
import { EventEmitter } from "events"
import { Buffer } from "node:buffer"

// Helper to create mock stdin/stdout for palette testing
function createMockStreams() {
  const mockStdin = new EventEmitter() as any
  mockStdin.isTTY = true
  mockStdin.setRawMode = () => {}
  mockStdin.resume = () => {}
  mockStdin.pause = () => {}
  mockStdin.setEncoding = () => {}

  const writes: string[] = []
  const mockStdout = {
    isTTY: true,
    columns: 80,
    rows: 24,
      write: (data: string | Buffer) => {
      writes.push(data.toString())
      // Auto-respond to OSC queries immediately
      const dataStr = data.toString()
      if (dataStr.includes("\x1b]4;0;?")) {
        // OSC support check
        process.nextTick(() => {
          mockStdin.emit("data", Buffer.from("\x1b]4;0;rgb:0000/0000/0000\x07"))
        })
      } else if (dataStr.includes("\x1b]4;")) {
        // Palette queries - respond to each
        process.nextTick(() => {
          for (let i = 0; i < 16; i++) {
            mockStdin.emit("data", Buffer.from(`\x1b]4;${i};rgb:1000/2000/3000\x07`))
          }
        })
      } else if (dataStr.includes("\x1b]10;?")) {
        // Special color queries
        process.nextTick(() => {
          mockStdin.emit("data", Buffer.from("\x1b]10;#ffffff\x07"))
          mockStdin.emit("data", Buffer.from("\x1b]11;#000000\x07"))
          mockStdin.emit("data", Buffer.from("\x1b]12;#00ff00\x07"))
        })
      }
      return true
    },
  } as any

  return { mockStdin, mockStdout, writes }
}

describe("Palette caching behavior", () => {
  test("getPalette returns cached palette on subsequent calls", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // First call - triggers detection
    const palette1 = await renderer.getPalette({ timeout: 300 })

    // Second call - should return cached palette
    const palette2 = await renderer.getPalette({ timeout: 300 })

    expect(palette1).toBe(palette2) // Same reference
    expect(palette1).toEqual(palette2) // Same values

    renderer.destroy()
  })

  test("cached palette is returned instantly", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // First call
    await renderer.getPalette({ timeout: 300 })
    const writeCountAfterFirst = writes.length

    // Second call should not trigger new writes
    const start = Date.now()
    await renderer.getPalette({ timeout: 300 })
    const duration = Date.now() - start

    // Should be instant (cached)
    expect(duration).toBeLessThan(50)

    // Should not have sent new queries
    expect(writes.length).toBe(writeCountAfterFirst)

    renderer.destroy()
  })

  test("multiple concurrent calls share same detection", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // Start three concurrent getPalette calls
    const [palette1, palette2, palette3] = await Promise.all([
      renderer.getPalette({ timeout: 300 }),
      renderer.getPalette({ timeout: 300 }),
      renderer.getPalette({ timeout: 300 }),
    ])

    // All should be the same reference
    expect(palette1).toBe(palette2)
    expect(palette2).toBe(palette3)

    // Should only have queried once or twice (support check + queries)
    const oscSupportChecks = writes.filter((w) => w.includes("\x1b]4;0;?"))
    expect(oscSupportChecks.length).toBeLessThanOrEqual(2)

    renderer.destroy()
  })

  test("palette detector created only once", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // @ts-expect-error - accessing private property for testing
    expect(renderer._paletteDetector).toBeNull()

    await renderer.getPalette({ timeout: 300 })

    // @ts-expect-error - accessing private property for testing
    const detector1 = renderer._paletteDetector
    expect(detector1).not.toBeNull()

    await renderer.getPalette({ timeout: 300 })

    // @ts-expect-error - accessing private property for testing
    const detector2 = renderer._paletteDetector

    // Should be same instance
    expect(detector1).toBe(detector2)

    renderer.destroy()
  })

  test("cache persists with different timeout values", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palette1 = await renderer.getPalette({ timeout: 100 })
    const writeCountAfterFirst = writes.length

    const palette2 = await renderer.getPalette({ timeout: 5000 })

    // Should not send new queries
    expect(writes.length).toBe(writeCountAfterFirst)

    // Should be same reference
    expect(palette1).toBe(palette2)

    renderer.destroy()
  })

  test("cache persists across renderer lifecycle", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palette1 = await renderer.getPalette({ timeout: 300 })

    // Lifecycle operations
    renderer.start()
    await new Promise((resolve) => setTimeout(resolve, 10))
    renderer.pause()
    renderer.suspend()
    renderer.resume()
    renderer.stop()

    // Should still have cached palette
    const palette2 = await renderer.getPalette({ timeout: 100 })
    expect(palette1).toBe(palette2)

    renderer.destroy()
  })
})

describe("Palette detection with non-TTY", () => {
  test("handles non-TTY streams gracefully", async () => {
    const mockStdin = new EventEmitter() as any
    mockStdin.isTTY = false
    mockStdin.setRawMode = () => {}
    mockStdin.resume = () => {}
    mockStdin.pause = () => {}
    mockStdin.setEncoding = () => {}

    const mockStdout = {
      isTTY: false,
      columns: 80,
      rows: 24,
      write: () => true,
    } as any

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palette = await renderer.getPalette({ timeout: 100 })

    // Should return array (all null when not a TTY)
    expect(typeof palette === "object" && palette !== null && Array.isArray(palette.palette)).toBe(true)

    // Cache should still work
    const cached = await renderer.getPalette({ timeout: 100 })
    expect(palette).toBe(cached)

    renderer.destroy()
  })
})

describe("Palette detection with OSC responses", () => {
  test("detects colors from OSC responses", async () => {
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
      write: (data: string | Buffer) => {
        const dataStr = data.toString()
        // Respond on next tick to allow listener setup
        setImmediate(() => {
          if (dataStr.includes("\x1b]4;0;?")) {
            // OSC support check
            mockStdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
          }
          // Check if this is a palette query (has multiple color indices)
          if (dataStr.match(/\x1b\]4;\d+;/g)) {
            // Send specific test colors for all detected indices
            mockStdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
            mockStdin.emit("data", Buffer.from("\x1b]4;1;#ff0000\x07"))
            mockStdin.emit("data", Buffer.from("\x1b]4;2;#00ff00\x07"))
            mockStdin.emit("data", Buffer.from("\x1b]4;3;#0000ff\x07"))
            for (let i = 4; i < 256; i++) {
              mockStdin.emit("data", Buffer.from(`\x1b]4;${i};#808080\x07`))
            }
          }
        })
        return true
      },
    } as any

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palette = await renderer.getPalette({ timeout: 300 })

    expect(typeof palette === "object" && palette !== null && Array.isArray(palette.palette)).toBe(true)
    expect(palette.palette.length).toBeGreaterThanOrEqual(16)

    // Check specific colors were detected
    expect(palette.palette[0]).toBe("#000000")
    expect(palette.palette[1]).toBe("#ff0000")
    expect(palette.palette[2]).toBe("#00ff00")
    expect(palette.palette[3]).toBe("#0000ff")

    // Verify caching
    const cached = await renderer.getPalette({ timeout: 100 })
    expect(palette).toBe(cached)

    renderer.destroy()
  })

  test("handles RGB format responses", async () => {
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
      write: (data: string | Buffer) => {
        const dataStr = data.toString()
        setImmediate(() => {
          if (dataStr.includes("\x1b]4;0;?")) {
            mockStdin.emit("data", Buffer.from("\x1b]4;0;rgb:0000/0000/0000\x07"))
          }
          if (dataStr.match(/\x1b\]4;\d+;/g)) {
            mockStdin.emit("data", Buffer.from("\x1b]4;0;rgb:0000/0000/0000\x07"))
            mockStdin.emit("data", Buffer.from("\x1b]4;1;rgb:ffff/0000/0000\x07"))
            mockStdin.emit("data", Buffer.from("\x1b]4;2;rgb:8000/8000/8000\x07"))
            for (let i = 3; i < 256; i++) {
              mockStdin.emit("data", Buffer.from(`\x1b]4;${i};rgb:1111/1111/1111\x07`))
            }
          }
        })
        return true
      },
    } as any

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palette = await renderer.getPalette({ timeout: 300 })

    expect(palette.palette[0]).toBe("#000000")
    expect(palette.palette[1]).toBe("#ff0000")
    expect(palette.palette[2]).toBe("#808080") // 8000 hex should map to 80 in 8-bit

    renderer.destroy()
  })
})

describe("Palette integration tests", () => {
  test("palette detection does not interfere with input handling", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const keysReceived: string[] = []
    renderer.keyInput.on("keypress", (event) => {
      keysReceived.push(event.name || "unknown")
    })

    // Start palette detection (does NOT block stdin listener)
    const palettePromise = renderer.getPalette({ timeout: 300 })

    // Send key input while detection is active - should be processed immediately
    // The palette detector only looks for OSC responses and ignores other input
    mockStdin.emit("data", Buffer.from("a"))
    mockStdin.emit("data", Buffer.from("b"))
    mockStdin.emit("data", Buffer.from("c"))

    // Give event loop time to process events
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Keys should have been received (not blocked by palette detection)
    // Note: May receive more than 3 due to OSC responses also being processed as input
    expect(keysReceived.length).toBeGreaterThanOrEqual(3)

    // Wait for palette detection to complete
    await palettePromise

    renderer.destroy()
  })

  test("getPalette works with different renderer configurations", async () => {
    const configs = [{ width: 40, height: 10 }, { width: 120, height: 40 }, { useMouse: false }]

    for (const config of configs) {
      const { mockStdin, mockStdout } = createMockStreams()

      const { renderer: testRenderer } = await createTestRenderer({
        ...config,
        stdin: mockStdin,
        stdout: mockStdout,
      })

      const palette = await testRenderer.getPalette({ timeout: 300 })
      expect(typeof palette === "object" && palette !== null && Array.isArray(palette.palette)).toBe(true)

      // Verify caching
      const cached = await testRenderer.getPalette({ timeout: 100 })
      expect(palette).toBe(cached)

      testRenderer.destroy()
    }
  })
})

describe("Palette cache invalidation", () => {
  test("clearPaletteCache invalidates cache", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // First detection
    const palette1 = await renderer.getPalette({ timeout: 300 })
    expect(renderer.paletteDetectionStatus).toBe("cached")

    // Clear cache
    renderer.clearPaletteCache()
    expect(renderer.paletteDetectionStatus).toBe("idle")

    // Second detection - should re-detect
    const palette2 = await renderer.getPalette({ timeout: 300 })

    // Should be different references (not same cached object)
    expect(palette1).not.toBe(palette2)
    expect(renderer.paletteDetectionStatus).toBe("cached")

    renderer.destroy()
  })

  test("paletteDetectionStatus tracks detection lifecycle", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // Initial state
    expect(renderer.paletteDetectionStatus).toBe("idle")

    // Start detection
    const palettePromise = renderer.getPalette({ timeout: 300 })
    expect(renderer.paletteDetectionStatus).toBe("detecting")

    // Wait for completion
    await palettePromise
    expect(renderer.paletteDetectionStatus).toBe("cached")

    renderer.destroy()
  })
})

describe("Palette detection with suspended renderer", () => {
  test("getPalette throws error when renderer is suspended", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // Suspend the renderer
    renderer.suspend()

    // Should throw
    await expect(renderer.getPalette({ timeout: 300 })).rejects.toThrow("Cannot detect palette while renderer is suspended")

    renderer.destroy()
  })

  test("getPalette works after resume", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // Suspend then resume
    renderer.suspend()
    renderer.resume()

    // Should work now
    const palette = await renderer.getPalette({ timeout: 300 })
    expect(typeof palette === "object" && palette !== null && Array.isArray(palette.palette)).toBe(true)

    renderer.destroy()
  })
})

describe("Palette detector cleanup", () => {
  test("destroy cleans up palette detector", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // Complete detection first
    await renderer.getPalette({ timeout: 300 })

    // Now destroy
    renderer.destroy()

    // Verify internal state is cleared
    // @ts-expect-error - accessing private property for testing
    expect(renderer._paletteDetector).toBeNull()
    // @ts-expect-error - accessing private property for testing
    expect(renderer._paletteDetectionPromise).toBeNull()
    // @ts-expect-error - accessing private property for testing
    expect(renderer._cachedPalette).toBeNull()
  })

  test("multiple destroy calls don't cause errors", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    await renderer.getPalette({ timeout: 300 })

    // Multiple destroys should be safe
    expect(() => {
      renderer.destroy()
      renderer.destroy()
      renderer.destroy()
    }).not.toThrow()
  })

  test("cleanup removes all palette detector listeners from stdin", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // Count initial listeners
    const initialListenerCount = mockStdin.listenerCount("data")

    // Start detection - palette detector adds its own listener
    const palettePromise = renderer.getPalette({ timeout: 300 })

    // During detection, there should be one extra listener (the palette detector)
    const duringDetectionCount = mockStdin.listenerCount("data")
    expect(duringDetectionCount).toBe(initialListenerCount + 1)

    // Wait for completion
    await palettePromise

    // After completion, palette detector's listener should be cleaned up
    const afterDetectionCount = mockStdin.listenerCount("data")
    expect(afterDetectionCount).toBe(initialListenerCount)

    renderer.destroy()

    // After destroy, all listeners should be cleaned up
    const afterDestroyCount = mockStdin.listenerCount("data")
    expect(afterDestroyCount).toBe(0)
  })
})

describe("Palette detection error handling", () => {
  test("handles timeout gracefully", async () => {
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
      write: () => true, // Never respond
    } as any

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // Should timeout and return array with nulls
    const palette = await renderer.getPalette({ timeout: 100 })
    expect(typeof palette === "object" && palette !== null && Array.isArray(palette.palette)).toBe(true)
    expect(palette.palette.every((c) => c === null)).toBe(true)

    renderer.destroy()
  })

  test("handles stdin listener restoration on error", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    let errorThrown = false
    let listenerRestored = false

    // Mock an error during detection by checking listener count after
    try {
      const palettePromise = renderer.getPalette({ timeout: 300 })
      await palettePromise
    } catch (error) {
      errorThrown = true
    }

    // Listener should be restored even if there was an error
    const listenerCount = mockStdin.listenerCount("data")
    listenerRestored = listenerCount > 0

    expect(listenerRestored).toBe(true)

    renderer.destroy()
  })
})
