import { Renderable, type CliRenderer } from "."
import type { SelectionState } from "./types"

export class Selection {
  private _anchor: { x: number; y: number }
  private _focus: { x: number; y: number }
  private _selectedRenderables: Renderable[] = []

  constructor(anchor: { x: number; y: number }, focus: { x: number; y: number }) {
    this._anchor = { ...anchor }
    this._focus = { ...focus }
  }

  get anchor(): { x: number; y: number } {
    return { ...this._anchor }
  }

  get focus(): { x: number; y: number } {
    return { ...this._focus }
  }

  get bounds(): { startX: number; startY: number; endX: number; endY: number } {
    return {
      startX: Math.min(this._anchor.x, this._focus.x),
      startY: Math.min(this._anchor.y, this._focus.y),
      endX: Math.max(this._anchor.x, this._focus.x),
      endY: Math.max(this._anchor.y, this._focus.y),
    }
  }

  updateSelectedRenderables(selectedRenderables: Renderable[]): void {
    this._selectedRenderables = selectedRenderables
  }

  getSelectedText(): string {
    const selectedTexts = this._selectedRenderables
      // Sort by reading order: top-to-bottom, then left-to-right
      .sort((a, b) => {
        const aY = a.y
        const bY = b.y
        if (aY !== bY) {
          return aY - bY
        }
        return a.x - b.x
      })
      .map((renderable) => renderable.getSelectedText())
      .filter((text) => text)
    return selectedTexts.join("\n")
  }
}

export class TextSelectionHelper {
  private localSelection: { start: number; end: number } | null = null
  private cachedGlobalSelection: SelectionState | null = null

  constructor(
    private getX: () => number,
    private getY: () => number,
    private getTextLength: () => number,
    private getLineInfo?: () => { lineStarts: number[]; lineWidths: number[] },
  ) {}

  hasSelection(): boolean {
    return this.localSelection !== null
  }

  getSelection(): { start: number; end: number } | null {
    return this.localSelection
  }

  reevaluateSelection(width: number, height: number = 1): boolean {
    if (!this.cachedGlobalSelection) {
      return false
    }
    return this.onSelectionChanged(this.cachedGlobalSelection, width, height)
  }

  shouldStartSelection(x: number, y: number, width: number, height: number): boolean {
    const localX = x - this.getX()
    const localY = y - this.getY()
    return localX >= 0 && localX < width && localY >= 0 && localY < height
  }

  onSelectionChanged(selection: SelectionState | null, width: number, height: number = 1): boolean {
    this.cachedGlobalSelection = selection

    const previousSelection = this.localSelection

    if (!selection?.isActive) {
      this.localSelection = null
      return previousSelection !== null
    }

    const myY = this.getY()
    const myEndY = myY + height - 1

    if (myEndY < selection.anchor.y || myY > selection.focus.y) {
      this.localSelection = null
      return previousSelection !== null
    }

    if (height === 1) {
      this.localSelection = this.calculateSingleLineSelection(
        myY,
        selection.anchor.y,
        selection.focus.y,
        selection.anchor.x,
        selection.focus.x,
        width,
      )
    } else {
      this.localSelection = this.calculateMultiLineSelection(
        myY,
        selection.anchor.y,
        selection.focus.y,
        selection.anchor.x,
        selection.focus.x,
      )
    }

    return (
      (this.localSelection !== null) !== (previousSelection !== null) ||
      this.localSelection?.start !== previousSelection?.start ||
      this.localSelection?.end !== previousSelection?.end
    )
  }

  private calculateSingleLineSelection(
    lineY: number,
    anchorY: number,
    focusY: number,
    anchorX: number,
    focusX: number,
    width: number,
  ): { start: number; end: number } | null {
    const textLength = this.getTextLength()
    const myX = this.getX()

    // Entire line is selected
    if (lineY > anchorY && lineY < focusY) {
      return { start: 0, end: textLength }
    }

    // Selection spans this single line
    if (lineY === anchorY && lineY === focusY) {
      const start = Math.max(0, Math.min(anchorX - myX, textLength))
      const end = Math.max(0, Math.min(focusX - myX, textLength))
      return start < end ? { start, end } : null
    }

    // Line is at start of selection
    if (lineY === anchorY) {
      const start = Math.max(0, Math.min(anchorX - myX, textLength))
      return start < textLength ? { start, end: textLength } : null
    }

    // Line is at end of selection
    if (lineY === focusY) {
      const end = Math.max(0, Math.min(focusX - myX, textLength))
      return end > 0 ? { start: 0, end } : null
    }

    return null
  }

  private calculateMultiLineSelection(
    startY: number,
    anchorY: number,
    focusY: number,
    anchorX: number,
    focusX: number,
  ): { start: number; end: number } | null {
    const lineInfo = this.getLineInfo?.()
    if (!lineInfo) {
      // Fallback: select entire text if we overlap with selection
      return { start: 0, end: this.getTextLength() }
    }

    const myX = this.getX()
    let selectionStart: number | null = null
    let selectionEnd: number | null = null

    for (let i = 0; i < lineInfo.lineStarts.length; i++) {
      const lineY = startY + i

      if (lineY < anchorY || lineY > focusY) continue

      const lineStart = lineInfo.lineStarts[i]
      const lineEnd = i < lineInfo.lineStarts.length - 1 ? lineInfo.lineStarts[i + 1] - 1 : this.getTextLength()
      const lineWidth = lineInfo.lineWidths[i]

      if (lineY > anchorY && lineY < focusY) {
        // Entire line is selected
        if (selectionStart === null) selectionStart = lineStart
        selectionEnd = lineEnd
      } else if (lineY === anchorY && lineY === focusY) {
        // Selection starts and ends on this line
        const localStartX = Math.max(0, Math.min(anchorX - myX, lineWidth))
        const localEndX = Math.max(0, Math.min(focusX - myX, lineWidth))
        if (localStartX < localEndX) {
          selectionStart = lineStart + localStartX
          selectionEnd = lineStart + localEndX
        }
      } else if (lineY === anchorY) {
        // Selection starts on this line
        const localStartX = Math.max(0, Math.min(anchorX - myX, lineWidth))
        if (localStartX < lineWidth) {
          selectionStart = lineStart + localStartX
          selectionEnd = lineEnd
        }
      } else if (lineY === focusY) {
        // Selection ends on this line
        const localEndX = Math.max(0, Math.min(focusX - myX, lineWidth))
        if (localEndX > 0) {
          if (selectionStart === null) selectionStart = lineStart
          selectionEnd = lineStart + localEndX
        }
      }
    }

    return selectionStart !== null && selectionEnd !== null && selectionStart < selectionEnd
      ? { start: selectionStart, end: selectionEnd }
      : null
  }
}
