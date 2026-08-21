import { Renderable, type RenderableOptions } from "../Renderable.js"
import { convertGlobalToLocalSelection, Selection, type LocalSelectionBounds } from "../lib/selection.js"
import { TextBuffer, type TextChunk } from "../text-buffer.js"
import { TextBufferView } from "../text-buffer-view.js"
import { RGBA, parseColor } from "../lib/RGBA.js"
import { type RenderContext, type LineInfoProvider } from "../types.js"
import type { OptimizedBuffer } from "../buffer.js"
import { NativeMeasureTargetKind, resolveRenderLib, type LineInfo, type NativeRenderableHandle } from "../zig.js"
import { SyntaxStyle } from "../syntax-style.js"

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
  truncate?: boolean
}

export abstract class TextBufferRenderable extends Renderable implements LineInfoProvider {
  public selectable: boolean = true

  protected _defaultFg: RGBA = RGBA.fromValues(1, 1, 1, 1)
  protected _defaultBg: RGBA = RGBA.fromValues(0, 0, 0, 0)
  protected _defaultAttributes: number = 0
  protected _selectionBg: RGBA | undefined
  protected _selectionFg: RGBA | undefined
  protected _wrapMode: "none" | "char" | "word" = "word"
  protected lastLocalSelection: LocalSelectionBounds | null = null
  protected _tabIndicator?: string | number
  protected _tabIndicatorColor?: RGBA
  protected _scrollX: number = 0
  protected _scrollY: number = 0
  protected _truncate: boolean = false
  protected _firstLineOffset: number = 0

  private _textBuffer: TextBuffer | null = null
  private _textBufferView: TextBufferView | null = null
  private _textDocumentSyntaxStyle: SyntaxStyle | null = null
  private nativeRenderable: NativeRenderableHandle | null = null
  private firstLineOffsetContext: RenderContext | null = null

  protected get textBuffer(): TextBuffer {
    if (!this._textBuffer) throw new Error("Text document state is not attached")
    return this._textBuffer
  }

  protected get textBufferView(): TextBufferView {
    if (!this._textBufferView) throw new Error("Text document state is not attached")
    return this._textBufferView
  }

  protected get _textBufferSyntaxStyle(): SyntaxStyle {
    if (!this._textDocumentSyntaxStyle) throw new Error("Text document state is not attached")
    return this._textDocumentSyntaxStyle
  }

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
    truncate: false,
  } satisfies Partial<TextBufferOptions>

  constructor(ctx: RenderContext, options: TextBufferOptions, attachTextDocumentState: boolean = true) {
    super(ctx, options)

    try {
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
      this._truncate = options.truncate ?? this._defaultOptions.truncate

      if (attachTextDocumentState) this.attachTextDocumentState()
    } catch (error) {
      try {
        super.destroy()
      } catch {}
      throw error
    }
  }

  protected get hasTextDocumentState(): boolean {
    return this._textBuffer != null
  }

  protected attachTextDocumentState(): void {
    if (this.hasTextDocumentState || this.isDestroyed) return

    let textBuffer: TextBuffer | null = null
    let textBufferView: TextBufferView | null = null
    let syntaxStyle: SyntaxStyle | null = null
    let nativeRenderable: NativeRenderableHandle | null = null
    try {
      textBuffer = TextBuffer.create(this._ctx.widthMethod)
      textBufferView = TextBufferView.create(textBuffer)
      syntaxStyle = SyntaxStyle.create()

      textBuffer.setSyntaxStyle(syntaxStyle)
      textBufferView.setWrapMode(this._wrapMode)
      nativeRenderable = this.createNativeRenderable(textBufferView)

      textBuffer.setDefaultFg(this._defaultFg)
      textBuffer.setDefaultBg(this._defaultBg)
      textBuffer.setDefaultAttributes(this._defaultAttributes)

      if (this._tabIndicator !== undefined) textBufferView.setTabIndicator(this._tabIndicator)
      if (this._tabIndicatorColor !== undefined) textBufferView.setTabIndicatorColor(this._tabIndicatorColor)
      if (this._wrapMode !== "none" && this.width > 0) textBufferView.setWrapWidth(this.width)
      if (this.width > 0 && this.height > 0) {
        textBufferView.setViewport(this._scrollX, this._scrollY, this.width, this.height)
      }
      textBufferView.setTruncate(this._truncate)

      textBufferView.setFirstLineOffset(this._firstLineOffset)

      this._textBuffer = textBuffer
      this._textBufferView = textBufferView
      this._textDocumentSyntaxStyle = syntaxStyle
      this.nativeRenderable = nativeRenderable
    } catch (error) {
      const cleanup = [
        () => nativeRenderable && resolveRenderLib().destroyNativeRenderable(nativeRenderable),
        () => textBuffer && syntaxStyle && textBuffer.setSyntaxStyle(null),
        () => syntaxStyle?.destroy(),
        () => textBufferView?.destroy(),
        () => textBuffer?.destroy(),
      ]
      for (const dispose of cleanup) {
        try {
          dispose()
        } catch {}
      }
      throw error
    }

    this.yogaNode.markDirty()
    this._ctx.requestRender()
  }

  protected detachTextDocumentState(): void {
    if (!this.hasTextDocumentState) return

    const textBuffer = this._textBuffer!
    const textBufferView = this._textBufferView!
    const syntaxStyle = this._textDocumentSyntaxStyle!
    const nativeRenderable = this.nativeRenderable
    this.nativeRenderable = null
    this._textBuffer = null
    this._textBufferView = null
    this._textDocumentSyntaxStyle = null

    const claimedContext = this.firstLineOffsetContext
    this.firstLineOffsetContext = null
    this._firstLineOffset = 0

    const cleanup = [
      () => claimedContext?.releaseFirstLineOffset?.(this),
      () => nativeRenderable && resolveRenderLib().destroyNativeRenderable(nativeRenderable),
      () => textBuffer.setSyntaxStyle(null),
      () => syntaxStyle.destroy(),
      () => textBufferView.destroy(),
      () => textBuffer.destroy(),
    ]
    let cleanupError: unknown
    for (const dispose of cleanup) {
      try {
        dispose()
      } catch (error) {
        cleanupError ??= error
      }
    }
    if (cleanupError) throw cleanupError
  }

  protected adoptTextDocumentContext(ctx: RenderContext): void {
    if (this._ctx === ctx) return
    const previousContext = this._ctx
    const wasAttached = this.hasTextDocumentState
    if (wasAttached) this.detachTextDocumentState()
    this._ctx = ctx
    if (!wasAttached) return

    try {
      this.attachTextDocumentState()
    } catch (error) {
      this._ctx = previousContext
      this.attachTextDocumentState()
      throw error
    }
  }

  public override onLayoutAttach(ctx: RenderContext): void {
    this.adoptTextDocumentContext(ctx)
    if (!this.hasTextDocumentState || this.firstLineOffsetContext === ctx) return

    const firstLineOffset = ctx.claimFirstLineOffset?.(this) ?? 0
    try {
      this.textBufferView.setFirstLineOffset(firstLineOffset)
    } catch (error) {
      try {
        ctx.releaseFirstLineOffset?.(this)
      } catch {}
      throw error
    }
    this._firstLineOffset = firstLineOffset
    this.firstLineOffsetContext = ctx
  }

  protected refreshFirstLineOffsetClaim(): void {
    const ctx = this.firstLineOffsetContext
    if (!ctx || !this.hasTextDocumentState) return
    const firstLineOffset = ctx.claimFirstLineOffset?.(this) ?? 0
    if (firstLineOffset === this._firstLineOffset) return
    this.textBufferView.setFirstLineOffset(firstLineOffset)
    this._firstLineOffset = firstLineOffset
    this.yogaNode.markDirty()
  }

  public override onLayoutDetach(_ctx: RenderContext): void {
    const claimedContext = this.firstLineOffsetContext
    this.firstLineOffsetContext = null
    this._firstLineOffset = 0

    let releaseError: unknown
    try {
      claimedContext?.releaseFirstLineOffset?.(this)
    } catch (error) {
      releaseError = error
    }
    try {
      if (this.hasTextDocumentState) this.textBufferView.setFirstLineOffset(0)
    } catch (error) {
      releaseError ??= error
    }
    if (releaseError) throw releaseError
  }

  protected onMouseEvent(event: any): void {
    if (event.type === "scroll") {
      this.handleScroll(event)
    }
  }

  protected handleScroll(event: any): void {
    if (!event.scroll) return

    const { direction, delta } = event.scroll

    if (direction === "up") {
      this.scrollY -= delta
    } else if (direction === "down") {
      this.scrollY += delta
    }

    if (this._wrapMode === "none") {
      if (direction === "left") {
        this.scrollX -= delta
      } else if (direction === "right") {
        this.scrollX += delta
      }
    }
  }

  public get lineInfo(): LineInfo {
    return this.textBufferView.logicalLineInfo
  }

  public get lineCount(): number {
    return this.textBuffer.getLineCount()
  }

  public get virtualLineCount(): number {
    return this.textBufferView.getVirtualLineCount()
  }

  public get scrollY(): number {
    return this._scrollY
  }

  public set scrollY(value: number) {
    const maxScrollY = Math.max(0, this.scrollHeight - this.height)
    const clamped = Math.max(0, Math.min(value, maxScrollY))
    if (this._scrollY !== clamped) {
      this._scrollY = clamped
      this.updateViewportOffset()
      this.requestRender()
    }
  }

  public get scrollX(): number {
    return this._scrollX
  }

  public set scrollX(value: number) {
    const maxScrollX = Math.max(0, this.scrollWidth - this.width)
    const clamped = Math.max(0, Math.min(value, maxScrollX))
    if (this._scrollX !== clamped) {
      this._scrollX = clamped
      this.updateViewportOffset()
      this.requestRender()
    }
  }

  public get scrollWidth(): number {
    return this.lineInfo.lineWidthColsMax
  }

  public get scrollHeight(): number {
    return this.lineInfo.lineStartCols.length
  }

  public get maxScrollY(): number {
    return Math.max(0, this.scrollHeight - this.height)
  }

  public get maxScrollX(): number {
    return Math.max(0, this.scrollWidth - this.width)
  }

  protected updateViewportOffset(): void {
    // Update the viewport with the new scroll position
    if (this.hasTextDocumentState && this.width > 0 && this.height > 0) {
      this.textBufferView.setViewport(this._scrollX, this._scrollY, this.width, this.height)
    }
  }

  get plainText(): string {
    return this.textBuffer.getPlainText()
  }

  get textLength(): number {
    return this.textBuffer.length
  }

  get fg(): RGBA | undefined {
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

  get bg(): RGBA | undefined {
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
      if (this.hasTextDocumentState) {
        this.textBufferView.setWrapMode(this._wrapMode)
        if (value !== "none" && this.width > 0) {
          this.textBufferView.setWrapWidth(this.width)
        }
      }
      // Inline text has no measure function; its owner is invalidated by TextRenderable.
      if (this.hasTextDocumentState) this.yogaNode.markDirty()
      this.requestRender()
    }
  }

  get tabIndicator(): string | number | undefined {
    return this._tabIndicator
  }

  set tabIndicator(value: string | number | undefined) {
    if (this._tabIndicator !== value) {
      this._tabIndicator = value
      if (value !== undefined && this.hasTextDocumentState) {
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
      if (newColor !== undefined && this.hasTextDocumentState) {
        this.textBufferView.setTabIndicatorColor(newColor)
      }
      this.requestRender()
    }
  }

  get truncate(): boolean {
    return this._truncate
  }

  set truncate(value: boolean) {
    if (this._truncate !== value) {
      this._truncate = value
      if (this.hasTextDocumentState) this.textBufferView.setTruncate(value)
      this.requestRender()
    }
  }

  protected onResize(width: number, height: number): void {
    this.textBufferView.setViewport(this._scrollX, this._scrollY, width, height)
    this.yogaNode.markDirty()
    this.requestRender()
    this.emitLineInfoChange()
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
    this.emitLineInfoChange()
  }

  protected emitLineInfoChange(): void {
    this.emit("line-info-change")
  }

  private createNativeRenderable(textBufferView: TextBufferView): NativeRenderableHandle {
    const lib = resolveRenderLib()
    // Transitional native backing: JS still owns the render tree and Yoga nodes,
    // while native owns only hot measurement state. Attach the existing JS-created
    // Yoga node for now. The intended direction is for every Renderable to become
    // native-backed and for Yoga node ownership to move native-side with it.
    const nativeRenderable = lib.createNativeRenderable()
    try {
      if (!lib.nativeRenderableAttachYogaNode(nativeRenderable, this.yogaNode.ptr)) {
        throw new Error("Failed to attach native renderable Yoga node")
      }
      if (
        !lib.nativeRenderableSetMeasureTarget(
          nativeRenderable,
          NativeMeasureTargetKind.TextBufferView,
          textBufferView.ptr,
        )
      ) {
        throw new Error("Failed to attach text buffer native measure target")
      }
      return nativeRenderable
    } catch (error) {
      try {
        lib.destroyNativeRenderable(nativeRenderable)
      } catch {}
      throw error
    }
  }

  shouldStartSelection(x: number, y: number): boolean {
    if (!this.hasTextDocumentState || !this.selectable) return false

    const localX = x - this.x
    const localY = y - this.y

    return localX >= 0 && localX < this.width && localY >= 0 && localY < this.height
  }

  onSelectionChanged(selection: Selection | null): boolean {
    if (!this.hasTextDocumentState) return false
    const localSelection = convertGlobalToLocalSelection(selection, this.x, this.y)
    this.lastLocalSelection = localSelection

    let changed: boolean
    if (!localSelection?.isActive) {
      this.textBufferView.resetLocalSelection()
      changed = true
    } else if (selection?.isStart) {
      changed = this.textBufferView.setLocalSelection(
        localSelection.anchorX,
        localSelection.anchorY,
        localSelection.focusX,
        localSelection.focusY,
        this._selectionBg,
        this._selectionFg,
      )
    } else {
      changed = this.textBufferView.updateLocalSelection(
        localSelection.anchorX,
        localSelection.anchorY,
        localSelection.focusX,
        localSelection.focusY,
        this._selectionBg,
        this._selectionFg,
      )
    }

    if (changed) {
      this.requestRender()
    }

    return this.hasSelection()
  }

  getSelectedText(): string {
    if (!this.hasTextDocumentState) return ""
    return this.textBufferView.getSelectedText()
  }

  hasSelection(): boolean {
    if (!this.hasTextDocumentState) return false
    return this.textBufferView.hasSelection()
  }

  getSelection(): { start: number; end: number } | null {
    if (!this.hasTextDocumentState) return null
    return this.textBufferView.getSelection()
  }

  render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible) return
    // Text views do enough per-frame work that avoiding recursive x/y lookups is
    // measurable; use the layout cache for hit-grid and draw entry points.
    const screenX = this._screenX
    const screenY = this._screenY

    this.markClean()
    this._ctx.addToHitGrid(screenX, screenY, this.width, this.height, this.num)

    this.renderSelf(buffer)

    if (this.buffered && this.frameBuffer) {
      buffer.drawFrameBuffer(screenX, screenY, this.frameBuffer)
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this.hasTextDocumentState && this.textBuffer.ptr) {
      buffer.drawTextBuffer(this.textBufferView, this._screenX, this._screenY)
    }
  }

  destroy(): void {
    if (this.isDestroyed) return
    let destroyError: unknown
    try {
      this.detachTextDocumentState()
    } catch (error) {
      destroyError = error
    }
    try {
      super.destroy()
    } catch (error) {
      destroyError ??= error
    }
    if (destroyError) throw destroyError
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
