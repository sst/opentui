import {
  type ColorInput,
  OptimizedBuffer,
  parseColor,
  Renderable,
  type RenderableOptions,
  type RenderContext,
  RGBA,
} from "../index"

const defaultThumbBackgroundColor = RGBA.fromHex("#9a9ea3")
const defaultTrackBackgroundColor = RGBA.fromHex("#252527")

export interface SliderOptions extends RenderableOptions<SliderRenderable> {
  orientation: "vertical" | "horizontal"
  thumbSize?: number
  thumbPosition?: number
  backgroundColor?: ColorInput
  foregroundColor?: ColorInput
  onChange?: (position: number) => void
}

export class SliderRenderable extends Renderable {
  public readonly orientation: "vertical" | "horizontal"
  private _thumbSize: number
  private _thumbPosition: number
  private _backgroundColor: RGBA
  private _foregroundColor: RGBA
  private _onChange?: (position: number) => void

  constructor(ctx: RenderContext, options: SliderOptions) {
    super(ctx, options)
    this.orientation = options.orientation
    this._thumbSize = options.thumbSize ?? 1
    this._thumbPosition = options.thumbPosition ?? 0
    this._onChange = options.onChange
    this._backgroundColor = options.backgroundColor ? parseColor(options.backgroundColor) : defaultTrackBackgroundColor
    this._foregroundColor = options.foregroundColor ? parseColor(options.foregroundColor) : defaultThumbBackgroundColor

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

  get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  set backgroundColor(value: ColorInput) {
    this._backgroundColor = parseColor(value)
    this.requestRender()
  }

  get foregroundColor(): RGBA {
    return this._foregroundColor
  }

  set foregroundColor(value: ColorInput) {
    this._foregroundColor = parseColor(value)
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
    buffer.fillRect(this.x, this.y, this.width, this.height, this._backgroundColor)

    const thumbRect = this.getThumbRect()
    buffer.fillRect(thumbRect.x, thumbRect.y, thumbRect.width, thumbRect.height, this._foregroundColor)
  }
}
