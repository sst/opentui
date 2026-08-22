import type { StyledText } from "./lib/styled-text.js"
import { RGBA } from "./lib/RGBA.js"
import {
  resolveRenderLib,
  type DocumentStyle,
  type DocumentRange,
  type DocumentOperation,
  type DocumentStyledChunk,
  type LineInfo,
  type RenderLib,
  type TextBufferHandle,
  type TextSpliceResult,
} from "./zig.js"
import { type WidthMethod, type Highlight } from "./types.js"
import type { SyntaxStyle } from "./syntax-style.js"

export interface TextChunk {
  __isChunk: true
  text: string
  styleId?: number
  styleSource?: SyntaxStyle
  fg?: RGBA
  bg?: RGBA
  attributes?: number
  link?: { url: string }
}

export class TextBuffer {
  private lib: RenderLib
  private bufferPtr: TextBufferHandle
  private _length: number = 0
  private _byteSize: number = 0
  private _lineInfo?: LineInfo
  private _destroyed: boolean = false
  private _syntaxStyle?: SyntaxStyle
  private _textBytes?: Uint8Array
  private _memId?: number
  private _appendedChunks: Uint8Array[] = []

  private withStyleSource<T extends DocumentStyle>(style: T): T {
    if (style.styleId === undefined) return style
    const declaredSource = (style as T & { styleSource?: SyntaxStyle }).styleSource
    const syntaxStyle = declaredSource ?? this._syntaxStyle
    if (!syntaxStyle) throw new Error("A registered style requires an attached SyntaxStyle")
    return { ...style, syntaxStyle: syntaxStyle.ptr }
  }

  private documentStyleSource(operations: DocumentOperation[]): SyntaxStyle | undefined {
    let source: SyntaxStyle | undefined
    const add = (style: DocumentStyle): void => {
      if (style.styleId === undefined) return
      const candidate = (style as DocumentStyle & { styleSource?: SyntaxStyle }).styleSource ?? this._syntaxStyle
      if (!candidate) throw new Error("A registered style requires a live SyntaxStyle")
      if (source && source !== candidate) throw new Error("A document transaction cannot mix SyntaxStyle instances")
      source = candidate
    }
    for (const operation of operations) {
      add(operation)
      for (const chunk of operation.chunks ?? []) add(chunk)
      for (const range of operation.ranges ?? []) add(range)
    }
    return source
  }

  constructor(lib: RenderLib, ptr: TextBufferHandle) {
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
    } else if (!this.lib.textBufferReplaceMemBuffer(this.bufferPtr, this._memId, this._textBytes, false)) {
      this._memId = this.lib.textBufferRegisterMemBuffer(this.bufferPtr, this._textBytes, false)
    }

    this.lib.textBufferSetTextFromMem(this.bufferPtr, this._memId)
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr)
    this._lineInfo = undefined
    this._appendedChunks = [] // Clear any previously appended chunks
  }

  public append(text: string): void {
    this.guard()
    const textBytes = this.lib.encoder.encode(text)
    // Keep the bytes alive to prevent garbage collection
    this._appendedChunks.push(textBytes)
    this.lib.textBufferAppend(this.bufferPtr, textBytes)
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

    this.lib.textBufferSetStyledText(
      this.bufferPtr,
      text.chunks.map((chunk) => this.withStyleSource(chunk)),
    )

    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr)
    this._lineInfo = undefined
  }

  public replaceStyledRangeBytes(
    startByte: number,
    endByte: number,
    chunks: DocumentStyledChunk[],
    owner: number,
  ): TextSpliceResult {
    this.guard()
    const result = this.lib.textBufferReplaceStyledRangeBytes(
      this.bufferPtr,
      startByte,
      endByte,
      chunks.map((chunk) => this.withStyleSource(chunk)),
      owner,
    )
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr)
    this._lineInfo = undefined
    return result
  }

  public getDocumentRange(id: bigint): DocumentRange | null {
    this.guard()
    return this.lib.textBufferGetDocumentRange(this.bufferPtr, id)
  }

  public getDocumentRangeText(id: bigint): string | null {
    this.guard()
    const range = this.getDocumentRange(id)
    if (!range) return null
    const bytes = this.lib.textBufferGetDocumentRangeText(this.bufferPtr, id, range.endByte - range.startByte)
    return bytes ? this.lib.decoder.decode(bytes) : null
  }

  public measureDocumentRange(id: bigint): number {
    this.guard()
    return this.lib.textBufferMeasureDocumentRange(this.bufferPtr, id)
  }

  public applyDocumentOperations(operations: DocumentOperation[]): bigint[] {
    this.guard()
    const styleSource = this.documentStyleSource(operations)
    const ids = this.lib.textBufferApplyDocumentOperations(
      this.bufferPtr,
      operations.map((operation) => ({
        ...this.withStyleSource(operation),
        chunks: operation.chunks?.map((chunk) => this.withStyleSource(chunk)),
        ranges: operation.ranges?.map((range) => this.withStyleSource(range)),
      })),
    )
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr)
    this._lineInfo = undefined
    if (styleSource) this._syntaxStyle = styleSource
    return ids
  }

  public applyTwoDocumentOperations(
    other: TextBuffer,
    operations: DocumentOperation[],
    otherOperations: DocumentOperation[],
  ): { ids: bigint[]; otherIds: bigint[] } {
    this.guard()
    other.guard()
    if (other === this) throw new Error("Two-document operations require distinct TextBuffers")
    const styleSource = this.documentStyleSource(operations)
    const otherStyleSource = other.documentStyleSource(otherOperations)
    const withSources = (buffer: TextBuffer, values: DocumentOperation[]) =>
      values.map((operation) => ({
        ...buffer.withStyleSource(operation),
        chunks: operation.chunks?.map((chunk) => buffer.withStyleSource(chunk)),
        ranges: operation.ranges?.map((range) => buffer.withStyleSource(range)),
      }))
    const result = this.lib.textBufferApplyTwoDocumentOperations(
      this.bufferPtr,
      withSources(this, operations),
      other.bufferPtr,
      withSources(other, otherOperations),
    )
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
    this._byteSize = this.lib.textBufferGetByteSize(this.bufferPtr)
    this._lineInfo = undefined
    other._length = this.lib.textBufferGetLength(other.bufferPtr)
    other._byteSize = this.lib.textBufferGetByteSize(other.bufferPtr)
    other._lineInfo = undefined
    if (styleSource) this._syntaxStyle = styleSource
    if (otherStyleSource) other._syntaxStyle = otherStyleSource
    return { ids: result.firstIds, otherIds: result.secondIds }
  }

  public get annotationEpoch(): bigint {
    this.guard()
    return this.lib.textBufferGetAnnotationEpoch(this.bufferPtr)
  }

  public get contentEpoch(): bigint {
    this.guard()
    return this.lib.textBufferGetContentEpoch(this.bufferPtr)
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

  public getLineCount(): number {
    this.guard()
    return this.lib.textBufferGetLineCount(this.bufferPtr)
  }

  public get length(): number {
    this.guard()
    return this._length
  }

  public get byteSize(): number {
    this.guard()
    return this._byteSize
  }

  public get ptr(): TextBufferHandle {
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

  public getTextRange(startOffset: number, endOffset: number): string {
    this.guard()
    if (startOffset >= endOffset) return ""
    if (this._byteSize === 0) return ""

    const rangeBytes = this.lib.textBufferGetTextRange(this.bufferPtr, startOffset, endOffset, this._byteSize)

    if (!rangeBytes) return ""

    return this.lib.decoder.decode(rangeBytes)
  }

  /**
   * Add a highlight using character offsets into the full text.
   * start/end in highlight represent absolute character positions.
   */
  public addHighlightByCharRange(highlight: Highlight): void {
    this.guard()
    this.lib.textBufferAddHighlightByCharRange(this.bufferPtr, highlight)
  }

  /**
   * Add a highlight to a specific line by column positions.
   * start/end in highlight represent column offsets.
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

  public getLineHighlights(lineIdx: number): Array<Highlight> {
    this.guard()
    return this.lib.textBufferGetLineHighlights(this.bufferPtr, lineIdx)
  }

  public getHighlightCount(): number {
    this.guard()
    return this.lib.textBufferGetHighlightCount(this.bufferPtr)
  }

  public setSyntaxStyle(style: SyntaxStyle | null): void {
    this.guard()
    if (this.lib.textBufferSetSyntaxStyle(this.bufferPtr, style?.ptr ?? null)) {
      this._syntaxStyle = style ?? undefined
    }
  }

  public getSyntaxStyle(): SyntaxStyle | null {
    this.guard()
    if (this._syntaxStyle?.isDestroyed) this._syntaxStyle = undefined
    return this._syntaxStyle ?? null
  }

  public setTabWidth(width: number): void {
    this.guard()
    this.lib.textBufferSetTabWidth(this.bufferPtr, width)
  }

  public getTabWidth(): number {
    this.guard()
    return this.lib.textBufferGetTabWidth(this.bufferPtr)
  }

  public clear(): void {
    this.guard()
    this.lib.textBufferClear(this.bufferPtr)
    this._length = 0
    this._byteSize = 0
    this._lineInfo = undefined
    this._textBytes = undefined
    this._appendedChunks = []
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
    this._appendedChunks = []
  }

  public destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.lib.destroyTextBuffer(this.bufferPtr)
  }
}
