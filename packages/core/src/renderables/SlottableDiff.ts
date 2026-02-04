import { Renderable } from "../Renderable"
import { BoxRenderable } from "./Box"
import type { RenderContext } from "../types"
import { DiffLineRenderable, type DiffLineClickInfo, type DiffLineRenderableOptions } from "./DiffLine"
import { DiffRenderable, type DiffRenderableOptions } from "./Diff"
import { RGBA } from "../lib/RGBA"
import { TextRenderable } from "./Text"

// Re-export for convenience
export { type DiffLineClickInfo }

interface ParsedDiffLine {
  content: string
  lineNumber?: number
  type: "add" | "remove" | "context" | "empty"
  side: "left" | "right" | "unified"
}

export type SlottableDiffOptions = DiffRenderableOptions & {
  gutterWidth?: number
  onLineClick?: (info: DiffLineClickInfo) => void
  virtualize?: boolean
  overscan?: number
}

/**
 * A diff component that supports inserting slots (like comment boxes) between lines.
 *
 * Unlike `DiffRenderable` which uses a monolithic `CodeRenderable` internally,
 * this component renders each line as a separate `DiffLineRenderable`, allowing
 * arbitrary content to be inserted between any lines.
 *
 * @example
 * ```tsx
 * <slottable_diff
 *   diff={unifiedDiffString}
 *   view="unified"
 *   onLineClick={(info) => {
 *     // Insert comment box after clicked line
 *     diffRef.insertSlot(info.visualLineIndex, commentBoxRenderable)
 *   }}
 * />
 * ```
 */
export class SlottableDiffRenderable extends DiffRenderable {
  // Additional options specific to SlottableDiff
  private _gutterWidth: number
  private _onLineClick?: (info: DiffLineClickInfo) => void
  private _virtualize: boolean
  private _overscan: number
  private _rowMap: Map<number, Renderable> = new Map()
  private _topSpacer: BoxRenderable | null = null
  private _bottomSpacer: BoxRenderable | null = null
  private _rowsContainer: BoxRenderable | null = null
  private _slotHeights: Map<number, number> = new Map()
  private _visibleStart: number = 0
  private _visibleEnd: number = -1
  private _scrollTop: number = 0
  private _viewportHeight: number = 0

  // Internal state for slots
  private _lines: DiffLineRenderable[] = []
  private _visualRows: Renderable[] = []
  private _rowContainers: BoxRenderable[] = []
  private _slots: Map<number, Renderable> = new Map()
  private _parsedLines: ParsedDiffLine[] = []
  private _errorRenderable: TextRenderable | null = null

  constructor(ctx: RenderContext, options: SlottableDiffOptions) {
    super(ctx, {
      ...options,
      flexDirection: "column",
    })

    this._gutterWidth = options.gutterWidth ?? 5
    this._onLineClick = options.onLineClick
    this._virtualize = options.virtualize ?? true
    this._overscan = options.overscan ?? 30

    this.buildView()
  }

  protected override buildView(): void {
    if (!this._lines) return

    if (this._parseError) {
      this.clearLines()
      this._parsedLines = []
      this.showErrorView()
      return
    }

    if (!this._parsedDiff || this._parsedDiff.hunks.length === 0) {
      this.clearLines()
      this._parsedLines = []
      return
    }

    // Always column layout for slottable
    this.flexDirection = "column"
    this.buildParsedLines()
    this.initializeContent()
  }

  private buildParsedLines(): void {
    if (!this._parsedDiff) {
      this._parsedLines = []
      return
    }

    if (this._view === "unified") {
      this.buildUnifiedParsedLines()
      return
    }

    this.buildSplitParsedLines()
  }

  private buildUnifiedParsedLines(): void {
    if (!this._parsedDiff) return
    this._parsedLines = []

    let oldLineNum = 1
    let newLineNum = 1

    for (const hunk of this._parsedDiff.hunks) {
      oldLineNum = hunk.oldStart
      newLineNum = hunk.newStart

      for (const line of hunk.lines) {
        const prefix = line[0]
        const content = line.slice(1)

        if (prefix === "+") {
          this._parsedLines.push({
            content,
            lineNumber: newLineNum++,
            type: "add",
            side: "unified",
          })
          continue
        }

        if (prefix === "-") {
          this._parsedLines.push({
            content,
            lineNumber: oldLineNum++,
            type: "remove",
            side: "unified",
          })
          continue
        }

        if (prefix === " ") {
          this._parsedLines.push({
            content,
            lineNumber: newLineNum,
            type: "context",
            side: "unified",
          })
          oldLineNum++
          newLineNum++
        }
      }
    }
  }

  private buildSplitParsedLines(): void {
    if (!this._parsedDiff) return
    this._parsedLines = []

    let oldLineNum = 1
    let newLineNum = 1

    for (const hunk of this._parsedDiff.hunks) {
      oldLineNum = hunk.oldStart
      newLineNum = hunk.newStart

      let i = 0
      while (i < hunk.lines.length) {
        const line = hunk.lines[i]
        const prefix = line[0]

        if (prefix === " ") {
          const content = line.slice(1)
          this._parsedLines.push({
            content,
            lineNumber: oldLineNum++,
            type: "context",
            side: "left",
          })
          this._parsedLines.push({
            content,
            lineNumber: newLineNum++,
            type: "context",
            side: "right",
          })
          i++
          continue
        }

        if (prefix === "\\") {
          i++
          continue
        }

        const removes: { content: string; lineNumber: number }[] = []
        const adds: { content: string; lineNumber: number }[] = []

        while (i < hunk.lines.length) {
          const current = hunk.lines[i]
          const currentPrefix = current[0]

          if (currentPrefix === " " || currentPrefix === "\\") {
            break
          }

          const content = current.slice(1)

          if (currentPrefix === "-") {
            removes.push({ content, lineNumber: oldLineNum++ })
          } else if (currentPrefix === "+") {
            adds.push({ content, lineNumber: newLineNum++ })
          }
          i++
        }

        const max = Math.max(removes.length, adds.length)
        for (let j = 0; j < max; j++) {
          if (j < removes.length) {
            this._parsedLines.push({
              content: removes[j].content,
              lineNumber: removes[j].lineNumber,
              type: "remove",
              side: "left",
            })
          } else {
            this._parsedLines.push({
              content: "",
              type: "empty",
              side: "left",
            })
          }

          if (j < adds.length) {
            this._parsedLines.push({
              content: adds[j].content,
              lineNumber: adds[j].lineNumber,
              type: "add",
              side: "right",
            })
          } else {
            this._parsedLines.push({
              content: "",
              type: "empty",
              side: "right",
            })
          }
        }
      }
    }
  }

  private initializeContent(): void {
    this.clearLines()

    if (!this._parsedDiff) return

    if (this._virtualize) {
      this.ensureVirtualShell()
      this.updateVirtualRange(true)
      return
    }

    if (this._view === "unified") {
      // Unified view: each line is full width
      let visualIndex = 0
      for (const line of this._parsedLines) {
        const lineRenderable = this.createLineRenderable(line, visualIndex)
        this._lines.push(lineRenderable)
        this._visualRows.push(lineRenderable)
        this.add(lineRenderable)
        visualIndex++
      }
    } else {
      // Split view: pair left+right lines in rows
      let visualIndex = 0
      for (let i = 0; i < this._parsedLines.length; i += 2) {
        const leftLine = this._parsedLines[i]
        const rightLine = this._parsedLines[i + 1]

        // Create row container
        const rowContainer = new BoxRenderable(this.ctx, {
          id: `${this.id}-row-${visualIndex}`,
          flexDirection: "row",
          width: "100%",
        })
        this._rowContainers.push(rowContainer)
        this._visualRows.push(rowContainer)

        if (leftLine) {
          const leftRenderable = this.createLineRenderable(leftLine, visualIndex)
          this._lines.push(leftRenderable)
          rowContainer.add(leftRenderable)
        }

        if (rightLine) {
          const rightRenderable = this.createLineRenderable(rightLine, visualIndex)
          this._lines.push(rightRenderable)
          rowContainer.add(rightRenderable)
        }

        this.add(rowContainer)
        visualIndex++
      }
    }

    // Restore slots if any exist (e.g. from props before init)
    if (this._slots.size > 0) {
      for (const [lineIndex, slot] of this._slots) {
        this.insertSlot(lineIndex, slot, true)
      }
    }
  }

  private ensureVirtualShell(): void {
    if (this._rowsContainer && this._topSpacer && this._bottomSpacer) return

    this._topSpacer = new BoxRenderable(this.ctx, {
      id: `${this.id}-spacer-top`,
      width: "100%",
      height: 0,
      flexShrink: 0,
    })

    this._rowsContainer = new BoxRenderable(this.ctx, {
      id: `${this.id}-rows`,
      flexDirection: "column",
      width: "100%",
    })

    this._bottomSpacer = new BoxRenderable(this.ctx, {
      id: `${this.id}-spacer-bottom`,
      width: "100%",
      height: 0,
      flexShrink: 0,
    })

    this.add(this._topSpacer)
    this.add(this._rowsContainer)
    this.add(this._bottomSpacer)
  }

  private updateVirtualRange(force: boolean = false): void {
    if (!this._virtualize) return

    const total = this.lineCount()
    if (total === 0) {
      this._visibleStart = 0
      this._visibleEnd = -1
      this.updateSpacers(0, -1)
      return
    }

    const scrollTop = this.getScrollTop()
    const viewportHeight = this.getViewportHeight()
    if (!force && scrollTop === this._scrollTop && viewportHeight === this._viewportHeight) return

    this._scrollTop = scrollTop
    this._viewportHeight = viewportHeight

    const startOffset = Math.max(0, scrollTop - this._overscan)
    const endOffset = scrollTop + viewportHeight + this._overscan
    const start = this.indexFromOffset(startOffset)
    const end = this.indexFromOffset(endOffset)

    const nextStart = Math.max(0, Math.min(total - 1, start))
    const nextEnd = Math.max(nextStart, Math.min(total - 1, end))

    if (!force && nextStart === this._visibleStart && nextEnd === this._visibleEnd) return

    const prevStart = this._visibleStart
    const prevEnd = this._visibleEnd
    this._visibleStart = nextStart
    this._visibleEnd = nextEnd
    this.renderRange(prevStart, prevEnd, nextStart, nextEnd)
    this.updateSpacers(nextStart, nextEnd)
  }

  private renderRange(prevStart: number, prevEnd: number, start: number, end: number): void {
    if (!this._rowsContainer) return

    if (prevEnd < prevStart) {
      for (let i = start; i <= end; i++) {
        this.appendIndex(i)
      }
      this.collectVisibleLines(start, end)
      return
    }

    if (start > prevStart) {
      for (let i = prevStart; i < start; i++) {
        this.removeIndex(i)
      }
    }

    if (start < prevStart) {
      let anchor = this._rowsContainer.getChildren()[0]
      if (!anchor) {
        for (let i = start; i <= end; i++) {
          this.appendIndex(i)
        }
        this.collectVisibleLines(start, end)
        return
      }

      for (let i = prevStart - 1; i >= start; i--) {
        anchor = this.prependIndex(i, anchor)
      }
    }

    if (end < prevEnd) {
      for (let i = prevEnd; i > end; i--) {
        this.removeIndex(i)
      }
    }

    if (end > prevEnd) {
      for (let i = prevEnd + 1; i <= end; i++) {
        this.appendIndex(i)
      }
    }

    this.collectVisibleLines(start, end)
  }

  private createRowRenderable(index: number): Renderable {
    if (this._view === "unified") {
      const line = this._parsedLines[index]
      const lineRenderable = this.createLineRenderable(line, index)
      return lineRenderable
    }

    const leftLine = this._parsedLines[index * 2]
    const rightLine = this._parsedLines[index * 2 + 1]

    const rowContainer = new BoxRenderable(this.ctx, {
      id: `${this.id}-row-${index}`,
      flexDirection: "row",
      width: "100%",
    })

    if (leftLine) {
      const leftRenderable = this.createLineRenderable(leftLine, index)
      rowContainer.add(leftRenderable)
    }

    if (rightLine) {
      const rightRenderable = this.createLineRenderable(rightLine, index)
      rowContainer.add(rightRenderable)
    }

    return rowContainer
  }

  private appendIndex(index: number): void {
    if (!this._rowsContainer) return

    let row = this._rowMap.get(index)
    if (!row) {
      row = this.createRowRenderable(index)
      this._rowMap.set(index, row)
    }

    this._rowsContainer.add(row)

    const slot = this._slots.get(index)
    if (slot && slot.parent !== this._rowsContainer) {
      this._rowsContainer.add(slot)
    }
  }

  private prependIndex(index: number, anchor: Renderable): Renderable {
    if (!this._rowsContainer) return anchor

    let row = this._rowMap.get(index)
    if (!row) {
      row = this.createRowRenderable(index)
      this._rowMap.set(index, row)
    }

    this._rowsContainer.insertBefore(row, anchor)

    const slot = this._slots.get(index)
    if (slot && slot.parent !== this._rowsContainer) {
      this._rowsContainer.insertBefore(slot, anchor)
    }

    return row
  }

  private removeIndex(index: number): void {
    if (!this._rowsContainer) return

    const row = this._rowMap.get(index)
    if (row) {
      this._rowsContainer.remove(row.id)
      row.destroy()
      this._rowMap.delete(index)
    }

    const slot = this._slots.get(index)
    if (slot && slot.parent === this._rowsContainer) {
      this._rowsContainer.remove(slot.id)
    }
  }

  private collectVisibleLines(start: number, end: number): void {
    this._lines = []
    for (let i = start; i <= end; i++) {
      const row = this._rowMap.get(i)
      if (!row) continue
      this.collectLineRenderables(row)
    }
  }

  private collectLineRenderables(row: Renderable): void {
    if (row instanceof DiffLineRenderable) {
      this._lines.push(row)
      return
    }

    for (const child of row.getChildren()) {
      if (child instanceof DiffLineRenderable) {
        this._lines.push(child)
      }
    }
  }

  private addSlotIfVisible(index: number): void {
    if (!this._rowsContainer) return
    if (index < this._visibleStart || index > this._visibleEnd) return

    const slot = this._slots.get(index)
    if (!slot) return
    if (slot.parent === this._rowsContainer) return

    const row = this._rowMap.get(index)
    if (!row) return

    const children = this._rowsContainer.getChildren()
    const rowIndex = children.indexOf(row)
    if (rowIndex === -1) return

    const anchor = children[rowIndex + 1]
    if (anchor) {
      this._rowsContainer.insertBefore(slot, anchor)
      return
    }

    this._rowsContainer.add(slot)
  }

  private updateSpacers(start: number, end: number): void {
    if (!this._topSpacer || !this._bottomSpacer) return

    if (end < start) {
      this._topSpacer.height = 0
      this._bottomSpacer.height = 0
      return
    }

    const total = this.lineCount()
    const top = this.getOffsetForIndex(start)
    const endOffset = this.getOffsetForIndex(end + 1)
    const totalHeight = total + this.getSlotHeightsSum(total)
    const visible = Math.max(0, endOffset - top)
    const bottom = Math.max(0, totalHeight - top - visible)

    this._topSpacer.height = top
    this._bottomSpacer.height = bottom
  }

  private getOffsetForIndex(index: number): number {
    return index + this.getSlotHeightsSum(index)
  }

  private getSlotHeightsSum(limit: number): number {
    let sum = 0
    for (const [index, height] of this._slotHeights) {
      if (index < limit) {
        sum += height
      }
    }
    return sum
  }

  private indexFromOffset(offset: number): number {
    const total = this.lineCount()
    if (total === 0) return 0
    if (offset <= 0) return 0

    let line = 0
    let remaining = offset
    const entries = [...this._slotHeights.entries()].sort((a, b) => a[0] - b[0])

    for (const [index, height] of entries) {
      if (index < line) {
        continue
      }

      const lineCount = index - line + 1
      if (remaining < lineCount) {
        return Math.min(total - 1, line + Math.floor(remaining))
      }

      remaining -= lineCount

      if (remaining < height) {
        return Math.min(total - 1, index)
      }

      remaining -= height
      line = index + 1
      if (line >= total) {
        return total - 1
      }
    }

    return Math.min(total - 1, line + Math.floor(remaining))
  }

  private getScrollTop(): number {
    if (!this.parent) return 0
    return Math.max(0, -this.parent.translateY)
  }

  private getViewportHeight(): number {
    if (this.parent && this.parent.parent) return this.parent.parent.height
    if (this.parent) return this.parent.height
    return this.height
  }

  private createLineRenderable(line: ParsedDiffLine, visualIndex: number): DiffLineRenderable {
    const lineOptions: DiffLineRenderableOptions = {
      id: `${this.id}-line-${visualIndex}-${line.side}`,
      content: line.content,
      lineNumber: line.lineNumber,
      type: line.type,
      side: line.side,
      showLineNumber: this._showLineNumbers,
      lineBg: this.getLineBg(line.type),
      lineFg: this._fg,
      signText: this.getSignText(line.type),
      signColor: this.getSignColor(line.type),
      gutterBg: this.getGutterBg(line.type),
      gutterFg: this._lineNumberFg,
      gutterWidth: this._gutterWidth,
      visualLineIndex: visualIndex,
      onClick: this._onLineClick,
      width: this._view === "split" ? "50%" : "100%",
      filetype: this._filetype,
      syntaxStyle: this._syntaxStyle,
    }

    return new DiffLineRenderable(this.ctx, lineOptions)
  }

  private getLineBg(type: ParsedDiffLine["type"]): RGBA {
    switch (type) {
      case "add":
        return this._addedBg
      case "remove":
        return this._removedBg
      case "context":
        return this._contextBg
      case "empty":
        return this._contextBg
    }
  }

  private getGutterBg(type: ParsedDiffLine["type"]): RGBA {
    switch (type) {
      case "add":
        return this._addedLineNumberBg
      case "remove":
        return this._removedLineNumberBg
      default:
        return this._lineNumberBg
    }
  }

  private getSignText(type: ParsedDiffLine["type"]): string | undefined {
    switch (type) {
      case "add":
        return "+"
      case "remove":
        return "-"
      default:
        return " "
    }
  }

  private getSignColor(type: ParsedDiffLine["type"]): RGBA | undefined {
    switch (type) {
      case "add":
        return this._addedSignColor
      case "remove":
        return this._removedSignColor
      default:
        return undefined
    }
  }

  private showErrorView(): void {
    this._errorRenderable = new TextRenderable(this.ctx, {
      id: `${this.id}-error`,
      content: `Error parsing diff: ${this._parseError?.message}`,
      fg: "#ef4444",
    })
    this.add(this._errorRenderable)
  }

  private clearLines(): void {
    // Remove known rows from view
    for (const row of this._visualRows) {
      this.remove(row.id)
      row.destroy()
    }
    this._visualRows = []
    this._lines = []
    this._rowContainers = []
    this._visibleStart = 0
    this._visibleEnd = -1
    this._scrollTop = 0
    this._viewportHeight = 0
    for (const row of this._rowMap.values()) {
      row.destroy()
    }
    this._rowMap.clear()

    if (this._rowsContainer) {
      for (const child of this._rowsContainer.getChildren()) {
        this._rowsContainer.remove(child.id)
      }
      this.remove(this._rowsContainer.id)
      this._rowsContainer.destroy()
      this._rowsContainer = null
    }
    if (this._topSpacer) {
      this.remove(this._topSpacer.id)
      this._topSpacer.destroy()
      this._topSpacer = null
    }
    if (this._bottomSpacer) {
      this.remove(this._bottomSpacer.id)
      this._bottomSpacer.destroy()
      this._bottomSpacer = null
    }

    // Remove error renderable if present
    if (this._errorRenderable) {
      this.remove(this._errorRenderable.id)
      this._errorRenderable.destroy()
      this._errorRenderable = null
    }
  }

  public insertSlot(afterLineIndex: number, slot: Renderable, forceReinsert: boolean = false): void {
    const existingSlot = this._slots.get(afterLineIndex)
    if (existingSlot && existingSlot === slot && !forceReinsert) {
      // Already there
      return
    }

    if (existingSlot && existingSlot !== slot) {
      this.removeSlot(afterLineIndex)
    }

    this._slots.set(afterLineIndex, slot)
    this.trackSlotHeight(afterLineIndex, slot)

    if (this._virtualize) {
      this.updateVirtualRange(true)
      this.addSlotIfVisible(afterLineIndex)
      return
    }

    // Surgical insertion
    const anchorRow = this._visualRows[afterLineIndex]
    if (!anchorRow) {
      return
    }

    // Helper: get renderable children to find index
    const children = this.getChildren()
    const anchorIndex = children.indexOf(anchorRow)

    if (anchorIndex === -1) {
      this.add(slot)
      return
    }

    if (anchorIndex + 1 < children.length) {
      this.insertBefore(slot, children[anchorIndex + 1])
      return
    }

    this.add(slot)

    this.requestRender()
  }

  public removeSlot(afterLineIndex: number): void {
    const slot = this._slots.get(afterLineIndex)
    if (slot) {
      this.remove(slot.id)
      slot.destroy()
      this._slots.delete(afterLineIndex)
      this._slotHeights.delete(afterLineIndex)
      if (this._virtualize) {
        this.updateVirtualRange(true)
      }
      this.requestRender()
    }
  }

  public hasSlot(afterLineIndex: number): boolean {
    return this._slots.has(afterLineIndex)
  }

  public getSlot(afterLineIndex: number): Renderable | undefined {
    return this._slots.get(afterLineIndex)
  }

  public clearAllSlots(): void {
    for (const [, slot] of this._slots) {
      this.remove(slot.id)
      slot.destroy()
    }
    this._slots.clear()
    this._slotHeights.clear()
    if (this._virtualize) {
      this.updateVirtualRange(true)
    }
    this.requestRender()
  }

  public lineCount(): number {
    return this._view === "unified" ? this._parsedLines.length : Math.ceil(this._parsedLines.length / 2)
  }

  get gutterWidth(): number {
    return this._gutterWidth
  }

  set gutterWidth(value: number) {
    if (this._gutterWidth !== value) {
      this._gutterWidth = value
      this.initializeContent()
      this.requestRender()
    }
  }

  get onLineClick(): ((info: DiffLineClickInfo) => void) | undefined {
    return this._onLineClick
  }

  set onLineClick(value: ((info: DiffLineClickInfo) => void) | undefined) {
    this._onLineClick = value
    // Update all line renderables
    for (const line of this._lines) {
      line.onClick = value
    }
  }

  protected override onUpdate(deltaTime: number): void {
    if (!this._virtualize) return
    this.updateVirtualRange()
  }

  private trackSlotHeight(afterLineIndex: number, slot: Renderable): void {
    const prev = slot.onSizeChange
    slot.onSizeChange = () => {
      if (prev) {
        prev.call(slot)
      }
      const height = slot.height
      if (this._slotHeights.get(afterLineIndex) === height) return
      this._slotHeights.set(afterLineIndex, height)
      if (this._virtualize) {
        this.updateVirtualRange(true)
      }
    }
  }
}
