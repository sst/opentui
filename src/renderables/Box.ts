import { type RenderableOptions, Renderable, Edge } from "../Renderable"
import type { OptimizedBuffer } from "../buffer"
import { RGBA } from "../types"
import {
  type BorderStyle,
  type BorderSides,
  type BorderCharacters,
  type BorderSidesConfig,
  BorderChars,
  getBorderSides,
  drawBorder,
} from "../lib"
import { parseColor } from "../utils"
import type { ColorInput } from "../types"

export interface BoxOptions extends RenderableOptions {
  bg?: string | RGBA
  borderStyle?: BorderStyle
  border?: boolean | BorderSides[]
  borderColor?: string | RGBA
  customBorderChars?: BorderCharacters
  shouldFill?: boolean
  title?: string
  titleAlignment?: "left" | "center" | "right"
  focusedBorderColor?: ColorInput
}

export class BoxRenderable extends Renderable {
  protected _bg: RGBA
  protected _border: boolean | BorderSides[]
  protected _borderStyle: BorderStyle
  protected _borderColor: RGBA
  protected _focusedBorderColor: RGBA
  protected customBorderChars: BorderCharacters
  protected borderSides: BorderSidesConfig
  public shouldFill: boolean
  protected _title?: string
  protected _titleAlignment: "left" | "center" | "right"

  constructor(id: string, options: BoxOptions) {
    super(id, options)

    this._bg = parseColor(options.bg || "transparent")
    this._border = options.border ?? true
    this._borderStyle = options.borderStyle || "single"
    this._borderColor = parseColor(options.borderColor || "#FFFFFF")
    this._focusedBorderColor = parseColor(options.focusedBorderColor || "#00AAFF")
    this.customBorderChars = options.customBorderChars || BorderChars[this._borderStyle]
    this.borderSides = getBorderSides(this._border)
    this.shouldFill = options.shouldFill ?? true
    this._title = options.title
    this._titleAlignment = options.titleAlignment || "left"

    this.applyYogaBorders()
  }

  public get bg(): RGBA {
    return this._bg
  }

  public set bg(value: RGBA | string | undefined) {
    if (value) {
      const newColor = parseColor(value)
      if (this._bg !== newColor) {
        this._bg = newColor
        this.needsUpdate()
      }
    }
  }

  public get border(): boolean | BorderSides[] {
    return this._border
  }

  public set border(value: boolean | BorderSides[]) {
    if (this._border !== value) {
      this._border = value
      this.borderSides = getBorderSides(value)
      this.applyYogaBorders()
      this.needsUpdate()
    }
  }

  public get borderStyle(): BorderStyle {
    return this._borderStyle
  }

  public set borderStyle(value: BorderStyle) {
    if (this._borderStyle !== value) {
      this._borderStyle = value
      this.customBorderChars = BorderChars[this._borderStyle]
      this.needsUpdate()
    }
  }

  public get borderColor(): RGBA {
    return this._borderColor
  }

  public set borderColor(value: RGBA | string) {
    const newColor = parseColor(value)
    if (this._borderColor !== newColor) {
      this._borderColor = newColor
      this.needsUpdate()
    }
  }

  public get focusedBorderColor(): RGBA {
    return this._focusedBorderColor
  }

  public set focusedBorderColor(value: RGBA | string) {
    const newColor = parseColor(value)
    if (this._focusedBorderColor !== newColor) {
      this._focusedBorderColor = newColor
      if (this._focused) {
        this.needsUpdate()
      }
    }
  }

  public get title(): string | undefined {
    return this._title
  }

  public set title(value: string | undefined) {
    if (this._title !== value) {
      this._title = value
      this.needsUpdate()
    }
  }

  public get titleAlignment(): "left" | "center" | "right" {
    return this._titleAlignment
  }

  public set titleAlignment(value: "left" | "center" | "right") {
    if (this._titleAlignment !== value) {
      this._titleAlignment = value
      this.needsUpdate()
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const startX = Math.max(0, this.x)
    const startY = Math.max(0, this.y)
    const endX = Math.min(buffer.getWidth() - 1, this.x + this.width - 1)
    const endY = Math.min(buffer.getHeight() - 1, this.y + this.height - 1)

    if (this.shouldFill) {
      if (this._border === false) {
        buffer.fillRect(startX, startY, endX - startX + 1, endY - startY + 1, this._bg)
      } else {
        const innerStartX = startX + (this.borderSides.left ? 1 : 0)
        const innerStartY = startY + (this.borderSides.top ? 1 : 0)
        const innerEndX = endX - (this.borderSides.right ? 1 : 0)
        const innerEndY = endY - (this.borderSides.bottom ? 1 : 0)

        if (innerEndX >= innerStartX && innerEndY >= innerStartY) {
          buffer.fillRect(innerStartX, innerStartY, innerEndX - innerStartX + 1, innerEndY - innerStartY + 1, this._bg)
        }
      }
    }

    if (this._border !== false) {
      const currentBorderColor = this._focused ? this._focusedBorderColor : this._borderColor
      drawBorder(buffer, {
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
        borderStyle: this._borderStyle,
        border: this._border,
        borderColor: currentBorderColor,
        backgroundColor: this._bg,
        customBorderChars: this.customBorderChars,
        title: this._title,
        titleAlignment: this._titleAlignment,
      })
    }
  }

  private applyYogaBorders(): void {
    const node = this.layoutNode.yogaNode
    node.setBorder(Edge.Left, this.borderSides.left ? 1 : 0)
    node.setBorder(Edge.Right, this.borderSides.right ? 1 : 0)
    node.setBorder(Edge.Top, this.borderSides.top ? 1 : 0)
    node.setBorder(Edge.Bottom, this.borderSides.bottom ? 1 : 0)
    this.requestLayout()
  }
}
