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
  public readonly track: BoxRenderable
  public readonly thumb: ThumbRenderable
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
    this.recalculateVisibility()
    this.scrollPosition = this.scrollPosition
  }

  set scrollPosition(value: number) {
    const newPosition = Math.min(Math.max(0, value), this.scrollSize - this.viewportSize)
    if (newPosition !== this._scrollPosition) {
      this._scrollPosition = newPosition
      this._onChange?.(newPosition)
      this.emit("change", { position: newPosition })
    }
  }

  set viewportSize(value: number) {
    if (value === this.viewportSize) return
    this._viewportSize = value
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

    this.track = new BoxRenderable(ctx, {
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
      backgroundColor: defaultTrackBackgroundColor,
      ...trackOptions,
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
    this.add(this.track)
    this.add(this.endArrow)

    this.thumb = new ThumbRenderable(ctx, {
      scrollbar: this,
      ...(orientation === "vertical"
        ? {
            width: "100%",
            height: 1,
          }
        : {
            width: 1,
            height: "100%",
          }),
      backgroundColor: defaultThumbBackgroundColor,
      ...thumbOptions,
    })
    this.track.add(this.thumb)

    let relativeStartPos = 0

    this.thumb.onMouseDown = (event) => {
      event.preventDefault()
      relativeStartPos = orientation === "vertical" ? event.y - this.thumb.y : event.x - this.thumb.x
    }

    this.track.onMouseDown = (event) => {
      event.preventDefault()
      relativeStartPos = orientation === "vertical" ? this.thumb.height / 2 : this.thumb.width / 2
      this.scrollPosition =
        ((orientation === "vertical" ? event.y - this.track.y : event.x - this.track.x) - relativeStartPos) *
        (this.scrollSize / this.viewportSize)
    }

    this.thumb.onMouseDrag = this.track.onMouseDrag = (event) => {
      event.preventDefault()

      this.scrollPosition =
        ((orientation === "vertical" ? event.y - this.track.y : event.x - this.track.x) - relativeStartPos) *
        (this.scrollSize / this.viewportSize)
    }

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

class ThumbRenderable extends BoxRenderable {
  private readonly scrollbar: ScrollBarRenderable

  constructor(ctx: RenderContext, options: BoxOptions & { scrollbar: ScrollBarRenderable }) {
    super(ctx, options)
    this.scrollbar = options.scrollbar
  }

  public updateFromLayout(): void {
    super.updateFromLayout()

    if (!this.parent) return

    const scrollbar = this.scrollbar

    const sizeRatio = scrollbar.scrollSize <= scrollbar.viewportSize ? 1 : scrollbar.viewportSize / scrollbar.scrollSize

    const parentSize = scrollbar.orientation === "vertical" ? this.parent.height : this.parent.width
    const resolvedSize = Math.max(1, Math.round(sizeRatio * parentSize))
    const maxPos = parentSize - resolvedSize

    if (scrollbar.orientation === "vertical") this._heightValue = resolvedSize
    else this._widthValue = resolvedSize

    const posRatio = scrollbar.scrollPosition / scrollbar.scrollSize
    const pos = Math.min(maxPos, Math.ceil(posRatio * parentSize))

    if (scrollbar.orientation === "vertical") this._translateY = pos
    else this._translateX = pos
  }
}
