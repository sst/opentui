import { Renderable, type RenderableOptions } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import { parseColor } from "../utils"
import type { RGBA, ColorInput } from "../types"
import type { ParsedKey } from "../lib/parse.keypress"
import { CliRenderer } from ".."

export interface InputRenderableOptions extends RenderableOptions {
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  placeholder?: string
  placeholderColor?: ColorInput
  cursorColor?: ColorInput
  maxLength?: number
  value?: string
}

export enum InputRenderableEvents {
  INPUT = "input",
  CHANGE = "change",
  ENTER = "enter",
}

export class InputRenderable extends Renderable {
  private value: string = ""
  private cursorPosition: number = 0
  private placeholder: string
  private backgroundColor: RGBA
  private textColor: RGBA
  private focusedBackgroundColor: RGBA
  private focusedTextColor: RGBA
  private placeholderColor: RGBA
  private cursorColor: RGBA
  private maxLength: number
  private lastCommittedValue: string = ""

  constructor(id: string, options: InputRenderableOptions) {
    super(id, { ...options, buffered: true })

    this.backgroundColor = parseColor(options.backgroundColor || "transparent")
    this.textColor = parseColor(options.textColor || "#FFFFFF")
    this.focusedBackgroundColor = parseColor(options.focusedBackgroundColor || options.backgroundColor || "#1a1a1a")
    this.focusedTextColor = parseColor(options.focusedTextColor || options.textColor || "#FFFFFF")
    this.placeholder = options.placeholder || ""
    this.value = options.value || ""
    this.lastCommittedValue = this.value
    this.cursorPosition = this.value.length
    this.maxLength = options.maxLength || 1000

    this.placeholderColor = parseColor(options.placeholderColor || "#666666")
    this.cursorColor = parseColor(options.cursorColor || "#FFFFFF")
  }

  private updateCursorPosition(): void {
    if (!this._focused) return

    const contentX = 0
    const contentY = 0
    const contentWidth = this.width

    const maxVisibleChars = contentWidth - 1
    let displayStartIndex = 0

    if (this.cursorPosition >= maxVisibleChars) {
      displayStartIndex = this.cursorPosition - maxVisibleChars + 1
    }

    const cursorDisplayX = this.cursorPosition - displayStartIndex

    if (cursorDisplayX >= 0 && cursorDisplayX < contentWidth) {
      const absoluteCursorX = this.x + contentX + cursorDisplayX + 1
      const absoluteCursorY = this.y + contentY + 1

      CliRenderer.setCursorPosition(absoluteCursorX, absoluteCursorY, true)
      CliRenderer.setCursorColor(this.cursorColor)
    }
  }

  public focus(): void {
    super.focus()
    CliRenderer.setCursorStyle("block", true, this.cursorColor)
    this.updateCursorPosition()
  }

  public blur(): void {
    super.blur()
    CliRenderer.setCursorPosition(0, 0, false)

    if (this.value !== this.lastCommittedValue) {
      this.lastCommittedValue = this.value
      this.emit(InputRenderableEvents.CHANGE, this.value)
    }
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible || !this.frameBuffer) return

    if (this.isDirty) {
      this.refreshFrameBuffer()
      this.markClean()
    }
  }

  private refreshFrameBuffer(): void {
    if (!this.frameBuffer) return

    const bgColor = this._focused ? this.focusedBackgroundColor : this.backgroundColor
    this.frameBuffer.clear(bgColor)

    const contentX = 0
    const contentY = 0
    const contentWidth = this.width
    const contentHeight = this.height

    const displayText = this.value || this.placeholder
    const isPlaceholder = !this.value && this.placeholder
    const baseTextColor = this._focused ? this.focusedTextColor : this.textColor
    const textColor = isPlaceholder ? this.placeholderColor : baseTextColor

    const maxVisibleChars = contentWidth - 1
    let displayStartIndex = 0

    if (this.cursorPosition >= maxVisibleChars) {
      displayStartIndex = this.cursorPosition - maxVisibleChars + 1
    }

    const visibleText = displayText.substring(displayStartIndex, displayStartIndex + maxVisibleChars)

    if (visibleText) {
      this.frameBuffer.drawText(visibleText, contentX, contentY, textColor)
    }

    if (this._focused) {
      this.updateCursorPosition()
    }
  }

  public setValue(value: string): void {
    const newValue = value.substring(0, this.maxLength)
    if (this.value !== newValue) {
      this.value = newValue
      this.cursorPosition = Math.min(this.cursorPosition, this.value.length)
      this.markDirty()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this.value)
    }
  }

  public getValue(): string {
    return this.value
  }

  public getPlaceholder(): string {
    return this.placeholder
  }

  public setPlaceholder(placeholder: string): void {
    if (this.placeholder !== placeholder) {
      this.placeholder = placeholder
      this.markDirty()
    }
  }

  public getCursorPosition(): number {
    return this.cursorPosition
  }

  public setCursorPosition(position: number): void {
    const newPosition = Math.max(0, Math.min(position, this.value.length))
    if (this.cursorPosition !== newPosition) {
      this.cursorPosition = newPosition
      this.markDirty()
      this.updateCursorPosition()
    }
  }

  private insertText(text: string): void {
    if (this.value.length + text.length > this.maxLength) {
      return
    }

    const beforeCursor = this.value.substring(0, this.cursorPosition)
    const afterCursor = this.value.substring(this.cursorPosition)
    this.value = beforeCursor + text + afterCursor
    this.cursorPosition += text.length
    this.markDirty()
    this.updateCursorPosition()
    this.emit(InputRenderableEvents.INPUT, this.value)
  }

  private deleteCharacter(direction: "backward" | "forward"): void {
    if (direction === "backward" && this.cursorPosition > 0) {
      const beforeCursor = this.value.substring(0, this.cursorPosition - 1)
      const afterCursor = this.value.substring(this.cursorPosition)
      this.value = beforeCursor + afterCursor
      this.cursorPosition--
      this.markDirty()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this.value)
    } else if (direction === "forward" && this.cursorPosition < this.value.length) {
      const beforeCursor = this.value.substring(0, this.cursorPosition)
      const afterCursor = this.value.substring(this.cursorPosition + 1)
      this.value = beforeCursor + afterCursor
      this.markDirty()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this.value)
    }
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    const keyName = typeof key === "string" ? key : key.name
    const keySequence = typeof key === "string" ? key : key.sequence

    switch (keyName) {
      case "left":
        this.setCursorPosition(this.cursorPosition - 1)
        return true

      case "right":
        this.setCursorPosition(this.cursorPosition + 1)
        return true

      case "home":
        this.setCursorPosition(0)
        return true

      case "end":
        this.setCursorPosition(this.value.length)
        return true

      case "backspace":
        this.deleteCharacter("backward")
        return true

      case "delete":
        this.deleteCharacter("forward")
        return true

      case "return":
      case "enter":
        if (this.value !== this.lastCommittedValue) {
          this.lastCommittedValue = this.value
          this.emit(InputRenderableEvents.CHANGE, this.value)
        }
        this.emit(InputRenderableEvents.ENTER, this.value)
        return true

      default:
        if (
          keySequence &&
          keySequence.length === 1 &&
          keySequence.charCodeAt(0) >= 32 &&
          keySequence.charCodeAt(0) <= 126
        ) {
          this.insertText(keySequence)
          return true
        }
        break
    }

    return false
  }

  public getMaxLength(): number {
    return this.maxLength
  }

  public setMaxLength(maxLength: number): void {
    this.maxLength = maxLength
    if (this.value.length > maxLength) {
      this.setValue(this.value.substring(0, maxLength))
    }
  }

  protected destroySelf(): void {
    if (this._focused) {
      CliRenderer.setCursorPosition(0, 0, false)
    }
    super.destroySelf()
  }
}
