import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "bun:test"
import { ImageError, ImageLoadError, NativeImage, imageInfo } from "../image.js"

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==",
    "base64",
  ),
)

const FIXTURES = new URL("./fixtures/images/", import.meta.url)
const FORMATS = [
  ["rgba.png", "png", false],
  ["baseline.jpg", "jpeg", false],
  ["progressive.jpg", "jpeg", false],
  ["lossy.webp", "webp", false],
  ["lossless.webp", "webp", false],
  ["alpha.webp", "webp", true],
  ["first-frame.gif", "gif", false],
  ["transparent.gif", "gif", true],
] as const

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
    const bytes = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)
    for (const operation of [() => imageInfo(bytes), () => NativeImage.decode(bytes)]) {
      try {
        operation()
        throw new Error("expected image operation to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(ImageError)
        expect((error as ImageError).code).toBe("unsupported-format")
      }
    }
  })

  test("inspects and decodes every required encoded format", async () => {
    for (const [name, format, hasAlpha] of FORMATS) {
      const bytes = await readFile(new URL(name, FIXTURES))
      const inspected = imageInfo(bytes)
      const image = NativeImage.decode(bytes)
      try {
        expect(inspected.format).toBe(format)
        expect(inspected.hasAlpha).toBe(hasAlpha)
        expect(image.info()).toEqual({ ...inspected, orientation: 1 })
        expect(image.raw().data).toHaveLength(image.width * image.height * 4)
      } finally {
        image.dispose()
      }
    }
  })

  test("reports malformed data for every recognized format", async () => {
    for (const [name] of FORMATS) {
      const bytes = await readFile(new URL(name, FIXTURES))
      const truncated = bytes.subarray(0, Math.max(2, Math.floor(bytes.byteLength / 2)))
      expect(() => NativeImage.decode(truncated)).toThrow("malformed image data")
    }
  })

  test("rejects a JPEG whose only EOI marker is inside a comment", async () => {
    const jpeg = await readFile(new URL("baseline.jpg", FIXTURES))
    const malformed = new Uint8Array(jpeg.byteLength + 4)
    malformed.set(jpeg.subarray(0, 2), 0)
    malformed.set([0xff, 0xfe, 0x00, 0x04, 0xff, 0xd9], 2)
    malformed.set(jpeg.subarray(2, -2), 8)

    expect(() => imageInfo(malformed)).toThrow("malformed image data")
    expect(() => NativeImage.decode(malformed)).toThrow("malformed image data")
  })

  test("rejects a JPEG that ends before its first scan", async () => {
    const jpeg = await readFile(new URL("baseline.jpg", FIXTURES))
    const sos = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xda)
    expect(sos).toBeGreaterThan(0)
    const malformed = new Uint8Array(sos + 2)
    malformed.set(jpeg.subarray(0, sos))
    malformed.set([0xff, 0xd9], sos)

    expect(() => imageInfo(malformed)).toThrow("malformed image data")
    expect(() => NativeImage.decode(malformed)).toThrow("malformed image data")
  })

  test("rejects a JPEG with a scan header but no entropy data", async () => {
    const jpeg = await readFile(new URL("baseline.jpg", FIXTURES))
    const sos = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xda)
    expect(sos).toBeGreaterThan(0)
    const scanHeaderLength = (jpeg[sos + 2] << 8) | jpeg[sos + 3]
    const afterScanHeader = sos + 2 + scanHeaderLength
    const malformed = new Uint8Array(afterScanHeader + 2)
    malformed.set(jpeg.subarray(0, afterScanHeader))
    malformed.set([0xff, 0xd9], afterScanHeader)

    expect(() => imageInfo(malformed)).toThrow("malformed image data")
    expect(() => NativeImage.decode(malformed)).toThrow("malformed image data")
  })

  test("rejects a JPEG with an incomplete entropy-coded scan", async () => {
    const jpeg = await readFile(new URL("baseline.jpg", FIXTURES))
    const sos = jpeg.findIndex((byte, index) => byte === 0xff && jpeg[index + 1] === 0xda)
    expect(sos).toBeGreaterThan(0)
    const scanHeaderLength = (jpeg[sos + 2] << 8) | jpeg[sos + 3]
    const afterScanHeader = sos + 2 + scanHeaderLength
    const malformed = new Uint8Array(afterScanHeader + 3)
    malformed.set(jpeg.subarray(0, afterScanHeader + 1))
    malformed.set([0xff, 0xd9], afterScanHeader + 1)

    expect(() => imageInfo(malformed)).toThrow("malformed image data")
    expect(() => NativeImage.decode(malformed)).toThrow("malformed image data")
  })

  test("rejects a progressive JPEG whose final scan has no entropy data", async () => {
    const jpeg = await readFile(new URL("progressive.jpg", FIXTURES))
    let finalSos = -1
    for (let index = 0; index + 1 < jpeg.byteLength; index++) {
      if (jpeg[index] === 0xff && jpeg[index + 1] === 0xda) finalSos = index
    }
    expect(finalSos).toBeGreaterThan(0)
    const scanHeaderLength = (jpeg[finalSos + 2] << 8) | jpeg[finalSos + 3]
    const afterScanHeader = finalSos + 2 + scanHeaderLength
    const malformed = new Uint8Array(afterScanHeader + 2)
    malformed.set(jpeg.subarray(0, afterScanHeader))
    malformed.set([0xff, 0xd9], afterScanHeader)

    expect(() => imageInfo(malformed)).toThrow("malformed image data")
    expect(() => NativeImage.decode(malformed)).toThrow("malformed image data")
  })

  test("accepts JPEG data after a complete image", async () => {
    const jpeg = await readFile(new URL("baseline.jpg", FIXTURES))
    const withTrailingData = new Uint8Array(jpeg.byteLength + 3)
    withTrailingData.set(jpeg)
    withTrailingData.set([1, 2, 3], jpeg.byteLength)

    const image = NativeImage.decode(withTrailingData)
    try {
      expect(image.info().format).toBe("jpeg")
    } finally {
      image.dispose()
    }
  })

  test("composes an offset GIF frame over its logical-screen background", async () => {
    const image = NativeImage.decode(await readFile(new URL("offset.gif", FIXTURES)))
    try {
      expect([image.width, image.height]).toEqual([3, 3])
      expect(image.info().hasAlpha).toBe(false)
      const pixels = image.raw().data
      expect([...pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255])
      expect([...pixels.subarray((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)]).toEqual([255, 0, 0, 255])
    } finally {
      image.dispose()
    }
  })

  test("uses a nonzero GIF logical-screen background palette index", async () => {
    const gif = new Uint8Array(await readFile(new URL("offset.gif", FIXTURES)))
    gif[11] = 1
    const image = NativeImage.decode(gif)
    try {
      const pixels = image.raw().data
      expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 255])
      expect([...pixels.subarray((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)]).toEqual([255, 0, 0, 255])
    } finally {
      image.dispose()
    }
  })

  test("keeps a transparent GIF logical-screen background transparent", async () => {
    const image = NativeImage.decode(await readFile(new URL("transparent.gif", FIXTURES)))
    try {
      expect(image.info().hasAlpha).toBe(true)
      expect(image.raw().data.some((channel, index) => index % 4 === 3 && channel === 0)).toBe(true)
    } finally {
      image.dispose()
    }
  })

  test("all image operations work for every decoded format", async () => {
    for (const [name] of FORMATS) {
      const image = NativeImage.decode(await readFile(new URL(name, FIXTURES)))
      const clone = image.clone()
      const resized = image.resize({ width: 1, height: 1 })
      const extracted = image.extract({ left: 0, top: 0, width: 1, height: 1 })
      const rotated = image.rotate(90)
      const flipped = image.flip()
      const flopped = image.flop()
      const composited = image.composite(extracted)
      try {
        expect(clone.info()).toEqual(image.info())
        expect([resized.width, resized.height]).toEqual([1, 1])
        expect([extracted.width, extracted.height]).toEqual([1, 1])
        expect([rotated.width, rotated.height]).toEqual([image.height, image.width])
        expect(flipped.raw().data).toHaveLength(image.width * image.height * 4)
        expect(flopped.raw().data).toHaveLength(image.width * image.height * 4)
        expect(composited.raw().data).toHaveLength(image.width * image.height * 4)
      } finally {
        composited.dispose()
        flopped.dispose()
        flipped.dispose()
        rotated.dispose()
        extracted.dispose()
        resized.dispose()
        clone.dispose()
        image.dispose()
      }
    }
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

  test("loads encoded bytes and ArrayBuffer sources", async () => {
    const bytes = await readFile(new URL("rgba.png", FIXTURES))
    const fromView = await NativeImage.load(bytes.subarray(0))
    const fromBuffer = await NativeImage.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    try {
      expect(fromView.info().format).toBe("png")
      expect(fromBuffer.info()).toEqual(fromView.info())
    } finally {
      fromBuffer.dispose()
      fromView.dispose()
    }
  })

  test("loads local paths and file URLs", async () => {
    const url = new URL("rgba.png", FIXTURES)
    const fromPath = await NativeImage.load(fileURLToPath(url))
    const fromUrl = await NativeImage.load(url)
    const fromUrlString = await NativeImage.load(url.href)
    try {
      expect(fromPath.info().format).toBe("png")
      expect(fromUrl.info()).toEqual(fromPath.info())
      expect(fromUrlString.info()).toEqual(fromPath.info())
    } finally {
      fromUrlString.dispose()
      fromUrl.dispose()
      fromPath.dispose()
    }
  })

  test("recognizes URL string schemes case-insensitively", async () => {
    const fixture = await readFile(new URL("rgba.png", FIXTURES))
    const image = await NativeImage.load("HTTPS://images.test/image", {
      fetch: async () => new Response(fixture),
    })
    try {
      expect(image.info().format).toBe("png")
    } finally {
      image.dispose()
    }

    const fileUrl = new URL("rgba.png", FIXTURES).href.replace(/^file:/, "FILE:")
    const fileImage = await NativeImage.load(fileUrl)
    try {
      expect(fileImage.info().format).toBe("png")
    } finally {
      fileImage.dispose()
    }
  })

  test("reports filesystem failures", async () => {
    try {
      await NativeImage.load(fileURLToPath(new URL("missing.png", FIXTURES)))
      throw new Error("expected load to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ImageLoadError)
      expect((error as ImageLoadError).code).toBe("file-read")
      expect((error as ImageLoadError).cause).toBeDefined()
    }
  })

  test("loads HTTP responses by bytes and reports status failures", async () => {
    const fixture = await readFile(new URL("lossless.webp", FIXTURES))
    const server = createServer((request, response) => {
      if (request.url === "/image.not-an-extension") {
        response.writeHead(200, { "content-type": "text/plain" })
        response.end(fixture)
      } else {
        response.writeHead(404)
        response.end("missing")
      }
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("missing test server address")
    const base = `http://127.0.0.1:${address.port}`
    try {
      const image = await NativeImage.load(`${base}/image.not-an-extension`)
      try {
        expect(image.info().format).toBe("webp")
      } finally {
        image.dispose()
      }

      try {
        await NativeImage.load(new URL("/missing", base))
        throw new Error("expected HTTP load to fail")
      } catch (error) {
        expect(error).toBeInstanceOf(ImageLoadError)
        expect((error as ImageLoadError).code).toBe("http-status")
        expect((error as ImageLoadError).status).toBe(404)
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  test("loads HTTPS URLs through fetch and reports network failures", async () => {
    const fixture = await readFile(new URL("transparent.gif", FIXTURES))
    const image = await NativeImage.load(new URL("https://images.test/image"), {
      fetch: async () => new Response(fixture),
    })
    try {
      expect(image.info().format).toBe("gif")
    } finally {
      image.dispose()
    }

    try {
      await NativeImage.load(new URL("https://images.test/failure"), {
        fetch: async () => {
          throw new Error("offline")
        },
      })
      throw new Error("expected network load to fail")
    } catch (error) {
      expect(error).toBeInstanceOf(ImageLoadError)
      expect((error as ImageLoadError).code).toBe("network")
    }
  })
})
