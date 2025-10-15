import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import type { EditBuffer } from "./edit-buffer"

export interface Viewport {
  offsetY: number
  offsetX: number
  height: number
  width: number
}

/**
 * EditorView provides a viewport-managed view over a TextBuffer,
 * with support for text wrapping and viewport scrolling.
 */
export class EditorView {
  private lib: RenderLib
  private viewPtr: Pointer
  private _destroyed: boolean = false

  constructor(lib: RenderLib, ptr: Pointer) {
    this.lib = lib
    this.viewPtr = ptr
  }

  /**
   * Create an EditorView for an EditBuffer.
   * The EditorView wraps the EditBuffer and its TextBuffer.
   */
  static create(editBuffer: EditBuffer, viewportWidth: number, viewportHeight: number): EditorView {
    const lib = resolveRenderLib()
    const viewPtr = lib.createEditorView(editBuffer.ptr, viewportWidth, viewportHeight)
    return new EditorView(lib, viewPtr)
  }

  private guard(): void {
    if (this._destroyed) throw new Error("EditorView is destroyed")
  }

  public get ptr(): Pointer {
    this.guard()
    return this.viewPtr
  }

  public setViewportSize(width: number, height: number): void {
    this.guard()
    this.lib.editorViewSetViewportSize(this.viewPtr, width, height)
  }

  public getViewport(): Viewport {
    this.guard()
    return this.lib.editorViewGetViewport(this.viewPtr)
  }

  public setScrollMargin(margin: number): void {
    this.guard()
    this.lib.editorViewSetScrollMargin(this.viewPtr, margin)
  }

  public setWrapMode(mode: "none" | "char" | "word"): void {
    this.guard()
    this.lib.editorViewSetWrapMode(this.viewPtr, mode)
  }

  public getVirtualLineCount(): number {
    this.guard()
    return this.lib.editorViewGetVirtualLineCount(this.viewPtr)
  }

  public setSelection(start: number, end: number, bgColor?: RGBA, fgColor?: RGBA): void {
    this.guard()
    this.lib.editorViewSetSelection(this.viewPtr, start, end, bgColor || null, fgColor || null)
  }

  public resetSelection(): void {
    this.guard()
    this.lib.editorViewResetSelection(this.viewPtr)
  }

  public getSelection(): { start: number; end: number } | null {
    this.guard()
    return this.lib.editorViewGetSelection(this.viewPtr)
  }

  public hasSelection(): boolean {
    this.guard()
    return this.getSelection() !== null
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
    return this.lib.editorViewSetLocalSelection(
      this.viewPtr,
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
    this.lib.editorViewResetLocalSelection(this.viewPtr)
  }

  public getSelectedText(): string {
    this.guard()
    // Use a reasonable buffer size based on typical selection sizes
    // We could optimize this by getting the actual selection size first
    const maxLength = 1024 * 1024 // 1MB should be enough for most selections
    const selectedBytes = this.lib.editorViewGetSelectedTextBytes(this.viewPtr, maxLength)

    if (!selectedBytes) return ""

    return this.lib.decoder.decode(selectedBytes)
  }

  // Cursor movement methods - delegate to EditBuffer and auto-scroll
  public moveCursorLeft(): void {
    this.guard()
    this.lib.editorViewMoveCursorLeft(this.viewPtr)
  }

  public moveCursorRight(): void {
    this.guard()
    this.lib.editorViewMoveCursorRight(this.viewPtr)
  }

  public moveCursorUp(): void {
    this.guard()
    this.lib.editorViewMoveCursorUp(this.viewPtr)
  }

  public moveCursorDown(): void {
    this.guard()
    this.lib.editorViewMoveCursorDown(this.viewPtr)
  }

  public gotoLine(line: number): void {
    this.guard()
    this.lib.editorViewGotoLine(this.viewPtr, line)
  }

  // Editing operations - delegate to EditBuffer and auto-scroll
  public insertChar(char: string): void {
    this.guard()
    this.lib.editorViewInsertChar(this.viewPtr, char)
  }

  public insertText(text: string): void {
    this.guard()
    this.lib.editorViewInsertText(this.viewPtr, text)
  }

  public deleteChar(): void {
    this.guard()
    this.lib.editorViewDeleteChar(this.viewPtr)
  }

  public deleteCharBackward(): void {
    this.guard()
    this.lib.editorViewDeleteCharBackward(this.viewPtr)
  }

  public newLine(): void {
    this.guard()
    this.lib.editorViewNewLine(this.viewPtr)
  }

  public deleteLine(): void {
    this.guard()
    this.lib.editorViewDeleteLine(this.viewPtr)
  }

  public destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.lib.destroyEditorView(this.viewPtr)
  }
}
