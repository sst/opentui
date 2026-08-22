import { EventEmitter } from "events"
import { BaseRenderable, type Renderable } from "../Renderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import { isStyledText, StyledText } from "../lib/styled-text.js"
import { type TextChunk } from "../text-buffer.js"
import { parseColor, RGBA } from "../lib/RGBA.js"
import type { Selection } from "../lib/selection.js"
import { type RenderContext } from "../types.js"
import type { LineInfo } from "../zig.js"
import type { DocumentOperation, DocumentRangeInput } from "../zig.js"
import stringWidth from "string-width"
import { InternalKeyHandler, KeyHandler } from "../lib/KeyHandler.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"
import type { SyntaxStyle } from "../syntax-style.js"

export interface TextOptions extends TextBufferOptions {
  content?: StyledText | string
  link?: { url: string }
  styleId?: number
  styleSource?: SyntaxStyle
}

export type TextStyle = {
  fg?: RGBA
  bg?: RGBA
  attributes: number
  link?: { url: string }
  styleId?: number
  styleSource?: SyntaxStyle
}

const BrandedTextRenderable: unique symbol = Symbol.for("@opentui/core/TextRenderable")
let nextTextDocumentOwner = 1
let textDocumentMutationDepth = 0
const deferredDocumentOwners = new Set<TextRenderable>()
let nextStyledLeafStyleSource = 1
const styledLeafStyleSources = new WeakMap<object, number>()
const simpleStyledLeafStyles = new Map<number, TextStyle>()

export type TextRenderableDebugMetrics = {
  textRenderableAllocations: number
  yogaNodeAllocations: number
  styledLeafAllocations: number
  documentOperations: number
  documentChunks: number
  documentRanges: number
  documentTreeWalks: number
  yogaDirties: number
  renderRequests: number
}

const textRenderableDebugMetrics: TextRenderableDebugMetrics = {
  textRenderableAllocations: 0,
  yogaNodeAllocations: 0,
  styledLeafAllocations: 0,
  documentOperations: 0,
  documentChunks: 0,
  documentRanges: 0,
  documentTreeWalks: 0,
  yogaDirties: 0,
  renderRequests: 0,
}

type TextLeaf = {
  text: string
  style: TextStyle | null
  rangeId: bigint | null
}

type NativeRangeSnapshot = {
  node: TextRenderable
  id: bigint | null
  leafIds: Array<bigint | null>
}

function hasTextStyle(style: TextStyle): boolean {
  return (
    style.fg !== undefined ||
    style.bg !== undefined ||
    style.attributes !== 0 ||
    style.link !== undefined ||
    style.styleId !== undefined
  )
}

type PreparedTextDocumentFlush = {
  operations: DocumentOperation[]
  assignments: Array<(id: bigint) => void>
  contentChanged: boolean
}

type PlannedNativeMove = { source: TextRenderable; anchor: TextRenderable; before: boolean }

type PendingNativeMove = PlannedNativeMove & {
  parent: TextRenderable
  sourceId: bigint
  anchorId: bigint
  parentId: bigint | null
  owner: number
}

type NativeReplacementPlan = {
  roots: TextRenderable[]
  rangeIds: Set<bigint>
}

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

function measureLine(line: string): number {
  let width = 0
  for (const [index, part] of line.split("\t").entries()) {
    if (index !== 0) width += 4 - (width % 4)
    width += stringWidth(part)
  }
  return width
}

function measureTextLength(text: string): number {
  return text.split("\n").reduce((total, line) => total + measureLine(line), 0)
}

function localLineInfo(text: string): LineInfo {
  const lines = text.split("\n")
  const widths = lines.map(measureLine)
  return {
    lineStartCols: lines.map(() => 0),
    lineWidthCols: widths,
    lineSources: lines.map((_, index) => index),
    lineWraps: lines.map(() => 0),
    lineWidthColsMax: Math.max(0, ...widths),
  }
}

type ChildOrderNode = {
  child: TextRenderable
  priority: number
  size: number
  left: ChildOrderNode | null
  right: ChildOrderNode | null
  parent: ChildOrderNode | null
}

function childOrderSize(node: ChildOrderNode | null): number {
  return node?.size ?? 0
}

function setChildOrderLeft(node: ChildOrderNode, child: ChildOrderNode | null): void {
  node.left = child
  if (child) child.parent = node
  node.size = 1 + childOrderSize(node.left) + childOrderSize(node.right)
}

function setChildOrderRight(node: ChildOrderNode, child: ChildOrderNode | null): void {
  node.right = child
  if (child) child.parent = node
  node.size = 1 + childOrderSize(node.left) + childOrderSize(node.right)
}

function mergeChildOrder(left: ChildOrderNode | null, right: ChildOrderNode | null): ChildOrderNode | null {
  if (!left) {
    if (right) right.parent = null
    return right
  }
  if (!right) {
    left.parent = null
    return left
  }
  if (left.priority < right.priority) {
    setChildOrderRight(left, mergeChildOrder(left.right, right))
    left.parent = null
    return left
  }
  setChildOrderLeft(right, mergeChildOrder(left, right.left))
  right.parent = null
  return right
}

function splitChildOrder(root: ChildOrderNode | null, count: number): [ChildOrderNode | null, ChildOrderNode | null] {
  if (!root) return [null, null]
  if (childOrderSize(root.left) >= count) {
    const [left, middle] = splitChildOrder(root.left, count)
    setChildOrderLeft(root, middle)
    root.parent = null
    return [left, root]
  }
  const [middle, right] = splitChildOrder(root.right, count - childOrderSize(root.left) - 1)
  setChildOrderRight(root, middle)
  root.parent = null
  return [root, right]
}

class PendingChildOrder {
  private root: ChildOrderNode | null = null
  private readonly nodes = new Map<TextRenderable, ChildOrderNode>()

  constructor(children: TextRenderable[]) {
    for (const child of children) {
      let value = child.num | 0
      value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
      value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
      const node: ChildOrderNode = {
        child,
        priority: (value ^ (value >>> 16)) >>> 0,
        size: 1,
        left: null,
        right: null,
        parent: null,
      }
      this.nodes.set(child, node)
      this.root = mergeChildOrder(this.root, node)
    }
  }

  public get length(): number {
    return childOrderSize(this.root)
  }

  public at(index: number): TextRenderable {
    let node = this.root
    while (node) {
      const leftSize = childOrderSize(node.left)
      if (index < leftSize) node = node.left
      else if (index === leftSize) return node.child
      else {
        index -= leftSize + 1
        node = node.right
      }
    }
    throw new Error("Text child order index is out of bounds")
  }

  public indexOf(child: TextRenderable): number {
    const node = this.nodes.get(child)
    if (!node) return -1
    let index = childOrderSize(node.left)
    let current = node
    while (current.parent) {
      if (current === current.parent.right) index += childOrderSize(current.parent.left) + 1
      current = current.parent
    }
    return index
  }

  public move(child: TextRenderable, index: number): void {
    const currentIndex = this.indexOf(child)
    const [before, tail] = splitChildOrder(this.root, currentIndex)
    const [node, after] = splitChildOrder(tail, 1)
    this.root = mergeChildOrder(before, after)
    const [left, right] = splitChildOrder(this.root, index)
    this.root = mergeChildOrder(mergeChildOrder(left, node), right)
  }

  public toArray(): TextRenderable[] {
    const result: TextRenderable[] = []
    const stack: ChildOrderNode[] = []
    let node = this.root
    while (node || stack.length > 0) {
      while (node) {
        stack.push(node)
        node = node.left
      }
      node = stack.pop()!
      result.push(node.child)
      node = node.right
    }
    return result
  }
}

export class TextRenderable extends TextBufferRenderable {
  get [BrandedTextRenderable](): true {
    return true
  }

  private _children: (string | TextRenderable)[] = []
  private _pendingChildOrder: PendingChildOrder | null = null
  private _leaves: (TextLeaf | null)[] = []
  private _localFg?: RGBA
  private _localBg?: RGBA
  private _localAttributes: number = 0
  private _link?: { url: string }
  private _localStyleId?: number
  private _localSyntaxStyle?: SyntaxStyle
  private _pendingRegisteredStyle?: { styleId?: number; styleSource?: SyntaxStyle }
  private _textDocumentPending: boolean = true
  private _nativeRangeId: bigint | null = null
  private _textDocumentOwner = 0
  private readonly _pendingDocumentRoots = new Set<TextRenderable>()
  private readonly _pendingStyleRoots = new Set<TextRenderable>()
  private readonly _pendingRemovedRangeIds = new Set<bigint>()
  private _pendingNativeMoves: PendingNativeMove[] = []
  private _textDocumentRole: "owner" | "promotable" | "inline" = "inline"
  private readonly _ownedChildren = new Set<TextRenderable>()
  private _manualStyledText: StyledText | null = null
  private _manualRangesUnchanged = false
  private _manualStyledSyntaxStyle: SyntaxStyle | null = null
  private _lastCommittedLineInfoFrame: number = -1
  private _layoutPromotionPending: boolean = false
  private readonly _structuralMoveMetrics = { orderNodes: 0, orderMoves: 0, materializedChildren: 0 }

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
    textRenderableDebugMetrics.textRenderableAllocations += 1
    textRenderableDebugMetrics.yogaNodeAllocations += 1

    try {
      this._textDocumentRole = hasContext ? (shouldAttach ? "owner" : "inline") : detachedRole
      this._localFg = options.fg ? parseColor(options.fg) : undefined
      this._localBg = options.bg ? parseColor(options.bg) : undefined
      this._localAttributes = options.attributes ?? 0
      this._link = options.link
      if ((options.styleId === undefined) !== (options.styleSource === undefined)) {
        throw new Error("Registered text styles require both styleId and styleSource")
      }
      this.assignRegisteredStyle(options.styleId, options.styleSource)

      if (options.content !== undefined) this.replaceContent(options.content, false)
      if (this.hasTextDocumentState) this.flushTextDocument()
    } catch (error) {
      try {
        this.destroy()
      } catch {}
      throw error
    }
  }

  private materializeChildOrder(): (string | TextRenderable)[] {
    if (this._pendingChildOrder) {
      this._structuralMoveMetrics.materializedChildren += this._pendingChildOrder.length
      this._children = this._pendingChildOrder.toArray()
      this._leaves = this._children.map(() => null)
      this._pendingChildOrder = null
    }
    return this._children
  }

  private materializePendingChildOrders(): void {
    const children = this.materializeChildOrder()
    for (const child of children) if (isTextRenderable(child)) child.materializePendingChildOrders()
  }

  public get children(): readonly (string | TextRenderable)[] {
    return [...this.materializeChildOrder()]
  }

  public set children(children: (string | TextRenderable)[]) {
    this.materializeChildOrder()
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
    const documentOwnerBefore = this.getDocumentOwner()
    const isPureNativeReorder =
      previousChildren.length === nextChildren.length &&
      previousChildren.every(isTextRenderable) &&
      nextChildren.every(isTextRenderable) &&
      previousChildren.every((child) => seenChildren.has(child)) &&
      this._manualStyledText === null &&
      documentOwnerBefore !== null
    if (isPureNativeReorder) {
      const moves = this.planNativeChildMoves(previousChildren as TextRenderable[], nextChildren as TextRenderable[])
      const nativeMoves = moves.flatMap((move) => {
        const nativeMove = documentOwnerBefore!.createPendingNativeMove(this, move)
        return nativeMove ? [nativeMove] : []
      })
      const nextPendingMoves = [...documentOwnerBefore!._pendingNativeMoves, ...nativeMoves]
      const previousDirty = this._dirty
      try {
        this.requestRender()
      } catch (error) {
        this._dirty = previousDirty
        throw error
      }
      documentOwnerBefore!._pendingNativeMoves = nextPendingMoves
      if (nativeMoves.length > 0) documentOwnerBefore!._textDocumentPending = true
      this._children = nextChildren
      this._leaves = nextChildren.map(() => null)
      this._manualStyledText = null
      return
    }
    const previousLeaves = [...this._leaves]
    const nextLeaves = nextChildren.map((child, index) => {
      if (typeof child !== "string") return null
      if (nextChildren.length === 1) return null
      const previous = previousChildren[index]
      const leaf = previousLeaves[index]
      return typeof previous === "string" && leaf?.style === null ? leaf : { text: child, style: null, rangeId: null }
    })
    const previousOwnedChildren = new Set(this._ownedChildren)
    const parentSnapshots = new Map<
      TextRenderable,
      {
        children: (string | TextRenderable)[]
        ownedChildren: Set<TextRenderable>
        manualStyledText: StyledText | null
        leaves: (TextLeaf | null)[]
        manualStyledSyntaxStyle: SyntaxStyle | null
        documentDirty: boolean
        renderDirty: boolean
        pendingRemovedRangeIds: Set<bigint>
        pendingDocumentRoots: Set<TextRenderable>
        pendingStyleRoots: Set<TextRenderable>
        pendingNativeMoves: PendingNativeMove[]
      }
    >()
    const snapshotParent = (parent: TextRenderable): void => {
      if (parentSnapshots.has(parent)) return
      parent.materializeChildOrder()
      parentSnapshots.set(parent, {
        children: [...parent._children],
        ownedChildren: new Set(parent._ownedChildren),
        manualStyledText: parent._manualStyledText,
        leaves: [...parent._leaves],
        manualStyledSyntaxStyle: parent._manualStyledSyntaxStyle,
        documentDirty: parent._textDocumentPending,
        renderDirty: parent._dirty,
        pendingRemovedRangeIds: new Set(parent._pendingRemovedRangeIds),
        pendingDocumentRoots: new Set(parent._pendingDocumentRoots),
        pendingStyleRoots: new Set(parent._pendingStyleRoots),
        pendingNativeMoves: [...parent._pendingNativeMoves],
      })
    }
    snapshotParent(this)
    if (documentOwnerBefore && documentOwnerBefore !== this) snapshotParent(documentOwnerBefore)

    const childSnapshots = new Map<
      TextRenderable,
      {
        parent: BaseRenderable | null
        context: RenderContext
        hadDocumentState: boolean
        layoutIndex: number
        nativeRanges: NativeRangeSnapshot[]
      }
    >()
    const snapshotChild = (child: TextRenderable): void => {
      if (childSnapshots.has(child)) return
      const parent = child.parent
      if (isTextRenderable(parent)) {
        snapshotParent(parent)
        const owner = parent.getDocumentOwner()
        if (owner) snapshotParent(owner)
      }
      childSnapshots.set(child, {
        parent,
        context: child.ctx,
        hadDocumentState: child.hasTextDocumentState,
        layoutIndex: parent && !isTextRenderable(parent) ? parent.getChildren().indexOf(child) : -1,
        nativeRanges: child.captureNativeRanges(),
      })
    }
    for (const child of seenChildren) snapshotChild(child)
    for (const child of previousChildren) {
      if (isTextRenderable(child)) snapshotChild(child)
    }
    const sourceDocumentOwners = new Set<TextRenderable>()
    for (const child of seenChildren) {
      const owner = child.getDocumentOwner()
      if (!child.hasTextDocumentState && owner && owner !== documentOwnerBefore) sourceDocumentOwners.add(owner)
    }
    if (sourceDocumentOwners.size > 1) {
      throw new Error("A single text mutation cannot transfer children from multiple text documents")
    }
    for (const owner of sourceDocumentOwners) snapshotParent(owner)
    const deferredBefore = new Set(deferredDocumentOwners)

    const rollback = (): void => {
      for (const [parent, snapshot] of parentSnapshots) {
        parent._children = [...snapshot.children]
        parent._ownedChildren.clear()
        for (const child of snapshot.ownedChildren) parent._ownedChildren.add(child)
        parent._manualStyledText = snapshot.manualStyledText
        parent._leaves = [...snapshot.leaves]
        parent._manualStyledSyntaxStyle = snapshot.manualStyledSyntaxStyle
        parent._textDocumentPending = snapshot.documentDirty
        parent._dirty = snapshot.renderDirty
        parent._pendingRemovedRangeIds.clear()
        for (const id of snapshot.pendingRemovedRangeIds) parent._pendingRemovedRangeIds.add(id)
        parent._pendingDocumentRoots.clear()
        for (const root of snapshot.pendingDocumentRoots) parent._pendingDocumentRoots.add(root)
        parent._pendingStyleRoots.clear()
        for (const root of snapshot.pendingStyleRoots) parent._pendingStyleRoots.add(root)
        parent._pendingNativeMoves.splice(0, parent._pendingNativeMoves.length, ...snapshot.pendingNativeMoves)
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
          if (snapshot.hadDocumentState && !child.hasTextDocumentState) {
            child.attachTextDocumentState()
            child.resetNativeRanges()
            child.flushTextDocument()
          }
          if (!snapshot.hadDocumentState && child.hasTextDocumentState) child.detachTextDocumentState()
          child.restoreNativeRanges(snapshot.nativeRanges)
        } catch {}
      }
    }

    textDocumentMutationDepth += 1
    try {
      for (const child of seenChildren) {
        const parent = child.parent
        const sourceOwner = child.getDocumentOwner()
        if (isTextRenderable(parent) && parent !== this) {
          const index = parent._children.indexOf(child)
          if (index !== -1) {
            parent._children.splice(index, 1)
            parent._leaves.splice(index, 1)
          }
          parent._ownedChildren.delete(child)
          child.parent = null
        } else if (parent && parent !== this) {
          parent.remove(child)
        }
        const hadDocumentState = child.hasTextDocumentState
        child.detachTextDocumentState()
        const targetOwner = this.getDocumentOwner()
        if (hadDocumentState || (sourceOwner && targetOwner && sourceOwner !== targetOwner)) {
          if (!hadDocumentState) sourceOwner?.queueNativeRangeRemoval(child)
          child.resetNativeRanges()
        }
        child.adoptTextContext(this._ctx)
        child.parent = this
      }

      if (this._manualStyledText !== null) documentOwnerBefore?.queuePrivateLeafRemovals(this)
      this._children = nextChildren
      this._leaves = nextLeaves
      for (let index = 0; index < this._children.length; index++) {
        const child = this._children[index]
        const leaf = this._leaves[index]
        if (typeof child === "string" && leaf) leaf.text = child
      }
      this._ownedChildren.clear()
      for (const child of previousOwnedChildren) {
        if (seenChildren.has(child)) this._ownedChildren.add(child)
      }

      for (const child of previousChildren) {
        if (!isTextRenderable(child) || seenChildren.has(child) || child.parent !== this) continue
        documentOwnerBefore?.queueNativeRangeRemoval(child)
        child.parent = null
        if (!previousOwnedChildren.has(child) && child._textDocumentRole === "owner") {
          child.attachTextDocumentState()
          child.resetNativeRanges()
          child.flushTextDocument()
        }
      }

      this._manualStyledText = null
      this._manualStyledSyntaxStyle = null
      for (const parent of parentSnapshots.keys()) {
        if (parent !== this) parent.invalidateTextDocument()
      }
      this.invalidateTextDocument()

      const sourceOwner = sourceDocumentOwners.values().next().value
      const targetOwner = this.getDocumentOwner()
      if (sourceOwner && targetOwner && sourceOwner !== targetOwner && sourceOwner.hasTextDocumentState) {
        TextRenderable.flushTwoTextDocuments(sourceOwner, targetOwner)
      }
    } catch (error) {
      rollback()
      deferredDocumentOwners.clear()
      for (const owner of deferredBefore) deferredDocumentOwners.add(owner)
      throw error
    } finally {
      textDocumentMutationDepth -= 1
      if (textDocumentMutationDepth === 0) {
        const owners = [...deferredDocumentOwners]
        deferredDocumentOwners.clear()
        for (const owner of owners) owner.flushTextDocument()
      }
    }

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
    if (isTextRenderable(this.parent) && !this.ancestorsVisible()) return this.detachedPlainText()
    const owner = this.getDocumentOwner()
    if (owner) {
      owner.flushTextDocument()
      if (this._nativeRangeId !== null) return owner.textBuffer.getDocumentRangeText(this._nativeRangeId) ?? ""
    }
    return this.detachedPlainText()
  }

  public get textLength(): number {
    if (isTextRenderable(this.parent) && !this.ancestorsVisible()) return measureTextLength(this.detachedPlainText())
    const owner = this.getDocumentOwner()
    if (owner) {
      owner.flushTextDocument()
      if (this._nativeRangeId !== null) return owner.textBuffer.measureDocumentRange(this._nativeRangeId)
    }
    return measureTextLength(this.detachedPlainText())
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
    return localLineInfo(this.detachedPlainText())
  }

  public override get lineCount(): number {
    const owner = this.getDocumentOwner()
    if (owner) {
      owner.commitIfDirty()
      return owner === this ? super.lineCount : owner.lineCount
    }
    return this.detachedPlainText().split("\n").length
  }

  public override get virtualLineCount(): number {
    const owner = this.getDocumentOwner()
    if (owner) {
      owner.commitIfDirty()
      return owner === this ? super.virtualLineCount : owner.virtualLineCount
    }
    return this.detachedPlainText().split("\n").length
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
    this.invalidateTextStyles()
  }

  public get bg(): RGBA | undefined {
    return this._localBg
  }

  public set bg(value: RGBA | string | undefined) {
    const next = value ? parseColor(value) : undefined
    if (this._localBg === next) return
    this._localBg = next
    this._defaultBg = next ?? this._defaultOptions.bg
    this.invalidateTextStyles()
  }

  public get attributes(): number {
    return this._localAttributes
  }

  public set attributes(value: number) {
    if (this._localAttributes === value) return
    this._localAttributes = value
    this._defaultAttributes = value
    this.invalidateTextStyles()
  }

  public get link(): { url: string } | undefined {
    return this._link
  }

  public set link(value: { url: string } | undefined) {
    if (this._link === value) return
    this._link = value
    this.invalidateTextStyles()
  }

  public get styleId(): number | undefined {
    return this._pendingRegisteredStyle ? this._pendingRegisteredStyle.styleId : this._localStyleId
  }

  public set styleId(value: number | undefined) {
    this.stageRegisteredStyle(
      value,
      this._pendingRegisteredStyle ? this._pendingRegisteredStyle.styleSource : this._localSyntaxStyle,
    )
  }

  public get styleSource(): SyntaxStyle | undefined {
    return this._pendingRegisteredStyle ? this._pendingRegisteredStyle.styleSource : this._localSyntaxStyle
  }

  public set styleSource(value: SyntaxStyle | undefined) {
    this.stageRegisteredStyle(
      this._pendingRegisteredStyle ? this._pendingRegisteredStyle.styleId : this._localStyleId,
      value,
    )
  }

  public setRegisteredStyle(styleId: number | undefined, styleSource: SyntaxStyle | undefined): void {
    this._pendingRegisteredStyle = undefined
    if (this.assignRegisteredStyle(styleId, styleSource)) this.invalidateTextStyles()
  }

  private stageRegisteredStyle(styleId: number | undefined, styleSource: SyntaxStyle | undefined): void {
    this._pendingRegisteredStyle = { styleId, styleSource }
    const owner = this.getDocumentOwner()
    if (owner) {
      owner._pendingStyleRoots.add(this)
      owner._textDocumentPending = true
    }
    this.requestRender()
  }

  private commitPendingRegisteredStyles(): void {
    if (this._pendingRegisteredStyle) {
      const pending = this._pendingRegisteredStyle
      this._pendingRegisteredStyle = undefined
      this.assignRegisteredStyle(pending.styleId, pending.styleSource)
    }
    for (const child of this.getTextChildren()) child.commitPendingRegisteredStyles()
  }

  private assignRegisteredStyle(styleId: number | undefined, styleSource: SyntaxStyle | undefined): boolean {
    if (styleId === undefined || styleSource === undefined) {
      if (styleId !== undefined || styleSource !== undefined) {
        if (this._localStyleId === undefined && this._localSyntaxStyle === undefined) return false
      }
      const changed = this._localStyleId !== undefined || this._localSyntaxStyle !== undefined
      this._localStyleId = undefined
      this._localSyntaxStyle = undefined
      return changed
    }

    if (!Number.isInteger(styleId) || styleId <= 0 || !styleSource.getStyleById(styleId)) {
      throw new Error(`Unknown registered text style ID ${styleId}`)
    }
    if (this._localStyleId === styleId && this._localSyntaxStyle === styleSource) return false
    this._localStyleId = styleId
    this._localSyntaxStyle = styleSource
    return true
  }

  public requestRender(): void {
    textRenderableDebugMetrics.renderRequests += 1
    this.markDirty()
    this._ctx.requestRender()
  }

  public add(obj: TextRenderable | StyledText | string, index?: number): number {
    if (typeof obj === "string" || isTextRenderable(obj)) {
      const childCount = this._pendingChildOrder?.length ?? this._children.length
      let insertIndex = Math.max(0, Math.min(index ?? childCount, childCount))
      if (
        isTextRenderable(obj) &&
        obj.parent === this &&
        (this._pendingChildOrder?.indexOf(obj) ?? this._children.indexOf(obj)) !== -1 &&
        (this._pendingChildOrder !== null || this._children.every(isTextRenderable)) &&
        this.getDocumentOwner()
      ) {
        const currentIndex = this._pendingChildOrder?.indexOf(obj) ?? this._children.indexOf(obj)
        if (currentIndex < insertIndex) insertIndex -= 1
        if (currentIndex === insertIndex) return insertIndex
        const owner = this.getDocumentOwner()!
        const order = this._pendingChildOrder ?? new PendingChildOrder(this._children as TextRenderable[])
        if (!this._pendingChildOrder) this._structuralMoveMetrics.orderNodes += childCount
        const anchor = order.at(insertIndex)
        const move = owner.createPendingNativeMove(this, {
          source: obj,
          anchor,
          before: currentIndex > insertIndex,
        })
        const pendingLength = owner._pendingNativeMoves.length
        const pendingBefore = owner._textDocumentPending
        const dirtyBefore = this._dirty
        try {
          if (move) {
            owner._pendingNativeMoves.push(move)
            owner._textDocumentPending = true
          }
          this.requestRender()
        } catch (error) {
          owner._pendingNativeMoves.length = pendingLength
          owner._textDocumentPending = pendingBefore
          this._dirty = dirtyBefore
          throw error
        }
        order.move(obj, insertIndex)
        this._structuralMoveMetrics.orderMoves += 1
        if (!this._pendingChildOrder) {
          this._pendingChildOrder = order
          this._children = []
          this._leaves = []
        }
        this._manualStyledText = null
        return insertIndex
      }
      this.materializeChildOrder()
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
      const currentChildren = this.materializeChildOrder()
      const insertIndex = Math.max(0, Math.min(index ?? currentChildren.length, currentChildren.length))
      const firstIndex = insertIndex
      try {
        const nextChildren = [...currentChildren]
        nextChildren.splice(insertIndex, 0, ...children)
        this.children = nextChildren
        for (const child of children) this._ownedChildren.add(child)
      } catch (error) {
        const committed = children.every(
          (child, childIndex) => this.materializeChildOrder()[insertIndex + childIndex] === child,
        )
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

  public replace(obj: TextRenderable | StyledText | string, index: number): void {
    const styledChildren = isStyledText(obj) ? this.styledTextToChildren(obj) : []
    const replacements: (string | TextRenderable)[] = isStyledText(obj) ? styledChildren : [obj]
    const currentChildren = this.materializeChildOrder()
    const replacesExisting = currentChildren[index] !== undefined
    const nextChildren = [...currentChildren]
    let targetIndex = index
    if (isTextRenderable(obj) && obj.parent === this) {
      const currentIndex = nextChildren.indexOf(obj)
      if (currentIndex !== -1 && currentIndex !== targetIndex) {
        nextChildren.splice(currentIndex, 1)
        if (currentIndex < targetIndex) targetIndex -= 1
      }
    }
    if (replacesExisting) {
      nextChildren.splice(targetIndex, 1, ...replacements)
    } else {
      const insertIndex = Math.max(0, Math.min(targetIndex, nextChildren.length))
      nextChildren.splice(insertIndex, 0, ...replacements)
    }

    try {
      this.children = nextChildren
      for (const child of styledChildren) this._ownedChildren.add(child)
    } catch (error) {
      const committed =
        this._children.length === nextChildren.length &&
        this._children.every((child, childIndex) => child === nextChildren[childIndex])
      if (committed) {
        for (const child of styledChildren) this._ownedChildren.add(child)
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
  }

  public insertBefore(
    child: string | TextRenderable | StyledText,
    anchorNode: TextRenderable | string | unknown,
  ): number {
    if (!anchorNode || !isTextRenderable(anchorNode)) throw new Error("Anchor must be a TextNodeRenderable")

    const anchorIndex = this._pendingChildOrder?.indexOf(anchorNode) ?? this._children.indexOf(anchorNode)
    if (anchorIndex === -1) throw new Error("Anchor node not found in children")
    if (child === anchorNode) return anchorIndex
    return this.add(child, anchorIndex)
  }

  public remove(child: BaseRenderable): void {
    if (!isTextRenderable(child)) throw new Error("remove expects a TextNodeRenderable child object")

    const hasPendingOrder = this._pendingChildOrder !== null
    const owner = this.getDocumentOwner()
    this.materializeChildOrder()
    const childIndex = this._children.indexOf(child)
    if (childIndex === -1) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`TextRenderable with id ${child.id} is not a child of ${this.id}, skipping remove`)
      }
      return
    }

    if (!hasPendingOrder && (!owner || owner._pendingNativeMoves.length === 0)) {
      this._children.splice(childIndex, 1)
      this._leaves.splice(childIndex, 1)
      this.detachTextChild(child, this._ownedChildren.has(child))
      this._manualStyledText = null
      this.invalidateTextDocument()
      return
    }
    const nextChildren = [...this._children]
    nextChildren.splice(childIndex, 1)
    this.children = nextChildren
  }

  public clear(): void {
    const hasPendingOrder = this._pendingChildOrder !== null
    const owner = this.getDocumentOwner()
    this.materializeChildOrder()
    if (!hasPendingOrder && (!owner || owner._pendingNativeMoves.length === 0)) {
      const previousChildren = [...this._children]
      this._children.splice(0)
      this._leaves.splice(0)
      for (const child of previousChildren.reverse()) {
        if (isTextRenderable(child) && child.parent === this) {
          this.detachTextChild(child, this._ownedChildren.has(child))
        }
      }
      this._manualStyledText = null
      this.invalidateTextDocument()
      return
    }
    this.children = []
  }

  public mergeStyles(parentStyle: TextStyle): TextStyle {
    const parentRegistered =
      parentStyle.styleId === undefined ? undefined : parentStyle.styleSource?.getStyleById(parentStyle.styleId)
    if (parentStyle.styleId !== undefined && !parentRegistered) {
      throw new Error(`Unknown registered text style ID ${parentStyle.styleId}`)
    }
    const localRegistered =
      this._localStyleId === undefined ? undefined : this._localSyntaxStyle?.getStyleById(this._localStyleId)
    if (this._localStyleId !== undefined && !localRegistered) {
      throw new Error(`Unknown registered text style ID ${this._localStyleId}`)
    }
    const parentFg = parentStyle.fg ?? parentRegistered?.fg
    const parentBg = parentStyle.bg ?? parentRegistered?.bg
    const parentAttributes = parentStyle.attributes | (parentRegistered?.attributes ?? 0)
    const effective: TextStyle = {
      fg: this._localFg ?? localRegistered?.fg ?? parentFg,
      bg: this._localBg ?? localRegistered?.bg ?? parentBg,
      attributes: this._localAttributes | (localRegistered?.attributes ?? 0) | parentAttributes,
      link: this._link ?? parentStyle.link,
    }
    const registered = localRegistered ?? (this._localStyleId === undefined ? parentRegistered : undefined)
    const styleId = localRegistered
      ? this._localStyleId
      : this._localStyleId === undefined
        ? parentStyle.styleId
        : undefined
    const styleSource = localRegistered
      ? this._localSyntaxStyle
      : this._localStyleId === undefined
        ? parentStyle.styleSource
        : undefined
    if (
      registered &&
      styleId !== undefined &&
      styleSource &&
      effective.link === undefined &&
      effective.attributes === registered.attributes &&
      (effective.fg === registered.fg || effective.fg?.equals(registered.fg)) &&
      (effective.bg === registered.bg || effective.bg?.equals(registered.bg))
    ) {
      return { fg: undefined, bg: undefined, attributes: 0, styleId, styleSource }
    }
    return effective
  }

  public gatherWithInheritedStyle(
    parentStyle: TextStyle = { fg: undefined, bg: undefined, attributes: 0 },
  ): TextChunk[] {
    const currentStyle = this.mergeStyles(parentStyle)
    if (this._manualStyledText !== null) {
      return this._leaves.map((leaf) => ({
        __isChunk: true,
        text: leaf!.text,
        ...this.mergeStyledLeafStyle(leaf!.style!, currentStyle),
      }))
    }
    const chunks: TextChunk[] = []
    for (const child of this.materializeChildOrder()) {
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
    return this.materializeChildOrder().filter(isTextRenderable)
  }

  public getChildren(): TextRenderable[] {
    return this.getTextChildren()
  }

  public getChildrenCount(): number {
    return this._pendingChildOrder?.length ?? this._children.length
  }

  public getRenderable(id: string): TextRenderable | undefined {
    return this.getTextChildren().find((child) => child.id === id)
  }

  public getRenderableIndex(id: string): number {
    return this.materializeChildOrder().findIndex((child) => isTextRenderable(child) && child.id === id)
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
    if (this._pendingRegisteredStyle) {
      const pending = this._pendingRegisteredStyle
      this._pendingRegisteredStyle = undefined
      if (this.assignRegisteredStyle(pending.styleId, pending.styleSource)) this.invalidateTextStyles()
    }
    this.refreshFirstLineOffsetClaim()
    if (!isTextRenderable(this.parent) && this._textDocumentPending) this.flushTextDocument()
  }

  public render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!isTextRenderable(this.parent) && this._textDocumentPending) queueMicrotask(() => this._ctx.requestRender())
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
    this._leaves.splice(0)
    this._manualStyledText = null
    this._manualStyledSyntaxStyle = null
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
    node._leaves.push(null)
    node._textDocumentPending = true
    return node
  }

  public static getDebugMetrics(): TextRenderableDebugMetrics {
    return { ...textRenderableDebugMetrics }
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
      node._textDocumentPending = true
      return node
    } catch (error) {
      try {
        node.destroyRecursively()
      } catch {}
      throw error
    }
  }

  private replaceContent(content: StyledText | string, requestRender: boolean): void {
    if (typeof content !== "string") {
      this.replaceManualStyledText(content, requestRender)
      return
    }
    if (
      content !== "" &&
      this._manualStyledText === null &&
      this._pendingChildOrder === null &&
      this._children.length === 1 &&
      typeof this._children[0] === "string"
    ) {
      this._children[0] = content
      this._textDocumentPending = true
      if (requestRender) {
        this.invalidateTextDocument()
        if (this.hasTextDocumentState && this.lastLocalSelection) this.flushTextDocument()
      }
      return
    }
    const nextChildren: (string | TextRenderable)[] = content === "" ? [] : [content]
    try {
      this.children = nextChildren
    } catch (error) {
      const committed =
        this._children.length === nextChildren.length &&
        this._children.every((child, index) => child === nextChildren[index])
      if (!committed) this._manualStyledText = null
      throw error
    }

    this._manualStyledText = null
    this._leaves = nextChildren.map(() => null)
    this._manualStyledSyntaxStyle = null
    this._textDocumentPending = true
    if (requestRender) {
      this.invalidateTextDocument()
      if (this.hasTextDocumentState && this.lastLocalSelection) this.flushTextDocument()
    }
  }

  private replaceManualStyledText(content: StyledText, requestRender: boolean): void {
    const styles = new Map<string | number, TextStyle>()
    const previousLeaves = this._manualStyledText === null ? null : this._leaves
    const nextLeaves = new Array<TextLeaf>(content.chunks.length)
    let rangesUnchanged =
      previousLeaves !== null &&
      previousLeaves.length === content.chunks.length &&
      previousLeaves.every((leaf) => leaf?.rangeId !== null)
    let syntaxStyle: SyntaxStyle | null = null
    for (const chunk of content.chunks) {
      if ((chunk.styleId === undefined) !== (chunk.styleSource === undefined)) {
        throw new Error("Registered text styles require both styleId and styleSource")
      }
      if (chunk.styleSource) {
        if (syntaxStyle && syntaxStyle !== chunk.styleSource) {
          throw new Error("A text document cannot mix registered styles from different SyntaxStyle instances")
        }
        syntaxStyle = chunk.styleSource
      }
      if (
        chunk.styleId !== undefined &&
        (!Number.isInteger(chunk.styleId) || chunk.styleId <= 0 || !chunk.styleSource?.getStyleById(chunk.styleId))
      ) {
        throw new Error(`Unknown registered text style ID ${chunk.styleId}`)
      }
    }
    for (let index = 0; index < content.chunks.length; index++) {
      const chunk = content.chunks[index]!
      const style = this.internStyledLeafStyle(chunk, styles)
      const leaf = previousLeaves?.[index]
      if (leaf) {
        const sameTextExtent =
          leaf.text === chunk.text ||
          (leaf.text.length === chunk.text.length &&
            /^[\x20-\x7e]*$/.test(leaf.text) &&
            /^[\x20-\x7e]*$/.test(chunk.text))
        rangesUnchanged &&= sameTextExtent && leaf.style === style && !hasTextStyle(style)
        leaf.text = chunk.text
        leaf.style = style
        nextLeaves[index] = leaf
      } else {
        textRenderableDebugMetrics.styledLeafAllocations += 1
        nextLeaves[index] = { text: chunk.text, style, rangeId: null }
      }
    }
    if (previousLeaves) {
      const owner = this.getDocumentOwner()
      for (let index = nextLeaves.length; index < previousLeaves.length; index++) {
        const id = previousLeaves[index]!.rangeId
        if (owner && id !== null) owner._pendingRemovedRangeIds.add(id)
      }
    }

    const hadPublicContent = this._children.length > 0 || this._pendingChildOrder !== null
    if (hadPublicContent) textDocumentMutationDepth += 1
    try {
      if (hadPublicContent) this.children = []
      this._leaves = nextLeaves
      this._manualStyledText = content
      this._manualRangesUnchanged = rangesUnchanged
      this._manualStyledSyntaxStyle = syntaxStyle
      this._textDocumentPending = true
      if (requestRender) {
        this.invalidateTextDocument()
        if (this.hasTextDocumentState && this.lastLocalSelection) this.flushTextDocument()
      }
    } finally {
      if (hadPublicContent) {
        textDocumentMutationDepth -= 1
        if (textDocumentMutationDepth === 0) {
          const owners = [...deferredDocumentOwners]
          deferredDocumentOwners.clear()
          for (const owner of owners) owner.flushTextDocument()
        }
      }
    }
  }

  private internStyledLeafStyle(chunk: TextChunk, styles: Map<string | number, TextStyle>): TextStyle {
    const attributes = chunk.attributes ?? 0
    const simple =
      chunk.fg === undefined && chunk.bg === undefined && chunk.link === undefined && chunk.styleId === undefined
    if (simple) {
      const existing = simpleStyledLeafStyles.get(attributes)
      if (existing) return existing
      const style: TextStyle = { attributes }
      simpleStyledLeafStyles.set(attributes, style)
      return style
    }
    const fg = chunk.fg ? parseColor(chunk.fg) : undefined
    const bg = chunk.bg ? parseColor(chunk.bg) : undefined
    let sourceId = 0
    if (chunk.styleSource) {
      sourceId = styledLeafStyleSources.get(chunk.styleSource) ?? nextStyledLeafStyleSource++
      styledLeafStyleSources.set(chunk.styleSource, sourceId)
    }
    const colorKey = (color: RGBA | undefined) => (color ? Array.from(color.buffer).join(",") : "")
    const key = `${colorKey(fg)}|${colorKey(bg)}|${attributes}|${chunk.link?.url ?? ""}|${chunk.styleId ?? 0}|${sourceId}`
    const existing = styles.get(key)
    if (existing) return existing
    const style: TextStyle = {
      fg,
      bg,
      attributes,
      link: chunk.link,
      styleId: chunk.styleId,
      styleSource: chunk.styleSource,
    }
    styles.set(key, style)
    return style
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
            styleId: chunk.styleId,
            styleSource: chunk.styleSource,
          },
          false,
        )
        child._children.push(chunk.text)
        child._leaves.push(null)
        children.push(child)
      }
      return children
    } catch (error) {
      for (const child of children.reverse()) child.destroyRecursively()
      throw error
    }
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
      child.resetNativeRanges()
      child.flushTextDocument()
    }
  }

  private adoptTextContext(ctx: RenderContext): void {
    if (this._ctx !== ctx) {
      const hadDocumentState = this.hasTextDocumentState
      this.adoptTextDocumentContext(ctx)
      if (hadDocumentState && this.hasTextDocumentState) {
        this.resetNativeRanges()
        this.flushTextDocument()
      }
    }
    for (const child of this.getTextChildren()) child.adoptTextContext(ctx)
  }

  private invalidateTextDocument(): void {
    const owner = this.getDocumentOwner()
    if (owner) {
      owner._textDocumentPending = true
      owner._pendingDocumentRoots.add(this)
      if (!owner.parent) {
        if (textDocumentMutationDepth === 0) owner.flushTextDocument()
        else deferredDocumentOwners.add(owner)
      }
    }
    this.requestRender()
  }

  private flushTextDocument(): void {
    if (!this.hasTextDocumentState || isTextRenderable(this.parent)) return
    const prepared = this.prepareTextDocumentFlush()
    const previousLineWidths = prepared.contentChanged ? this.captureTextLineWidths() : null
    const ids = this.textBuffer.applyDocumentOperations(prepared.operations)
    this.commitPreparedTextDocumentFlush(prepared, ids, this.textLayoutChanged(previousLineWidths))
  }

  private prepareTextDocumentFlush(): PreparedTextDocumentFlush {
    this.materializePendingChildOrders()
    this.commitPendingRegisteredStyles()
    if (this._textDocumentOwner === 0) this._textDocumentOwner = nextTextDocumentOwner++
    if (nextTextDocumentOwner === 0xffffffff) nextTextDocumentOwner = 1

    const pending = [
      ...new Set(
        (this._nativeRangeId === null ? [this] : [...this._pendingDocumentRoots]).map((candidate) => {
          let root = candidate
          while (root._nativeRangeId !== null) {
            const range = this.textBuffer.getDocumentRange(root._nativeRangeId)
            if (!range || range.startByte !== range.endByte || !isTextRenderable(root.parent)) break
            root = root.parent
          }
          return root
        }),
      ),
    ]
    const roots = pending.filter(
      (candidate) => !pending.some((other) => other !== candidate && candidate.isTextDescendantOf(other)),
    )
    const replacementPlans: NativeReplacementPlan[] = []
    const plannedRoots = new Set<TextRenderable>()
    const addReplacementPlan = (run: TextRenderable[]): void => {
      const rangeIds = new Set<bigint>()
      for (const root of run) {
        plannedRoots.add(root)
        if (this._pendingNativeMoves.length > 0) this.collectNativeRangeIds(root, rangeIds)
      }
      replacementPlans.push({ roots: run, rangeIds })
    }
    for (let index = 0; index < roots.length; ) {
      const run = [roots[index]!]
      const parent = roots[index]!.parent
      let previousIndex = isTextRenderable(parent) ? parent._children.indexOf(roots[index]!) : -1
      while (isTextRenderable(parent) && index + run.length < roots.length) {
        const candidate = roots[index + run.length]!
        const candidateIndex = parent._children.indexOf(candidate)
        if (candidate.parent !== parent || candidateIndex !== previousIndex + 1) break
        run.push(candidate)
        previousIndex = candidateIndex
      }
      addReplacementPlan(run)
      index += run.length
    }
    for (const move of this._pendingNativeMoves) {
      if (move.source._nativeRangeId !== null && move.anchor._nativeRangeId !== null) continue
      const parentId = move.parentId
      if (
        (parentId !== null && this._pendingRemovedRangeIds.has(parentId)) ||
        plannedRoots.has(move.parent) ||
        (parentId !== null && replacementPlans.some((plan) => plan.rangeIds.has(parentId)))
      ) {
        continue
      }
      addReplacementPlan([move.parent])
    }

    const operations: DocumentOperation[] = []
    const assignments: Array<(id: bigint) => void> = []
    for (const plan of replacementPlans) this.collectNativeSubtreeOperation(plan.roots, operations, assignments)
    for (const move of this._pendingNativeMoves) {
      // Queued node ancestry may have changed; stable native IDs describe whether this replacement publishes the move.
      const ownedByReplacement = move.owner === this._textDocumentOwner
      const parentId = move.parentId
      const subsumed =
        ownedByReplacement &&
        replacementPlans.some(
          (plan) =>
            (parentId !== null && plan.rangeIds.has(parentId)) ||
            (plan.rangeIds.has(move.sourceId) && plan.rangeIds.has(move.anchorId)),
        )
      const removedWithParent = ownedByReplacement && parentId !== null && this._pendingRemovedRangeIds.has(parentId)
      if (subsumed || removedWithParent || move.source._nativeRangeId === null || move.anchor._nativeRangeId === null)
        continue
      operations.push({
        kind: "move",
        targetId: move.sourceId,
        anchorId: move.anchorId,
        owner: move.owner,
        before: move.before,
      })
    }
    for (const id of this._pendingRemovedRangeIds) {
      operations.push({ kind: "remove", targetId: id, owner: this._textDocumentOwner })
    }
    if (this._pendingStyleRoots.size > 0) {
      for (const root of this._pendingStyleRoots)
        root.collectNativeStyleOperations(this, root.resolvedParentStyle(), operations)
    }
    const syntaxStyles = new Set<SyntaxStyle>()
    this.collectRegisteredSyntaxStyles(syntaxStyles)
    if (syntaxStyles.size > 1)
      throw new Error("A text document cannot mix registered styles from different SyntaxStyle instances")
    textRenderableDebugMetrics.documentOperations += operations.length
    for (const operation of operations) {
      textRenderableDebugMetrics.documentChunks += operation.chunks?.length ?? 0
      textRenderableDebugMetrics.documentRanges += operation.ranges?.length ?? 0
    }
    return {
      operations,
      assignments,
      contentChanged: replacementPlans.length > 0 || this._pendingNativeMoves.length > 0,
    }
  }

  private textLayoutChanged(previousLineWidths: number[] | null): boolean {
    if (previousLineWidths === null) return false
    const nextLineWidths = super.lineInfo.lineWidthCols
    return (
      previousLineWidths.length !== nextLineWidths.length ||
      previousLineWidths.some((width, index) => width !== nextLineWidths[index])
    )
  }

  private captureTextLineWidths(): number[] {
    return [...super.lineInfo.lineWidthCols]
  }

  private commitPreparedTextDocumentFlush(
    prepared: PreparedTextDocumentFlush,
    ids: bigint[],
    layoutChanged: boolean,
  ): void {
    const { assignments, contentChanged } = prepared
    ids.forEach((id, index) => assignments[index]!(id))
    this._pendingDocumentRoots.clear()
    this._pendingStyleRoots.clear()
    this._pendingNativeMoves.splice(0)
    this._pendingRemovedRangeIds.clear()
    this.textBuffer.setDefaultFg(this._defaultFg)
    this.textBuffer.setDefaultBg(this._defaultBg)
    this.textBuffer.setDefaultAttributes(this._defaultAttributes)
    this._textDocumentPending = false
    if (contentChanged) {
      this.refreshLocalSelection()
      if (layoutChanged) {
        this.yogaNode.markDirty()
        textRenderableDebugMetrics.yogaDirties += 1
      }
      this._lastCommittedLineInfoFrame = this._ctx.frameId ?? -1
      this.emit("line-info-change")
    }
  }

  private static flushTwoTextDocuments(first: TextRenderable, second: TextRenderable): void {
    if (first === second) {
      first.flushTextDocument()
      return
    }
    const firstPrepared = first.prepareTextDocumentFlush()
    const secondPrepared = second.prepareTextDocumentFlush()
    const firstLineWidths = firstPrepared.contentChanged ? first.captureTextLineWidths() : null
    const secondLineWidths = secondPrepared.contentChanged ? second.captureTextLineWidths() : null
    const result = first.textBuffer.applyTwoDocumentOperations(
      second.textBuffer,
      firstPrepared.operations,
      secondPrepared.operations,
    )
    first.commitPreparedTextDocumentFlush(firstPrepared, result.ids, first.textLayoutChanged(firstLineWidths))
    second.commitPreparedTextDocumentFlush(secondPrepared, result.otherIds, second.textLayoutChanged(secondLineWidths))
    deferredDocumentOwners.delete(first)
    deferredDocumentOwners.delete(second)
  }

  private collectNativeSubtreeOperation(
    roots: TextRenderable[],
    operations: DocumentOperation[],
    batchAssignments: Array<(id: bigint) => void>,
  ): void {
    const stablePlainLeaves =
      this._pendingNativeMoves.length === 0 &&
      roots.every((root) => {
        if (
          root._nativeRangeId === null ||
          root._manualStyledText !== null ||
          this._pendingStyleRoots.has(root) ||
          root._pendingChildOrder !== null ||
          root._children.length !== 1 ||
          typeof root._children[0] !== "string" ||
          !root.ancestorsVisible() ||
          !/^[\x20-\x7e]+$/.test(root._children[0])
        ) {
          return false
        }
        const range = this.textBuffer.getDocumentRange(root._nativeRangeId)
        return range !== null && range.endByte - range.startByte === root._children[0].length
      })
    if (stablePlainLeaves) {
      operations.push({
        kind: "replace",
        targetId: roots[0]!._nativeRangeId!,
        anchorId: roots.length > 1 ? roots.at(-1)!._nativeRangeId! : undefined,
        targetMode: "replace",
        startByte: 0,
        endByte: 0,
        owner: this._textDocumentOwner,
        // The equal-extent proof above lets native retain every existing range.
        before: true,
        chunks: roots.map((root) => ({ text: root._children[0] as string })),
        ranges: [],
      })
      return
    }
    if (
      roots.length === 1 &&
      roots[0]!._manualStyledText !== null &&
      roots[0]!._manualRangesUnchanged &&
      roots[0]!._nativeRangeId !== null
    ) {
      operations.push({
        kind: "replace",
        targetId: roots[0]!._nativeRangeId!,
        targetMode: "replace",
        startByte: 0,
        endByte: 0,
        owner: this._textDocumentOwner,
        // Private leaf IDs and payloads are already canonical and unchanged.
        before: true,
        chunks: roots[0]!._leaves.map((leaf) => ({ text: leaf!.text })),
        ranges: [],
      })
      return
    }
    const chunks: Array<{ text: string }> = []
    const ranges: DocumentRangeInput[] = []
    const assignments: Array<(id: bigint) => void> = []
    for (const root of roots) {
      const inherited = root.resolvedParentStyle()
      const visible = root === this ? true : root.ancestorsVisible()
      this.collectNativeDocument(root, inherited, this.textDepth(root), visible, chunks, ranges, assignments)
    }
    const first = roots[0]!
    const last = roots.at(-1)!
    const targetId = first._nativeRangeId
    operations.push({
      kind: "replace",
      targetId: targetId ?? undefined,
      anchorId: roots.length > 1 ? (last._nativeRangeId ?? undefined) : undefined,
      targetMode: "replace",
      startByte: 0,
      endByte: targetId === null ? this.textBuffer.byteSize : 0,
      owner: this._textDocumentOwner,
      chunks,
      ranges,
    })
    batchAssignments.push(...assignments)
  }

  private collectNativeRangeIds(node: TextRenderable, rangeIds: Set<bigint>): void {
    if (node._nativeRangeId !== null) rangeIds.add(node._nativeRangeId)
    for (const leaf of node._leaves)
      if (leaf?.rangeId !== null && leaf?.rangeId !== undefined) rangeIds.add(leaf.rangeId)
    for (const child of node.getTextChildren()) this.collectNativeRangeIds(child, rangeIds)
  }

  private collectNativeDocument(
    node: TextRenderable,
    parentStyle: TextStyle,
    depth: number,
    visible: boolean,
    chunks: Array<{ text: string }>,
    ranges: DocumentRangeInput[],
    assignments: Array<(id: bigint) => void>,
  ): void {
    textRenderableDebugMetrics.documentTreeWalks += 1
    const style = node.mergeStyles(parentStyle)
    const start = chunks.length
    const nodeRangeIndex = ranges.length
    const manual = node._manualStyledText !== null
    const children = manual ? null : node.materializeChildOrder()
    const publicLeaf = children?.length === 1 && typeof children[0] === "string"
    const nodeStyled = publicLeaf && hasTextStyle(style)
    ranges.push({
      id: node._nativeRangeId ?? undefined,
      startChunk: start,
      endChunk: start,
      ...(nodeStyled ? style : {}),
      styled: nodeStyled,
      priority: Math.min(255, depth + 1),
    })
    assignments.push((id) => (node._nativeRangeId = id))

    if (manual) {
      for (const leaf of node._leaves) {
        const effective = this.mergeStyledLeafStyle(leaf!.style!, style)
        const leafStart = chunks.length
        if (visible) chunks.push({ text: leaf!.text })
        ranges.push({
          id: leaf!.rangeId ?? undefined,
          startChunk: leafStart,
          endChunk: chunks.length,
          ...(hasTextStyle(effective) ? effective : {}),
          styled: hasTextStyle(effective),
          priority: Math.min(255, depth + 1),
        })
        assignments.push((id) => (leaf!.rangeId = id))
      }
      ranges[nodeRangeIndex]!.endChunk = chunks.length
      return
    }

    if (publicLeaf) {
      if (visible) chunks.push({ text: children[0] as string })
      ranges[nodeRangeIndex]!.endChunk = chunks.length
      return
    }

    const publicChildren = children!
    for (let index = 0; index < publicChildren.length; index++) {
      const child = publicChildren[index]!
      if (typeof child === "string") {
        let leaf = node._leaves[index]
        if (!leaf) {
          leaf = { text: child, style: null, rangeId: null }
          node._leaves[index] = leaf
        }
        const leafStart = chunks.length
        if (visible) chunks.push({ text: child })
        ranges.push({
          id: leaf.rangeId ?? undefined,
          startChunk: leafStart,
          endChunk: chunks.length,
          ...(hasTextStyle(style) ? style : {}),
          styled: hasTextStyle(style),
          priority: Math.min(255, depth + 1),
        })
        assignments.push((id) => (leaf!.rangeId = id))
      } else {
        this.collectNativeDocument(child, style, depth + 1, visible && child.visible, chunks, ranges, assignments)
      }
    }
    ranges[nodeRangeIndex]!.endChunk = chunks.length
  }

  private invalidateTextStyles(): void {
    const owner = this.getDocumentOwner()
    if (!owner) {
      this.requestRender()
      return
    }
    owner._pendingStyleRoots.add(this)
    owner._textDocumentPending = true
    if (!owner.parent) owner.flushTextDocument()
    this.requestRender()
  }

  private collectNativeStyleOperations(
    owner: TextRenderable,
    parentStyle: TextStyle,
    operations: DocumentOperation[],
  ): void {
    const style = this.mergeStyles(parentStyle)
    if (this._manualStyledText !== null) {
      for (const leaf of this._leaves) {
        if (leaf!.rangeId === null) continue
        operations.push({
          kind: "updateStyle",
          targetId: leaf!.rangeId,
          owner: owner._textDocumentOwner,
          ...this.mergeStyledLeafStyle(leaf!.style!, style),
        })
      }
    } else {
      const children = this.materializeChildOrder()
      if (children.length === 1 && typeof children[0] === "string") {
        if (this._nativeRangeId !== null)
          operations.push({
            kind: "updateStyle",
            targetId: this._nativeRangeId,
            owner: owner._textDocumentOwner,
            ...style,
          })
      } else {
        for (let index = 0; index < children.length; index++) {
          if (typeof children[index] !== "string") continue
          const leaf = this._leaves[index]
          if (!leaf?.rangeId) continue
          operations.push({
            kind: "updateStyle",
            targetId: leaf.rangeId,
            owner: owner._textDocumentOwner,
            ...style,
          })
        }
      }
    }
    for (const child of this.getTextChildren()) child.collectNativeStyleOperations(owner, style, operations)
  }

  private collectRegisteredSyntaxStyles(styles: Set<SyntaxStyle>): void {
    if (this._localStyleId !== undefined && this._localSyntaxStyle && this.ancestorsVisible()) {
      styles.add(this._localSyntaxStyle)
    }
    if (this._manualStyledSyntaxStyle && this.ancestorsVisible()) styles.add(this._manualStyledSyntaxStyle)
    for (const child of this.getTextChildren()) child.collectRegisteredSyntaxStyles(styles)
  }

  private resolvedParentStyle(): TextStyle {
    const ancestors: TextRenderable[] = []
    let parent = this.parent
    while (isTextRenderable(parent)) {
      ancestors.push(parent)
      parent = parent.parent
    }
    let style: TextStyle = { fg: undefined, bg: undefined, attributes: 0 }
    for (let index = ancestors.length - 1; index >= 0; index--) style = ancestors[index]!.mergeStyles(style)
    return style
  }

  private ancestorsVisible(): boolean {
    let current: TextRenderable | null = this
    while (current) {
      if (!current.visible) return false
      current = isTextRenderable(current.parent) ? current.parent : null
    }
    return true
  }

  private textDepth(node: TextRenderable): number {
    let depth = 0
    let current = node.parent
    while (isTextRenderable(current)) {
      depth++
      current = current.parent
    }
    return depth
  }

  private isTextDescendantOf(ancestor: TextRenderable): boolean {
    let current = this.parent
    while (isTextRenderable(current)) {
      if (current === ancestor) return true
      current = current.parent
    }
    return false
  }

  private resetNativeRanges(): void {
    this._nativeRangeId = null
    for (const leaf of this._leaves) if (leaf) leaf.rangeId = null
    for (const child of this.getTextChildren()) child.resetNativeRanges()
    this._textDocumentOwner = 0
    this._pendingDocumentRoots.clear()
    this._pendingStyleRoots.clear()
    this._pendingNativeMoves.splice(0)
    this._pendingDocumentRoots.add(this)
    this._textDocumentPending = true
  }

  private captureNativeRanges(): NativeRangeSnapshot[] {
    const result: NativeRangeSnapshot[] = [
      {
        node: this,
        id: this._nativeRangeId,
        leafIds: this._leaves.map((leaf) => leaf?.rangeId ?? null),
      },
    ]
    for (const child of this.getTextChildren()) result.push(...child.captureNativeRanges())
    return result
  }

  private restoreNativeRanges(snapshot: NativeRangeSnapshot[]): void {
    for (const entry of snapshot) {
      entry.node._nativeRangeId = entry.id
      for (let index = 0; index < entry.leafIds.length; index++) {
        const leaf = entry.node._leaves[index]
        if (leaf) leaf.rangeId = entry.leafIds[index] ?? null
      }
    }
  }

  private queueNativeRangeRemoval(root: TextRenderable): void {
    if (root._nativeRangeId !== null) this._pendingRemovedRangeIds.add(root._nativeRangeId)
    for (const leaf of root._leaves) {
      if (leaf?.rangeId !== null && leaf?.rangeId !== undefined) this._pendingRemovedRangeIds.add(leaf.rangeId)
    }
    for (const child of root.getTextChildren()) this.queueNativeRangeRemoval(child)
  }

  private planNativeChildMoves(previous: TextRenderable[], next: TextRenderable[]): PlannedNativeMove[] {
    const forward: PlannedNativeMove[] = []
    const forwardOrder = new PendingChildOrder(previous)
    for (let index = 0; index < next.length; index++) {
      const desired = next[index]!
      const currentIndex = forwardOrder.indexOf(desired)
      if (currentIndex === index) continue
      const anchor = forwardOrder.at(index)
      forward.push({ source: desired, anchor, before: true })
      forwardOrder.move(desired, index)
    }

    const reverse: PlannedNativeMove[] = []
    const reverseOrder = new PendingChildOrder(previous)
    for (let index = next.length - 1; index >= 0; index--) {
      const desired = next[index]!
      const currentIndex = reverseOrder.indexOf(desired)
      if (currentIndex === index) continue
      const anchor = reverseOrder.at(index)
      reverse.push({ source: desired, anchor, before: false })
      reverseOrder.move(desired, index)
    }
    return forward.length <= reverse.length ? forward : reverse
  }

  private createPendingNativeMove(parent: TextRenderable, move: PlannedNativeMove): PendingNativeMove | null {
    const { source, anchor, before } = move
    if (source._nativeRangeId === null || anchor._nativeRangeId === null) return null
    const sourceRange = this.textBuffer.getDocumentRange(source._nativeRangeId)
    const anchorRange = this.textBuffer.getDocumentRange(anchor._nativeRangeId)
    if (
      !sourceRange ||
      sourceRange.startByte === sourceRange.endByte ||
      !anchorRange ||
      sourceRange.owner !== anchorRange.owner
    ) {
      return null
    }
    return {
      source,
      anchor,
      before,
      parent,
      sourceId: source._nativeRangeId,
      anchorId: anchor._nativeRangeId,
      parentId: parent._nativeRangeId,
      owner: sourceRange.owner,
    }
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
      if (this._textDocumentPending) this.flushTextDocument()
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

  private queuePrivateLeafRemovals(node: TextRenderable): void {
    for (const leaf of node._leaves) {
      if (leaf?.rangeId !== null && leaf?.rangeId !== undefined) this._pendingRemovedRangeIds.add(leaf.rangeId)
    }
  }

  private mergeStyledLeafStyle(local: TextStyle, parent: TextStyle): TextStyle {
    const parentRegistered = parent.styleId === undefined ? undefined : parent.styleSource?.getStyleById(parent.styleId)
    const localRegistered = local.styleId === undefined ? undefined : local.styleSource?.getStyleById(local.styleId)
    const parentFg = parent.fg ?? parentRegistered?.fg
    const parentBg = parent.bg ?? parentRegistered?.bg
    const parentAttributes = parent.attributes | (parentRegistered?.attributes ?? 0)
    const effective: TextStyle = {
      fg: local.fg ?? localRegistered?.fg ?? parentFg,
      bg: local.bg ?? localRegistered?.bg ?? parentBg,
      attributes: local.attributes | (localRegistered?.attributes ?? 0) | parentAttributes,
      link: local.link ?? parent.link,
    }
    if (
      localRegistered &&
      local.styleId !== undefined &&
      local.styleSource &&
      effective.link === undefined &&
      effective.attributes === localRegistered.attributes &&
      (effective.fg === localRegistered.fg || effective.fg?.equals(localRegistered.fg)) &&
      (effective.bg === localRegistered.bg || effective.bg?.equals(localRegistered.bg))
    ) {
      return { fg: undefined, bg: undefined, attributes: 0, styleId: local.styleId, styleSource: local.styleSource }
    }
    return effective
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
    if (this._textDocumentPending) this.flushTextDocument()
  }

  private detachedPlainText(): string {
    return this.gatherOwnContent()
      .map((chunk) => chunk.text.replace(/\r\n?/g, "\n"))
      .join("")
  }
}
