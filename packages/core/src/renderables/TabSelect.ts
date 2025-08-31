import { Renderable, type RenderableOptions } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"
import type { ParsedKey } from "../lib/parse.keypress"
import type { RenderContext } from "../types"

export interface TabSelectOption {
  name: string
  description: string
  value?: any
}

export interface TabSelectRenderableOptions extends Omit<RenderableOptions<TabSelectRenderable>, "height"> {
  height?: number
  options?: TabSelectOption[]
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
  protected focusable: boolean = true

  private _options: TabSelectOption[] = []
  private selectedIndex: number = 0
  private scrollOffset: number = 0
  private _tabWidth: number
  private maxVisibleTabs: number

  private _backgroundColor: RGBA
  private _textColor: RGBA
  private _focusedBackgroundColor: RGBA
  private _focusedTextColor: RGBA
  private _selectedBackgroundColor: RGBA
  private _selectedTextColor: RGBA
  private _selectedDescriptionColor: RGBA
  private _showScrollArrows: boolean
  private _showDescription: boolean
  private _showUnderline: boolean
  private _wrapSelection: boolean

  constructor(ctx: RenderContext, options: TabSelectRenderableOptions) {
    const calculatedHeight = calculateDynamicHeight(options.showUnderline ?? true, options.showDescription ?? true)

    super(ctx, { ...options, height: calculatedHeight, buffered: true })

    this._backgroundColor = parseColor(options.backgroundColor || "transparent")
    this._textColor = parseColor(options.textColor || "#FFFFFF")
    this._focusedBackgroundColor = parseColor(options.focusedBackgroundColor || options.backgroundColor || "#1a1a1a")
    this._focusedTextColor = parseColor(options.focusedTextColor || options.textColor || "#FFFFFF")
    this._options = options.options || []
    this._tabWidth = options.tabWidth || 20
    this._showDescription = options.showDescription ?? true
    this._showUnderline = options.showUnderline ?? true
    this._showScrollArrows = options.showScrollArrows ?? true
    this._wrapSelection = options.wrapSelection ?? false

    this.maxVisibleTabs = Math.max(1, Math.floor(this.width / this._tabWidth))

    this._selectedBackgroundColor = parseColor(options.selectedBackgroundColor || "#334455")
    this._selectedTextColor = parseColor(options.selectedTextColor || "#FFFF00")
    this._selectedDescriptionColor = parseColor(options.selectedDescriptionColor || "#CCCCCC")
  }

  private calculateDynamicHeight(): number {
    return calculateDynamicHeight(this._showUnderline, this._showDescription)
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible || !this.frameBuffer) return

    if (this.isDirty) {
      this.refreshFrameBuffer()
    }
  }

  private refreshFrameBuffer(): void {
    if (!this.frameBuffer || this._options.length === 0) return

    // Use focused colors if focused
    const bgColor = this._focused ? this._focusedBackgroundColor : this._backgroundColor
    this.frameBuffer.clear(bgColor)

    const contentX = 0
    const contentY = 0
    const contentWidth = this.width
    const contentHeight = this.height

    const visibleOptions = this._options.slice(this.scrollOffset, this.scrollOffset + this.maxVisibleTabs)

    // Render tab names
    for (let i = 0; i < visibleOptions.length; i++) {
      const actualIndex = this.scrollOffset + i
      const option = visibleOptions[i]
      const isSelected = actualIndex === this.selectedIndex
      const tabX = contentX + i * this._tabWidth

      if (tabX >= contentX + contentWidth) break

      const actualTabWidth = Math.min(this._tabWidth, contentWidth - i * this._tabWidth)

      if (isSelected) {
        this.frameBuffer.fillRect(tabX, contentY, actualTabWidth, 1, this._selectedBackgroundColor)
      }

      const baseTextColor = this._focused ? this._focusedTextColor : this._textColor
      const nameColor = isSelected ? this._selectedTextColor : baseTextColor
      const nameContent = this.truncateText(option.name, actualTabWidth - 2)
      this.frameBuffer.drawText(nameContent, tabX + 1, contentY, nameColor)

      if (isSelected && this._showUnderline && contentHeight >= 2) {
        const underlineY = contentY + 1
        const underlineBg = isSelected ? this._selectedBackgroundColor : bgColor
        this.frameBuffer.drawText("▬".repeat(actualTabWidth), tabX, underlineY, nameColor, underlineBg)
      }
    }

    if (this._showDescription && contentHeight >= (this._showUnderline ? 3 : 2)) {
      const selectedOption = this.getSelectedOption()
      if (selectedOption) {
        const descriptionY = contentY + (this._showUnderline ? 2 : 1)
        const descColor = this._selectedDescriptionColor
        const descContent = this.truncateText(selectedOption.description, contentWidth - 2)
        this.frameBuffer.drawText(descContent, contentX + 1, descriptionY, descColor)
      }
    }

    if (this._showScrollArrows && this._options.length > this.maxVisibleTabs) {
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
    const hasMoreRight = this.scrollOffset + this.maxVisibleTabs < this._options.length

    if (hasMoreLeft) {
      this.frameBuffer.drawText("‹", contentX, contentY, parseColor("#AAAAAA"))
    }

    if (hasMoreRight) {
      this.frameBuffer.drawText("›", contentX + contentWidth - 1, contentY, parseColor("#AAAAAA"))
    }
  }

  public setOptions(options: TabSelectOption[]): void {
    this._options = options
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, options.length - 1))
    this.updateScrollOffset()
    this.requestRender()
  }

  public getSelectedOption(): TabSelectOption | null {
    return this._options[this.selectedIndex] || null
  }

  public getSelectedIndex(): number {
    return this.selectedIndex
  }

  public moveLeft(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--
    } else if (this._wrapSelection && this._options.length > 0) {
      this.selectedIndex = this._options.length - 1
    } else {
      return
    }

    this.updateScrollOffset()
    this.requestRender()
    this.emit(TabSelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public moveRight(): void {
    if (this.selectedIndex < this._options.length - 1) {
      this.selectedIndex++
    } else if (this._wrapSelection && this._options.length > 0) {
      this.selectedIndex = 0
    } else {
      return
    }

    this.updateScrollOffset()
    this.requestRender()
    this.emit(TabSelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public selectCurrent(): void {
    const selected = this.getSelectedOption()
    if (selected) {
      this.emit(TabSelectRenderableEvents.ITEM_SELECTED, this.selectedIndex, selected)
    }
  }

  public setSelectedIndex(index: number): void {
    if (index >= 0 && index < this._options.length) {
      this.selectedIndex = index
      this.updateScrollOffset()
      this.requestRender()
      this.emit(TabSelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
    }
  }

  private updateScrollOffset(): void {
    const halfVisible = Math.floor(this.maxVisibleTabs / 2)
    const newScrollOffset = Math.max(
      0,
      Math.min(this.selectedIndex - halfVisible, this._options.length - this.maxVisibleTabs),
    )

    if (newScrollOffset !== this.scrollOffset) {
      this.scrollOffset = newScrollOffset
      this.requestRender()
    }
  }

  protected onResize(width: number, height: number): void {
    this.maxVisibleTabs = Math.max(1, Math.floor(width / this._tabWidth))
    this.updateScrollOffset()
    this.requestRender()
  }

  public setTabWidth(tabWidth: number): void {
    if (this._tabWidth === tabWidth) return

    this._tabWidth = tabWidth
    this.maxVisibleTabs = Math.max(1, Math.floor(this.width / this._tabWidth))

    this.updateScrollOffset()
    this.requestRender()
  }

  public getTabWidth(): number {
    return this._tabWidth
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

  public get options(): TabSelectOption[] {
    return this._options
  }

  public set options(options: TabSelectOption[]) {
    this._options = options
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, options.length - 1))
    this.updateScrollOffset()
    this.requestRender()
  }

  public set backgroundColor(color: ColorInput) {
    this._backgroundColor = parseColor(color)
    this.requestRender()
  }

  public set textColor(color: ColorInput) {
    this._textColor = parseColor(color)
    this.requestRender()
  }

  public set focusedBackgroundColor(color: ColorInput) {
    this._focusedBackgroundColor = parseColor(color)
    this.requestRender()
  }

  public set focusedTextColor(color: ColorInput) {
    this._focusedTextColor = parseColor(color)
    this.requestRender()
  }

  public set selectedBackgroundColor(color: ColorInput) {
    this._selectedBackgroundColor = parseColor(color)
    this.requestRender()
  }

  public set selectedTextColor(color: ColorInput) {
    this._selectedTextColor = parseColor(color)
    this.requestRender()
  }

  public set selectedDescriptionColor(color: ColorInput) {
    this._selectedDescriptionColor = parseColor(color)
    this.requestRender()
  }

  public get showDescription(): boolean {
    return this._showDescription
  }

  public set showDescription(show: boolean) {
    if (this._showDescription !== show) {
      this._showDescription = show
      const newHeight = this.calculateDynamicHeight()
      this.height = newHeight
      this.requestRender()
    }
  }

  public get showUnderline(): boolean {
    return this._showUnderline
  }

  public set showUnderline(show: boolean) {
    if (this._showUnderline !== show) {
      this._showUnderline = show
      const newHeight = this.calculateDynamicHeight()
      this.height = newHeight
      this.requestRender()
    }
  }

  public get showScrollArrows(): boolean {
    return this._showScrollArrows
  }

  public set showScrollArrows(show: boolean) {
    if (this._showScrollArrows !== show) {
      this._showScrollArrows = show
      this.requestRender()
    }
  }

  public get wrapSelection(): boolean {
    return this._wrapSelection
  }

  public set wrapSelection(wrap: boolean) {
    this._wrapSelection = wrap
  }

  public get tabWidth(): number {
    return this._tabWidth
  }

  public set tabWidth(tabWidth: number) {
    if (this._tabWidth === tabWidth) return

    this._tabWidth = tabWidth
    this.maxVisibleTabs = Math.max(1, Math.floor(this.width / this._tabWidth))

    this.updateScrollOffset()
    this.requestRender()
  }
}
