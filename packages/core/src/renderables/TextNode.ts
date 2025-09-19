import type { TextRenderable } from "."
import { BaseRenderable, type BaseRenderableOptions } from "../Renderable"
import { RGBA, parseColor } from "../lib/RGBA"
import { isStyledText, StyledText } from "../lib/styled-text"
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

function styledTextToTextNodes(styledText: StyledText): TextNodeRenderable[] {
  return styledText.chunks.map((chunk) => {
    const node = new TextNodeRenderable({
      fg: chunk.fg,
      bg: chunk.bg,
      attributes: chunk.attributes,
    })
    node.add(chunk.text)
    return node
  })
}

export class TextNodeRenderable extends BaseRenderable {
  [BrandedTextNodeRenderable] = true

  private _fg?: RGBA
  private _bg?: RGBA
  private _attributes: number
  private _children: (string | TextNodeRenderable)[] = []
  public parent: TextNodeRenderable | null = null

  constructor(options: TextNodeOptions) {
    super(options)

    this._fg = options.fg ? parseColor(options.fg) : undefined
    this._bg = options.bg ? parseColor(options.bg) : undefined
    this._attributes = options.attributes ?? 0
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

  public add(obj: TextNodeRenderable | StyledText | string, index?: number): number {
    if (typeof obj === "string") {
      if (index !== undefined) {
        this._children.splice(index, 0, obj)
        this.requestRender()
        return index
      }

      const insertIndex = this._children.length
      this._children.push(obj)
      this.requestRender()
      return insertIndex
    }

    if (isTextNodeRenderable(obj)) {
      if (index !== undefined) {
        this._children.splice(index, 0, obj)
        obj.parent = this
        this.requestRender()
        return index
      }

      const insertIndex = this._children.length
      this._children.push(obj)
      obj.parent = this
      this.requestRender()
      return insertIndex
    }

    if (isStyledText(obj)) {
      const textNodes = styledTextToTextNodes(obj)
      if (index !== undefined) {
        this._children.splice(index, 0, ...textNodes)
        textNodes.forEach((node) => (node.parent = this))
        this.requestRender()
        return index
      }

      const insertIndex = this._children.length
      this._children.push(...textNodes)
      textNodes.forEach((node) => (node.parent = this))
      this.requestRender()
      return insertIndex
    }

    throw new Error("TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances")
  }

  public replace(obj: TextNodeRenderable | string, index: number) {
    this._children[index] = obj
    if (typeof obj !== "string") {
      obj.parent = this
    }
    this.requestRender()
  }

  public insertBefore(
    child: string | TextNodeRenderable | StyledText,
    anchorNode: TextNodeRenderable | string | unknown,
  ): this {
    if (!anchorNode || !isTextNodeRenderable(anchorNode)) {
      throw new Error("Anchor must be a TextNodeRenderable")
    }

    const anchorIndex = this._children.indexOf(anchorNode)
    if (anchorIndex === -1) {
      throw new Error("Anchor node not found in children")
    }

    if (typeof child === "string") {
      this._children.splice(anchorIndex, 0, child)
    } else if (isTextNodeRenderable(child)) {
      this._children.splice(anchorIndex, 0, child)
      child.parent = this
    } else if (child instanceof StyledText) {
      const textNodes = styledTextToTextNodes(child)
      this._children.splice(anchorIndex, 0, ...textNodes)
      textNodes.forEach((node) => (node.parent = this))
    } else {
      throw new Error("Child must be a string, TextNodeRenderable, or StyledText instance")
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
      fg: this._fg ?? parentStyle.fg,
      bg: this._bg ?? parentStyle.bg,
      attributes: this._attributes | parentStyle.attributes,
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

  public get fg(): RGBA | undefined {
    return this._fg
  }

  public set fg(fg: RGBA | string | undefined) {
    if (!fg) {
      this._fg = undefined
      this.requestRender()
      return
    }
    this._fg = parseColor(fg)
    this.requestRender()
  }

  public set bg(bg: RGBA | string | undefined) {
    if (!bg) {
      this._bg = undefined
      this.requestRender()
      return
    }
    this._bg = parseColor(bg)
    this.requestRender()
  }

  public get bg(): RGBA | undefined {
    return this._bg
  }

  public set attributes(attributes: number) {
    this._attributes = attributes
    this.requestRender()
  }

  public get attributes(): number {
    return this._attributes
  }
}

export class RootTextNodeRenderable extends TextNodeRenderable {
  textParent: TextRenderable

  constructor(
    private readonly ctx: RenderContext,
    options: TextNodeOptions,
    textParent: TextRenderable,
  ) {
    super(options)
    this.textParent = textParent
  }

  public requestRender(): void {
    this.markDirty()
    this.ctx.requestRender()
  }
}
