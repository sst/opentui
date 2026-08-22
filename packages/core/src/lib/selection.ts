import { Renderable } from "../Renderable.js"
import type { ViewportBounds } from "../types.js"
import { coordinateToCharacterIndex, fonts, getCharacterPositions } from "./ascii.font.js"

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
  private _focus: { x: number; y: number }
  private _selectedRenderables: Renderable[] = []
  private _touchedRenderables: Renderable[] = []
  private _isActive: boolean = true
  private _isDragging: boolean = true
  private _isStart: boolean = false

  constructor(anchorRenderable: Renderable, anchor: { x: number; y: number }, focus: { x: number; y: number }) {
    this._anchor = new SelectionAnchor(anchorRenderable, anchor.x, anchor.y)
    this._focus = { ...focus }
  }

  get isStart(): boolean {
    return this._isStart
  }

  set isStart(value: boolean) {
    this._isStart = value
  }

  get anchor(): { x: number; y: number } {
    return { x: this._anchor.x, y: this._anchor.y }
  }

  get focus(): { x: number; y: number } {
    return { ...this._focus }
  }

  set focus(value: { x: number; y: number }) {
    this._focus = { ...value }
  }

  get isActive(): boolean {
    return this._isActive
  }

  set isActive(value: boolean) {
    this._isActive = value
  }

  get isDragging(): boolean {
    return this._isDragging
  }

  set isDragging(value: boolean) {
    this._isDragging = value
  }

  get bounds(): ViewportBounds {
    const minX = Math.min(this._anchor.x, this._focus.x)
    const maxX = Math.max(this._anchor.x, this._focus.x)
    const minY = Math.min(this._anchor.y, this._focus.y)
    const maxY = Math.max(this._anchor.y, this._focus.y)

    // Selection bounds are inclusive of both anchor and focus
    // A selection from (0,0) to (0,0) covers 1 cell
    // A selection from (0,0) to (5,3) covers cells from (0,0) to (5,3) inclusive
    const width = maxX - minX + 1
    const height = maxY - minY + 1

    return {
      x: minX,
      y: minY,
      width,
      height,
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
    const selectedTextsByLine = new Map<number, Array<{ x: number; text: string }>>()
    const selectedRenderables = this._selectedRenderables
      // Sort by reading order: top-to-bottom, then left-to-right
      .sort((a, b) => {
        const aY = a.y
        const bY = b.y
        if (aY !== bY) {
          return aY - bY
        }
        return a.x - b.x
      })
      .filter((renderable) => !renderable.isDestroyed)

    const ownersByY = new Map<number, Array<{ first: number; last: number }>>()
    for (const renderable of selectedRenderables) {
      const segments = renderable.getSelectedTextSegments()
      if (segments.length === 0) continue
      const span = renderable.getSelectedVisualLineSpan()
      const first = span?.first ?? segments[0].row
      const last = Math.max(span?.last ?? segments[0].row, segments[segments.length - 1].row)
      const owner = { first: renderable.y + first, last: renderable.y + last }
      for (const segment of segments) {
        const y = renderable.y + segment.row
        const line = selectedTextsByLine.get(y) ?? []
        line.push({ x: renderable.x, text: segment.text })
        selectedTextsByLine.set(y, line)
        const owners = ownersByY.get(y) ?? []
        owners.push(owner)
        ownersByY.set(y, owners)
      }
    }

    const occupied = [...selectedTextsByLine.entries()].sort(([leftY], [rightY]) => leftY - rightY)
    if (occupied.length === 0) return ""

    const assembled: string[] = []
    let previousY = occupied[0][0]
    for (const [y, segments] of occupied) {
      const previousOwners = ownersByY.get(previousY) ?? []
      for (let gap = previousY + 1; gap < y; gap++) {
        const ownedByPrevious = previousOwners.some((owner) => gap >= owner.first && gap <= owner.last)
        if (!ownedByPrevious) assembled.push("")
      }
      assembled.push(
        segments
          .sort((left, right) => left.x - right.x)
          .map((segment) => segment.text)
          .join(""),
      )
      previousY = y
    }
    return assembled.join("\n")
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
    const positions = getCharacterPositions(text, font)
    const minY = Math.min(localSelection.anchorY, localSelection.focusY)
    const maxY = Math.max(localSelection.anchorY, localSelection.focusY)

    // Completely above or below this glyph row: not selected.
    if (maxY < 0 || minY > height - 1) {
      this.localSelection = null
      return previousSelection !== null
    }

    const indexAt = (x: number, y: number): number => {
      if (y < 0) return 0
      if (y > height - 1) return text.length
      if (x < 0) return 0
      if (x >= width) return text.length
      for (let index = 1; index < positions.length; index += 1) {
        if (x < positions[index]) return index - 1
      }
      return text.length
    }

    const anchorIndex = indexAt(localSelection.anchorX, localSelection.anchorY)
    const focusIndex = indexAt(localSelection.focusX, localSelection.focusY)
    const start = Math.min(anchorIndex, focusIndex)
    const end = Math.min(Math.max(anchorIndex, focusIndex) + 1, text.length)
    const samePoint =
      localSelection.anchorX === localSelection.focusX && localSelection.anchorY === localSelection.focusY

    if (samePoint || start >= end) {
      this.localSelection = null
    } else {
      this.localSelection = { start, end }
    }

    return (
      previousSelection?.start !== this.localSelection?.start || previousSelection?.end !== this.localSelection?.end
    )
  }
}
