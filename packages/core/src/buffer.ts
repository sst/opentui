import type { TextBuffer } from "./text-buffer"
import { RGBA } from "./lib"
import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import { type BorderStyle, type BorderSides, type BorderCharacters, BorderCharArrays, borderCharsToArray } from "./lib"
import { type WidthMethod } from "./types"

function isRGBAWithAlpha(color: RGBA): boolean {
  return color.a < 1.0
}

// Pack drawing options into a single u32
// bits 0-3: borderSides, bit 4: shouldFill, bits 5-6: titleAlignment
function packDrawOptions(
  border: boolean | BorderSides[],
  shouldFill: boolean,
  titleAlignment: "left" | "center" | "right",
): number {
  let packed = 0

  if (border === true) {
    packed |= 0b1111 // All sides
  } else if (Array.isArray(border)) {
    if (border.includes("top")) packed |= 0b1000
    if (border.includes("right")) packed |= 0b0100
    if (border.includes("bottom")) packed |= 0b0010
    if (border.includes("left")) packed |= 0b0001
  }

  if (shouldFill) {
    packed |= 1 << 4
  }

  const alignmentMap: Record<string, number> = {
    left: 0,
    center: 1,
    right: 2,
  }
  const alignment = alignmentMap[titleAlignment]
  packed |= alignment << 5

  return packed
}

function blendColors(overlay: RGBA, text: RGBA): RGBA {
  const [overlayR, overlayG, overlayB, overlayA] = overlay.buffer
  const [textR, textG, textB, textA] = text.buffer

  if (overlayA === 1.0) {
    return overlay
  }

  const alpha = overlayA

  let perceptualAlpha: number

  if (alpha > 0.8) {
    const normalizedHighAlpha = (alpha - 0.8) * 5.0
    const curvedHighAlpha = Math.pow(normalizedHighAlpha, 0.2)
    perceptualAlpha = 0.8 + curvedHighAlpha * 0.2
  } else {
    perceptualAlpha = Math.pow(alpha, 0.9)
  }

  const r = overlayR * perceptualAlpha + textR * (1 - perceptualAlpha)
  const g = overlayG * perceptualAlpha + textG * (1 - perceptualAlpha)
  const b = overlayB * perceptualAlpha + textB * (1 - perceptualAlpha)

  return RGBA.fromValues(r, g, b, textA)
}

export class OptimizedBuffer {
  private static fbIdCounter = 0
  public id: string
  public lib: RenderLib
  private bufferPtr: Pointer
  private buffer: {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint8Array
  }
  private _width: number
  private _height: number
  public respectAlpha: boolean = false
  private useFFI: boolean = true

  get ptr(): Pointer {
    return this.bufferPtr
  }

  constructor(
    lib: RenderLib,
    ptr: Pointer,
    buffer: {
      char: Uint32Array
      fg: Float32Array
      bg: Float32Array
      attributes: Uint8Array
    },
    width: number,
    height: number,
    options: { respectAlpha?: boolean; id?: string },
  ) {
    this.id = options.id || `fb_${OptimizedBuffer.fbIdCounter++}`
    this.lib = lib
    this.respectAlpha = options.respectAlpha || false
    this._width = width
    this._height = height
    this.bufferPtr = ptr
    this.buffer = buffer
  }

  static create(
    width: number,
    height: number,
    widthMethod: WidthMethod,
    options: { respectAlpha?: boolean; id?: string } = {},
  ): OptimizedBuffer {
    const lib = resolveRenderLib()
    const respectAlpha = options.respectAlpha || false
    const id = options.id && options.id.trim() !== "" ? options.id : "unnamed buffer"
    return lib.createOptimizedBuffer(width, height, widthMethod, respectAlpha, id)
  }

  public get buffers(): {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint8Array
  } {
    return this.buffer
  }

  private coordsToIndex(x: number, y: number): number {
    return y * this._width + x
  }

  public get width(): number {
    return this._width
  }

  public get height(): number {
    return this._height
  }

  public setRespectAlpha(respectAlpha: boolean): void {
    this.lib.bufferSetRespectAlpha(this.bufferPtr, respectAlpha)
    this.respectAlpha = respectAlpha
  }

  public getNativeId(): string {
    return this.lib.bufferGetId(this.bufferPtr)
  }

  public clear(bg: RGBA = RGBA.fromValues(0, 0, 0, 1), clearChar: string = " "): void {
    if (this.useFFI) {
      this.clearFFI(bg)
    } else {
      this.clearLocal(bg, clearChar)
    }
  }

  public clearLocal(bg: RGBA = RGBA.fromValues(0, 0, 0, 1), clearChar: string = " "): void {
    this.buffer.char.fill(clearChar.charCodeAt(0))
    this.buffer.attributes.fill(0)

    for (let i = 0; i < this._width * this._height; i++) {
      const index = i * 4

      this.buffer.fg[index] = 1.0
      this.buffer.fg[index + 1] = 1.0
      this.buffer.fg[index + 2] = 1.0
      this.buffer.fg[index + 3] = 1.0

      this.buffer.bg[index] = bg.r
      this.buffer.bg[index + 1] = bg.g
      this.buffer.bg[index + 2] = bg.b
      this.buffer.bg[index + 3] = bg.a
    }
  }

  public setCell(x: number, y: number, char: string, fg: RGBA, bg: RGBA, attributes: number = 0): void {
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) return

    const index = this.coordsToIndex(x, y)
    const colorIndex = index * 4

    // Set character and attributes
    this.buffer.char[index] = char.charCodeAt(0)
    this.buffer.attributes[index] = attributes

    // Set foreground color
    this.buffer.fg[colorIndex] = fg.r
    this.buffer.fg[colorIndex + 1] = fg.g
    this.buffer.fg[colorIndex + 2] = fg.b
    this.buffer.fg[colorIndex + 3] = fg.a

    // Set background color
    this.buffer.bg[colorIndex] = bg.r
    this.buffer.bg[colorIndex + 1] = bg.g
    this.buffer.bg[colorIndex + 2] = bg.b
    this.buffer.bg[colorIndex + 3] = bg.a
  }

  public get(x: number, y: number): { char: number; fg: RGBA; bg: RGBA; attributes: number } | null {
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) return null

    const index = this.coordsToIndex(x, y)
    const colorIndex = index * 4

    return {
      char: this.buffer.char[index],
      fg: RGBA.fromArray(this.buffer.fg.slice(colorIndex, colorIndex + 4)),
      bg: RGBA.fromArray(this.buffer.bg.slice(colorIndex, colorIndex + 4)),
      attributes: this.buffer.attributes[index],
    }
  }

  public setCellWithAlphaBlending(
    x: number,
    y: number,
    char: string,
    fg: RGBA,
    bg: RGBA,
    attributes: number = 0,
  ): void {
    if (this.useFFI) {
      this.setCellWithAlphaBlendingFFI(x, y, char, fg, bg, attributes)
    } else {
      this.setCellWithAlphaBlendingLocal(x, y, char, fg, bg, attributes)
    }
  }

  public setCellWithAlphaBlendingLocal(
    x: number,
    y: number,
    char: string,
    fg: RGBA,
    bg: RGBA,
    attributes: number = 0,
  ): void {
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) return

    const hasBgAlpha = isRGBAWithAlpha(bg)
    const hasFgAlpha = isRGBAWithAlpha(fg)

    if (hasBgAlpha || hasFgAlpha) {
      const destCell = this.get(x, y)
      if (destCell) {
        const blendedBgRgb = hasBgAlpha ? blendColors(bg, destCell.bg) : bg

        const preserveChar = char === " " && destCell.char !== 0 && String.fromCharCode(destCell.char) !== " "
        const finalChar = preserveChar ? destCell.char : char.charCodeAt(0)

        let finalFg: RGBA
        if (preserveChar) {
          finalFg = blendColors(bg, destCell.fg)
        } else {
          finalFg = hasFgAlpha ? blendColors(fg, destCell.bg) : fg
        }

        const finalAttributes = preserveChar ? destCell.attributes : attributes
        const finalBg = RGBA.fromValues(blendedBgRgb.r, blendedBgRgb.g, blendedBgRgb.b, bg.a)

        this.setCell(x, y, String.fromCharCode(finalChar), finalFg, finalBg, finalAttributes)
        return
      }
    }

    this.setCell(x, y, char, fg, bg, attributes)
  }

  public drawText(
    text: string,
    x: number,
    y: number,
    fg: RGBA,
    bg?: RGBA,
    attributes: number = 0,
    selection?: { start: number; end: number; bgColor?: RGBA; fgColor?: RGBA } | null,
  ): void {
    if (!selection) {
      this.drawTextFFI.call(this, text, x, y, fg, bg, attributes)
      return
    }

    const { start, end } = selection

    let selectionBg: RGBA
    let selectionFg: RGBA

    if (selection.bgColor) {
      selectionBg = selection.bgColor
      selectionFg = selection.fgColor || fg
    } else {
      const defaultBg = bg || RGBA.fromValues(0, 0, 0, 0)
      selectionFg = defaultBg.a > 0 ? defaultBg : RGBA.fromValues(0, 0, 0, 1)
      selectionBg = fg
    }

    if (start > 0) {
      const beforeText = text.slice(0, start)
      this.drawTextFFI.call(this, beforeText, x, y, fg, bg, attributes)
    }

    if (end > start) {
      const selectedText = text.slice(start, end)
      this.drawTextFFI.call(this, selectedText, x + start, y, selectionFg, selectionBg, attributes)
    }

    if (end < text.length) {
      const afterText = text.slice(end)
      this.drawTextFFI.call(this, afterText, x + end, y, fg, bg, attributes)
    }
  }

  public fillRect(x: number, y: number, width: number, height: number, bg: RGBA): void {
    if (this.useFFI) {
      this.fillRectFFI(x, y, width, height, bg)
    } else {
      this.fillRectLocal(x, y, width, height, bg)
    }
  }

  public fillRectLocal(x: number, y: number, width: number, height: number, bg: RGBA): void {
    const startX = Math.max(0, x)
    const startY = Math.max(0, y)
    const endX = Math.min(this.width - 1, x + width - 1)
    const endY = Math.min(this.height - 1, y + height - 1)

    if (startX > endX || startY > endY) return

    const hasAlpha = isRGBAWithAlpha(bg)

    if (hasAlpha) {
      const fg = RGBA.fromValues(1.0, 1.0, 1.0, 1.0)
      for (let fillY = startY; fillY <= endY; fillY++) {
        for (let fillX = startX; fillX <= endX; fillX++) {
          this.setCellWithAlphaBlending(fillX, fillY, " ", fg, bg, 0)
        }
      }
    } else {
      for (let fillY = startY; fillY <= endY; fillY++) {
        for (let fillX = startX; fillX <= endX; fillX++) {
          const index = this.coordsToIndex(fillX, fillY)
          const colorIndex = index * 4

          this.buffer.char[index] = " ".charCodeAt(0)
          this.buffer.attributes[index] = 0

          this.buffer.fg[colorIndex] = 1.0
          this.buffer.fg[colorIndex + 1] = 1.0
          this.buffer.fg[colorIndex + 2] = 1.0
          this.buffer.fg[colorIndex + 3] = 1.0

          this.buffer.bg[colorIndex] = bg.r
          this.buffer.bg[colorIndex + 1] = bg.g
          this.buffer.bg[colorIndex + 2] = bg.b
          this.buffer.bg[colorIndex + 3] = bg.a
        }
      }
    }
  }

  public drawFrameBuffer(
    destX: number,
    destY: number,
    frameBuffer: OptimizedBuffer,
    sourceX?: number,
    sourceY?: number,
    sourceWidth?: number,
    sourceHeight?: number,
  ): void {
    // Prefer FFI for framebuffer drawing
    this.drawFrameBufferFFI(destX, destY, frameBuffer, sourceX, sourceY, sourceWidth, sourceHeight)
  }

  // TODO: REMOVE -- ffi only
  // @deprecated
  public drawFrameBufferLocal(
    destX: number,
    destY: number,
    frameBuffer: OptimizedBuffer,
    sourceX?: number,
    sourceY?: number,
    sourceWidth?: number,
    sourceHeight?: number,
  ): void {
    const srcX = sourceX ?? 0
    const srcY = sourceY ?? 0
    const srcWidth = sourceWidth ?? frameBuffer.width
    const srcHeight = sourceHeight ?? frameBuffer.height

    if (srcX >= frameBuffer.width || srcY >= frameBuffer.height) return
    if (srcWidth === 0 || srcHeight === 0) return

    const clampedSrcWidth = Math.min(srcWidth, frameBuffer.width - srcX)
    const clampedSrcHeight = Math.min(srcHeight, frameBuffer.height - srcY)

    const startDestX = Math.max(0, destX)
    const startDestY = Math.max(0, destY)
    const endDestX = Math.min(this._width - 1, destX + clampedSrcWidth - 1)
    const endDestY = Math.min(this._height - 1, destY + clampedSrcHeight - 1)

    if (!frameBuffer.respectAlpha) {
      for (let dY = startDestY; dY <= endDestY; dY++) {
        for (let dX = startDestX; dX <= endDestX; dX++) {
          const relativeDestX = dX - destX
          const relativeDestY = dY - destY
          const sX = srcX + relativeDestX
          const sY = srcY + relativeDestY

          if (sX >= frameBuffer.width || sY >= frameBuffer.height) continue

          const destIndex = this.coordsToIndex(dX, dY)
          const srcIndex = frameBuffer.coordsToIndex(sX, sY)

          const destColorIndex = destIndex * 4
          const srcColorIndex = srcIndex * 4

          // Copy character and attributes
          this.buffer.char[destIndex] = frameBuffer.buffer.char[srcIndex]
          this.buffer.attributes[destIndex] = frameBuffer.buffer.attributes[srcIndex]

          // Copy foreground color
          this.buffer.fg[destColorIndex] = frameBuffer.buffer.fg[srcColorIndex]
          this.buffer.fg[destColorIndex + 1] = frameBuffer.buffer.fg[srcColorIndex + 1]
          this.buffer.fg[destColorIndex + 2] = frameBuffer.buffer.fg[srcColorIndex + 2]
          this.buffer.fg[destColorIndex + 3] = frameBuffer.buffer.fg[srcColorIndex + 3]

          // Copy background color
          this.buffer.bg[destColorIndex] = frameBuffer.buffer.bg[srcColorIndex]
          this.buffer.bg[destColorIndex + 1] = frameBuffer.buffer.bg[srcColorIndex + 1]
          this.buffer.bg[destColorIndex + 2] = frameBuffer.buffer.bg[srcColorIndex + 2]
          this.buffer.bg[destColorIndex + 3] = frameBuffer.buffer.bg[srcColorIndex + 3]
        }
      }
      return
    }

    for (let dY = startDestY; dY <= endDestY; dY++) {
      for (let dX = startDestX; dX <= endDestX; dX++) {
        const relativeDestX = dX - destX
        const relativeDestY = dY - destY
        const sX = srcX + relativeDestX
        const sY = srcY + relativeDestY

        if (sX >= frameBuffer.width || sY >= frameBuffer.height) continue

        const srcIndex = frameBuffer.coordsToIndex(sX, sY)
        const srcColorIndex = srcIndex * 4

        if (frameBuffer.buffer.bg[srcColorIndex + 3] === 0 && frameBuffer.buffer.fg[srcColorIndex + 3] === 0) {
          continue
        }

        const charCode = frameBuffer.buffer.char[srcIndex]
        const fg: RGBA = RGBA.fromArray(frameBuffer.buffer.fg.slice(srcColorIndex, srcColorIndex + 4))
        const bg: RGBA = RGBA.fromArray(frameBuffer.buffer.bg.slice(srcColorIndex, srcColorIndex + 4))
        const attributes = frameBuffer.buffer.attributes[srcIndex]

        this.setCellWithAlphaBlending(dX, dY, String.fromCharCode(charCode), fg, bg, attributes)
      }
    }
  }

  public destroy(): void {
    this.lib.destroyOptimizedBuffer(this.bufferPtr)
  }

  public drawTextBuffer(
    textBuffer: TextBuffer,
    x: number,
    y: number,
    clipRect?: { x: number; y: number; width: number; height: number },
  ): void {
    // Use native implementation
    this.lib.bufferDrawTextBuffer(this.bufferPtr, textBuffer.ptr, x, y, clipRect)
  }

  public drawSuperSampleBuffer(
    x: number,
    y: number,
    pixelDataPtr: Pointer,
    pixelDataLength: number,
    format: "bgra8unorm" | "rgba8unorm",
    alignedBytesPerRow: number,
  ): void {
    // Prefer FFI for super sample buffer drawing
    this.drawSuperSampleBufferFFI(x, y, pixelDataPtr, pixelDataLength, format, alignedBytesPerRow)
  }

  //
  // FFI
  //

  public drawSuperSampleBufferFFI(
    x: number,
    y: number,
    pixelDataPtr: Pointer,
    pixelDataLength: number,
    format: "bgra8unorm" | "rgba8unorm",
    alignedBytesPerRow: number,
  ): void {
    this.lib.bufferDrawSuperSampleBuffer(
      this.bufferPtr,
      x,
      y,
      pixelDataPtr,
      pixelDataLength,
      format,
      alignedBytesPerRow,
    )
  }

  public drawPackedBuffer(
    dataPtr: Pointer,
    dataLen: number,
    posX: number,
    posY: number,
    terminalWidthCells: number,
    terminalHeightCells: number,
  ): void {
    this.lib.bufferDrawPackedBuffer(
      this.bufferPtr,
      dataPtr,
      dataLen,
      posX,
      posY,
      terminalWidthCells,
      terminalHeightCells,
    )
  }

  public setCellWithAlphaBlendingFFI(
    x: number,
    y: number,
    char: string,
    fg: RGBA,
    bg: RGBA,
    attributes?: number,
  ): void {
    this.lib.bufferSetCellWithAlphaBlending(this.bufferPtr, x, y, char, fg, bg, attributes)
  }

  public fillRectFFI(x: number, y: number, width: number, height: number, bg: RGBA): void {
    this.lib.bufferFillRect(this.bufferPtr, x, y, width, height, bg)
  }

  public resize(width: number, height: number): void {
    if (this._width === width && this._height === height) return

    this._width = width
    this._height = height

    this.buffer = this.lib.bufferResize(this.bufferPtr, width, height)
  }

  public clearFFI(bg: RGBA = RGBA.fromValues(0, 0, 0, 1)): void {
    this.lib.bufferClear(this.bufferPtr, bg)
  }

  public drawTextFFI(
    text: string,
    x: number,
    y: number,
    fg: RGBA = RGBA.fromValues(1.0, 1.0, 1.0, 1.0),
    bg?: RGBA,
    attributes: number = 0,
  ): void {
    this.lib.bufferDrawText(this.bufferPtr, text, x, y, fg, bg, attributes)
  }

  public drawFrameBufferFFI(
    destX: number,
    destY: number,
    frameBuffer: OptimizedBuffer,
    sourceX?: number,
    sourceY?: number,
    sourceWidth?: number,
    sourceHeight?: number,
  ): void {
    this.lib.drawFrameBuffer(this.bufferPtr, destX, destY, frameBuffer.ptr, sourceX, sourceY, sourceWidth, sourceHeight)
  }

  public drawBox(options: {
    x: number
    y: number
    width: number
    height: number
    borderStyle?: BorderStyle
    customBorderChars?: Uint32Array
    border: boolean | BorderSides[]
    borderColor: RGBA
    backgroundColor: RGBA
    shouldFill?: boolean
    title?: string
    titleAlignment?: "left" | "center" | "right"
  }): void {
    const style = options.borderStyle || "single"
    const borderChars: Uint32Array = options.customBorderChars ?? BorderCharArrays[style]

    const packedOptions = packDrawOptions(options.border, options.shouldFill ?? false, options.titleAlignment || "left")

    this.lib.bufferDrawBox(
      this.bufferPtr,
      options.x,
      options.y,
      options.width,
      options.height,
      borderChars,
      packedOptions,
      options.borderColor,
      options.backgroundColor,
      options.title ?? null,
    )
  }

  public pushScissorRect(x: number, y: number, width: number, height: number): void {
    this.lib.bufferPushScissorRect(this.bufferPtr, x, y, width, height)
  }

  public popScissorRect(): void {
    this.lib.bufferPopScissorRect(this.bufferPtr)
  }

  public clearScissorRects(): void {
    this.lib.bufferClearScissorRects(this.bufferPtr)
  }
}
