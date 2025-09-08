import { Renderable, type RenderableOptions } from "../Renderable"
import { convertGlobalToLocalSelection, Selection, type LocalSelectionBounds } from "../lib/selection"
import { stringToStyledText, StyledText } from "../lib/styled-text"
import { TextBuffer, type TextChunk } from "../text-buffer"
import { RGBA, parseColor } from "../lib/RGBA"
import { type RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { MeasureMode } from "yoga-layout"

export interface TextOptions extends RenderableOptions<TextRenderable> {
  content?: StyledText | string
  fg?: string | RGBA
  bg?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
  attributes?: number
}

export class TextRenderable extends Renderable {
  public selectable: boolean = true
  private _text: StyledText
  private _defaultFg: RGBA
  private _defaultBg: RGBA
  private _defaultAttributes: number
  private _selectionBg: RGBA | undefined
  private _selectionFg: RGBA | undefined
  private lastLocalSelection: LocalSelectionBounds | null = null

  private textBuffer: TextBuffer
  private _lineInfo: { lineStarts: number[]; lineWidths: number[] } = { lineStarts: [], lineWidths: [] }

  protected _defaultOptions = {
    content: "",
    fg: RGBA.fromValues(1, 1, 1, 1),
    bg: RGBA.fromValues(0, 0, 0, 0),
    selectionBg: undefined,
    selectionFg: undefined,
    selectable: true,
    attributes: 0,
  } satisfies Partial<TextOptions>

  constructor(ctx: RenderContext, options: TextOptions) {
    super(ctx, options)

    const content = options.content ?? this._defaultOptions.content
    const styledText = typeof content === "string" ? stringToStyledText(content) : content
    this._text = styledText
    this._defaultFg = parseColor(options.fg ?? this._defaultOptions.fg)
    this._defaultBg = parseColor(options.bg ?? this._defaultOptions.bg)
    this._defaultAttributes = options.attributes ?? this._defaultOptions.attributes
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : this._defaultOptions.selectionBg
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : this._defaultOptions.selectionFg
    this.selectable = options.selectable ?? this._defaultOptions.selectable

    this.textBuffer = TextBuffer.create(64, this._ctx.widthMethod)

    this.textBuffer.setDefaultFg(this._defaultFg)
    this.textBuffer.setDefaultBg(this._defaultBg)
    this.textBuffer.setDefaultAttributes(this._defaultAttributes)

    this.setupMeasureFunc()
    this.updateTextBuffer(styledText)
    this._text.mount(this)
    this.updateTextInfo()
  }

  private updateTextBuffer(styledText: StyledText): void {
    this.textBuffer.setStyledText(styledText)
    this.clearChunks(styledText)
  }

  private clearChunks(styledText: StyledText): void {
    // Clearing chunks that were already writtend to the text buffer,
    // to not retain references to the text data in js
    styledText.chunks.forEach((chunk) => {
      // @ts-ignore
      chunk.text = undefined
      // @ts-ignore
      chunk.plainText = undefined
    })
  }

  get content(): StyledText {
    return this._text
  }

  get plainText(): string {
    return this.textBuffer.getPlainText()
  }

  get textLength(): number {
    return this.textBuffer.length
  }

  get chunks(): TextChunk[] {
    return this._text.chunks
  }

  set content(value: StyledText | string) {
    const styledText = typeof value === "string" ? stringToStyledText(value) : value
    if (this._text !== styledText) {
      this._text = styledText
      styledText.mount(this)
      this.updateTextBuffer(styledText)
      this.updateTextInfo()
    }
  }

  get fg(): RGBA {
    return this._defaultFg
  }

  set fg(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? this._defaultOptions.fg)
    if (this._defaultFg !== newColor) {
      this._defaultFg = newColor
      this.textBuffer.setDefaultFg(this._defaultFg)
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

  private updateTextInfo(): void {
    const lineInfo = this.textBuffer.lineInfo
    this._lineInfo.lineStarts = lineInfo.lineStarts
    this._lineInfo.lineWidths = lineInfo.lineWidths

    if (this.lastLocalSelection) {
      const changed = this.updateLocalSelection(this.lastLocalSelection)
      if (changed) {
        this.requestRender()
      }
    }

    this.layoutNode.yogaNode.markDirty()
    this.requestRender()
  }

  private setupMeasureFunc(): void {
    const measureFunc = (
      width: number,
      widthMode: MeasureMode,
      height: number,
      heightMode: MeasureMode,
    ): { width: number; height: number } => {
      const maxLineWidth = Math.max(...this._lineInfo.lineWidths, 0)
      const numLines = this._lineInfo.lineStarts.length || 1

      let measuredWidth = maxLineWidth
      let measuredHeight = numLines

      if (widthMode === MeasureMode.Exactly) {
        measuredWidth = width
      } else if (widthMode === MeasureMode.AtMost) {
        measuredWidth = Math.min(maxLineWidth, width)
      }

      if (heightMode === MeasureMode.Exactly) {
        measuredHeight = height
      } else if (heightMode === MeasureMode.AtMost) {
        measuredHeight = Math.min(numLines, height)
      }

      return {
        width: Math.max(1, measuredWidth),
        height: Math.max(1, measuredHeight),
      }
    }

    this.layoutNode.yogaNode.setMeasureFunc(measureFunc)
  }

  insertChunk(chunk: TextChunk, index?: number): void {
    this.textBuffer.insertEncodedChunkGroup(
      index ?? this.textBuffer.chunkGroupCount,
      chunk.text,
      chunk.fg,
      chunk.bg,
      chunk.attributes,
    )
    this.updateTextInfo()
    this.clearChunks(this._text)
  }

  removeChunk(chunk: TextChunk): void {
    const index = this._text.chunks.indexOf(chunk)
    if (index === -1) return
    this.textBuffer.removeChunkGroup(index)
    this.updateTextInfo()
    this.clearChunks(this._text)
  }

  replaceChunk(chunk: TextChunk, oldChunk: TextChunk): void {
    const index = this._text.chunks.indexOf(oldChunk)

    if (index === -1) return
    this.textBuffer.replaceEncodedChunkGroup(index, chunk.text, chunk.fg, chunk.bg, chunk.attributes)
    this.updateTextInfo()
    this.clearChunks(this._text)
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
}
