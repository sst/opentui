import { type RenderableOptions, Renderable } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import type { RenderContext } from "../types"

export interface FrameBufferOptions extends RenderableOptions<FrameBufferRenderable> {
  width: number
  height: number
  respectAlpha?: boolean
}

export class FrameBufferRenderable extends Renderable {
  public frameBuffer: OptimizedBuffer
  protected respectAlpha: boolean

  constructor(ctx: RenderContext, options: FrameBufferOptions) {
    super(ctx, options)
    this.respectAlpha = options.respectAlpha || false
    this.frameBuffer = OptimizedBuffer.create(options.width, options.height, this._ctx.widthMethod, {
      respectAlpha: this.respectAlpha,
      id: options.id || `framebufferrenderable-${this.id}`,
    })
  }

  protected onResize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid resize dimensions for FrameBufferRenderable ${this.id}: ${width}x${height}`)
    }

    this.frameBuffer.resize(width, height)
    super.onResize(width, height)
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return
    buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
  }

  protected destroySelf(): void {
    // TODO: framebuffer collides with buffered Renderable, which holds a framebuffer
    // and destroys it if it exists already. Maybe instead of extending FrameBufferRenderable,
    // subclasses can use the buffered option on the base renderable instead,
    // then this would become something that takes in an external framebuffer to bring it into layout.
    this.frameBuffer?.destroy()
    super.destroySelf()
  }
}
