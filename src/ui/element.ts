import { Renderable, type RenderableOptions } from "../Renderable"
import type { BorderCharacters, BorderSides, BorderStyle, CliRenderer } from "../index"
import { OptimizedBuffer } from "../buffer"
import { parseColor } from "../utils"
import { drawBorder } from "./lib/border"
import type { RGBA, ColorInput } from "../types"
import type { ParsedKey } from "../parse.keypress"
import { TrackedNode, createTrackedNode } from "./lib/TrackedNode"
import { FlexDirection, PositionType, Edge, Align, Justify, Direction, type Config } from "yoga-layout"
import type { ILayout, ILayoutElement } from "./types"
import { getKeyHandler, type KeyHandler } from "./lib/KeyHandler"

export interface Position {
  top?: number | "auto" | `${number}%`
  right?: number | "auto" | `${number}%`
  bottom?: number | "auto" | `${number}%`
  left?: number | "auto" | `${number}%`
}

export interface LayoutOptions {
  width?: number | "auto" | `${number}%`
  height?: number | "auto" | `${number}%`
  flexGrow?: number
  flexShrink?: number
  flexDirection?: FlexDirection
  alignItems?: Align
  justifyContent?: Justify
  positionType?: "absolute" | "relative"
  position?: Position
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  margin?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
  padding?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
  }
}

export interface ElementOptions extends Omit<RenderableOptions, "width" | "height">, Partial<LayoutOptions> {
  backgroundColor?: ColorInput
  textColor?: ColorInput
  borderStyle?: BorderStyle
  border?: boolean | BorderSides[]
  borderColor?: ColorInput
  customBorderChars?: BorderCharacters
  focusedBorderColor?: ColorInput
  title?: string
  titleAlignment?: "left" | "center" | "right"
}

export enum ElementEvents {
  FOCUSED = "focused",
  BLURRED = "blurred",
}

export abstract class LayoutElement extends Renderable {
  protected layoutNode: TrackedNode
  protected parentLayout: ILayout | null = null
  protected _positionType: "absolute" | "relative" = "relative"
  protected _position: Position = {}

  constructor(id: string, options: Omit<RenderableOptions, "width" | "height"> & Partial<LayoutOptions>) {
    const renderableOptions: RenderableOptions = {
      ...options,
      width: typeof options.width === "number" ? options.width : 0,
      height: typeof options.height === "number" ? options.height : 0,
    }

    super(id, renderableOptions)

    this.layoutNode = createTrackedNode({ renderable: this } as any)
    this.setupYogaProperties({ ...options, ...renderableOptions })

    this.width = typeof options.width === "number" ? options.width : 0
    this.height = typeof options.height === "number" ? options.height : 0

    const desiredWidth = this.width || "auto"
    const desiredHeight = this.height || "auto"

    queueMicrotask(() => {
      this.setWidth(desiredWidth)
      this.setHeight(desiredHeight)
    })
  }

  private setupYogaProperties(options: RenderableOptions & Partial<LayoutOptions>): void {
    const node = this.layoutNode.yogaNode

    if (options.flexGrow === 0 || options.flexGrow === undefined) {
      node.setFlexBasis(options.height)
    } else {
      node.setFlexBasisAuto()
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

    this._positionType = options.positionType || "relative"
    if (this._positionType === "absolute") {
      node.setPositionType(PositionType.Absolute)
    }

    if (options.position) {
      this.setPosition(options.position)
    }

    if (options.maxWidth !== undefined) {
      node.setMaxWidth(options.maxWidth)
    }
    if (options.maxHeight !== undefined) {
      node.setMaxHeight(options.maxHeight)
    }

    if (options.margin) {
      const { top, right, bottom, left } = options.margin
      if (top !== undefined) node.setMargin(Edge.Top, top)
      if (right !== undefined) node.setMargin(Edge.Right, right)
      if (bottom !== undefined) node.setMargin(Edge.Bottom, bottom)
      if (left !== undefined) node.setMargin(Edge.Left, left)
    }

    if (options.padding) {
      const { top, right, bottom, left } = options.padding
      if (top !== undefined) node.setPadding(Edge.Top, top)
      if (right !== undefined) node.setPadding(Edge.Right, right)
      if (bottom !== undefined) node.setPadding(Edge.Bottom, bottom)
      if (left !== undefined) node.setPadding(Edge.Left, left)
    }
  }

  public setPosition(position: Position): void {
    this._position = position
    this.updateYogaPosition(position)
  }

  private updateYogaPosition(position: Position): void {
    const node = this.layoutNode.yogaNode
    const { top, right, bottom, left } = position

    node.setPosition(Edge.All, undefined)

    if (top !== undefined) {
      if (typeof top === "string" && top === "auto") {
        node.setPositionAuto(Edge.Top)
      } else {
        node.setPosition(Edge.Top, top)
      }
    }
    if (right !== undefined) {
      if (typeof right === "string" && right === "auto") {
        node.setPositionAuto(Edge.Right)
      } else {
        node.setPosition(Edge.Right, right)
      }
    }
    if (bottom !== undefined) {
      if (typeof bottom === "string" && bottom === "auto") {
        node.setPositionAuto(Edge.Bottom)
      } else {
        node.setPosition(Edge.Bottom, bottom)
      }
    }
    if (left !== undefined) {
      if (typeof left === "string" && left === "auto") {
        node.setPositionAuto(Edge.Left)
      } else {
        node.setPosition(Edge.Left, left)
      }
    }

    this.requestLayout()
  }

  public setFlex(grow?: number, shrink?: number): void {
    const node = this.layoutNode.yogaNode
    if (grow !== undefined) {
      node.setFlexGrow(grow)
    }
    if (shrink !== undefined) {
      node.setFlexShrink(shrink)
    }
    this.requestLayout()
  }

  public setFlexDirection(direction: FlexDirection): void {
    this.layoutNode.yogaNode.setFlexDirection(direction)
    this.requestLayout()
  }

  public setAlignment(alignItems?: Align, justifyContent?: Justify): void {
    const node = this.layoutNode.yogaNode
    if (alignItems !== undefined) {
      node.setAlignItems(alignItems)
    }
    if (justifyContent !== undefined) {
      node.setJustifyContent(justifyContent)
    }
    this.requestLayout()
  }

  public getComputedLayout() {
    return this.layoutNode.yogaNode.getComputedLayout()
  }

  public updateFromLayout(): void {
    const layout = this.layoutNode.yogaNode.getComputedLayout()
    const positionChanged = this.x !== layout.left || this.y !== layout.top

    if (this.parentLayout) {
      this.x = layout.left
      this.y = layout.top
    }

    const newWidth = Math.max(layout.width, 1)
    const newHeight = Math.max(layout.height, 1)
    const sizeChanged = this.width !== newWidth || this.height !== newHeight

    this.width = newWidth
    this.height = newHeight

    if (sizeChanged) {
      this.onResize(newWidth, newHeight)
    }
    if (sizeChanged || positionChanged) {
      this.needsUpdate = true
    }

    for (let i = 0; i < this.layoutNode.getChildCount(); i++) {
      const childLayoutNode = this.layoutNode.getChildAtIndex(i)
      if (childLayoutNode) {
        const childElement = childLayoutNode.metadata.renderable
        ;(childElement as ILayoutElement).updateFromLayout()
      }
    }
  }

  protected onResize(width: number, height: number): void {
    // Override in subclasses for additional resize logic
  }

  protected requestLayout(): void {
    if (this.parentLayout) {
      this.parentLayout.requestLayout()
    } else {
      this.layoutNode.yogaNode.calculateLayout(this.width, this.height, Direction.LTR)
      this.updateFromLayout()
    }
  }

  public setParentLayout(layout: ILayout | null): void {
    this.parentLayout = layout
    this.getChildren().forEach((child: Renderable) => {
      if (child instanceof LayoutElement) {
        child.setParentLayout(layout)
      }
    })
  }

  public getLayoutNode(): TrackedNode {
    return this.layoutNode
  }

  public setFlexBasis(basis: number | "auto"): void {
    if (basis === "auto") {
      this.layoutNode.yogaNode.setFlexBasisAuto()
    } else {
      this.layoutNode.yogaNode.setFlexBasis(basis)
    }
    this.requestLayout()
  }

  public setWidth(width: number | "auto" | `${number}%`): void {
    this.layoutNode.setWidth(width)
    this.requestLayout()
  }

  public setHeight(height: number | "auto" | `${number}%`): void {
    this.layoutNode.setHeight(height)
    this.requestLayout()
  }

  public setMinWidth(minWidth: number): void {
    this.layoutNode.yogaNode.setMinWidth(minWidth)
    this.requestLayout()
  }

  public setMaxWidth(maxWidth: number): void {
    this.layoutNode.yogaNode.setMaxWidth(maxWidth)
    this.requestLayout()
  }

  public setMinHeight(minHeight: number): void {
    this.layoutNode.yogaNode.setMinHeight(minHeight)
    this.requestLayout()
  }

  public setMaxHeight(maxHeight: number): void {
    this.layoutNode.yogaNode.setMaxHeight(maxHeight)
    this.requestLayout()
  }

  public add(obj: ILayoutElement | Renderable): void {
    super.add(obj)

    if (obj instanceof LayoutElement) {
      const childLayoutNode = obj.getLayoutNode()
      this.layoutNode.addChild(childLayoutNode)
      obj.setParentLayout(this.parentLayout)
      this.requestLayout()
    }
  }

  public remove(id: string): void {
    const obj = this.getRenderable(id) as ILayoutElement

    if (obj instanceof LayoutElement) {
      const childLayoutNode = obj.getLayoutNode()
      this.layoutNode.removeChild(childLayoutNode)
      obj.setParentLayout(null)
      this.requestLayout()
    }

    super.remove(id)
  }

  public getWidth(): number {
    return this.width
  }

  public getHeight(): number {
    return this.height
  }

  protected destroySelf(): void {
    this.layoutNode.destroy()
    super.destroySelf()
  }
}

export abstract class Element extends LayoutElement {
  protected backgroundColor: RGBA
  protected textColor: RGBA
  protected borderStyle: BorderStyle
  protected border: boolean | BorderSides[]
  protected borderColor: RGBA
  protected customBorderChars?: BorderCharacters
  protected focusedBorderColor: RGBA
  protected title?: string
  protected titleAlignment: "left" | "center" | "right"

  protected _needsRefresh: boolean = true
  protected focused: boolean = false
  protected keyHandler: KeyHandler = getKeyHandler()
  protected keypressHandler: ((key: ParsedKey) => void) | null = null

  protected get needsRefresh(): boolean {
    return this._needsRefresh
  }

  protected set needsRefresh(value: boolean) {
    this._needsRefresh = value
    this.needsUpdate = value
  }

  constructor(id: string, options: ElementOptions) {
    super(id, options)

    this.borderStyle = options.borderStyle || "single"
    this.border = options.border || true
    this.customBorderChars = options.customBorderChars
    this.titleAlignment = options.titleAlignment || "left"
    this.title = options.title

    this.backgroundColor = parseColor(options.backgroundColor || "transparent")
    this.textColor = parseColor(options.textColor || "#FFFFFF")
    this.borderColor = parseColor(options.borderColor || "#FFFFFF")
    this.focusedBorderColor = parseColor(options.focusedBorderColor || "#00AAFF")
  }

  public focus(): void {
    if (this.focused) return

    this.focused = true
    this.needsRefresh = true

    this.keypressHandler = (key: ParsedKey) => {
      if (this.handleKeyPress) {
        this.handleKeyPress(key)
      }
    }

    this.keyHandler.on("keypress", this.keypressHandler)
    this.emit(ElementEvents.FOCUSED)
  }

  public blur(): void {
    if (!this.focused) return

    this.focused = false
    this.needsRefresh = true

    if (this.keypressHandler) {
      this.keyHandler.off("keypress", this.keypressHandler)
      this.keypressHandler = null
    }

    this.emit(ElementEvents.BLURRED)
  }

  public isFocused(): boolean {
    return this.focused
  }

  public setTitle(title?: string): void {
    if (this.title !== title) {
      this.title = title
      this.needsRefresh = true
    }
  }

  public getTitle(): string | undefined {
    return this.title
  }

  protected onResize(width: number, height: number): void {
    this.needsRefresh = true
  }

  public handleKeyPress?(key: ParsedKey | string): boolean

  protected destroySelf(): void {
    this.blur()
    this.removeAllListeners()
    super.destroySelf()
  }

  public setBackgroundColor(color: ColorInput): void {
    const newColor = parseColor(color)
    if (this.backgroundColor !== newColor) {
      this.backgroundColor = newColor
      this.needsRefresh = true
    }
  }

  public getBackgroundColor(): RGBA {
    return this.backgroundColor
  }

  public setTextColor(color: ColorInput): void {
    const newColor = parseColor(color)
    if (this.textColor !== newColor) {
      this.textColor = newColor
      this.needsRefresh = true
    }
  }

  public getTextColor(): RGBA {
    return this.textColor
  }

  public setBorder(border: boolean | BorderSides[], borderStyle: BorderStyle): void {
    if (this.border !== border || this.borderStyle !== borderStyle) {
      this.border = border
      this.borderStyle = borderStyle
      this.needsRefresh = true
      this.onBorderChanged?.(border, borderStyle)
    }
  }

  public getBorder(): boolean | BorderSides[] {
    return this.border
  }

  public getBorderStyle(): BorderStyle {
    return this.borderStyle
  }

  protected onBorderChanged?(border: boolean | BorderSides[], borderStyle: BorderStyle): void
}

export abstract class BufferedElement extends Element {
  protected frameBuffer: OptimizedBuffer | null = null

  constructor(id: string, options: ElementOptions) {
    super(id, options)
    this.createFrameBuffer()
  }

  protected createFrameBuffer(): void {
    if (this.width <= 0 || this.height <= 0) {
      this.frameBuffer = null
      return
    }

    try {
      this.frameBuffer = OptimizedBuffer.create(this.width, this.height, {
        respectAlpha: this.backgroundColor.a < 1.0,
      })
    } catch (error) {
      console.error(`Failed to create frame buffer for ${this.id}:`, error)
      this.frameBuffer = null
    }
  }

  protected refreshFrameBuffer(): void {
    if (!this.frameBuffer) return

    this.frameBuffer.clear(this.backgroundColor)

    if (this.border !== false) {
      const currentBorderColor = this.focused ? this.focusedBorderColor : this.borderColor
      drawBorder(this.frameBuffer, {
        x: 0,
        y: 0,
        width: this.width,
        height: this.height,
        borderStyle: this.borderStyle,
        border: this.border,
        borderColor: currentBorderColor,
        backgroundColor: this.backgroundColor,
        customBorderChars: this.customBorderChars,
        title: this.title,
        titleAlignment: this.titleAlignment,
      })
    }

    const hasBorder = this.border !== false
    const contentX = hasBorder ? 1 : 0
    const contentY = hasBorder ? 1 : 0
    const contentWidth = hasBorder ? this.width - 2 : this.width
    const contentHeight = hasBorder ? this.height - 2 : this.height

    this.refreshContent(contentX, contentY, contentWidth, contentHeight)

    this.needsRefresh = false
  }

  protected abstract refreshContent(
    contentX: number,
    contentY: number,
    contentWidth: number,
    contentHeight: number,
  ): void

  protected onResize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      super.onResize(width, height)
      return
    }

    if (this.frameBuffer) {
      this.frameBuffer.resize(width, height)
    } else {
      this.width = width
      this.height = height
      this.createFrameBuffer()
    }

    super.onResize(width, height)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || !this.frameBuffer) return

    if (this.needsRefresh) {
      this.refreshFrameBuffer()
    }

    buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
  }

  protected destroySelf(): void {
    if (this.frameBuffer) {
      this.frameBuffer.destroy()
      this.frameBuffer = null
    }
    super.destroySelf()
  }
}

export class ContainerElement extends Element {
  constructor(id: string, options: ElementOptions & { flexDirection?: FlexDirection }) {
    super(id, {
      ...options,
      backgroundColor: options.backgroundColor || "transparent",
      border: options.border !== undefined ? options.border : false,
    })
  }

  protected refreshContent(contentX: number, contentY: number, contentWidth: number, contentHeight: number): void {
    // Containers typically don't render content themselves, just manage children
    // Override this method in subclasses if you want custom container rendering
  }
}
