import { CliRenderer } from ".."
import { Renderable, type RenderableOptions } from "../Renderable"
import { OptimizedBuffer } from "../buffer"
import type { ParsedKey } from "../lib/parse.keypress"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"

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

// TODO: make this just plain strings instead of an enum (same for other events)
export enum InputRenderableEvents {
  INPUT = "input",
  CHANGE = "change",
  ENTER = "enter",
}

export class InputRenderable extends Renderable {
  protected focusable: boolean = true

  private _value: string = ""
  private _cursorPosition: number = 0
  private _placeholder: string
  private _backgroundColor: RGBA
  private _textColor: RGBA
  private _focusedBackgroundColor: RGBA
  private _focusedTextColor: RGBA
  private _placeholderColor: RGBA
  private _cursorColor: RGBA
  private _maxLength: number
  private _lastCommittedValue: string = ""

  constructor(id: string, options: InputRenderableOptions) {
    super(id, { ...options, buffered: true })

    this._backgroundColor = parseColor(options.backgroundColor || "transparent")
    this._textColor = parseColor(options.textColor || "#FFFFFF")
    this._focusedBackgroundColor = parseColor(options.focusedBackgroundColor || options.backgroundColor || "#1a1a1a")
    this._focusedTextColor = parseColor(options.focusedTextColor || options.textColor || "#FFFFFF")
    this._placeholder = options.placeholder || ""
    this._value = options.value || ""
    this._lastCommittedValue = this._value
    this._cursorPosition = this._value.length
    this._maxLength = options.maxLength || 1000

    this._placeholderColor = parseColor(options.placeholderColor || "#666666")
    this._cursorColor = parseColor(options.cursorColor || "#FFFFFF")
  }

  private updateCursorPosition(): void {
    if (!this._focused) return

    const contentX = 0
    const contentY = 0
    const contentWidth = this.width

    const maxVisibleChars = contentWidth - 1
    let displayStartIndex = 0

    if (this._cursorPosition >= maxVisibleChars) {
      displayStartIndex = this._cursorPosition - maxVisibleChars + 1
    }

    const cursorDisplayX = this._cursorPosition - displayStartIndex

    if (cursorDisplayX >= 0 && cursorDisplayX < contentWidth) {
      const absoluteCursorX = this.x + contentX + cursorDisplayX + 1
      const absoluteCursorY = this.y + contentY + 1

      CliRenderer.setCursorPosition(absoluteCursorX, absoluteCursorY, true)
      CliRenderer.setCursorColor(this._cursorColor)
    }
  }

  public focus(): void {
    super.focus()
    CliRenderer.setCursorStyle("block", true, this._cursorColor)
    this.updateCursorPosition()
  }

  public blur(): void {
    super.blur()
    CliRenderer.setCursorPosition(0, 0, false)

    if (this._value !== this._lastCommittedValue) {
      this._lastCommittedValue = this._value
      this.emit(InputRenderableEvents.CHANGE, this._value)
    }
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    if (!this.visible || !this.frameBuffer) return

    if (this.isDirty) {
      this.refreshFrameBuffer()
    }
  }

  private refreshFrameBuffer(): void {
    if (!this.frameBuffer) return

    const bgColor = this._focused ? this._focusedBackgroundColor : this._backgroundColor
    this.frameBuffer.clear(bgColor)

    const contentX = 0
    const contentY = 0
    const contentWidth = this.width
    const contentHeight = this.height

    const displayText = this._value || this._placeholder
    const isPlaceholder = !this._value && this._placeholder
    const baseTextColor = this._focused ? this._focusedTextColor : this._textColor
    const textColor = isPlaceholder ? this._placeholderColor : baseTextColor

    const maxVisibleChars = contentWidth - 1
    let displayStartIndex = 0

    if (this._cursorPosition >= maxVisibleChars) {
      displayStartIndex = this._cursorPosition - maxVisibleChars + 1
    }

    const visibleText = displayText.substring(displayStartIndex, displayStartIndex + maxVisibleChars)

    if (visibleText) {
      this.frameBuffer.drawText(visibleText, contentX, contentY, textColor)
    }

    if (this._focused) {
      this.updateCursorPosition()
    }
  }

  public get value(): string {
    return this._value
  }

  public set value(value: string) {
    const newValue = value.substring(0, this._maxLength)
    if (this._value !== newValue) {
      this._value = newValue
      this._cursorPosition = Math.min(this._cursorPosition, this._value.length)
      this.needsUpdate()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this._value)
    }
  }

  public set placeholder(placeholder: string) {
    if (this._placeholder !== placeholder) {
      this._placeholder = placeholder
      this.needsUpdate()
    }
  }

  public set cursorPosition(position: number) {
    const newPosition = Math.max(0, Math.min(position, this._value.length))
    if (this._cursorPosition !== newPosition) {
      this._cursorPosition = newPosition
      this.needsUpdate()
      this.updateCursorPosition()
    }
  }

  private insertText(text: string): void {
    if (this._value.length + text.length > this._maxLength) {
      return
    }

    const beforeCursor = this._value.substring(0, this._cursorPosition)
    const afterCursor = this._value.substring(this._cursorPosition)
    this._value = beforeCursor + text + afterCursor
    this._cursorPosition += text.length
    this.needsUpdate()
    this.updateCursorPosition()
    this.emit(InputRenderableEvents.INPUT, this._value)
  }

  private deleteCharacter(direction: "backward" | "forward"): void {
    if (direction === "backward" && this._cursorPosition > 0) {
      const beforeCursor = this._value.substring(0, this._cursorPosition - 1)
      const afterCursor = this._value.substring(this._cursorPosition)
      this._value = beforeCursor + afterCursor
      this._cursorPosition--
      this.needsUpdate()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this._value)
    } else if (direction === "forward" && this._cursorPosition < this._value.length) {
      const beforeCursor = this._value.substring(0, this._cursorPosition)
      const afterCursor = this._value.substring(this._cursorPosition + 1)
      this._value = beforeCursor + afterCursor
      this.needsUpdate()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this._value)
    }
  }

  public handleKeyPress(key: ParsedKey | string): boolean {
    const keyName = typeof key === "string" ? key : key.name
    const keySequence = typeof key === "string" ? key : key.sequence

    switch (keyName) {
      case "left":
        this.cursorPosition = this._cursorPosition - 1
        return true

      case "right":
        this.cursorPosition = this._cursorPosition + 1
        return true

      case "home":
        this.cursorPosition = 0
        return true

      case "end":
        this.cursorPosition = this._value.length
        return true

      case "backspace":
        this.deleteCharacter("backward")
        return true

      case "delete":
        this.deleteCharacter("forward")
        return true

      case "return":
      case "enter":
        if (this._value !== this._lastCommittedValue) {
          this._lastCommittedValue = this._value
          this.emit(InputRenderableEvents.CHANGE, this._value)
        }
        this.emit(InputRenderableEvents.ENTER, this._value)
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

  public set maxLength(maxLength: number) {
    this._maxLength = maxLength
    if (this._value.length > maxLength) {
      this._value = this._value.substring(0, maxLength)
      this.needsUpdate()
    }
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

  public set placeholderColor(color: ColorInput) {
    this._placeholderColor = parseColor(color)
    this.needsUpdate()
  }

  public set cursorColor(color: ColorInput) {
    this._cursorColor = parseColor(color)
    this.needsUpdate()
  }

  protected destroySelf(): void {
    if (this._focused) {
      CliRenderer.setCursorPosition(0, 0, false)
    }
    super.destroySelf()
  }
}
