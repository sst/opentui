import { MeasureMode } from "yoga-layout"
import { type RenderableOptions, Renderable } from "../Renderable"
import type { OptimizedBuffer } from "../buffer"
import { type BorderStyle, BorderCharArrays, parseBorderStyle } from "../lib/border"
import { convertGlobalToLocalSelection, type Selection, type LocalSelectionBounds } from "../lib/selection"
import { StyledText, stringToStyledText } from "../lib/styled-text"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"
import { SyntaxStyle } from "../syntax-style"
import { type TextChunk, TextBuffer } from "../text-buffer"
import { TextBufferView } from "../text-buffer-view"
import type { RenderContext } from "../types"

const MEASURE_HEIGHT = 10_000

export type SimpleTableCellContent = TextChunk[] | null | undefined
export type SimpleTableContent = SimpleTableCellContent[][]

interface SimpleTableCellState {
  textBuffer: TextBuffer
  textBufferView: TextBufferView
  syntaxStyle: SyntaxStyle
}

interface SimpleTableLayout {
  columnWidths: number[]
  rowHeights: number[]
  columnOffsets: number[]
  rowOffsets: number[]
  columnOffsetsU32: Uint32Array
  rowOffsetsU32: Uint32Array
  tableWidth: number
  tableHeight: number
}

interface CellPosition {
  rowIdx: number
  colIdx: number
}

export interface SimpleTableOptions extends RenderableOptions<SimpleTableRenderable> {
  content?: SimpleTableContent
  wrapMode?: "none" | "char" | "word"
  selectable?: boolean
  selectionBg?: ColorInput
  selectionFg?: ColorInput
  borderStyle?: BorderStyle
  borderColor?: ColorInput
  borderBackgroundColor?: ColorInput
  backgroundColor?: ColorInput
  fg?: ColorInput
  bg?: ColorInput
  attributes?: number
}

export class SimpleTableRenderable extends Renderable {
  private _content: SimpleTableContent
  private _wrapMode: "none" | "char" | "word"
  private _borderStyle: BorderStyle
  private _borderColor: RGBA
  private _borderBackgroundColor: RGBA
  private _backgroundColor: RGBA
  private _defaultFg: RGBA
  private _defaultBg: RGBA
  private _defaultAttributes: number
  private _selectionBg: RGBA | undefined
  private _selectionFg: RGBA | undefined
  private _lastLocalSelection: LocalSelectionBounds | null = null

  private _cells: SimpleTableCellState[][] = []
  private _prevCellContent: SimpleTableCellContent[][] = []
  private _rowCount: number = 0
  private _columnCount: number = 0

  private _layout: SimpleTableLayout = this.createEmptyLayout()
  private _layoutDirty: boolean = true
  private _rasterDirty: boolean = true
  private _selectionDirtyRowFirst: number = -1
  private _selectionDirtyRowLast: number = -1

  private _cachedMeasureLayout: SimpleTableLayout | null = null
  private _cachedMeasureWidth: number | undefined = undefined

  private readonly _defaultOptions = {
    content: [] as SimpleTableContent,
    wrapMode: "none" as "none" | "char" | "word",
    selectable: true,
    selectionBg: undefined as ColorInput | undefined,
    selectionFg: undefined as ColorInput | undefined,
    borderStyle: "single" as BorderStyle,
    borderColor: "#FFFFFF",
    borderBackgroundColor: "transparent",
    backgroundColor: "transparent",
    fg: "#FFFFFF",
    bg: "transparent",
    attributes: 0,
  } satisfies Partial<SimpleTableOptions>

  constructor(ctx: RenderContext, options: SimpleTableOptions = {}) {
    super(ctx, { ...options, buffered: true })

    this._content = options.content ?? this._defaultOptions.content
    this._wrapMode = options.wrapMode ?? this._defaultOptions.wrapMode
    this.selectable = options.selectable ?? this._defaultOptions.selectable
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : undefined
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : undefined
    this._borderStyle = parseBorderStyle(options.borderStyle, this._defaultOptions.borderStyle)
    this._borderColor = parseColor(options.borderColor ?? this._defaultOptions.borderColor)
    this._borderBackgroundColor = parseColor(
      options.borderBackgroundColor ?? this._defaultOptions.borderBackgroundColor,
    )
    this._backgroundColor = parseColor(options.backgroundColor ?? this._defaultOptions.backgroundColor)
    this._defaultFg = parseColor(options.fg ?? this._defaultOptions.fg)
    this._defaultBg = parseColor(options.bg ?? this._defaultOptions.bg)
    this._defaultAttributes = options.attributes ?? this._defaultOptions.attributes

    this.setupMeasureFunc()
    this.rebuildCells()
  }

  public get content(): SimpleTableContent {
    return this._content
  }

  public set content(value: SimpleTableContent) {
    this._content = value ?? []
    this.rebuildCells()
  }

  public get wrapMode(): "none" | "char" | "word" {
    return this._wrapMode
  }

  public set wrapMode(value: "none" | "char" | "word") {
    if (this._wrapMode === value) return
    this._wrapMode = value
    for (const row of this._cells) {
      for (const cell of row) {
        cell.textBufferView.setWrapMode(value)
      }
    }
    this.invalidateLayoutAndRaster()
  }

  public get borderStyle(): BorderStyle {
    return this._borderStyle
  }

  public set borderStyle(value: BorderStyle) {
    const next = parseBorderStyle(value, this._defaultOptions.borderStyle)
    if (this._borderStyle === next) return
    this._borderStyle = next
    this.invalidateRasterOnly()
  }

  public get borderColor(): RGBA {
    return this._borderColor
  }

  public set borderColor(value: ColorInput) {
    const next = parseColor(value)
    if (this._borderColor === next) return
    this._borderColor = next
    this.invalidateRasterOnly()
  }

  public shouldStartSelection(x: number, y: number): boolean {
    if (!this.selectable) return false

    this.ensureLayoutReady()

    const localX = x - this.x
    const localY = y - this.y
    return this.getCellAtLocalPosition(localX, localY) !== null
  }

  public onSelectionChanged(selection: Selection | null): boolean {
    this.ensureLayoutReady()

    const localSelection = convertGlobalToLocalSelection(selection, this.x, this.y)
    this._lastLocalSelection = localSelection

    this._selectionDirtyRowFirst = -1
    this._selectionDirtyRowLast = -1

    if (!localSelection?.isActive) {
      this.resetCellSelections()
    } else {
      this.applySelectionToCells(localSelection, selection?.isStart ?? false)
    }

    if (this._selectionDirtyRowFirst >= 0) {
      this.redrawDirtyCells()
    }

    return this.hasSelection()
  }

  public hasSelection(): boolean {
    for (const row of this._cells) {
      for (const cell of row) {
        if (cell.textBufferView.hasSelection()) {
          return true
        }
      }
    }

    return false
  }

  public getSelection(): { start: number; end: number } | null {
    for (const row of this._cells) {
      for (const cell of row) {
        const selection = cell.textBufferView.getSelection()
        if (selection) {
          return selection
        }
      }
    }

    return null
  }

  public getSelectedText(): string {
    const selectedRows: string[] = []

    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      const rowSelections: string[] = []

      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx]
        if (!cell || !cell.textBufferView.hasSelection()) continue

        const selectedText = cell.textBufferView.getSelectedText()
        if (selectedText.length > 0) {
          rowSelections.push(selectedText)
        }
      }

      if (rowSelections.length > 0) {
        selectedRows.push(rowSelections.join("\t"))
      }
    }

    return selectedRows.join("\n")
  }

  protected onResize(width: number, height: number): void {
    this.invalidateLayoutAndRaster(false)
    super.onResize(width, height)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed) return

    if (this._layoutDirty) {
      this.rebuildLayoutForCurrentWidth()
    }

    if (!this._rasterDirty) return

    buffer.clear(this._backgroundColor)

    if (this._rowCount === 0 || this._columnCount === 0) {
      this._rasterDirty = false
      return
    }

    this.drawBorders(buffer)
    this.drawCells(buffer)

    this._rasterDirty = false
  }

  protected destroySelf(): void {
    this.destroyCells()
    super.destroySelf()
  }

  private setupMeasureFunc(): void {
    const measureFunc = (
      width: number,
      widthMode: MeasureMode,
      height: number,
      heightMode: MeasureMode,
    ): { width: number; height: number } => {
      const hasWidthConstraint = widthMode !== MeasureMode.Undefined && Number.isFinite(width)
      const widthConstraint = hasWidthConstraint ? Math.max(1, Math.floor(width)) : undefined
      const measuredLayout = this.computeLayout(widthConstraint)
      this._cachedMeasureLayout = measuredLayout
      this._cachedMeasureWidth = widthConstraint

      let measuredWidth = measuredLayout.tableWidth > 0 ? measuredLayout.tableWidth : 1
      let measuredHeight = measuredLayout.tableHeight > 0 ? measuredLayout.tableHeight : 1

      if (widthMode === MeasureMode.AtMost && widthConstraint !== undefined && this._positionType !== "absolute") {
        measuredWidth = Math.min(widthConstraint, measuredWidth)
      }

      if (heightMode === MeasureMode.AtMost && Number.isFinite(height) && this._positionType !== "absolute") {
        measuredHeight = Math.min(Math.max(1, Math.floor(height)), measuredHeight)
      }

      return {
        width: measuredWidth,
        height: measuredHeight,
      }
    }

    this.yogaNode.setMeasureFunc(measureFunc)
  }

  private rebuildCells(): void {
    const newRowCount = this._content.length
    const newColumnCount = this._content.reduce((max, row) => Math.max(max, row.length), 0)

    if (this._cells.length === 0) {
      this._rowCount = newRowCount
      this._columnCount = newColumnCount
      this._cells = []
      this._prevCellContent = []

      for (let rowIdx = 0; rowIdx < newRowCount; rowIdx++) {
        const row = this._content[rowIdx] ?? []
        const rowCells: SimpleTableCellState[] = []
        const rowRefs: SimpleTableCellContent[] = []

        for (let colIdx = 0; colIdx < newColumnCount; colIdx++) {
          const cellContent = row[colIdx]
          rowCells.push(this.createCell(cellContent))
          rowRefs.push(cellContent)
        }

        this._cells.push(rowCells)
        this._prevCellContent.push(rowRefs)
      }

      this.invalidateLayoutAndRaster()
      return
    }

    this.updateCellsDiff(newRowCount, newColumnCount)
    this.invalidateLayoutAndRaster()
  }

  private updateCellsDiff(newRowCount: number, newColumnCount: number): void {
    const oldRowCount = this._rowCount
    const oldColumnCount = this._columnCount
    const keepRows = Math.min(oldRowCount, newRowCount)
    const keepCols = Math.min(oldColumnCount, newColumnCount)

    for (let rowIdx = 0; rowIdx < keepRows; rowIdx++) {
      const newRow = this._content[rowIdx] ?? []
      const cellRow = this._cells[rowIdx]
      const refRow = this._prevCellContent[rowIdx]

      for (let colIdx = 0; colIdx < keepCols; colIdx++) {
        const cellContent = newRow[colIdx]
        if (cellContent === refRow[colIdx]) continue

        const oldCell = cellRow[colIdx]
        oldCell.textBufferView.destroy()
        oldCell.textBuffer.destroy()
        oldCell.syntaxStyle.destroy()

        cellRow[colIdx] = this.createCell(cellContent)
        refRow[colIdx] = cellContent
      }

      if (newColumnCount > oldColumnCount) {
        for (let colIdx = oldColumnCount; colIdx < newColumnCount; colIdx++) {
          const cellContent = newRow[colIdx]
          cellRow.push(this.createCell(cellContent))
          refRow.push(cellContent)
        }
      } else if (newColumnCount < oldColumnCount) {
        for (let colIdx = newColumnCount; colIdx < oldColumnCount; colIdx++) {
          const cell = cellRow[colIdx]
          cell.textBufferView.destroy()
          cell.textBuffer.destroy()
          cell.syntaxStyle.destroy()
        }
        cellRow.length = newColumnCount
        refRow.length = newColumnCount
      }
    }

    if (newRowCount > oldRowCount) {
      for (let rowIdx = oldRowCount; rowIdx < newRowCount; rowIdx++) {
        const newRow = this._content[rowIdx] ?? []
        const rowCells: SimpleTableCellState[] = []
        const rowRefs: SimpleTableCellContent[] = []

        for (let colIdx = 0; colIdx < newColumnCount; colIdx++) {
          const cellContent = newRow[colIdx]
          rowCells.push(this.createCell(cellContent))
          rowRefs.push(cellContent)
        }

        this._cells.push(rowCells)
        this._prevCellContent.push(rowRefs)
      }
    } else if (newRowCount < oldRowCount) {
      for (let rowIdx = newRowCount; rowIdx < oldRowCount; rowIdx++) {
        const row = this._cells[rowIdx]
        for (const cell of row) {
          cell.textBufferView.destroy()
          cell.textBuffer.destroy()
          cell.syntaxStyle.destroy()
        }
      }
      this._cells.length = newRowCount
      this._prevCellContent.length = newRowCount
    }

    this._rowCount = newRowCount
    this._columnCount = newColumnCount
  }

  private createCell(content: SimpleTableCellContent): SimpleTableCellState {
    const styledText = this.toStyledText(content)
    const textBuffer = TextBuffer.create(this._ctx.widthMethod)
    const syntaxStyle = SyntaxStyle.create()

    textBuffer.setDefaultFg(this._defaultFg)
    textBuffer.setDefaultBg(this._defaultBg)
    textBuffer.setDefaultAttributes(this._defaultAttributes)
    textBuffer.setSyntaxStyle(syntaxStyle)
    textBuffer.setStyledText(styledText)

    const textBufferView = TextBufferView.create(textBuffer)
    textBufferView.setWrapMode(this._wrapMode)

    return { textBuffer, textBufferView, syntaxStyle }
  }

  private toStyledText(content: SimpleTableCellContent): StyledText {
    if (Array.isArray(content)) {
      return new StyledText(content)
    }

    if (content === null || content === undefined) {
      return stringToStyledText("")
    }

    return stringToStyledText(String(content))
  }

  private destroyCells(): void {
    for (const row of this._cells) {
      for (const cell of row) {
        cell.textBufferView.destroy()
        cell.textBuffer.destroy()
        cell.syntaxStyle.destroy()
      }
    }

    this._cells = []
    this._prevCellContent = []
    this._rowCount = 0
    this._columnCount = 0
    this._layout = this.createEmptyLayout()
  }

  private rebuildLayoutForCurrentWidth(): void {
    const maxTableWidth = this._wrapMode === "none" ? undefined : this.width

    let layout: SimpleTableLayout
    if (this._cachedMeasureLayout !== null && this._cachedMeasureWidth === maxTableWidth) {
      layout = this._cachedMeasureLayout
    } else {
      layout = this.computeLayout(maxTableWidth)
    }
    this._cachedMeasureLayout = null
    this._cachedMeasureWidth = undefined

    this._layout = layout
    this.applyLayoutToViews(layout)
    this._layoutDirty = false

    if (this._lastLocalSelection?.isActive) {
      this._selectionDirtyRowFirst = -1
      this._selectionDirtyRowLast = -1
      this.applySelectionToCells(this._lastLocalSelection, true)
    }
  }

  private computeLayout(maxTableWidth?: number): SimpleTableLayout {
    if (this._rowCount === 0 || this._columnCount === 0) {
      return this.createEmptyLayout()
    }

    const columnWidths = this.computeColumnWidths(maxTableWidth)
    const rowHeights = this.computeRowHeights(columnWidths)
    const columnOffsets = this.computeOffsets(columnWidths)
    const rowOffsets = this.computeOffsets(rowHeights)

    return {
      columnWidths,
      rowHeights,
      columnOffsets,
      rowOffsets,
      columnOffsetsU32: new Uint32Array(columnOffsets),
      rowOffsetsU32: new Uint32Array(rowOffsets),
      tableWidth: (columnOffsets[columnOffsets.length - 1] ?? 0) + 1,
      tableHeight: (rowOffsets[rowOffsets.length - 1] ?? 0) + 1,
    }
  }

  private computeColumnWidths(maxTableWidth?: number): number[] {
    const intrinsicWidths = new Array(this._columnCount).fill(1)

    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx]
        if (!cell) continue

        const measure = cell.textBufferView.measureForDimensions(0, MEASURE_HEIGHT)
        const measuredWidth = Math.max(1, measure?.maxWidth ?? 0)
        intrinsicWidths[colIdx] = Math.max(intrinsicWidths[colIdx], measuredWidth)
      }
    }

    if (
      this._wrapMode === "none" ||
      maxTableWidth === undefined ||
      !Number.isFinite(maxTableWidth) ||
      maxTableWidth <= 0
    ) {
      return intrinsicWidths
    }

    const maxContentWidth = Math.max(1, Math.floor(maxTableWidth) - (this._columnCount + 1))
    const currentWidth = intrinsicWidths.reduce((sum, width) => sum + width, 0)

    if (currentWidth <= maxContentWidth) {
      return intrinsicWidths
    }

    return this.fitColumnWidths(intrinsicWidths, maxContentWidth)
  }

  private fitColumnWidths(widths: number[], targetContentWidth: number): number[] {
    const hardMinWidths = new Array(widths.length).fill(1)
    const baseWidths = widths.map((width) => Math.max(1, Math.floor(width)))

    const preferredMinWidths = baseWidths.map((width) => Math.min(width, 2))
    const preferredMinTotal = preferredMinWidths.reduce((sum, width) => sum + width, 0)

    const floorWidths = preferredMinTotal <= targetContentWidth ? preferredMinWidths : hardMinWidths
    const floorTotal = floorWidths.reduce((sum, width) => sum + width, 0)
    const clampedTarget = Math.max(floorTotal, targetContentWidth)

    const totalBaseWidth = baseWidths.reduce((sum, width) => sum + width, 0)

    if (totalBaseWidth <= clampedTarget) {
      return baseWidths
    }

    const shrinkable = baseWidths.map((width, idx) => width - floorWidths[idx])
    const totalShrinkable = shrinkable.reduce((sum, value) => sum + value, 0)
    if (totalShrinkable <= 0) {
      return [...floorWidths]
    }

    const targetShrink = totalBaseWidth - clampedTarget
    const integerShrink = new Array(baseWidths.length).fill(0)
    const fractions = new Array(baseWidths.length).fill(0)
    let usedShrink = 0

    for (let idx = 0; idx < baseWidths.length; idx++) {
      if (shrinkable[idx] <= 0) continue

      const exact = (shrinkable[idx] / totalShrinkable) * targetShrink
      const whole = Math.min(shrinkable[idx], Math.floor(exact))
      integerShrink[idx] = whole
      fractions[idx] = exact - whole
      usedShrink += whole
    }

    let remainingShrink = targetShrink - usedShrink

    while (remainingShrink > 0) {
      let bestIdx = -1
      let bestFraction = -1

      for (let idx = 0; idx < baseWidths.length; idx++) {
        if (shrinkable[idx] - integerShrink[idx] <= 0) continue
        if (fractions[idx] > bestFraction) {
          bestFraction = fractions[idx]
          bestIdx = idx
        }
      }

      if (bestIdx === -1) break

      integerShrink[bestIdx] += 1
      fractions[bestIdx] = 0
      remainingShrink -= 1
    }

    return baseWidths.map((width, idx) => Math.max(floorWidths[idx], width - integerShrink[idx]))
  }

  private computeRowHeights(columnWidths: number[]): number[] {
    const rowHeights = new Array(this._rowCount).fill(1)

    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx]
        if (!cell) continue

        const width = columnWidths[colIdx] ?? 1
        const measure = cell.textBufferView.measureForDimensions(width, MEASURE_HEIGHT)
        const lineCount = Math.max(1, measure?.lineCount ?? 1)
        rowHeights[rowIdx] = Math.max(rowHeights[rowIdx], lineCount)
      }
    }

    return rowHeights
  }

  private computeOffsets(parts: number[]): number[] {
    const offsets: number[] = [0]
    let cursor = 0

    for (const size of parts) {
      cursor += size + 1
      offsets.push(cursor)
    }

    return offsets
  }

  private applyLayoutToViews(layout: SimpleTableLayout): void {
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx]
        if (!cell) continue

        const colWidth = layout.columnWidths[colIdx] ?? 1
        const rowHeight = layout.rowHeights[rowIdx] ?? 1

        if (this._wrapMode === "none") {
          cell.textBufferView.setWrapWidth(null)
        } else {
          cell.textBufferView.setWrapWidth(colWidth)
        }

        cell.textBufferView.setViewport(0, 0, colWidth, rowHeight)
      }
    }
  }

  private drawBorders(buffer: OptimizedBuffer): void {
    buffer.drawTableBorders(
      BorderCharArrays[this._borderStyle],
      this._borderColor,
      this._borderBackgroundColor,
      this._layout.columnOffsetsU32,
      this._columnCount,
      this._layout.rowOffsetsU32,
      this._rowCount,
    )
  }

  private drawCells(buffer: OptimizedBuffer): void {
    this.drawCellRange(buffer, 0, this._rowCount - 1)
  }

  private drawCellRange(buffer: OptimizedBuffer, firstRow: number, lastRow: number): void {
    const colOffsets = this._layout.columnOffsets
    const rowOffsets = this._layout.rowOffsets

    for (let rowIdx = firstRow; rowIdx <= lastRow; rowIdx++) {
      const cellY = (rowOffsets[rowIdx] ?? 0) + 1

      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx]
        if (!cell) continue
        buffer.drawTextBuffer(cell.textBufferView, (colOffsets[colIdx] ?? 0) + 1, cellY)
      }
    }
  }

  private redrawDirtyCells(): void {
    if (this._selectionDirtyRowFirst < 0) return

    const buffer = this.frameBuffer
    if (!buffer) return

    this.drawCellRange(buffer, this._selectionDirtyRowFirst, this._selectionDirtyRowLast)
    this.requestRender()
  }

  private ensureLayoutReady(): void {
    if (!this._layoutDirty) return
    this.rebuildLayoutForCurrentWidth()
  }

  private getCellAtLocalPosition(localX: number, localY: number): CellPosition | null {
    if (this._rowCount === 0 || this._columnCount === 0) return null
    if (localX < 0 || localY < 0 || localX >= this._layout.tableWidth || localY >= this._layout.tableHeight) {
      return null
    }

    let rowIdx = -1
    for (let idx = 0; idx < this._rowCount; idx++) {
      const top = (this._layout.rowOffsets[idx] ?? 0) + 1
      const bottom = (this._layout.rowOffsets[idx + 1] ?? 0) - 1
      if (localY >= top && localY <= bottom) {
        rowIdx = idx
        break
      }
    }

    if (rowIdx < 0) return null

    let colIdx = -1
    for (let idx = 0; idx < this._columnCount; idx++) {
      const left = (this._layout.columnOffsets[idx] ?? 0) + 1
      const right = (this._layout.columnOffsets[idx + 1] ?? 0) - 1
      if (localX >= left && localX <= right) {
        colIdx = idx
        break
      }
    }

    if (colIdx < 0) return null

    return { rowIdx, colIdx }
  }

  private applySelectionToCells(localSelection: LocalSelectionBounds, isStart: boolean): void {
    const minSelY = Math.min(localSelection.anchorY, localSelection.focusY)
    const maxSelY = Math.max(localSelection.anchorY, localSelection.focusY)

    const firstRow = this.findRowForLocalY(minSelY)
    const lastRow = this.findRowForLocalY(maxSelY)

    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      if (rowIdx < firstRow || rowIdx > lastRow) {
        this.resetRowSelection(rowIdx)
        continue
      }

      const cellTop = (this._layout.rowOffsets[rowIdx] ?? 0) + 1

      for (let colIdx = 0; colIdx < this._columnCount; colIdx++) {
        const cell = this._cells[rowIdx]?.[colIdx]
        if (!cell) continue

        const cellLeft = (this._layout.columnOffsets[colIdx] ?? 0) + 1

        const anchorX = localSelection.anchorX - cellLeft
        const anchorY = localSelection.anchorY - cellTop
        const focusX = localSelection.focusX - cellLeft
        const focusY = localSelection.focusY - cellTop

        const cellChanged = isStart
          ? cell.textBufferView.setLocalSelection(
              anchorX,
              anchorY,
              focusX,
              focusY,
              this._selectionBg,
              this._selectionFg,
            )
          : cell.textBufferView.updateLocalSelection(
              anchorX,
              anchorY,
              focusX,
              focusY,
              this._selectionBg,
              this._selectionFg,
            )

        if (cellChanged) {
          this.markSelectionDirtyRow(rowIdx)
        }
      }
    }
  }

  private findRowForLocalY(localY: number): number {
    if (this._rowCount === 0) return 0
    if (localY < 0) return 0

    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      const rowEnd = this._layout.rowOffsets[rowIdx + 1] ?? 0
      if (localY < rowEnd) return rowIdx
    }

    return this._rowCount - 1
  }

  private resetRowSelection(rowIdx: number): void {
    const row = this._cells[rowIdx]
    if (!row) return

    for (const cell of row) {
      if (!cell.textBufferView.hasSelection()) continue
      cell.textBufferView.resetLocalSelection()
      this.markSelectionDirtyRow(rowIdx)
    }
  }

  private resetCellSelections(): void {
    for (let rowIdx = 0; rowIdx < this._rowCount; rowIdx++) {
      this.resetRowSelection(rowIdx)
    }
  }

  private markSelectionDirtyRow(rowIdx: number): void {
    if (this._selectionDirtyRowFirst < 0 || rowIdx < this._selectionDirtyRowFirst) {
      this._selectionDirtyRowFirst = rowIdx
    }
    if (rowIdx > this._selectionDirtyRowLast) {
      this._selectionDirtyRowLast = rowIdx
    }
  }

  private createEmptyLayout(): SimpleTableLayout {
    return {
      columnWidths: [],
      rowHeights: [],
      columnOffsets: [0],
      rowOffsets: [0],
      columnOffsetsU32: new Uint32Array([0]),
      rowOffsetsU32: new Uint32Array([0]),
      tableWidth: 0,
      tableHeight: 0,
    }
  }

  private invalidateLayoutAndRaster(markYogaDirty: boolean = true): void {
    this._layoutDirty = true
    this._rasterDirty = true
    this._cachedMeasureLayout = null
    this._cachedMeasureWidth = undefined

    if (markYogaDirty) {
      this.yogaNode.markDirty()
    }

    this.requestRender()
  }

  private invalidateRasterOnly(): void {
    this._rasterDirty = true
    this.requestRender()
  }
}
