import { Renderable, type RenderableOptions } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import { parseColor } from "../utils"
import type { RGBA, ColorInput } from "../types"
import type { ParsedKey } from "../lib/parse.keypress"
import { renderFontToFrameBuffer, measureText, fonts } from "../lib/ascii.font"

export interface SelectOption {
  name: string
  description: string
  value?: any
}

export interface SelectRenderableOptions extends RenderableOptions {
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
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

export enum SelectRenderableEvents {
  SELECTION_CHANGED = "selectionChanged",
  ITEM_SELECTED = "itemSelected",
}

export class SelectRenderable extends Renderable {
  private options: SelectOption[]
  private selectedIndex: number = 0
  private scrollOffset: number = 0
  private maxVisibleItems: number

  private backgroundColor: RGBA
  private textColor: RGBA
  private focusedBackgroundColor: RGBA
  private focusedTextColor: RGBA
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

  constructor(id: string, options: SelectRenderableOptions) {
    super(id, { ...options, buffered: true })

    this.backgroundColor = parseColor(options.backgroundColor || "transparent")
    this.textColor = parseColor(options.textColor || "#FFFFFF")
    this.focusedBackgroundColor = parseColor(options.focusedBackgroundColor || options.backgroundColor || "#1a1a1a")
    this.focusedTextColor = parseColor(options.focusedTextColor || options.textColor || "#FFFFFF")
    this.options = options.options || []

    this.showScrollIndicator = options.showScrollIndicator ?? false
    this.wrapSelection = options.wrapSelection ?? false
    this.showDescription = options.showDescription ?? true
    this.font = options.font
    this.itemSpacing = options.itemSpacing || 0

    this.fontHeight = this.font ? measureText({ text: "A", font: this.font }).height : 1
    this.linesPerItem = this.showDescription ? (this.font ? this.fontHeight + 1 : 2) : this.font ? this.fontHeight : 1
    this.linesPerItem += this.itemSpacing

    this.maxVisibleItems = Math.max(1, Math.floor(this.height / this.linesPerItem))

    this.selectedBackgroundColor = parseColor(options.selectedBackgroundColor || "#334455")
    this.selectedTextColor = parseColor(options.selectedTextColor || "#FFFF00")
    this.descriptionColor = parseColor(options.descriptionColor || "#888888")
    this.selectedDescriptionColor = parseColor(options.selectedDescriptionColor || "#CCCCCC")
    this.fastScrollStep = options.fastScrollStep || 5

    this.markDirty() // Initial render needed
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible || !this.frameBuffer) return

    if (this.isDirty) {
      this.refreshFrameBuffer()
      this.markClean()
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
      const baseTextColor = this._focused ? this.focusedTextColor : this.textColor
      const nameColor = isSelected ? this.selectedTextColor : baseTextColor
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
          bg: isSelected ? this.selectedBackgroundColor : bgColor,
          font: this.font,
        })
        descX = contentX + 1 + indicatorWidth
      } else {
        this.frameBuffer.drawText(nameContent, contentX + 1, itemY, nameColor)
      }

      if (this.showDescription && itemY + this.fontHeight < contentY + contentHeight) {
        const descColor = isSelected ? this.selectedDescriptionColor : this.descriptionColor
        const descBg = this._focused ? this.focusedBackgroundColor : this.backgroundColor
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
    this.markDirty()
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
    this.markDirty()
    this.emit(SelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
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
    this.markDirty()
    this.emit(SelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public selectCurrent(): void {
    const selected = this.getSelectedOption()
    if (selected) {
      this.emit(SelectRenderableEvents.ITEM_SELECTED, this.selectedIndex, selected)
    }
  }

  public setSelectedIndex(index: number): void {
    if (index >= 0 && index < this.options.length) {
      this.selectedIndex = index
      this.updateScrollOffset()
      this.markDirty()
      this.emit(SelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
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
      this.markDirty()
    }
  }

  protected onResize(width: number, height: number): void {
    this.maxVisibleItems = Math.max(1, Math.floor(height / this.linesPerItem))
    this.updateScrollOffset()
    this.markDirty()
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
    this.markDirty()
  }

  public getShowDescription(): boolean {
    return this.showDescription
  }

  public setShowDescription(show: boolean): void {
    if (this.showDescription !== show) {
      this.showDescription = show
      this.linesPerItem = this.showDescription ? (this.font ? this.fontHeight + 1 : 2) : this.font ? this.fontHeight : 1
      this.linesPerItem += this.itemSpacing

      this.maxVisibleItems = Math.max(1, Math.floor(this.height / this.linesPerItem))
      this.updateScrollOffset()
      this.markDirty()
    }
  }

  public getWrapSelection(): boolean {
    return this.wrapSelection
  }

  public setWrapSelection(wrap: boolean): void {
    this.wrapSelection = wrap
  }
}
