import { parseColor, RGBA } from "../lib"
import type { ParsedKey } from "../lib/parse.keypress"
import { Renderable, type RenderableOptions } from "../Renderable"
import type { Timeout } from "../types"
import type { RenderContext } from "../types"
import { BoxRenderable, type BoxOptions } from "./Box"
import type { OptimizedBuffer } from "../buffer"

export interface ScrollBarOptions extends RenderableOptions<ScrollBarRenderable> {
  orientation: "vertical" | "horizontal"
  showArrows?: boolean
  trackOptions?: BoxOptions
  thumbOptions?: BoxOptions
  arrowOptions?: Omit<ArrowOptions, "direction">
  onChange?: (position: number) => void
}

export type ScrollUnit = "absolute" | "viewport" | "content" | "step"

const defaultThumbBackgroundColor = RGBA.fromHex("#9a9ea3")
const defaultTrackBackgroundColor = RGBA.fromHex("#252527")

export class ScrollBarRenderable extends Renderable {
  public readonly slider: SliderRenderable
  public readonly startArrow: ArrowRenderable
  public readonly endArrow: ArrowRenderable
  public readonly orientation: "vertical" | "horizontal"

  protected focusable: boolean = true

  private _scrollSize = 0
  private _scrollPosition = 0
  private _viewportSize = 0
  private _showArrows = false
  private _manualVisibility = false

  private _onChange: ((position: number) => void) | undefined

  scrollStep: number | undefined | null = null

  get visible(): boolean {
    return super.visible
  }

  set visible(value: boolean) {
    this._manualVisibility = true
    super.visible = value
  }

  public resetVisibilityControl(): void {
    this._manualVisibility = false
    this.recalculateVisibility()
  }

  get scrollSize(): number {
    return this._scrollSize
  }

  get scrollPosition(): number {
    return this._scrollPosition
  }

  get viewportSize(): number {
    return this._viewportSize
  }

  set scrollSize(value: number) {
    if (value === this.scrollSize) return
    this._scrollSize = value
    this.slider.scrollSize = value
    this.recalculateVisibility()
    this.scrollPosition = this.scrollPosition
  }

  set scrollPosition(value: number) {
    const newPosition = Math.min(Math.max(0, value), this.scrollSize - this.viewportSize)
    if (newPosition !== this._scrollPosition) {
      this._scrollPosition = newPosition
      this.slider.scrollPosition = newPosition
      this._onChange?.(newPosition)
      this.emit("change", { position: newPosition })
    }
  }

  set viewportSize(value: number) {
    if (value === this.viewportSize) return
    this._viewportSize = value
    this.slider.viewportSize = value
    this.recalculateVisibility()
    this.scrollPosition = this.scrollPosition
  }

  get showArrows(): boolean {
    return this._showArrows
  }

  set showArrows(value: boolean) {
    if (value === this._showArrows) return
    this._showArrows = value
    this.startArrow.visible = value
    this.endArrow.visible = value
  }

  constructor(
    ctx: RenderContext,
    { trackOptions, thumbOptions, arrowOptions, orientation, showArrows = false, ...options }: ScrollBarOptions,
  ) {
    super(ctx, {
      flexDirection: orientation === "vertical" ? "column" : "row",
      alignSelf: "stretch",
      alignItems: "stretch",
      ...(options as BoxOptions),
    })

    this._onChange = options.onChange

    this.orientation = orientation
    this._showArrows = showArrows

    this.slider = new SliderRenderable(ctx, {
      orientation,
      scrollSize: this._scrollSize,
      viewportSize: this._viewportSize,
      scrollPosition: this._scrollPosition,
      onChange: (position) => {
        this._scrollPosition = position
        this._onChange?.(position)
        this.emit("change", { position })
      },
      ...(orientation === "vertical"
        ? {
            width: 2,
            height: "100%",
            marginLeft: "auto",
          }
        : {
            width: "100%",
            height: 1,
            marginTop: "auto",
          }),
      flexGrow: 1,
      flexShrink: 1,
      trackColor: trackOptions?.backgroundColor || defaultTrackBackgroundColor,
      thumbColor: thumbOptions?.backgroundColor || defaultThumbBackgroundColor,
    })

    const arrowOpts = arrowOptions
      ? {
          fg: (arrowOptions as any).backgroundColor,
          bg: (arrowOptions as any).backgroundColor,
          attributes: (arrowOptions as any).attributes,
          ...arrowOptions,
        }
      : {}

    this.startArrow = new ArrowRenderable(ctx, {
      alignSelf: "center",
      visible: this.showArrows,
      direction: this.orientation === "vertical" ? "up" : "left",
      height: this.orientation === "vertical" ? 1 : 1,
      ...arrowOpts,
    })

    this.endArrow = new ArrowRenderable(ctx, {
      alignSelf: "center",
      visible: this.showArrows,
      direction: this.orientation === "vertical" ? "down" : "right",
      height: this.orientation === "vertical" ? 1 : 1,
      ...arrowOpts,
    })

    this.add(this.startArrow)
    this.add(this.slider)
    this.add(this.endArrow)

    let startArrowMouseTimeout = undefined as Timeout
    let endArrowMouseTimeout = undefined as Timeout

    this.startArrow.onMouseDown = (event) => {
      event.preventDefault()
      this.scrollBy(-0.5, "viewport")

      startArrowMouseTimeout = setTimeout(() => {
        this.scrollBy(-0.5, "viewport")

        startArrowMouseTimeout = setInterval(() => {
          this.scrollBy(-0.2, "viewport")
        }, 200)
      }, 500)
    }

    this.startArrow.onMouseUp = (event) => {
      event.preventDefault()
      clearInterval(startArrowMouseTimeout!)
    }

    this.endArrow.onMouseDown = (event) => {
      event.preventDefault()
      this.scrollBy(0.5, "viewport")

      endArrowMouseTimeout = setTimeout(() => {
        this.scrollBy(0.5, "viewport")

        endArrowMouseTimeout = setInterval(() => {
          this.scrollBy(0.2, "viewport")
        }, 200)
      }, 500)
    }

    this.endArrow.onMouseUp = (event) => {
      event.preventDefault()
      clearInterval(endArrowMouseTimeout!)
    }
  }

  public scrollBy(delta: number, unit: ScrollUnit = "absolute"): void {
    const multiplier =
      unit === "viewport"
        ? this.viewportSize
        : unit === "content"
          ? this.scrollSize
          : unit === "step"
            ? (this.scrollStep ?? 1)
            : 1

    const resolvedDelta = multiplier * delta
    this.scrollPosition += resolvedDelta
  }

  private recalculateVisibility(): void {
    if (!this._manualVisibility) {
      const sizeRatio = this.scrollSize <= this.viewportSize ? 1 : this.viewportSize / this.scrollSize
      super.visible = sizeRatio < 1
    }
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    const keyName = typeof key === "string" ? key : key.name

    switch (keyName) {
      case "left":
      case "h":
        if (this.orientation !== "horizontal") return false
        this.scrollBy(-1 / 5, "viewport")
        return true
      case "right":
      case "l":
        if (this.orientation !== "horizontal") return false
        this.scrollBy(1 / 5, "viewport")
        return true
      case "up":
      case "k":
        if (this.orientation !== "vertical") return false
        this.scrollBy(-1 / 5, "viewport")
        return true
      case "down":
      case "j":
        if (this.orientation !== "vertical") return false
        this.scrollBy(1 / 5, "viewport")
        return true
      case "pageup":
        this.scrollBy(-1 / 2, "viewport")
        return true
      case "pagedown":
        this.scrollBy(1 / 2, "viewport")
        return true
      case "home":
        this.scrollBy(-1, "content")
        return true
      case "end":
        this.scrollBy(1, "content")
        return true
    }

    return false
  }
}

export interface ArrowOptions extends RenderableOptions<ArrowRenderable> {
  direction: "up" | "down" | "left" | "right"
  fg?: string | RGBA
  bg?: string | RGBA
  attributes?: number
  backgroundColor?: string | RGBA
  arrowChars?: {
    up?: string
    down?: string
    left?: string
    right?: string
  }
}

export class ArrowRenderable extends Renderable {
  private _direction: "up" | "down" | "left" | "right"
  private _fg: RGBA
  private _bg: RGBA
  private _attributes: number
  private _arrowChars: {
    up: string
    down: string
    left: string
    right: string
  }

  constructor(ctx: RenderContext, options: ArrowOptions) {
    super(ctx, options)
    this._direction = options.direction
    this._fg = options.fg
      ? typeof options.fg === "string"
        ? parseColor(options.fg)
        : options.fg
      : RGBA.fromValues(1, 1, 1, 1)
    this._bg = options.bg
      ? typeof options.bg === "string"
        ? parseColor(options.bg)
        : options.bg
      : RGBA.fromValues(0, 0, 0, 0)
    this._attributes = options.attributes ?? 0

    this._arrowChars = {
      up: "◢◣",
      down: "◥◤",
      left: " ◀ ",
      right: " ▶ ",
      ...options.arrowChars,
    }

    if (!options.width) {
      this.width = Bun.stringWidth(this.getArrowChar())
    }
  }

  get direction(): "up" | "down" | "left" | "right" {
    return this._direction
  }

  set direction(value: "up" | "down" | "left" | "right") {
    if (this._direction !== value) {
      this._direction = value
      this.requestRender()
    }
  }

  get fg(): RGBA {
    return this._fg
  }

  set fg(value: RGBA) {
    if (this._fg !== value) {
      this._fg = value
      this.requestRender()
    }
  }

  get bg(): RGBA {
    return this._bg
  }

  set bg(value: RGBA) {
    if (this._bg !== value) {
      this._bg = value
      this.requestRender()
    }
  }

  get attributes(): number {
    return this._attributes
  }

  set attributes(value: number) {
    if (this._attributes !== value) {
      this._attributes = value
      this.requestRender()
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const char = this.getArrowChar()
    buffer.drawText(char, this.x, this.y, this._fg, this._bg, this._attributes)
  }

  private getArrowChar(): string {
    switch (this._direction) {
      case "up":
        return this._arrowChars.up
      case "down":
        return this._arrowChars.down
      case "left":
        return this._arrowChars.left
      case "right":
        return this._arrowChars.right
      default:
        return "?"
    }
  }
}

export interface SliderOptions extends RenderableOptions<SliderRenderable> {
  orientation: "vertical" | "horizontal"
  trackColor?: string | RGBA
  thumbColor?: string | RGBA
  scrollSize: number
  viewportSize: number
  scrollPosition: number
  onChange?: (position: number) => void
}

export class SliderRenderable extends Renderable {
  public readonly orientation: "vertical" | "horizontal"
  private _scrollSize: number
  private _viewportSize: number
  private _scrollPosition: number
  private _trackColor: RGBA
  private _thumbColor: RGBA
  private _onChange?: (position: number) => void

  constructor(ctx: RenderContext, options: SliderOptions) {
    super(ctx, options)
    this.orientation = options.orientation
    this._scrollSize = options.scrollSize
    this._viewportSize = options.viewportSize
    this._scrollPosition = options.scrollPosition
    this._onChange = options.onChange
    this._trackColor = options.trackColor
      ? typeof options.trackColor === "string"
        ? parseColor(options.trackColor)
        : options.trackColor
      : defaultTrackBackgroundColor
    this._thumbColor = options.thumbColor
      ? typeof options.thumbColor === "string"
        ? parseColor(options.thumbColor)
        : options.thumbColor
      : defaultThumbBackgroundColor

    this.setupMouseHandling()
  }

  get scrollSize(): number {
    return this._scrollSize
  }

  set scrollSize(value: number) {
    if (value !== this._scrollSize) {
      this._scrollSize = value
      this.requestRender()
    }
  }

  get viewportSize(): number {
    return this._viewportSize
  }

  set viewportSize(value: number) {
    if (value !== this._viewportSize) {
      this._viewportSize = value
      this.requestRender()
    }
  }

  get scrollPosition(): number {
    return this._scrollPosition
  }

  set scrollPosition(value: number) {
    const clamped = Math.min(Math.max(0, value), this.scrollSize - this.viewportSize)
    if (clamped !== this._scrollPosition) {
      this._scrollPosition = clamped
      this._onChange?.(clamped)
      this.emit("change", { position: clamped })
      this.requestRender()
    }
  }

  get trackColor(): RGBA {
    return this._trackColor
  }

  set trackColor(value: RGBA) {
    this._trackColor = value
    this.requestRender()
  }

  get thumbColor(): RGBA {
    return this._thumbColor
  }

  set thumbColor(value: RGBA) {
    this._thumbColor = value
    this.requestRender()
  }

  private setupMouseHandling(): void {
    let isDragging = false
    let relativeStartPos = 0

    this.onMouseDown = (event) => {
      event.preventDefault()
      isDragging = true

      const thumbRect = this.getThumbRect()
      const isOnThumb =
        event.x >= thumbRect.x &&
        event.x < thumbRect.x + thumbRect.width &&
        event.y >= thumbRect.y &&
        event.y < thumbRect.y + thumbRect.height

      if (isOnThumb) {
        relativeStartPos = this.orientation === "vertical" ? event.y - thumbRect.y : event.x - thumbRect.x
      } else {
        relativeStartPos = this.orientation === "vertical" ? thumbRect.height / 2 : thumbRect.width / 2
      }

      this.updatePositionFromMouse(event, relativeStartPos)
    }

    this.onMouseDrag = (event) => {
      if (!isDragging) return
      event.preventDefault()
      this.updatePositionFromMouse(event, relativeStartPos)
    }

    this.onMouseUp = () => {
      isDragging = false
    }
  }

  private updatePositionFromMouse(event: any, relativeStartPos: number): void {
    if (this.scrollSize <= this.viewportSize) return

    const trackStart = this.orientation === "vertical" ? this.y : this.x
    const trackSize = this.orientation === "vertical" ? this.height : this.width
    const thumbSize = this.getThumbSize()
    const mousePos = this.orientation === "vertical" ? event.y : event.x

    const thumbStartPos = mousePos - trackStart - relativeStartPos
    const maxThumbStartPos = trackSize - thumbSize

    const clampedThumbStartPos = Math.max(0, Math.min(maxThumbStartPos, thumbStartPos))

    const scrollRatio = clampedThumbStartPos / maxThumbStartPos
    const newScrollPos = scrollRatio * (this.scrollSize - this.viewportSize)

    this.scrollPosition = newScrollPos
  }

  private getThumbSize(): number {
    if (this.scrollSize <= this.viewportSize) return 1
    const trackSize = this.orientation === "vertical" ? this.height : this.width
    const sizeRatio = this.viewportSize / this.scrollSize
    return Math.max(1, Math.round(sizeRatio * trackSize))
  }

  private getThumbPosition(): number {
    const trackSize = this.orientation === "vertical" ? this.height : this.width
    const thumbSize = this.getThumbSize()
    const maxPos = trackSize - thumbSize

    if (this.scrollSize <= this.viewportSize) return 0

    const posRatio = this.scrollPosition / this.scrollSize
    return Math.min(maxPos, Math.round(posRatio * trackSize))
  }

  private getThumbRect(): { x: number; y: number; width: number; height: number } {
    const thumbSize = this.getThumbSize()
    const thumbPos = this.getThumbPosition()

    if (this.orientation === "vertical") {
      return {
        x: this.x,
        y: this.y + thumbPos,
        width: this.width,
        height: thumbSize,
      }
    } else {
      return {
        x: this.x + thumbPos,
        y: this.y,
        width: thumbSize,
        height: this.height,
      }
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.fillRect(this.x, this.y, this.width, this.height, this._trackColor)

    const thumbRect = this.getThumbRect()
    buffer.fillRect(thumbRect.x, thumbRect.y, thumbRect.width, thumbRect.height, this._thumbColor)
  }
}
