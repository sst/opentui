import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable"
import { RGBA } from "../lib/RGBA"
import type { RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { resolveRenderLib, type RenderLib } from "../zig"
import { vtermDataToStyledText, type VTermData } from "../lib/vterm-ffi"

// Re-export types from vterm-ffi for backwards compatibility
export {
  VTermStyleFlags,
  type VTermSpan,
  type VTermLine,
  type VTermData,
  vtermDataToStyledText,
} from "../lib/vterm-ffi"

const DEFAULT_FG = RGBA.fromHex("#d4d4d4")

function trimEmptyLines(data: VTermData): void {
  while (data.lines.length > 0) {
    const lastLine = data.lines[data.lines.length - 1]
    const hasText = lastLine.spans.some((span) => span.text.trim().length > 0)
    if (hasText) break
    data.lines.pop()
  }
}

export interface StatelessTerminalOptions extends TextBufferOptions {
  ansi?: string | Buffer
  cols?: number
  rows?: number
  limit?: number
  trimEnd?: boolean
}

export class StatelessTerminalRenderable extends TextBufferRenderable {
  private _ansi: string | Buffer
  private _cols: number
  private _rows: number
  private _limit?: number
  private _trimEnd?: boolean
  private _needsUpdate: boolean = true
  private _lineCount: number = 0
  private _lib: RenderLib

  constructor(ctx: RenderContext, options: StatelessTerminalOptions) {
    super(ctx, { ...options, fg: DEFAULT_FG, wrapMode: "none" })
    this._ansi = options.ansi ?? ""
    this._cols = options.cols ?? 120
    this._rows = options.rows ?? 40
    this._limit = options.limit
    this._trimEnd = options.trimEnd
    this._lib = resolveRenderLib()
  }

  get lineCount(): number {
    return this._lineCount
  }

  get ansi(): string | Buffer {
    return this._ansi
  }

  set ansi(value: string | Buffer) {
    if (this._ansi !== value) {
      this._ansi = value
      this._needsUpdate = true
      this.requestRender()
    }
  }

  get cols(): number {
    return this._cols
  }

  set cols(value: number) {
    if (this._cols !== value) {
      this._cols = value
      this._needsUpdate = true
      this.requestRender()
    }
  }

  get rows(): number {
    return this._rows
  }

  set rows(value: number) {
    if (this._rows !== value) {
      this._rows = value
      this._needsUpdate = true
      this.requestRender()
    }
  }

  get limit(): number | undefined {
    return this._limit
  }

  set limit(value: number | undefined) {
    if (this._limit !== value) {
      this._limit = value
      this._needsUpdate = true
      this.requestRender()
    }
  }

  get trimEnd(): boolean | undefined {
    return this._trimEnd
  }

  set trimEnd(value: boolean | undefined) {
    if (this._trimEnd !== value) {
      this._trimEnd = value
      this._needsUpdate = true
      this.requestRender()
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this._needsUpdate) {
      const data = this._lib.vtermPtyToJson(this._ansi, {
        cols: this._cols,
        rows: this._rows,
        limit: this._limit,
      }) as VTermData

      if (this._trimEnd) trimEmptyLines(data)

      this.textBuffer.setStyledText(vtermDataToStyledText(data))
      this.updateTextInfo()
      this._lineCount = this.textBufferView.logicalLineInfo.lineStarts.length
      this._needsUpdate = false
    }
    super.renderSelf(buffer)
  }

  getScrollPositionForLine(lineNumber: number): number {
    const clampedLine = Math.max(0, Math.min(lineNumber, this._lineCount - 1))
    const lineStarts = this.textBufferView.logicalLineInfo.lineStarts
    const lineYOffset = lineStarts?.[clampedLine] ?? clampedLine
    return this.y + lineYOffset
  }
}
