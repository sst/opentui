import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type LineInfo, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import type { TextBuffer } from "./text-buffer"

export class TextBufferView {
  private lib: RenderLib
  private viewPtr: Pointer
  private textBuffer: TextBuffer
  private _lineInfo?: LineInfo
  private _destroyed: boolean = false

  constructor(lib: RenderLib, ptr: Pointer, textBuffer: TextBuffer) {
    this.lib = lib
    this.viewPtr = ptr
    this.textBuffer = textBuffer
  }

  static create(textBuffer: TextBuffer): TextBufferView {
    const lib = resolveRenderLib()
    const viewPtr = lib.createTextBufferView(textBuffer.ptr)
    return new TextBufferView(lib, viewPtr, textBuffer)
  }

  // Fail loud and clear
  private guard(): void {
    if (this._destroyed) throw new Error("TextBufferView is destroyed")
  }

  public get ptr(): Pointer {
    this.guard()
    return this.viewPtr
  }

  // TODO: mark dirty should not be necessary.
  // The underlying text buffer should have a mechanism to register views and mark them dirty
  // when something changes, so the view can check that flag and update itself, resetting the flag.
  public markDirty(): void {
    this.guard()
    this.lib.textBufferViewMarkDirty(this.viewPtr)
    this._lineInfo = undefined
  }

  public setSelection(start: number, end: number, bgColor?: RGBA, fgColor?: RGBA): void {
    this.guard()
    this.lib.textBufferViewSetSelection(this.viewPtr, start, end, bgColor || null, fgColor || null)
  }

  public resetSelection(): void {
    this.guard()
    this.lib.textBufferViewResetSelection(this.viewPtr)
  }

  public getSelection(): { start: number; end: number } | null {
    this.guard()
    return this.lib.textBufferViewGetSelection(this.viewPtr)
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
    this._lineInfo = undefined // Selection might change line info display
    return this.lib.textBufferViewSetLocalSelection(
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
    this.lib.textBufferViewResetLocalSelection(this.viewPtr)
  }

  public setWrapWidth(width: number | null): void {
    this.guard()
    this.lib.textBufferViewSetWrapWidth(this.viewPtr, width ?? 0)
    this._lineInfo = undefined
  }

  public setWrapMode(mode: "char" | "word"): void {
    this.guard()
    this.lib.textBufferViewSetWrapMode(this.viewPtr, mode)
    this._lineInfo = undefined
  }

  public get lineInfo(): LineInfo {
    this.guard()
    if (!this._lineInfo) {
      this._lineInfo = this.lib.textBufferViewGetLineInfo(this.viewPtr)
    }
    return this._lineInfo
  }

  public getSelectedText(): string {
    this.guard()
    const byteSize = this.textBuffer.byteSize
    if (byteSize === 0) return ""

    const selectedBytes = this.lib.textBufferViewGetSelectedTextBytes(this.viewPtr, byteSize)

    if (!selectedBytes) return ""

    return this.lib.decoder.decode(selectedBytes)
  }

  public getPlainText(): string {
    this.guard()
    const byteSize = this.textBuffer.byteSize
    if (byteSize === 0) return ""

    const plainBytes = this.lib.textBufferViewGetPlainTextBytes(this.viewPtr, byteSize)

    if (!plainBytes) return ""

    return this.lib.decoder.decode(plainBytes)
  }

  public destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.lib.destroyTextBufferView(this.viewPtr)
  }
}
