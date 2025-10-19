import { Renderable, type RenderableOptions } from "../Renderable"
import { convertGlobalToLocalSelection, Selection, type LocalSelectionBounds } from "../lib/selection"
import { EditBuffer, type CursorPosition } from "../edit-buffer"
import { EditorView } from "../editor-view"
import { RGBA, parseColor } from "../lib/RGBA"
import { type RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { MeasureMode } from "yoga-layout"

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
  protected lastLocalSelection: LocalSelectionBounds | null = null

  public editBuffer: EditBuffer
  public editorView: EditorView

  protected _defaultOptions = {
    textColor: RGBA.fromValues(1, 1, 1, 1),
    backgroundColor: RGBA.fromValues(0, 0, 0, 0),
    selectionBg: undefined,
    selectionFg: undefined,
    selectable: true,
    attributes: 0,
    wrapMode: "word" as "none" | "char" | "word",
    scrollMargin: 0.2,
    showCursor: true,
    cursorColor: RGBA.fromValues(1, 1, 1, 1),
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

    this.editBuffer = EditBuffer.create(this._ctx.widthMethod)
    this.editorView = EditorView.create(this.editBuffer, this.width || 80, this.height || 24)

    this.editorView.setWrapMode(this._wrapMode)
    this.editorView.setScrollMargin(this._scrollMargin)

    this.setupMeasureFunc()
  }

  get plainText(): string {
    return this.editorView.getText()
  }

  get cursor(): CursorPosition {
    return this.editBuffer.getCursorPosition()
  }

  get textColor(): RGBA {
    return this._textColor
  }

  set textColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? this._defaultOptions.textColor)
    if (this._textColor !== newColor) {
      this._textColor = newColor
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
      this.requestRender()
    }
  }

  get attributes(): number {
    return this._defaultAttributes
  }

  set attributes(value: number) {
    if (this._defaultAttributes !== value) {
      this._defaultAttributes = value
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
      // Update viewport size to match measured dimensions
      this.editorView.setViewportSize(width, height)

      const vlineCount = this.editorView.getVirtualLineCount()

      return {
        width: Math.max(1, width),
        height: Math.max(1, vlineCount),
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
    if (!visualCursor) {
      this._ctx.setCursorPosition(0, 0, false)
      return
    }

    const cursorX = this.x + visualCursor.visualCol + 1 // +1 for 1-based terminal coords
    const cursorY = this.y + visualCursor.visualRow + 1 // +1 for 1-based terminal coords

    this._ctx.setCursorPosition(cursorX, cursorY, true)
    this._ctx.setCursorColor(this._cursorColor)
    this._ctx.setCursorStyle("block", true)
  }

  public focus(): void {
    super.focus()
    this._ctx.setCursorStyle("block", true)
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
    this.editorView.destroy()
    this.editBuffer.destroy()
    super.destroy()
  }
}
