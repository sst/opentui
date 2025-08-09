import { Renderable, type RenderableOptions } from "../Renderable"
import type { BorderCharacters, BorderSides, BorderStyle } from "../index"
import { OptimizedBuffer } from "../buffer"
import { parseColor } from "../utils"
import { drawBorder } from "./lib/border"
import type { RGBA, ColorInput } from "../types"
import { FlexDirection } from "yoga-layout"

export interface ElementOptions extends RenderableOptions {
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

export abstract class Element extends Renderable {
  protected _backgroundColor: RGBA
  protected textColor: RGBA
  protected borderStyle: BorderStyle
  protected border: boolean | BorderSides[]
  protected borderColor: RGBA
  protected customBorderChars?: BorderCharacters
  protected focusedBorderColor: RGBA
  protected title?: string
  protected titleAlignment: "left" | "center" | "right"

  protected _needsRefresh: boolean = true

  protected get needsRefresh(): boolean {
    return this._needsRefresh
  }

  protected set needsRefresh(value: boolean) {
    this._needsRefresh = value
    this.needsUpdate()
  }

  constructor(id: string, options: ElementOptions) {
    super(id, options)

    this.borderStyle = options.borderStyle || "single"
    this.border = options.border || true
    this.customBorderChars = options.customBorderChars
    this.titleAlignment = options.titleAlignment || "left"
    this.title = options.title

    this._backgroundColor = parseColor(options.backgroundColor || "transparent")
    this.textColor = parseColor(options.textColor || "#FFFFFF")
    this.borderColor = parseColor(options.borderColor || "#FFFFFF")
    this.focusedBorderColor = parseColor(options.focusedBorderColor || "#00AAFF")
  }

  public focus(): void {
    super.focus()
    this.needsRefresh = true
  }

  public blur(): void {
    super.blur()
    this.needsRefresh = true
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

  protected destroySelf(): void {
    super.destroySelf()
  }

  public set backgroundColor(color: ColorInput) {
    const newColor = parseColor(color)
    if (this._backgroundColor !== newColor) {
      this._backgroundColor = newColor
      this.needsRefresh = true
    }
  }

  public get backgroundColor(): RGBA {
    return this._backgroundColor
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
        respectAlpha: this._backgroundColor.a < 1.0,
      })
    } catch (error) {
      console.error(`Failed to create frame buffer for ${this.id}:`, error)
      this.frameBuffer = null
    }
  }

  protected refreshFrameBuffer(): void {
    if (!this.frameBuffer) return

    this.frameBuffer.clear(this._backgroundColor)

    if (this.border !== false) {
      const currentBorderColor = this._focused ? this.focusedBorderColor : this.borderColor
      drawBorder(this.frameBuffer, {
        x: 0,
        y: 0,
        width: this.width,
        height: this.height,
        borderStyle: this.borderStyle,
        border: this.border,
        borderColor: currentBorderColor,
        backgroundColor: this._backgroundColor,
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
