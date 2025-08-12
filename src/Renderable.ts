import { OptimizedBuffer, type RenderContext, type MouseEvent, type SelectionState } from "."
import { EventEmitter } from "events"
import Yoga, { FlexDirection, Direction, PositionType, Edge, Align, Justify, type Config, Display } from "yoga-layout"
import { TrackedNode, createTrackedNode } from "./lib/TrackedNode"
import type { ParsedKey } from "./lib/parse.keypress"
import { getKeyHandler, type KeyHandler } from "./lib/KeyHandler"

export enum LayoutEvents {
  LAYOUT_CHANGED = "layout-changed",
  ADDED = "added",
  REMOVED = "removed",
  RESIZED = "resized",
}

export enum RenderableEvents {
  FOCUSED = "focused",
  BLURRED = "blurred",
}

export { Justify, Align, FlexDirection, Direction, PositionType, Edge }

export interface Position {
  top?: number | "auto" | `${number}%`
  right?: number | "auto" | `${number}%`
  bottom?: number | "auto" | `${number}%`
  left?: number | "auto" | `${number}%`
}

export interface LayoutOptions {
  flexGrow?: number
  flexShrink?: number
  flexDirection?: FlexDirection
  alignItems?: Align
  justifyContent?: Justify
  flexBasis?: number | "auto" | undefined
  positionType?: "absolute" | "relative"
  position?: Position
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  margin?:
    | {
        top?: number
        right?: number
        bottom?: number
        left?: number
      }
    | number
    | "auto"
    | `${number}%`
  padding?:
    | {
        top?: number
        right?: number
        bottom?: number
        left?: number
      }
    | number
    | `${number}%`
  enableLayout?: boolean
}

export interface RenderableOptions extends Partial<LayoutOptions> {
  width?: number | "auto" | `${number}%`
  height?: number | "auto" | `${number}%`
  zIndex: number
  visible?: boolean
  buffered?: boolean
}

let renderableNumber = 1

export abstract class Renderable extends EventEmitter {
  static renderablesByNumber: Map<number, Renderable> = new Map()

  public readonly id: string
  public readonly num: number
  protected ctx: RenderContext | null = null
  private _x: number = 0
  private _y: number = 0
  private _width: number | "auto" | `${number}%`
  private _height: number | "auto" | `${number}%`
  private _widthValue: number = 0
  private _heightValue: number = 0
  private _zIndex: number
  protected _visible: boolean
  public selectable: boolean = false
  protected buffered: boolean
  protected frameBuffer: OptimizedBuffer | null = null
  private _dirty: boolean = false

  protected focusable: boolean = false
  protected _focused: boolean = false
  protected keyHandler: KeyHandler = getKeyHandler()
  protected keypressHandler: ((key: ParsedKey) => void) | null = null

  protected layoutNode: TrackedNode
  protected _positionType: "absolute" | "relative" = "relative"
  protected _position: Position = {}

  private renderableMap: Map<string, Renderable> = new Map()
  private renderableArray: Renderable[] = []
  private needsZIndexSort: boolean = false
  public parent: Renderable | null = null

  // This is a workaround for yoga-layout performance issues (wasm call overhead)
  // when setting the position of an element. Absolute elements do not need a full layout update.
  // But when other attributes change and update the layout, it should update the layout node position.
  // TODO: Use a bun ffi wrapper for a native yoga build instead of wasm.
  private _yogaPerformancePositionUpdated: boolean = false

  constructor(id: string, options: RenderableOptions) {
    super()
    this.id = id
    this.num = renderableNumber++
    Renderable.renderablesByNumber.set(this.num, this)

    this._width = options.width ?? "auto"
    this._height = options.height ?? "auto"
    this._zIndex = options.zIndex
    this._visible = options.visible !== false
    this.buffered = options.buffered ?? false

    this.layoutNode = createTrackedNode({ renderable: this } as any)
    this.layoutNode.yogaNode.setDisplay(this._visible ? Display.Flex : Display.None)
    this.setupYogaProperties(options)

    if (this.buffered) {
      this.createFrameBuffer()
    }
  }

  public get visible(): boolean {
    return this._visible
  }

  public set visible(value: boolean) {
    this._visible = value
    this.layoutNode.yogaNode.setDisplay(value ? Display.Flex : Display.None)
    if (this._focused) {
      this.blur()
    }
    this.requestLayout()
  }

  public hasSelection(): boolean {
    return false
  }

  public onSelectionChanged(selection: SelectionState | null): boolean {
    // Default implementation: do nothing
    // Override this method to provide custom selection handling
    return false
  }

  public getSelectedText(): string {
    return ""
  }

  public shouldStartSelection(x: number, y: number): boolean {
    return false
  }

  public focus(): void {
    if (this._focused || !this.focusable) return

    this._focused = true
    this.needsUpdate()

    this.keypressHandler = (key: ParsedKey) => {
      if (this.handleKeyPress) {
        this.handleKeyPress(key)
      }
    }

    this.keyHandler.on("keypress", this.keypressHandler)
    this.emit(RenderableEvents.FOCUSED)
  }

  public blur(): void {
    if (!this._focused || !this.focusable) return

    this._focused = false
    this.needsUpdate()

    if (this.keypressHandler) {
      this.keyHandler.off("keypress", this.keypressHandler)
      this.keypressHandler = null
    }

    this.emit(RenderableEvents.BLURRED)
  }

  public get focused(): boolean {
    return this._focused
  }

  public handleKeyPress?(key: ParsedKey | string): boolean

  protected get isDirty(): boolean {
    return this._dirty
  }

  private markClean(): void {
    this._dirty = false
  }

  public needsUpdate() {
    this._dirty = true
    this.ctx?.needsUpdate()
  }

  public get x(): number {
    if (this.parent && this._positionType === "relative") {
      return this.parent.x + this._x
    }
    return this._x
  }

  public set x(value: number) {
    this.setPosition({
      left: value,
    })
  }

  public set top(value: number) {
    this.setPosition({
      top: value,
    })
  }

  public set left(value: number) {
    this.setPosition({
      left: value,
    })
  }

  public get y(): number {
    if (this.parent && this._positionType === "relative") {
      return this.parent.y + this._y
    }
    return this._y
  }

  public set y(value: number) {
    this.setPosition({
      top: value,
    })
  }

  public get width(): number {
    return this._widthValue
  }

  public set width(value: number | "auto" | `${number}%`) {
    this._width = value
    this.layoutNode.setWidth(value)
    this.requestLayout()
  }

  public get height(): number {
    return this._heightValue
  }

  public set height(value: number | "auto" | `${number}%`) {
    this._height = value
    this.layoutNode.setHeight(value)
    this.requestLayout()
  }

  public get zIndex(): number {
    return this._zIndex
  }

  public set zIndex(value: number) {
    if (this._zIndex !== value) {
      this._zIndex = value
      this.parent?.requestZIndexSort()
    }
  }

  public requestZIndexSort(): void {
    this.needsZIndexSort = true
  }

  private ensureZIndexSorted(): void {
    if (this.needsZIndexSort) {
      this.renderableArray.sort((a, b) => (a.zIndex > b.zIndex ? 1 : a.zIndex < b.zIndex ? -1 : 0))
      this.needsZIndexSort = false
    }
  }

  private setupYogaProperties(options: RenderableOptions): void {
    const node = this.layoutNode.yogaNode

    if (options.flexBasis !== undefined) {
      node.setFlexBasis(options.flexBasis)
    }

    if (options.minWidth !== undefined) {
      node.setMinWidth(options.minWidth)
    }
    if (options.minHeight !== undefined) {
      node.setMinHeight(options.minHeight)
    }

    if (options.flexGrow !== undefined) {
      node.setFlexGrow(options.flexGrow)
    } else {
      node.setFlexGrow(0)
    }

    if (options.flexShrink !== undefined) {
      node.setFlexShrink(options.flexShrink)
    } else {
      const shrinkValue = options.flexGrow && options.flexGrow > 0 ? 1 : 0
      node.setFlexShrink(shrinkValue)
    }

    if (options.flexDirection !== undefined) {
      node.setFlexDirection(options.flexDirection)
    }
    if (options.alignItems !== undefined) {
      node.setAlignItems(options.alignItems)
    }
    if (options.justifyContent !== undefined) {
      node.setJustifyContent(options.justifyContent)
    }

    if (options.width !== undefined) {
      this._width = options.width
      this.layoutNode.setWidth(options.width)
    }
    if (options.height !== undefined) {
      this._height = options.height
      this.layoutNode.setHeight(options.height)
    }

    this._positionType = options.positionType ?? "relative"
    if (this._positionType === "absolute") {
      node.setPositionType(PositionType.Absolute)
    }

    if (options.position) {
      this._position = options.position
      this.updateYogaPosition(options.position)
    }

    if (options.maxWidth !== undefined) {
      node.setMaxWidth(options.maxWidth)
    }
    if (options.maxHeight !== undefined) {
      node.setMaxHeight(options.maxHeight)
    }

    if (typeof options.margin === "object") {
      const { top, right, bottom, left } = options.margin
      if (top !== undefined) node.setMargin(Edge.Top, top)
      if (right !== undefined) node.setMargin(Edge.Right, right)
      if (bottom !== undefined) node.setMargin(Edge.Bottom, bottom)
      if (left !== undefined) node.setMargin(Edge.Left, left)
    } else if (options.margin !== undefined) {
      node.setMargin(Edge.Top, options.margin)
      node.setMargin(Edge.Right, options.margin)
      node.setMargin(Edge.Bottom, options.margin)
      node.setMargin(Edge.Left, options.margin)
    }

    if (typeof options.padding === "object") {
      const { top, right, bottom, left } = options.padding
      if (top !== undefined) node.setPadding(Edge.Top, top)
      if (right !== undefined) node.setPadding(Edge.Right, right)
      if (bottom !== undefined) node.setPadding(Edge.Bottom, bottom)
      if (left !== undefined) node.setPadding(Edge.Left, left)
    } else if (options.padding !== undefined) {
      node.setPadding(Edge.Top, options.padding)
      node.setPadding(Edge.Right, options.padding)
      node.setPadding(Edge.Bottom, options.padding)
      node.setPadding(Edge.Left, options.padding)
    }
  }

  public setPosition(position: Position): void {
    this._position = position
    this.updateYogaPosition(position)
  }

  private updateYogaPosition(position: Position): void {
    const node = this.layoutNode.yogaNode
    const { top, right, bottom, left } = position

    if (this._positionType === "relative") {
      if (top !== undefined) {
        if (top === "auto") {
          node.setPositionAuto(Edge.Top)
        } else {
          node.setPosition(Edge.Top, top)
        }
      }
      if (right !== undefined) {
        if (right === "auto") {
          node.setPositionAuto(Edge.Right)
        } else {
          node.setPosition(Edge.Right, right)
        }
      }
      if (bottom !== undefined) {
        if (bottom === "auto") {
          node.setPositionAuto(Edge.Bottom)
        } else {
          node.setPosition(Edge.Bottom, bottom)
        }
      }
      if (left !== undefined) {
        if (left === "auto") {
          node.setPositionAuto(Edge.Left)
        } else {
          node.setPosition(Edge.Left, left)
        }
      }
      this.requestLayout()
    } else {
      if (typeof top === "number" && this._positionType === "absolute") {
        this._y = top
      }
      if (typeof left === "number" && this._positionType === "absolute") {
        this._x = left
      }
      this.needsUpdate()
      this._yogaPerformancePositionUpdated = false
    }
  }

  public set flexGrow(grow: number) {
    this.layoutNode.yogaNode.setFlexGrow(grow)
    this.requestLayout()
  }

  public set flexShrink(shrink: number) {
    this.layoutNode.yogaNode.setFlexShrink(shrink)
    this.requestLayout()
  }

  public set flexDirection(direction: FlexDirection) {
    this.layoutNode.yogaNode.setFlexDirection(direction)
    this.requestLayout()
  }

  public set alignItems(alignItems: Align) {
    this.layoutNode.yogaNode.setAlignItems(alignItems)
    this.requestLayout()
  }

  public set justifyContent(justifyContent: Justify) {
    this.layoutNode.yogaNode.setJustifyContent(justifyContent)
    this.requestLayout()
  }

  public set flexBasis(basis: number | "auto" | undefined) {
    this.layoutNode.yogaNode.setFlexBasis(basis)
    this.requestLayout()
  }

  public set minWidth(minWidth: number | `${number}%` | undefined) {
    this.layoutNode.yogaNode.setMinWidth(minWidth)
    this.requestLayout()
  }

  public set maxWidth(maxWidth: number | `${number}%` | undefined) {
    this.layoutNode.yogaNode.setMaxWidth(maxWidth)
    this.requestLayout()
  }

  public set minHeight(minHeight: number | `${number}%` | undefined) {
    this.layoutNode.yogaNode.setMinHeight(minHeight)
    this.requestLayout()
  }

  public set maxHeight(maxHeight: number | `${number}%` | undefined) {
    this.layoutNode.yogaNode.setMaxHeight(maxHeight)
    this.requestLayout()
  }

  public getLayoutNode(): TrackedNode {
    return this.layoutNode
  }

  public updateFromLayout(): void {
    const layout = this.layoutNode.yogaNode.getComputedLayout()

    if (this._positionType === "relative" || this._yogaPerformancePositionUpdated) {
      this._x = layout.left
      this._y = layout.top
    }

    const newWidth = Math.max(layout.width, 1)
    const newHeight = Math.max(layout.height, 1)
    const sizeChanged = this.width !== newWidth || this.height !== newHeight

    this._widthValue = newWidth
    this._heightValue = newHeight

    if (sizeChanged) {
      this.onLayoutResize(newWidth, newHeight)
    }
  }

  protected onLayoutResize(width: number, height: number): void {
    if (this._visible) {
      this.handleFrameBufferResize(width, height)
      this.onResize(width, height)
      this.needsUpdate()
    }
  }

  protected handleFrameBufferResize(width: number, height: number): void {
    if (!this.buffered) return

    if (width <= 0 || height <= 0) {
      return
    }

    if (this.frameBuffer) {
      this.frameBuffer.resize(width, height)
    } else {
      this.createFrameBuffer()
    }
  }

  protected createFrameBuffer(): void {
    const w = this.width
    const h = this.height

    if (w <= 0 || h <= 0) {
      return
    }

    try {
      this.frameBuffer = OptimizedBuffer.create(w, h, {
        respectAlpha: true,
      })
    } catch (error) {
      console.error(`Failed to create frame buffer for ${this.id}:`, error)
      this.frameBuffer = null
    }
  }

  protected onResize(width: number, height: number): void {
    // Override in subclasses for additional resize logic
  }

  protected requestLayout(): void {
    if (!this._yogaPerformancePositionUpdated) {
      const layout = this.layoutNode.yogaNode.getComputedLayout()

      if (layout.left !== this._x || layout.top !== this._y) {
        this.layoutNode.yogaNode.setPosition(Edge.Left, this._x)
        this.layoutNode.yogaNode.setPosition(Edge.Top, this._y)
      }
      this._yogaPerformancePositionUpdated = true
    }

    this.needsUpdate()
  }

  public add(obj: Renderable): void {
    if (this.renderableMap.has(obj.id)) {
      this.remove(obj.id)
    }

    if (obj.parent) {
      obj.parent.remove(obj.id)
    }

    obj.parent = this
    if (this.ctx) {
      obj.propagateContext(this.ctx)
    }

    this.renderableArray.push(obj)
    this.needsZIndexSort = true
    this.renderableMap.set(obj.id, obj)

    const childLayoutNode = obj.getLayoutNode()
    this.layoutNode.addChild(childLayoutNode)
    this.requestLayout()

    this.emit("child:added", obj)
  }

  public propagateContext(ctx: RenderContext | null): void {
    this.ctx = ctx
    for (const child of this.renderableArray) {
      child.propagateContext(ctx)
    }
  }

  public getRenderable(id: string): Renderable | undefined {
    return this.renderableMap.get(id)
  }

  public remove(id: string): void {
    if (!id) {
      return
    }
    if (this.renderableMap.has(id)) {
      const obj = this.renderableMap.get(id)
      if (obj) {
        const childLayoutNode = obj.getLayoutNode()
        this.layoutNode.removeChild(childLayoutNode)
        this.requestLayout()

        obj.parent = null
        obj.propagateContext(null)
      }
      this.renderableMap.delete(id)

      const index = this.renderableArray.findIndex((obj) => obj.id === id)
      if (index !== -1) {
        this.renderableArray.splice(index, 1)
      }
      this.emit("child:removed", id)
    }
  }

  public getChildren(): Renderable[] {
    return [...this.renderableArray]
  }

  public render(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible) return

    this.beforeRender()
    this.updateFromLayout()

    const renderBuffer = this.buffered && this.frameBuffer ? this.frameBuffer : buffer

    this.renderSelf(renderBuffer, deltaTime)
    this.markClean()
    this.ctx?.addToHitGrid(this.x, this.y, this.width, this.height, this.num)
    this.ensureZIndexSorted()

    for (const child of this.renderableArray) {
      child.render(renderBuffer, deltaTime)
    }

    if (this.buffered && this.frameBuffer) {
      buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
    }
  }

  protected beforeRender(): void {
    // Default implementation: do nothing
    // Override this method to provide custom rendering
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    // Default implementation: do nothing
    // Override this method to provide custom rendering
  }

  public destroy(): void {
    if (this.parent) {
      this.parent.remove(this.id)
    }

    if (this.frameBuffer) {
      this.frameBuffer.destroy()
      this.frameBuffer = null
    }

    for (const child of this.renderableArray) {
      child.parent = null
      child.destroy()
    }

    this.renderableArray = []
    this.renderableMap.clear()
    Renderable.renderablesByNumber.delete(this.num)

    this.layoutNode.destroy()
    this.blur()
    this.removeAllListeners()

    this.destroySelf()
  }

  protected destroySelf(): void {
    // Default implementation: do nothing else
    // Override this method to provide custom cleanup
  }

  public processMouseEvent(event: MouseEvent): void {
    this.onMouseEvent(event)
    if (this.parent && !event.defaultPrevented) {
      this.parent.processMouseEvent(event)
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    // Default implementation: do nothing
    // Override this method to provide custom event handling
  }
}

export class RootRenderable extends Renderable {
  private yogaConfig: Config

  constructor(width: number, height: number, ctx: RenderContext) {
    super("__root__", { zIndex: 0, visible: true, width, height, enableLayout: true })
    this.ctx = ctx

    this.yogaConfig = Yoga.Config.create()
    this.yogaConfig.setUseWebDefaults(false)
    this.yogaConfig.setPointScaleFactor(1)

    if (this.layoutNode) {
      this.layoutNode.destroy()
    }

    this.layoutNode = createTrackedNode({}, this.yogaConfig)
    this.layoutNode.setWidth(width)
    this.layoutNode.setHeight(height)
    this.layoutNode.yogaNode.setFlexDirection(FlexDirection.Column)

    this.calculateLayout()
  }

  public add(obj: Renderable): void {
    super.add(obj)

    const childLayoutNode = obj.getLayoutNode()
    this.layoutNode.addChild(childLayoutNode)
    this.requestLayout()
    this.emit(LayoutEvents.ADDED, obj)
  }

  public remove(id: string): void {
    const obj = this.getRenderable(id)

    if (obj) {
      this.layoutNode.removeChild(obj.getLayoutNode())
      this.emit(LayoutEvents.REMOVED, obj)
      this.requestLayout()
    }

    super.remove(id)
  }

  public requestLayout(): void {
    this.needsUpdate()
  }

  public calculateLayout(): void {
    this.layoutNode.yogaNode.calculateLayout(this.width, this.height, Direction.LTR)
    this.emit(LayoutEvents.LAYOUT_CHANGED)
  }

  public resize(width: number, height: number): void {
    this.layoutNode.setWidth(width)
    this.layoutNode.setHeight(height)

    this.emit(LayoutEvents.RESIZED, { width, height })
  }

  protected beforeRender(): void {
    if (this.layoutNode.yogaNode.isDirty()) {
      this.calculateLayout()
    }
  }

  protected destroySelf(): void {
    if (this.layoutNode) {
      this.layoutNode.destroy()
    }

    try {
      this.yogaConfig.free()
    } catch (error) {
      // Config might already be freed
    }

    super.destroySelf()
  }
}
