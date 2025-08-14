import { Renderable, type RenderableOptions } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import { fonts, measureText, renderFontToFrameBuffer } from "../lib/ascii.font"
import type { ParsedKey } from "../lib/parse.keypress"
import type { ColorInput, RGBA } from "../types"
import { parseColor } from "../utils"

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
  protected focusable: boolean = true

  private options: SelectOption[]
  private selectedIndex: number = 0
  private scrollOffset: number = 0
  private maxVisibleItems: number

  private _backgroundColor: RGBA
  private _textColor: RGBA
  private _focusedBackgroundColor: RGBA
  private _focusedTextColor: RGBA
  private _selectedBackgroundColor: RGBA
  private _selectedTextColor: RGBA
  private _descriptionColor: RGBA
  private _selectedDescriptionColor: RGBA
  private _showScrollIndicator: boolean
  private _wrapSelection: boolean
  private _showDescription: boolean
  private _font?: keyof typeof fonts
  private _itemSpacing: number
  private linesPerItem: number
  private fontHeight: number
  private _fastScrollStep: number

  constructor(id: string, options: SelectRenderableOptions) {
    super(id, { ...options, buffered: true })

    this._backgroundColor = parseColor(options.backgroundColor || "transparent")
    this._textColor = parseColor(options.textColor || "#FFFFFF")
    this._focusedBackgroundColor = parseColor(options.focusedBackgroundColor || options.backgroundColor || "#1a1a1a")
    this._focusedTextColor = parseColor(options.focusedTextColor || options.textColor || "#FFFFFF")
    this.options = options.options || []

    this._showScrollIndicator = options.showScrollIndicator ?? false
    this._wrapSelection = options.wrapSelection ?? false
    this._showDescription = options.showDescription ?? true
    this._font = options.font
    this._itemSpacing = options.itemSpacing || 0

    this.fontHeight = this._font ? measureText({ text: "A", font: this._font }).height : 1
    this.linesPerItem = this._showDescription
      ? this._font
        ? this.fontHeight + 1
        : 2
      : this._font
        ? this.fontHeight
        : 1
    this.linesPerItem += this._itemSpacing

    this.maxVisibleItems = Math.max(1, Math.floor(this.height / this.linesPerItem))

    this._selectedBackgroundColor = parseColor(options.selectedBackgroundColor || "#334455")
    this._selectedTextColor = parseColor(options.selectedTextColor || "#FFFF00")
    this._descriptionColor = parseColor(options.descriptionColor || "#888888")
    this._selectedDescriptionColor = parseColor(options.selectedDescriptionColor || "#CCCCCC")
    this._fastScrollStep = options.fastScrollStep || 5

    this.needsUpdate() // Initial render needed
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible || !this.frameBuffer) return

    if (this.isDirty) {
      this.refreshFrameBuffer()
    }
  }

  private refreshFrameBuffer(): void {
    if (!this.frameBuffer || this.options.length === 0) return

    const bgColor = this._focused ? this._focusedBackgroundColor : this._backgroundColor
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
        const contentHeight = this.linesPerItem - this._itemSpacing
        this.frameBuffer.fillRect(contentX, itemY, contentWidth, contentHeight, this._selectedBackgroundColor)
      }

      const nameContent = `${isSelected ? "▶ " : "  "}${option.name}`
      const baseTextColor = this._focused ? this._focusedTextColor : this._textColor
      const nameColor = isSelected ? this._selectedTextColor : baseTextColor
      let descX = contentX + 3

      if (this._font) {
        const indicator = isSelected ? "▶ " : "  "
        this.frameBuffer.drawText(indicator, contentX + 1, itemY, nameColor)

        const indicatorWidth = 2
        renderFontToFrameBuffer(this.frameBuffer, {
          text: option.name,
          x: contentX + 1 + indicatorWidth,
          y: itemY,
          fg: nameColor,
          bg: isSelected ? this._selectedBackgroundColor : bgColor,
          font: this._font,
        })
        descX = contentX + 1 + indicatorWidth
      } else {
        this.frameBuffer.drawText(nameContent, contentX + 1, itemY, nameColor)
      }

      if (this._showDescription && itemY + this.fontHeight < contentY + contentHeight) {
        const descColor = isSelected ? this._selectedDescriptionColor : this._descriptionColor
        const descBg = this._focused ? this._focusedBackgroundColor : this._backgroundColor
        this.frameBuffer.drawText(option.description, descX, itemY + this.fontHeight, descColor)
      }
    }

    if (this._showScrollIndicator && this.options.length > this.maxVisibleItems) {
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
    this.needsUpdate()
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
    } else if (this._wrapSelection && this.options.length > 0) {
      this.selectedIndex = this.options.length - 1
    } else {
      this.selectedIndex = 0
    }

    this.updateScrollOffset()
    this.needsUpdate()
    this.emit(SelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public moveDown(steps: number = 1): void {
    const newIndex = this.selectedIndex + steps

    if (newIndex < this.options.length) {
      this.selectedIndex = newIndex
    } else if (this._wrapSelection && this.options.length > 0) {
      this.selectedIndex = 0
    } else {
      this.selectedIndex = this.options.length - 1
    }

    this.updateScrollOffset()
    this.needsUpdate()
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
      this.needsUpdate()
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
      this.needsUpdate()
    }
  }

  protected onResize(width: number, height: number): void {
    this.maxVisibleItems = Math.max(1, Math.floor(height / this.linesPerItem))
    this.updateScrollOffset()
    this.needsUpdate()
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    const keyName = typeof key === "string" ? key : key.name
    const isShift = typeof key !== "string" && key.shift

    switch (keyName) {
      case "up":
      case "k":
        this.moveUp(isShift ? this._fastScrollStep : 1)
        return true
      case "down":
      case "j":
        this.moveDown(isShift ? this._fastScrollStep : 1)
        return true
      case "return":
      case "enter":
        this.selectCurrent()
        return true
    }

    return false
  }

  public get showScrollIndicator(): boolean {
    return this._showScrollIndicator
  }

  public set showScrollIndicator(show: boolean) {
    this._showScrollIndicator = show
    this.needsUpdate()
  }

  public get showDescription(): boolean {
    return this._showDescription
  }

  public set showDescription(show: boolean) {
    if (this._showDescription !== show) {
      this._showDescription = show
      this.linesPerItem = this._showDescription
        ? this._font
          ? this.fontHeight + 1
          : 2
        : this._font
          ? this.fontHeight
          : 1
      this.linesPerItem += this._itemSpacing

      this.maxVisibleItems = Math.max(1, Math.floor(this.height / this.linesPerItem))
      this.updateScrollOffset()
      this.needsUpdate()
    }
  }

  public get wrapSelection(): boolean {
    return this._wrapSelection
  }

  public set wrapSelection(wrap: boolean) {
    this._wrapSelection = wrap
  }

  public set backgroundColor(color: ColorInput) {
    this._backgroundColor = parseColor(color)
    this.needsUpdate()
  }

  public set textColor(color: ColorInput) {
    this._textColor = parseColor(color)
    this.needsUpdate()
  }

  public set focusedBackgroundColor(color: ColorInput) {
    this._focusedBackgroundColor = parseColor(color)
    this.needsUpdate()
  }

  public set focusedTextColor(color: ColorInput) {
    this._focusedTextColor = parseColor(color)
    this.needsUpdate()
  }

  public set selectedBackgroundColor(color: ColorInput) {
    this._selectedBackgroundColor = parseColor(color)
    this.needsUpdate()
  }

  public set selectedTextColor(color: ColorInput) {
    this._selectedTextColor = parseColor(color)
    this.needsUpdate()
  }

  public set descriptionColor(color: ColorInput) {
    this._descriptionColor = parseColor(color)
    this.needsUpdate()
  }

  public set selectedDescriptionColor(color: ColorInput) {
    this._selectedDescriptionColor = parseColor(color)
    this.needsUpdate()
  }

  public set font(font: keyof typeof fonts) {
    this._font = font
    this.fontHeight = measureText({ text: "A", font: this._font }).height
    this.linesPerItem = this._showDescription
      ? this._font
        ? this.fontHeight + 1
        : 2
      : this._font
        ? this.fontHeight
        : 1
    this.linesPerItem += this._itemSpacing
    this.maxVisibleItems = Math.max(1, Math.floor(this.height / this.linesPerItem))
    this.updateScrollOffset()
    this.needsUpdate()
  }

  public set itemSpacing(spacing: number) {
    this._itemSpacing = spacing
    this.linesPerItem = this._showDescription
      ? this._font
        ? this.fontHeight + 1
        : 2
      : this._font
        ? this.fontHeight
        : 1
    this.linesPerItem += this._itemSpacing
    this.maxVisibleItems = Math.max(1, Math.floor(this.height / this.linesPerItem))
    this.updateScrollOffset()
    this.needsUpdate()
  }

  public set fastScrollStep(step: number) {
    this._fastScrollStep = step
  }
}
