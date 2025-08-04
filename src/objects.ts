import { Renderable } from "./Renderable"

import {
  BorderChars,
  drawBorder,
  getBorderSides,
  type BorderCharacters,
  type BorderSides,
  type BorderStyle,
  type BorderSidesConfig,
  type RenderableOptions,
  Fragment,
  type SelectionState,
} from "."
import type { OptimizedBuffer } from "./buffer"
import { RGBA } from "./types"
import { parseColor } from "./utils"
import { TextSelectionHelper } from "./selection"

export interface TextOptions {
  content: string
  x: number
  y: number
  zIndex: number
  fg?: string | RGBA
  bg?: string | RGBA
  attributes?: number
  visible?: boolean
  tabStopWidth?: number
  selectable?: boolean
}

export function sanitizeText(text: string, tabStopWidth: number): string {
  return text.replace(/\t/g, " ".repeat(tabStopWidth))
}

export class TextRenderable extends Renderable {
  public selectable: boolean = true
  private _content: string = ""
  private _fg: RGBA
  private _bg: RGBA
  public attributes: number = 0
  public tabStopWidth: number = 2
  private selectionHelper: TextSelectionHelper

  constructor(id: string, options: TextOptions) {
    super(id, { ...options, width: 0, height: 0 })

    const fgRgb = parseColor(options.fg || RGBA.fromInts(255, 255, 255, 255))

    this.selectionHelper = new TextSelectionHelper(
      () => this.x,
      () => this.y,
      () => this._content.length,
    )

    this.tabStopWidth = options.tabStopWidth || 2
    this.setContent(options.content)
    this._fg = fgRgb
    this._bg = options.bg !== undefined ? parseColor(options.bg) : RGBA.fromValues(0, 0, 0, 0)
    this.attributes = options.attributes || 0
    this.selectable = options.selectable ?? true
  }

  private setContent(value: string) {
    this._content = sanitizeText(value, this.tabStopWidth)
    this.width = this._content.length
    this.height = 1
    const changed = this.selectionHelper.reevaluateSelection(this.width)
    if (changed) {
      this.needsUpdate = true
    }
  }

  get fg(): RGBA {
    return this._fg
  }

  get bg(): RGBA {
    return this._bg
  }

  set fg(value: RGBA | string | undefined) {
    if (value) {
      this._fg = parseColor(value)
      this.needsUpdate = true
    }
  }

  set bg(value: RGBA | string | undefined) {
    if (value) {
      this._bg = parseColor(value)
      this.needsUpdate = true
    }
  }

  set content(value: string) {
    this.setContent(value)
    this.needsUpdate = true
  }

  get content(): string {
    return this._content
  }

  shouldStartSelection(x: number, y: number): boolean {
    return this.selectionHelper.shouldStartSelection(x, y, this.width, this.height)
  }

  onSelectionChanged(selection: SelectionState | null): boolean {
    const changed = this.selectionHelper.onSelectionChanged(selection, this.width)
    if (changed) {
      this.needsUpdate = true
    }
    return this.selectionHelper.hasSelection()
  }

  getSelectedText(): string {
    const selection = this.selectionHelper.getSelection()
    if (!selection) return ""
    return this._content.slice(selection.start, selection.end)
  }

  hasSelection(): boolean {
    return this.selectionHelper.hasSelection()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const selection = this.selectionHelper.getSelection()
    buffer.drawText(this._content, this.x, this.y, this._fg, this._bg, this.attributes, selection)
  }
}

export interface BoxOptions {
  x: number
  y: number
  width: number
  height: number
  bg: string | RGBA
  zIndex: number
  borderStyle?: BorderStyle
  border?: boolean | BorderSides[]
  borderColor?: string | RGBA
  customBorderChars?: BorderCharacters
  shouldFill?: boolean
  visible?: boolean
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

    this.width = options.width
    this.height = options.height
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
    this.needsUpdate = true
  }

  public set borderStyle(value: BorderStyle) {
    this._borderStyle = value
    this.customBorderChars = BorderChars[this._borderStyle]
    this.needsUpdate = true
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (
      this.x >= buffer.getWidth() ||
      this.y >= buffer.getHeight() ||
      this.x + this.width <= 0 ||
      this.y + this.height <= 0
    ) {
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

export interface FrameBufferOptions {
  width: number
  height: number
  x: number
  y: number
  zIndex: number
  respectAlpha?: boolean
}

export class FrameBufferRenderable extends Renderable {
  public frameBuffer: OptimizedBuffer

  constructor(id: string, buffer: OptimizedBuffer, options: FrameBufferOptions) {
    super(id, options)
    this.frameBuffer = buffer
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
  }

  protected destroySelf(): void {
    this.frameBuffer.destroy()
  }
}

export class GroupRenderable extends Renderable {
  constructor(id: string, options: Omit<RenderableOptions, "width" | "height">) {
    super(id, { ...options, width: 0, height: 0 })
  }
}

export interface StyledTextOptions {
  fragment: Fragment
  width: number
  height: number
  x: number
  y: number
  zIndex: number
  defaultFg?: string | RGBA
  defaultBg?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  visible?: boolean
  selectable?: boolean
}

export class StyledTextRenderable extends Renderable {
  public selectable: boolean = true
  public frameBuffer: OptimizedBuffer
  private _fragment: Fragment
  private _defaultFg: RGBA
  private _defaultBg: RGBA
  private _selectionBg: RGBA | undefined
  private _selectionFg: RGBA | undefined

  private selectionHelper: TextSelectionHelper

  private _plainText: string = ""
  private _lineInfo: { lineStarts: number[]; lineWidths: number[] } = { lineStarts: [], lineWidths: [] }

  constructor(id: string, buffer: OptimizedBuffer, options: StyledTextOptions) {
    super(id, options)

    this.selectionHelper = new TextSelectionHelper(
      () => this.x,
      () => this.y,
      () => this._plainText.length,
      () => this._lineInfo,
    )

    this.frameBuffer = buffer
    this._fragment = options.fragment
    this._defaultFg = options.defaultFg ? parseColor(options.defaultFg) : RGBA.fromValues(1, 1, 1, 1)
    this._defaultBg = options.defaultBg ? parseColor(options.defaultBg) : RGBA.fromValues(0, 0, 0, 0)
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : undefined
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : undefined
    this.selectable = options.selectable ?? true

    this.updateTextInfo()
    this.renderFragmentToBuffer()
  }

  get fragment(): Fragment {
    return this._fragment
  }

  set fragment(value: Fragment) {
    this._fragment = value
    this.updateTextInfo()
    this.renderFragmentToBuffer()
    this.needsUpdate = true
  }

  get defaultFg(): RGBA {
    return this._defaultFg
  }

  set defaultFg(value: RGBA | string | undefined) {
    if (value) {
      this._defaultFg = parseColor(value)
      this.renderFragmentToBuffer()
      this.needsUpdate = true
    }
  }

  get defaultBg(): RGBA {
    return this._defaultBg
  }

  set defaultBg(value: RGBA | string | undefined) {
    if (value) {
      this._defaultBg = parseColor(value)
      this.renderFragmentToBuffer()
      this.needsUpdate = true
    }
  }

  private updateTextInfo(): void {
    this._plainText = this._fragment.toString()

    this._lineInfo.lineStarts = [0]
    this._lineInfo.lineWidths = []

    let currentLineWidth = 0
    for (let i = 0; i < this._plainText.length; i++) {
      if (this._plainText[i] === "\n") {
        this._lineInfo.lineWidths.push(currentLineWidth)
        this._lineInfo.lineStarts.push(i + 1)
        currentLineWidth = 0
      } else {
        currentLineWidth++
      }
    }
    this._lineInfo.lineWidths.push(currentLineWidth)

    const changed = this.selectionHelper.reevaluateSelection(this.width, this.height)
    if (changed) {
      this.renderFragmentToBuffer()
      this.needsUpdate = true
    }
  }

  shouldStartSelection(x: number, y: number): boolean {
    return this.selectionHelper.shouldStartSelection(x, y, this.width, this.height)
  }

  onSelectionChanged(selection: SelectionState | null): boolean {
    const changed = this.selectionHelper.onSelectionChanged(selection, this.width, this.height)
    if (changed) {
      this.renderFragmentToBuffer()
      this.needsUpdate = true
    }
    return this.selectionHelper.hasSelection()
  }

  getSelectedText(): string {
    const selection = this.selectionHelper.getSelection()
    if (!selection) return ""
    return this._plainText.slice(selection.start, selection.end)
  }

  hasSelection(): boolean {
    return this.selectionHelper.hasSelection()
  }

  private renderFragmentToBuffer(): void {
    this.frameBuffer.clear(this._defaultBg)

    const selection = this.selectionHelper.getSelection()
    this.frameBuffer.drawStyledTextFragment(
      this._fragment,
      0,
      0,
      this._defaultFg,
      this._defaultBg,
      selection ? { ...selection, bgColor: this._selectionBg, fgColor: this._selectionFg } : undefined,
    )
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
  }

  protected destroySelf(): void {
    this.frameBuffer.destroy()
  }
}
