import { Renderable, type RenderableOptions } from "../Renderable"
import { convertGlobalToLocalSelection, Selection, type LocalSelectionBounds } from "../lib/selection"
import { EditBuffer, type LogicalCursor } from "../edit-buffer"
import { EditorView, type VisualCursor } from "../editor-view"
import { RGBA, parseColor } from "../lib/RGBA"
import type { RenderContext, Highlight, CursorStyleOptions } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { MeasureMode } from "yoga-layout"
import type { SyntaxStyle } from "../syntax-style"

export interface CursorChangeEvent {
  line: number
  visualColumn: number
}

export interface ContentChangeEvent {
  // No payload - use getText() to retrieve content if needed
}

export interface EditBufferOptions extends RenderableOptions<EditBufferRenderable> {
  textColor?: string | RGBA
  backgroundColor?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
  attributes?: number
  wrapMode?: "none" | "char" | "word"
  scrollMargin?: number
  showCursor?: boolean
  cursorColor?: string | RGBA
  cursorStyle?: CursorStyleOptions
  syntaxStyle?: SyntaxStyle
  tabIndicator?: string | number
  tabIndicatorColor?: string | RGBA
  onCursorChange?: (event: CursorChangeEvent) => void
  onContentChange?: (event: ContentChangeEvent) => void
}

export abstract class EditBufferRenderable extends Renderable {
  protected _focusable: boolean = true
  public selectable: boolean = true

  protected _textColor: RGBA
  protected _backgroundColor: RGBA
  protected _defaultAttributes: number
  protected _selectionBg: RGBA | undefined
  protected _selectionFg: RGBA | undefined
  protected _wrapMode: "none" | "char" | "word" = "word"
  protected _scrollMargin: number = 0.2
  protected _showCursor: boolean = true
  protected _cursorColor: RGBA
  protected _cursorStyle: CursorStyleOptions
  protected lastLocalSelection: LocalSelectionBounds | null = null
  protected _tabIndicator?: string | number
  protected _tabIndicatorColor?: RGBA

  private _cursorChangeListener: ((event: CursorChangeEvent) => void) | undefined = undefined
  private _contentChangeListener: ((event: ContentChangeEvent) => void) | undefined = undefined

  public readonly editBuffer: EditBuffer
  public readonly editorView: EditorView

  protected _defaultOptions = {
    textColor: RGBA.fromValues(1, 1, 1, 1),
    backgroundColor: "transparent",
    selectionBg: undefined,
    selectionFg: undefined,
    selectable: true,
    attributes: 0,
    wrapMode: "word" as "none" | "char" | "word",
    scrollMargin: 0.2,
    showCursor: true,
    cursorColor: RGBA.fromValues(1, 1, 1, 1),
    cursorStyle: {
      style: "block",
      blinking: true,
    },
    tabIndicator: undefined,
    tabIndicatorColor: undefined,
  } satisfies Partial<EditBufferOptions>

  constructor(ctx: RenderContext, options: EditBufferOptions) {
    super(ctx, options)

    this._textColor = parseColor(options.textColor ?? this._defaultOptions.textColor)
    this._backgroundColor = parseColor(options.backgroundColor ?? this._defaultOptions.backgroundColor)
    this._defaultAttributes = options.attributes ?? this._defaultOptions.attributes
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : this._defaultOptions.selectionBg
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : this._defaultOptions.selectionFg
    this.selectable = options.selectable ?? this._defaultOptions.selectable
    this._wrapMode = options.wrapMode ?? this._defaultOptions.wrapMode
    this._scrollMargin = options.scrollMargin ?? this._defaultOptions.scrollMargin
    this._showCursor = options.showCursor ?? this._defaultOptions.showCursor
    this._cursorColor = parseColor(options.cursorColor ?? this._defaultOptions.cursorColor)
    this._cursorStyle = options.cursorStyle ?? this._defaultOptions.cursorStyle
    this._tabIndicator = options.tabIndicator ?? this._defaultOptions.tabIndicator
    this._tabIndicatorColor = options.tabIndicatorColor
      ? parseColor(options.tabIndicatorColor)
      : this._defaultOptions.tabIndicatorColor

    this.editBuffer = EditBuffer.create(this._ctx.widthMethod)
    this.editorView = EditorView.create(this.editBuffer, this.width || 80, this.height || 24)

    this.editorView.setWrapMode(this._wrapMode)
    this.editorView.setScrollMargin(this._scrollMargin)

    this.editBuffer.setDefaultFg(this._textColor)
    this.editBuffer.setDefaultBg(this._backgroundColor)
    this.editBuffer.setDefaultAttributes(this._defaultAttributes)

    if (options.syntaxStyle) {
      this.editBuffer.setSyntaxStyle(options.syntaxStyle)
    }

    if (this._tabIndicator !== undefined) {
      this.editorView.setTabIndicator(this._tabIndicator)
    }
    if (this._tabIndicatorColor !== undefined) {
      this.editorView.setTabIndicatorColor(this._tabIndicatorColor)
    }

    this.setupMeasureFunc()
    this.setupEventListeners(options)
  }

  private setupEventListeners(options: EditBufferOptions): void {
    this._cursorChangeListener = options.onCursorChange
    this._contentChangeListener = options.onContentChange

    this.editBuffer.on("cursor-changed", () => {
      if (this._cursorChangeListener) {
        const cursor = this.editBuffer.getCursorPosition()
        this._cursorChangeListener({
          line: cursor.row,
          visualColumn: cursor.col,
        })
      }
    })

    this.editBuffer.on("content-changed", () => {
      this.yogaNode.markDirty()
      this.requestRender()
      if (this._contentChangeListener) {
        this._contentChangeListener({})
      }
    })
  }

  get plainText(): string {
    return this.editBuffer.getText()
  }

  get logicalCursor(): LogicalCursor {
    return this.editBuffer.getCursorPosition()
  }

  get visualCursor(): VisualCursor {
    return this.editorView.getVisualCursor()
  }

  get cursorOffset(): number {
    return this.editorView.getVisualCursor().offset
  }

  set cursorOffset(offset: number) {
    this.editorView.setCursorByOffset(offset)
    this.requestRender()
  }

  get textColor(): RGBA {
    return this._textColor
  }

  set textColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? this._defaultOptions.textColor)
    if (this._textColor !== newColor) {
      this._textColor = newColor
      this.editBuffer.setDefaultFg(newColor)
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

  get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  set backgroundColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? this._defaultOptions.backgroundColor)
    if (this._backgroundColor !== newColor) {
      this._backgroundColor = newColor
      this.editBuffer.setDefaultBg(newColor)
      this.requestRender()
    }
  }

  get attributes(): number {
    return this._defaultAttributes
  }

  set attributes(value: number) {
    if (this._defaultAttributes !== value) {
      this._defaultAttributes = value
      this.editBuffer.setDefaultAttributes(value)
      this.requestRender()
    }
  }

  get wrapMode(): "none" | "char" | "word" {
    return this._wrapMode
  }

  set wrapMode(value: "none" | "char" | "word") {
    if (this._wrapMode !== value) {
      this._wrapMode = value
      this.editorView.setWrapMode(value)
      this.yogaNode.markDirty()
      this.requestRender()
    }
  }

  get showCursor(): boolean {
    return this._showCursor
  }

  set showCursor(value: boolean) {
    if (this._showCursor !== value) {
      this._showCursor = value
      this.requestRender()
    }
  }

  get cursorColor(): RGBA {
    return this._cursorColor
  }

  set cursorColor(value: RGBA | string) {
    const newColor = parseColor(value)
    if (this._cursorColor !== newColor) {
      this._cursorColor = newColor
      if (this._focused) {
        this.requestRender()
      }
    }
  }

  get cursorStyle(): CursorStyleOptions {
    return this._cursorStyle
  }

  set cursorStyle(style: CursorStyleOptions) {
    const newStyle = style
    if (this.cursorStyle.style !== newStyle.style || this.cursorStyle.blinking !== newStyle.blinking) {
      this._cursorStyle = newStyle
      if (this._focused) {
        this.requestRender()
      }
    }
  }

  get tabIndicator(): string | number | undefined {
    return this._tabIndicator
  }

  set tabIndicator(value: string | number | undefined) {
    if (this._tabIndicator !== value) {
      this._tabIndicator = value
      if (value !== undefined) {
        this.editorView.setTabIndicator(value)
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
        this.editorView.setTabIndicatorColor(newColor)
      }
      this.requestRender()
    }
  }

  protected onResize(width: number, height: number): void {
    this.editorView.setViewportSize(width, height)
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
      this.editorView.resetLocalSelection()
      return true
    }
    return this.editorView.setLocalSelection(
      localSelection.anchorX,
      localSelection.anchorY,
      localSelection.focusX,
      localSelection.focusY,
      this._selectionBg,
      this._selectionFg,
    )
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
    return this.editorView.getSelectedText()
  }

  hasSelection(): boolean {
    return this.editorView.hasSelection()
  }

  getSelection(): { start: number; end: number } | null {
    return this.editorView.getSelection()
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
      const effectiveHeight = isNaN(height) ? 1 : height
      const effectiveWidth = isNaN(width) ? 1 : width

      // Update viewport size to match measured dimensions
      // When wrapping and width changes, this will trigger wrap recalculation
      if (this._wrapMode !== "none" && this.width !== effectiveWidth) {
        this.editorView.setViewportSize(effectiveWidth, effectiveHeight)
      } else {
        this.editorView.setViewportSize(effectiveWidth, effectiveHeight)
      }

      const lineInfo = this.editorView.getLogicalLineInfo()
      const measuredWidth = lineInfo.maxLineWidth
      const measuredHeight = lineInfo.lineStarts.length

      return {
        width: Math.max(1, measuredWidth),
        height: Math.max(1, measuredHeight),
      }
    }

    this.yogaNode.setMeasureFunc(measureFunc)
  }

  render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible) return
    if (this.isDestroyed) return

    this.markClean()
    this._ctx.addToHitGrid(this.x, this.y, this.width, this.height, this.num)

    this.renderSelf(buffer)
    this.renderCursor(buffer)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.drawEditorView(this.editorView, this.x, this.y)
  }

  protected renderCursor(buffer: OptimizedBuffer): void {
    if (!this._showCursor || !this._focused) return

    const visualCursor = this.editorView.getVisualCursor()

    const cursorX = this.x + visualCursor.visualCol + 1 // +1 for 1-based terminal coords
    const cursorY = this.y + visualCursor.visualRow + 1 // +1 for 1-based terminal coords

    this._ctx.setCursorPosition(cursorX, cursorY, true)
    this._ctx.setCursorColor(this._cursorColor)
    this._ctx.setCursorStyle(this._cursorStyle.style, this._cursorStyle.blinking)
  }

  public focus(): void {
    super.focus()
    this._ctx.setCursorStyle(this._cursorStyle.style, this._cursorStyle.blinking)
    this._ctx.setCursorColor(this._cursorColor)
    this.requestRender()
  }

  public blur(): void {
    super.blur()
    this._ctx.setCursorPosition(0, 0, false)
    this.requestRender()
  }

  protected onRemove(): void {
    if (this._focused) {
      this._ctx.setCursorPosition(0, 0, false)
    }
  }

  destroy(): void {
    if (this._focused) {
      this._ctx.setCursorPosition(0, 0, false)
    }
    super.destroy()
    this.editorView.destroy()
    this.editBuffer.destroy()
  }

  public set onCursorChange(handler: ((event: CursorChangeEvent) => void) | undefined) {
    this._cursorChangeListener = handler
  }

  public get onCursorChange(): ((event: CursorChangeEvent) => void) | undefined {
    return this._cursorChangeListener
  }

  public set onContentChange(handler: ((event: ContentChangeEvent) => void) | undefined) {
    this._contentChangeListener = handler
  }

  public get onContentChange(): ((event: ContentChangeEvent) => void) | undefined {
    return this._contentChangeListener
  }

  get syntaxStyle(): SyntaxStyle | null {
    return this.editBuffer.getSyntaxStyle()
  }

  set syntaxStyle(style: SyntaxStyle | null) {
    this.editBuffer.setSyntaxStyle(style)
    this.requestRender()
  }

  public addHighlight(lineIdx: number, highlight: Highlight): void {
    this.editBuffer.addHighlight(lineIdx, highlight)
    this.requestRender()
  }

  public addHighlightByCharRange(highlight: Highlight): void {
    this.editBuffer.addHighlightByCharRange(highlight)
    this.requestRender()
  }

  public removeHighlightsByRef(hlRef: number): void {
    this.editBuffer.removeHighlightsByRef(hlRef)
    this.requestRender()
  }

  public clearLineHighlights(lineIdx: number): void {
    this.editBuffer.clearLineHighlights(lineIdx)
    this.requestRender()
  }

  public clearAllHighlights(): void {
    this.editBuffer.clearAllHighlights()
    this.requestRender()
  }

  public getLineHighlights(lineIdx: number): Array<Highlight> {
    return this.editBuffer.getLineHighlights(lineIdx)
  }

  public setText(text: string, opts?: { history?: boolean }): void {
    this.editBuffer.setText(text, opts)
    this.yogaNode.markDirty()
    this.requestRender()
  }

  public clear(): void {
    this.editBuffer.clear()
    this.editBuffer.clearAllHighlights()
    this.yogaNode.markDirty()
    this.requestRender()
  }

  public deleteRange(startLine: number, startCol: number, endLine: number, endCol: number): void {
    this.editBuffer.deleteRange(startLine, startCol, endLine, endCol)
    this.yogaNode.markDirty()
    this.requestRender()
  }

  public insertText(text: string): void {
    this.editBuffer.insertText(text)
    this.yogaNode.markDirty()
    this.requestRender()
  }

  public getTextRange(startOffset: number, endOffset: number): string {
    return this.editBuffer.getTextRange(startOffset, endOffset)
  }

  public getTextRangeByCoords(startRow: number, startCol: number, endRow: number, endCol: number): string {
    return this.editBuffer.getTextRangeByCoords(startRow, startCol, endRow, endCol)
  }
}
