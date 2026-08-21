import type { BaseRenderableOptions } from "../Renderable.js"
import type { RGBA } from "../lib/RGBA.js"
import type { RenderContext } from "../types.js"
import { TextRenderable, isTextRenderable } from "./Text.js"

export interface TextNodeOptions extends BaseRenderableOptions {
  fg?: string | RGBA
  bg?: string | RGBA
  attributes?: number
  link?: { url: string }
}

export { TextRenderable as TextNodeRenderable, isTextRenderable as isTextNodeRenderable }

export class RootTextNodeRenderable extends TextRenderable {
  public readonly textParent: TextRenderable

  constructor(ctx: RenderContext, options: TextNodeOptions, textParent: TextRenderable) {
    super(ctx, options, false)
    this.textParent = textParent
  }

  public override requestRender(): void {
    this.markDirty()
    this.ctx.requestRender()
  }
}
