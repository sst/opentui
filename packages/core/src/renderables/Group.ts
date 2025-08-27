import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"

export class GroupRenderable extends Renderable {
  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }
}
