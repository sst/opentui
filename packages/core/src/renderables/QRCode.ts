import type { OptimizedBuffer } from "../buffer.js"
import { parseColor, RGBA, type ColorInput } from "../lib/RGBA.js"
import { encodeQRCode, type EncodedQRCode, type QRErrorCorrectionLevel } from "../lib/qrcode.js"
import { Renderable, type RenderableOptions } from "../Renderable.js"
import type { RenderContext } from "../types.js"

const DEFAULT_FOREGROUND = RGBA.fromHex("#000000")
const DEFAULT_BACKGROUND = RGBA.fromHex("#ffffff")

export interface QRCodeOptions extends Omit<RenderableOptions<QRCodeRenderable>, "width" | "height"> {
  content?: string
  errorCorrectionLevel?: QRErrorCorrectionLevel
  quietZone?: number
  scale?: number
  foregroundColor?: ColorInput
  backgroundColor?: ColorInput
}

export class QRCodeRenderable extends Renderable {
  protected static readonly _defaultOptions = {
    content: "",
    errorCorrectionLevel: "medium" as QRErrorCorrectionLevel,
    quietZone: 4,
    scale: 1,
    foregroundColor: DEFAULT_FOREGROUND,
    backgroundColor: DEFAULT_BACKGROUND,
  } satisfies Partial<QRCodeOptions>

  private _content: string
  private _errorCorrectionLevel: QRErrorCorrectionLevel
  private _quietZone: number
  private _scale: number
  private _foregroundColor: RGBA
  private _backgroundColor: RGBA
  private encoded: EncodedQRCode

  constructor(ctx: RenderContext, options: QRCodeOptions = {}) {
    const defaults = QRCodeRenderable._defaultOptions
    const content = options.content ?? defaults.content
    const errorCorrectionLevel = options.errorCorrectionLevel ?? defaults.errorCorrectionLevel
    const quietZone = normalizeQuietZone(options.quietZone ?? defaults.quietZone!)
    const scale = normalizeScale(options.scale ?? defaults.scale!)
    const encoded = encodeQRCode(content, errorCorrectionLevel)
    const dimensions = getIntrinsicDimensions(encoded.size, quietZone, scale)

    super(ctx, {
      flexShrink: 0,
      ...options,
      width: dimensions.width,
      height: dimensions.height,
    })

    this._content = content
    this._errorCorrectionLevel = errorCorrectionLevel
    this._quietZone = quietZone
    this._scale = scale
    this._foregroundColor = options.foregroundColor ? parseColor(options.foregroundColor) : defaults.foregroundColor
    this._backgroundColor = options.backgroundColor ? parseColor(options.backgroundColor) : defaults.backgroundColor
    this.encoded = encoded
  }

  public get content(): string {
    return this._content
  }

  public set content(value: string) {
    if (value === this._content) {
      return
    }

    this._content = value
    this.rebuildMatrix()
  }

  public get errorCorrectionLevel(): QRErrorCorrectionLevel {
    return this._errorCorrectionLevel
  }

  public set errorCorrectionLevel(value: QRErrorCorrectionLevel) {
    if (value === this._errorCorrectionLevel) {
      return
    }

    this._errorCorrectionLevel = value
    this.rebuildMatrix()
  }

  public get quietZone(): number {
    return this._quietZone
  }

  public set quietZone(value: number) {
    const nextQuietZone = normalizeQuietZone(value)
    if (nextQuietZone === this._quietZone) {
      return
    }

    this._quietZone = nextQuietZone
    this.updateIntrinsicSize()
  }

  public get scale(): number {
    return this._scale
  }

  public set scale(value: number) {
    const nextScale = normalizeScale(value)
    if (nextScale === this._scale) {
      return
    }

    this._scale = nextScale
    this.updateIntrinsicSize()
  }

  public get foregroundColor(): RGBA {
    return this._foregroundColor
  }

  public set foregroundColor(value: ColorInput) {
    this._foregroundColor = parseColor(value)
    this.requestRender()
  }

  public get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  public set backgroundColor(value: ColorInput) {
    this._backgroundColor = parseColor(value)
    this.requestRender()
  }

  public get version(): number {
    return this.encoded.version
  }

  public get moduleCount(): number {
    return this.encoded.size
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (this.width <= 0 || this.height <= 0) {
      return
    }

    buffer.fillRect(this.x, this.y, this.width, this.height, this._backgroundColor)

    const totalModules = this.encoded.size + this._quietZone * 2
    const renderWidth = totalModules * this._scale
    const renderHeightPixels = totalModules * this._scale
    const xOffset = Math.max(0, Math.floor((this.width - renderWidth) / 2))
    const yOffsetPixels = Math.max(0, Math.floor((this.height * 2 - renderHeightPixels) / 2))

    for (let cellY = 0; cellY < this.height; cellY++) {
      const topPixel = cellY * 2 - yOffsetPixels
      const bottomPixel = topPixel + 1

      for (let cellX = 0; cellX < renderWidth; cellX++) {
        const top = this.isDarkAtScaledPixel(cellX, topPixel)
        const bottom = this.isDarkAtScaledPixel(cellX, bottomPixel)

        if (!top && !bottom) {
          continue
        }

        buffer.setCell(
          this.x + xOffset + cellX,
          this.y + cellY,
          getBlockCharacter(top, bottom),
          this._foregroundColor,
          this._backgroundColor,
        )
      }
    }
  }

  private rebuildMatrix(): void {
    this.encoded = encodeQRCode(this._content, this._errorCorrectionLevel)
    this.updateIntrinsicSize()
  }

  private updateIntrinsicSize(): void {
    const dimensions = getIntrinsicDimensions(this.encoded.size, this._quietZone, this._scale)
    this.width = dimensions.width
    this.height = dimensions.height
    this.requestRender()
  }

  private isDarkAtScaledPixel(renderPixelX: number, renderPixelY: number): boolean {
    if (renderPixelX < 0 || renderPixelY < 0) {
      return false
    }

    const moduleX = Math.floor(renderPixelX / this._scale) - this._quietZone
    const moduleY = Math.floor(renderPixelY / this._scale) - this._quietZone

    if (moduleX < 0 || moduleY < 0 || moduleX >= this.encoded.size || moduleY >= this.encoded.size) {
      return false
    }

    return this.encoded.modules[moduleY]![moduleX]!
  }
}

function getIntrinsicDimensions(
  moduleCount: number,
  quietZone: number,
  scale: number,
): { width: number; height: number } {
  const totalModules = (moduleCount + quietZone * 2) * scale

  return {
    width: totalModules,
    height: Math.max(1, Math.ceil(totalModules / 2)),
  }
}

function getBlockCharacter(top: boolean, bottom: boolean): string {
  if (top && bottom) {
    return "█"
  }

  if (top) {
    return "▀"
  }

  return "▄"
}

function normalizeQuietZone(value: number): number {
  if (!Number.isFinite(value)) {
    return 4
  }

  return Math.max(0, Math.floor(value))
}

function normalizeScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.max(1, Math.floor(value))
}
