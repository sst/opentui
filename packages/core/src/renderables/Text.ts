import { EventEmitter } from "events"
import { BaseRenderable, type Renderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { isStyledText, StyledText } from "../lib/styled-text.js"
import { type TextChunk } from "../text-buffer.js"
import { TextBuffer } from "../text-buffer.js"
import { TextBufferView } from "../text-buffer-view.js"
import { parseColor, RGBA } from "../lib/RGBA.js"
import type { Selection } from "../lib/selection.js"
import { type RenderContext } from "../types.js"
import type { LineInfo } from "../zig.js"
import { InternalKeyHandler, KeyHandler } from "../lib/KeyHandler.js"
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
  return obj?.[BrandedTextRenderable] === true
}

const detachedLifecyclePasses = new Set<Renderable>()
const detachedTextContext = Object.assign(new EventEmitter(), {
  widthMethod: "wcwidth" as const,
  width: 0,
  height: 0,
  frameId: 0,
  capabilities: null,
  hasSelection: false,
  currentFocusedRenderable: null,
  currentFocusedEditor: null,
  keyInput: new KeyHandler(),
  _internalKeyInput: new InternalKeyHandler(),
  requestRender() {},
  requestLive() {},
  dropLive() {},
  addToHitGrid() {},
  pushHitGridScissorRect() {},
  popHitGridScissorRect() {},
  clearHitGridScissorRects() {},
  setCursorPosition() {},
  setCursorStyle() {},
  setCursorColor() {},
  setMousePointer() {},
  getSelection() {
    return null
  },
  requestSelectionUpdate() {},
  focusRenderable() {},
  blurRenderable() {},
  registerLifecyclePass(renderable: Renderable) {
    detachedLifecyclePasses.add(renderable)
  },
  unregisterLifecyclePass(renderable: Renderable) {
    detachedLifecyclePasses.delete(renderable)
  },
  getLifecyclePasses() {
    return detachedLifecyclePasses
  },
  clearSelection() {},
  startSelection() {},
  updateSelection() {},
}) satisfies RenderContext

function isRenderContext(value: RenderContext | TextOptions): value is RenderContext {
  return typeof (value as RenderContext).requestRender === "function"
}

export class TextRenderable extends TextBufferRenderable {
  get [BrandedTextRenderable](): true {
    return true
  }

  private _children: (string | TextRenderable)[] = []
  private _localFg?: RGBA
  private _localBg?: RGBA
  private _localAttributes: number = 0
  private _link?: { url: string }
  private _textDocumentDirty: boolean = true
  private _textDocumentRole: "owner" | "promotable" | "inline" = "inline"
  private readonly _ownedChildren = new Set<TextRenderable>()
  private _manualStyledText: StyledText | null = null
  private _lastCommittedLineInfoFrame: number = -1
  private _layoutPromotionPending: boolean = false

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
    const detachedRole = maybeOptions === false ? "inline" : "promotable"
    const shouldAttach = hasContext ? attachTextDocumentState : false

    super(ctx, options, shouldAttach)

    try {
      this._textDocumentRole = hasContext ? (shouldAttach ? "owner" : "inline") : detachedRole
      this._localFg = options.fg ? parseColor(options.fg) : undefined
      this._localBg = options.bg ? parseColor(options.bg) : undefined
      this._localAttributes = options.attributes ?? 0
      this._link = options.link

      if (options.content !== undefined) this.replaceContent(options.content, false)
      if (this.hasTextDocumentState) this.commitTextDocumentSnapshot()
    } catch (error) {
      try {
        this.destroy()
      } catch {}
      throw error
    }
  }

  public get children(): readonly (string | TextRenderable)[] {
    return [...this._children]
  }

  public set children(children: (string | TextRenderable)[]) {
    const nextChildren = [...children]
    const seenChildren = new Set<TextRenderable>()
    for (const child of nextChildren) {
      if (typeof child === "string") continue
      if (!isTextRenderable(child))
        throw new Error("TextRenderable children must be strings or TextRenderable instances")
      if (seenChildren.has(child)) throw new Error("A TextRenderable child cannot appear more than once")
      seenChildren.add(child)
      this.assertCanInsertTextChild(child)
    }

    const previousChildren = [...this._children]
    const previousOwnedChildren = new Set(this._ownedChildren)
    const parentSnapshots = new Map<
      TextRenderable,
      {
        children: (string | TextRenderable)[]
        ownedChildren: Set<TextRenderable>
        manualStyledText: StyledText | null
        dirty: boolean
      }
    >()
    const snapshotParent = (parent: TextRenderable): void => {
      if (parentSnapshots.has(parent)) return
      parentSnapshots.set(parent, {
        children: [...parent._children],
        ownedChildren: new Set(parent._ownedChildren),
        manualStyledText: parent._manualStyledText,
        dirty: parent._textDocumentDirty,
      })
    }
    snapshotParent(this)

    const childSnapshots = new Map<
      TextRenderable,
      {
        parent: BaseRenderable | null
        context: RenderContext
        hadDocumentState: boolean
        layoutIndex: number
      }
    >()
    const snapshotChild = (child: TextRenderable): void => {
      if (childSnapshots.has(child)) return
      const parent = child.parent
      if (isTextRenderable(parent)) snapshotParent(parent)
      childSnapshots.set(child, {
        parent,
        context: child.ctx,
        hadDocumentState: child.hasTextDocumentState,
        layoutIndex: parent && !isTextRenderable(parent) ? parent.getChildren().indexOf(child) : -1,
      })
    }
    for (const child of seenChildren) snapshotChild(child)
    for (const child of previousChildren) {
      if (isTextRenderable(child)) snapshotChild(child)
    }

    const rollback = (): void => {
      for (const [parent, snapshot] of parentSnapshots) {
        parent._children = [...snapshot.children]
        parent._ownedChildren.clear()
        for (const child of snapshot.ownedChildren) parent._ownedChildren.add(child)
        parent._manualStyledText = snapshot.manualStyledText
        parent._textDocumentDirty = snapshot.dirty
        for (const child of parent.getTextChildren()) child.parent = parent
      }
      for (const [child, snapshot] of childSnapshots) {
        if (snapshot.parent && !isTextRenderable(snapshot.parent) && child.parent !== snapshot.parent) {
          try {
            snapshot.parent.add(child, snapshot.layoutIndex < 0 ? undefined : snapshot.layoutIndex)
          } catch {}
        } else if (!snapshot.parent) {
          child.parent = null
        }
        try {
          child.adoptTextContext(snapshot.context)
          if (snapshot.hadDocumentState && !child.hasTextDocumentState) child.attachTextDocumentState()
          if (!snapshot.hadDocumentState && child.hasTextDocumentState) child.detachTextDocumentState()
        } catch {}
      }
    }

    try {
      for (const child of seenChildren) {
        const parent = child.parent
        if (isTextRenderable(parent) && parent !== this) {
          const index = parent._children.indexOf(child)
          if (index !== -1) parent._children.splice(index, 1)
          parent._ownedChildren.delete(child)
          child.parent = null
        } else if (parent && parent !== this) {
          parent.remove(child)
        }
        child.detachTextDocumentState()
        child.adoptTextContext(this._ctx)
        child.parent = this
      }

      this._children = nextChildren
      this._ownedChildren.clear()
      for (const child of previousOwnedChildren) {
        if (seenChildren.has(child)) this._ownedChildren.add(child)
      }

      for (const child of previousChildren) {
        if (!isTextRenderable(child) || seenChildren.has(child) || child.parent !== this) continue
        child.parent = null
        if (!previousOwnedChildren.has(child) && child._textDocumentRole === "owner") {
          child.attachTextDocumentState()
          child.commitTextDocumentSnapshot()
        }
      }
    } catch (error) {
      rollback()
      throw error
    }

    this._manualStyledText = null
    for (const parent of parentSnapshots.keys()) {
      if (parent !== this) parent.invalidateTextDocument()
    }
    this.invalidateTextDocument()

    const destroyErrors: unknown[] = []
    for (const child of previousOwnedChildren) {
      if (seenChildren.has(child)) continue
      try {
        child.destroyRecursively()
      } catch (error) {
        destroyErrors.push(error)
      }
    }
    if (destroyErrors.length === 1) throw destroyErrors[0]
    if (destroyErrors.length > 1) throw new AggregateError(destroyErrors, "Failed to destroy replaced text children")
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
    if (typeof obj === "string" || isTextRenderable(obj)) {
      let insertIndex = Math.max(0, Math.min(index ?? this._children.length, this._children.length))
      const nextChildren = [...this._children]
      if (isTextRenderable(obj) && obj.parent === this) {
        const currentIndex = nextChildren.indexOf(obj)
        if (currentIndex !== -1) {
          nextChildren.splice(currentIndex, 1)
          if (currentIndex < insertIndex) insertIndex -= 1
        }
      }
      nextChildren.splice(insertIndex, 0, obj)
      this.children = nextChildren
      return insertIndex
    }

    if (isStyledText(obj)) {
      const children = this.styledTextToChildren(obj)
      const insertIndex = Math.max(0, Math.min(index ?? this._children.length, this._children.length))
      const firstIndex = insertIndex
      try {
        const nextChildren = [...this._children]
        nextChildren.splice(insertIndex, 0, ...children)
        this.children = nextChildren
        for (const child of children) this._ownedChildren.add(child)
      } catch (error) {
        const committed = children.every((child, childIndex) => this._children[insertIndex + childIndex] === child)
        if (committed) {
          for (const child of children) this._ownedChildren.add(child)
        } else {
          for (const child of children.reverse()) {
            if (!child.isDestroyed) child.destroyRecursively()
          }
        }
        throw error
      }
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

    const nextChildren = [...this._children]
    let targetIndex = index
    if (isTextRenderable(obj) && obj.parent === this) {
      const currentIndex = nextChildren.indexOf(obj)
      if (currentIndex !== -1 && currentIndex !== targetIndex) {
        nextChildren.splice(currentIndex, 1)
        if (currentIndex < targetIndex) targetIndex -= 1
      }
    }
    nextChildren[targetIndex] = obj
    this.children = nextChildren
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
    this.refreshFirstLineOffsetClaim()
    if (!isTextRenderable(this.parent) && this._textDocumentDirty) this.commitTextDocumentSnapshot()
  }

  public render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!isTextRenderable(this.parent) && this._textDocumentDirty) queueMicrotask(() => this._ctx.requestRender())
    super.render(buffer, deltaTime)
  }

  public destroyRecursively(): void {
    const stack: Array<{ node: TextRenderable; visited: boolean }> = [{ node: this, visited: false }]
    const seen = new Set<TextRenderable>()
    const errors: unknown[] = []
    while (stack.length > 0) {
      const entry = stack.pop()!
      if (entry.visited) {
        try {
          entry.node.destroy()
        } catch (error) {
          errors.push(error)
        }
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
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) throw new AggregateError(errors, `Failed to destroy text tree rooted at ${this.id}`)
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
    const node = hasContext ? new TextRenderable(ctx, options, false) : new TextRenderable(options)
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
    const node = hasContext ? new TextRenderable(ctx, options, false) : new TextRenderable(options)
    try {
      node.children = nodes
      node._textDocumentDirty = true
      return node
    } catch (error) {
      try {
        node.destroyRecursively()
      } catch {}
      throw error
    }
  }

  private replaceContent(content: StyledText | string, requestRender: boolean): void {
    const styledChildren = typeof content === "string" ? [] : this.styledTextToChildren(content)
    const nextChildren: (string | TextRenderable)[] =
      typeof content === "string" ? (content === "" ? [] : [content]) : styledChildren
    try {
      this.children = nextChildren
    } catch (error) {
      const committed =
        this._children.length === nextChildren.length &&
        this._children.every((child, index) => child === nextChildren[index])
      if (committed && typeof content !== "string") {
        for (const child of styledChildren) this._ownedChildren.add(child)
        this._manualStyledText = content
      } else {
        for (const child of styledChildren.reverse()) {
          if (!child.isDestroyed) {
            try {
              child.destroyRecursively()
            } catch {}
          }
        }
      }
      throw error
    }

    this._manualStyledText = typeof content === "string" ? null : content
    for (const child of styledChildren) this._ownedChildren.add(child)
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
    const shouldPromote = this._textDocumentRole === "promotable"
    try {
      this.adoptTextContext(ctx)
      if (shouldPromote) {
        this.attachTextDocumentState()
        this._textDocumentRole = "owner"
        this._layoutPromotionPending = true
      }
      super.onLayoutAttach(ctx)
    } catch (error) {
      if (shouldPromote) {
        try {
          this.detachTextDocumentState()
        } catch {}
        this._textDocumentRole = "promotable"
        this._layoutPromotionPending = false
      }
      throw error
    }
  }

  public override onLayoutAttached(): void {
    try {
      if (this._textDocumentDirty) this.commitTextDocumentSnapshot()
      this._layoutPromotionPending = false
    } catch (error) {
      if (this._layoutPromotionPending) {
        try {
          this.detachTextDocumentState()
        } catch {}
        this._textDocumentRole = "promotable"
        this._layoutPromotionPending = false
      }
      throw error
    }
  }

  public override onLayoutDetach(ctx: RenderContext): void {
    super.onLayoutDetach(ctx)
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
    let result:
      | {
          plainText: string
          textLength: number
          lineInfo: LineInfo
          lineCount: number
          virtualLineCount: number
        }
      | undefined
    let primaryError: unknown
    try {
      buffer.setStyledText(new StyledText(this.gatherOwnContent()))
      view = TextBufferView.create(buffer)
      view.setWrapMode(this._wrapMode)
      if (this._wrapMode !== "none" && this.width > 0) view.setWrapWidth(this.width)
      result = {
        plainText: buffer.getPlainText(),
        textLength: buffer.length,
        lineInfo: view.logicalLineInfo,
        lineCount: buffer.getLineCount(),
        virtualLineCount: view.getVirtualLineCount(),
      }
    } catch (error) {
      primaryError = error
    }
    let cleanupError: unknown
    try {
      view?.destroy()
    } catch (error) {
      cleanupError = error
    }
    try {
      buffer.destroy()
    } catch (error) {
      cleanupError ??= error
    }
    if (primaryError) throw primaryError
    if (cleanupError) throw cleanupError
    return result!
  }
}
