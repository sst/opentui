import { Edge } from "yoga-layout"
import { type RenderableOptions, Renderable } from "../Renderable"
import type { OptimizedBuffer } from "../buffer"
import {
  type BorderCharacters,
  type BorderSides,
  type BorderSidesConfig,
  type BorderStyle,
  borderCharsToArray,
  getBorderSides,
} from "../lib"
import { type ColorInput, RGBA, parseColor } from "../lib/RGBA"
import type { RenderContext } from "../types"

export interface BoxOptions extends RenderableOptions<BoxRenderable> {
  backgroundColor?: string | RGBA
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
  protected _backgroundColor: RGBA
  protected _border: boolean | BorderSides[]
  protected _borderStyle: BorderStyle
  protected _borderColor: RGBA
  protected _focusedBorderColor: RGBA
  private _customBorderCharsObj: BorderCharacters | undefined
  protected _customBorderChars?: Uint32Array
  protected borderSides: BorderSidesConfig
  public shouldFill: boolean
  protected _title?: string
  protected _titleAlignment: "left" | "center" | "right"

  protected _defaultOptions = {
    backgroundColor: "transparent",
    borderStyle: "single",
    border: false,
    borderColor: "#FFFFFF",
    shouldFill: true,
    titleAlignment: "left",
    focusedBorderColor: "#00AAFF",
  } satisfies Partial<BoxOptions>

  constructor(ctx: RenderContext, options: BoxOptions) {
    super(ctx, options)

    this._backgroundColor = parseColor(options.backgroundColor || this._defaultOptions.backgroundColor)
    this._border = options.border ?? this._defaultOptions.border
    this._borderStyle = options.borderStyle || this._defaultOptions.borderStyle
    this._borderColor = parseColor(options.borderColor || this._defaultOptions.borderColor)
    this._focusedBorderColor = parseColor(options.focusedBorderColor || this._defaultOptions.focusedBorderColor)
    this._customBorderCharsObj = options.customBorderChars
    this._customBorderChars = this._customBorderCharsObj ? borderCharsToArray(this._customBorderCharsObj) : undefined
    this.borderSides = getBorderSides(this._border)
    this.shouldFill = options.shouldFill ?? this._defaultOptions.shouldFill
    this._title = options.title
    this._titleAlignment = options.titleAlignment || this._defaultOptions.titleAlignment

    this.applyYogaBorders()
  }

  public get customBorderChars(): BorderCharacters | undefined {
    return this._customBorderCharsObj
  }

  public set customBorderChars(value: BorderCharacters | undefined) {
    this._customBorderCharsObj = value
    this._customBorderChars = value ? borderCharsToArray(value) : undefined
    this.needsUpdate()
  }

  public get backgroundColor(): RGBA {
    return this._backgroundColor
  }

  public set backgroundColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? this._defaultOptions.backgroundColor)
    if (this._backgroundColor !== newColor) {
      this._backgroundColor = newColor
      this.needsUpdate()
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
    let _value = value ?? this._defaultOptions.borderStyle
    if (this._borderStyle !== _value) {
      this._borderStyle = _value
      this._customBorderChars = undefined
      this.needsUpdate()
    }
  }

  public get borderColor(): RGBA {
    return this._borderColor
  }

  public set borderColor(value: RGBA | string) {
    const newColor = parseColor(value ?? this._defaultOptions.borderColor)
    if (this._borderColor !== newColor) {
      this._borderColor = newColor
      this.needsUpdate()
    }
  }

  public get focusedBorderColor(): RGBA {
    return this._focusedBorderColor
  }

  public set focusedBorderColor(value: RGBA | string) {
    const newColor = parseColor(value ?? this._defaultOptions.focusedBorderColor)
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
    const currentBorderColor = this._focused ? this._focusedBorderColor : this._borderColor

    buffer.drawBox({
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      borderStyle: this._borderStyle,
      customBorderChars: this._customBorderChars,
      border: this._border,
      borderColor: currentBorderColor,
      backgroundColor: this._backgroundColor,
      shouldFill: this.shouldFill,
      title: this._title,
      titleAlignment: this._titleAlignment,
    })
  }

  private applyYogaBorders(): void {
    const node = this.layoutNode.yogaNode
    node.setBorder(Edge.Left, this.borderSides.left ? 1 : 0)
    node.setBorder(Edge.Right, this.borderSides.right ? 1 : 0)
    node.setBorder(Edge.Top, this.borderSides.top ? 1 : 0)
    node.setBorder(Edge.Bottom, this.borderSides.bottom ? 1 : 0)
    this.needsUpdate()
  }
}
