import type { StyledText } from "./lib/styled-text"
import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type LineInfo, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import { type WidthMethod } from "./types"
import type { NativeSyntaxStyle } from "./native-syntax-style"

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
  private _lineInfo?: LineInfo
  private _destroyed: boolean = false
  private _syntaxStyle?: NativeSyntaxStyle
  private _textBytes?: Uint8Array // Keep UTF-8 bytes alive for Zig reference

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
    // Keep UTF-8 bytes alive - Zig stores a reference to this memory
    this._textBytes = this.lib.encoder.encode(text)
    this.lib.textBufferSetText(this.bufferPtr, this._textBytes)
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._lineInfo = undefined
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

  public get ptr(): Pointer {
    this.guard()
    return this.bufferPtr
  }

  public getSelectedText(): string {
    this.guard()
    if (this._length === 0) return ""
    // TODO: The _length should be the text length, need to know the number of bytes for the text though
    const selectedBytes = this.lib.getSelectedTextBytes(this.bufferPtr, this.length * 4)

    if (!selectedBytes) return ""

    return this.lib.decoder.decode(selectedBytes)
  }

  public getPlainText(): string {
    this.guard()
    // Note: _length doesn't count newlines, so we can't use it to determine if buffer is empty
    // Always call getPlainTextBytes to get the actual text (including newlines)
    const plainBytes = this.lib.getPlainTextBytes(this.bufferPtr, Math.max(this.length * 4, 1024))

    if (!plainBytes) return ""

    return this.lib.decoder.decode(plainBytes)
  }

  public get lineInfo(): LineInfo {
    this.guard()
    if (!this._lineInfo) {
      this._lineInfo = this.lib.textBufferGetLineInfo(this.bufferPtr)
    }
    return this._lineInfo
  }

  public setSelection(start: number, end: number, bgColor?: RGBA, fgColor?: RGBA): void {
    this.guard()
    this.lib.textBufferSetSelection(this.bufferPtr, start, end, bgColor || null, fgColor || null)
  }

  public resetSelection(): void {
    this.guard()
    this.lib.textBufferResetSelection(this.bufferPtr)
  }

  public setLocalSelection(
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgColor?: RGBA,
    fgColor?: RGBA,
  ): boolean {
    this.guard()
    return this.lib.textBufferSetLocalSelection(
      this.bufferPtr,
      anchorX,
      anchorY,
      focusX,
      focusY,
      bgColor || null,
      fgColor || null,
    )
  }

  public resetLocalSelection(): void {
    this.guard()
    this.lib.textBufferResetLocalSelection(this.bufferPtr)
  }

  public getSelection(): { start: number; end: number } | null {
    this.guard()
    return this.lib.textBufferGetSelection(this.bufferPtr)
  }

  public hasSelection(): boolean {
    this.guard()
    return this.getSelection() !== null
  }

  public setWrapWidth(width: number | null): void {
    this.guard()
    this.lib.textBufferSetWrapWidth(this.bufferPtr, width ?? 0)
    this._lineInfo = undefined
  }

  public setWrapMode(mode: "char" | "word"): void {
    this.guard()
    this.lib.textBufferSetWrapMode(this.bufferPtr, mode)
    this._lineInfo = undefined
  }

  /**
   * Add a highlight using character offsets into the full text.
   * Efficiently handles single-line and multi-line highlights.
   * @param charStart - Start character offset in the text
   * @param charEnd - End character offset in the text
   * @param styleId - Style ID from SyntaxStyle
   * @param priority - Priority for overlapping highlights (higher wins)
   * @param hlRef - Optional reference ID for bulk removal
   */
  public addHighlightByCharRange(
    charStart: number,
    charEnd: number,
    styleId: number,
    priority: number = 0,
    hlRef?: number,
  ): void {
    this.guard()
    this.lib.textBufferAddHighlightByCharRange(this.bufferPtr, charStart, charEnd, styleId, priority, hlRef)
  }

  /**
   * Add a highlight to a specific line by column positions.
   * @param lineIdx - Line index
   * @param colStart - Start column (grapheme-based)
   * @param colEnd - End column (grapheme-based)
   * @param styleId - Style ID from SyntaxStyle
   * @param priority - Priority for overlapping highlights (higher wins)
   * @param hlRef - Optional reference ID for bulk removal
   */
  public addHighlight(
    lineIdx: number,
    colStart: number,
    colEnd: number,
    styleId: number,
    priority: number = 0,
    hlRef?: number,
  ): void {
    this.guard()
    this.lib.textBufferAddHighlight(this.bufferPtr, lineIdx, colStart, colEnd, styleId, priority, hlRef)
  }

  /**
   * Remove all highlights with a specific reference ID.
   * @param hlRef - Reference ID to remove
   */
  public removeHighlightsByRef(hlRef: number): void {
    this.guard()
    this.lib.textBufferRemoveHighlightsByRef(this.bufferPtr, hlRef)
  }

  /**
   * Clear all highlights from a specific line.
   * @param lineIdx - Line index
   */
  public clearLineHighlights(lineIdx: number): void {
    this.guard()
    this.lib.textBufferClearLineHighlights(this.bufferPtr, lineIdx)
  }

  /**
   * Clear all highlights from all lines.
   */
  public clearAllHighlights(): void {
    this.guard()
    this.lib.textBufferClearAllHighlights(this.bufferPtr)
  }

  /**
   * Set the syntax style for highlight resolution.
   * @param style - Pointer to SyntaxStyle or null to unset
   */
  public setSyntaxStyle(style: NativeSyntaxStyle | null): void {
    this.guard()
    this._syntaxStyle = style ?? undefined
    this.lib.textBufferSetSyntaxStyle(this.bufferPtr, style?.ptr ?? null)
  }

  public destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.lib.destroyTextBuffer(this.bufferPtr)
  }
}
