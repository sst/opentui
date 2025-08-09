import { BufferedElement, type ElementOptions } from "../element"
import type { BorderSides, BorderStyle, CliRenderer } from "../../index"
import { parseColor } from "../../utils"
import type { RGBA, ColorInput } from "../../types"
import type { ParsedKey } from "../../parse.keypress"

export interface TabSelectOption {
  name: string
  description: string
  value?: any
}

export interface TabSelectElementOptions extends Omit<ElementOptions, "height"> {
  height?: number
  options: TabSelectOption[]
  tabWidth?: number
  selectedBackgroundColor?: ColorInput
  selectedTextColor?: ColorInput
  selectedDescriptionColor?: ColorInput
  showScrollArrows?: boolean
  showDescription?: boolean
  showUnderline?: boolean
  wrapSelection?: boolean
}

export enum TabSelectElementEvents {
  SELECTION_CHANGED = "selectionChanged",
  ITEM_SELECTED = "itemSelected",
}

function calculateDynamicHeight(
  border: boolean | BorderSides[],
  showUnderline: boolean,
  showDescription: boolean,
): number {
  const hasBorder = border !== false
  let height = 1

  if (showUnderline) {
    height += 1
  }

  if (showDescription) {
    height += 1
  }

  if (hasBorder) {
    height += 2
  }

  return height
}

export class TabSelectElement extends BufferedElement {
  private options: TabSelectOption[]
  private selectedIndex: number = 0
  private scrollOffset: number = 0
  private tabWidth: number
  private maxVisibleTabs: number

  private selectedBackgroundColor: RGBA
  private selectedTextColor: RGBA
  private selectedDescriptionColor: RGBA
  private showScrollArrows: boolean
  private showDescription: boolean
  private showUnderline: boolean
  private wrapSelection: boolean

  constructor(id: string, options: TabSelectElementOptions) {
    const calculatedHeight = calculateDynamicHeight(
      options.border ?? true,
      options.showUnderline ?? true,
      options.showDescription ?? true,
    )

    super(id, { ...options, height: calculatedHeight })

    this.options = options.options || []
    this.tabWidth = options.tabWidth || 20
    this.showDescription = options.showDescription ?? true
    this.showUnderline = options.showUnderline ?? true
    this.showScrollArrows = options.showScrollArrows ?? true
    this.wrapSelection = options.wrapSelection ?? false

    const hasBorder = this.border !== false
    const usableWidth = hasBorder ? this.width - 2 : this.width
    this.maxVisibleTabs = Math.max(1, Math.floor(usableWidth / this.tabWidth))

    this.selectedBackgroundColor = parseColor(options.selectedBackgroundColor || "#334455")
    this.selectedTextColor = parseColor(options.selectedTextColor || "#FFFF00")
    this.selectedDescriptionColor = parseColor(options.selectedDescriptionColor || "#CCCCCC")
  }

  private calculateDynamicHeight(): number {
    return calculateDynamicHeight(this.border, this.showUnderline, this.showDescription)
  }

  protected refreshContent(contentX: number, contentY: number, contentWidth: number, contentHeight: number): void {
    if (!this.frameBuffer || this.options.length === 0) return

    const visibleOptions = this.options.slice(this.scrollOffset, this.scrollOffset + this.maxVisibleTabs)

    // Render tab names
    for (let i = 0; i < visibleOptions.length; i++) {
      const actualIndex = this.scrollOffset + i
      const option = visibleOptions[i]
      const isSelected = actualIndex === this.selectedIndex
      const tabX = contentX + i * this.tabWidth

      if (tabX >= contentX + contentWidth) break

      const actualTabWidth = Math.min(this.tabWidth, contentWidth - i * this.tabWidth)

      if (isSelected) {
        this.frameBuffer.fillRect(tabX, contentY, actualTabWidth, 1, this.selectedBackgroundColor)
      }

      const nameColor = isSelected ? this.selectedTextColor : this.textColor
      const nameContent = this.truncateText(option.name, actualTabWidth - 2)
      this.frameBuffer.drawText(nameContent, tabX + 1, contentY, nameColor)

      if (isSelected && this.showUnderline && contentHeight >= 2) {
        const underlineY = contentY + 1
        this.frameBuffer.drawText("▬".repeat(actualTabWidth), tabX, underlineY, nameColor, this.selectedBackgroundColor)
      }
    }

    if (this.showDescription && contentHeight >= (this.showUnderline ? 3 : 2)) {
      const selectedOption = this.getSelectedOption()
      if (selectedOption) {
        const descriptionY = contentY + (this.showUnderline ? 2 : 1)
        const descColor = this.selectedDescriptionColor
        const descContent = this.truncateText(selectedOption.description, contentWidth - 2)
        this.frameBuffer.drawText(descContent, contentX + 1, descriptionY, descColor)
      }
    }

    if (this.showScrollArrows && this.options.length > this.maxVisibleTabs) {
      this.renderScrollArrowsToFrameBuffer(contentX, contentY, contentWidth, contentHeight)
    }
  }

  private truncateText(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text
    return text.substring(0, Math.max(0, maxWidth - 1)) + "…"
  }

  private renderScrollArrowsToFrameBuffer(
    contentX: number,
    contentY: number,
    contentWidth: number,
    contentHeight: number,
  ): void {
    if (!this.frameBuffer) return

    const hasMoreLeft = this.scrollOffset > 0
    const hasMoreRight = this.scrollOffset + this.maxVisibleTabs < this.options.length

    if (hasMoreLeft) {
      this.frameBuffer.drawText("‹", contentX, contentY, parseColor("#AAAAAA"))
    }

    if (hasMoreRight) {
      this.frameBuffer.drawText("›", contentX + contentWidth - 1, contentY, parseColor("#AAAAAA"))
    }
  }

  public setOptions(options: TabSelectOption[]): void {
    this.options = options
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, options.length - 1))
    this.updateScrollOffset()
    this.needsRefresh = true
  }

  public getSelectedOption(): TabSelectOption | null {
    return this.options[this.selectedIndex] || null
  }

  public getSelectedIndex(): number {
    return this.selectedIndex
  }

  public moveLeft(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--
    } else if (this.wrapSelection && this.options.length > 0) {
      this.selectedIndex = this.options.length - 1
    } else {
      return
    }

    this.updateScrollOffset()
    this.needsRefresh = true
    this.emit(TabSelectElementEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public moveRight(): void {
    if (this.selectedIndex < this.options.length - 1) {
      this.selectedIndex++
    } else if (this.wrapSelection && this.options.length > 0) {
      this.selectedIndex = 0
    } else {
      return
    }

    this.updateScrollOffset()
    this.needsRefresh = true
    this.emit(TabSelectElementEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public selectCurrent(): void {
    const selected = this.getSelectedOption()
    if (selected) {
      this.emit(TabSelectElementEvents.ITEM_SELECTED, this.selectedIndex, selected)
    }
  }

  public setSelectedIndex(index: number): void {
    if (index >= 0 && index < this.options.length) {
      this.selectedIndex = index
      this.updateScrollOffset()
      this.needsRefresh = true
      this.emit(TabSelectElementEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
    }
  }

  private updateScrollOffset(): void {
    const halfVisible = Math.floor(this.maxVisibleTabs / 2)
    const newScrollOffset = Math.max(
      0,
      Math.min(this.selectedIndex - halfVisible, this.options.length - this.maxVisibleTabs),
    )

    if (newScrollOffset !== this.scrollOffset) {
      this.scrollOffset = newScrollOffset
      this.needsRefresh = true
    }
  }

  protected onResize(width: number, height: number): void {
    const hasBorder = this.border !== false
    const usableWidth = hasBorder ? width - 2 : width
    this.maxVisibleTabs = Math.max(1, Math.floor(usableWidth / this.tabWidth))
    this.updateScrollOffset()
    super.onResize(width, height)
  }

  public setTabWidth(tabWidth: number): void {
    if (this.tabWidth === tabWidth) return

    this.tabWidth = tabWidth

    const hasBorder = this.border !== false
    const usableWidth = hasBorder ? this.width - 2 : this.width
    this.maxVisibleTabs = Math.max(1, Math.floor(usableWidth / this.tabWidth))

    this.updateScrollOffset()
    this.needsRefresh = true
  }

  public getTabWidth(): number {
    return this.tabWidth
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    const keyName = typeof key === "string" ? key : key.name

    switch (keyName) {
      case "left":
      case "[":
        this.moveLeft()
        return true
      case "right":
      case "]":
        this.moveRight()
        return true
      case "return":
      case "enter":
        this.selectCurrent()
        return true
    }

    return false
  }

  public setShowDescription(show: boolean): void {
    if (this.showDescription !== show) {
      this.showDescription = show
      const newHeight = this.calculateDynamicHeight()
      this.setHeight(newHeight)
    }
  }

  public getShowDescription(): boolean {
    return this.showDescription
  }

  public setShowUnderline(show: boolean): void {
    if (this.showUnderline !== show) {
      this.showUnderline = show
      const newHeight = this.calculateDynamicHeight()
      this.setHeight(newHeight)
    }
  }

  public getShowUnderline(): boolean {
    return this.showUnderline
  }

  protected onBorderChanged(border: boolean | BorderSides[], borderStyle: BorderStyle): void {
    const newHeight = this.calculateDynamicHeight()
    this.setHeight(newHeight)

    const hasBorder = border !== false
    const usableWidth = hasBorder ? this.width - 2 : this.width
    this.maxVisibleTabs = Math.max(1, Math.floor(usableWidth / this.tabWidth))
    this.updateScrollOffset()
  }

  public setShowScrollArrows(show: boolean): void {
    if (this.showScrollArrows !== show) {
      this.showScrollArrows = show
      this.needsRefresh = true
    }
  }

  public getShowScrollArrows(): boolean {
    return this.showScrollArrows
  }

  public setWrapSelection(wrap: boolean): void {
    this.wrapSelection = wrap
  }

  public getWrapSelection(): boolean {
    return this.wrapSelection
  }
}
