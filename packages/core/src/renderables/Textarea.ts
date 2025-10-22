import { type RenderContext, type Highlight } from "../types"
import { EditBufferRenderable, type EditBufferOptions } from "./EditBufferRenderable"
import type { KeyEvent } from "../lib/KeyHandler"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"

export interface TextareaOptions extends EditBufferOptions {
  value?: string
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  placeholder?: string | null
  placeholderColor?: ColorInput
}

export class TextareaRenderable extends EditBufferRenderable {
  private _placeholder: string | null
  private _unfocusedBackgroundColor: RGBA
  private _unfocusedTextColor: RGBA
  private _focusedBackgroundColor: RGBA
  private _focusedTextColor: RGBA
  private _placeholderColor: RGBA

  private static readonly defaults = {
    value: "",
    backgroundColor: "transparent",
    textColor: "#FFFFFF",
    focusedBackgroundColor: "transparent",
    focusedTextColor: "#FFFFFF",
    placeholder: null,
    placeholderColor: "#666666",
  } satisfies Partial<TextareaOptions>

  constructor(ctx: RenderContext, options: TextareaOptions) {
    const defaults = TextareaRenderable.defaults

    // Pass base colors to parent constructor (these become the unfocused colors)
    const baseOptions = {
      ...options,
      backgroundColor: options.backgroundColor || defaults.backgroundColor,
      textColor: options.textColor || defaults.textColor,
    }
    super(ctx, baseOptions)

    // Store unfocused colors separately (parent's properties get overwritten when focused)
    this._unfocusedBackgroundColor = parseColor(options.backgroundColor || defaults.backgroundColor)
    this._unfocusedTextColor = parseColor(options.textColor || defaults.textColor)
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor || options.backgroundColor || defaults.focusedBackgroundColor,
    )
    this._focusedTextColor = parseColor(options.focusedTextColor || options.textColor || defaults.focusedTextColor)
    this._placeholder = options.placeholder ?? defaults.placeholder
    this._placeholderColor = parseColor(options.placeholderColor || defaults.placeholderColor)

    this.updateValue(options.value ?? defaults.value)
    this.updateColors()

    this.editBuffer.setPlaceholder(this._placeholder)
    this.editBuffer.setPlaceholderColor(this._placeholderColor)
  }

  public handlePaste(text: string): void {
    this.insertText(text)
  }

  public handleKeyPress(key: KeyEvent | string): boolean {
    const keyName = typeof key === "string" ? key : key.name
    const keySequence = typeof key === "string" ? key : key.sequence
    const keyCtrl = typeof key === "string" ? false : key.ctrl
    const keyShift = typeof key === "string" ? false : key.shift
    const keyMeta = typeof key === "string" ? false : key.meta

    if (keyCtrl && keyName === "z" && !keyShift) {
      this.undo()
      return true
    } else if ((keyCtrl && keyName === "y") || (keyCtrl && keyShift && keyName === "z")) {
      this.redo()
      return true
    } else if (keyName === "left") {
      this.handleShiftSelection(keyShift, true)
      this.moveCursorLeft()
      this.handleShiftSelection(keyShift, false)
      return true
    } else if (keyName === "right") {
      this.handleShiftSelection(keyShift, true)
      this.moveCursorRight()
      this.handleShiftSelection(keyShift, false)
      return true
    } else if (keyName === "up") {
      this.handleShiftSelection(keyShift, true)
      this.moveCursorUp()
      this.handleShiftSelection(keyShift, false)
      return true
    } else if (keyName === "down") {
      this.handleShiftSelection(keyShift, true)
      this.moveCursorDown()
      this.handleShiftSelection(keyShift, false)
      return true
    } else if (keyName === "home") {
      this.handleShiftSelection(keyShift, true)
      const cursor = this.editorView.getCursor()
      this.editBuffer.setCursor(cursor.row, 0)
      this.handleShiftSelection(keyShift, false)
      return true
    } else if (keyName === "end") {
      this.handleShiftSelection(keyShift, true)
      this.gotoLineEnd()
      this.handleShiftSelection(keyShift, false)
      return true
    } else if (keyCtrl && keyName === "a") {
      this.editBuffer.setCursor(0, 0)
      return true
    } else if (keyCtrl && keyName === "e") {
      this.gotoBufferEnd()
      return true
    } else if (keyCtrl && keyName === "d") {
      this.deleteLine()
      return true
    } else if (keyCtrl && keyName === "k") {
      this.deleteToLineEnd()
      return true
    } else if (keyName === "backspace") {
      this.deleteCharBackward()
      return true
    } else if (keyName === "delete") {
      this.deleteChar()
      return true
    } else if (keyName === "return" || keyName === "enter") {
      this.newLine()
      return true
    }
    // Filter to printable ASCII/Unicode (excludes control sequences)
    else if (keySequence && !keyCtrl && !keyMeta) {
      const firstCharCode = keySequence.charCodeAt(0)

      // Reject control characters (0-31) and escape sequences starting with ESC (27)
      if (firstCharCode < 32) {
        return false
      }

      // Reject DEL (127)
      if (firstCharCode === 127) {
        return false
      }

      this.insertText(keySequence)
      return true
    }

    return false
  }

  get value(): string {
    return this.editBuffer.getText()
  }

  set value(value: string) {
    this.updateValue(value)
  }

  private updateValue(value: string): void {
    this.editBuffer.setText(value, { history: false })
    this.yogaNode.markDirty()
    this.requestRender()
  }

  private updateColors(): void {
    const effectiveBg = this._focused ? this._focusedBackgroundColor : this._unfocusedBackgroundColor
    const effectiveFg = this._focused ? this._focusedTextColor : this._unfocusedTextColor

    super.backgroundColor = effectiveBg
    super.textColor = effectiveFg
  }

  public insertChar(char: string): void {
    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    this.editBuffer.insertChar(char)
    this.requestRender()
  }

  public insertText(text: string): void {
    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    this.editBuffer.insertText(text)
    this.requestRender()
  }

  public deleteChar(): void {
    if (this.hasSelection()) {
      this.deleteSelectedText()
      return
    }

    this._ctx.clearSelection()
    this.editBuffer.deleteChar()
    this.requestRender()
  }

  public deleteCharBackward(): void {
    if (this.hasSelection()) {
      this.deleteSelectedText()
      return
    }

    this._ctx.clearSelection()
    this.editBuffer.deleteCharBackward()
    this.requestRender()
  }

  private deleteSelectedText(): void {
    this.editorView.deleteSelectedText()

    this._ctx.clearSelection()
    this.requestRender()
  }

  public newLine(): void {
    this._ctx.clearSelection()
    this.editBuffer.newLine()
    this.requestRender()
  }

  public deleteLine(): void {
    this._ctx.clearSelection()
    this.editBuffer.deleteLine()
    this.requestRender()
  }

  public moveCursorLeft(): void {
    this.editBuffer.moveCursorLeft()
    this.requestRender()
  }

  public moveCursorRight(): void {
    this.editBuffer.moveCursorRight()
    this.requestRender()
  }

  public moveCursorUp(): void {
    this.editorView.moveUpVisual()
    this.requestRender()
  }

  public moveCursorDown(): void {
    this.editorView.moveDownVisual()
    this.requestRender()
  }

  public gotoLine(line: number): void {
    this.editBuffer.gotoLine(line)
    this.requestRender()
  }

  public gotoLineEnd(): void {
    const cursor = this.editorView.getCursor()

    this.editBuffer.gotoLine(9999) // Temp hack - move to way past end to trigger end-of-line
    const afterCursor = this.editorView.getCursor()

    if (afterCursor.row !== cursor.row) {
      this.editBuffer.setCursor(cursor.row, 9999)
    }
    this.requestRender()
  }

  public gotoBufferEnd(): void {
    this.editBuffer.gotoLine(999999)
    this.requestRender()
  }

  public deleteToLineEnd(): void {
    const cursor = this.editorView.getCursor()
    const startCol = cursor.col

    const tempCursor = this.editorView.getCursor()
    this.editBuffer.setCursor(tempCursor.row, 9999)
    const endCursor = this.editorView.getCursor()
    const endCol = endCursor.col

    this.editBuffer.setCursor(cursor.row, startCol)

    if (endCol > startCol) {
      for (let i = 0; i < endCol - startCol; i++) {
        this.deleteChar()
      }
    }

    this.requestRender()
  }

  public undo(): void {
    this._ctx.clearSelection()
    this.editBuffer.undo()
    this.requestRender()
  }

  public redo(): void {
    this._ctx.clearSelection()
    this.editBuffer.redo()
    this.requestRender()
  }

  private handleShiftSelection(shiftPressed: boolean, isBeforeMovement: boolean): void {
    if (!this.selectable) return

    if (!shiftPressed) {
      this._ctx.clearSelection()
      return
    }

    const visualCursor = this.editorView.getVisualCursor()

    const viewport = this.editorView.getViewport()
    const cursorX = this.x + visualCursor.visualCol
    const cursorY = this.y + (visualCursor.visualRow - viewport.offsetY)

    if (isBeforeMovement) {
      if (!this._ctx.hasSelection) {
        this._ctx.startSelection(this, cursorX, cursorY)
      }
    } else {
      this._ctx.updateSelection(this, cursorX, cursorY)
    }
  }

  public focus(): void {
    super.focus()
    this.updateColors()
  }

  public blur(): void {
    super.blur()
    this.updateColors()
  }

  get placeholder(): string | null {
    return this._placeholder
  }

  set placeholder(value: string | null) {
    if (this._placeholder !== value) {
      this._placeholder = value
      this.editBuffer.setPlaceholder(value)
      this.requestRender()
    }
  }

  override get backgroundColor(): RGBA {
    return this._unfocusedBackgroundColor
  }

  override set backgroundColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.backgroundColor)
    if (this._unfocusedBackgroundColor !== newColor) {
      this._unfocusedBackgroundColor = newColor
      this.updateColors()
    }
  }

  override get textColor(): RGBA {
    return this._unfocusedTextColor
  }

  override set textColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.textColor)
    if (this._unfocusedTextColor !== newColor) {
      this._unfocusedTextColor = newColor
      this.updateColors()
    }
  }

  set focusedBackgroundColor(value: ColorInput) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.focusedBackgroundColor)
    if (this._focusedBackgroundColor !== newColor) {
      this._focusedBackgroundColor = newColor
      this.updateColors()
    }
  }

  set focusedTextColor(value: ColorInput) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.focusedTextColor)
    if (this._focusedTextColor !== newColor) {
      this._focusedTextColor = newColor
      this.updateColors()
    }
  }

  set placeholderColor(value: ColorInput) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.placeholderColor)
    if (this._placeholderColor !== newColor) {
      this._placeholderColor = newColor
      this.editBuffer.setPlaceholderColor(newColor)
      this.requestRender()
    }
  }

  get cursorOffset(): number {
    return this.editorView.getVisualCursor().offset
  }

  set cursorOffset(offset: number) {
    this.editorView.setCursorByOffset(offset)
    this.requestRender()
  }

  public addHighlight(lineIdx: number, highlight: Highlight): void {
    this.editBuffer.addHighlight(lineIdx, highlight)
    this.requestRender()
  }

  public addHighlightByCharRange(highlight: Highlight): void {
    this.editBuffer.addHighlightByCharRange(highlight)
    this.requestRender()
  }

  public removeHighlightsByRef(hlRef: number): void {
    this.editBuffer.removeHighlightsByRef(hlRef)
    this.requestRender()
  }

  public clearLineHighlights(lineIdx: number): void {
    this.editBuffer.clearLineHighlights(lineIdx)
    this.requestRender()
  }

  public clearAllHighlights(): void {
    this.editBuffer.clearAllHighlights()
    this.requestRender()
  }

  public getLineHighlights(lineIdx: number): Array<Highlight> {
    return this.editBuffer.getLineHighlights(lineIdx)
  }
}
