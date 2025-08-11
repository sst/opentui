import { type RenderableOptions, Renderable } from "../Renderable";
import type { OptimizedBuffer } from "../buffer";
import { RGBA } from "../types";
import { type BorderStyle, type BorderSides, type BorderCharacters, type BorderSidesConfig, BorderChars, getBorderSides, drawBorder } from "../ui";
import { parseColor } from "../utils";


export interface BoxOptions extends RenderableOptions {
  bg: string | RGBA
  borderStyle?: BorderStyle
  border?: boolean | BorderSides[]
  borderColor?: string | RGBA
  customBorderChars?: BorderCharacters
  shouldFill?: boolean
  title?: string
  titleAlignment?: "left" | "center" | "right"
}

export class BoxRenderable extends Renderable {
  public _bg: RGBA
  public _border: boolean | BorderSides[]
  public _borderStyle: BorderStyle
  public borderColor: RGBA
  public customBorderChars: BorderCharacters
  public borderSides: BorderSidesConfig
  public shouldFill: boolean
  public title?: string
  public titleAlignment: "left" | "center" | "right"

  constructor(id: string, options: BoxOptions) {
    super(id, options)

    const bgRgb = parseColor(options.bg)
    const borderRgb = parseColor(options.borderColor || RGBA.fromValues(255, 255, 255, 255))

    this._bg = bgRgb
    this._border = options.border ?? true
    this._borderStyle = options.borderStyle || "single"
    this.borderColor = borderRgb
    this.customBorderChars = options.customBorderChars || BorderChars[this._borderStyle]
    this.borderSides = getBorderSides(this._border)
    this.shouldFill = options.shouldFill !== false
    this.title = options.title
    this.titleAlignment = options.titleAlignment || "left"
  }

  public get bg(): RGBA {
    return this._bg
  }

  public set bg(value: RGBA | string | undefined) {
    if (value) {
      this._bg = parseColor(value)
    }
  }

  public set border(value: boolean | BorderSides[]) {
    this._border = value
    this.borderSides = getBorderSides(value)
    this.needsUpdate()
  }

  public set borderStyle(value: BorderStyle) {
    this._borderStyle = value
    this.customBorderChars = BorderChars[this._borderStyle]
    this.needsUpdate()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this.x >= buffer.getWidth() ||
      this.y >= buffer.getHeight() ||
      this.x + this.width <= 0 ||
      this.y + this.height <= 0) {
      return
    }

    const startX = Math.max(0, this.x)
    const startY = Math.max(0, this.y)
    const endX = Math.min(buffer.getWidth() - 1, this.x + this.width - 1)
    const endY = Math.min(buffer.getHeight() - 1, this.y + this.height - 1)

    if (this.shouldFill) {
      if (this.border === false) {
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

    if (this.border !== false) {
      drawBorder(buffer, {
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height,
        borderStyle: this._borderStyle,
        border: this._border,
        borderColor: this.borderColor,
        backgroundColor: this._bg,
        customBorderChars: this.customBorderChars,
        title: this.title,
        titleAlignment: this.titleAlignment,
      })
    }
  }
}
