import type { EditBuffer } from "../edit-buffer"
import type { EditorView } from "../editor-view"
import { EventEmitter } from "events"
import { ExtmarksHistory, type ExtmarksSnapshot } from "./extmarks-history"

export interface Extmark {
  id: number
  start: number
  end: number
  virtual: boolean
  styleId?: number
  priority?: number
  data?: any
  typeId: number
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
  typeId?: number
}

export interface ExtmarksControllerEvents {
  "extmark-deleted": (event: ExtmarkDeletedEvent) => void
  "extmark-updated": (extmark: Extmark) => void
}

export class ExtmarksController extends EventEmitter {
  private editBuffer: EditBuffer
  private editorView: EditorView
  private extmarks = new Map<number, Extmark>()
  private extmarksByTypeId = new Map<number, Set<number>>()
  private nextId = 1
  private destroyed = false
  private history = new ExtmarksHistory()

  private originalMoveCursorLeft: typeof EditBuffer.prototype.moveCursorLeft
  private originalMoveCursorRight: typeof EditBuffer.prototype.moveCursorRight
  private originalSetCursorByOffset: typeof EditBuffer.prototype.setCursorByOffset
  private originalMoveUpVisual: typeof EditorView.prototype.moveUpVisual
  private originalMoveDownVisual: typeof EditorView.prototype.moveDownVisual
  private originalDeleteCharBackward: typeof EditBuffer.prototype.deleteCharBackward
  private originalDeleteChar: typeof EditBuffer.prototype.deleteChar
  private originalInsertText: typeof EditBuffer.prototype.insertText
  private originalInsertChar: typeof EditBuffer.prototype.insertChar
  private originalDeleteRange: typeof EditBuffer.prototype.deleteRange
  private originalSetText: typeof EditBuffer.prototype.setText
  private originalClear: typeof EditBuffer.prototype.clear
  private originalNewLine: typeof EditBuffer.prototype.newLine
  private originalDeleteLine: typeof EditBuffer.prototype.deleteLine
  private originalEditorViewDeleteSelectedText: typeof EditorView.prototype.deleteSelectedText
  private originalUndo: typeof EditBuffer.prototype.undo
  private originalRedo: typeof EditBuffer.prototype.redo

  constructor(editBuffer: EditBuffer, editorView: EditorView) {
    super()
    this.editBuffer = editBuffer
    this.editorView = editorView

    this.originalMoveCursorLeft = editBuffer.moveCursorLeft.bind(editBuffer)
    this.originalMoveCursorRight = editBuffer.moveCursorRight.bind(editBuffer)
    this.originalSetCursorByOffset = editBuffer.setCursorByOffset.bind(editBuffer)
    this.originalMoveUpVisual = editorView.moveUpVisual.bind(editorView)
    this.originalMoveDownVisual = editorView.moveDownVisual.bind(editorView)
    this.originalDeleteCharBackward = editBuffer.deleteCharBackward.bind(editBuffer)
    this.originalDeleteChar = editBuffer.deleteChar.bind(editBuffer)
    this.originalInsertText = editBuffer.insertText.bind(editBuffer)
    this.originalInsertChar = editBuffer.insertChar.bind(editBuffer)
    this.originalDeleteRange = editBuffer.deleteRange.bind(editBuffer)
    this.originalSetText = editBuffer.setText.bind(editBuffer)
    this.originalClear = editBuffer.clear.bind(editBuffer)
    this.originalNewLine = editBuffer.newLine.bind(editBuffer)
    this.originalDeleteLine = editBuffer.deleteLine.bind(editBuffer)
    this.originalEditorViewDeleteSelectedText = editorView.deleteSelectedText.bind(editorView)
    this.originalUndo = editBuffer.undo.bind(editBuffer)
    this.originalRedo = editBuffer.redo.bind(editBuffer)

    this.wrapCursorMovement()
    this.wrapDeletion()
    this.wrapInsertion()
    this.wrapEditorViewDeleteSelectedText()
    this.wrapUndoRedo()
    this.setupContentChangeListener()
  }

  private wrapCursorMovement(): void {
    this.editBuffer.moveCursorLeft = (): void => {
      if (this.destroyed) {
        this.originalMoveCursorLeft()
        return
      }

      const currentOffset = this.editorView.getVisualCursor().offset
      const hasSelection = this.editorView.hasSelection()

      if (hasSelection) {
        this.originalMoveCursorLeft()
        return
      }

      const targetOffset = currentOffset - 1
      if (targetOffset < 0) {
        this.originalMoveCursorLeft()
        return
      }

      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset)
      if (virtualExtmark && currentOffset >= virtualExtmark.end) {
        this.editBuffer.setCursorByOffset(virtualExtmark.start - 1)
        return
      }

      this.originalMoveCursorLeft()
    }

    this.editBuffer.moveCursorRight = (): void => {
      if (this.destroyed) {
        this.originalMoveCursorRight()
        return
      }

      const currentOffset = this.editorView.getVisualCursor().offset
      const hasSelection = this.editorView.hasSelection()

      if (hasSelection) {
        this.originalMoveCursorRight()
        return
      }

      const targetOffset = currentOffset + 1
      const textLength = this.editBuffer.getText().length

      if (targetOffset > textLength) {
        this.originalMoveCursorRight()
        return
      }

      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset)
      if (virtualExtmark && currentOffset <= virtualExtmark.start) {
        this.editBuffer.setCursorByOffset(virtualExtmark.end)
        return
      }

      this.originalMoveCursorRight()
    }

    this.editorView.moveUpVisual = (): void => {
      if (this.destroyed) {
        this.originalMoveUpVisual()
        return
      }

      const hasSelection = this.editorView.hasSelection()

      if (hasSelection) {
        this.originalMoveUpVisual()
        return
      }

      const currentOffset = this.editorView.getVisualCursor().offset
      this.originalMoveUpVisual()
      const newOffset = this.editorView.getVisualCursor().offset

      const virtualExtmark = this.findVirtualExtmarkContaining(newOffset)
      if (virtualExtmark) {
        const distanceToStart = newOffset - virtualExtmark.start
        const distanceToEnd = virtualExtmark.end - newOffset

        if (distanceToStart < distanceToEnd) {
          this.editorView.setCursorByOffset(virtualExtmark.start - 1)
        } else {
          this.editorView.setCursorByOffset(virtualExtmark.end)
        }
      }
    }

    this.editorView.moveDownVisual = (): void => {
      if (this.destroyed) {
        this.originalMoveDownVisual()
        return
      }

      const hasSelection = this.editorView.hasSelection()

      if (hasSelection) {
        this.originalMoveDownVisual()
        return
      }

      const currentOffset = this.editorView.getVisualCursor().offset
      this.originalMoveDownVisual()
      const newOffset = this.editorView.getVisualCursor().offset

      const virtualExtmark = this.findVirtualExtmarkContaining(newOffset)
      if (virtualExtmark) {
        const distanceToStart = newOffset - virtualExtmark.start
        const distanceToEnd = virtualExtmark.end - newOffset

        if (distanceToStart < distanceToEnd) {
          this.editorView.setCursorByOffset(virtualExtmark.start - 1)
        } else {
          this.editorView.setCursorByOffset(virtualExtmark.end)
        }
      }
    }

    this.editBuffer.setCursorByOffset = (offset: number): void => {
      if (this.destroyed) {
        this.originalSetCursorByOffset(offset)
        return
      }

      const currentOffset = this.editorView.getVisualCursor().offset
      const hasSelection = this.editorView.hasSelection()

      if (hasSelection) {
        this.originalSetCursorByOffset(offset)
        return
      }

      const movingForward = offset > currentOffset

      if (movingForward) {
        const virtualExtmark = this.findVirtualExtmarkContaining(offset)
        if (virtualExtmark && currentOffset <= virtualExtmark.start) {
          this.originalSetCursorByOffset(virtualExtmark.end)
          return
        }
      } else {
        for (const extmark of this.extmarks.values()) {
          if (extmark.virtual && currentOffset >= extmark.end && offset < extmark.end && offset >= extmark.start) {
            this.originalSetCursorByOffset(extmark.start - 1)
            return
          }
        }
      }

      this.originalSetCursorByOffset(offset)
    }
  }

  private wrapDeletion(): void {
    this.editBuffer.deleteCharBackward = (): void => {
      if (this.destroyed) {
        this.originalDeleteCharBackward()
        return
      }

      this.saveSnapshot()

      const currentOffset = this.editorView.getVisualCursor().offset
      const hadSelection = this.editorView.hasSelection()

      if (currentOffset === 0) {
        this.originalDeleteCharBackward()
        return
      }

      if (hadSelection) {
        this.originalDeleteCharBackward()
        return
      }

      const targetOffset = currentOffset - 1
      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset)

      if (virtualExtmark && currentOffset === virtualExtmark.end) {
        const startCursor = this.offsetToPosition(virtualExtmark.start)
        const endCursor = this.offsetToPosition(virtualExtmark.end)
        const deleteOffset = virtualExtmark.start
        const deleteLength = virtualExtmark.end - virtualExtmark.start

        this.deleteExtmarkById(virtualExtmark.id)

        this.originalDeleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength)

        this.emit("extmark-deleted", {
          extmark: virtualExtmark,
          trigger: "backspace",
        } as ExtmarkDeletedEvent)

        this.updateHighlights()

        return
      }

      this.originalDeleteCharBackward()
      this.adjustExtmarksAfterDeletion(targetOffset, 1)
    }

    this.editBuffer.deleteChar = (): void => {
      if (this.destroyed) {
        this.originalDeleteChar()
        return
      }

      this.saveSnapshot()

      const currentOffset = this.editorView.getVisualCursor().offset
      const textLength = this.editBuffer.getText().length
      const hadSelection = this.editorView.hasSelection()

      if (currentOffset >= textLength) {
        this.originalDeleteChar()
        return
      }

      if (hadSelection) {
        this.originalDeleteChar()
        return
      }

      const targetOffset = currentOffset
      const virtualExtmark = this.findVirtualExtmarkContaining(targetOffset)

      if (virtualExtmark && currentOffset === virtualExtmark.start) {
        const startCursor = this.offsetToPosition(virtualExtmark.start)
        const endCursor = this.offsetToPosition(virtualExtmark.end)
        const deleteOffset = virtualExtmark.start
        const deleteLength = virtualExtmark.end - virtualExtmark.start

        this.deleteExtmarkById(virtualExtmark.id)

        this.originalDeleteRange(startCursor.row, startCursor.col, endCursor.row, endCursor.col)
        this.adjustExtmarksAfterDeletion(deleteOffset, deleteLength)

        this.emit("extmark-deleted", {
          extmark: virtualExtmark,
          trigger: "delete",
        } as ExtmarkDeletedEvent)

        this.updateHighlights()

        return
      }

      this.originalDeleteChar()
      this.adjustExtmarksAfterDeletion(targetOffset, 1)
    }

    this.editBuffer.deleteRange = (startLine: number, startCol: number, endLine: number, endCol: number): void => {
      if (this.destroyed) {
        this.originalDeleteRange(startLine, startCol, endLine, endCol)
        return
      }

      this.saveSnapshot()

      const startOffset = this.positionToOffset(startLine, startCol)
      const endOffset = this.positionToOffset(endLine, endCol)
      const length = endOffset - startOffset

      this.originalDeleteRange(startLine, startCol, endLine, endCol)
      this.adjustExtmarksAfterDeletion(startOffset, length)
    }

    this.editBuffer.deleteLine = (): void => {
      if (this.destroyed) {
        this.originalDeleteLine()
        return
      }

      this.saveSnapshot()

      const text = this.editBuffer.getText()
      const currentOffset = this.editorView.getVisualCursor().offset

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

      this.originalDeleteLine()
      this.adjustExtmarksAfterDeletion(lineStart, deleteLength)
    }
  }

  private wrapInsertion(): void {
    this.editBuffer.insertText = (text: string): void => {
      if (this.destroyed) {
        this.originalInsertText(text)
        return
      }

      this.saveSnapshot()

      const currentOffset = this.editorView.getVisualCursor().offset
      this.originalInsertText(text)
      this.adjustExtmarksAfterInsertion(currentOffset, text.length)
    }

    this.editBuffer.insertChar = (char: string): void => {
      if (this.destroyed) {
        this.originalInsertChar(char)
        return
      }

      this.saveSnapshot()

      const currentOffset = this.editorView.getVisualCursor().offset
      this.originalInsertChar(char)
      this.adjustExtmarksAfterInsertion(currentOffset, 1)
    }

    this.editBuffer.setText = (text: string, opts?: { history?: boolean }): void => {
      if (this.destroyed) {
        this.originalSetText(text, opts)
        return
      }

      if (opts?.history !== false) {
        this.saveSnapshot()
      }

      this.clear()
      this.originalSetText(text, opts)
    }

    this.editBuffer.clear = (): void => {
      if (this.destroyed) {
        this.originalClear()
        return
      }

      this.saveSnapshot()

      this.clear()
      this.originalClear()
    }

    this.editBuffer.newLine = (): void => {
      if (this.destroyed) {
        this.originalNewLine()
        return
      }

      this.saveSnapshot()

      const currentOffset = this.editorView.getVisualCursor().offset
      this.originalNewLine()
      this.adjustExtmarksAfterInsertion(currentOffset, 1)
    }
  }

  private wrapEditorViewDeleteSelectedText(): void {
    this.editorView.deleteSelectedText = (): void => {
      if (this.destroyed) {
        this.originalEditorViewDeleteSelectedText()
        return
      }

      this.saveSnapshot()

      const selection = this.editorView.getSelection()
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
    this.editBuffer.on("content-changed", () => {
      if (this.destroyed) return
      this.updateHighlights()
    })
  }

  private deleteExtmarkById(id: number): void {
    const extmark = this.extmarks.get(id)
    if (extmark) {
      this.extmarks.delete(id)
      this.extmarksByTypeId.get(extmark.typeId)?.delete(id)
    }
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
        this.deleteExtmarkById(id)
        this.emit("extmark-deleted", {
          extmark,
          trigger: "manual",
        } as ExtmarkDeletedEvent)
      }
    }

    this.updateHighlights()
  }

  // TODO: use native transform method
  private offsetToPosition(offset: number): { row: number; col: number } {
    const text = this.editBuffer.getText()
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

  // TODO: use native transform method
  private positionToOffset(row: number, col: number): number {
    const text = this.editBuffer.getText()
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

  // TODO: Use a lineDetails method from native
  private getLineStartOffset(targetRow: number): number {
    const text = this.editBuffer.getText()
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
    this.editBuffer.clearAllHighlights()

    for (const extmark of this.extmarks.values()) {
      if (extmark.styleId !== undefined) {
        const startWithoutNewlines = this.offsetToCharOffset(extmark.start)
        const endWithoutNewlines = this.offsetToCharOffset(extmark.end)

        this.editBuffer.addHighlightByCharRange({
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
    const text = this.editBuffer.getText()
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
    const typeId = options.typeId ?? 0
    const extmark: Extmark = {
      id,
      start: options.start,
      end: options.end,
      virtual: options.virtual ?? false,
      styleId: options.styleId,
      priority: options.priority,
      data: options.data,
      typeId,
    }

    this.extmarks.set(id, extmark)

    if (!this.extmarksByTypeId.has(typeId)) {
      this.extmarksByTypeId.set(typeId, new Set())
    }
    this.extmarksByTypeId.get(typeId)!.add(id)

    this.updateHighlights()

    return id
  }

  public delete(id: number): boolean {
    if (this.destroyed) {
      throw new Error("ExtmarksController is destroyed")
    }

    const extmark = this.extmarks.get(id)
    if (!extmark) return false

    this.deleteExtmarkById(id)
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

  public getAllForTypeId(typeId: number): Extmark[] {
    if (this.destroyed) return []
    const ids = this.extmarksByTypeId.get(typeId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.extmarks.get(id))
      .filter((e): e is Extmark => e !== undefined)
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
    this.extmarksByTypeId.clear()
    this.updateHighlights()
  }

  private saveSnapshot(): void {
    this.history.saveSnapshot(this.extmarks, this.nextId)
  }

  private restoreSnapshot(snapshot: ExtmarksSnapshot): void {
    this.extmarks = new Map(Array.from(snapshot.extmarks.entries()).map(([id, extmark]) => [id, { ...extmark }]))
    this.nextId = snapshot.nextId
    this.updateHighlights()
  }

  private wrapUndoRedo(): void {
    this.editBuffer.undo = (): string | null => {
      if (this.destroyed) {
        return this.originalUndo()
      }

      if (!this.history.canUndo()) {
        return this.originalUndo()
      }

      const currentSnapshot: ExtmarksSnapshot = {
        extmarks: new Map(Array.from(this.extmarks.entries()).map(([id, extmark]) => [id, { ...extmark }])),
        nextId: this.nextId,
      }
      this.history.pushRedo(currentSnapshot)

      const snapshot = this.history.undo()!
      this.restoreSnapshot(snapshot)

      return this.originalUndo()
    }

    this.editBuffer.redo = (): string | null => {
      if (this.destroyed) {
        return this.originalRedo()
      }

      if (!this.history.canRedo()) {
        return this.originalRedo()
      }

      const currentSnapshot: ExtmarksSnapshot = {
        extmarks: new Map(Array.from(this.extmarks.entries()).map(([id, extmark]) => [id, { ...extmark }])),
        nextId: this.nextId,
      }
      this.history.pushUndo(currentSnapshot)

      const snapshot = this.history.redo()!
      this.restoreSnapshot(snapshot)

      return this.originalRedo()
    }
  }

  public destroy(): void {
    if (this.destroyed) return

    this.editBuffer.moveCursorLeft = this.originalMoveCursorLeft
    this.editBuffer.moveCursorRight = this.originalMoveCursorRight
    this.editBuffer.setCursorByOffset = this.originalSetCursorByOffset
    this.editorView.moveUpVisual = this.originalMoveUpVisual
    this.editorView.moveDownVisual = this.originalMoveDownVisual
    this.editBuffer.deleteCharBackward = this.originalDeleteCharBackward
    this.editBuffer.deleteChar = this.originalDeleteChar
    this.editBuffer.insertText = this.originalInsertText
    this.editBuffer.insertChar = this.originalInsertChar
    this.editBuffer.deleteRange = this.originalDeleteRange
    this.editBuffer.setText = this.originalSetText
    this.editBuffer.clear = this.originalClear
    this.editBuffer.newLine = this.originalNewLine
    this.editBuffer.deleteLine = this.originalDeleteLine
    this.editorView.deleteSelectedText = this.originalEditorViewDeleteSelectedText
    this.editBuffer.undo = this.originalUndo
    this.editBuffer.redo = this.originalRedo

    this.extmarks.clear()
    this.extmarksByTypeId.clear()
    this.history.clear()
    this.destroyed = true
    this.removeAllListeners()
  }
}

export function createExtmarksController(editBuffer: EditBuffer, editorView: EditorView): ExtmarksController {
  return new ExtmarksController(editBuffer, editorView)
}
