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

describe("Palette cache bug regression tests", () => {
  test("cache works correctly when requesting size=16 twice", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // First call with size=16
    const palette1 = await renderer.getPalette({ size: 16, timeout: 300 })
    const writeCountAfterFirst = writes.length

    expect(renderer.paletteDetectionStatus).toBe("cached")
    expect(palette1.palette.length).toBe(256) // Always returns 256-element array

    // Second call with size=16 - should use cache
    const start = Date.now()
    const palette2 = await renderer.getPalette({ size: 16, timeout: 300 })
    const elapsed = Date.now() - start

    // Should be instant (cached)
    expect(elapsed).toBeLessThan(50)

    // Should not have sent new queries
    expect(writes.length).toBe(writeCountAfterFirst)

    // Should be exact same object reference
    expect(palette1).toBe(palette2)
    expect(renderer.paletteDetectionStatus).toBe("cached")

    renderer.destroy()
  })

  test("cache is invalidated when requesting different size", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // First call with size=16
    const palette1 = await renderer.getPalette({ size: 16, timeout: 300 })
    const writeCountAfter16 = writes.length

    // Second call with size=256 - should re-detect
    const palette2 = await renderer.getPalette({ size: 256, timeout: 300 })
    const writeCountAfter256 = writes.length

    // Should have sent new queries (cache was invalidated due to different size)
    expect(writeCountAfter256).toBeGreaterThan(writeCountAfter16)

    // Should be different references
    expect(palette1).not.toBe(palette2)

    renderer.destroy()
  })

  test("cache persists across multiple identical size requests", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // First call
    const palette1 = await renderer.getPalette({ size: 16, timeout: 300 })
    const writeCountAfterFirst = writes.length

    // Multiple subsequent calls with same size
    const palette2 = await renderer.getPalette({ size: 16, timeout: 300 })
    const palette3 = await renderer.getPalette({ size: 16, timeout: 300 })
    const palette4 = await renderer.getPalette({ size: 16, timeout: 300 })

    // Should not have sent any new queries
    expect(writes.length).toBe(writeCountAfterFirst)

    // All should be same reference
    expect(palette1).toBe(palette2)
    expect(palette2).toBe(palette3)
    expect(palette3).toBe(palette4)

    renderer.destroy()
  })

  test("timing: cached call is significantly faster than initial detection", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    // First call - actual detection
    const start1 = performance.now()
    await renderer.getPalette({ size: 16, timeout: 300 })
    const elapsed1 = performance.now() - start1

    // Second call - from cache
    const start2 = performance.now()
    await renderer.getPalette({ size: 16, timeout: 300 })
    const elapsed2 = performance.now() - start2

    // Cached call should be much faster (< 10ms)
    expect(elapsed2).toBeLessThan(10)

    // Initial detection takes longer (at least a few ms for async operations)
    // Cached call should be at least 10x faster
    expect(elapsed2).toBeLessThan(elapsed1 / 10)

    renderer.destroy()
  })
})
