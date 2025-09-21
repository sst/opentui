import { BaseRenderable, Renderable, type RenderableOptions } from "../Renderable"
import { convertGlobalToLocalSelection, Selection, type LocalSelectionBounds } from "../lib/selection"
import { stringToStyledText, StyledText } from "../lib/styled-text"
import { TextBuffer, type TextChunk } from "../text-buffer"
import { RGBA, parseColor } from "../lib/RGBA"
import { type RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { Direction, MeasureMode } from "yoga-layout"
import { isTextNodeRenderable, RootTextNodeRenderable, TextNodeRenderable } from "./TextNode"
import type { LineInfo } from "../zig"

export interface TextOptions extends RenderableOptions<TextRenderable> {
  content?: StyledText | string
  fg?: string | RGBA
  bg?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
  attributes?: number
  wrap?: boolean
  wrapMode?: "char" | "word"
}

export class TextRenderable extends Renderable {
  public selectable: boolean = true
  private _text: StyledText
  private _defaultFg: RGBA
  private _defaultBg: RGBA
  private _defaultAttributes: number
  private _selectionBg: RGBA | undefined
  private _selectionFg: RGBA | undefined
  private _wrap: boolean = false
  private _wrapMode: "char" | "word" = "word"
  private lastLocalSelection: LocalSelectionBounds | null = null

  private textBuffer: TextBuffer
  private _lineInfo: LineInfo = { lineStarts: [], lineWidths: [], maxLineWidth: 0 }

  protected rootTextNode: RootTextNodeRenderable

  protected _defaultOptions = {
    content: "",
    fg: RGBA.fromValues(1, 1, 1, 1),
    bg: RGBA.fromValues(0, 0, 0, 0),
    selectionBg: undefined,
    selectionFg: undefined,
    selectable: true,
    attributes: 0,
    wrap: true,
    wrapMode: "word" as "char" | "word",
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
    this._wrap = options.wrap ?? this._defaultOptions.wrap
    this._wrapMode = options.wrapMode ?? this._defaultOptions.wrapMode

    this.textBuffer = TextBuffer.create(this._ctx.widthMethod)

    // Set wrap mode
    this.textBuffer.setWrapMode(this._wrapMode)

    // Set initial wrap width if wrapping is enabled
    if (this._wrap) {
      this.textBuffer.setWrapWidth(this.width > 0 ? this.width : 40) // Default to 40 if width not set yet
    }

    this.textBuffer.setDefaultFg(this._defaultFg)
    this.textBuffer.setDefaultBg(this._defaultBg)
    this.textBuffer.setDefaultAttributes(this._defaultAttributes)

    this.setupMeasureFunc()

    this.rootTextNode = new RootTextNodeRenderable(
      ctx,
      {
        id: `${this.id}-root`,
        fg: this._defaultFg,
        bg: this._defaultBg,
        attributes: this._defaultAttributes,
      },
      this,
    )

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
    // TODO: This is causing issues in the solid renderer
    // styledText.chunks.forEach((chunk) => {
    //   // @ts-ignore
    //   chunk.text = undefined
    // })
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

  get textNode(): RootTextNodeRenderable {
    return this.rootTextNode
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
    this.rootTextNode.fg = newColor
    if (this._defaultFg !== newColor) {
      this._defaultFg = newColor
      this.textBuffer.setDefaultFg(this._defaultFg)
      this.rootTextNode.fg = newColor
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
    this.rootTextNode.bg = newColor
    if (this._defaultBg !== newColor) {
      this._defaultBg = newColor
      this.textBuffer.setDefaultBg(this._defaultBg)
      this.rootTextNode.bg = newColor
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
      this.rootTextNode.attributes = value
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
    if (this._wrap) {
      this.textBuffer.setWrapWidth(width)
      this.updateTextInfo()
    } else if (this.lastLocalSelection) {
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
    this._lineInfo.maxLineWidth = lineInfo.maxLineWidth

    if (this.lastLocalSelection) {
      const changed = this.updateLocalSelection(this.lastLocalSelection)
      if (changed) {
        this.requestRender()
      }
    }

    this.yogaNode.markDirty()
    this.requestRender()
  }

  private setupMeasureFunc(): void {
    const measureFunc = (
      width: number,
      widthMode: MeasureMode,
      height: number,
      heightMode: MeasureMode,
    ): { width: number; height: number } => {
      const maxLineWidth = this._lineInfo.maxLineWidth
      const numLines = this._lineInfo.lineStarts.length

      let measuredWidth = maxLineWidth
      let measuredHeight = numLines

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
    this.textBuffer.replaceChunkGroup(index, chunk.text, chunk.fg, chunk.bg, chunk.attributes)
    this.updateTextInfo()
    this.clearChunks(this._text)
  }

  private updateTextFromNodes(): void {
    if (this.rootTextNode.isDirty) {
      const chunks = this.rootTextNode.gatherWithInheritedStyle({
        fg: this._defaultFg,
        bg: this._defaultBg,
        attributes: this._defaultAttributes,
      })
      this.textBuffer.setStyledText(new StyledText(chunks))
      this.updateTextInfo()
    }
  }

  public add(obj: TextNodeRenderable | StyledText | string, index?: number): number {
    return this.rootTextNode.add(obj, index)
  }

  public remove(id: string): void {
    const child = this.rootTextNode.getRenderable(id)
    if (child && isTextNodeRenderable(child)) {
      this.rootTextNode.remove(child)
    }
  }

  public insertBefore(obj: BaseRenderable | any, anchor?: TextNodeRenderable): number {
    this.rootTextNode.insertBefore(obj, anchor)
    return this.rootTextNode.children.indexOf(obj)
  }

  public getTextChildren(): BaseRenderable[] {
    return this.rootTextNode.getChildren()
  }

  public clear(): void {
    this.rootTextNode.clear()

    const emptyStyledText = stringToStyledText("")
    this._text = emptyStyledText
    emptyStyledText.mount(this)
    this.updateTextBuffer(emptyStyledText)
    this.updateTextInfo()

    this.requestRender()
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

  public onLifecyclePass = () => {
    this.updateTextFromNodes()
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
    this.rootTextNode.children.length = 0
    super.destroy()
  }
}
