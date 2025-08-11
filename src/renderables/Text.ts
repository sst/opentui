import { type RenderableOptions, Renderable } from "../Renderable"
import type { OptimizedBuffer } from "../buffer"
import { TextSelectionHelper } from "../lib/selection"
import { RGBA, type SelectionState } from "../types"
import { parseColor } from "../utils"

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

    // TODO: Figure out the element width based on the content
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
