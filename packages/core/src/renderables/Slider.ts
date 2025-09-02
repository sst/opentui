import { OptimizedBuffer, Renderable, type RenderableOptions, type RenderContext, RGBA, parseColor } from "../index"

const defaultThumbBackgroundColor = RGBA.fromHex("#9a9ea3")
const defaultTrackBackgroundColor = RGBA.fromHex("#252527")

export interface SliderOptions extends RenderableOptions<SliderRenderable> {
  orientation: "vertical" | "horizontal"
  trackColor?: string | RGBA
  thumbColor?: string | RGBA
  thumbSize?: number
  thumbPosition?: number
  onChange?: (position: number) => void
}

export class SliderRenderable extends Renderable {
  public readonly orientation: "vertical" | "horizontal"
  private _thumbSize: number
  private _thumbPosition: number
  private _trackColor: RGBA
  private _thumbColor: RGBA
  private _onChange?: (position: number) => void

  constructor(ctx: RenderContext, options: SliderOptions) {
    super(ctx, options)
    this.orientation = options.orientation
    this._thumbSize = options.thumbSize ?? 1
    this._thumbPosition = options.thumbPosition ?? 0
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

  get thumbSize(): number {
    return this._thumbSize
  }

  set thumbSize(value: number) {
    const clamped = Math.max(1, Math.min(value, this.orientation === "vertical" ? this.height : this.width))
    if (clamped !== this._thumbSize) {
      this._thumbSize = clamped
      this.requestRender()
    }
  }

  get thumbPosition(): number {
    return this._thumbPosition
  }

  set thumbPosition(value: number) {
    const clamped = Math.max(0, Math.min(1, value))
    if (clamped !== this._thumbPosition) {
      this._thumbPosition = clamped
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
    const trackStart = this.orientation === "vertical" ? this.y : this.x
    const trackSize = this.orientation === "vertical" ? this.height : this.width
    const mousePos = this.orientation === "vertical" ? event.y : event.x

    const thumbStartPos = mousePos - trackStart - relativeStartPos
    const maxThumbStartPos = trackSize - this._thumbSize

    const clampedThumbStartPos = Math.max(0, Math.min(maxThumbStartPos, thumbStartPos))

    const newPosition = maxThumbStartPos > 0 ? clampedThumbStartPos / maxThumbStartPos : 0

    this.thumbPosition = newPosition
  }

  private getThumbPosition(): number {
    const trackSize = this.orientation === "vertical" ? this.height : this.width
    const maxPos = trackSize - this._thumbSize
    return Math.round(this._thumbPosition * maxPos)
  }

  private getThumbRect(): { x: number; y: number; width: number; height: number } {
    const thumbPos = this.getThumbPosition()

    if (this.orientation === "vertical") {
      return {
        x: this.x,
        y: this.y + thumbPos,
        width: this.width,
        height: this._thumbSize,
      }
    } else {
      return {
        x: this.x + thumbPos,
        y: this.y,
        width: this._thumbSize,
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
