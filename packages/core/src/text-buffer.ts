import type { StyledText } from "./lib/styled-text"
import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import { type WidthMethod } from "./types"

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
  private _capacity: number
  private _lineInfo?: { lineStarts: number[]; lineWidths: number[] }

  constructor(lib: RenderLib, ptr: Pointer, capacity: number) {
    this.lib = lib
    this.bufferPtr = ptr
    this._capacity = capacity
  }

  static create(capacity: number = 256, widthMethod: WidthMethod): TextBuffer {
    const lib = resolveRenderLib()
    return lib.createTextBuffer(capacity, widthMethod)
  }

  public setStyledText(text: StyledText): void {
    this.lib.textBufferReset(this.bufferPtr)
    this._length = 0
    this._lineInfo = undefined

    for (const chunk of text.chunks) {
      const textBytes = this.lib.encoder.encode(chunk.text)
      const result = this.lib.textBufferWriteChunk(
        this.bufferPtr,
        textBytes,
        chunk.fg || null,
        chunk.bg || null,
        chunk.attributes ?? null,
      )

      if (result & 1) {
        this._capacity = this.lib.textBufferGetCapacity(this.bufferPtr)
      }
    }

    // TODO: textBufferFinalizeLineInfo can return the length of the text buffer, not another call to textBufferGetLength
    this.lib.textBufferFinalizeLineInfo(this.bufferPtr)
    this._length = this.lib.textBufferGetLength(this.bufferPtr)
  }

  public setDefaultFg(fg: RGBA | null): void {
    this.lib.textBufferSetDefaultFg(this.bufferPtr, fg)
  }

  public setDefaultBg(bg: RGBA | null): void {
    this.lib.textBufferSetDefaultBg(this.bufferPtr, bg)
  }

  public setDefaultAttributes(attributes: number | null): void {
    this.lib.textBufferSetDefaultAttributes(this.bufferPtr, attributes)
  }

  public resetDefaults(): void {
    this.lib.textBufferResetDefaults(this.bufferPtr)
  }

  public get length(): number {
    return this._length
  }

  public get capacity(): number {
    return this._capacity
  }

  public get ptr(): Pointer {
    return this.bufferPtr
  }

  public getSelectedText(): string {
    if (this._length === 0) return ""
    // TODO: The _length should be the text length, need to know the number of bytes for the text though
    const selectedBytes = this.lib.getSelectedTextBytes(this.bufferPtr, this.length * 4)

    if (!selectedBytes) return ""

    return this.lib.decoder.decode(selectedBytes)
  }

  public getPlainText(): string {
    if (this._length === 0) return ""
    // TODO: The _length should be the text length, need to know the number of bytes for the text though
    const plainBytes = this.lib.getPlainTextBytes(this.bufferPtr, this.length * 4)

    if (!plainBytes) return ""

    return this.lib.decoder.decode(plainBytes)
  }

  public get lineInfo(): { lineStarts: number[]; lineWidths: number[] } {
    if (!this._lineInfo) {
      this._lineInfo = this.lib.textBufferGetLineInfo(this.bufferPtr)
    }
    return this._lineInfo
  }

  public setSelection(start: number, end: number, bgColor?: RGBA, fgColor?: RGBA): void {
    this.lib.textBufferSetSelection(this.bufferPtr, start, end, bgColor || null, fgColor || null)
  }

  public resetSelection(): void {
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
    this.lib.textBufferResetLocalSelection(this.bufferPtr)
  }

  public getSelection(): { start: number; end: number } | null {
    return this.lib.textBufferGetSelection(this.bufferPtr)
  }

  public hasSelection(): boolean {
    return this.getSelection() !== null
  }

  public insertChunkGroup(index: number, text: string, fg?: RGBA, bg?: RGBA, attributes?: number): void {
    const textBytes = this.lib.encoder.encode(text)
    this.insertEncodedChunkGroup(index, textBytes, fg, bg, attributes)
  }

  public insertEncodedChunkGroup(
    index: number,
    textBytes: Uint8Array,
    fg?: RGBA,
    bg?: RGBA,
    attributes?: number,
  ): void {
    this._length = this.lib.textBufferInsertChunkGroup(
      this.bufferPtr,
      index,
      textBytes,
      fg || null,
      bg || null,
      attributes ?? null,
    )
    this._lineInfo = undefined
  }

  public removeChunkGroup(index: number): void {
    this._length = this.lib.textBufferRemoveChunkGroup(this.bufferPtr, index)
    this._lineInfo = undefined
  }

  public replaceChunkGroup(index: number, text: string, fg?: RGBA, bg?: RGBA, attributes?: number): void {
    const textBytes = this.lib.encoder.encode(text)
    this.replaceEncodedChunkGroup(index, textBytes, fg, bg, attributes)
  }

  public replaceEncodedChunkGroup(
    index: number,
    textBytes: Uint8Array,
    fg?: RGBA,
    bg?: RGBA,
    attributes?: number,
  ): void {
    this._length = this.lib.textBufferReplaceChunkGroup(
      this.bufferPtr,
      index,
      textBytes,
      fg || null,
      bg || null,
      attributes ?? null,
    )
    this._lineInfo = undefined
  }

  public get chunkGroupCount(): number {
    return this.lib.textBufferGetChunkGroupCount(this.bufferPtr)
  }

  public destroy(): void {
    this.lib.destroyTextBuffer(this.bufferPtr)
  }
}
