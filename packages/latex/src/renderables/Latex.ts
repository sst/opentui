import { MeasureMode } from "yoga-layout"
import {
  OptimizedBuffer,
  parseColor,
  RGBA,
  Renderable,
  type ColorInput,
  type RenderableOptions,
  type RenderContext,
} from "@opentui/core"
import { renderLatexToLines, type LatexRenderMode, type LatexRenderResult } from "../lib/latex.js"

const DEFAULT_FOREGROUND = RGBA.fromValues(1, 1, 1, 1)
const DEFAULT_BACKGROUND = RGBA.fromValues(0, 0, 0, 0)
const TRANSPARENT = RGBA.fromValues(0, 0, 0, 0)

export type LatexAlign = "left" | "center" | "right"

export interface LatexOptions extends RenderableOptions<LatexRenderable> {
  content?: string
  mode?: LatexRenderMode
  fg?: ColorInput
  bg?: ColorInput
  attributes?: number
  align?: LatexAlign
  fallbackContent?: string
  fallbackColor?: ColorInput
}

interface LatexRenderableDefaults {
  content: string
  mode: LatexRenderMode
  fg: RGBA
  bg: RGBA
  attributes: number
  align: LatexAlign
  fallbackContent: string
  fallbackColor: RGBA
}

export class LatexRenderable extends Renderable {
  protected static readonly _defaultOptions = {
    content: "",
    mode: "unicode" as LatexRenderMode,
    fg: DEFAULT_FOREGROUND,
    bg: DEFAULT_BACKGROUND,
    attributes: 0,
    align: "left" as LatexAlign,
    fallbackContent: "",
    fallbackColor: DEFAULT_FOREGROUND,
  } satisfies LatexRenderableDefaults

  private _content: string
  private _mode: LatexRenderMode
  private _fg: RGBA
  private _bg: RGBA
  private _attributes: number
  private _align: LatexAlign
  private _fallbackContent: string
  private _fallbackColor: RGBA
  private renderResult: LatexRenderResult
  private renderBuffer: OptimizedBuffer | null = null
  private renderBufferDirty = true

  constructor(ctx: RenderContext, options: LatexOptions = {}) {
    super(ctx, {
      ...options,
    })

    this._content = options.content ?? LatexRenderable._defaultOptions.content
    this._mode = options.mode ?? LatexRenderable._defaultOptions.mode
    this._fg = options.fg ? parseColor(options.fg) : LatexRenderable._defaultOptions.fg
    this._bg = options.bg ? parseColor(options.bg) : LatexRenderable._defaultOptions.bg
    this._attributes = options.attributes ?? LatexRenderable._defaultOptions.attributes
    this._align = options.align ?? LatexRenderable._defaultOptions.align
    this._fallbackContent = options.fallbackContent ?? LatexRenderable._defaultOptions.fallbackContent
    this._fallbackColor = options.fallbackColor
      ? parseColor(options.fallbackColor)
      : LatexRenderable._defaultOptions.fallbackColor
    this.renderResult = renderLatexToLines(this._content, { mode: this._mode })

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
    this.rebuild()
  }

  public get mode(): LatexRenderMode {
    return this._mode
  }

  public set mode(value: LatexRenderMode) {
    if (value === this._mode) {
      return
    }

    this._mode = value
    this.rebuild()
  }

  public get fg(): RGBA {
    return this._fg
  }

  public set fg(value: ColorInput) {
    this._fg = parseColor(value)
    this.invalidateRenderBuffer()
    this.requestRender()
  }

  public get bg(): RGBA {
    return this._bg
  }

  public set bg(value: ColorInput) {
    this._bg = parseColor(value)
    this.invalidateRenderBuffer()
    this.requestRender()
  }

  public get attributes(): number {
    return this._attributes
  }

  public set attributes(value: number) {
    if (value === this._attributes) {
      return
    }

    this._attributes = value
    this.invalidateRenderBuffer()
    this.requestRender()
  }

  public get align(): LatexAlign {
    return this._align
  }

  public set align(value: LatexAlign) {
    if (value === this._align) {
      return
    }

    this._align = value
    this.invalidateRenderBuffer()
    this.requestRender()
  }

  public get fallbackContent(): string {
    return this._fallbackContent
  }

  public set fallbackContent(value: string) {
    if (value === this._fallbackContent) {
      return
    }

    this._fallbackContent = value
    this.yogaNode.markDirty()
    this.invalidateRenderBuffer()
    this.requestRender()
  }

  public get fallbackColor(): RGBA {
    return this._fallbackColor
  }

  public set fallbackColor(value: ColorInput) {
    this._fallbackColor = parseColor(value)
    this.invalidateRenderBuffer()
    this.requestRender()
  }

  public get lines(): readonly string[] {
    return this.renderResult.lines
  }

  public get plainText(): string {
    return this.renderResult.text
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (this.width <= 0 || this.height <= 0) {
      return
    }

    const renderBuffer = this.getRenderBuffer()
    if (this.renderBufferDirty) {
      this.paintRenderBuffer(renderBuffer)
      this.renderBufferDirty = false
    }

    if (this.buffered) {
      buffer.clear(TRANSPARENT)
      buffer.drawFrameBuffer(0, 0, renderBuffer)
      return
    }

    buffer.drawFrameBuffer(this._screenX, this._screenY, renderBuffer)
  }

  protected override onResize(width: number, height: number): void {
    this.invalidateRenderBuffer()
    super.onResize(width, height)
  }

  protected override destroySelf(): void {
    this.renderBuffer?.destroy()
    this.renderBuffer = null
    super.destroySelf()
  }

  private paintRenderBuffer(buffer: OptimizedBuffer): void {
    buffer.clear(this._bg.a > 0 ? this._bg : TRANSPARENT)

    const lines = this.getRenderableLines()
    const color = lines === this.renderResult.lines ? this._fg : this._fallbackColor
    const yOffset = Math.max(0, Math.floor((this.height - lines.length) / 2))

    for (let y = 0; y < lines.length && y + yOffset < this.height; y++) {
      const line = lines[y] ?? ""
      const xOffset = this.resolveXOffset(line)

      buffer.drawText(sliceToWidth(line, this.width), xOffset, y + yOffset, color, this._bg, this._attributes)
    }
  }

  private getRenderableLines(): readonly string[] {
    if (this.renderResult.width <= this.width && this.renderResult.height <= this.height) {
      return this.renderResult.lines
    }

    if (this._fallbackContent.length > 0) {
      return [this._fallbackContent]
    }

    return this.renderResult.lines
  }

  private resolveXOffset(line: string): number {
    const lineWidth = displayWidth(line)

    if (this._align === "center") {
      return Math.max(0, Math.floor((this.width - lineWidth) / 2))
    }

    if (this._align === "right") {
      return Math.max(0, this.width - lineWidth)
    }

    return 0
  }

  private rebuild(): void {
    this.renderResult = renderLatexToLines(this._content, { mode: this._mode })
    this.yogaNode.markDirty()
    this.invalidateRenderBuffer()
    this.requestRender()
  }

  private invalidateRenderBuffer(): void {
    this.renderBufferDirty = true
  }

  private getRenderBuffer(): OptimizedBuffer {
    if (this.renderBuffer) {
      if (this.renderBuffer.width !== this.width || this.renderBuffer.height !== this.height) {
        this.renderBuffer.resize(this.width, this.height)
        this.invalidateRenderBuffer()
      }

      return this.renderBuffer
    }

    this.renderBuffer = OptimizedBuffer.create(this.width, this.height, this._ctx.widthMethod, {
      respectAlpha: true,
      id: `latex-renderable-${this.id}`,
    })
    this.invalidateRenderBuffer()
    return this.renderBuffer
  }

  private setupMeasureFunc(): void {
    this.yogaNode.setMeasureFunc((width, widthMode, height, heightMode) => {
      const intrinsicWidth = Math.max(1, this.renderResult.width)
      const intrinsicHeight = Math.max(1, this.renderResult.height)
      const fallbackWidth = this._fallbackContent.length
      const measuredWidth =
        widthMode === MeasureMode.AtMost && this._positionType !== "absolute"
          ? Math.min(Math.floor(width), intrinsicWidth)
          : intrinsicWidth
      const measuredHeight =
        heightMode === MeasureMode.AtMost && this._positionType !== "absolute"
          ? Math.min(Math.floor(height), intrinsicHeight)
          : intrinsicHeight

      if ((measuredWidth <= 0 || measuredHeight <= 0) && fallbackWidth > 0) {
        return {
          width: fallbackWidth,
          height: 1,
        }
      }

      return {
        width: Math.max(1, measuredWidth),
        height: Math.max(1, measuredHeight),
      }
    })
  }
}

function sliceToWidth(value: string, width: number): string {
  return [...value].slice(0, Math.max(0, width)).join("")
}

function displayWidth(value: string): number {
  return [...value].length
}
