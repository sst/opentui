import { Renderable } from ".."
import type { SelectionState } from "../types"
import { coordinateToCharacterIndex, fonts } from "./ascii.font"

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

export interface LocalSelectionBounds {
  anchorX: number
  anchorY: number
  focusX: number
  focusY: number
  isActive: boolean
}

export function convertGlobalToLocalSelection(
  globalSelection: SelectionState | null,
  localX: number,
  localY: number,
): LocalSelectionBounds | null {
  if (!globalSelection?.isActive) {
    return null
  }

  return {
    anchorX: globalSelection.anchor.x - localX,
    anchorY: globalSelection.anchor.y - localY,
    focusX: globalSelection.focus.x - localX,
    focusY: globalSelection.focus.y - localY,
    isActive: true,
  }
}

export class ASCIIFontSelectionHelper {
  private localSelection: { start: number; end: number } | null = null

  constructor(
    private getText: () => string,
    private getFont: () => keyof typeof fonts,
  ) {}

  hasSelection(): boolean {
    return this.localSelection !== null
  }

  getSelection(): { start: number; end: number } | null {
    return this.localSelection
  }

  shouldStartSelection(localX: number, localY: number, width: number, height: number): boolean {
    if (localX < 0 || localX >= width || localY < 0 || localY >= height) {
      return false
    }

    const text = this.getText()
    const font = this.getFont()
    const charIndex = coordinateToCharacterIndex(localX, text, font)

    return charIndex >= 0 && charIndex <= text.length
  }

  onLocalSelectionChanged(localSelection: LocalSelectionBounds | null, width: number, height: number): boolean {
    const previousSelection = this.localSelection

    if (!localSelection?.isActive) {
      this.localSelection = null
      return previousSelection !== null
    }

    const text = this.getText()
    const font = this.getFont()

    let selStart: { x: number; y: number }
    let selEnd: { x: number; y: number }

    if (
      localSelection.anchorY < localSelection.focusY ||
      (localSelection.anchorY === localSelection.focusY && localSelection.anchorX <= localSelection.focusX)
    ) {
      selStart = { x: localSelection.anchorX, y: localSelection.anchorY }
      selEnd = { x: localSelection.focusX, y: localSelection.focusY }
    } else {
      selStart = { x: localSelection.focusX, y: localSelection.focusY }
      selEnd = { x: localSelection.anchorX, y: localSelection.anchorY }
    }

    if (height - 1 < selStart.y || 0 > selEnd.y) {
      this.localSelection = null
      return previousSelection !== null
    }

    let startCharIndex = 0
    let endCharIndex = text.length

    if (selStart.y > height - 1) {
      // Selection starts below us - we're not selected
      this.localSelection = null
      return previousSelection !== null
    } else if (selStart.y >= 0 && selStart.y <= height - 1) {
      // Selection starts within our Y range - use the actual start X coordinate
      if (selStart.x > 0) {
        startCharIndex = coordinateToCharacterIndex(selStart.x, text, font)
      }
    }

    if (selEnd.y < 0) {
      // Selection ends above us - we're not selected
      this.localSelection = null
      return previousSelection !== null
    } else if (selEnd.y >= 0 && selEnd.y <= height - 1) {
      // Selection ends within our Y range - use the actual end X coordinate
      if (selEnd.x >= 0) {
        endCharIndex = coordinateToCharacterIndex(selEnd.x, text, font)
      } else {
        endCharIndex = 0
      }
    }

    if (startCharIndex < endCharIndex && startCharIndex >= 0 && endCharIndex <= text.length) {
      this.localSelection = { start: startCharIndex, end: endCharIndex }
    } else {
      this.localSelection = null
    }

    return (
      (this.localSelection !== null) !== (previousSelection !== null) ||
      this.localSelection?.start !== previousSelection?.start ||
      this.localSelection?.end !== previousSelection?.end
    )
  }
}
