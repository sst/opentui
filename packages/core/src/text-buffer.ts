import type { StyledText } from "./lib/styled-text"
import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer, toArrayBuffer } from "bun:ffi"
import { type WidthMethod } from "./types"

export interface TextChunk {
  __isChunk: true
  text: Uint8Array
  plainText: string
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
      const result = this.lib.textBufferWriteChunk(
        this.bufferPtr,
        chunk.text,
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
    const selectedBytes = this.lib.getSelectedTextBytes(this.bufferPtr, this._length)

    if (!selectedBytes) return ""

    return this.lib.decoder.decode(selectedBytes)
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

  public destroy(): void {
    this.lib.destroyTextBuffer(this.bufferPtr)
  }
}
