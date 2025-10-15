import { type RenderContext } from "../types"
import { EditBufferRenderable, type EditBufferOptions } from "./EditBufferRenderable"
import type { KeyEvent } from "../lib/KeyHandler"

export interface EditorOptions extends EditBufferOptions {
  content?: string
  interactive?: boolean
}

/**
 * EditorRenderable provides an interactive text editor with cursor management,
 * incremental editing, and grapheme-aware operations.
 */
export class EditorRenderable extends EditBufferRenderable {
  private _content: string
  private _interactive: boolean

  protected _contentDefaultOptions = {
    content: "",
    interactive: true,
  } satisfies Partial<EditorOptions>

  constructor(ctx: RenderContext, options: EditorOptions) {
    super(ctx, options)

    this._content = options.content ?? this._contentDefaultOptions.content
    this._interactive = options.interactive ?? this._contentDefaultOptions.interactive
    this.updateContent(this._content)
  }

  /**
   * Handle keyboard input for interactive editing.
   * This is called automatically when the editor is focused and a key is pressed.
   */
  public handleKeyPress(key: KeyEvent | string): boolean {
    if (!this._interactive) return false

    const keyName = typeof key === "string" ? key : key.name
    const keySequence = typeof key === "string" ? key : key.sequence
    const keyCtrl = typeof key === "string" ? false : key.ctrl
    const keyShift = typeof key === "string" ? false : key.shift
    const keyMeta = typeof key === "string" ? false : key.meta

    // Movement
    if (keyName === "left") {
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
      this.editorView.setCursor(cursor.row, 0)
      this.handleShiftSelection(keyShift, false)
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
    this.editorView.setText(content)
    this.yogaNode.markDirty()
    this.requestRender()
  }

  // Editor operations - delegate to EditorView (which handles EditBuffer + auto-scroll)
  public insertChar(char: string): void {
    // If there's a selection, delete it first (replace behavior)
    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    this.editorView.insertChar(char)
    this.requestRender()
  }

  public insertText(text: string): void {
    // If there's a selection, delete it first (replace behavior)
    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    this.editorView.insertText(text)
    this.requestRender()
  }

  public deleteChar(): void {
    // If there's a selection, delete the selected range instead
    if (this.hasSelection()) {
      this.deleteSelectedText()
      return
    }

    this._ctx.clearSelection()
    this.editorView.deleteChar()
    this.requestRender()
  }

  public deleteCharBackward(): void {
    // If there's a selection, delete the selected range instead
    if (this.hasSelection()) {
      this.deleteSelectedText()
      return
    }

    this._ctx.clearSelection()
    this.editorView.deleteCharBackward()
    this.requestRender()
  }

  private deleteSelectedText(): void {
    const selection = this.editorView.getSelection()
    if (!selection) return

    const { start, end } = selection

    // Get the text before and after the selection
    const fullText = this.editorView.getText()
    const before = fullText.substring(0, start)
    const after = fullText.substring(end)

    // Set the new text (this will reset cursor to start and ensure it's visible)
    this.editorView.setText(before + after)

    // Calculate the line and byte offset for the cursor position
    // Count newlines in 'before' to get the line number
    const beforeLines = before.split("\n")
    const targetLine = beforeLines.length - 1
    const byteOffsetInLine = beforeLines[beforeLines.length - 1].length

    // Set cursor to the start of where the deletion occurred (viewport-aware)
    this.editorView.setCursor(targetLine, byteOffsetInLine)

    // Clear the selection
    this._ctx.clearSelection()
    this.requestRender()
  }

  public newLine(): void {
    this._ctx.clearSelection()
    this.editorView.newLine()
    this.requestRender()
  }

  public deleteLine(): void {
    this._ctx.clearSelection()
    this.editorView.deleteLine()
    this.requestRender()
  }

  // Cursor movement - delegate to EditorView (which handles EditBuffer + auto-scroll)
  public moveCursorLeft(): void {
    this.editorView.moveCursorLeft()
    this.requestRender()
  }

  public moveCursorRight(): void {
    this.editorView.moveCursorRight()
    this.requestRender()
  }

  public moveCursorUp(): void {
    this.editorView.moveCursorUp()
    this.requestRender()
  }

  public moveCursorDown(): void {
    this.editorView.moveCursorDown()
    this.requestRender()
  }

  public gotoLine(line: number): void {
    this.editorView.gotoLine(line)
    this.requestRender()
  }

  /**
   * Handle keyboard-based selection with shift modifier.
   * Called before and after cursor movement to track selection boundaries.
   * Uses the same selection system as mouse-based selection.
   */
  private handleShiftSelection(shiftPressed: boolean, isBeforeMovement: boolean): void {
    if (!this.selectable) return

    if (!shiftPressed) {
      // Clear selection when shift is not pressed
      this._ctx.clearSelection()
      return
    }

    // Get current cursor position
    const cursor = this.cursor
    const viewport = this.editorView.getViewport()

    // Calculate screen position accounting for viewport scrolling
    const cursorX = this.x + cursor.visualColumn
    const cursorY = this.y + (cursor.line - viewport.offsetY)

    if (isBeforeMovement) {
      // Before movement: start selection if not already active
      if (!this._ctx.hasSelection) {
        this._ctx.startSelection(this, cursorX, cursorY)
      }
    } else {
      // After movement: update selection focus to new cursor position
      this._ctx.updateSelection(this, cursorX, cursorY)
    }
  }
}
