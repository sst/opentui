import type { TextareaRenderable } from "../renderables/Textarea"
import { EventEmitter } from "events"

export interface Extmark {
  id: number
  start: number
  end: number
  virtual: boolean
  styleId?: number
  priority?: number
  data?: any
}

export interface ExtmarkDeletedEvent {
  extmark: Extmark
  trigger: "backspace" | "delete" | "manual"
}

export interface ExtmarkOptions {
  start: number
  end: number
  virtual?: boolean
  styleId?: number
  priority?: number
  data?: any
}

export interface ExtmarksControllerEvents {
  "extmark-deleted": (event: ExtmarkDeletedEvent) => void
  "extmark-updated": (extmark: Extmark) => void
}

export class ExtmarksController extends EventEmitter {
  private textarea: TextareaRenderable
  private extmarks = new Map<number, Extmark>()
  private nextId = 1
  private destroyed = false

  private originalMoveCursorLeft: typeof TextareaRenderable.prototype.moveCursorLeft
  private originalMoveCursorRight: typeof TextareaRenderable.prototype.moveCursorRight
  private originalMoveWordForward: typeof TextareaRenderable.prototype.moveWordForward
  private originalMoveWordBackward: typeof TextareaRenderable.prototype.moveWordBackward
  private originalDeleteCharBackward: typeof TextareaRenderable.prototype.deleteCharBackward
  private originalDeleteChar: typeof TextareaRenderable.prototype.deleteChar
  private originalInsertText: typeof TextareaRenderable.prototype.insertText
  private originalInsertChar: typeof TextareaRenderable.prototype.insertChar
  private originalDeleteRange: typeof TextareaRenderable.prototype.deleteRange
  private originalSetText: typeof TextareaRenderable.prototype.setText
  private originalClear: typeof TextareaRenderable.prototype.clear
  private originalNewLine: typeof TextareaRenderable.prototype.newLine
  private originalDeleteLine: typeof TextareaRenderable.prototype.deleteLine
  private originalDeleteToLineEnd: typeof TextareaRenderable.prototype.deleteToLineEnd
  private originalDeleteWordForward: typeof TextareaRenderable.prototype.deleteWordForward
  private originalDeleteWordBackward: typeof TextareaRenderable.prototype.deleteWordBackward
  private originalEditorViewDeleteSelectedText: typeof TextareaRenderable.prototype.editorView.deleteSelectedText

  constructor(textarea: TextareaRenderable) {
    super()
    this.textarea = textarea

    this.originalMoveCursorLeft = textarea.moveCursorLeft.bind(textarea)
    this.originalMoveCursorRight = textarea.moveCursorRight.bind(textarea)
    this.originalMoveWordForward = textarea.moveWordForward.bind(textarea)
    this.originalMoveWordBackward = textarea.moveWordBackward.bind(textarea)
    this.originalDeleteCharBackward = textarea.deleteCharBackward.bind(textarea)
    this.originalDeleteChar = textarea.deleteChar.bind(textarea)
    this.originalInsertText = textarea.insertText.bind(textarea)
    this.originalInsertChar = textarea.insertChar.bind(textarea)
    this.originalDeleteRange = textarea.deleteRange.bind(textarea)
    this.originalSetText = textarea.setText.bind(textarea)
    this.originalClear = textarea.clear.bind(textarea)
    this.originalNewLine = textarea.newLine.bind(textarea)
    this.originalDeleteLine = textarea.deleteLine.bind(textarea)
    this.originalDeleteToLineEnd = textarea.deleteToLineEnd.bind(textarea)
    this.originalDeleteWordForward = textarea.deleteWordForward.bind(textarea)
    this.originalDeleteWordBackward = textarea.deleteWordBackward.bind(textarea)
    this.originalEditorViewDeleteSelectedText = textarea.editorView.deleteSelectedText.bind(textarea.editorView)

    this.wrapCursorMovement()
    this.wrapDeletion()
    this.wrapInsertion()
    this.wrapEditorViewDeleteSelectedText()
    this.setupContentChangeListener()
  }

  private wrapCursorMovement(): void {
    this.textarea.moveCursorLeft = (options?: { select?: boolean }): boolean => {
      if (this.destroyed) return this.originalMoveCursorLeft(options)

      const currentOffset = this.textarea.cursorOffset
      const select = options?.select ?? false

      if (select) {
        return this.originalMoveCursorLeft(options)
      }

      const targetOffset = currentOffset - 1
      if (targetOffset < 0) {
        return this.originalMoveCursorLeft(options)
      }

      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset)
      if (virtualExtmark && currentOffset >= virtualExtmark.end) {
        this.textarea.cursorOffset = virtualExtmark.start - 1
        return true
      }

      return this.originalMoveCursorLeft(options)
    }

    this.textarea.moveCursorRight = (options?: { select?: boolean }): boolean => {
      if (this.destroyed) return this.originalMoveCursorRight(options)

      const currentOffset = this.textarea.cursorOffset
      const select = options?.select ?? false

      if (select) {
        return this.originalMoveCursorRight(options)
      }

      const targetOffset = currentOffset + 1
      const textLength = this.textarea.plainText.length

      if (targetOffset > textLength) {
        return this.originalMoveCursorRight(options)
      }

      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset)
      if (virtualExtmark && currentOffset <= virtualExtmark.start) {
        this.textarea.cursorOffset = virtualExtmark.end
        return true
      }

      return this.originalMoveCursorRight(options)
    }

    this.textarea.moveWordForward = (options?: { select?: boolean }): boolean => {
      if (this.destroyed) return this.originalMoveWordForward(options)

      const select = options?.select ?? false

      if (select) {
        return this.originalMoveWordForward(options)
      }

      const currentOffset = this.textarea.cursorOffset
      const result = this.originalMoveWordForward(options)
      const newOffset = this.textarea.cursorOffset

      const virtualExtmark = this.findVirtualExtmarkContaining(newOffset)
      if (virtualExtmark && currentOffset <= virtualExtmark.start) {
        this.textarea.cursorOffset = virtualExtmark.end
        return true
      }

      return result
    }

    this.textarea.moveWordBackward = (options?: { select?: boolean }): boolean => {
      if (this.destroyed) return this.originalMoveWordBackward(options)

      const select = options?.select ?? false

      if (select) {
        return this.originalMoveWordBackward(options)
      }

      const currentOffset = this.textarea.cursorOffset
      const result = this.originalMoveWordBackward(options)
      const newOffset = this.textarea.cursorOffset

      for (const extmark of this.extmarks.values()) {
        if (extmark.virtual && currentOffset >= extmark.end && newOffset < extmark.end && newOffset >= extmark.start) {
          this.textarea.cursorOffset = extmark.start - 1
          return true
        }
      }

      return result
    }
  }

  private wrapDeletion(): void {
    this.textarea.deleteCharBackward = (): boolean => {
      if (this.destroyed) return this.originalDeleteCharBackward()

      const currentOffset = this.textarea.cursorOffset
      const hadSelection = this.textarea.hasSelection()

      if (currentOffset === 0) {
        return this.originalDeleteCharBackward()
      }

      if (hadSelection) {
        return this.originalDeleteCharBackward()
      }

      const targetOffset = currentOffset - 1
      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset)

      if (virtualExtmark && currentOffset === virtualExtmark.end) {
        const startCursor = this.offsetToPosition(virtualExtmark.start)
        const endCursor = this.offsetToPosition(virtualExtmark.end)
        const deleteOffset = virtualExtmark.start
        const deleteLength = virtualExtmark.end - virtualExtmark.start

        this.extmarks.delete(virtualExtmark.id)

        this.originalDeleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength)

        this.emit("extmark-deleted", {
          extmark: virtualExtmark,
          trigger: "backspace",
        } as ExtmarkDeletedEvent)

        this.updateHighlights()

        return true
      }

      const result = this.originalDeleteCharBackward()
      if (result) {
        this.adjustExtmarksAfterDeletion(targetOffset, 1)
      }
      return result
    }

    this.textarea.deleteChar = (): boolean => {
      if (this.destroyed) return this.originalDeleteChar()

      const currentOffset = this.textarea.cursorOffset
      const textLength = this.textarea.plainText.length
      const hadSelection = this.textarea.hasSelection()

      if (currentOffset >= textLength) {
        return this.originalDeleteChar()
      }

      if (hadSelection) {
        return this.originalDeleteChar()
      }

      const targetOffset = currentOffset
      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset)

      if (virtualExtmark && currentOffset === virtualExtmark.start) {
        const startCursor = this.offsetToPosition(virtualExtmark.start)
        const endCursor = this.offsetToPosition(virtualExtmark.end)
        const deleteOffset = virtualExtmark.start
        const deleteLength = virtualExtmark.end - virtualExtmark.start

        this.extmarks.delete(virtualExtmark.id)

        this.originalDeleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength)

        this.emit("extmark-deleted", {
          extmark: virtualExtmark,
          trigger: "delete",
        } as ExtmarkDeletedEvent)

        this.updateHighlights()

        return true
      }

      const result = this.originalDeleteChar()
      if (result) {
        this.adjustExtmarksAfterDeletion(targetOffset, 1)
      }
      return result
    }

    this.textarea.deleteRange = (startLine: number, startCol: number, endLine: number, endCol: number): void => {
      if (this.destroyed) {
        this.originalDeleteRange(startLine, startCol, endLine, endCol)
        return
      }

      const startOffset = this.positionToOffset(startLine, startCol)
      const endOffset = this.positionToOffset(endLine, endCol)
      const length = endOffset - startOffset

      this.originalDeleteRange(startLine, startCol, endLine, endCol)
      this.adjustExtmarksAfterDeletion(startOffset, length)
    }
  }

  private wrapInsertion(): void {
    this.textarea.insertText = (text: string): void => {
      if (this.destroyed) {
        this.originalInsertText(text)
        return
      }

      const currentOffset = this.textarea.cursorOffset
      this.originalInsertText(text)
      this.adjustExtmarksAfterInsertion(currentOffset, text.length)
    }

    this.textarea.insertChar = (char: string): void => {
      if (this.destroyed) {
        this.originalInsertChar(char)
        return
      }

      const currentOffset = this.textarea.cursorOffset
      this.originalInsertChar(char)
      this.adjustExtmarksAfterInsertion(currentOffset, 1)
    }

    this.textarea.setText = (text: string, opts?: { history?: boolean }): void => {
      if (this.destroyed) {
        this.originalSetText(text, opts)
        return
      }

      this.clear()
      this.originalSetText(text, opts)
    }

    this.textarea.clear = (): void => {
      if (this.destroyed) {
        this.originalClear()
        return
      }

      this.clear()
      this.originalClear()
    }

    this.textarea.newLine = (): boolean => {
      if (this.destroyed) return this.originalNewLine()

      const currentOffset = this.textarea.cursorOffset
      const result = this.originalNewLine()
      this.adjustExtmarksAfterInsertion(currentOffset, 1)
      return result
    }

    this.textarea.deleteLine = (): boolean => {
      if (this.destroyed) return this.originalDeleteLine()

      const text = this.textarea.plainText
      const currentOffset = this.textarea.cursorOffset

      let lineStart = 0
      for (let i = currentOffset - 1; i >= 0; i--) {
        if (text[i] === "\n") {
          lineStart = i + 1
          break
        }
      }

      let lineEnd = text.length
      for (let i = currentOffset; i < text.length; i++) {
        if (text[i] === "\n") {
          lineEnd = i + 1
          break
        }
      }

      const deleteLength = lineEnd - lineStart

      const result = this.originalDeleteLine()
      this.adjustExtmarksAfterDeletion(lineStart, deleteLength)
      return result
    }

    this.textarea.deleteToLineEnd = (): boolean => {
      if (this.destroyed) return this.originalDeleteToLineEnd()

      const text = this.textarea.plainText
      const currentOffset = this.textarea.cursorOffset

      let lineEnd = text.length
      for (let i = currentOffset; i < text.length; i++) {
        if (text[i] === "\n") {
          lineEnd = i
          break
        }
      }

      const deleteLength = lineEnd - currentOffset

      const result = this.originalDeleteToLineEnd()
      if (deleteLength > 0) {
        this.adjustExtmarksAfterDeletion(currentOffset, deleteLength)
      }
      return result
    }

    this.textarea.deleteWordForward = (): boolean => {
      if (this.destroyed) return this.originalDeleteWordForward()

      const currentOffset = this.textarea.cursorOffset
      const currentCursor = this.textarea.editBuffer.getCursorPosition()
      const nextWord = this.textarea.editBuffer.getNextWordBoundary()

      const deleteLength = nextWord.offset - currentCursor.offset

      const result = this.originalDeleteWordForward()
      if (deleteLength > 0) {
        this.adjustExtmarksAfterDeletion(currentOffset, deleteLength)
      }
      return result
    }

    this.textarea.deleteWordBackward = (): boolean => {
      if (this.destroyed) return this.originalDeleteWordBackward()

      const currentCursor = this.textarea.editBuffer.getCursorPosition()
      const prevWord = this.textarea.editBuffer.getPrevWordBoundary()

      const deleteOffset = prevWord.offset
      const deleteLength = currentCursor.offset - prevWord.offset

      const result = this.originalDeleteWordBackward()
      if (deleteLength > 0) {
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength)
      }
      return result
    }
  }

  private wrapEditorViewDeleteSelectedText(): void {
    this.textarea.editorView.deleteSelectedText = (): void => {
      if (this.destroyed) {
        this.originalEditorViewDeleteSelectedText()
        return
      }

      const selection = this.textarea.getSelection()
      if (!selection) {
        this.originalEditorViewDeleteSelectedText()
        return
      }

      const deleteOffset = Math.min(selection.start, selection.end)
      const deleteLength = Math.abs(selection.end - selection.start)

      this.originalEditorViewDeleteSelectedText()

      if (deleteLength > 0) {
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength)
      }
    }
  }

  private setupContentChangeListener(): void {
    this.textarea.editBuffer.on("content-changed", () => {
      if (this.destroyed) return
      this.updateHighlights()
    })
  }

  private findVirtualExtmarkContaining(offset: number): Extmark | null {
    for (const extmark of this.extmarks.values()) {
      if (extmark.virtual && offset >= extmark.start && offset < extmark.end) {
        return extmark
      }
    }
    return null
  }

  private adjustExtmarksAfterInsertion(insertOffset: number, length: number): void {
    for (const extmark of this.extmarks.values()) {
      if (extmark.start >= insertOffset) {
        extmark.start += length
        extmark.end += length
        this.emit("extmark-updated", extmark)
      } else if (extmark.end > insertOffset) {
        extmark.end += length
        this.emit("extmark-updated", extmark)
      }
    }
    this.updateHighlights()
  }

  public adjustExtmarksAfterDeletion(deleteOffset: number, length: number): void {
    const toDelete: number[] = []

    for (const extmark of this.extmarks.values()) {
      if (extmark.end <= deleteOffset) {
        continue
      }

      if (extmark.start >= deleteOffset + length) {
        extmark.start -= length
        extmark.end -= length
        this.emit("extmark-updated", extmark)
      } else if (extmark.start >= deleteOffset && extmark.end <= deleteOffset + length) {
        toDelete.push(extmark.id)
      } else if (extmark.start < deleteOffset && extmark.end > deleteOffset + length) {
        extmark.end -= length
        this.emit("extmark-updated", extmark)
      } else if (extmark.start < deleteOffset && extmark.end > deleteOffset) {
        extmark.end -= Math.min(extmark.end, deleteOffset + length) - deleteOffset
        this.emit("extmark-updated", extmark)
      } else if (extmark.start < deleteOffset + length && extmark.end > deleteOffset + length) {
        const overlap = deleteOffset + length - extmark.start
        extmark.start = deleteOffset
        extmark.end -= length
        this.emit("extmark-updated", extmark)
      }
    }

    for (const id of toDelete) {
      const extmark = this.extmarks.get(id)
      if (extmark) {
        this.extmarks.delete(id)
        this.emit("extmark-deleted", {
          extmark,
          trigger: "manual",
        } as ExtmarkDeletedEvent)
      }
    }

    this.updateHighlights()
  }

  private offsetToPosition(offset: number): { row: number; col: number } {
    const text = this.textarea.plainText
    let currentOffset = 0
    let row = 0
    let col = 0

    for (let i = 0; i < text.length && currentOffset < offset; i++) {
      if (text[i] === "\n") {
        row++
        col = 0
      } else {
        col++
      }
      currentOffset++
    }

    return { row, col }
  }

  private positionToOffset(row: number, col: number): number {
    const text = this.textarea.plainText
    let currentRow = 0
    let offset = 0

    for (let i = 0; i < text.length; i++) {
      if (currentRow === row && offset - this.getLineStartOffset(row) === col) {
        return offset
      }
      if (text[i] === "\n") {
        currentRow++
      }
      offset++
    }

    return offset
  }

  private getLineStartOffset(targetRow: number): number {
    const text = this.textarea.plainText
    let row = 0
    let offset = 0

    for (let i = 0; i < text.length; i++) {
      if (row === targetRow) {
        return offset
      }
      if (text[i] === "\n") {
        row++
        offset = i + 1
      }
    }

    return offset
  }

  private updateHighlights(): void {
    this.textarea.clearAllHighlights()

    for (const extmark of this.extmarks.values()) {
      if (extmark.styleId !== undefined) {
        const startWithoutNewlines = this.offsetToCharOffset(extmark.start)
        const endWithoutNewlines = this.offsetToCharOffset(extmark.end)

        this.textarea.addHighlightByCharRange({
          start: startWithoutNewlines,
          end: endWithoutNewlines,
          styleId: extmark.styleId,
          priority: extmark.priority ?? 0,
          hlRef: extmark.id,
        })
      }
    }
  }

  private offsetToCharOffset(offset: number): number {
    const text = this.textarea.plainText
    let charOffset = 0

    for (let i = 0; i < offset && i < text.length; i++) {
      if (text[i] !== "\n") {
        charOffset++
      }
    }

    return charOffset
  }

  public create(options: ExtmarkOptions): number {
    if (this.destroyed) {
      throw new Error("ExtmarksController is destroyed")
    }

    const id = this.nextId++
    const extmark: Extmark = {
      id,
      start: options.start,
      end: options.end,
      virtual: options.virtual ?? false,
      styleId: options.styleId,
      priority: options.priority,
      data: options.data,
    }

    this.extmarks.set(id, extmark)
    this.updateHighlights()

    return id
  }

  public update(id: number, options: Partial<ExtmarkOptions>): boolean {
    if (this.destroyed) {
      throw new Error("ExtmarksController is destroyed")
    }

    const extmark = this.extmarks.get(id)
    if (!extmark) return false

    if (options.start !== undefined) extmark.start = options.start
    if (options.end !== undefined) extmark.end = options.end
    if (options.virtual !== undefined) extmark.virtual = options.virtual
    if (options.styleId !== undefined) extmark.styleId = options.styleId
    if (options.priority !== undefined) extmark.priority = options.priority
    if (options.data !== undefined) extmark.data = options.data

    this.emit("extmark-updated", extmark)
    this.updateHighlights()

    return true
  }

  public delete(id: number): boolean {
    if (this.destroyed) {
      throw new Error("ExtmarksController is destroyed")
    }

    const extmark = this.extmarks.get(id)
    if (!extmark) return false

    this.extmarks.delete(id)
    this.emit("extmark-deleted", {
      extmark,
      trigger: "manual",
    } as ExtmarkDeletedEvent)
    this.updateHighlights()

    return true
  }

  public get(id: number): Extmark | null {
    if (this.destroyed) return null
    return this.extmarks.get(id) ?? null
  }

  public getAll(): Extmark[] {
    if (this.destroyed) return []
    return Array.from(this.extmarks.values())
  }

  public getVirtual(): Extmark[] {
    if (this.destroyed) return []
    return Array.from(this.extmarks.values()).filter((e) => e.virtual)
  }

  public getAtOffset(offset: number): Extmark[] {
    if (this.destroyed) return []
    return Array.from(this.extmarks.values()).filter((e) => offset >= e.start && offset < e.end)
  }

  public clear(): void {
    if (this.destroyed) return

    for (const extmark of this.extmarks.values()) {
      this.emit("extmark-deleted", {
        extmark,
        trigger: "manual",
      } as ExtmarkDeletedEvent)
    }

    this.extmarks.clear()
    this.updateHighlights()
  }

  public destroy(): void {
    if (this.destroyed) return

    this.textarea.moveCursorLeft = this.originalMoveCursorLeft
    this.textarea.moveCursorRight = this.originalMoveCursorRight
    this.textarea.moveWordForward = this.originalMoveWordForward
    this.textarea.moveWordBackward = this.originalMoveWordBackward
    this.textarea.deleteCharBackward = this.originalDeleteCharBackward
    this.textarea.deleteChar = this.originalDeleteChar
    this.textarea.insertText = this.originalInsertText
    this.textarea.insertChar = this.originalInsertChar
    this.textarea.deleteRange = this.originalDeleteRange
    this.textarea.setText = this.originalSetText
    this.textarea.clear = this.originalClear
    this.textarea.newLine = this.originalNewLine
    this.textarea.deleteLine = this.originalDeleteLine
    this.textarea.deleteToLineEnd = this.originalDeleteToLineEnd
    this.textarea.deleteWordForward = this.originalDeleteWordForward
    this.textarea.deleteWordBackward = this.originalDeleteWordBackward
    this.textarea.editorView.deleteSelectedText = this.originalEditorViewDeleteSelectedText

    this.extmarks.clear()
    this.destroyed = true
    this.removeAllListeners()
  }
}

export function createExtmarksController(textarea: TextareaRenderable): ExtmarksController {
  return new ExtmarksController(textarea)
}
