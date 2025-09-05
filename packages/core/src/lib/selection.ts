import { Renderable, type ViewportBounds } from ".."
import { coordinateToCharacterIndex, fonts } from "./ascii.font"

class SelectionAnchor {
  private relativeX: number
  private relativeY: number

  constructor(
    private renderable: Renderable,
    absoluteX: number,
    absoluteY: number,
  ) {
    this.relativeX = absoluteX - this.renderable.x
    this.relativeY = absoluteY - this.renderable.y
  }

  get x(): number {
    return this.renderable.x + this.relativeX
  }

  get y(): number {
    return this.renderable.y + this.relativeY
  }
}

export class Selection {
  private _anchor: SelectionAnchor
  private _originalFocus: { x: number; y: number }
  private _normalizedAnchor!: { x: number; y: number }
  private _normalizedFocus!: { x: number; y: number }
  private _selectedRenderables: Renderable[] = []
  private _touchedRenderables: Renderable[] = []
  private _isActive: boolean = true
  private _isSelecting: boolean = true

  constructor(anchorRenderable: Renderable, anchor: { x: number; y: number }, focus: { x: number; y: number }) {
    this._anchor = new SelectionAnchor(anchorRenderable, anchor.x, anchor.y)
    this._originalFocus = { ...focus }
    this._updateNormalizedSelection()
  }

  get anchor(): { x: number; y: number } {
    return { ...this._normalizedAnchor }
  }

  get focus(): { x: number; y: number } {
    return { ...this._normalizedFocus }
  }

  set focus(value: { x: number; y: number }) {
    this._originalFocus = { ...value }
    this._updateNormalizedSelection()
  }

  private _updateNormalizedSelection(): void {
    const anchorBeforeFocus =
      this._anchor.y < this._originalFocus.y ||
      (this._anchor.y === this._originalFocus.y && this._anchor.x <= this._originalFocus.x)

    if (anchorBeforeFocus) {
      this._normalizedAnchor = { x: this._anchor.x, y: this._anchor.y }
      this._normalizedFocus = { ...this._originalFocus }
    } else {
      this._normalizedAnchor = { ...this._originalFocus }
      this._normalizedFocus = { x: this._anchor.x + 1, y: this._anchor.y }
    }
  }

  get isActive(): boolean {
    return this._isActive
  }

  set isActive(value: boolean) {
    this._isActive = value
  }

  get isSelecting(): boolean {
    return this._isSelecting
  }

  set isSelecting(value: boolean) {
    this._isSelecting = value
  }

  get bounds(): ViewportBounds {
    return {
      x: Math.min(this._normalizedAnchor.x, this._normalizedFocus.x),
      y: Math.min(this._normalizedAnchor.y, this._normalizedFocus.y),
      width:
        Math.max(this._normalizedAnchor.x, this._normalizedFocus.x) -
        Math.min(this._normalizedAnchor.x, this._normalizedFocus.x),
      height:
        Math.max(this._normalizedAnchor.y, this._normalizedFocus.y) -
        Math.min(this._normalizedAnchor.y, this._normalizedFocus.y),
    }
  }

  updateSelectedRenderables(selectedRenderables: Renderable[]): void {
    this._selectedRenderables = selectedRenderables
  }

  get selectedRenderables(): Renderable[] {
    return this._selectedRenderables
  }

  updateTouchedRenderables(touchedRenderables: Renderable[]): void {
    this._touchedRenderables = touchedRenderables
  }

  get touchedRenderables(): Renderable[] {
    return this._touchedRenderables
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
  globalSelection: Selection | null,
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

    const selStart = { x: localSelection.anchorX, y: localSelection.anchorY }
    const selEnd = { x: localSelection.focusX, y: localSelection.focusY }

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
      previousSelection?.start !== this.localSelection?.start || previousSelection?.end !== this.localSelection?.end
    )
  }
}
