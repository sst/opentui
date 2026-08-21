import { BaseRenderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { isStyledText, StyledText } from "../lib/styled-text.js"
import { type TextChunk } from "../text-buffer.js"
import { TextBuffer } from "../text-buffer.js"
import { TextBufferView } from "../text-buffer-view.js"
import { parseColor, RGBA } from "../lib/RGBA.js"
import type { Selection } from "../lib/selection.js"
import { type RenderContext } from "../types.js"
import type { LineInfo } from "../zig.js"
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
const BrandedTextNodeRenderable: unique symbol = Symbol.for("@opentui/core/TextNodeRenderable")

export function isTextRenderable(obj: any): obj is TextRenderable {
  return !!(obj?.[BrandedTextRenderable] || obj?.[BrandedTextNodeRenderable])
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
  get [BrandedTextRenderable](): true {
    return true
  }

  get [BrandedTextNodeRenderable](): true {
    return true
  }

  private _children: (string | TextRenderable)[] = []
  private _childrenProxy: (string | TextRenderable)[] | null = null
  private _localFg?: RGBA
  private _localBg?: RGBA
  private _localAttributes: number
  private _link?: { url: string }
  private _textDocumentDirty: boolean = true
  private _textDocumentRole: "owner" | "promotable" | "inline"
  private readonly _ownedChildren = new Set<TextRenderable>()
  private _manualStyledText: StyledText | null = null
  private _lastCommittedLineInfoFrame: number = -1

  constructor(ctx: RenderContext, options: TextOptions, attachTextDocumentState?: boolean)
  constructor(options: TextOptions, attachTextDocumentState?: boolean)
  constructor(
    ctxOrOptions: RenderContext | TextOptions,
    maybeOptions?: TextOptions | boolean,
    attachTextDocumentState: boolean = true,
  ) {
    const hasContext = isRenderContext(ctxOrOptions)
    const ctx = hasContext ? ctxOrOptions : detachedTextContext
    const options = (hasContext ? (maybeOptions ?? {}) : ctxOrOptions) as TextOptions
    const shouldAttach = hasContext ? attachTextDocumentState : ((maybeOptions as boolean | undefined) ?? true)

    super(ctx, options, shouldAttach)

    this._textDocumentRole = shouldAttach ? "owner" : "inline"
    this._localFg = options.fg ? parseColor(options.fg) : undefined
    this._localBg = options.bg ? parseColor(options.bg) : undefined
    this._localAttributes = options.attributes ?? 0
    this._link = options.link

    if (options.content !== undefined) this.replaceContent(options.content, false)
    if (this.hasTextDocumentState) this.commitTextDocumentSnapshot()
  }

  public get children(): (string | TextRenderable)[] {
    if (!this._childrenProxy) {
      const mutators = new Set(["copyWithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift"])
      this._childrenProxy = new Proxy(this._children, {
        get: (target, property, receiver) => {
          if (typeof property !== "string" || !mutators.has(property)) return Reflect.get(target, property, receiver)
          return (...args: unknown[]) => {
            const next = [...target]
            const result = (Array.prototype as any)[property].apply(next, args)
            this.children = next
            return result === next ? receiver : result
          }
        },
        set: (target, property, value) => {
          const next = [...target]
          Reflect.set(next, property, value)
          this.children = next
          return true
        },
      })
    }
    return this._childrenProxy
  }

  public set children(children: (string | TextRenderable)[]) {
    const nextChildren = [...children]
    for (const child of nextChildren) {
      if (isTextRenderable(child)) this.assertCanInsertTextChild(child)
    }

    const previousChildren = [...this._children]
    const previousOwnedChildren = new Set(this._ownedChildren)
    this._children.splice(0)
    this._ownedChildren.clear()
    for (const child of previousChildren) {
      if (!isTextRenderable(child) || child.parent !== this) continue
      child.parent = null
      if (previousOwnedChildren.has(child) && !nextChildren.includes(child)) child.destroyRecursively()
    }
    for (const child of nextChildren) {
      if (isTextRenderable(child) && previousOwnedChildren.has(child)) this._ownedChildren.add(child)
      this.insertTextChild(child, this._children.length)
    }
    for (const child of previousChildren) {
      if (
        isTextRenderable(child) &&
        !nextChildren.includes(child) &&
        !previousOwnedChildren.has(child) &&
        child._textDocumentRole === "owner"
      ) {
        child.attachTextDocumentState()
        child.commitTextDocumentSnapshot()
      }
    }
    this._manualStyledText = null
    this.invalidateTextDocument()
  }

  public get content(): StyledText {
    return this._manualStyledText ?? new StyledText(this.gatherOwnContent())
  }

  public set content(value: StyledText | string) {
    this.replaceContent(value, true)
  }

  public get chunks(): TextChunk[] {
    return this.gatherOwnContent()
  }

  public get textNode(): TextRenderable {
    return this
  }

  public get plainText(): string {
    if (this.hasTextDocumentState && !isTextRenderable(this.parent)) {
      if (this._textDocumentDirty) this.commitTextDocumentSnapshot()
      return super.plainText
    }
    return this.measureOwnContent().plainText
  }

  public get textLength(): number {
    if (this.hasTextDocumentState && !isTextRenderable(this.parent)) {
      if (this._textDocumentDirty) this.commitTextDocumentSnapshot()
      return super.textLength
    }
    return this.measureOwnContent().textLength
  }

  public override get wrapMode(): "none" | "char" | "word" {
    const owner = this.getDocumentOwner()
    return owner && owner !== this ? owner.wrapMode : super.wrapMode
  }

  public override set wrapMode(value: "none" | "char" | "word") {
    const owner = this.getDocumentOwner()
    if (owner && owner !== this) owner.wrapMode = value
    else super.wrapMode = value
  }

  public override get lineInfo(): LineInfo {
    const owner = this.getDocumentOwner()
    if (owner) {
      owner.commitIfDirty()
      return owner === this ? super.lineInfo : owner.lineInfo
    }
    return this.measureOwnContent().lineInfo
  }

  public override get lineCount(): number {
    const owner = this.getDocumentOwner()
    if (owner) {
      owner.commitIfDirty()
      return owner === this ? super.lineCount : owner.lineCount
    }
    return this.measureOwnContent().lineCount
  }

  public override get virtualLineCount(): number {
    const owner = this.getDocumentOwner()
    if (owner) {
      owner.commitIfDirty()
      return owner === this ? super.virtualLineCount : owner.virtualLineCount
    }
    return this.measureOwnContent().virtualLineCount
  }

  public override get scrollY(): number {
    const owner = this.getDocumentOwner()
    return owner && owner !== this ? owner.scrollY : super.scrollY
  }

  public override set scrollY(value: number) {
    const owner = this.getDocumentOwner()
    if (owner && owner !== this) owner.scrollY = value
    else if (this.hasTextDocumentState) super.scrollY = value
    else this._scrollY = Math.max(0, value)
  }

  public override get scrollX(): number {
    const owner = this.getDocumentOwner()
    return owner && owner !== this ? owner.scrollX : super.scrollX
  }

  public override set scrollX(value: number) {
    const owner = this.getDocumentOwner()
    if (owner && owner !== this) owner.scrollX = value
    else if (this.hasTextDocumentState) super.scrollX = value
    else this._scrollX = Math.max(0, value)
  }

  public override get scrollWidth(): number {
    return this.lineInfo.lineWidthColsMax
  }

  public override get scrollHeight(): number {
    return this.lineInfo.lineStartCols.length
  }

  public override get maxScrollY(): number {
    const owner = this.getDocumentOwner()
    return owner && owner !== this ? owner.maxScrollY : Math.max(0, this.scrollHeight - this.height)
  }

  public override get maxScrollX(): number {
    const owner = this.getDocumentOwner()
    return owner && owner !== this ? owner.maxScrollX : Math.max(0, this.scrollWidth - this.width)
  }

  public override shouldStartSelection(x: number, y: number): boolean {
    const owner = this.getDocumentOwner()
    return owner ? (owner === this ? super.shouldStartSelection(x, y) : owner.shouldStartSelection(x, y)) : false
  }

  public override onSelectionChanged(selection: Selection | null): boolean {
    const owner = this.getDocumentOwner()
    return owner ? (owner === this ? super.onSelectionChanged(selection) : owner.onSelectionChanged(selection)) : false
  }

  public override getSelectedText(): string {
    const owner = this.getDocumentOwner()
    return owner ? (owner === this ? super.getSelectedText() : owner.getSelectedText()) : ""
  }

  public override hasSelection(): boolean {
    const owner = this.getDocumentOwner()
    return owner ? (owner === this ? super.hasSelection() : owner.hasSelection()) : false
  }

  public override getSelection(): { start: number; end: number } | null {
    const owner = this.getDocumentOwner()
    return owner ? (owner === this ? super.getSelection() : owner.getSelection()) : null
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
    this._manualStyledText = null
    if (typeof obj === "string" || isTextRenderable(obj)) {
      const insertIndex = this.insertTextChild(obj, index ?? this._children.length)
      this.invalidateTextDocument()
      return insertIndex
    }

    if (isStyledText(obj)) {
      const children = this.styledTextToChildren(obj)
      let insertIndex = Math.max(0, Math.min(index ?? this._children.length, this._children.length))
      const firstIndex = insertIndex
      try {
        for (const child of children) {
          this._ownedChildren.add(child)
          this.insertTextChild(child, insertIndex)
          insertIndex += 1
        }
      } catch (error) {
        for (const child of children.reverse()) {
          const childIndex = this._children.indexOf(child)
          if (childIndex !== -1) this._children.splice(childIndex, 1)
          this._ownedChildren.delete(child)
          if (!child.isDestroyed) child.destroyRecursively()
        }
        throw error
      }
      this.invalidateTextDocument()
      return firstIndex
    }

    throw new Error("TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances")
  }

  public replace(obj: TextRenderable | string, index: number): void {
    if (isTextRenderable(obj)) this.assertCanInsertTextChild(obj)
    const existing = this._children[index]
    if (existing === undefined) {
      this.insertTextChild(obj, index)
      this.invalidateTextDocument()
      return
    }

    if (isTextRenderable(existing) && existing !== obj && existing.parent === this) {
      this.detachTextChild(existing, this._ownedChildren.has(existing))
    }
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
          this.detachFromCurrentTextParent(obj)
        }
      }
      obj.detachTextDocumentState()
      obj.adoptTextContext(this._ctx)
      obj.parent = this
      this._children[targetIndex] = obj
    } else {
      this._children[index] = obj
    }
    this._manualStyledText = null
    this.invalidateTextDocument()
  }

  public insertBefore(
    child: string | TextRenderable | StyledText,
    anchorNode: TextRenderable | string | unknown,
  ): number {
    if (!anchorNode || !isTextRenderable(anchorNode)) throw new Error("Anchor must be a TextNodeRenderable")

    const anchorIndex = this._children.indexOf(anchorNode)
    if (anchorIndex === -1) throw new Error("Anchor node not found in children")
    if (child !== anchorNode) this.add(child, anchorIndex)
    // TextNodeRenderable historically returns itself at runtime. Keep that
    // behavior while satisfying Renderable's numeric structural signature.
    return this as unknown as number
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
    this.detachTextChild(child, this._ownedChildren.has(child))
    this._manualStyledText = null
    this.invalidateTextDocument()
  }

  public clear(): void {
    this.clearChildren(false)
    this._manualStyledText = null
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
    const currentStyle = this.mergeStyles(parentStyle)
    const chunks: TextChunk[] = []
    for (const child of this._children) {
      if (typeof child === "string") {
        chunks.push({ __isChunk: true, text: child, ...currentStyle })
      } else {
        if (child.visible) chunks.push(...child.gatherWithInheritedStyle(currentStyle))
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
    if (!isTextRenderable(this.parent) && this._textDocumentDirty) queueMicrotask(() => this._ctx.requestRender())
    super.render(buffer, deltaTime)
  }

  public destroyRecursively(): void {
    const stack: Array<{ node: TextRenderable; visited: boolean }> = [{ node: this, visited: false }]
    const seen = new Set<TextRenderable>()
    while (stack.length > 0) {
      const entry = stack.pop()!
      if (entry.visited) {
        entry.node.destroy()
        continue
      }
      if (seen.has(entry.node) || entry.node.isDestroyed) continue
      seen.add(entry.node)
      stack.push({ node: entry.node, visited: true })
      const children = entry.node.getTextChildren()
      for (let index = children.length - 1; index >= 0; index--) {
        stack.push({ node: children[index]!, visited: false })
      }
    }
  }

  public destroy(): void {
    if (this.isDestroyed) return
    const children = this.getTextChildren()
    this._children.splice(0)
    let destroyError: unknown
    for (const child of children.reverse()) {
      try {
        if (child.parent === this) this.detachTextChild(child, this._ownedChildren.has(child))
      } catch (error) {
        destroyError ??= error
      }
    }
    try {
      super.destroy()
    } catch (error) {
      destroyError ??= error
    }
    if (destroyError) throw destroyError
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
    const node = new TextRenderable(ctx, options, hasContext ? false : true)
    node._children.push(text)
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
    const node = new TextRenderable(ctx, options, hasContext ? false : true)
    for (const child of nodes) node.insertTextChild(child, node._children.length)
    node._textDocumentDirty = true
    return node
  }

  private replaceContent(content: StyledText | string, requestRender: boolean): void {
    const styledChildren = typeof content === "string" ? [] : this.styledTextToChildren(content)
    this.clearChildren(false)

    if (typeof content === "string") {
      this._manualStyledText = null
      if (content !== "") this._children.push(content)
    } else {
      this._manualStyledText = content
      for (const child of styledChildren) {
        this._ownedChildren.add(child)
        this.insertTextChild(child, this._children.length)
      }
    }

    this._textDocumentDirty = true
    if (requestRender) {
      this.invalidateTextDocument()
      if (this.hasTextDocumentState && this.lastLocalSelection) this.commitTextDocumentSnapshot()
    }
  }

  private styledTextToChildren(styledText: StyledText): TextRenderable[] {
    const children: TextRenderable[] = []
    try {
      for (const chunk of styledText.chunks) {
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
        child._children.push(chunk.text)
        children.push(child)
      }
      return children
    } catch (error) {
      for (const child of children.reverse()) child.destroyRecursively()
      throw error
    }
  }

  private insertTextChild(child: string | TextRenderable, index: number): number {
    let insertIndex = Math.max(0, Math.min(index, this._children.length))
    if (isTextRenderable(child)) {
      this.assertCanInsertTextChild(child)
      if (child.parent === this) {
        const currentIndex = this._children.indexOf(child)
        if (currentIndex !== -1) {
          this._children.splice(currentIndex, 1)
          if (currentIndex < insertIndex) insertIndex -= 1
        }
      } else if (child.parent) {
        this.detachFromCurrentTextParent(child)
      }

      child.detachTextDocumentState()
      child.adoptTextContext(this._ctx)
      child.parent = this
    }

    this._children.splice(insertIndex, 0, child)
    return insertIndex
  }

  private detachTextChild(
    child: TextRenderable,
    destroyOwned: boolean = false,
    restoreDocumentState: boolean = true,
  ): void {
    this._ownedChildren.delete(child)
    child.parent = null
    if (destroyOwned) {
      child.destroyRecursively()
    } else if (restoreDocumentState && child._textDocumentRole === "owner") {
      child.attachTextDocumentState()
      child.commitTextDocumentSnapshot()
    }
  }

  private adoptTextContext(ctx: RenderContext): void {
    if (this._ctx !== ctx) this.adoptTextDocumentContext(ctx)
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
    this._lastCommittedLineInfoFrame = this._ctx.frameId ?? -1
    this.emit("line-info-change")
  }

  protected override emitLineInfoChange(): void {
    if ((this._ctx.frameId ?? -1) === this._lastCommittedLineInfoFrame) return
    super.emitLineInfoChange()
  }

  public allowLayoutTextDocumentPromotion(): void {
    if (this._textDocumentRole === "inline") this._textDocumentRole = "promotable"
  }

  public override onLayoutAttach(ctx: RenderContext): void {
    this.assertNotNestedForLayout()
    this.adoptTextContext(ctx)
    if (this._textDocumentRole === "promotable") {
      this.attachTextDocumentState()
      this._textDocumentRole = "owner"
      this.commitTextDocumentSnapshot()
    }
  }

  private assertNotNestedForLayout(): void {
    if (isTextRenderable(this.parent)) throw new Error("Inline text must be detached before layout attachment")
  }

  private assertCanInsertTextChild(child: TextRenderable): void {
    let current: TextRenderable | null = this
    const visited = new Set<TextRenderable>()
    while (current) {
      if (current === child) throw new Error("TextRenderable cannot contain itself or one of its ancestors")
      if (visited.has(current)) throw new Error("Cannot mutate a cyclic text tree")
      visited.add(current)
      current = isTextRenderable(current.parent) ? current.parent : null
    }
  }

  private detachFromCurrentTextParent(child: TextRenderable): void {
    const parent = child.parent
    if (!isTextRenderable(parent)) {
      parent?.remove(child)
      return
    }
    const index = parent._children.indexOf(child)
    if (index !== -1) parent._children.splice(index, 1)
    parent.detachTextChild(child, false, false)
    parent.invalidateTextDocument()
  }

  private clearChildren(requestRender: boolean): void {
    const previousChildren = [...this._children]
    this._children.splice(0)
    for (const child of previousChildren.reverse()) {
      if (isTextRenderable(child) && child.parent === this) {
        this.detachTextChild(child, this._ownedChildren.has(child))
      }
    }
    if (requestRender) this.invalidateTextDocument()
  }

  private gatherOwnContent(): TextChunk[] {
    return this.gatherWithInheritedStyle()
  }

  private getDocumentOwner(): TextRenderable | null {
    let current: TextRenderable = this
    const visited = new Set<TextRenderable>()
    while (true) {
      if (visited.has(current)) return null
      visited.add(current)
      if (current.hasTextDocumentState) return current
      if (!isTextRenderable(current.parent)) return null
      current = current.parent
    }
  }

  private commitIfDirty(): void {
    if (this._textDocumentDirty) this.commitTextDocumentSnapshot()
  }

  // Temporary range-free measurement seam. Once native text ranges expose child
  // ranges, nested getters can use their outer document without this short-lived buffer.
  private measureOwnContent(): {
    plainText: string
    textLength: number
    lineInfo: LineInfo
    lineCount: number
    virtualLineCount: number
  } {
    const buffer = TextBuffer.create(this._ctx.widthMethod)
    let view: TextBufferView | null = null
    try {
      buffer.setStyledText(new StyledText(this.gatherOwnContent()))
      view = TextBufferView.create(buffer)
      view.setWrapMode(this._wrapMode)
      if (this._wrapMode !== "none" && this.width > 0) view.setWrapWidth(this.width)
      return {
        plainText: buffer.getPlainText(),
        textLength: buffer.length,
        lineInfo: view.logicalLineInfo,
        lineCount: buffer.getLineCount(),
        virtualLineCount: view.getVirtualLineCount(),
      }
    } finally {
      view?.destroy()
      buffer.destroy()
    }
  }
}
