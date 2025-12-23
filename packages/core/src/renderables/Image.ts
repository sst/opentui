import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { RGBA, parseColor } from "../lib/RGBA"
import type { GraphicsSupport } from "../graphics/protocol"

export type ImageFit = "contain" | "cover" | "fill"

export interface ImageOptions extends RenderableOptions<ImageRenderable> {
  src?: string | Buffer
  alt?: string
  width?: number
  height?: number
  fit?: ImageFit
  pixelWidth?: number
  pixelHeight?: number
}

export class ImageRenderable extends Renderable {
  src?: string | Buffer
  alt?: string
  fit: ImageFit
  pixelWidth?: number
  pixelHeight?: number
  constructor(ctx: RenderContext, options: ImageOptions) {
    super(ctx, options)
    this.src = options.src
    this.alt = options.alt
    this.fit = options.fit ?? "contain"
    this.width = options.width ?? 0
    this.height = options.height ?? 0
    this.pixelWidth = options.pixelWidth
    this.pixelHeight = options.pixelHeight
  }

  protected renderSelf(buffer: OptimizedBuffer, _deltaTime: number): void {
    const width = Math.max(this.width, 0)
    const height = Math.max(this.height, 0)
    if (width === 0 || height === 0) return

    // Clear the target area so previous frame contents do not bleed through
    buffer.fillRect(this.x, this.y, width, height, RGBA.fromInts(0, 0, 0, 0))

    const graphics = (this._ctx.graphicsSupport ?? null) as GraphicsSupport | null
    const shouldShowFallback = !graphics || graphics.protocol === "none" || !this.src
    if (!shouldShowFallback) return

    const fallback = this.alt ?? ""
    if (fallback.length === 0) return

    const trimmed = fallback.slice(0, Math.max(width, 1))
    buffer.drawText(trimmed, this.x, this.y, parseColor("#A0A0A0"))
  }
}
