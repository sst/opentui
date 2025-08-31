import { OptimizedBuffer } from "../buffer"
import { fonts, measureText, renderFontToFrameBuffer } from "../lib/ascii.font"
import type { ParsedKey } from "../lib/parse.keypress"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"
import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"

export interface SelectOption {
  name: string
  description: string
  value?: any
}

export interface SelectRenderableOptions extends RenderableOptions<SelectRenderable> {
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  options?: SelectOption[]
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

  private _options: SelectOption[] = []
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

  protected _defaultOptions = {
    backgroundColor: "transparent",
    textColor: "#FFFFFF",
    focusedBackgroundColor: "#1a1a1a",
    focusedTextColor: "#FFFFFF",
    selectedBackgroundColor: "#334455",
    selectedTextColor: "#FFFF00",
    descriptionColor: "#888888",
    selectedDescriptionColor: "#CCCCCC",
    showScrollIndicator: false,
    wrapSelection: false,
    showDescription: true,
    itemSpacing: 0,
    fastScrollStep: 5,
  } satisfies Partial<SelectRenderableOptions>

  constructor(ctx: RenderContext, options: SelectRenderableOptions) {
    super(ctx, { ...options, buffered: true })

    this._backgroundColor = parseColor(options.backgroundColor || this._defaultOptions.backgroundColor)
    this._textColor = parseColor(options.textColor || this._defaultOptions.textColor)
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor || this._defaultOptions.focusedBackgroundColor,
    )
    this._focusedTextColor = parseColor(options.focusedTextColor || this._defaultOptions.focusedTextColor)
    this._options = options.options || []

    this._showScrollIndicator = options.showScrollIndicator ?? this._defaultOptions.showScrollIndicator
    this._wrapSelection = options.wrapSelection ?? this._defaultOptions.wrapSelection
    this._showDescription = options.showDescription ?? this._defaultOptions.showDescription
    this._font = options.font
    this._itemSpacing = options.itemSpacing || this._defaultOptions.itemSpacing

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

    this._selectedBackgroundColor = parseColor(
      options.selectedBackgroundColor || this._defaultOptions.selectedBackgroundColor,
    )
    this._selectedTextColor = parseColor(options.selectedTextColor || this._defaultOptions.selectedTextColor)
    this._descriptionColor = parseColor(options.descriptionColor || this._defaultOptions.descriptionColor)
    this._selectedDescriptionColor = parseColor(
      options.selectedDescriptionColor || this._defaultOptions.selectedDescriptionColor,
    )
    this._fastScrollStep = options.fastScrollStep || this._defaultOptions.fastScrollStep

    this.requestRender() // Initial render needed
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible || !this.frameBuffer) return

    if (this.isDirty) {
      this.refreshFrameBuffer()
    }
  }

  private refreshFrameBuffer(): void {
    if (!this.frameBuffer || this._options.length === 0) return

    const bgColor = this._focused ? this._focusedBackgroundColor : this._backgroundColor
    this.frameBuffer.clear(bgColor)

    const contentX = 0
    const contentY = 0
    const contentWidth = this.width
    const contentHeight = this.height

    const visibleOptions = this._options.slice(this.scrollOffset, this.scrollOffset + this.maxVisibleItems)

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

    if (this._showScrollIndicator && this._options.length > this.maxVisibleItems) {
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

    const scrollPercent = this.selectedIndex / Math.max(1, this._options.length - 1)
    const indicatorHeight = Math.max(1, contentHeight - 2)
    const indicatorY = contentY + 1 + Math.floor(scrollPercent * indicatorHeight)
    const indicatorX = contentX + contentWidth - 1

    this.frameBuffer.drawText("█", indicatorX, indicatorY, parseColor("#666666"))
  }

  public get options(): SelectOption[] {
    return this._options
  }

  public set options(options: SelectOption[]) {
    this._options = options
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, options.length - 1))
    this.updateScrollOffset()
    this.requestRender()
  }

  public getSelectedOption(): SelectOption | null {
    return this._options[this.selectedIndex] || null
  }

  public getSelectedIndex(): number {
    return this.selectedIndex
  }

  public moveUp(steps: number = 1): void {
    const newIndex = this.selectedIndex - steps

    if (newIndex >= 0) {
      this.selectedIndex = newIndex
    } else if (this._wrapSelection && this._options.length > 0) {
      this.selectedIndex = this._options.length - 1
    } else {
      this.selectedIndex = 0
    }

    this.updateScrollOffset()
    this.requestRender()
    this.emit(SelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public moveDown(steps: number = 1): void {
    const newIndex = this.selectedIndex + steps

    if (newIndex < this._options.length) {
      this.selectedIndex = newIndex
    } else if (this._wrapSelection && this._options.length > 0) {
      this.selectedIndex = 0
    } else {
      this.selectedIndex = this._options.length - 1
    }

    this.updateScrollOffset()
    this.requestRender()
    this.emit(SelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
  }

  public selectCurrent(): void {
    const selected = this.getSelectedOption()
    if (selected) {
      this.emit(SelectRenderableEvents.ITEM_SELECTED, this.selectedIndex, selected)
    }
  }

  public setSelectedIndex(index: number): void {
    if (index >= 0 && index < this._options.length) {
      this.selectedIndex = index
      this.updateScrollOffset()
      this.requestRender()
      this.emit(SelectRenderableEvents.SELECTION_CHANGED, this.selectedIndex, this.getSelectedOption())
    }
  }

  private updateScrollOffset(): void {
    if (!this._options) return

    const halfVisible = Math.floor(this.maxVisibleItems / 2)
    const newScrollOffset = Math.max(
      0,
      Math.min(this.selectedIndex - halfVisible, this._options.length - this.maxVisibleItems),
    )

    if (newScrollOffset !== this.scrollOffset) {
      this.scrollOffset = newScrollOffset
      this.requestRender()
    }
  }

  protected onResize(width: number, height: number): void {
    this.maxVisibleItems = Math.max(1, Math.floor(height / this.linesPerItem))
    this.updateScrollOffset()
    this.requestRender()
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
    this.requestRender()
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
      this.requestRender()
    }
  }

  public get wrapSelection(): boolean {
    return this._wrapSelection
  }

  public set wrapSelection(wrap: boolean) {
    this._wrapSelection = wrap
  }

  public set backgroundColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.backgroundColor)
    if (this._backgroundColor !== newColor) {
      this._backgroundColor = newColor
      this.requestRender()
    }
  }

  public set textColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.textColor)
    if (this._textColor !== newColor) {
      this._textColor = newColor
      this.requestRender()
    }
  }

  public set focusedBackgroundColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.focusedBackgroundColor)
    if (this._focusedBackgroundColor !== newColor) {
      this._focusedBackgroundColor = newColor
      this.requestRender()
    }
  }

  public set focusedTextColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.focusedTextColor)
    if (this._focusedTextColor !== newColor) {
      this._focusedTextColor = newColor
      this.requestRender()
    }
  }

  public set selectedBackgroundColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.selectedBackgroundColor)
    if (this._selectedBackgroundColor !== newColor) {
      this._selectedBackgroundColor = newColor
      this.requestRender()
    }
  }

  public set selectedTextColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.selectedTextColor)
    if (this._selectedTextColor !== newColor) {
      this._selectedTextColor = newColor
      this.requestRender()
    }
  }

  public set descriptionColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.descriptionColor)
    if (this._descriptionColor !== newColor) {
      this._descriptionColor = newColor
      this.requestRender()
    }
  }

  public set selectedDescriptionColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.selectedDescriptionColor)
    if (this._selectedDescriptionColor !== newColor) {
      this._selectedDescriptionColor = newColor
      this.requestRender()
    }
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
    this.requestRender()
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
    this.requestRender()
  }

  public set fastScrollStep(step: number) {
    this._fastScrollStep = step
  }
}
