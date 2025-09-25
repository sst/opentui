import { Renderable, type RenderableOptions } from "../Renderable"
import { convertGlobalToLocalSelection, Selection, type LocalSelectionBounds } from "../lib/selection"
import { TextBuffer, type TextChunk } from "../text-buffer"
import { RGBA, parseColor } from "../lib/RGBA"
import { type RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { MeasureMode } from "yoga-layout"
import type { LineInfo } from "../zig"

export interface TextBufferOptions extends RenderableOptions<TextBufferRenderable> {
  fg?: string | RGBA
  bg?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
  attributes?: number
  wrap?: boolean
  wrapMode?: "char" | "word"
}

export abstract class TextBufferRenderable extends Renderable {
  public selectable: boolean = true

  protected _defaultFg: RGBA
  protected _defaultBg: RGBA
  protected _defaultAttributes: number
  protected _selectionBg: RGBA | undefined
  protected _selectionFg: RGBA | undefined
  protected _wrap: boolean = false
  protected _wrapMode: "char" | "word" = "word"
  protected lastLocalSelection: LocalSelectionBounds | null = null

  protected textBuffer: TextBuffer
  protected _lineInfo: LineInfo = { lineStarts: [], lineWidths: [], maxLineWidth: 0 }

  protected _defaultOptions = {
    fg: RGBA.fromValues(1, 1, 1, 1),
    bg: RGBA.fromValues(0, 0, 0, 0),
    selectionBg: undefined,
    selectionFg: undefined,
    selectable: true,
    attributes: 0,
    wrap: true,
    wrapMode: "word" as "char" | "word",
  } satisfies Partial<TextBufferOptions>

  constructor(ctx: RenderContext, options: TextBufferOptions) {
    super(ctx, options)

    this._defaultFg = parseColor(options.fg ?? this._defaultOptions.fg)
    this._defaultBg = parseColor(options.bg ?? this._defaultOptions.bg)
    this._defaultAttributes = options.attributes ?? this._defaultOptions.attributes
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : this._defaultOptions.selectionBg
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : this._defaultOptions.selectionFg
    this.selectable = options.selectable ?? this._defaultOptions.selectable
    this._wrap = options.wrap ?? this._defaultOptions.wrap
    this._wrapMode = options.wrapMode ?? this._defaultOptions.wrapMode

    this.textBuffer = TextBuffer.create(this._ctx.widthMethod)

    this.textBuffer.setWrapMode(this._wrapMode)
    this.setupMeasureFunc()

    this.textBuffer.setDefaultFg(this._defaultFg)
    this.textBuffer.setDefaultBg(this._defaultBg)
    this.textBuffer.setDefaultAttributes(this._defaultAttributes)

    if (this._wrap && this.width > 0) {
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

  get wrap(): boolean {
    return this._wrap
  }

  set wrap(value: boolean) {
    if (this._wrap !== value) {
      this._wrap = value
      // Set or clear wrap width based on current setting
      this.textBuffer.setWrapWidth(this._wrap ? this.width : null)
      this.requestRender()
    }
  }

  get wrapMode(): "char" | "word" {
    return this._wrapMode
  }

  set wrapMode(value: "char" | "word") {
    if (this._wrapMode !== value) {
      this._wrapMode = value
      this.textBuffer.setWrapMode(this._wrapMode)
      this.requestRender()
    }
  }

  protected onResize(width: number, height: number): void {
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
      this.textBuffer.resetLocalSelection()
      return true
    }

    return this.textBuffer.setLocalSelection(
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
      const changed = this.updateLocalSelection(this.lastLocalSelection)
      if (changed) {
        this.requestRender()
      }
    }

    this.yogaNode.markDirty()
    this.requestRender()
  }

  private updateLineInfo(): void {
    const lineInfo = this.textBuffer.lineInfo
    this._lineInfo.lineStarts = lineInfo.lineStarts
    this._lineInfo.lineWidths = lineInfo.lineWidths
    this._lineInfo.maxLineWidth = lineInfo.maxLineWidth
  }

  private updateWrapWidth(width: number): void {
    this.textBuffer.setWrapWidth(width)
    this.updateLineInfo()
  }

  private setupMeasureFunc(): void {
    const measureFunc = (
      width: number,
      widthMode: MeasureMode,
      height: number,
      heightMode: MeasureMode,
    ): { width: number; height: number } => {
      if (this._wrap && this.width !== width) {
        this.updateWrapWidth(width)
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

  insertChunk(chunk: TextChunk, index?: number): void {
    this.textBuffer.insertChunkGroup(
      index ?? this.textBuffer.chunkGroupCount,
      chunk.text,
      chunk.fg,
      chunk.bg,
      chunk.attributes,
    )
    this.updateTextInfo()
  }

  removeChunk(index: number): void {
    this.textBuffer.removeChunkGroup(index)
    this.updateTextInfo()
  }

  replaceChunk(index: number, chunk: TextChunk): void {
    this.textBuffer.replaceChunkGroup(index, chunk.text, chunk.fg, chunk.bg, chunk.attributes)
    this.updateTextInfo()
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
    return this.textBuffer.getSelectedText()
  }

  hasSelection(): boolean {
    return this.textBuffer.hasSelection()
  }

  getSelection(): { start: number; end: number } | null {
    return this.textBuffer.getSelection()
  }

  render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible) return

    this.markClean()
    this._ctx.addToHitGrid(this.x, this.y, this.width, this.height, this.num)

    this.renderSelf(buffer)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this.textBuffer.ptr) {
      const clipRect = {
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
      }

      buffer.drawTextBuffer(this.textBuffer, this.x, this.y, clipRect)
    }
  }

  destroy(): void {
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
