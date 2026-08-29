import { describe, expect, test } from "bun:test"
import { OptimizedBuffer } from "../buffer.js"
import { ImageError, NativeImage, NativeImagePool, type PixelImportOptions } from "../image.js"
import { resolveRenderLib } from "../zig.js"

describe("NativeImagePool", () => {
  test("publishes shared pixel views through busy and reused slots", () => {
    const pixels = new Uint8Array(new SharedArrayBuffer(5), 1)
    pixels.set([3, 2, 1, 128])
    const pool = new NativeImagePool({ width: 1, height: 1, capacity: 1 })
    let frame = pool.publishPixels(pixels, { format: "bgra8" })!
    try {
      pixels.set([6, 5, 4, 255])
      expect(pool.publishPixels(pixels, { format: "bgra8" })).toBeNull()
      expect(frame.raw().data).toEqual(Uint8Array.of(1, 2, 3, 128))
      frame.dispose()
      frame = pool.publishPixels(pixels, { format: "bgra8" })!
      expect(frame.raw().data).toEqual(Uint8Array.of(4, 5, 6, 255))
    } finally {
      frame.dispose()
      pool.dispose()
    }
  })

  test.each(["straight", "opaque"] as const)(
    "publishes strided 65x3 BGRA with %s alpha and immutable readers",
    (alpha) => {
      const width = 65
      const height = 3
      const stride = 267
      const pixels = new Uint8Array(stride * (height - 1) + width * 4 + 1).subarray(1)
      const expected = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          pixels.set([x, y, 99, 255], y * stride + x * 4)
          expected.set([99, y, x, 255], (y * width + x) * 4)
        }
      }
      pixels[pixels.length - 1] = 128
      expected[expected.length - 1] = alpha === "opaque" ? 255 : 128
      const options: PixelImportOptions = { stride, format: "bgra8", alpha, colorSpace: "srgb" }
      const pool = new NativeImagePool({ width, height, capacity: 2 })
      const first = pool.publishPixels(pixels, options)!
      const retained = first.retain()
      first.dispose()
      const lib = resolveRenderLib()
      try {
        expect(retained.raw().data).toEqual(expected)
        expect(retained.info().hasAlpha).toBe(alpha === "straight")
        const second = pool.publishPixels(pixels, options)!
        const allocated = lib.getAllocatorStats().activeAllocations
        const previousHandle = second.ptr
        try {
          expect(pool.publishPixels(pixels, options)).toBeNull()
        } finally {
          second.dispose()
        }
        for (let index = 0; index < 20; index++) {
          pixels[pixels.length - 1] = index % 2 === 0 ? 255 : 0
          const frame = pool.publishPixels(pixels, options)!
          try {
            expect(frame.ptr).not.toBe(previousHandle)
            expect(frame.info().hasAlpha).toBe(alpha === "straight" && index % 2 !== 0)
            expect(frame.raw().data.at(-1)).toBe(alpha === "opaque" ? 255 : pixels[pixels.length - 1])
            expect(lib.getAllocatorStats().activeAllocations).toBe(allocated)
            expect(retained.raw().data).toEqual(expected)
          } finally {
            frame.dispose()
          }
        }
        pixels.fill(0)
        expect(retained.raw().data).toEqual(expected)
      } finally {
        retained.dispose()
        pool.dispose()
      }
    },
  )

  test("publishPixels validates before busy and preserves the fromPixels option contract", () => {
    const pixels = Uint8Array.of(1, 2, 3, 255)
    const pool = new NativeImagePool({ width: 1, height: 1, capacity: 1 })
    const frame = pool.publishPixels(pixels)!
    try {
      expect(frame.raw().data).toEqual(pixels)
      for (const [options, error] of [
        [{ stride: 3 }, ImageError],
        [{ stride: NaN }, RangeError],
        [{ format: "argb8" }, TypeError],
        [{ format: "toString" }, TypeError],
        [{ alpha: "premultiplied" }, TypeError],
        [{ colorSpace: "display-p3" }, TypeError],
      ] as const) {
        expect(() => NativeImage.fromPixels(pixels, 1, 1, options as PixelImportOptions)).toThrow(error)
        expect(() => pool.publishPixels(pixels, options as PixelImportOptions)).toThrow(error)
      }
      expect(() => pool.publishPixels(new Uint8Array(3))).toThrow(ImageError)
      expect(() => pool.publishPixels([] as unknown as Uint8Array)).toThrow(TypeError)
      expect(pool.publishPixels(pixels)).toBeNull()
      expect(frame.raw().data).toEqual(pixels)
    } finally {
      frame.dispose()
      pool.dispose()
    }
    expect(() => pool.publishPixels(pixels)).toThrow("disposed")
  })

  test("publishPixels releases failed native wrappers and can retry creation or publication", () => {
    const lib = resolveRenderLib()
    const pixels = Uint8Array.of(3, 2, 1, 0)
    NativeImage.fromPixels(pixels, 1, 1).dispose()
    const allocated = lib.getAllocatorStats().activeAllocations
    const getInfo = lib.imageGetInfo
    for (const failAt of [1, 2]) {
      const pool = new NativeImagePool({ width: 1, height: 1, capacity: 1 })
      let calls = 0
      lib.imageGetInfo = (handle) => {
        const result = getInfo.call(lib, handle)
        return ++calls === failAt ? { ...result, status: 8 } : result
      }
      try {
        expect(() => pool.publishPixels(pixels, { format: "bgra8" })).toThrow(ImageError)
        const frame = pool.publishPixels(pixels, { format: "bgra8", alpha: "opaque" })!
        try {
          expect(frame.raw().data).toEqual(Uint8Array.of(1, 2, 3, 255))
        } finally {
          frame.dispose()
        }
      } finally {
        lib.imageGetInfo = getInfo
        pool.dispose()
      }
      expect(lib.getAllocatorStats().activeAllocations).toBe(allocated)
    }
  })

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
