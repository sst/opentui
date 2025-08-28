import { Renderable, type RenderableOptions } from "../../Renderable"
import type { OptimizedBuffer } from "../../buffer"
import type { RenderContext } from "../../types"

export interface VRenderableOptions extends RenderableOptions<VRenderable> {
  render?: (
    this: VRenderable | VRenderableOptions,
    buffer: OptimizedBuffer,
    deltaTime: number,
    renderable: VRenderable,
  ) => void
}

/**
 * A generic renderable that accepts a custom render function as a prop.
 * This allows functional constructs to specify custom rendering behavior
 * without needing to subclass Renderable.
 */
export class VRenderable extends Renderable {
  private options: VRenderableOptions

  constructor(ctx: RenderContext, options: VRenderableOptions) {
    super(ctx, options)
    this.options = options
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (this.options.render) {
      this.options.render.call(this.options, buffer, deltaTime, this)
    }
  }
}
