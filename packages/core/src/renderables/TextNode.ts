import { BaseRenderable, type BaseRenderableOptions } from "../Renderable"
import { RGBA, parseColor } from "../lib/RGBA"
import { type TextChunk } from "../text-buffer"
import type { RenderContext } from "../types"

export interface TextNodeOptions extends BaseRenderableOptions {
  fg?: string | RGBA
  bg?: string | RGBA
  attributes?: number
}

const BrandedTextNodeRenderable: unique symbol = Symbol.for("@opentui/core/TextNodeRenderable")

export function isTextNodeRenderable(obj: any): obj is TextNodeRenderable {
  return !!obj?.[BrandedTextNodeRenderable]
}

export class TextNodeRenderable extends BaseRenderable {
  [BrandedTextNodeRenderable] = true

  public fg?: RGBA
  public bg?: RGBA
  public attributes: number
  private _children: (string | TextNodeRenderable)[] = []
  public parent: TextNodeRenderable | null = null

  constructor(options: TextNodeOptions) {
    super(options)

    this.fg = options.fg ? parseColor(options.fg) : undefined
    this.bg = options.bg ? parseColor(options.bg) : undefined
    this.attributes = options.attributes ?? 0
  }

  public get children(): (string | TextNodeRenderable)[] {
    return this._children
  }

  public set children(children: (string | TextNodeRenderable)[]) {
    this._children = children
    this.requestRender()
  }

  public requestRender(): void {
    this.markDirty()
    this.parent?.requestRender()
  }

  public add(obj: TextNodeRenderable | string, index?: number): number {
    if (typeof obj === "string") {
      if (index !== undefined) {
        this._children.splice(index, 0, obj)
        this.requestRender()
        return index
      } else {
        const insertIndex = this._children.length
        this._children.push(obj)
        this.requestRender()
        return insertIndex
      }
    }

    if (isTextNodeRenderable(obj)) {
      if (index !== undefined) {
        this._children.splice(index, 0, obj)
        obj.parent = this
        this.requestRender()
        return index
      } else {
        const insertIndex = this._children.length
        this._children.push(obj)
        obj.parent = this
        this.requestRender()
        return insertIndex
      }
    }

    throw new Error("TextNodeRenderable only accepts strings or other TextNodeRenderable instances")
  }

  public insertBefore(child: string | TextNodeRenderable, anchorNode: string | TextNodeRenderable): this {
    const anchorIndex = this._children.indexOf(anchorNode)
    if (anchorIndex === -1) {
      throw new Error("Anchor node not found in children")
    }

    this._children.splice(anchorIndex, 0, child)
    if (typeof child !== "string") {
      child.parent = this
    }
    this.requestRender()
    return this
  }

  public remove(child: string | TextNodeRenderable): this {
    const childIndex = this._children.indexOf(child)
    if (childIndex === -1) {
      throw new Error("Child not found in children")
    }

    this._children.splice(childIndex, 1)
    if (typeof child !== "string") {
      child.parent = null
    }
    this.requestRender()
    return this
  }

  public clear(): void {
    this._children = []
    this.requestRender()
  }

  public mergeStyles(parentStyle: { fg?: RGBA; bg?: RGBA; attributes: number }): {
    fg?: RGBA
    bg?: RGBA
    attributes: number
  } {
    return {
      fg: this.fg ?? parentStyle.fg,
      bg: this.bg ?? parentStyle.bg,
      attributes: this.attributes | parentStyle.attributes,
    }
  }

  public gatherWithInheritedStyle(
    parentStyle: { fg?: RGBA; bg?: RGBA; attributes: number } = { fg: undefined, bg: undefined, attributes: 0 },
  ): TextChunk[] {
    const currentStyle = this.mergeStyles(parentStyle)

    const chunks: TextChunk[] = []

    for (const child of this._children) {
      if (typeof child === "string") {
        chunks.push({
          __isChunk: true,
          text: child,
          fg: currentStyle.fg,
          bg: currentStyle.bg,
          attributes: currentStyle.attributes,
        })
      } else {
        const childChunks = child.gatherWithInheritedStyle(currentStyle)
        chunks.push(...childChunks)
      }
    }

    this.markClean()

    return chunks
  }

  public static fromString(text: string, options: Partial<TextNodeOptions> = {}): TextNodeRenderable {
    const node = new TextNodeRenderable(options)
    node.add(text)
    return node
  }

  public static fromNodes(nodes: TextNodeRenderable[], options: Partial<TextNodeOptions> = {}): TextNodeRenderable {
    const node = new TextNodeRenderable(options)
    for (const childNode of nodes) {
      node.add(childNode)
    }
    return node
  }

  public toChunks(
    parentStyle: { fg?: RGBA; bg?: RGBA; attributes: number } = { fg: undefined, bg: undefined, attributes: 0 },
  ): TextChunk[] {
    return this.gatherWithInheritedStyle(parentStyle)
  }

  public getChildren(): BaseRenderable[] {
    return this._children.filter((child): child is TextNodeRenderable => typeof child !== "string")
  }

  public getChildrenCount(): number {
    return this._children.length
  }

  public getRenderable(id: string): BaseRenderable | undefined {
    return this._children.find((child): child is TextNodeRenderable => typeof child !== "string" && child.id === id)
  }
}

export class RootTextNodeRenderable extends TextNodeRenderable {
  constructor(
    private readonly ctx: RenderContext,
    options: TextNodeOptions,
  ) {
    super(options)
  }

  public requestRender(): void {
    this.markDirty()
    this.ctx.requestRender()
  }
}
