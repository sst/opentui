import { Renderable } from "./Renderable"

import {
  type RenderableOptions,
  Fragment,
  type SelectionState,
} from "."
import { OptimizedBuffer } from "./buffer"
import { RGBA } from "./types"
import { parseColor } from "./utils"
import { ASCIIFontSelectionHelper, TextSelectionHelper } from "./selection"
import {
  renderFontToFrameBuffer,
  measureText,
  getCharacterPositions,
  type fonts,
} from "./ui/ascii.font"

export interface TextOptions extends RenderableOptions {
  content: string
  fg?: string | RGBA
  bg?: string | RGBA
  attributes?: number
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
    if (this._content === value) {
      return
    }
    this._content = sanitizeText(value, this.tabStopWidth)

    // TODO: Fogure out the element width based on the content
    // including wrapping etc. The check here exists so it doesn't unnecessarily
    // trigger a layout update.
    if (this._content.length !== this.minWidth) {
      this.minWidth = this._content.length
    }

    this.height = 1
    const changed = this.selectionHelper.reevaluateSelection(this.width)
    if (changed) {
      this.needsUpdate()
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
      this.needsUpdate()
    }
  }

  set bg(value: RGBA | string | undefined) {
    if (value) {
      this._bg = parseColor(value)
      this.needsUpdate()
    }
  }

  set content(value: string) {
    this.setContent(value)
    this.needsUpdate()
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
      this.needsUpdate()
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

export interface FrameBufferOptions extends RenderableOptions {
  width: number
  height: number
  respectAlpha?: boolean
}

export class FrameBufferRenderable extends Renderable {
  public frameBuffer: OptimizedBuffer
  protected respectAlpha: boolean

  constructor(id: string, options: FrameBufferOptions) {
    super(id, options)
    this.respectAlpha = options.respectAlpha || false
    this.frameBuffer = OptimizedBuffer.create(options.width, options.height, {
      respectAlpha: this.respectAlpha,
    })
  }

  protected onResize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid resize dimensions for FrameBufferRenderable ${this.id}: ${width}x${height}`)
    }

    this.frameBuffer.resize(width, height)
    super.onResize(width, height)
    this.needsUpdate()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return
    buffer.drawFrameBuffer(this.x, this.y, this.frameBuffer)
  }

  protected destroySelf(): void {
    this.frameBuffer.destroy()
    super.destroySelf()
  }
}

export class GroupRenderable extends Renderable {
  constructor(id: string, options: Omit<RenderableOptions, "width" | "height">) {
    super(id, { ...options, width: 0, height: 0 })
  }
}

export interface StyledTextOptions extends RenderableOptions {
  fragment: Fragment
  width?: number
  height?: number
  defaultFg?: string | RGBA
  defaultBg?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
}

export interface ASCIIFontOptions extends RenderableOptions {
  text: string
  font?: "tiny" | "block" | "shade" | "slick"
  fg?: RGBA | RGBA[]
  bg?: RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
}

export class StyledTextRenderable extends FrameBufferRenderable {
  public selectable: boolean = true
  private _fragment: Fragment
  private _defaultFg: RGBA
  private _defaultBg: RGBA
  private _selectionBg: RGBA | undefined
  private _selectionFg: RGBA | undefined

  private selectionHelper: TextSelectionHelper

  private _plainText: string = ""
  private _lineInfo: { lineStarts: number[]; lineWidths: number[] } = { lineStarts: [], lineWidths: [] }

  constructor(id: string, options: StyledTextOptions) {
    super(id, {
      ...options,
      width: options.width || 1,
      height: options.height || 1,
      respectAlpha: true,
    })

    this.selectionHelper = new TextSelectionHelper(
      () => this.x,
      () => this.y,
      () => this._plainText.length,
      () => this._lineInfo,
    )

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
    this.needsUpdate()
  }

  get defaultFg(): RGBA {
    return this._defaultFg
  }

  set defaultFg(value: RGBA | string | undefined) {
    if (value) {
      this._defaultFg = parseColor(value)
      this.renderFragmentToBuffer()
      this.needsUpdate()
    }
  }

  get defaultBg(): RGBA {
    return this._defaultBg
  }

  set defaultBg(value: RGBA | string | undefined) {
    if (value) {
      this._defaultBg = parseColor(value)
      this.renderFragmentToBuffer()
      this.needsUpdate()
    }
  }

  protected onResize(width: number, height: number): void {
    super.onResize(width, height)
    this.renderFragmentToBuffer()
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
      this.needsUpdate()
    }
  }

  shouldStartSelection(x: number, y: number): boolean {
    return this.selectionHelper.shouldStartSelection(x, y, this.width, this.height)
  }

  onSelectionChanged(selection: SelectionState | null): boolean {
    const changed = this.selectionHelper.onSelectionChanged(selection, this.width, this.height)
    if (changed) {
      this.renderFragmentToBuffer()
      this.needsUpdate()
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
}

export class ASCIIFontRenderable extends FrameBufferRenderable {
  public selectable: boolean = true
  private _text: string
  private _font: keyof typeof fonts
  private _fg: RGBA[]
  private _bg: RGBA
  private _selectionBg: RGBA | undefined
  private _selectionFg: RGBA | undefined

  private selectionHelper: ASCIIFontSelectionHelper

  constructor(id: string, options: ASCIIFontOptions) {
    const font = options.font || "tiny"
    const measurements = measureText({ text: options.text, font })

    super(id, {
      ...options,
      width: measurements.width,
      height: measurements.height,
      respectAlpha: true,
    })

    this._text = options.text
    this._font = font
    this._fg = Array.isArray(options.fg) ? options.fg : [options.fg || RGBA.fromInts(255, 255, 255, 255)]
    this._bg = options.bg || RGBA.fromValues(0, 0, 0, 0)
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : undefined
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : undefined
    this.selectable = options.selectable ?? true

    this.selectionHelper = new ASCIIFontSelectionHelper(
      () => this.x,
      () => this.y,
      () => this._text,
      () => this._font,
    )

    this.renderFontToBuffer()
  }

  get text(): string {
    return this._text
  }

  set text(value: string) {
    this._text = value
    this.updateDimensions()
    this.selectionHelper.reevaluateSelection(this.width, this.height)
    this.renderFontToBuffer()
    this.needsUpdate()
  }

  get font(): keyof typeof fonts {
    return this._font
  }

  set font(value: keyof typeof fonts) {
    this._font = value
    this.updateDimensions()
    this.selectionHelper.reevaluateSelection(this.width, this.height)
    this.renderFontToBuffer()
    this.needsUpdate()
  }

  get fg(): RGBA[] {
    return this._fg
  }

  set fg(value: RGBA | RGBA[] | string | string[]) {
    if (Array.isArray(value)) {
      this._fg = value.map((color) => (typeof color === "string" ? parseColor(color) : color))
    } else {
      this._fg = [typeof value === "string" ? parseColor(value) : value]
    }
    this.renderFontToBuffer()
    this.needsUpdate()
  }

  get bg(): RGBA {
    return this._bg
  }

  set bg(value: RGBA | string) {
    this._bg = typeof value === "string" ? parseColor(value) : value
    this.renderFontToBuffer()
    this.needsUpdate()
  }

  private updateDimensions(): void {
    const measurements = measureText({ text: this._text, font: this._font })
    this.width = measurements.width
    this.height = measurements.height
  }

  shouldStartSelection(x: number, y: number): boolean {
    return this.selectionHelper.shouldStartSelection(x, y, this.width, this.height)
  }

  onSelectionChanged(selection: SelectionState | null): boolean {
    const changed = this.selectionHelper.onSelectionChanged(selection, this.width, this.height)
    if (changed) {
      this.renderFontToBuffer()
      this.needsUpdate()
    }
    return this.selectionHelper.hasSelection()
  }

  getSelectedText(): string {
    const selection = this.selectionHelper.getSelection()
    if (!selection) return ""
    return this._text.slice(selection.start, selection.end)
  }

  hasSelection(): boolean {
    return this.selectionHelper.hasSelection()
  }

  protected onResize(width: number, height: number): void {
    super.onResize(width, height)
    this.renderFontToBuffer()
  }

  private renderFontToBuffer(): void {
    this.frameBuffer.clear(this._bg)

    renderFontToFrameBuffer(this.frameBuffer, {
      text: this._text,
      x: 0,
      y: 0,
      fg: this._fg,
      bg: this._bg,
      font: this._font,
    })

    const selection = this.selectionHelper.getSelection()
    if (selection && (this._selectionBg || this._selectionFg)) {
      this.renderSelectionHighlight(selection)
    }
  }

  private renderSelectionHighlight(selection: { start: number; end: number }): void {
    if (!this._selectionBg && !this._selectionFg) return

    const selectedText = this._text.slice(selection.start, selection.end)
    if (!selectedText) return

    const positions = getCharacterPositions(this._text, this._font)
    const startX = positions[selection.start] || 0
    const endX =
      selection.end < positions.length
        ? positions[selection.end]
        : measureText({ text: this._text, font: this._font }).width

    if (this._selectionBg) {
      this.frameBuffer.fillRect(startX, 0, endX - startX, this.height, this._selectionBg)
    }

    if (this._selectionFg || this._selectionBg) {
      renderFontToFrameBuffer(this.frameBuffer, {
        text: selectedText,
        x: startX,
        y: 0,
        fg: this._selectionFg ? [this._selectionFg] : this._fg,
        bg: this._selectionBg || this._bg,
        font: this._font,
      })
    }
  }
}
