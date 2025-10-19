import { type RenderContext } from "../types"
import { EditBufferRenderable, type EditBufferOptions } from "./EditBufferRenderable"
import type { KeyEvent } from "../lib/KeyHandler"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"
import type { OptimizedBuffer } from "../buffer"

export interface TextareaOptions extends EditBufferOptions {
  content?: string
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  placeholder?: string
  placeholderColor?: ColorInput
}

/**
 * TextareaRenderable provides an interactive text editor with cursor management,
 * incremental editing, and grapheme-aware operations.
 */
export class TextareaRenderable extends EditBufferRenderable {
  private _content: string
  private _placeholder: string
  private _unfocusedBackgroundColor: RGBA
  private _unfocusedTextColor: RGBA
  private _focusedBackgroundColor: RGBA
  private _focusedTextColor: RGBA
  private _placeholderColor: RGBA

  private static readonly defaults = {
    content: "",
    backgroundColor: "transparent",
    textColor: "#FFFFFF",
    focusedBackgroundColor: "#1a1a1a",
    focusedTextColor: "#FFFFFF",
    placeholder: "",
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

    this._content = options.content ?? defaults.content
    // Store unfocused colors separately (parent's properties get overwritten when focused)
    this._unfocusedBackgroundColor = parseColor(options.backgroundColor || defaults.backgroundColor)
    this._unfocusedTextColor = parseColor(options.textColor || defaults.textColor)
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor || options.backgroundColor || defaults.focusedBackgroundColor,
    )
    this._focusedTextColor = parseColor(options.focusedTextColor || options.textColor || defaults.focusedTextColor)
    this._placeholder = options.placeholder || defaults.placeholder
    this._placeholderColor = parseColor(options.placeholderColor || defaults.placeholderColor)

    this.updateContent(this._content)
    this.updateColors()
  }

  public handlePaste(text: string): void {
    this.insertText(text)
  }

  /**
   * Handle keyboard input for interactive editing.
   * This is called automatically when the editor is focused and a key is pressed.
   */
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
    }

    // Movement
    else if (keyName === "left") {
      this.handleShiftSelection(keyShift, true) // BEFORE cursor movement
      this.moveCursorLeft()
      this.handleShiftSelection(keyShift, false) // AFTER cursor movement
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
    }
    // Line navigation
    else if (keyName === "home") {
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
    }
    // Control commands
    else if (keyCtrl && keyName === "a") {
      // Ctrl+A: Move to start of buffer
      this.editBuffer.setCursor(0, 0)
      return true
    } else if (keyCtrl && keyName === "e") {
      // Ctrl+E: Move to end of buffer
      this.gotoBufferEnd()
      return true
    } else if (keyCtrl && keyName === "d") {
      // Ctrl+D: Delete line
      this.deleteLine()
      return true
    } else if (keyCtrl && keyName === "k") {
      // Ctrl+K: Delete to line end
      this.deleteToLineEnd()
      return true
    }
    // Deletion
    else if (keyName === "backspace") {
      this.deleteCharBackward()
      return true
    } else if (keyName === "delete") {
      this.deleteChar()
      return true
    }
    // Line operations
    else if (keyName === "return" || keyName === "enter") {
      this.newLine()
      return true
    }
    // Character input - handle printable characters only
    // Filter to printable ASCII/Unicode (excludes control sequences)
    else if (keySequence && !keyCtrl && !keyMeta) {
      // Check if this is a printable character sequence
      // Allow single printable chars or multi-char Unicode sequences
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

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content !== value) {
      this._content = value
      this.updateContent(value)
    }
  }

  private updateContent(content: string): void {
    this.editBuffer.setText(content)
    this.yogaNode.markDirty()
    this.requestRender()
  }

  private updateColors(): void {
    super.backgroundColor = this._focused ? this._focusedBackgroundColor : this._unfocusedBackgroundColor
    super.textColor = this._focused ? this._focusedTextColor : this._unfocusedTextColor
  }

  // Editor operations - call EditBuffer directly
  public insertChar(char: string): void {
    // If there's a selection, delete it first (replace behavior)
    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    this.editBuffer.insertChar(char)
    this.requestRender()
  }

  public insertText(text: string): void {
    // If there's a selection, delete it first (replace behavior)
    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    this.editBuffer.insertText(text)
    this.requestRender()
  }

  public deleteChar(): void {
    // If there's a selection, delete the selected range instead
    if (this.hasSelection()) {
      this.deleteSelectedText()
      return
    }

    this._ctx.clearSelection()
    this.editBuffer.deleteChar()
    this.requestRender()
  }

  public deleteCharBackward(): void {
    // If there's a selection, delete the selected range instead
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

    // Clear the selection in the context
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

  // Cursor movement - call EditBuffer directly
  public moveCursorLeft(): void {
    this.editBuffer.moveCursorLeft()
    this.requestRender()
  }

  public moveCursorRight(): void {
    this.editBuffer.moveCursorRight()
    this.requestRender()
  }

  public moveCursorUp(): void {
    // Use visual movement to handle wrapped lines correctly
    this.editorView.moveUpVisual()
    this.requestRender()
  }

  public moveCursorDown(): void {
    // Use visual movement to handle wrapped lines correctly
    this.editorView.moveDownVisual()
    this.requestRender()
  }

  public gotoLine(line: number): void {
    this.editBuffer.gotoLine(line)
    this.requestRender()
  }

  public gotoLineEnd(): void {
    const cursor = this.editorView.getCursor()
    // Get line width and move cursor to end of current line
    this.editBuffer.gotoLine(9999) // Temp hack - move to way past end to trigger end-of-line
    const afterCursor = this.editorView.getCursor()
    // If we're not on the same line, we went too far, so set to the line we want
    if (afterCursor.row !== cursor.row) {
      this.editBuffer.setCursor(cursor.row, 9999) // Will clamp to line width
    }
    this.requestRender()
  }

  public gotoBufferEnd(): void {
    this.editBuffer.gotoLine(999999) // Will clamp to last line and go to end
    this.requestRender()
  }

  public deleteToLineEnd(): void {
    // Get current cursor position
    const cursor = this.editorView.getCursor()
    const startCol = cursor.col

    // Temporarily move to end of line to get the line width
    const tempCursor = this.editorView.getCursor()
    this.editBuffer.setCursor(tempCursor.row, 9999)
    const endCursor = this.editorView.getCursor()
    const endCol = endCursor.col

    // Restore cursor and delete if there's content to delete
    this.editBuffer.setCursor(cursor.row, startCol)

    if (endCol > startCol) {
      // Delete characters from cursor to end of line
      // We need to implement this via selection and delete
      // For now, just repeatedly delete forward
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
    if (!visualCursor) return

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

  protected renderSelf(buffer: OptimizedBuffer): void {
    const isEmpty = this._content.length === 0
    const shouldShowPlaceholder = isEmpty && this._placeholder && !this._focused

    if (shouldShowPlaceholder) {
      const originalTextColor = this._textColor
      this._textColor = this._placeholderColor

      this.editBuffer.setText(this._placeholder)
      buffer.drawEditorView(this.editorView, this.x, this.y)
      this.editBuffer.setText("")

      this._textColor = originalTextColor
    } else {
      buffer.drawEditorView(this.editorView, this.x, this.y)
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

  get placeholder(): string {
    return this._placeholder
  }

  set placeholder(value: string) {
    if (this._placeholder !== value) {
      this._placeholder = value
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
      this.requestRender()
    }
  }
}
