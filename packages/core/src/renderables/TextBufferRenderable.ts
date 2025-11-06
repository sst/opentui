import { Renderable, type RenderableOptions } from "../Renderable"
import { convertGlobalToLocalSelection, Selection, type LocalSelectionBounds } from "../lib/selection"
import { TextBuffer, type TextChunk } from "../text-buffer"
import { TextBufferView } from "../text-buffer-view"
import { RGBA, parseColor } from "../lib/RGBA"
import { type RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { MeasureMode } from "yoga-layout"
import type { LineInfo } from "../zig"
import { SyntaxStyle } from "../syntax-style"

export interface TextBufferOptions extends RenderableOptions<TextBufferRenderable> {
  fg?: string | RGBA
  bg?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
  attributes?: number
  wrapMode?: "none" | "char" | "word"
  tabIndicator?: string | number
  tabIndicatorColor?: string | RGBA
}

export abstract class TextBufferRenderable extends Renderable {
  public selectable: boolean = true

  protected _defaultFg: RGBA
  protected _defaultBg: RGBA
  protected _defaultAttributes: number
  protected _selectionBg: RGBA | undefined
  protected _selectionFg: RGBA | undefined
  protected _wrapMode: "none" | "char" | "word" = "word"
  protected lastLocalSelection: LocalSelectionBounds | null = null
  protected _tabIndicator?: string | number
  protected _tabIndicatorColor?: RGBA

  protected textBuffer: TextBuffer
  protected textBufferView: TextBufferView
  protected _lineInfo: LineInfo = { lineStarts: [], lineWidths: [], maxLineWidth: 0 }

  protected _defaultOptions = {
    fg: RGBA.fromValues(1, 1, 1, 1),
    bg: RGBA.fromValues(0, 0, 0, 0),
    selectionBg: undefined,
    selectionFg: undefined,
    selectable: true,
    attributes: 0,
    wrapMode: "word" as "none" | "char" | "word",
    tabIndicator: undefined,
    tabIndicatorColor: undefined,
  } satisfies Partial<TextBufferOptions>

  constructor(ctx: RenderContext, options: TextBufferOptions) {
    super(ctx, options)

    this._defaultFg = parseColor(options.fg ?? this._defaultOptions.fg)
    this._defaultBg = parseColor(options.bg ?? this._defaultOptions.bg)
    this._defaultAttributes = options.attributes ?? this._defaultOptions.attributes
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : this._defaultOptions.selectionBg
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : this._defaultOptions.selectionFg
    this.selectable = options.selectable ?? this._defaultOptions.selectable
    this._wrapMode = options.wrapMode ?? this._defaultOptions.wrapMode
    this._tabIndicator = options.tabIndicator ?? this._defaultOptions.tabIndicator
    this._tabIndicatorColor = options.tabIndicatorColor
      ? parseColor(options.tabIndicatorColor)
      : this._defaultOptions.tabIndicatorColor

    this.textBuffer = TextBuffer.create(this._ctx.widthMethod)
    this.textBufferView = TextBufferView.create(this.textBuffer)

    const style = SyntaxStyle.create()
    this.textBuffer.setSyntaxStyle(style)

    this.textBufferView.setWrapMode(this._wrapMode)
    this.setupMeasureFunc()

    this.textBuffer.setDefaultFg(this._defaultFg)
    this.textBuffer.setDefaultBg(this._defaultBg)
    this.textBuffer.setDefaultAttributes(this._defaultAttributes)

    if (this._tabIndicator !== undefined) {
      this.textBufferView.setTabIndicator(this._tabIndicator)
    }
    if (this._tabIndicatorColor !== undefined) {
      this.textBufferView.setTabIndicatorColor(this._tabIndicatorColor)
    }

    if (this._wrapMode !== "none" && this.width > 0) {
      this.updateWrapWidth(this.width)
    }

    this.updateTextInfo()
  }

  get plainText(): string {
    return this.textBuffer.getPlainText()
  }

  get textLength(): number {
    return this.textBuffer.length
  }

  get fg(): RGBA {
    return this._defaultFg
  }

  set fg(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? this._defaultOptions.fg)
    if (this._defaultFg !== newColor) {
      this._defaultFg = newColor
      this.textBuffer.setDefaultFg(this._defaultFg)
      this.onFgChanged(newColor)
      this.requestRender()
    }
  }

  get selectionBg(): RGBA | undefined {
    return this._selectionBg
  }

  set selectionBg(value: RGBA | string | undefined) {
    const newColor = value ? parseColor(value) : this._defaultOptions.selectionBg
    if (this._selectionBg !== newColor) {
      this._selectionBg = newColor
      if (this.lastLocalSelection) {
        this.updateLocalSelection(this.lastLocalSelection)
      }
      this.requestRender()
    }
  }

  get selectionFg(): RGBA | undefined {
    return this._selectionFg
  }

  set selectionFg(value: RGBA | string | undefined) {
    const newColor = value ? parseColor(value) : this._defaultOptions.selectionFg
    if (this._selectionFg !== newColor) {
      this._selectionFg = newColor
      if (this.lastLocalSelection) {
        this.updateLocalSelection(this.lastLocalSelection)
      }
      this.requestRender()
    }
  }

  get bg(): RGBA {
    return this._defaultBg
  }

  set bg(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? this._defaultOptions.bg)
    if (this._defaultBg !== newColor) {
      this._defaultBg = newColor
      this.textBuffer.setDefaultBg(this._defaultBg)
      this.onBgChanged(newColor)
      this.requestRender()
    }
  }

  get attributes(): number {
    return this._defaultAttributes
  }

  set attributes(value: number) {
    if (this._defaultAttributes !== value) {
      this._defaultAttributes = value
      this.textBuffer.setDefaultAttributes(this._defaultAttributes)
      this.onAttributesChanged(value)
      this.requestRender()
    }
  }

  get wrapMode(): "none" | "char" | "word" {
    return this._wrapMode
  }

  set wrapMode(value: "none" | "char" | "word") {
    if (this._wrapMode !== value) {
      this._wrapMode = value
      this.textBufferView.setWrapMode(this._wrapMode)
      if (value !== "none" && this.width > 0) {
        this.updateWrapWidth(this.width)
      }
      // Changing wrap mode can change dimensions, so mark yoga node dirty to trigger re-measurement
      this.yogaNode.markDirty()
      this.requestRender()
    }
  }

  get tabIndicator(): string | number | undefined {
    return this._tabIndicator
  }

  set tabIndicator(value: string | number | undefined) {
    if (this._tabIndicator !== value) {
      this._tabIndicator = value
      if (value !== undefined) {
        this.textBufferView.setTabIndicator(value)
      }
      this.requestRender()
    }
  }

  get tabIndicatorColor(): RGBA | undefined {
    return this._tabIndicatorColor
  }

  set tabIndicatorColor(value: RGBA | string | undefined) {
    const newColor = value ? parseColor(value) : undefined
    if (this._tabIndicatorColor !== newColor) {
      this._tabIndicatorColor = newColor
      if (newColor !== undefined) {
        this.textBufferView.setTabIndicatorColor(newColor)
      }
      this.requestRender()
    }
  }

  protected onResize(width: number, height: number): void {
    // Update viewport size to match renderable dimensions
    this.textBufferView.setViewportSize(width, height)

    if (this.lastLocalSelection) {
      const changed = this.updateLocalSelection(this.lastLocalSelection)
      if (changed) {
        this.requestRender()
      }
    }
  }

  protected refreshLocalSelection(): boolean {
    if (this.lastLocalSelection) {
      return this.updateLocalSelection(this.lastLocalSelection)
    }
    return false
  }

  private updateLocalSelection(localSelection: LocalSelectionBounds | null): boolean {
    if (!localSelection?.isActive) {
      this.textBufferView.resetLocalSelection()
      return true
    }

    return this.textBufferView.setLocalSelection(
      localSelection.anchorX,
      localSelection.anchorY,
      localSelection.focusX,
      localSelection.focusY,
      this._selectionBg,
      this._selectionFg,
    )
  }

  protected updateTextInfo(): void {
    if (this.lastLocalSelection) {
      this.updateLocalSelection(this.lastLocalSelection)
    }

    this.yogaNode.markDirty()
    this.requestRender()
  }

  private updateLineInfo(): void {
    const lineInfo = this.textBufferView.logicalLineInfo
    this._lineInfo.lineStarts = lineInfo.lineStarts
    this._lineInfo.lineWidths = lineInfo.lineWidths
    this._lineInfo.maxLineWidth = lineInfo.maxLineWidth
  }

  private updateWrapWidth(width: number): void {
    this.textBufferView.setWrapWidth(width)
    this.updateLineInfo()
  }

  private setupMeasureFunc(): void {
    const measureFunc = (
      width: number,
      widthMode: MeasureMode,
      height: number,
      heightMode: MeasureMode,
    ): { width: number; height: number } => {
      // Use a reasonable default for NaN/undefined height to allow measuring content
      // This happens when Yoga calls measure with height/widthMode="Undefined" (0)
      const effectiveWidth = isNaN(width) ? 1 : width

      if (this._wrapMode !== "none" && this.width !== effectiveWidth) {
        this.updateWrapWidth(effectiveWidth)
      } else {
        this.updateLineInfo()
      }

      const measuredWidth = this._lineInfo.maxLineWidth
      const measuredHeight = this._lineInfo.lineStarts.length

      // NOTE: Yoga may use these measurements or not.
      // If the yoga node settings and the parent allow this node to grow, it will.
      return {
        width: Math.max(1, measuredWidth),
        height: Math.max(1, measuredHeight),
      }
    }

    this.yogaNode.setMeasureFunc(measureFunc)
  }

  shouldStartSelection(x: number, y: number): boolean {
    if (!this.selectable) return false

    const localX = x - this.x
    const localY = y - this.y

    return localX >= 0 && localX < this.width && localY >= 0 && localY < this.height
  }

  onSelectionChanged(selection: Selection | null): boolean {
    const localSelection = convertGlobalToLocalSelection(selection, this.x, this.y)
    this.lastLocalSelection = localSelection

    const changed = this.updateLocalSelection(localSelection)

    if (changed) {
      this.requestRender()
    }

    return this.hasSelection()
  }

  getSelectedText(): string {
    return this.textBufferView.getSelectedText()
  }

  hasSelection(): boolean {
    return this.textBufferView.hasSelection()
  }

  getSelection(): { start: number; end: number } | null {
    return this.textBufferView.getSelection()
  }

  render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible) return

    this.markClean()
    this._ctx.addToHitGrid(this.x, this.y, this.width, this.height, this.num)

    this.renderSelf(buffer)

    if (this.buffered && this.frameBuffer) {
      buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this.textBuffer.ptr) {
      buffer.drawTextBuffer(this.textBufferView, this.x, this.y)
    }
  }

  destroy(): void {
    this.textBufferView.destroy()
    this.textBuffer.destroy()
    super.destroy()
  }

  protected onFgChanged(newColor: RGBA): void {
    // Override in subclasses if needed
  }

  protected onBgChanged(newColor: RGBA): void {
    // Override in subclasses if needed
  }

  protected onAttributesChanged(newAttributes: number): void {
    // Override in subclasses if needed
  }
}
