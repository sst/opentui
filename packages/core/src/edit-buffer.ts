import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import { type WidthMethod } from "./types"
import type { TextBuffer } from "./text-buffer"

export interface CursorPosition {
  line: number
  charPos: number // Absolute character position in the buffer
  visualColumn: number
}

/**
 * EditBuffer provides a text editing buffer with cursor management,
 * incremental editing, and grapheme-aware operations.
 */
export class EditBuffer {
  private lib: RenderLib
  private bufferPtr: Pointer
  private _destroyed: boolean = false
  private _textBytes?: Uint8Array // Keep UTF-8 bytes alive for Zig reference

  constructor(lib: RenderLib, ptr: Pointer) {
    this.lib = lib
    this.bufferPtr = ptr
  }

  static create(widthMethod: WidthMethod): EditBuffer {
    const lib = resolveRenderLib()
    const ptr = lib.createEditBuffer(widthMethod)
    return new EditBuffer(lib, ptr)
  }

  private guard(): void {
    if (this._destroyed) throw new Error("EditBuffer is destroyed")
  }

  public get ptr(): Pointer {
    this.guard()
    return this.bufferPtr
  }

  public setText(text: string): void {
    this.guard()
    this._textBytes = this.lib.encoder.encode(text)
    this.lib.editBufferSetText(this.bufferPtr, text)
  }

  public getText(): string {
    this.guard()
    // Estimate max size (could be larger than original due to edits)
    const maxSize = 1024 * 1024 // 1MB max
    const textBytes = this.lib.editBufferGetText(this.bufferPtr, maxSize)

    if (!textBytes) return ""

    return this.lib.decoder.decode(textBytes)
  }

  public insertChar(char: string): void {
    this.guard()
    this.lib.editBufferInsertChar(this.bufferPtr, char)
  }

  public insertText(text: string): void {
    this.guard()
    this.lib.editBufferInsertText(this.bufferPtr, text)
  }

  public deleteChar(): void {
    this.guard()
    this.lib.editBufferDeleteChar(this.bufferPtr)
  }

  public deleteCharBackward(): void {
    this.guard()
    this.lib.editBufferDeleteCharBackward(this.bufferPtr)
  }

  public newLine(): void {
    this.guard()
    this.lib.editBufferNewLine(this.bufferPtr)
  }

  public deleteLine(): void {
    this.guard()
    this.lib.editBufferDeleteLine(this.bufferPtr)
  }

  public moveCursorLeft(): void {
    this.guard()
    this.lib.editBufferMoveCursorLeft(this.bufferPtr)
  }

  public moveCursorRight(): void {
    this.guard()
    this.lib.editBufferMoveCursorRight(this.bufferPtr)
  }

  public moveCursorUp(): void {
    this.guard()
    this.lib.editBufferMoveCursorUp(this.bufferPtr)
  }

  public moveCursorDown(): void {
    this.guard()
    this.lib.editBufferMoveCursorDown(this.bufferPtr)
  }

  public gotoLine(line: number): void {
    this.guard()
    this.lib.editBufferGotoLine(this.bufferPtr, line)
  }

  public setCursor(line: number, col: number): void {
    this.guard()
    this.lib.editBufferSetCursor(this.bufferPtr, line, col)
  }

  public setCursorToLineCol(line: number, col: number): void {
    this.guard()
    this.lib.editBufferSetCursorToLineCol(this.bufferPtr, line, col)
  }

  public getCursorPosition(): CursorPosition {
    this.guard()
    return this.lib.editBufferGetCursorPosition(this.bufferPtr)
  }

  /**
   * Get the underlying TextBuffer pointer for creating TextBufferView or EditorView.
   */
  public getTextBufferPtr(): Pointer {
    this.guard()
    return this.lib.editBufferGetTextBuffer(this.bufferPtr)
  }

  public destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.lib.destroyEditBuffer(this.bufferPtr)
  }
}
