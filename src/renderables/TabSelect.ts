import { Renderable, type RenderableOptions } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import { parseColor } from "../utils"
import type { RGBA, ColorInput } from "../types"
import type { ParsedKey } from "../lib/parse.keypress"

export interface TabSelectOption {
  name: string
  description: string
  value?: any
}

export interface TabSelectRenderableOptions extends Omit<RenderableOptions, "height"> {
  height?: number
  options: TabSelectOption[]
  tabWidth?: number
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  selectedBackgroundColor?: ColorInput
  selectedTextColor?: ColorInput
  selectedDescriptionColor?: ColorInput
  showScrollArrows?: boolean
  showDescription?: boolean
  showUnderline?: boolean
  wrapSelection?: boolean
}

export enum TabSelectRenderableEvents {
  SELECTION_CHANGED = "selectionChanged",
  ITEM_SELECTED = "itemSelected",
}

function calculateDynamicHeight(showUnderline: boolean, showDescription: boolean): number {
  let height = 1

  if (showUnderline) {
    height += 1
  }

  if (showDescription) {
    height += 1
  }

  return height
}

export class TabSelectRenderable extends Renderable {
  private options: TabSelectOption[]
  private selectedIndex: number = 0
  private scrollOffset: number = 0
  private tabWidth: number
  private maxVisibleTabs: number

  private backgroundColor: RGBA
  private textColor: RGBA
  private focusedBackgroundColor: RGBA
  private focusedTextColor: RGBA
  private selectedBackgroundColor: RGBA
  private selectedTextColor: RGBA
  private selectedDescriptionColor: RGBA
  private showScrollArrows: boolean
  private showDescription: boolean
  private showUnderline: boolean
  private wrapSelection: boolean

  constructor(id: string, options: TabSelectRenderableOptions) {
    const calculatedHeight = calculateDynamicHeight(options.showUnderline ?? true, options.showDescription ?? true)

    super(id, { ...options, height: calculatedHeight, buffered: true })

    this.backgroundColor = parseColor(options.backgroundColor || "transparent")
    this.textColor = parseColor(options.textColor || "#FFFFFF")
    this.focusedBackgroundColor = parseColor(options.focusedBackgroundColor || options.backgroundColor || "#1a1a1a")
    this.focusedTextColor = parseColor(options.focusedTextColor || options.textColor || "#FFFFFF")
    this.options = options.options || []
    this.tabWidth = options.tabWidth || 20
    this.showDescription = options.showDescription ?? true
    this.showUnderline = options.showUnderline ?? true
    this.showScrollArrows = options.showScrollArrows ?? true
    this.wrapSelection = options.wrapSelection ?? false

    this.maxVisibleTabs = Math.max(1, Math.floor(this.width / this.tabWidth))

    this.selectedBackgroundColor = parseColor(options.selectedBackgroundColor || "#334455")
    this.selectedTextColor = parseColor(options.selectedTextColor || "#FFFF00")
    this.selectedDescriptionColor = parseColor(options.selectedDescriptionColor || "#CCCCCC")
  }

  private calculateDynamicHeight(): number {
    return calculateDynamicHeight(this.showUnderline, this.showDescription)
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible || !this.frameBuffer) return

    if (this.isDirty) {
      this.refreshFrameBuffer()
    }
  }

  private refreshFrameBuffer(): void {
    if (!this.frameBuffer || this.options.length === 0) return

    // Use focused colors if focused
    const bgColor = this._focused ? this.focusedBackgroundColor : this.backgroundColor
    this.frameBuffer.clear(bgColor)

    const contentX = 0
    const contentY = 0
    const contentWidth = this.width
    const contentHeight = this.height

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

      const baseTextColor = this._focused ? this.focusedTextColor : this.textColor
      const nameColor = isSelected ? this.selectedTextColor : baseTextColor
      const nameContent = this.truncateText(option.name, actualTabWidth - 2)
      this.frameBuffer.drawText(nameContent, tabX + 1, contentY, nameColor)

      if (isSelected && this.showUnderline && contentHeight >= 2) {
        const underlineY = contentY + 1
        const underlineBg = isSelected ? this.selectedBackgroundColor : bgColor
        this.frameBuffer.drawText("▬".repeat(actualTabWidth), tabX, underlineY, nameColor, underlineBg)
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
    this.needsUpdate()
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
    this.needsUpdate()
    this.emit(TabSelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
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
    this.needsUpdate()
    this.emit(TabSelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public selectCurrent(): void {
    const selected = this.getSelectedOption()
    if (selected) {
      this.emit(TabSelectRenderableEvents.ITEM_SELECTED, this.selectedIndex, selected)
    }
  }

  public setSelectedIndex(index: number): void {
    if (index >= 0 && index < this.options.length) {
      this.selectedIndex = index
      this.updateScrollOffset()
      this.needsUpdate()
      this.emit(TabSelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
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
      this.needsUpdate()
    }
  }

  protected onResize(width: number, height: number): void {
    this.maxVisibleTabs = Math.max(1, Math.floor(width / this.tabWidth))
    this.updateScrollOffset()
    this.needsUpdate()
  }

  public setTabWidth(tabWidth: number): void {
    if (this.tabWidth === tabWidth) return

    this.tabWidth = tabWidth
    this.maxVisibleTabs = Math.max(1, Math.floor(this.width / this.tabWidth))

    this.updateScrollOffset()
    this.needsUpdate()
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
      this.height = newHeight
    }
  }

  public getShowDescription(): boolean {
    return this.showDescription
  }

  public setShowUnderline(show: boolean): void {
    if (this.showUnderline !== show) {
      this.showUnderline = show
      const newHeight = this.calculateDynamicHeight()
      this.height = newHeight
    }
  }

  public getShowUnderline(): boolean {
    return this.showUnderline
  }

  public setShowScrollArrows(show: boolean): void {
    if (this.showScrollArrows !== show) {
      this.showScrollArrows = show
      this.needsUpdate()
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
