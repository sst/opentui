import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type RenderLib, type VisualCursor, type LineInfo } from "./zig"
import { type Pointer } from "bun:ffi"
import type { EditBuffer } from "./edit-buffer"
import { createExtmarksController } from "./lib"

export interface Viewport {
  offsetY: number
  offsetX: number
  height: number
  width: number
}

export type { VisualCursor }

export class EditorView {
  private lib: RenderLib
  private viewPtr: Pointer
  private editBuffer: EditBuffer
  private _destroyed: boolean = false
  private _extmarksController?: any

  constructor(lib: RenderLib, ptr: Pointer, editBuffer: EditBuffer) {
    this.lib = lib
    this.viewPtr = ptr
    this.editBuffer = editBuffer
  }

  static create(editBuffer: EditBuffer, viewportWidth: number, viewportHeight: number): EditorView {
    const lib = resolveRenderLib()
    const viewPtr = lib.createEditorView(editBuffer.ptr, viewportWidth, viewportHeight)
    return new EditorView(lib, viewPtr, editBuffer)
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

  public getTotalVirtualLineCount(): number {
    this.guard()
    return this.lib.editorViewGetTotalVirtualLineCount(this.viewPtr)
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
    // TODO: native can stack alloc all the text and decode will alloc as js string then
    const maxLength = 1024 * 1024 // 1MB should be enough for most selections
    const selectedBytes = this.lib.editorViewGetSelectedTextBytes(this.viewPtr, maxLength)

    if (!selectedBytes) return ""

    return this.lib.decoder.decode(selectedBytes)
  }

  public getCursor(): { row: number; col: number } {
    this.guard()
    return this.lib.editorViewGetCursor(this.viewPtr)
  }

  public getText(): string {
    this.guard()
    const maxLength = 1024 * 1024 // 1MB buffer
    const textBytes = this.lib.editorViewGetText(this.viewPtr, maxLength)
    if (!textBytes) return ""
    return this.lib.decoder.decode(textBytes)
  }

  public getVisualCursor(): VisualCursor {
    this.guard()
    return this.lib.editorViewGetVisualCursor(this.viewPtr)
  }

  public moveUpVisual(): void {
    this.guard()
    this.lib.editorViewMoveUpVisual(this.viewPtr)
  }

  public moveDownVisual(): void {
    this.guard()
    this.lib.editorViewMoveDownVisual(this.viewPtr)
  }

  public deleteSelectedText(): void {
    this.guard()
    this.lib.editorViewDeleteSelectedText(this.viewPtr)
  }

  public setCursorByOffset(offset: number): void {
    this.guard()
    this.lib.editorViewSetCursorByOffset(this.viewPtr, offset)
  }

  public getNextWordBoundary(): VisualCursor {
    this.guard()
    return this.lib.editorViewGetNextWordBoundary(this.viewPtr)
  }

  public getPrevWordBoundary(): VisualCursor {
    this.guard()
    return this.lib.editorViewGetPrevWordBoundary(this.viewPtr)
  }

  public getEOL(): VisualCursor {
    this.guard()
    return this.lib.editorViewGetEOL(this.viewPtr)
  }

  public getLineInfo(): LineInfo {
    this.guard()
    const textBufferViewPtr = this.lib.editorViewGetTextBufferView(this.viewPtr)
    return this.lib.textBufferViewGetLineInfo(textBufferViewPtr)
  }

  public getLogicalLineInfo(): LineInfo {
    this.guard()
    const textBufferViewPtr = this.lib.editorViewGetTextBufferView(this.viewPtr)
    return this.lib.textBufferViewGetLogicalLineInfo(textBufferViewPtr)
  }

  public get extmarks(): any {
    if (!this._extmarksController) {
      this._extmarksController = createExtmarksController(this.editBuffer, this)
    }
    return this._extmarksController
  }

  public destroy(): void {
    if (this._destroyed) return

    if (this._extmarksController) {
      this._extmarksController.destroy()
      this._extmarksController = undefined
    }

    this._destroyed = true
    this.lib.destroyEditorView(this.viewPtr)
  }
}
