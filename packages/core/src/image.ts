import { readFile } from "node:fs/promises"

import { resolveRenderLib, type ImageHandle, type RenderLib } from "./zig.js"
import type { NativeImageInfo } from "./zig-structs.js"

export type ImageFormat = "png" | "raw-rgba" | "jpeg" | "webp" | "gif"
export type ImageColorStatus = "assumed-srgb" | "explicit-srgb"
export type ResizeKernel = "default" | "area" | "triangle" | "cubic-bspline" | "catmull-rom" | "mitchell" | "nearest"
export type BlendMode = "source-over" | "source" | "destination-over"
export type PixelFormat = "rgba8" | "bgra8"
export type ImageSource = string | URL | Uint8Array | ArrayBuffer

export type ImageLoadErrorCode = "file-read" | "network" | "http-status" | "unsupported-url-scheme"

export class ImageLoadError extends Error {
  public readonly code: ImageLoadErrorCode
  public readonly source: string
  public readonly status?: number

  constructor(
    code: ImageLoadErrorCode,
    source: string,
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(message, { cause: options?.cause })
    this.name = "ImageLoadError"
    this.code = code
    this.source = source
    this.status = options?.status
  }
}

export interface ImageLoadOptions {
  signal?: AbortSignal
  fetch?: typeof globalThis.fetch
}

export interface ImageInfo {
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  format: ImageFormat
  colorStatus: ImageColorStatus
  orientation: number
  hasAlpha: boolean
}

export interface ResizeOptions {
  width?: number
  height?: number
  kernel?: ResizeKernel
}

export interface ExtractOptions {
  left: number
  top: number
  width: number
  height: number
}

export interface ExtendOptions {
  top?: number
  right?: number
  bottom?: number
  left?: number
  background?: readonly [number, number, number, number]
}

export interface CompositeOptions {
  left?: number
  top?: number
  blend?: BlendMode
  opacity?: number
}

export interface RawImage {
  data: Uint8Array
  width: number
  height: number
  stride: number
  format: PixelFormat
  colorSpace: "srgb"
  alpha: "straight"
}

const STATUS_MESSAGES = [
  "ok",
  "invalid image handle",
  "unsupported image format",
  "unsupported image color space",
  "malformed image data",
  "image dimensions exceed limits",
  "image memory limit exceeded",
  "invalid image argument",
  "out of memory",
  "image output buffer is too small",
  "internal image error",
  "unsupported image feature",
] as const

export type ImageErrorCode =
  | "invalid-handle"
  | "unsupported-format"
  | "unsupported-color-space"
  | "malformed-data"
  | "dimension-limit"
  | "memory-limit"
  | "invalid-argument"
  | "out-of-memory"
  | "output-too-small"
  | "internal-error"
  | "unsupported-feature"

const STATUS_CODES: readonly ImageErrorCode[] = [
  "internal-error",
  "invalid-handle",
  "unsupported-format",
  "unsupported-color-space",
  "malformed-data",
  "dimension-limit",
  "memory-limit",
  "invalid-argument",
  "out-of-memory",
  "output-too-small",
  "internal-error",
  "unsupported-feature",
]

export class ImageError extends Error {
  public readonly code: ImageErrorCode
  public readonly status: number

  constructor(status: number) {
    super(`Native image operation failed: ${STATUS_MESSAGES[status] ?? `unknown status ${status}`}`)
    this.name = "ImageError"
    this.status = status
    this.code = STATUS_CODES[status] ?? "internal-error"
  }
}

const FILTER_IDS: Record<ResizeKernel, number> = {
  default: 0,
  area: 1,
  triangle: 2,
  "cubic-bspline": 3,
  "catmull-rom": 4,
  mitchell: 5,
  nearest: 6,
}

const BLEND_IDS: Record<BlendMode, number> = {
  "source-over": 0,
  source: 1,
  "destination-over": 2,
}

function imageError(status: number): Error {
  return new ImageError(status)
}

function checkStatus(status: number): void {
  if (status !== 0) throw imageError(status)
}

function requireU32(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 0xffff_ffff) {
    throw new RangeError(`${name} must be ${allowZero ? "a non-negative" : "a positive"} u32 integer`)
  }
  return value
}

function requireI32(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new RangeError(`${name} must be an i32 integer`)
  }
  return value
}

function requireByte(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new RangeError(`${name} must be an integer from 0 to 255`)
  return value
}

function unpackInfo(info: NativeImageInfo): ImageInfo {
  const format = (["unknown", "png", "raw-rgba", "jpeg", "webp", "gif"] as const)[info.format]
  if (!format || format === "unknown") throw new Error(`Unknown native image format ${info.format}`)
  return {
    width: info.width,
    height: info.height,
    sourceWidth: info.sourceWidth,
    sourceHeight: info.sourceHeight,
    format,
    colorStatus: info.colorStatus === 1 ? "explicit-srgb" : "assumed-srgb",
    orientation: info.orientation,
    hasAlpha: info.hasAlpha !== 0,
  }
}

function encodedBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  throw new TypeError("image data must be a Uint8Array or ArrayBuffer")
}

export function imageInfo(data: Uint8Array | ArrayBuffer): ImageInfo {
  const bytes = encodedBytes(data)
  if (bytes.byteLength === 0) throw new TypeError("image data must not be empty")
  const result = resolveRenderLib().imageInfo(bytes)
  checkStatus(result.status)
  return unpackInfo(result.info)
}

export class NativeImage {
  private readonly lib: RenderLib
  private handle: ImageHandle | null
  private imageInfo: ImageInfo

  private constructor(lib: RenderLib, handle: ImageHandle, info: ImageInfo) {
    this.lib = lib
    this.handle = handle
    this.imageInfo = info
  }

  public static decode(data: Uint8Array | ArrayBuffer): NativeImage {
    const bytes = encodedBytes(data)
    if (bytes.byteLength === 0) throw new TypeError("image data must not be empty")
    const lib = resolveRenderLib()
    const result = lib.imageDecode(bytes)
    checkStatus(result.status)
    if (!result.handle) throw imageError(10)
    return NativeImage.fromHandle(lib, result.handle)
  }

  public static async load(source: ImageSource, options: ImageLoadOptions = {}): Promise<NativeImage> {
    options.signal?.throwIfAborted()
    if (source instanceof Uint8Array || source instanceof ArrayBuffer) return NativeImage.decode(source)

    const url =
      source instanceof URL
        ? source
        : source.startsWith("http:") || source.startsWith("https:") || source.startsWith("file:")
          ? new URL(source)
          : null
    if (!url || url.protocol === "file:") {
      const path = url ?? source
      let data: Uint8Array
      try {
        data = await readFile(path, { signal: options.signal })
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason
        throw new ImageLoadError("file-read", String(source), `Failed to read image: ${String(source)}`, {
          cause: error,
        })
      }
      options.signal?.throwIfAborted()
      return NativeImage.decode(data)
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ImageLoadError("unsupported-url-scheme", url.href, `Unsupported image URL scheme: ${url.protocol}`)
    }

    let response: Response
    try {
      response = await (options.fetch ?? globalThis.fetch)(url, { signal: options.signal })
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason
      throw new ImageLoadError("network", url.href, `Failed to fetch image: ${url.href}`, { cause: error })
    }
    if (!response.ok) {
      throw new ImageLoadError("http-status", url.href, `Failed to fetch image: HTTP ${response.status}`, {
        status: response.status,
      })
    }
    let data: ArrayBuffer
    try {
      data = await response.arrayBuffer()
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason
      throw new ImageLoadError("network", url.href, `Failed to read image response: ${url.href}`, { cause: error })
    }
    options.signal?.throwIfAborted()
    return NativeImage.decode(data)
  }

  public static fromRgba(pixels: Uint8Array, width: number, height: number, stride = width * 4): NativeImage {
    if (!(pixels instanceof Uint8Array)) throw new TypeError("pixels must be a Uint8Array")
    requireU32(width, "width")
    requireU32(height, "height")
    requireU32(stride, "stride")
    const lib = resolveRenderLib()
    const result = lib.imageCreateFromRgba(pixels, width, height, stride)
    checkStatus(result.status)
    if (!result.handle) throw imageError(10)
    return NativeImage.fromHandle(lib, result.handle)
  }

  private static fromHandle(lib: RenderLib, handle: ImageHandle): NativeImage {
    const result = lib.imageGetInfo(handle)
    if (result.status !== 0) {
      lib.imageDestroy(handle)
      throw imageError(result.status)
    }
    return new NativeImage(lib, handle, unpackInfo(result.info))
  }

  private guard(): ImageHandle {
    if (!this.handle) throw new Error("NativeImage is disposed")
    return this.handle
  }

  private wrap(result: { status: number; handle: ImageHandle | null }): NativeImage {
    checkStatus(result.status)
    if (!result.handle) throw imageError(10)
    return NativeImage.fromHandle(this.lib, result.handle)
  }

  public info(): ImageInfo {
    this.guard()
    return { ...this.imageInfo }
  }

  public get width(): number {
    this.guard()
    return this.imageInfo.width
  }

  public get height(): number {
    this.guard()
    return this.imageInfo.height
  }

  public clone(): NativeImage {
    return this.wrap(this.lib.imageClone(this.guard()))
  }

  public resize(options: ResizeOptions): NativeImage {
    if (!options || (options.width === undefined && options.height === undefined)) {
      throw new TypeError("resize requires width, height, or both")
    }
    let width = options.width
    let height = options.height
    if (width !== undefined) requireU32(width, "width")
    if (height !== undefined) requireU32(height, "height")
    if (width === undefined) width = Math.max(1, Math.round((this.width * height!) / this.height))
    if (height === undefined) height = Math.max(1, Math.round((this.height * width) / this.width))
    return this.wrap(this.lib.imageResize(this.guard(), width, height, FILTER_IDS[options.kernel ?? "area"]))
  }

  public extract(options: ExtractOptions): NativeImage {
    return this.wrap(
      this.lib.imageExtract(
        this.guard(),
        requireU32(options.left, "left", true),
        requireU32(options.top, "top", true),
        requireU32(options.width, "width"),
        requireU32(options.height, "height"),
      ),
    )
  }

  public extend(options: ExtendOptions = {}): NativeImage {
    const background = options.background ?? [0, 0, 0, 0]
    if (background.length !== 4) throw new TypeError("background must contain four RGBA channels")
    const color = Uint8Array.from(background.map((value, index) => requireByte(value, `background[${index}]`)))
    return this.wrap(
      this.lib.imageExtend(
        this.guard(),
        requireU32(options.top ?? 0, "top", true),
        requireU32(options.right ?? 0, "right", true),
        requireU32(options.bottom ?? 0, "bottom", true),
        requireU32(options.left ?? 0, "left", true),
        color,
      ),
    )
  }

  public rotate(angle: 90 | 180 | 270): NativeImage {
    const operation = angle === 90 ? 0 : angle === 180 ? 1 : angle === 270 ? 2 : -1
    if (operation < 0) throw new RangeError("angle must be 90, 180, or 270")
    return this.wrap(this.lib.imageTransform(this.guard(), operation))
  }

  public flip(): NativeImage {
    return this.wrap(this.lib.imageTransform(this.guard(), 3))
  }

  public flop(): NativeImage {
    return this.wrap(this.lib.imageTransform(this.guard(), 4))
  }

  public composite(overlay: NativeImage, options: CompositeOptions = {}): NativeImage {
    if (!(overlay instanceof NativeImage)) throw new TypeError("overlay must be a NativeImage")
    const opacity = options.opacity ?? 1
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new RangeError("opacity must be between 0 and 1")
    return this.wrap(
      this.lib.imageComposite(
        this.guard(),
        overlay.guard(),
        requireI32(options.left ?? 0, "left"),
        requireI32(options.top ?? 0, "top"),
        BLEND_IDS[options.blend ?? "source-over"],
        Math.round(opacity * 255),
      ),
    )
  }

  public raw(format: PixelFormat = "rgba8"): RawImage {
    const stride = this.width * 4
    const data = new Uint8Array(stride * this.height)
    checkStatus(this.lib.imageCopyPixels(this.guard(), data, stride, format === "bgra8"))
    return { data, width: this.width, height: this.height, stride, format, colorSpace: "srgb", alpha: "straight" }
  }

  public copyTo(destination: Uint8Array, options: { stride?: number; format?: PixelFormat } = {}): void {
    if (!(destination instanceof Uint8Array)) throw new TypeError("destination must be a Uint8Array")
    const stride = options.stride ?? this.width * 4
    requireU32(stride, "stride")
    checkStatus(this.lib.imageCopyPixels(this.guard(), destination, stride, options.format === "bgra8"))
  }

  public dispose(): void {
    if (!this.handle) return
    this.lib.imageDestroy(this.handle)
    this.handle = null
  }
}
