import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import { type WidthMethod } from "./types"

export interface CursorPosition {
  line: number
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
  private _textBytes?: Uint8Array

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
    this.lib.editBufferSetText(this.bufferPtr, this._textBytes)
  }

  public getText(): string {
    this.guard()
    // TODO: Use byte size of text buffer to get the actual size of the text
    // actually native can stack alloc all the text and decode will alloc as js string then
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

  // TODO: Instead of just a ptr getter, this should have a textBuffer getter that returns a TextBuffer instance
  public getTextBufferPtr(): Pointer {
    this.guard()
    return this.lib.editBufferGetTextBuffer(this.bufferPtr)
  }

  public debugLogRope(): void {
    this.guard()
    this.lib.editBufferDebugLogRope(this.bufferPtr)
  }

  public undo(): string | null {
    this.guard()
    const maxSize = 256
    const metaBytes = this.lib.editBufferUndo(this.bufferPtr, maxSize)
    if (!metaBytes) return null
    return this.lib.decoder.decode(metaBytes)
  }

  public redo(): string | null {
    this.guard()
    const maxSize = 256
    const metaBytes = this.lib.editBufferRedo(this.bufferPtr, maxSize)
    if (!metaBytes) return null
    return this.lib.decoder.decode(metaBytes)
  }

  public canUndo(): boolean {
    this.guard()
    return this.lib.editBufferCanUndo(this.bufferPtr)
  }

  public canRedo(): boolean {
    this.guard()
    return this.lib.editBufferCanRedo(this.bufferPtr)
  }

  public clearHistory(): void {
    this.guard()
    this.lib.editBufferClearHistory(this.bufferPtr)
  }

  public destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.lib.destroyEditBuffer(this.bufferPtr)
  }
}
