import { test, expect, describe } from "bun:test"
import { createTestRenderer } from "../testing/test-renderer"
import { EventEmitter } from "events"
import { Buffer } from "node:buffer"

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
      const dataStr = data.toString()
      if (dataStr.includes("\x1b]4;0;?")) {
        process.nextTick(() => {
          mockStdin.emit("data", Buffer.from("\x1b]4;0;rgb:0000/0000/0000\x07"))
        })
      } else if (dataStr.includes("\x1b]4;")) {
        process.nextTick(() => {
          for (let i = 0; i < 16; i++) {
            mockStdin.emit("data", Buffer.from(`\x1b]4;${i};rgb:1000/2000/3000\x07`))
          }
        })
      } else if (dataStr.includes("\x1b]10;?")) {
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

    const palette1 = await renderer.getPalette({ timeout: 300 })
    const palette2 = await renderer.getPalette({ timeout: 300 })

    expect(palette1).toBe(palette2)
    expect(palette1).toEqual(palette2)

    renderer.destroy()
  })

  test("getPalette caches correctly with non-256 size parameter", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palette1 = await renderer.getPalette({ size: 16, timeout: 300 })
    const palette2 = await renderer.getPalette({ size: 16, timeout: 300 })

    expect(palette1).toBe(palette2)
    expect(renderer.paletteDetectionStatus).toBe("cached")

    renderer.destroy()
  })

  test("cached palette is returned instantly", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    await renderer.getPalette({ timeout: 300 })
    const writeCountAfterFirst = writes.length

    const start = Date.now()
    await renderer.getPalette({ timeout: 300 })
    const duration = Date.now() - start

    expect(duration).toBeLessThan(50)
    expect(writes.length).toBe(writeCountAfterFirst)

    renderer.destroy()
  })

  test("multiple concurrent calls share same detection", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const [palette1, palette2, palette3] = await Promise.all([
      renderer.getPalette({ timeout: 300 }),
      renderer.getPalette({ timeout: 300 }),
      renderer.getPalette({ timeout: 300 }),
    ])

    expect(palette1).toBe(palette2)
    expect(palette2).toBe(palette3)

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

    expect(writes.length).toBe(writeCountAfterFirst)
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

    renderer.start()
    await new Promise((resolve) => setTimeout(resolve, 10))
    renderer.pause()
    renderer.suspend()
    renderer.resume()
    renderer.stop()

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

    expect(typeof palette === "object" && palette !== null && Array.isArray(palette.palette)).toBe(true)

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
        setImmediate(() => {
          if (dataStr.includes("\x1b]4;0;?")) {
            mockStdin.emit("data", Buffer.from("\x1b]4;0;#000000\x07"))
          }
          if (dataStr.match(/\x1b\]4;\d+;/g)) {
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
    expect(palette.palette[0]).toBe("#000000")
    expect(palette.palette[1]).toBe("#ff0000")
    expect(palette.palette[2]).toBe("#00ff00")
    expect(palette.palette[3]).toBe("#0000ff")

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
    expect(palette.palette[2]).toBe("#808080")

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

    const palettePromise = renderer.getPalette({ timeout: 300 })

    mockStdin.emit("data", Buffer.from("a"))
    mockStdin.emit("data", Buffer.from("b"))
    mockStdin.emit("data", Buffer.from("c"))

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(keysReceived.length).toBeGreaterThanOrEqual(3)

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

    const palette1 = await renderer.getPalette({ timeout: 300 })
    expect(renderer.paletteDetectionStatus).toBe("cached")

    renderer.clearPaletteCache()
    expect(renderer.paletteDetectionStatus).toBe("idle")

    const palette2 = await renderer.getPalette({ timeout: 300 })

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

    expect(renderer.paletteDetectionStatus).toBe("idle")

    const palettePromise = renderer.getPalette({ timeout: 300 })
    expect(renderer.paletteDetectionStatus).toBe("detecting")

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

    renderer.suspend()

    await expect(renderer.getPalette({ timeout: 300 })).rejects.toThrow(
      "Cannot detect palette while renderer is suspended",
    )

    renderer.destroy()
  })

  test("getPalette works after resume", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    renderer.suspend()
    renderer.resume()

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

    await renderer.getPalette({ timeout: 300 })

    renderer.destroy()

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

    const initialListenerCount = mockStdin.listenerCount("data")

    const palettePromise = renderer.getPalette({ timeout: 300 })

    const duringDetectionCount = mockStdin.listenerCount("data")
    expect(duringDetectionCount).toBe(initialListenerCount + 1)

    await palettePromise

    const afterDetectionCount = mockStdin.listenerCount("data")
    expect(afterDetectionCount).toBe(initialListenerCount)

    renderer.destroy()

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
      write: () => true,
    } as any

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

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

    try {
      const palettePromise = renderer.getPalette({ timeout: 300 })
      await palettePromise
    } catch (error) {}

    const listenerCount = mockStdin.listenerCount("data")
    expect(listenerCount).toBeGreaterThan(0)

    renderer.destroy()
  })
})

describe("Palette cache with different sizes", () => {
  test("cache works correctly when requesting size=16 twice", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palette1 = await renderer.getPalette({ size: 16, timeout: 300 })
    const writeCountAfterFirst = writes.length

    expect(renderer.paletteDetectionStatus).toBe("cached")
    expect(palette1.palette.length).toBe(16)

    const start = Date.now()
    const palette2 = await renderer.getPalette({ size: 16, timeout: 300 })
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(50)
    expect(writes.length).toBe(writeCountAfterFirst)
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

    const palette1 = await renderer.getPalette({ size: 16, timeout: 300 })
    const writeCountAfter16 = writes.length

    const palette2 = await renderer.getPalette({ size: 256, timeout: 300 })
    const writeCountAfter256 = writes.length

    expect(writeCountAfter256).toBeGreaterThan(writeCountAfter16)
    expect(palette1).not.toBe(palette2)

    renderer.destroy()
  })

  test("cache persists across multiple identical size requests", async () => {
    const { mockStdin, mockStdout, writes } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const palette1 = await renderer.getPalette({ size: 16, timeout: 300 })
    const writeCountAfterFirst = writes.length

    const palette2 = await renderer.getPalette({ size: 16, timeout: 300 })
    const palette3 = await renderer.getPalette({ size: 16, timeout: 300 })
    const palette4 = await renderer.getPalette({ size: 16, timeout: 300 })

    expect(writes.length).toBe(writeCountAfterFirst)
    expect(palette1).toBe(palette2)
    expect(palette2).toBe(palette3)
    expect(palette3).toBe(palette4)

    renderer.destroy()
  })

  test("cached call is significantly faster than initial detection", async () => {
    const { mockStdin, mockStdout } = createMockStreams()

    const { renderer } = await createTestRenderer({
      stdin: mockStdin,
      stdout: mockStdout,
    })

    const start1 = performance.now()
    await renderer.getPalette({ size: 16, timeout: 300 })
    const elapsed1 = performance.now() - start1

    const start2 = performance.now()
    await renderer.getPalette({ size: 16, timeout: 300 })
    const elapsed2 = performance.now() - start2

    expect(elapsed2).toBeLessThan(10)
    expect(elapsed2).toBeLessThan(elapsed1 / 10)

    renderer.destroy()
  })
})
