import { BaseRenderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { isStyledText, StyledText } from "../lib/styled-text.js"
import { type TextChunk } from "../text-buffer.js"
import { parseColor, RGBA } from "../lib/RGBA.js"
import { type RenderContext } from "../types.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"

export interface TextOptions extends TextBufferOptions {
  content?: StyledText | string
  link?: { url: string }
}

export type TextStyle = {
  fg?: RGBA
  bg?: RGBA
  attributes: number
  link?: { url: string }
}

const BrandedTextRenderable: unique symbol = Symbol.for("@opentui/core/TextRenderable")

export function isTextRenderable(obj: any): obj is TextRenderable {
  return !!obj?.[BrandedTextRenderable]
}

const detachedTextContext = {
  widthMethod: "wcwidth",
  width: 0,
  height: 0,
  requestRender() {},
} as unknown as RenderContext

function isRenderContext(value: RenderContext | TextOptions): value is RenderContext {
  return typeof (value as RenderContext).requestRender === "function"
}

export class TextRenderable extends TextBufferRenderable {
  [BrandedTextRenderable] = true

  private _children: (string | TextRenderable)[] = []
  private _localFg?: RGBA
  private _localBg?: RGBA
  private _localAttributes: number
  private _link?: { url: string }
  private _textDocumentDirty: boolean = true
  private readonly _canOwnTextDocumentState: boolean

  constructor(ctx: RenderContext, options: TextOptions, attachTextDocumentState?: boolean)
  constructor(options: TextOptions)
  constructor(
    ctxOrOptions: RenderContext | TextOptions,
    maybeOptions?: TextOptions,
    attachTextDocumentState: boolean = true,
  ) {
    const hasContext = isRenderContext(ctxOrOptions)
    const ctx = hasContext ? ctxOrOptions : detachedTextContext
    const options = hasContext ? (maybeOptions ?? {}) : ctxOrOptions

    super(ctx, options, hasContext && attachTextDocumentState)

    this._canOwnTextDocumentState = hasContext && attachTextDocumentState
    this._localFg = options.fg ? parseColor(options.fg) : undefined
    this._localBg = options.bg ? parseColor(options.bg) : undefined
    this._localAttributes = options.attributes ?? 0
    this._link = options.link

    if (options.content !== undefined) this.replaceContent(options.content, false)
    if (this.hasTextDocumentState) this.commitTextDocumentSnapshot()
  }

  public get children(): (string | TextRenderable)[] {
    return this._children
  }

  public set children(children: (string | TextRenderable)[]) {
    const previousChildren = this._children
    this._children = []

    for (const child of previousChildren) {
      if (isTextRenderable(child) && child.parent === this) this.detachTextChild(child)
    }
    for (const child of children) this.insertTextChild(child, this._children.length)

    this.invalidateTextDocument()
  }

  public get content(): StyledText {
    return new StyledText(this.gatherWithInheritedStyle())
  }

  public set content(value: StyledText | string) {
    this.replaceContent(value, true)
  }

  public get chunks(): TextChunk[] {
    return this.gatherWithInheritedStyle()
  }

  public get textNode(): TextRenderable {
    return this
  }

  public get plainText(): string {
    return this.gatherWithInheritedStyle()
      .map((chunk) => chunk.text)
      .join("")
  }

  public get textLength(): number {
    return this.plainText.length
  }

  public get visible(): boolean {
    return super.visible
  }

  public set visible(value: boolean) {
    if (super.visible === value) return
    super.visible = value
    this.invalidateTextDocument()
  }

  public get fg(): RGBA | undefined {
    return this._localFg
  }

  public set fg(value: RGBA | string | undefined) {
    const next = value ? parseColor(value) : undefined
    if (this._localFg === next) return
    this._localFg = next
    this._defaultFg = next ?? this._defaultOptions.fg
    this.invalidateTextDocument()
  }

  public get bg(): RGBA | undefined {
    return this._localBg
  }

  public set bg(value: RGBA | string | undefined) {
    const next = value ? parseColor(value) : undefined
    if (this._localBg === next) return
    this._localBg = next
    this._defaultBg = next ?? this._defaultOptions.bg
    this.invalidateTextDocument()
  }

  public get attributes(): number {
    return this._localAttributes
  }

  public set attributes(value: number) {
    if (this._localAttributes === value) return
    this._localAttributes = value
    this._defaultAttributes = value
    this.invalidateTextDocument()
  }

  public get link(): { url: string } | undefined {
    return this._link
  }

  public set link(value: { url: string } | undefined) {
    if (this._link === value) return
    this._link = value
    this.invalidateTextDocument()
  }

  public requestRender(): void {
    this.markDirty()
    this._ctx.requestRender()
  }

  public add(obj: TextRenderable | StyledText | string, index?: number): number {
    if (typeof obj === "string" || isTextRenderable(obj)) {
      const insertIndex = this.insertTextChild(obj, index ?? this._children.length)
      this.invalidateTextDocument()
      return insertIndex
    }

    if (isStyledText(obj)) {
      const children = this.styledTextToChildren(obj)
      let insertIndex = Math.max(0, Math.min(index ?? this._children.length, this._children.length))
      const firstIndex = insertIndex
      for (const child of children) {
        this.insertTextChild(child, insertIndex)
        insertIndex += 1
      }
      this.invalidateTextDocument()
      return firstIndex
    }

    throw new Error("TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances")
  }

  public replace(obj: TextRenderable | string, index: number): void {
    const existing = this._children[index]
    if (existing === undefined) {
      this.insertTextChild(obj, index)
      this.invalidateTextDocument()
      return
    }

    if (isTextRenderable(existing) && existing !== obj && existing.parent === this) this.detachTextChild(existing)
    if (isTextRenderable(obj)) {
      let targetIndex = index
      if (obj.parent) {
        if (obj.parent === this) {
          const currentIndex = this._children.indexOf(obj)
          if (currentIndex !== -1 && currentIndex !== index) {
            this._children.splice(currentIndex, 1)
            if (currentIndex < targetIndex) targetIndex -= 1
          }
        } else {
          obj.parent.remove(obj)
        }
      }
      obj.adoptTextContext(this._ctx)
      obj.parent = this
      obj.detachTextDocumentState()
      this._children[targetIndex] = obj
    } else {
      this._children[index] = obj
    }
    this.invalidateTextDocument()
  }

  public insertBefore(
    child: string | TextRenderable | StyledText,
    anchorNode: TextRenderable | string | unknown,
  ): number {
    if (!anchorNode || !isTextRenderable(anchorNode)) throw new Error("Anchor must be a TextNodeRenderable")

    const anchorIndex = this._children.indexOf(anchorNode)
    if (anchorIndex === -1) throw new Error("Anchor node not found in children")
    if (child === anchorNode) return anchorIndex
    return this.add(child, anchorIndex)
  }

  public remove(child: BaseRenderable): void {
    if (!isTextRenderable(child)) throw new Error("remove expects a TextNodeRenderable child object")

    const childIndex = this._children.indexOf(child)
    if (childIndex === -1) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`TextRenderable with id ${child.id} is not a child of ${this.id}, skipping remove`)
      }
      return
    }

    this._children.splice(childIndex, 1)
    this.detachTextChild(child)
    this.invalidateTextDocument()
  }

  public clear(): void {
    const previousChildren = this._children
    this._children = []
    for (const child of previousChildren) {
      if (isTextRenderable(child) && child.parent === this) this.detachTextChild(child)
    }
    this.invalidateTextDocument()
  }

  public mergeStyles(parentStyle: TextStyle): TextStyle {
    return {
      fg: this._localFg ?? parentStyle.fg,
      bg: this._localBg ?? parentStyle.bg,
      attributes: this._localAttributes | parentStyle.attributes,
      link: this._link ?? parentStyle.link,
    }
  }

  public gatherWithInheritedStyle(
    parentStyle: TextStyle = { fg: undefined, bg: undefined, attributes: 0 },
  ): TextChunk[] {
    if (!this.visible) return []

    const currentStyle = this.mergeStyles(parentStyle)
    const chunks: TextChunk[] = []
    for (const child of this._children) {
      if (typeof child === "string") {
        chunks.push({ __isChunk: true, text: child, ...currentStyle })
      } else {
        chunks.push(...child.gatherWithInheritedStyle(currentStyle))
      }
    }
    return chunks
  }

  public toChunks(parentStyle?: TextStyle): TextChunk[] {
    return this.gatherWithInheritedStyle(parentStyle)
  }

  public getTextChildren(): TextRenderable[] {
    return this._children.filter(isTextRenderable)
  }

  public getChildren(): TextRenderable[] {
    return this.getTextChildren()
  }

  public getChildrenCount(): number {
    return this._children.length
  }

  public getRenderable(id: string): TextRenderable | undefined {
    return this.getTextChildren().find((child) => child.id === id)
  }

  public getRenderableIndex(id: string): number {
    return this._children.findIndex((child) => isTextRenderable(child) && child.id === id)
  }

  public findDescendantById(id: string): TextRenderable | undefined {
    for (const child of this.getTextChildren()) {
      if (child.id === id) return child
      const descendant = child.findDescendantById(id)
      if (descendant) return descendant
    }
    return undefined
  }

  public onLifecyclePass = (): void => {
    if (!isTextRenderable(this.parent) && this._textDocumentDirty) this.commitTextDocumentSnapshot()
  }

  public render(buffer: OptimizedBuffer, deltaTime: number): void {
    // Custom onUpdate hooks run after the lifecycle pass. Preserve their same-frame
    // content updates without introducing a second document backend.
    if (!isTextRenderable(this.parent) && this._textDocumentDirty) this.commitTextDocumentSnapshot()
    super.render(buffer, deltaTime)
  }

  public destroyRecursively(): void {
    for (const child of [...this.getTextChildren()]) child.destroyRecursively()
    this.destroy()
  }

  public destroy(): void {
    if (this.isDestroyed) return
    const children = this.getTextChildren()
    this._children = []
    for (const child of children) {
      if (child.parent === this) this.detachTextChild(child)
    }
    super.destroy()
  }

  public static fromString(text: string, options?: Partial<TextOptions>): TextRenderable
  public static fromString(ctx: RenderContext, text: string, options?: Partial<TextOptions>): TextRenderable
  public static fromString(
    ctxOrText: RenderContext | string,
    textOrOptions: string | Partial<TextOptions> = {},
    maybeOptions: Partial<TextOptions> = {},
  ): TextRenderable {
    const hasContext = typeof ctxOrText !== "string"
    const ctx = hasContext ? ctxOrText : detachedTextContext
    const text = hasContext ? (textOrOptions as string) : ctxOrText
    const options = (hasContext ? maybeOptions : textOrOptions) as Partial<TextOptions>
    const node = new TextRenderable(ctx, options, false)
    node._children = [text]
    node._textDocumentDirty = true
    return node
  }

  public static fromNodes(nodes: TextRenderable[], options?: Partial<TextOptions>): TextRenderable
  public static fromNodes(ctx: RenderContext, nodes: TextRenderable[], options?: Partial<TextOptions>): TextRenderable
  public static fromNodes(
    ctxOrNodes: RenderContext | TextRenderable[],
    nodesOrOptions: TextRenderable[] | Partial<TextOptions> = {},
    maybeOptions: Partial<TextOptions> = {},
  ): TextRenderable {
    const hasContext = !Array.isArray(ctxOrNodes)
    const ctx = hasContext ? ctxOrNodes : detachedTextContext
    const nodes = (hasContext ? nodesOrOptions : ctxOrNodes) as TextRenderable[]
    const options = (hasContext ? maybeOptions : nodesOrOptions) as Partial<TextOptions>
    const node = new TextRenderable(ctx, options, false)
    for (const child of nodes) node.insertTextChild(child, node._children.length)
    node._textDocumentDirty = true
    return node
  }

  private replaceContent(content: StyledText | string, requestRender: boolean): void {
    const previousChildren = this._children
    this._children = []
    for (const child of previousChildren) {
      if (isTextRenderable(child) && child.parent === this) this.detachTextChild(child)
    }

    if (typeof content === "string") {
      if (content !== "") this._children.push(content)
    } else {
      for (const child of this.styledTextToChildren(content)) this.insertTextChild(child, this._children.length)
    }

    this._textDocumentDirty = true
    if (requestRender) {
      this.invalidateTextDocument()
      if (this.hasTextDocumentState && this.lastLocalSelection) this.commitTextDocumentSnapshot()
    }
  }

  private styledTextToChildren(styledText: StyledText): TextRenderable[] {
    return styledText.chunks.map((chunk) => {
      const child = new TextRenderable(
        this._ctx,
        {
          fg: chunk.fg,
          bg: chunk.bg,
          attributes: chunk.attributes,
          link: chunk.link,
        },
        false,
      )
      child._children = [chunk.text]
      return child
    })
  }

  private insertTextChild(child: string | TextRenderable, index: number): number {
    let insertIndex = Math.max(0, Math.min(index, this._children.length))
    if (isTextRenderable(child)) {
      if (child === this) throw new Error("TextRenderable cannot be added to itself")
      if (child.parent === this) {
        const currentIndex = this._children.indexOf(child)
        if (currentIndex !== -1) {
          this._children.splice(currentIndex, 1)
          if (currentIndex < insertIndex) insertIndex -= 1
        }
      } else if (child.parent) {
        child.parent.remove(child)
      }

      child.adoptTextContext(this._ctx)
      child.parent = this
      child.detachTextDocumentState()
    }

    this._children.splice(insertIndex, 0, child)
    return insertIndex
  }

  private detachTextChild(child: TextRenderable): void {
    child.parent = null
    if (child._canOwnTextDocumentState) {
      child.attachTextDocumentState()
      child.commitTextDocumentSnapshot()
    }
  }

  private adoptTextContext(ctx: RenderContext): void {
    this._ctx = ctx
    for (const child of this.getTextChildren()) child.adoptTextContext(ctx)
  }

  private invalidateTextDocument(): void {
    this._textDocumentDirty = true
    if (isTextRenderable(this.parent)) {
      this.parent.invalidateTextDocument()
      return
    }

    if (!this.parent && this.hasTextDocumentState) this.commitTextDocumentSnapshot()
    this.requestRender()
  }

  // This is the only document backend seam. Replace it with incremental native
  // range operations after the canonical tree migration lands.
  private commitTextDocumentSnapshot(): void {
    if (!this.hasTextDocumentState || isTextRenderable(this.parent)) return
    const chunks = this.gatherWithInheritedStyle().map((chunk) => {
      if (chunk.fg || chunk.bg || chunk.attributes || chunk.link) return chunk
      return { __isChunk: true as const, text: chunk.text }
    })
    this.textBuffer.setDefaultFg(this._defaultFg)
    this.textBuffer.setDefaultBg(this._defaultBg)
    this.textBuffer.setDefaultAttributes(this._defaultAttributes)
    this.textBuffer.setStyledText(new StyledText(chunks))
    this.refreshLocalSelection()
    this.yogaNode.markDirty()
    this._textDocumentDirty = false
  }
}
