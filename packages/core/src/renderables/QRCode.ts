import { MeasureMode } from "yoga-layout"
import type { OptimizedBuffer } from "../buffer.js"
import { parseColor, RGBA, type ColorInput } from "../lib/RGBA.js"
import { encodeQRCode, type EncodedQRCode, type QRErrorCorrectionLevel } from "../lib/qrcode.js"
import { Renderable, type RenderableOptions } from "../Renderable.js"
import type { RenderContext } from "../types.js"

const DEFAULT_FOREGROUND = RGBA.fromHex("#000000")
const DEFAULT_BACKGROUND = RGBA.fromHex("#ffffff")

export type QRCodeFitMode = "contain" | "none"

export interface QRCodeOptions extends RenderableOptions<QRCodeRenderable> {
  content?: string
  errorCorrectionLevel?: QRErrorCorrectionLevel
  quietZone?: number
  scale?: number
  fit?: QRCodeFitMode
  foregroundColor?: ColorInput
  backgroundColor?: ColorInput
}

export class QRCodeRenderable extends Renderable {
  protected static readonly _defaultOptions = {
    content: "",
    errorCorrectionLevel: "medium" as QRErrorCorrectionLevel,
    quietZone: 4,
    scale: 1,
    fit: "contain" as QRCodeFitMode,
    foregroundColor: DEFAULT_FOREGROUND,
    backgroundColor: DEFAULT_BACKGROUND,
  } satisfies Partial<QRCodeOptions>

  private _content: string
  private _errorCorrectionLevel: QRErrorCorrectionLevel
  private _quietZone: number
  private _scale: number
  private _fit: QRCodeFitMode
  private _foregroundColor: RGBA
  private _backgroundColor: RGBA
  private encoded: EncodedQRCode

  constructor(ctx: RenderContext, options: QRCodeOptions = {}) {
    const defaults = QRCodeRenderable._defaultOptions
    const content = options.content ?? defaults.content
    const errorCorrectionLevel = options.errorCorrectionLevel ?? defaults.errorCorrectionLevel
    const quietZone = normalizeQuietZone(options.quietZone ?? defaults.quietZone!)
    const scale = normalizeScale(options.scale ?? defaults.scale!)
    const fit = options.fit ?? defaults.fit
    const encoded = encodeQRCode(content, errorCorrectionLevel)

    super(ctx, {
      ...options,
    })

    this._content = content
    this._errorCorrectionLevel = errorCorrectionLevel
    this._quietZone = quietZone
    this._scale = scale
    this._fit = fit
    this._foregroundColor = options.foregroundColor ? parseColor(options.foregroundColor) : defaults.foregroundColor
    this._backgroundColor = options.backgroundColor ? parseColor(options.backgroundColor) : defaults.backgroundColor
    this.encoded = encoded

    this.setupMeasureFunc()
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
    this.remeasure()
  }

  public get fit(): QRCodeFitMode {
    return this._fit
  }

  public set fit(value: QRCodeFitMode) {
    if (value === this._fit) {
      return
    }

    this._fit = value
    this.remeasure()
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

    const totalModules = this.encoded.size + this._quietZone * 2
    const effectiveScale = this.resolveRenderScale(this.width, this.height)

    if (effectiveScale <= 0) {
      return
    }

    const renderWidth = totalModules * effectiveScale
    const renderHeightPixels = totalModules * effectiveScale
    const xOffset = Math.max(0, Math.floor((this.width - renderWidth) / 2))
    const yOffsetPixels = Math.max(0, Math.floor((this.height * 2 - renderHeightPixels) / 2))

    for (let cellY = 0; cellY < this.height; cellY++) {
      const topPixel = cellY * 2 - yOffsetPixels
      const bottomPixel = topPixel + 1
      const intersectsRenderY = bottomPixel >= 0 && topPixel < renderHeightPixels

      if (intersectsRenderY) {
        buffer.fillRect(this.x + xOffset, this.y + cellY, renderWidth, 1, this._backgroundColor)
      }

      for (let cellX = 0; cellX < renderWidth; cellX++) {
        const top = this.isDarkAtScaledPixel(cellX, topPixel, effectiveScale)
        const bottom = this.isDarkAtScaledPixel(cellX, bottomPixel, effectiveScale)

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
    this.remeasure()
  }

  private remeasure(): void {
    this.yogaNode.markDirty()
    this.requestRender()
  }

  private setupMeasureFunc(): void {
    this.yogaNode.setMeasureFunc((width, widthMode, height, heightMode) => {
      const scale = this.resolveMeasuredScale(width, widthMode, height, heightMode)
      if (scale > 0) {
        return getDimensionsForScale(this.encoded.size, this._quietZone, scale)
      }

      const minimumDimensions = getDimensionsForScale(this.encoded.size, this._quietZone, 1)
      return {
        width:
          widthMode === MeasureMode.Undefined || Number.isNaN(width)
            ? minimumDimensions.width
            : Math.min(Math.max(0, Math.floor(width)), minimumDimensions.width),
        height:
          heightMode === MeasureMode.Undefined || Number.isNaN(height)
            ? minimumDimensions.height
            : Math.min(Math.max(0, Math.floor(height)), minimumDimensions.height),
      }
    })
  }

  private resolveMeasuredScale(width: number, widthMode: MeasureMode, height: number, heightMode: MeasureMode): number {
    const availableWidth = widthMode === MeasureMode.Undefined || Number.isNaN(width) ? undefined : Math.floor(width)
    const availableHeight =
      heightMode === MeasureMode.Undefined || Number.isNaN(height) ? undefined : Math.floor(height)
    return this.resolveScaleForBounds(availableWidth, availableHeight)
  }

  private resolveRenderScale(width: number, height: number): number {
    return this.resolveScaleForBounds(width, height)
  }

  private resolveScaleForBounds(availableWidth?: number, availableHeight?: number): number {
    if (this._fit === "none") {
      return this._scale
    }

    const totalModules = this.encoded.size + this._quietZone * 2
    let scale = this._scale

    if (availableWidth !== undefined) {
      scale = Math.min(scale, Math.floor(availableWidth / totalModules))
    }

    if (availableHeight !== undefined) {
      scale = Math.min(scale, Math.floor((availableHeight * 2) / totalModules))
    }

    return Math.max(0, scale)
  }

  private isDarkAtScaledPixel(renderPixelX: number, renderPixelY: number, scale: number): boolean {
    if (renderPixelX < 0 || renderPixelY < 0) {
      return false
    }

    const moduleX = Math.floor(renderPixelX / scale) - this._quietZone
    const moduleY = Math.floor(renderPixelY / scale) - this._quietZone

    if (moduleX < 0 || moduleY < 0 || moduleX >= this.encoded.size || moduleY >= this.encoded.size) {
      return false
    }

    return this.encoded.modules[moduleY]![moduleX]!
  }
}

function getDimensionsForScale(
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
