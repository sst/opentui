import type { StyledText } from "./lib/styled-text"
import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
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
  private buffer: {
    char: Uint32Array
    fg: Float32Array
    bg: Float32Array
    attributes: Uint16Array
  }
  private _length: number = 0
  private _capacity: number
  private _lineInfo?: { lineStarts: number[]; lineWidths: number[] }

  constructor(
    lib: RenderLib,
    ptr: Pointer,
    buffer: {
      char: Uint32Array
      fg: Float32Array
      bg: Float32Array
      attributes: Uint16Array
    },
    capacity: number,
  ) {
    this.lib = lib
    this.bufferPtr = ptr
    this.buffer = buffer
    this._capacity = capacity
  }

  static create(capacity: number = 256, widthMethod: WidthMethod): TextBuffer {
    const lib = resolveRenderLib()
    return lib.createTextBuffer(capacity, widthMethod)
  }

  private syncBuffersAfterResize(): void {
    const capacity = this.lib.textBufferGetCapacity(this.bufferPtr)
    this.buffer = this.lib.getTextBufferArrays(this.bufferPtr, capacity)
    this._capacity = capacity
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
        this.syncBuffersAfterResize()
      }
    }

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

  public get lineInfo(): { lineStarts: number[]; lineWidths: number[] } {
    if (!this._lineInfo) {
      this._lineInfo = this.lib.textBufferGetLineInfo(this.bufferPtr)
    }
    return this._lineInfo
  }

  public toString(): string {
    const chars: string[] = []
    for (let i = 0; i < this._length; i++) {
      chars.push(String.fromCharCode(this.buffer.char[i]))
    }
    return chars.join("")
  }

  public concat(other: TextBuffer): TextBuffer {
    return this.lib.textBufferConcat(this.bufferPtr, other.bufferPtr)
  }

  public setSelection(start: number, end: number, bgColor?: RGBA, fgColor?: RGBA): void {
    this.lib.textBufferSetSelection(this.bufferPtr, start, end, bgColor || null, fgColor || null)
  }

  public resetSelection(): void {
    this.lib.textBufferResetSelection(this.bufferPtr)
  }

  public destroy(): void {
    this.lib.destroyTextBuffer(this.bufferPtr)
  }
}
