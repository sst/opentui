import type { StyledText } from "./lib/styled-text"
import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type LineInfo, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import { type WidthMethod, type Highlight } from "./types"
import type { SyntaxStyle } from "./syntax-style"

export interface TextChunk {
  __isChunk: true
  text: string
  fg?: RGBA
  bg?: RGBA
  attributes?: number
}

export class TextBuffer {
  private lib: RenderLib
  private bufferPtr: Pointer
  private _length: number = 0
  private _byteSize: number = 0
  private _lineInfo?: LineInfo
  private _destroyed: boolean = false
  private _syntaxStyle?: SyntaxStyle
  private _textBytes?: Uint8Array
  private _memId?: number

  constructor(lib: RenderLib, ptr: Pointer) {
    this.lib = lib
    this.bufferPtr = ptr
  }

  static create(widthMethod: WidthMethod): TextBuffer {
    const lib = resolveRenderLib()
    return lib.createTextBuffer(widthMethod)
  }

  // Fail loud and clear
  // Instead of trying to return values that could work or not,
  // this at least will show a stack trace to know where the call to a destroyed TextBuffer was made
  private guard(): void {
    if (this._destroyed) throw new Error("TextBuffer is destroyed")
  }

  public setText(text: string): void {
    this.guard()
    this._textBytes = this.lib.encoder.encode(text)

    if (this._memId === undefined) {
      this._memId = this.lib.textBufferRegisterMemBuffer(this.bufferPtr, this._textBytes, false)
    } else {
      this.lib.textBufferReplaceMemBuffer(this.bufferPtr, this._memId, this._textBytes, false)
    }

    this.lib.textBufferSetTextFromMem(this.bufferPtr, this._memId)
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr)
    this._lineInfo = undefined
  }

  public loadFile(path: string): void {
    this.guard()
    const success = this.lib.textBufferLoadFile(this.bufferPtr, path)
    if (!success) {
      throw new Error(`Failed to load file: ${path}`)
    }
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr)
    this._lineInfo = undefined
    this._textBytes = undefined
  }

  public setStyledText(text: StyledText): void {
    this.guard()

    // Convert StyledText chunks to the format expected by the native layer
    const chunks = text.chunks.map((chunk) => ({
      text: chunk.text,
      fg: chunk.fg || null,
      bg: chunk.bg || null,
      attributes: chunk.attributes ?? 0,
    }))

    // Call the native implementation which handles width calculation correctly
    this.lib.textBufferSetStyledText(this.bufferPtr, chunks)

    // Update cached length and line info
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr)
    this._lineInfo = undefined
  }

  public setDefaultFg(fg: RGBA | null): void {
    this.guard()
    this.lib.textBufferSetDefaultFg(this.bufferPtr, fg)
  }

  public setDefaultBg(bg: RGBA | null): void {
    this.guard()
    this.lib.textBufferSetDefaultBg(this.bufferPtr, bg)
  }

  public setDefaultAttributes(attributes: number | null): void {
    this.guard()
    this.lib.textBufferSetDefaultAttributes(this.bufferPtr, attributes)
  }

  public resetDefaults(): void {
    this.guard()
    this.lib.textBufferResetDefaults(this.bufferPtr)
  }

  public get length(): number {
    this.guard()
    return this._length
  }

  public get byteSize(): number {
    this.guard()
    return this._byteSize
  }

  public get ptr(): Pointer {
    this.guard()
    return this.bufferPtr
  }

  public getPlainText(): string {
    this.guard()
    if (this._byteSize === 0) return ""
    // Use byteSize for accurate buffer allocation (includes newlines in byte count)
    const plainBytes = this.lib.getPlainTextBytes(this.bufferPtr, this._byteSize)

    if (!plainBytes) return ""

    return this.lib.decoder.decode(plainBytes)
  }

  /**
   * Add a highlight using character offsets into the full text.
   */
  public addHighlightByCharRange(
    charStart: number,
    charEnd: number,
    highlight: Omit<Highlight, "colStart" | "colEnd">,
  ): void {
    this.guard()
    this.lib.textBufferAddHighlightByCharRange(this.bufferPtr, charStart, charEnd, highlight)
  }

  /**
   * Add a highlight to a specific line by column positions.
   */
  public addHighlight(lineIdx: number, highlight: Highlight): void {
    this.guard()
    this.lib.textBufferAddHighlight(this.bufferPtr, lineIdx, highlight)
  }

  public removeHighlightsByRef(hlRef: number): void {
    this.guard()
    this.lib.textBufferRemoveHighlightsByRef(this.bufferPtr, hlRef)
  }

  public clearLineHighlights(lineIdx: number): void {
    this.guard()
    this.lib.textBufferClearLineHighlights(this.bufferPtr, lineIdx)
  }

  public clearAllHighlights(): void {
    this.guard()
    this.lib.textBufferClearAllHighlights(this.bufferPtr)
  }

  public getLineHighlights(
    lineIdx: number,
  ): Array<{ colStart: number; colEnd: number; styleId: number; priority: number; hlRef: number | null }> {
    this.guard()
    return this.lib.textBufferGetLineHighlights(this.bufferPtr, lineIdx)
  }

  public setSyntaxStyle(style: SyntaxStyle | null): void {
    this.guard()
    this._syntaxStyle = style ?? undefined
    this.lib.textBufferSetSyntaxStyle(this.bufferPtr, style?.ptr ?? null)
  }

  public getSyntaxStyle(): SyntaxStyle | null {
    this.guard()
    return this._syntaxStyle ?? null
  }

  public clear(): void {
    this.guard()
    this.lib.textBufferClear(this.bufferPtr)
    this._length = 0
    this._byteSize = 0
    this._lineInfo = undefined
    this._textBytes = undefined
    // Note: _memId is NOT cleared - it can be reused for next setText
  }

  public reset(): void {
    this.guard()
    this.lib.textBufferReset(this.bufferPtr)
    this._length = 0
    this._byteSize = 0
    this._lineInfo = undefined
    this._textBytes = undefined
    this._memId = undefined // Reset clears the registry, so clear our ID
  }

  public destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.lib.destroyTextBuffer(this.bufferPtr)
  }
}
