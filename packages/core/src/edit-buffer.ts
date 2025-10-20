import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import { type WidthMethod } from "./types"
import { RGBA } from "./lib/RGBA"
import { EventEmitter } from "events"
import type { SyntaxStyle } from "./syntax-style"

// TODO: make this row/col as anything else
export interface CursorPosition {
  line: number
  visualColumn: number
  offset: number
}

/**
 * EditBuffer provides a text editing buffer with cursor management,
 * incremental editing, and grapheme-aware operations.
 */
export class EditBuffer extends EventEmitter {
  private static registry = new Map<number, EditBuffer>()
  private static nativeEventsSubscribed = false

  private lib: RenderLib
  private bufferPtr: Pointer
  private textBufferPtr: Pointer
  public readonly id: number
  private _destroyed: boolean = false
  private _textBytes: Uint8Array[] = []
  private _singleTextBytes: Uint8Array | null = null
  private _singleTextMemId: number | null = null
  private _syntaxStyle?: SyntaxStyle

  constructor(lib: RenderLib, ptr: Pointer) {
    super()
    this.lib = lib
    this.bufferPtr = ptr
    this.textBufferPtr = lib.editBufferGetTextBuffer(ptr)
    this.id = lib.editBufferGetId(ptr)

    EditBuffer.registry.set(this.id, this)
    EditBuffer.subscribeToNativeEvents(lib)
  }

  static create(widthMethod: WidthMethod): EditBuffer {
    const lib = resolveRenderLib()
    const ptr = lib.createEditBuffer(widthMethod)
    return new EditBuffer(lib, ptr)
  }

  private static subscribeToNativeEvents(lib: RenderLib): void {
    if (EditBuffer.nativeEventsSubscribed) return
    EditBuffer.nativeEventsSubscribed = true

    lib.onAnyNativeEvent((name: string, data: ArrayBuffer) => {
      const buffer = new Uint16Array(data)

      if (name.startsWith("eb_") && buffer.length >= 1) {
        const id = buffer[0]
        const instance = EditBuffer.registry.get(id)

        if (instance) {
          // Strip the "eb_" prefix and forward the event
          const eventName = name.slice(3)
          const eventData = data.slice(2)
          instance.emit(eventName, eventData)
        }
      }
    })
  }

  private guard(): void {
    if (this._destroyed) throw new Error("EditBuffer is destroyed")
  }

  public get ptr(): Pointer {
    this.guard()
    return this.bufferPtr
  }

  public setText(text: string, opts?: { history?: boolean }): void {
    this.guard()
    const history = opts?.history ?? true
    const textBytes = this.lib.encoder.encode(text)

    if (history) {
      this._textBytes.push(textBytes)
      const memId = this.lib.textBufferRegisterMemBuffer(this.textBufferPtr, textBytes, false)
      this.lib.editBufferSetTextFromMem(this.bufferPtr, memId, true)
    } else {
      if (this._singleTextMemId !== null) {
        this.lib.textBufferReplaceMemBuffer(this.textBufferPtr, this._singleTextMemId, textBytes, false)
      } else {
        this._singleTextMemId = this.lib.textBufferRegisterMemBuffer(this.textBufferPtr, textBytes, false)
      }
      this._singleTextBytes = textBytes
      this.lib.editBufferSetTextFromMem(this.bufferPtr, this._singleTextMemId, false)
    }
  }

  public setTextOwned(text: string, opts?: { history?: boolean }): void {
    this.guard()
    const history = opts?.history ?? true
    const textBytes = this.lib.encoder.encode(text)
    this.lib.editBufferSetText(this.bufferPtr, textBytes, history)
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

  public setCursorByOffset(offset: number): void {
    this.guard()
    this.lib.editBufferSetCursorByOffset(this.bufferPtr, offset)
  }

  public getCursorPosition(): CursorPosition {
    this.guard()
    return this.lib.editBufferGetCursorPosition(this.bufferPtr)
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

  public setDefaultFg(fg: RGBA | null): void {
    this.guard()
    this.lib.textBufferSetDefaultFg(this.textBufferPtr, fg)
  }

  public setDefaultBg(bg: RGBA | null): void {
    this.guard()
    this.lib.textBufferSetDefaultBg(this.textBufferPtr, bg)
  }

  public setDefaultAttributes(attributes: number | null): void {
    this.guard()
    this.lib.textBufferSetDefaultAttributes(this.textBufferPtr, attributes)
  }

  public resetDefaults(): void {
    this.guard()
    this.lib.textBufferResetDefaults(this.textBufferPtr)
  }

  public setPlaceholder(text: string | null): void {
    this.guard()
    this.lib.editBufferSetPlaceholder(this.bufferPtr, text)
  }

  public setPlaceholderColor(color: RGBA): void {
    this.guard()
    this.lib.editBufferSetPlaceholderColor(this.bufferPtr, color)
  }

  public setSyntaxStyle(style: SyntaxStyle | null): void {
    this.guard()
    this._syntaxStyle = style ?? undefined
    this.lib.textBufferSetSyntaxStyle(this.textBufferPtr, style?.ptr ?? null)
  }

  public getSyntaxStyle(): SyntaxStyle | null {
    this.guard()
    return this._syntaxStyle ?? null
  }

  public addHighlight(
    lineIdx: number,
    colStart: number,
    colEnd: number,
    styleId: number,
    priority: number = 0,
    hlRef?: number,
  ): void {
    this.guard()
    this.lib.textBufferAddHighlight(this.textBufferPtr, lineIdx, colStart, colEnd, styleId, priority, hlRef)
  }

  public addHighlightByCharRange(
    charStart: number,
    charEnd: number,
    styleId: number,
    priority: number = 0,
    hlRef?: number,
  ): void {
    this.guard()
    this.lib.textBufferAddHighlightByCharRange(this.textBufferPtr, charStart, charEnd, styleId, priority, hlRef)
  }

  public removeHighlightsByRef(hlRef: number): void {
    this.guard()
    this.lib.textBufferRemoveHighlightsByRef(this.textBufferPtr, hlRef)
  }

  public clearLineHighlights(lineIdx: number): void {
    this.guard()
    this.lib.textBufferClearLineHighlights(this.textBufferPtr, lineIdx)
  }

  public clearAllHighlights(): void {
    this.guard()
    this.lib.textBufferClearAllHighlights(this.textBufferPtr)
  }

  public getLineHighlights(
    lineIdx: number,
  ): Array<{ colStart: number; colEnd: number; styleId: number; priority: number; hlRef: number | null }> {
    this.guard()
    return this.lib.textBufferGetLineHighlights(this.textBufferPtr, lineIdx)
  }

  public destroy(): void {
    if (this._destroyed) return

    this._destroyed = true
    EditBuffer.registry.delete(this.id)
    this.lib.destroyEditBuffer(this.bufferPtr)
  }
}
