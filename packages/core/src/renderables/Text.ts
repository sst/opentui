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

type TextRun = {
  text: string
  style: TextStyle | null
  rangeId: bigint | null
  styleDirty?: boolean
}

type TextEntry = TextRenderable | TextRun
const childOnlyEntries = new WeakSet<TextEntry[]>()

type NativeRangeSnapshot = {
  node: TextRenderable
  id: bigint | null
  runIds: Array<bigint | null>
}

function isTextRun(entry: TextEntry): entry is TextRun {
  return !isTextRenderable(entry)
}

function textRun(text: string, style: TextStyle | null = null): TextRun {
  return { text, style, rangeId: null }
}

function hasOnlyTextChildren(entries: TextEntry[]): entries is TextRenderable[] {
  if (childOnlyEntries.has(entries)) return true
  if (!entries.every(isTextRenderable)) return false
  childOnlyEntries.add(entries)
  return true
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

function textStylesEqual(left: TextStyle, right: TextStyle): boolean {
  return Boolean(
    left.attributes === right.attributes &&
    left.styleId === right.styleId &&
    left.styleSource === right.styleSource &&
    left.link?.url === right.link?.url &&
    (left.fg === right.fg || left.fg?.equals(right.fg)) &&
    (left.bg === right.bg || left.bg?.equals(right.bg)),
  )
}

function mergeTextStyles(local: TextStyle, parent: TextStyle, inheritParentStyle: boolean): TextStyle {
  const parentRegistered = parent.styleId === undefined ? undefined : parent.styleSource?.getStyleById(parent.styleId)
  const localRegistered = local.styleId === undefined ? undefined : local.styleSource?.getStyleById(local.styleId)
  if (parent.styleId !== undefined && !parentRegistered)
    throw new Error(`Unknown registered text style ID ${parent.styleId}`)
  if (local.styleId !== undefined && !localRegistered)
    throw new Error(`Unknown registered text style ID ${local.styleId}`)
  const registered =
    localRegistered ?? (inheritParentStyle && local.styleId === undefined ? parentRegistered : undefined)
  const styleId = localRegistered
    ? local.styleId
    : inheritParentStyle && local.styleId === undefined
      ? parent.styleId
      : undefined
  const styleSource = localRegistered
    ? local.styleSource
    : inheritParentStyle && local.styleId === undefined
      ? parent.styleSource
      : undefined
  const effective: TextStyle = {
    fg: local.fg ?? localRegistered?.fg ?? parent.fg ?? parentRegistered?.fg,
    bg: local.bg ?? localRegistered?.bg ?? parent.bg ?? parentRegistered?.bg,
    attributes:
      local.attributes | (localRegistered?.attributes ?? 0) | parent.attributes | (parentRegistered?.attributes ?? 0),
    link: local.link ?? parent.link,
  }
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

function mergeRunStyle(local: TextStyle, parent: TextStyle): TextStyle {
  if (local.styleId !== undefined || parent.styleId !== undefined) return mergeTextStyles(local, parent, false)
  return {
    fg: local.fg ?? parent.fg,
    bg: local.bg ?? parent.bg,
    attributes: local.attributes | parent.attributes,
    link: local.link ?? parent.link,
  }
}

type PreparedTextDocumentFlush = {
  operations: DocumentOperation[]
  assignments: Array<(id: bigint) => void>
  contentChanged: boolean
  layoutChanged: boolean
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

export class TextRenderable extends TextBufferRenderable {
  get [BrandedTextRenderable](): true {
    return true
  }

  private _entries: TextEntry[] = []
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
  private _pendingDocumentRoots = new Set<TextRenderable>()
  private _pendingStyleRoots = new Set<TextRenderable>()
  private _pendingRemovedRangeIds = new Set<bigint>()
  private _pendingNativeMoves: PendingNativeMove[] = []
  private _textDocumentRole: "owner" | "promotable" | "inline" = "inline"
  private _compatibilityOwner: TextRenderable | null = null
  private _styledText: StyledText | null = null
  private _manualTextOnly = false
  private _manualStyleDiffOnly = false
  private _publicTextOnly = false
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

  public get children(): readonly (string | TextRenderable)[] {
    if (this._styledText !== null) return []
    return this._entries.map((entry) => (isTextRenderable(entry) ? entry : entry.text))
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

    const previousEntries = this._entries
    const previousChildren = this.children
    const documentOwnerBefore = this.getDocumentOwner()
    const isPureNativeReorder =
      previousChildren.length === nextChildren.length &&
      previousChildren.every(isTextRenderable) &&
      nextChildren.every(isTextRenderable) &&
      previousChildren.every((child) => seenChildren.has(child)) &&
      this._styledText === null &&
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
      this._entries = nextChildren
      this._styledText = null
      return
    }
    const nextEntries: TextEntry[] = nextChildren.map((child, index) => {
      if (isTextRenderable(child)) return child
      const previous = previousEntries[index]
      return previous && isTextRun(previous) && previous.style === null ? { ...previous, text: child } : textRun(child)
    })
    const previousOwnedChildren = new Set(
      previousEntries.filter(isTextRenderable).filter((child) => child._compatibilityOwner === this),
    )
    const parentSnapshots = new Map<TextRenderable, () => void>()
    const snapshotParent = (parent: TextRenderable): void => {
      if (parentSnapshots.has(parent)) return
      const state = {
        entries: [...parent._entries],
        styledText: parent._styledText,
        documentPending: parent._textDocumentPending,
        dirty: parent._dirty,
        removed: new Set(parent._pendingRemovedRangeIds),
        documentRoots: new Set(parent._pendingDocumentRoots),
        styleRoots: new Set(parent._pendingStyleRoots),
        moves: [...parent._pendingNativeMoves],
      }
      parentSnapshots.set(parent, () => {
        parent._entries = state.entries
        parent._styledText = state.styledText
        parent._textDocumentPending = state.documentPending
        parent._dirty = state.dirty
        parent._pendingRemovedRangeIds = state.removed
        parent._pendingDocumentRoots = state.documentRoots
        parent._pendingStyleRoots = state.styleRoots
        parent._pendingNativeMoves = state.moves
        for (const child of parent.getTextChildren()) child.parent = parent
      })
    }
    snapshotParent(this)
    if (documentOwnerBefore && documentOwnerBefore !== this) snapshotParent(documentOwnerBefore)

    const childSnapshots = new Map<TextRenderable, () => void>()
    const snapshotChild = (child: TextRenderable): void => {
      if (childSnapshots.has(child)) return
      const parent = child.parent
      if (isTextRenderable(parent)) {
        snapshotParent(parent)
        const owner = parent.getDocumentOwner()
        if (owner) snapshotParent(owner)
      }
      const context = child.ctx
      const hadDocumentState = child.hasTextDocumentState
      const layoutIndex = parent && !isTextRenderable(parent) ? parent.getChildren().indexOf(child) : -1
      const compatibilityOwner = child._compatibilityOwner
      const nativeRanges = child.captureNativeRanges()
      childSnapshots.set(child, () => {
        child._compatibilityOwner = compatibilityOwner
        if (parent && !isTextRenderable(parent) && child.parent !== parent) {
          try {
            parent.add(child, layoutIndex < 0 ? undefined : layoutIndex)
          } catch {}
        } else {
          child.parent = parent
        }
        try {
          child.adoptTextContext(context)
          if (hadDocumentState && !child.hasTextDocumentState) {
            child.attachTextDocumentState()
            child.resetNativeRanges()
            child.flushTextDocument()
          } else if (!hadDocumentState && child.hasTextDocumentState) {
            child.detachTextDocumentState()
          }
          child.restoreNativeRanges(nativeRanges)
        } catch {}
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
      for (const restore of parentSnapshots.values()) restore()
      for (const restore of childSnapshots.values()) restore()
    }

    textDocumentMutationDepth += 1
    try {
      for (const child of seenChildren) {
        const parent = child.parent
        const sourceOwner = child.getDocumentOwner()
        if (isTextRenderable(parent) && parent !== this) {
          const index = parent._entries.indexOf(child)
          if (index !== -1) parent._entries.splice(index, 1)
          child._compatibilityOwner = null
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

      if (this._styledText !== null && documentOwnerBefore) {
        for (const entry of this._entries)
          if (isTextRun(entry) && entry.rangeId !== null) documentOwnerBefore._pendingRemovedRangeIds.add(entry.rangeId)
      }
      this._entries = nextEntries

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

      this._styledText = null
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
    return this._styledText ?? new StyledText(this.gatherWithInheritedStyle())
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
      if (owner._textDocumentPending) owner.flushTextDocument()
      return owner === this ? super.lineInfo : owner.lineInfo
    }
    return localLineInfo(this.detachedPlainText())
  }

  public override get lineCount(): number {
    const owner = this.getDocumentOwner()
    if (owner) {
      if (owner._textDocumentPending) owner.flushTextDocument()
      return owner === this ? super.lineCount : owner.lineCount
    }
    return this.detachedPlainText().split("\n").length
  }

  public override get virtualLineCount(): number {
    const owner = this.getDocumentOwner()
    if (owner) {
      if (owner._textDocumentPending) owner.flushTextDocument()
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
    this.markDirty()
    this._ctx.requestRender()
  }

  public add(obj: TextRenderable | StyledText | string, index?: number): number {
    if (typeof obj === "string" || isTextRenderable(obj)) {
      const childCount = this._entries.length
      let insertIndex = Math.max(0, Math.min(index ?? childCount, childCount))
      if (
        isTextRenderable(obj) &&
        obj.parent === this &&
        this._entries.indexOf(obj) !== -1 &&
        hasOnlyTextChildren(this._entries) &&
        this.getDocumentOwner()
      ) {
        const currentIndex = this._entries.indexOf(obj)
        if (currentIndex < insertIndex) insertIndex -= 1
        if (currentIndex === insertIndex) return insertIndex
        const owner = this.getDocumentOwner()!
        const order = this._entries
        const anchor = order[insertIndex]!
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
        order.splice(currentIndex, 1)
        order.splice(insertIndex, 0, obj)
        this._styledText = null
        return insertIndex
      }
      const nextChildren = [...this.children]
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
      const currentChildren = this.children
      const insertIndex = Math.max(0, Math.min(index ?? currentChildren.length, currentChildren.length))
      try {
        const nextChildren = [...currentChildren]
        nextChildren.splice(insertIndex, 0, ...children)
        this.children = nextChildren
        for (const child of children) child._compatibilityOwner = this
      } catch (error) {
        const committed = children.every((child, childIndex) => this.children[insertIndex + childIndex] === child)
        if (committed) {
          for (const child of children) child._compatibilityOwner = this
        } else {
          this.destroyDetachedCompatibilityChildren(children)
        }
        throw error
      }
      return insertIndex
    }

    throw new Error("TextNodeRenderable only accepts strings, TextNodeRenderable instances, or StyledText instances")
  }

  public replace(obj: TextRenderable | StyledText | string, index: number): void {
    const styledChildren = isStyledText(obj) ? this.styledTextToChildren(obj) : []
    const replacements: (string | TextRenderable)[] = isStyledText(obj) ? styledChildren : [obj]
    const currentChildren = this.children
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
      for (const child of styledChildren) child._compatibilityOwner = this
    } catch (error) {
      const committedChildren = this.children
      const committed =
        committedChildren.length === nextChildren.length &&
        committedChildren.every((child, childIndex) => child === nextChildren[childIndex])
      if (committed) {
        for (const child of styledChildren) child._compatibilityOwner = this
      } else {
        this.destroyDetachedCompatibilityChildren(styledChildren)
      }
      throw error
    }
  }

  public insertBefore(
    child: string | TextRenderable | StyledText,
    anchorNode: TextRenderable | string | unknown,
  ): number {
    if (!anchorNode || !isTextRenderable(anchorNode)) throw new Error("Anchor must be a TextNodeRenderable")

    const anchorIndex = this._entries.indexOf(anchorNode)
    if (anchorIndex === -1) throw new Error("Anchor node not found in children")
    if (child === anchorNode) return anchorIndex
    return this.add(child, anchorIndex)
  }

  public remove(child: BaseRenderable): void {
    if (!isTextRenderable(child)) throw new Error("remove expects a TextNodeRenderable child object")

    const owner = this.getDocumentOwner()
    const childIndex = this._entries.indexOf(child)
    if (childIndex === -1) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`TextRenderable with id ${child.id} is not a child of ${this.id}, skipping remove`)
      }
      return
    }

    if (!owner || owner._pendingNativeMoves.length === 0) {
      this._entries.splice(childIndex, 1)
      this.detachTextChild(child)
      this._styledText = null
      this.invalidateTextDocument()
      return
    }
    const nextChildren = [...this.children]
    nextChildren.splice(childIndex, 1)
    this.children = nextChildren
  }

  public clear(): void {
    const owner = this.getDocumentOwner()
    if (!owner || owner._pendingNativeMoves.length === 0) {
      const previousChildren = this.getTextChildren()
      this._entries.splice(0)
      for (const child of previousChildren.reverse()) {
        if (child.parent === this) this.detachTextChild(child)
      }
      this._styledText = null
      this.invalidateTextDocument()
      return
    }
    this.children = []
  }

  public mergeStyles(parentStyle: TextStyle): TextStyle {
    return mergeTextStyles(
      {
        fg: this._localFg,
        bg: this._localBg,
        attributes: this._localAttributes,
        link: this._link,
        styleId: this._localStyleId,
        styleSource: this._localSyntaxStyle,
      },
      parentStyle,
      true,
    )
  }

  public gatherWithInheritedStyle(
    parentStyle: TextStyle = { fg: undefined, bg: undefined, attributes: 0 },
  ): TextChunk[] {
    const currentStyle = this.mergeStyles(parentStyle)
    const chunks: TextChunk[] = []
    for (const entry of this._entries) {
      if (isTextRun(entry)) {
        chunks.push({
          __isChunk: true,
          text: entry.text,
          ...(entry.style ? mergeRunStyle(entry.style, currentStyle) : currentStyle),
        })
      } else {
        if (entry.visible) chunks.push(...entry.gatherWithInheritedStyle(currentStyle))
      }
    }
    return chunks
  }

  public toChunks(parentStyle?: TextStyle): TextChunk[] {
    return this.gatherWithInheritedStyle(parentStyle)
  }

  public getTextChildren(): TextRenderable[] {
    return this._entries.filter(isTextRenderable)
  }

  public getChildren(): TextRenderable[] {
    return this.getTextChildren()
  }

  public getChildrenCount(): number {
    return this._styledText === null ? this._entries.length : 0
  }

  public getRenderable(id: string): TextRenderable | undefined {
    return this.getTextChildren().find((child) => child.id === id)
  }

  public getRenderableIndex(id: string): number {
    return this._entries.findIndex((entry) => isTextRenderable(entry) && entry.id === id)
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
    this._entries.splice(0)
    this._styledText = null
    let destroyError: unknown
    for (const child of children.reverse()) {
      try {
        if (child.parent === this) this.detachTextChild(child)
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
    node._entries.push(textRun(text))
    node._textDocumentPending = true
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
      this._styledText === null &&
      this._entries.length === 1 &&
      isTextRun(this._entries[0]!) &&
      this._entries[0]!.style === null
    ) {
      const run = this._entries[0] as TextRun
      this._publicTextOnly =
        run.text.length === content.length && /^[\x20-\x7e]+$/.test(run.text) && /^[\x20-\x7e]+$/.test(content)
      const owner = this.getDocumentOwner()
      const renderPending = owner?._textDocumentPending === true
      run.text = content
      this._textDocumentPending = true
      if (requestRender) {
        this.invalidateTextDocument(!renderPending || owner?.parent === null)
        if (this.hasTextDocumentState && this.lastLocalSelection) this.flushTextDocument()
      }
      return
    }
    const nextChildren: (string | TextRenderable)[] = content === "" ? [] : [content]
    this.children = nextChildren

    this._textDocumentPending = true
    if (requestRender) {
      this.invalidateTextDocument()
      if (this.hasTextDocumentState && this.lastLocalSelection) this.flushTextDocument()
    }
  }

  private replaceManualStyledText(content: StyledText, requestRender: boolean): void {
    const chunks = [...content.chunks]
    const previousRuns = this._styledText === null ? null : (this._entries as TextRun[])
    const plannedRuns = new Array<TextRun>(chunks.length)
    const styles = new Map<string, TextStyle>()
    const stableRuns = previousRuns !== null && previousRuns.length === chunks.length
    let unchangedText = stableRuns
    let changedTextPayloadEligible = true
    let hasStyleChanges = false
    let syntaxStyle: SyntaxStyle | null = null
    const validatedStyleIds = new Set<number>()
    const colorKey = (color: RGBA | undefined): string =>
      color ? `${color.buffer[0]},${color.buffer[1]},${color.buffer[2]},${color.buffer[3]}` : ""
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]!
      const text = chunk.text
      const styleId = chunk.styleId
      const styleSource = chunk.styleSource
      const fg = chunk.fg === undefined ? undefined : parseColor(chunk.fg)
      const bg = chunk.bg === undefined ? undefined : parseColor(chunk.bg)
      const attributes = chunk.attributes ?? 0
      const sourceLink = chunk.link
      const linkUrl = sourceLink && typeof sourceLink === "object" ? sourceLink.url : undefined
      if (typeof text !== "string") throw new Error("StyledText chunks require string text")
      if (!Number.isInteger(attributes) || attributes < 0 || attributes > 0xffffffff) {
        throw new Error("Text attributes must be an unsigned 32-bit integer")
      }
      if (
        sourceLink !== undefined &&
        (sourceLink === null || typeof sourceLink !== "object" || typeof linkUrl !== "string")
      ) {
        throw new Error("Text links require a string url")
      }
      if ((styleId === undefined) !== (styleSource === undefined)) {
        throw new Error("Registered text styles require both styleId and styleSource")
      }
      if (styleSource) {
        if (syntaxStyle && syntaxStyle !== styleSource) {
          throw new Error("A text document cannot mix registered styles from different SyntaxStyle instances")
        }
        syntaxStyle = styleSource
      }
      if (
        styleId !== undefined &&
        (!Number.isInteger(styleId) ||
          styleId <= 0 ||
          (!validatedStyleIds.has(styleId) && !styleSource?.getStyleById(styleId)))
      ) {
        throw new Error(`Unknown registered text style ID ${styleId}`)
      }
      if (styleId !== undefined) validatedStyleIds.add(styleId)

      const styleKey = `${colorKey(fg)}|${colorKey(bg)}|${attributes}|${styleId ?? 0}|${sourceLink ? `1:${linkUrl}` : "0"}`
      let style = styles.get(styleKey)
      if (!style) {
        style = {
          fg,
          bg,
          attributes,
          link: sourceLink === undefined ? undefined : { url: linkUrl as string },
          styleId,
          styleSource,
        }
        styles.set(styleKey, style)
      }

      const previous = previousRuns?.[index]
      if (previous) {
        const styleChanged = !textStylesEqual(previous.style!, style)
        if (previous.text !== text) {
          changedTextPayloadEligible &&=
            previous.text.length === text.length && /^[\x20-\x7e]+$/.test(previous.text) && /^[\x20-\x7e]+$/.test(text)
        }
        unchangedText &&= previous.rangeId !== null && previous.text === text
        hasStyleChanges ||= styleChanged
        plannedRuns[index] = {
          text,
          style,
          rangeId: previous.rangeId,
          styleDirty: previous.styleDirty || styleChanged,
        }
      } else {
        plannedRuns[index] = textRun(text, style)
      }
    }
    const payloadOnly =
      stableRuns &&
      !unchangedText &&
      !hasStyleChanges &&
      changedTextPayloadEligible &&
      previousRuns.every((run, index) => {
        const text = plannedRuns[index]!.text
        return run.rangeId !== null && /^[\x20-\x7e]+$/.test(text)
      })

    const hadPublicContent = this._styledText === null && this._entries.length > 0
    const dirtyBeforeScheduling = this._dirty
    if (requestRender && !hadPublicContent) {
      try {
        this.requestRender()
      } catch (error) {
        this._dirty = dirtyBeforeScheduling
        throw error
      }
    }

    let cleanupError: unknown
    let cleanupFailed = false
    if (hadPublicContent) textDocumentMutationDepth += 1
    try {
      if (hadPublicContent) {
        try {
          this.children = []
        } catch (error) {
          if (this._styledText !== null || this._entries.length !== 0) throw error
          cleanupError = error
          cleanupFailed = true
        }
      }
      if (previousRuns) {
        const owner = this.getDocumentOwner()
        for (let index = 0; index < previousRuns.length; index++) {
          const previous = previousRuns[index]!
          const planned = plannedRuns[index]
          if (planned) {
            previous.text = planned.text
            previous.style = planned.style
            previous.styleDirty = planned.styleDirty
            plannedRuns[index] = previous
          } else if (owner && previous.rangeId !== null) {
            owner._pendingRemovedRangeIds.add(previous.rangeId)
          }
        }
      }
      this._entries = plannedRuns
      this._styledText = content
      this._manualTextOnly = payloadOnly
      this._textDocumentPending = !unchangedText
      if (hasStyleChanges && unchangedText) this.invalidateManualStyleDiff(false)
      if (!unchangedText) this.invalidateTextDocument(false)
      if (requestRender && this.hasTextDocumentState && this.lastLocalSelection) this.flushTextDocument()
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
    if (cleanupFailed) throw cleanupError
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
        child._entries.push(textRun(chunk.text))
        children.push(child)
      }
      return children
    } catch (error) {
      this.destroyDetachedCompatibilityChildren(children)
      throw error
    }
  }

  private destroyDetachedCompatibilityChildren(children: TextRenderable[]): void {
    for (const child of children.reverse()) {
      if (child.isDestroyed || child.parent === this) continue
      try {
        child.destroyRecursively()
      } catch {}
    }
  }

  private detachTextChild(child: TextRenderable): void {
    const destroyOwned = child._compatibilityOwner === this
    child._compatibilityOwner = null
    child.parent = null
    if (destroyOwned) child.destroyRecursively()
    else if (child._textDocumentRole === "owner") {
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

  private invalidateTextDocument(requestRender: boolean = true): void {
    const owner = this.getDocumentOwner()
    if (owner) {
      owner._textDocumentPending = true
      owner._pendingDocumentRoots.add(this)
      if (!owner.parent) {
        if (textDocumentMutationDepth === 0) owner.flushTextDocument()
        else deferredDocumentOwners.add(owner)
      }
    }
    if (requestRender) this.requestRender()
  }

  private flushTextDocument(): void {
    if (!this.hasTextDocumentState || isTextRenderable(this.parent)) return
    const prepared = this.prepareTextDocumentFlush()
    const ids = this.textBuffer.applyDocumentOperations(prepared.operations)
    this.commitPreparedTextDocumentFlush(prepared, ids)
  }

  private prepareTextDocumentFlush(): PreparedTextDocumentFlush {
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
    const pendingSet = new Set(pending)
    const roots = pending.filter((candidate) => {
      let parent = candidate.parent
      while (isTextRenderable(parent)) {
        if (pendingSet.has(parent)) return false
        parent = parent.parent
      }
      return true
    })
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
      let previousIndex = isTextRenderable(parent) ? parent._entries.indexOf(roots[index]!) : -1
      while (isTextRenderable(parent) && index + run.length < roots.length) {
        const candidate = roots[index + run.length]!
        if (candidate.parent !== parent || parent._entries[previousIndex + 1] !== candidate) break
        run.push(candidate)
        previousIndex += 1
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
    const payloadOnlyBatch =
      replacementPlans.length === 1 &&
      this._pendingNativeMoves.length === 0 &&
      this._pendingRemovedRangeIds.size === 0 &&
      [...this._pendingStyleRoots].every((root) => root._manualStyleDiffOnly)
    for (const plan of replacementPlans)
      this.collectNativeSubtreeOperation(plan.roots, operations, assignments, payloadOnlyBatch)
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
        root.collectNativeStyleOperations(this, root.resolvedParentStyle(), operations, root._manualStyleDiffOnly)
    }
    const syntaxStyles = new Set<SyntaxStyle>()
    this.collectRegisteredSyntaxStyles(syntaxStyles)
    if (syntaxStyles.size > 1)
      throw new Error("A text document cannot mix registered styles from different SyntaxStyle instances")
    return {
      operations,
      assignments,
      contentChanged: replacementPlans.length > 0 || this._pendingNativeMoves.length > 0,
      layoutChanged: !operations.some((operation) => operation.kind === "replace" && operation.before),
    }
  }

  private commitPreparedTextDocumentFlush(prepared: PreparedTextDocumentFlush, ids: bigint[]): void {
    const { assignments, contentChanged, layoutChanged } = prepared
    ids.forEach((id, index) => assignments[index]!(id))
    for (const root of new Set([...this._pendingDocumentRoots, ...this._pendingStyleRoots])) {
      root.clearCommittedManualStyleFlags()
    }
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
    const result = first.textBuffer.applyTwoDocumentOperations(
      second.textBuffer,
      firstPrepared.operations,
      secondPrepared.operations,
    )
    first.commitPreparedTextDocumentFlush(firstPrepared, result.ids)
    second.commitPreparedTextDocumentFlush(secondPrepared, result.otherIds)
    deferredDocumentOwners.delete(first)
    deferredDocumentOwners.delete(second)
  }

  private collectNativeSubtreeOperation(
    roots: TextRenderable[],
    operations: DocumentOperation[],
    batchAssignments: Array<(id: bigint) => void>,
    payloadOnlyBatch: boolean,
  ): void {
    const stableAsciiLeaf = (root: TextRenderable): boolean => {
      const entry = root._entries[0]
      return (
        root._nativeRangeId !== null &&
        root._publicTextOnly &&
        root._styledText === null &&
        root._entries.length === 1 &&
        entry !== undefined &&
        isTextRun(entry) &&
        root.ancestorsVisible() &&
        /^[\x20-\x7e]+$/.test(entry.text)
      )
    }
    const manual = roots.length === 1 ? roots[0]! : null
    const payloadOnly =
      payloadOnlyBatch &&
      (roots.every(stableAsciiLeaf) ||
        (manual !== null && manual._styledText !== null && manual._manualTextOnly && manual._nativeRangeId !== null))
    if (payloadOnly) {
      operations.push({
        kind: "replace",
        targetId: roots[0]!._nativeRangeId!,
        anchorId: roots.length > 1 ? roots.at(-1)!._nativeRangeId! : undefined,
        targetMode: "replace",
        owner: this._textDocumentOwner,
        before: true,
        chunks: [
          {
            text: roots
              .flatMap((root) => root._entries.filter(isTextRun))
              .map((entry) => entry.text)
              .join(""),
          },
        ],
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
    for (const entry of node._entries) if (isTextRun(entry) && entry.rangeId !== null) rangeIds.add(entry.rangeId)
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
    const style = node.mergeStyles(parentStyle)
    const start = chunks.length
    const nodeRangeIndex = ranges.length
    const publicLeaf = node._styledText === null && node._entries.length === 1 && isTextRun(node._entries[0]!)
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

    if (publicLeaf) {
      if (visible) chunks.push({ text: (node._entries[0] as TextRun).text })
      ranges[nodeRangeIndex]!.endChunk = chunks.length
      return
    }

    for (const entry of node._entries) {
      if (isTextRun(entry)) {
        const effective = entry.style ? mergeRunStyle(entry.style, style) : style
        const runStart = chunks.length
        if (visible) chunks.push({ text: entry.text })
        ranges.push({
          id: entry.rangeId ?? undefined,
          startChunk: runStart,
          endChunk: chunks.length,
          ...(hasTextStyle(effective) ? effective : {}),
          styled: hasTextStyle(effective),
          priority: Math.min(255, depth + 1),
        })
        assignments.push((id) => (entry.rangeId = id))
      } else {
        this.collectNativeDocument(entry, style, depth + 1, visible && entry.visible, chunks, ranges, assignments)
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
    this._manualStyleDiffOnly = false
    owner._pendingStyleRoots.add(this)
    owner._textDocumentPending = true
    if (!owner.parent) owner.flushTextDocument()
    this.requestRender()
  }

  private collectNativeStyleOperations(
    owner: TextRenderable,
    parentStyle: TextStyle,
    operations: DocumentOperation[],
    changedManualLeavesOnly: boolean = false,
  ): void {
    const style = this.mergeStyles(parentStyle)
    const publicLeaf = this._styledText === null && this._entries.length === 1 && isTextRun(this._entries[0]!)
    if (publicLeaf && this._nativeRangeId !== null) {
      operations.push({
        kind: "updateStyle",
        targetId: this._nativeRangeId,
        owner: owner._textDocumentOwner,
        ...style,
      })
    } else {
      for (const entry of this._entries) {
        if (!isTextRun(entry) || entry.rangeId === null || (changedManualLeavesOnly && !entry.styleDirty)) continue
        operations.push({
          kind: "updateStyle",
          targetId: entry.rangeId,
          owner: owner._textDocumentOwner,
          ...(entry.style ? mergeRunStyle(entry.style, style) : style),
        })
      }
    }
    for (const child of this.getTextChildren()) child.collectNativeStyleOperations(owner, style, operations)
  }

  private invalidateManualStyleDiff(requestRender: boolean): void {
    const owner = this.getDocumentOwner()
    if (owner) {
      this._manualStyleDiffOnly = true
      owner._pendingStyleRoots.add(this)
      owner._textDocumentPending = true
      if (!owner.parent) owner.flushTextDocument()
    }
    if (requestRender) this.requestRender()
  }

  private clearCommittedManualStyleFlags(): void {
    this._manualStyleDiffOnly = false
    for (const entry of this._entries) if (isTextRun(entry)) entry.styleDirty = false
    for (const child of this.getTextChildren()) child.clearCommittedManualStyleFlags()
  }

  private collectRegisteredSyntaxStyles(styles: Set<SyntaxStyle>): void {
    if (this._localStyleId !== undefined && this._localSyntaxStyle && this.ancestorsVisible()) {
      styles.add(this._localSyntaxStyle)
    }
    if (this.ancestorsVisible()) {
      for (const entry of this._entries) {
        if (isTextRun(entry) && entry.style?.styleSource) styles.add(entry.style.styleSource)
      }
    }
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

  private resetNativeRanges(): void {
    this._nativeRangeId = null
    for (const entry of this._entries) if (isTextRun(entry)) entry.rangeId = null
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
        runIds: this._entries.map((entry) => (isTextRun(entry) ? entry.rangeId : null)),
      },
    ]
    for (const child of this.getTextChildren()) result.push(...child.captureNativeRanges())
    return result
  }

  private restoreNativeRanges(snapshot: NativeRangeSnapshot[]): void {
    for (const entry of snapshot) {
      entry.node._nativeRangeId = entry.id
      for (let index = 0; index < entry.runIds.length; index++) {
        const run = entry.node._entries[index]
        if (run && isTextRun(run)) run.rangeId = entry.runIds[index] ?? null
      }
    }
  }

  private queueNativeRangeRemoval(root: TextRenderable): void {
    if (root._nativeRangeId !== null) this._pendingRemovedRangeIds.add(root._nativeRangeId)
    for (const entry of root._entries)
      if (isTextRun(entry) && entry.rangeId !== null) this._pendingRemovedRangeIds.add(entry.rangeId)
    for (const child of root.getTextChildren()) this.queueNativeRangeRemoval(child)
  }

  private planNativeChildMoves(previous: TextRenderable[], next: TextRenderable[]): PlannedNativeMove[] {
    type ChildNode = { child: TextRenderable; prev: ChildNode | null; next: ChildNode | null }
    const plan = (fromEnd: boolean): PlannedNativeMove[] => {
      const nodes = new Map<TextRenderable, ChildNode>()
      let last: ChildNode | null = null
      for (const child of previous) {
        const node: ChildNode = { child, prev: last, next: null }
        if (last) last.next = node
        nodes.set(child, node)
        last = node
      }

      const moves: PlannedNativeMove[] = []
      let cursor = fromEnd ? last : (nodes.get(previous[0]!) ?? null)
      for (
        let index = fromEnd ? next.length - 1 : 0;
        fromEnd ? index >= 0 : index < next.length;
        index += fromEnd ? -1 : 1
      ) {
        const desired = nodes.get(next[index]!)!
        if (desired === cursor) {
          cursor = fromEnd ? cursor.prev : cursor.next
          continue
        }

        const anchor = cursor!
        moves.push({ source: desired.child, anchor: anchor.child, before: !fromEnd })
        if (desired.prev) desired.prev.next = desired.next
        if (desired.next) desired.next.prev = desired.prev
        if (fromEnd) {
          desired.prev = anchor
          desired.next = anchor.next
          if (anchor.next) anchor.next.prev = desired
          anchor.next = desired
        } else {
          desired.prev = anchor.prev
          desired.next = anchor
          if (anchor.prev) anchor.prev.next = desired
          anchor.prev = desired
        }
      }
      return moves
    }

    const forward = plan(false)
    const reverse = plan(true)
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

  private detachedPlainText(): string {
    return this.gatherWithInheritedStyle()
      .map((chunk) => chunk.text.replace(/\r\n?/g, "\n"))
      .join("")
  }
}
