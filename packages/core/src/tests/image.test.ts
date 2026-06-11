import { describe, expect, test } from "bun:test"
import { NativeImage, imageInfo } from "../image.js"

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==",
    "base64",
  ),
)

describe("NativeImage", () => {
  test("inspects and decodes PNG data", () => {
    expect(imageInfo(PNG_1X1)).toMatchObject({ width: 1, height: 1, format: "png" })
    const image = NativeImage.decode(PNG_1X1)
    try {
      expect(image.width).toBe(1)
      expect(image.height).toBe(1)
      expect(image.raw().data).toHaveLength(4)
    } finally {
      image.dispose()
    }
  })

  test("rejects malformed PNG data", () => {
    const corrupt = PNG_1X1.slice()
    corrupt[29] ^= 1
    expect(() => imageInfo(corrupt)).toThrow("malformed image data")
  })

  test("rejects unsupported encoded formats", () => {
    expect(() => imageInfo(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8))).toThrow("unsupported image format")
  })

  test("constructs and exports immutable RGBA images", () => {
    const source = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)
    const image = NativeImage.fromRgba(source, 2, 1)
    source.fill(0)
    try {
      expect([...image.raw().data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect([...image.raw("bgra8").data]).toEqual([3, 2, 1, 4, 7, 6, 5, 8])
    } finally {
      image.dispose()
    }
  })

  test("supports exact transforms, extraction, and extension", () => {
    const image = NativeImage.fromRgba(
      Uint8Array.of(1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255),
      3,
      2,
    )
    const rotated = image.rotate(90)
    const extracted = image.extract({ left: 1, top: 0, width: 2, height: 2 })
    const extended = extracted.extend({ top: 1, left: 1, background: [9, 8, 7, 6] })
    try {
      expect([rotated.width, rotated.height]).toEqual([2, 3])
      expect([...rotated.raw().data.filter((_, index) => index % 4 === 0)]).toEqual([4, 1, 5, 2, 6, 3])
      expect([...extended.raw().data.slice(0, 4)]).toEqual([9, 8, 7, 6])
    } finally {
      extended.dispose()
      extracted.dispose()
      rotated.dispose()
      image.dispose()
    }
  })

  test("preserves aspect ratio when one resize dimension is omitted", () => {
    const image = NativeImage.fromRgba(new Uint8Array(4 * 4 * 2).fill(255), 4, 2)
    const resized = image.resize({ width: 2 })
    try {
      expect([resized.width, resized.height]).toEqual([2, 1])
    } finally {
      resized.dispose()
      image.dispose()
    }
  })

  test("composites in linear light", () => {
    const base = NativeImage.fromRgba(Uint8Array.of(0, 0, 0, 255), 1, 1)
    const overlay = NativeImage.fromRgba(Uint8Array.of(255, 255, 255, 128), 1, 1)
    const output = base.composite(overlay)
    try {
      expect(output.raw().data[0]).toBeWithin(187, 190)
      expect(output.raw().data[3]).toBe(255)
    } finally {
      output.dispose()
      overlay.dispose()
      base.dispose()
    }
  })

  test("dispose is idempotent and rejects later operations", () => {
    const image = NativeImage.fromRgba(Uint8Array.of(0, 0, 0, 0), 1, 1)
    image.dispose()
    image.dispose()
    expect(() => image.raw()).toThrow("disposed")
  })

  test("validates dimensions and destination buffers", () => {
    expect(() => NativeImage.fromRgba(new Uint8Array(4), 0, 1)).toThrow("positive u32")
    const image = NativeImage.fromRgba(new Uint8Array(4), 1, 1)
    try {
      expect(() => image.extract({ left: 1, top: 0, width: 1, height: 1 })).toThrow("invalid image argument")
      expect(() => image.copyTo(new Uint8Array(3))).toThrow("too small")
    } finally {
      image.dispose()
    }
  })
})
