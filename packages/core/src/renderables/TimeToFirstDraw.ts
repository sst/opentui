import type { OptimizedBuffer } from "../buffer.js"
import { parseColor, RGBA, type ColorInput } from "../lib/RGBA.js"
import { Renderable, type RenderableOptions } from "../Renderable.js"
import type { RenderContext } from "../types.js"

export interface TimeToFirstDrawOptions extends RenderableOptions<TimeToFirstDrawRenderable> {
  fg?: ColorInput
  label?: string
  precision?: number
}

export class TimeToFirstDrawRenderable extends Renderable {
  private _runtimeMs: number | null = null
  private textColor: RGBA
  private label: string
  private precision: number

  constructor(ctx: RenderContext, options: TimeToFirstDrawOptions = {}) {
    super(ctx, {
      width: "100%",
      height: 1,
      flexShrink: 0,
      alignSelf: "center",
      ...options,
    })

    this.textColor = parseColor(options.fg ?? "#AAAAAA")
    this.label = options.label ?? "Time to first draw"
    this.precision = this.normalizePrecision(options.precision ?? 2)
  }

  public get runtimeMs(): number | null {
    return this._runtimeMs
  }

  public set fg(value: ColorInput) {
    this.textColor = parseColor(value)
    this.requestRender()
  }

  public set color(value: ColorInput) {
    this.fg = value
  }

  public set textLabel(value: string) {
    if (value === this.label) {
      return
    }

    this.label = value
    this.requestRender()
  }

  public set decimals(value: number) {
    const nextPrecision = this.normalizePrecision(value)
    if (nextPrecision === this.precision) {
      return
    }

    this.precision = nextPrecision
    this.requestRender()
  }

  public reset(): void {
    this._runtimeMs = null
    this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (this._runtimeMs === null) {
      this._runtimeMs = performance.now()
    }

    const content = `${this.label}: ${this._runtimeMs.toFixed(this.precision)}ms`
    const maxWidth = Math.max(this.width, 1)
    const visibleContent = content.length > maxWidth ? content.slice(0, maxWidth) : content
    const centeredX = this.x + Math.max(0, Math.floor((maxWidth - visibleContent.length) / 2))

    buffer.drawText(visibleContent, centeredX, this.y, this.textColor)
  }

  private normalizePrecision(value: number): number {
    if (!Number.isFinite(value)) {
      return 2
    }

    return Math.max(0, Math.floor(value))
  }
}
