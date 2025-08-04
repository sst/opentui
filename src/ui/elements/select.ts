import { BufferedElement, type ElementOptions } from "../element"
import type { CliRenderer } from "../../index"
import { parseColor } from "../../utils"
import type { RGBA, ColorInput } from "../../types"
import type { ParsedKey } from "../../parse.keypress"
import { renderFontToFrameBuffer, measureText, fonts } from "../ascii.font"

export interface SelectOption {
  name: string
  description: string
  value?: any
}

export interface SelectElementOptions extends ElementOptions {
  options: SelectOption[]
  selectedBackgroundColor?: ColorInput
  selectedTextColor?: ColorInput
  descriptionColor?: ColorInput
  selectedDescriptionColor?: ColorInput
  showScrollIndicator?: boolean
  wrapSelection?: boolean
  showDescription?: boolean
  font?: keyof typeof fonts
  itemSpacing?: number
  fastScrollStep?: number
}

export enum SelectElementEvents {
  SELECTION_CHANGED = "selectionChanged",
  ITEM_SELECTED = "itemSelected",
  FOCUSED = "focused",
  BLURRED = "blurred",
}

export class SelectElement extends BufferedElement {
  private options: SelectOption[]
  private selectedIndex: number = 0
  private scrollOffset: number = 0
  private maxVisibleItems: number

  private selectedBackgroundColor: RGBA
  private selectedTextColor: RGBA
  private descriptionColor: RGBA
  private selectedDescriptionColor: RGBA
  private showScrollIndicator: boolean
  private wrapSelection: boolean
  private showDescription: boolean
  private font?: keyof typeof fonts
  private itemSpacing: number
  private linesPerItem: number
  private fontHeight: number
  private fastScrollStep: number

  constructor(id: string, options: SelectElementOptions) {
    super(id, options)

    this.options = options.options || []

    this.showScrollIndicator = options.showScrollIndicator ?? false
    this.wrapSelection = options.wrapSelection ?? false
    this.showDescription = options.showDescription ?? true
    this.font = options.font
    this.itemSpacing = options.itemSpacing || 0

    this.fontHeight = this.font ? measureText({ text: "A", font: this.font }).height : 1
    this.linesPerItem = this.showDescription ? (this.font ? this.fontHeight + 1 : 2) : this.font ? this.fontHeight : 1
    this.linesPerItem += this.itemSpacing

    const hasBorder = this.border !== false
    const usableHeight = hasBorder ? this.height - 2 : this.height
    this.maxVisibleItems = Math.max(1, Math.floor(usableHeight / this.linesPerItem))

    this.selectedBackgroundColor = parseColor(options.selectedBackgroundColor || "#334455")
    this.selectedTextColor = parseColor(options.selectedTextColor || "#FFFF00")
    this.descriptionColor = parseColor(options.descriptionColor || "#888888")
    this.selectedDescriptionColor = parseColor(options.selectedDescriptionColor || "#CCCCCC")
    this.fastScrollStep = options.fastScrollStep || 5
  }

  protected refreshContent(contentX: number, contentY: number, contentWidth: number, contentHeight: number): void {
    if (!this.frameBuffer || this.options.length === 0) return

    const visibleOptions = this.options.slice(this.scrollOffset, this.scrollOffset + this.maxVisibleItems)

    for (let i = 0; i < visibleOptions.length; i++) {
      const actualIndex = this.scrollOffset + i
      const option = visibleOptions[i]
      const isSelected = actualIndex === this.selectedIndex
      const itemY = contentY + i * this.linesPerItem

      if (itemY + this.linesPerItem - 1 >= contentY + contentHeight) break

      if (isSelected) {
        const contentHeight = this.linesPerItem - this.itemSpacing
        this.frameBuffer.fillRect(contentX, itemY, contentWidth, contentHeight, this.selectedBackgroundColor)
      }

      const nameContent = `${isSelected ? "▶ " : "  "}${option.name}`
      const nameColor = isSelected ? this.selectedTextColor : this.textColor
      let descX = contentX + 3

      if (this.font) {
        const indicator = isSelected ? "▶ " : "  "
        this.frameBuffer.drawText(indicator, contentX + 1, itemY, nameColor)

        const indicatorWidth = 2
        renderFontToFrameBuffer(this.frameBuffer, {
          text: option.name,
          x: contentX + 1 + indicatorWidth,
          y: itemY,
          fg: nameColor,
          bg: isSelected ? this.selectedBackgroundColor : this.backgroundColor,
          font: this.font,
        })
        descX = contentX + 1 + indicatorWidth
      } else {
        this.frameBuffer.drawText(nameContent, contentX + 1, itemY, nameColor)
      }

      if (this.showDescription && itemY + this.fontHeight < contentY + contentHeight) {
        const descColor = isSelected ? this.selectedDescriptionColor : this.descriptionColor
        this.frameBuffer.drawText(option.description, descX, itemY + this.fontHeight, descColor)
      }
    }

    if (this.showScrollIndicator && this.options.length > this.maxVisibleItems) {
      this.renderScrollIndicatorToFrameBuffer(contentX, contentY, contentWidth, contentHeight)
    }
  }

  private renderScrollIndicatorToFrameBuffer(
    contentX: number,
    contentY: number,
    contentWidth: number,
    contentHeight: number,
  ): void {
    if (!this.frameBuffer) return

    const scrollPercent = this.selectedIndex / Math.max(1, this.options.length - 1)
    const indicatorHeight = Math.max(1, contentHeight - 2)
    const indicatorY = contentY + 1 + Math.floor(scrollPercent * indicatorHeight)
    const indicatorX = contentX + contentWidth - 1

    this.frameBuffer.drawText("█", indicatorX, indicatorY, parseColor("#666666"))
  }

  public setOptions(options: SelectOption[]): void {
    this.options = options
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, options.length - 1))
    this.updateScrollOffset()
    this.needsRefresh = true
  }

  public getSelectedOption(): SelectOption | null {
    return this.options[this.selectedIndex] || null
  }

  public getSelectedIndex(): number {
    return this.selectedIndex
  }

  public moveUp(steps: number = 1): void {
    const newIndex = this.selectedIndex - steps

    if (newIndex >= 0) {
      this.selectedIndex = newIndex
    } else if (this.wrapSelection && this.options.length > 0) {
      this.selectedIndex = this.options.length - 1
    } else {
      this.selectedIndex = 0
    }

    this.updateScrollOffset()
    this.needsRefresh = true
    this.emit(SelectElementEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public moveDown(steps: number = 1): void {
    const newIndex = this.selectedIndex + steps

    if (newIndex < this.options.length) {
      this.selectedIndex = newIndex
    } else if (this.wrapSelection && this.options.length > 0) {
      this.selectedIndex = 0
    } else {
      this.selectedIndex = this.options.length - 1
    }

    this.updateScrollOffset()
    this.needsRefresh = true
    this.emit(SelectElementEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public selectCurrent(): void {
    const selected = this.getSelectedOption()
    if (selected) {
      this.emit(SelectElementEvents.ITEM_SELECTED, this.selectedIndex, selected)
    }
  }

  public setSelectedIndex(index: number): void {
    if (index >= 0 && index < this.options.length) {
      this.selectedIndex = index
      this.updateScrollOffset()
      this.needsRefresh = true
      this.emit(SelectElementEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
    }
  }

  private updateScrollOffset(): void {
    if (!this.options) return

    const halfVisible = Math.floor(this.maxVisibleItems / 2)
    const newScrollOffset = Math.max(
      0,
      Math.min(this.selectedIndex - halfVisible, this.options.length - this.maxVisibleItems),
    )

    if (newScrollOffset !== this.scrollOffset) {
      this.scrollOffset = newScrollOffset
      this.needsRefresh = true
    }
  }

  protected onResize(width: number, height: number): void {
    const hasBorder = this.border !== false
    const usableHeight = hasBorder ? height - 2 : height
    this.maxVisibleItems = Math.max(1, Math.floor(usableHeight / this.linesPerItem))
    this.updateScrollOffset()
    super.onResize(width, height)
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    const keyName = typeof key === "string" ? key : key.name
    const isShift = typeof key !== "string" && key.shift

    switch (keyName) {
      case "up":
      case "k":
        this.moveUp(isShift ? this.fastScrollStep : 1)
        return true
      case "down":
      case "j":
        this.moveDown(isShift ? this.fastScrollStep : 1)
        return true
      case "return":
      case "enter":
        this.selectCurrent()
        return true
    }

    return false
  }

  public getShowScrollIndicator(): boolean {
    return this.showScrollIndicator
  }

  public setShowScrollIndicator(show: boolean): void {
    this.showScrollIndicator = show
    this.needsRefresh = true
  }

  public getShowDescription(): boolean {
    return this.showDescription
  }

  public setShowDescription(show: boolean): void {
    if (this.showDescription !== show) {
      this.showDescription = show
      this.linesPerItem = this.showDescription ? (this.font ? this.fontHeight + 1 : 2) : this.font ? this.fontHeight : 1
      this.linesPerItem += this.itemSpacing

      const hasBorder = this.border !== false
      const usableHeight = hasBorder ? this.height - 2 : this.height
      this.maxVisibleItems = Math.max(1, Math.floor(usableHeight / this.linesPerItem))
      this.updateScrollOffset()
      this.needsRefresh = true
    }
  }

  public getWrapSelection(): boolean {
    return this.wrapSelection
  }

  public setWrapSelection(wrap: boolean): void {
    this.wrapSelection = wrap
  }
}
