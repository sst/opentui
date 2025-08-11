import type { RenderableOptions } from "../Renderable"
import { TextSelectionHelper } from "../lib/selection"
import type { TextFragment } from "../lib/styled-text"
import { RGBA, type SelectionState } from "../types"
import { parseColor } from "../utils"
import { FrameBufferRenderable } from "./FrameBuffer"

export interface StyledTextOptions extends RenderableOptions {
  fragment: TextFragment
  width?: number
  height?: number
  defaultFg?: string | RGBA
  defaultBg?: string | RGBA
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA
  selectable?: boolean
}

export class StyledTextRenderable extends FrameBufferRenderable {
  public selectable: boolean = true
  private _fragment: TextFragment
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

  get fragment(): TextFragment {
    return this._fragment
  }

  set fragment(value: TextFragment) {
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
