import { Edge, Gutter } from "yoga-layout"
import { type RenderableOptions, Renderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import {
  type BorderCharacters,
  type BorderSides,
  type BorderSidesConfig,
  type BorderStyle,
  borderCharsToArray,
  getBorderSides,
  parseBorderStyle,
} from "../lib/index.js"
import { type ColorInput, RGBA, parseColor } from "../lib/RGBA.js"
import { isValidPercentage } from "../lib/renderable.validations.js"
import type { RenderContext } from "../types.js"

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function intersectRects(a: Rect, b: Rect): Rect | null {
  const startX = Math.max(a.x, b.x)
  const startY = Math.max(a.y, b.y)
  const endX = Math.min(a.x + a.width - 1, b.x + b.width - 1)
  const endY = Math.min(a.y + a.height - 1, b.y + b.height - 1)

  if (startX > endX || startY > endY) {
    return null
  }

  return {
    x: startX,
    y: startY,
    width: endX - startX + 1,
    height: endY - startY + 1,
  }
}
export interface BoxOptions<TRenderable extends Renderable = BoxRenderable> extends RenderableOptions<TRenderable> {
  backgroundColor?: string | RGBA
  borderStyle?: BorderStyle
  border?: boolean | BorderSides[]
  borderColor?: string | RGBA
  customBorderChars?: BorderCharacters
  shouldFill?: boolean
  title?: string
  titleAlignment?: "left" | "center" | "right"
  bottomTitle?: string
  bottomTitleAlignment?: "left" | "center" | "right"
  focusedBorderColor?: ColorInput
  focusable?: boolean
  gap?: number | `${number}%`
  rowGap?: number | `${number}%`
  columnGap?: number | `${number}%`
}

function isGapType(value: any): value is number | undefined {
  if (value === undefined) {
    return true
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    return true
  }
  return isValidPercentage(value)
}

export class BoxRenderable extends Renderable {
  protected _backgroundColor: RGBA
  protected _border: boolean | BorderSides[]
  protected _borderStyle: BorderStyle
  protected _borderColor: RGBA
  protected _focusedBorderColor: RGBA
  private _customBorderCharsObj: BorderCharacters | undefined
  protected _customBorderChars?: Uint32Array
  protected borderSides: BorderSidesConfig
  public shouldFill: boolean
  protected _title?: string
  protected _titleAlignment: "left" | "center" | "right"
  protected _bottomTitle?: string
  protected _bottomTitleAlignment: "left" | "center" | "right"
  private suppressFillDuringFrameBufferRender = false

  protected _defaultOptions = {
    backgroundColor: "transparent",
    borderStyle: "single",
    border: false,
    borderColor: "#FFFFFF",
    shouldFill: true,
    titleAlignment: "left",
    bottomTitleAlignment: "left",
    focusedBorderColor: "#00AAFF",
  } satisfies Partial<BoxOptions>

  constructor(ctx: RenderContext, options: BoxOptions) {
    super(ctx, options)

    if (options.focusable === true) {
      this._focusable = true
    }

    this._backgroundColor = parseColor(options.backgroundColor || this._defaultOptions.backgroundColor)
    this._border = options.border ?? this._defaultOptions.border
    if (
      !options.border &&
      (options.borderStyle || options.borderColor || options.focusedBorderColor || options.customBorderChars)
    ) {
      this._border = true
    }
    this._borderStyle = parseBorderStyle(options.borderStyle, this._defaultOptions.borderStyle)
    this._borderColor = parseColor(options.borderColor || this._defaultOptions.borderColor)
    this._focusedBorderColor = parseColor(options.focusedBorderColor || this._defaultOptions.focusedBorderColor)
    this._customBorderCharsObj = options.customBorderChars
    this._customBorderChars = this._customBorderCharsObj ? borderCharsToArray(this._customBorderCharsObj) : undefined
    this.borderSides = getBorderSides(this._border)
    this.shouldFill = options.shouldFill ?? this._defaultOptions.shouldFill
    this._title = options.title
    this._titleAlignment = options.titleAlignment || this._defaultOptions.titleAlignment
    this._bottomTitle = options.bottomTitle
    this._bottomTitleAlignment = options.bottomTitleAlignment || this._defaultOptions.bottomTitleAlignment

    this.applyYogaBorders()

    const hasInitialGapProps =
      options.gap !== undefined || options.rowGap !== undefined || options.columnGap !== undefined
    if (hasInitialGapProps) {
      this.applyYogaGap(options)
    }
  }

  private initializeBorder(): void {
    // https://github.com/anomalyco/opentui/issues/186
    // Solid-js reconciler does not pass props to constructor on init,
    // so we need to initialize the border when supporting properties are set.
    // borderStyle, borderColor, focusedBorderColor
    if (this._border === false) {
      this._border = true
      this.borderSides = getBorderSides(this._border)
      this.applyYogaBorders()
    }
  }

  public get customBorderChars(): BorderCharacters | undefined {
    return this._customBorderCharsObj
  }

  public set customBorderChars(value: BorderCharacters | undefined) {
    this._customBorderCharsObj = value
    this._customBorderChars = value ? borderCharsToArray(value) : undefined
    this.requestRender()
  }

  public get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  public set backgroundColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? this._defaultOptions.backgroundColor)
    if (this._backgroundColor !== newColor) {
      this._backgroundColor = newColor
      this.requestRender()
    }
  }

  public get border(): boolean | BorderSides[] {
    return this._border
  }

  public set border(value: boolean | BorderSides[]) {
    if (this._border !== value) {
      this._border = value
      this.borderSides = getBorderSides(value)
      this.applyYogaBorders()
      this.requestRender()
    }
  }

  public get borderStyle(): BorderStyle {
    return this._borderStyle
  }

  public set borderStyle(value: BorderStyle) {
    const _value = parseBorderStyle(value, this._defaultOptions.borderStyle)
    if (this._borderStyle !== _value || !this._border) {
      this._borderStyle = _value
      this._customBorderChars = undefined
      this.initializeBorder()
      this.requestRender()
    }
  }

  public get borderColor(): RGBA {
    return this._borderColor
  }

  public set borderColor(value: RGBA | string) {
    const newColor = parseColor(value ?? this._defaultOptions.borderColor)
    if (this._borderColor !== newColor) {
      this._borderColor = newColor
      this.initializeBorder()
      this.requestRender()
    }
  }

  public get focusedBorderColor(): RGBA {
    return this._focusedBorderColor
  }

  public set focusedBorderColor(value: RGBA | string) {
    const newColor = parseColor(value ?? this._defaultOptions.focusedBorderColor)
    if (this._focusedBorderColor !== newColor) {
      this._focusedBorderColor = newColor
      this.initializeBorder()
      if (this._focused) {
        this.requestRender()
      }
    }
  }

  public get title(): string | undefined {
    return this._title
  }

  public set title(value: string | undefined) {
    if (this._title !== value) {
      this._title = value
      this.requestRender()
    }
  }

  public get titleAlignment(): "left" | "center" | "right" {
    return this._titleAlignment
  }

  public set titleAlignment(value: "left" | "center" | "right") {
    if (this._titleAlignment !== value) {
      this._titleAlignment = value
      this.requestRender()
    }
  }

  public get bottomTitle(): string | undefined {
    return this._bottomTitle
  }

  public set bottomTitle(value: string | undefined) {
    if (this._bottomTitle !== value) {
      this._bottomTitle = value
      this.requestRender()
    }
  }

  public get bottomTitleAlignment(): "left" | "center" | "right" {
    return this._bottomTitleAlignment
  }

  public set bottomTitleAlignment(value: "left" | "center" | "right") {
    if (this._bottomTitleAlignment !== value) {
      this._bottomTitleAlignment = value
      this.requestRender()
    }
  }

  public override render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.buffered || !this.frameBuffer) {
      this.renderToBuffer(buffer, deltaTime)
      this.markClean()
      this._ctx.addToHitGrid(this.x, this.y, this.width, this.height, this.num)
      return
    }

    if (this.shouldBypassFrameBuffer(buffer)) {
      this.renderToBuffer(buffer, deltaTime)
      this.markClean()
      this._ctx.addToHitGrid(this.x, this.y, this.width, this.height, this.num)
      return
    }

    if (this.shouldClearFrameBufferBeforeRender(buffer)) {
      // Only reset retained contents when this box would otherwise alpha-blend
      // onto its own previous framebuffer output.
      this.frameBuffer.clear(RGBA.fromValues(0, 0, 0, 0))
    }
    const shouldRenderFillDirectly = this.shouldRenderFillDirectly(buffer)
    const shouldRenderBeforeUnderDirectFill = shouldRenderFillDirectly && !!this.renderBefore
    if (shouldRenderBeforeUnderDirectFill) {
      // renderBefore still belongs beneath the direct translucent fill, so
      // draw it from the framebuffer first, then clear before the main pass.
      this.renderBefore!.call(this, this.frameBuffer, deltaTime)
      buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
      this.frameBuffer.clear(RGBA.fromValues(0, 0, 0, 0))
    }
    if (shouldRenderFillDirectly) {
      this.renderFill(buffer)
      this.suppressFillDuringFrameBufferRender = true
    }
    this.renderToBuffer(this.frameBuffer, deltaTime, {
      skipRenderBefore: shouldRenderBeforeUnderDirectFill,
    })
    this.markClean()
    this._ctx.addToHitGrid(this.x, this.y, this.width, this.height, this.num)
    buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
  }

  protected renderSelf(buffer: OptimizedBuffer, _deltaTime: number): void {
    const hasBorder = this.borderSides.top || this.borderSides.right || this.borderSides.bottom || this.borderSides.left
    const hasVisibleFill = this.shouldFill && this._backgroundColor.a * buffer.getCurrentOpacity() > 0
    if (!hasBorder && !hasVisibleFill) {
      return
    }

    const hasFocusWithin = this._focusable && (this._focused || this._hasFocusedDescendant)
    const currentBorderColor = hasFocusWithin ? this._focusedBorderColor : this._borderColor
    const { x, y } = this.getRenderOrigin(buffer)
    if (!this.suppressFillDuringFrameBufferRender) {
      this.renderFill(buffer)
    }
    if (!hasBorder) {
      return
    }

    buffer.drawBox({
      x,
      y,
      width: this.width,
      height: this.height,
      borderStyle: this._borderStyle,
      customBorderChars: this._customBorderChars,
      border: this._border,
      borderColor: currentBorderColor,
      backgroundColor: this._backgroundColor,
      shouldFill: false,
      title: this._title,
      titleAlignment: this._titleAlignment,
      bottomTitle: this._bottomTitle,
      bottomTitleAlignment: this._bottomTitleAlignment,
    })
  }

  private shouldBypassFrameBuffer(buffer: OptimizedBuffer): boolean {
    if (!this.buffered || !this.frameBuffer) {
      return false
    }

    // Bypass is only safe for the plain Box path. Hooks or renderSelf
    // overrides depend on framebuffer-local ordering/coordinates.
    if (this.renderBefore || this.renderAfter) {
      return false
    }

    const resolvedRenderSelf = Object.getPrototypeOf(this).renderSelf
    if (resolvedRenderSelf !== BoxRenderable.prototype.renderSelf) {
      return false
    }

    const hasFocusWithin = this._focusable && (this._focused || this._hasFocusedDescendant)
    const currentBorderColor = hasFocusWithin ? this._focusedBorderColor : this._borderColor
    return this._backgroundColor.a < 1 || currentBorderColor.a < 1 || buffer.getCurrentOpacity() < 1
  }

  private shouldClearFrameBufferBeforeRender(buffer: OptimizedBuffer): boolean {
    const hasFocusWithin = this._focusable && (this._focused || this._hasFocusedDescendant)
    const currentBorderColor = hasFocusWithin ? this._focusedBorderColor : this._borderColor
    return this._backgroundColor.a < 1 || currentBorderColor.a < 1 || buffer.getCurrentOpacity() < 1
  }

  private shouldRenderFillDirectly(buffer: OptimizedBuffer): boolean {
    return this._backgroundColor.a < 1 || buffer.getCurrentOpacity() < 1
  }

  private renderToBuffer(
    buffer: OptimizedBuffer,
    deltaTime: number,
    options: { skipRenderBefore?: boolean } = {},
  ): void {
    try {
      if (!options.skipRenderBefore && this.renderBefore) {
        this.renderBefore.call(this, buffer, deltaTime)
      }

      this.renderSelf(buffer, deltaTime)

      if (this.renderAfter) {
        this.renderAfter.call(this, buffer, deltaTime)
      }
    } finally {
      this.suppressFillDuringFrameBufferRender = false
    }
  }
  private isRenderingToOwnFrameBuffer(buffer: OptimizedBuffer): boolean {
    return this.buffered && this.frameBuffer === buffer
  }

  private getRenderOrigin(buffer: OptimizedBuffer): { x: number; y: number } {
    if (this.isRenderingToOwnFrameBuffer(buffer)) {
      return { x: 0, y: 0 }
    }

    return { x: this.x, y: this.y }
  }

  // Translucent fills use a hybrid strategy: clip any wide spans crossed by
  // the perimeter so the box edge stays straight, but use the normal fill
  // path in the interior so fully enclosed wide text can still show through.
  private renderFill(buffer: OptimizedBuffer): void {
    if (!this.shouldFill || this.width <= 0 || this.height <= 0) {
      return
    }

    if (this._backgroundColor.a * buffer.getCurrentOpacity() <= 0) {
      return
    }

    const fillRect = this.getClippedFillRect(buffer)
    if (!fillRect) {
      return
    }

    const backgroundIsTranslucent = this._backgroundColor.a < 1 || buffer.getCurrentOpacity() < 1
    if (!backgroundIsTranslucent) {
      buffer.fillRect(fillRect.x, fillRect.y, fillRect.width, fillRect.height, this._backgroundColor)
      return
    }

    // When the visible fill collapses to a 1- or 2-cell band, keep the normal
    // preserved-fill behavior instead of turning the whole box into an edge
    // clipping pass. This matters for boxes clipped by the viewport.
    if (fillRect.width <= 2 || fillRect.height <= 2) {
      buffer.fillRect(fillRect.x, fillRect.y, fillRect.width, fillRect.height, this._backgroundColor)
      return
    }

    buffer.fillRectClipWideGraphemes(fillRect.x, fillRect.y, fillRect.width, 1, this._backgroundColor)
    buffer.fillRectClipWideGraphemes(
      fillRect.x,
      fillRect.y + fillRect.height - 1,
      fillRect.width,
      1,
      this._backgroundColor,
    )
    buffer.fillRectClipWideGraphemes(fillRect.x, fillRect.y + 1, 1, fillRect.height - 2, this._backgroundColor)
    buffer.fillRectClipWideGraphemes(
      fillRect.x + fillRect.width - 1,
      fillRect.y + 1,
      1,
      fillRect.height - 2,
      this._backgroundColor,
    )
    buffer.fillRect(fillRect.x + 1, fillRect.y + 1, fillRect.width - 2, fillRect.height - 2, this._backgroundColor)
  }

  private getClippedFillRect(buffer: OptimizedBuffer): Rect | null {
    const leftInset = this.borderSides.left ? 1 : 0
    const rightInset = this.borderSides.right ? 1 : 0
    const topInset = this.borderSides.top ? 1 : 0
    const bottomInset = this.borderSides.bottom ? 1 : 0

    const rectWidth = this.width - leftInset - rightInset
    const rectHeight = this.height - topInset - bottomInset
    if (rectWidth <= 0 || rectHeight <= 0) {
      return null
    }

    const { x, y } = this.getRenderOrigin(buffer)
    const requestedRect = {
      x: x + leftInset,
      y: y + topInset,
      width: rectWidth,
      height: rectHeight,
    }
    const visibleClipRect = this.getVisibleClipRect(buffer)
    if (!visibleClipRect) {
      return null
    }

    return intersectRects(requestedRect, visibleClipRect)
  }

  private getVisibleClipRect(buffer: OptimizedBuffer): Rect | null {
    if (this.isRenderingToOwnFrameBuffer(buffer)) {
      return {
        x: 0,
        y: 0,
        width: buffer.width,
        height: buffer.height,
      }
    }

    let clipRect: Rect = {
      x: 0,
      y: 0,
      width: buffer.width,
      height: buffer.height,
    }

    let ancestor = this.parent
    while (ancestor) {
      if (ancestor.overflow !== "visible" && ancestor.width > 0 && ancestor.height > 0) {
        const ancestorClipRect = ancestor.getOverflowClipRect()
        const nextClipRect = intersectRects(clipRect, ancestorClipRect)
        if (!nextClipRect) {
          return null
        }
        clipRect = nextClipRect
      }

      ancestor = ancestor.parent
    }

    return clipRect
  }

  protected getScissorRect(): { x: number; y: number; width: number; height: number } {
    const baseRect = super.getScissorRect()

    if (!this.borderSides.top && !this.borderSides.right && !this.borderSides.bottom && !this.borderSides.left) {
      return baseRect
    }

    const leftInset = this.borderSides.left ? 1 : 0
    const rightInset = this.borderSides.right ? 1 : 0
    const topInset = this.borderSides.top ? 1 : 0
    const bottomInset = this.borderSides.bottom ? 1 : 0

    return {
      x: baseRect.x + leftInset,
      y: baseRect.y + topInset,
      width: Math.max(0, baseRect.width - leftInset - rightInset),
      height: Math.max(0, baseRect.height - topInset - bottomInset),
    }
  }

  private applyYogaBorders(): void {
    const node = this.yogaNode
    node.setBorder(Edge.Left, this.borderSides.left ? 1 : 0)
    node.setBorder(Edge.Right, this.borderSides.right ? 1 : 0)
    node.setBorder(Edge.Top, this.borderSides.top ? 1 : 0)
    node.setBorder(Edge.Bottom, this.borderSides.bottom ? 1 : 0)
    this.requestRender()
  }

  private applyYogaGap(options: BoxOptions): void {
    const node = this.yogaNode

    if (isGapType(options.gap)) {
      node.setGap(Gutter.All, options.gap)
    }

    if (isGapType(options.rowGap)) {
      node.setGap(Gutter.Row, options.rowGap)
    }

    if (isGapType(options.columnGap)) {
      node.setGap(Gutter.Column, options.columnGap)
    }
  }

  public set gap(gap: number | `${number}%` | undefined) {
    if (isGapType(gap)) {
      this.yogaNode.setGap(Gutter.All, gap)
      this.requestRender()
    }
  }

  public set rowGap(rowGap: number | `${number}%` | undefined) {
    if (isGapType(rowGap)) {
      this.yogaNode.setGap(Gutter.Row, rowGap)
      this.requestRender()
    }
  }

  public set columnGap(columnGap: number | `${number}%` | undefined) {
    if (isGapType(columnGap)) {
      this.yogaNode.setGap(Gutter.Column, columnGap)
      this.requestRender()
    }
  }
}
