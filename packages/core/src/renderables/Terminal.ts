import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable"
import { RGBA } from "../lib/RGBA"
import type { RenderContext } from "../types"
import type { OptimizedBuffer } from "../buffer"
import { resolveRenderLib, type RenderLib } from "../zig"
import { vtermDataToStyledText, type VTermData } from "../lib/vterm-ffi"

// Re-export types from vterm-ffi for backwards compatibility
export { VTermStyleFlags, type VTermSpan, type VTermLine, type VTermData, vtermDataToStyledText } from "../lib/vterm-ffi"

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

export interface TerminalOptions extends TextBufferOptions {
  ansi?: string | Buffer
  cols?: number
  rows?: number
  trimEnd?: boolean
}

let nextTerminalId = 1

export class TerminalRenderable extends TextBufferRenderable {
  private _cols: number
  private _rows: number
  private _trimEnd?: boolean
  private _contentDirty: boolean = true
  private _lineCount: number = 0
  private _terminalId: number
  private _lib: RenderLib
  private _destroyed = false

  constructor(ctx: RenderContext, options: TerminalOptions) {
    super(ctx, { ...options, fg: DEFAULT_FG, wrapMode: "none" })

    this._cols = options.cols ?? 120
    this._rows = options.rows ?? 40
    this._trimEnd = options.trimEnd
    this._lib = resolveRenderLib()
    this._terminalId = nextTerminalId++

    const success = this._lib.vtermCreateTerminal(this._terminalId, this._cols, this._rows)
    if (!success) {
      throw new Error("Failed to create terminal")
    }

    const ansi = options.ansi
    if (ansi && (typeof ansi === "string" ? ansi.length > 0 : ansi.length > 0)) {
      this._lib.vtermFeedTerminal(this._terminalId, ansi)
    }
  }

  get lineCount(): number {
    return this._lineCount
  }

  get cols(): number {
    return this._cols
  }

  set cols(value: number) {
    if (this._cols !== value) {
      this._cols = value
      this._lib.vtermResizeTerminal(this._terminalId, value, this._rows)
      this._contentDirty = true
      this.requestRender()
    }
  }

  get rows(): number {
    return this._rows
  }

  set rows(value: number) {
    if (this._rows !== value) {
      this._rows = value
      this._lib.vtermResizeTerminal(this._terminalId, this._cols, value)
      this._contentDirty = true
      this.requestRender()
    }
  }

  get trimEnd(): boolean | undefined {
    return this._trimEnd
  }

  set trimEnd(value: boolean | undefined) {
    if (this._trimEnd !== value) {
      this._trimEnd = value
      this._contentDirty = true
      this.requestRender()
    }
  }

  feed(data: string | Buffer): void {
    this._lib.vtermFeedTerminal(this._terminalId, data)
    this._contentDirty = true
    this.requestRender()
  }

  reset(): void {
    this._lib.vtermResetTerminal(this._terminalId)
    this._contentDirty = true
    this.requestRender()
  }

  getCursor(): [number, number] {
    return this._lib.vtermGetTerminalCursor(this._terminalId)
  }

  getText(): string {
    return this._lib.vtermGetTerminalText(this._terminalId)
  }

  isReady(): boolean {
    return this._lib.vtermIsTerminalReady(this._terminalId)
  }

  destroy(): void {
    if (!this._destroyed) {
      this._destroyed = true
      this._lib.vtermDestroyTerminal(this._terminalId)
    }
    super.destroy()
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this._contentDirty && !this._destroyed) {
      const data = this._lib.vtermGetTerminalJson(this._terminalId, {}) as VTermData

      if (this._trimEnd) trimEmptyLines(data)

      this.textBuffer.setStyledText(vtermDataToStyledText(data))
      this.updateTextInfo()
      this._lineCount = this.textBufferView.logicalLineInfo.lineStarts.length
      this._contentDirty = false
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
