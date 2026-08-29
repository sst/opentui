import { describe, expect, test } from "bun:test"
import { OptimizedBuffer } from "../buffer.js"
import { ImageError, NativeImagePool } from "../image.js"
import { resolveRenderLib } from "../zig.js"

describe("NativeImagePool", () => {
  test("publishes new immutable handles and reuses a bounded number of pixel allocations", () => {
    const pool = new NativeImagePool({ width: 64, height: 64, capacity: 2 })
    const pixels = new Uint8Array(64 * 64 * 4).fill(255)
    const first = pool.publishRgba(pixels)!
    const retained = first.retain()
    first.dispose()
    pixels.fill(42)
    const second = pool.publishRgba(pixels)!
    const lib = resolveRenderLib()
    const allocated = lib.getAllocatorStats().activeAllocations
    try {
      for (let index = 0; index < 100; index++) expect(pool.publishRgba(pixels)).toBeNull()
      expect(lib.getAllocatorStats().activeAllocations).toBe(allocated)
      expect(retained.raw().data[0]).toBe(255)
      expect(second.raw().data[0]).toBe(42)
      const previousHandle = second.ptr
      second.dispose()

      for (let index = 0; index < 100; index++) {
        pixels.fill(index)
        const frame = pool.publishRgba(pixels)!
        try {
          expect(frame.ptr).not.toBe(previousHandle)
          expect(frame.raw().data[0]).toBe(index)
          expect(frame.info().hasAlpha).toBe(true)
          expect(lib.getAllocatorStats().activeAllocations).toBe(allocated)
          expect(retained.raw().data[0]).toBe(255)
        } finally {
          frame.dispose()
        }
      }
    } finally {
      retained.dispose()
      second.dispose()
      pool.dispose()
    }
  })

  test("drawImage and copied buffers pin snapshots until both are cleared", () => {
    const pool = new NativeImagePool({ width: 1, height: 1, capacity: 1 })
    const source = OptimizedBuffer.create(1, 1, "unicode")
    const snapshot = OptimizedBuffer.create(1, 1, "unicode")
    const red = Uint8Array.of(255, 0, 0, 255)
    const blue = Uint8Array.of(0, 0, 255, 255)
    const frame = pool.publishRgba(red)!
    try {
      expect(source.drawImage(frame, 0, 0, 1, 1)).toBe(true)
      frame.dispose()
      snapshot.drawFrameBuffer(0, 0, source)
      source.clear()
      expect(pool.publishRgba(blue)).toBeNull()
      snapshot.clear()
      const next = pool.publishRgba(blue)!
      expect(next.raw().data).toEqual(blue)
      next.dispose()
    } finally {
      frame.dispose()
      source.destroy()
      snapshot.destroy()
      pool.dispose()
    }
  })

  test("copies strided views, refreshes alpha metadata, and rejects invalid input without consuming a slot", () => {
    const pool = new NativeImagePool({ width: 1, height: 2, capacity: 1 })
    const pixels = Uint8Array.of(99, 1, 2, 3, 255, 77, 77, 77, 77, 4, 5, 6, 255, 99).subarray(1, 13)
    try {
      expect(() => pool.publishRgba(pixels, 3)).toThrow(ImageError)
      expect(() => pool.publishRgba(pixels.subarray(0, 11), 8)).toThrow(ImageError)
      const frame = pool.publishRgba(pixels, 8)!
      try {
        expect(frame.raw().data).toEqual(Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255))
        expect(frame.info().hasAlpha).toBe(false)
        expect(() => pool.publishRgba(new Uint8Array(0))).toThrow(ImageError)
      } finally {
        frame.dispose()
      }
      pixels[3] = 0
      const next = pool.publishRgba(pixels, 8)!
      pixels.fill(0)
      expect(next.raw().data).toEqual(Uint8Array.of(1, 2, 3, 0, 4, 5, 6, 255))
      expect(next.info().hasAlpha).toBe(true)
      next.dispose()
    } finally {
      pool.dispose()
    }
  })

  test("dispose cancels future publications but leaves outstanding frames alive; resizing uses a new pool", () => {
    const pool = new NativeImagePool({ width: 1, height: 1 })
    const frame = pool.publishRgba(Uint8Array.of(1, 2, 3, 255))!
    pool.dispose()
    pool.dispose()
    try {
      expect(() => pool.publishRgba(Uint8Array.of(4, 5, 6, 255))).toThrow("disposed")
      expect(frame.raw().data).toEqual(Uint8Array.of(1, 2, 3, 255))
      const resized = new NativeImagePool({ width: 2, height: 1, capacity: 1 })
      try {
        const next = resized.publishRgba(new Uint8Array(8))!
        expect(next.width).toBe(2)
        expect(frame.width).toBe(1)
        next.dispose()
      } finally {
        resized.dispose()
      }
      const raw = frame.takeRaw()
      raw.dispose()
    } finally {
      frame.dispose()
    }
  })

  test("validates pool bounds and native limits", () => {
    for (const capacity of [0, -1, 1.5, 9, NaN, Infinity]) {
      expect(() => new NativeImagePool({ width: 1, height: 1, capacity })).toThrow(RangeError)
    }
    for (const width of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => new NativeImagePool({ width, height: 1 })).toThrow(RangeError)
    }
    const pool = new NativeImagePool({ width: 16_385, height: 1 })
    try {
      expect(() => pool.publishRgba(new Uint8Array(16_385 * 4))).toThrow(ImageError)
      expect(() => pool.publishRgba([] as unknown as Uint8Array)).toThrow(TypeError)
      expect(() => pool.publishRgba(new Uint8Array(0), NaN)).toThrow(RangeError)
    } finally {
      pool.dispose()
    }
  })
})
