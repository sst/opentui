import { OptimizedBuffer } from "../buffer"
import type { KeyEvent } from "../lib/KeyHandler"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"
import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext, CursorStyleOptions } from "../types"
import {
  type KeyBinding as BaseKeyBinding,
  mergeKeyBindings,
  getKeyBindingKey,
  buildKeyBindingsMap,
  type KeyAliasMap,
  defaultKeyAliases,
  mergeKeyAliases,
} from "../lib/keymapping"

export type InputAction =
  | "move-left"
  | "move-right"
  | "move-home"
  | "move-end"
  | "delete-backward"
  | "delete-forward"
  | "submit"

export type InputKeyBinding = BaseKeyBinding<InputAction>

const defaultInputKeybindings: InputKeyBinding[] = [
  { name: "left", action: "move-left" },
  { name: "right", action: "move-right" },
  { name: "home", action: "move-home" },
  { name: "end", action: "move-end" },
  { name: "backspace", action: "delete-backward" },
  { name: "delete", action: "delete-forward" },
  { name: "return", action: "submit" },
  { name: "linefeed", action: "submit" },
  // Emacs-style bindings
  { name: "a", ctrl: true, action: "move-home" },
  { name: "e", ctrl: true, action: "move-end" },
  { name: "f", ctrl: true, action: "move-right" },
  { name: "b", ctrl: true, action: "move-left" },
  { name: "d", ctrl: true, action: "delete-forward" },
]

export interface InputRenderableOptions extends RenderableOptions<InputRenderable> {
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  placeholder?: string
  placeholderColor?: ColorInput
  cursorColor?: ColorInput
  cursorStyle?: CursorStyleOptions
  maxLength?: number
  value?: string
  keyBindings?: InputKeyBinding[]
  keyAliasMap?: KeyAliasMap
}

// TODO: make this just plain strings instead of an enum (same for other events)
export enum InputRenderableEvents {
  INPUT = "input",
  CHANGE = "change",
  ENTER = "enter",
}

export class InputRenderable extends Renderable {
  protected _focusable: boolean = true

  private _value: string = ""
  private _cursorPosition: number = 0
  private _placeholder: string
  private _backgroundColor: RGBA
  private _textColor: RGBA
  private _focusedBackgroundColor: RGBA
  private _focusedTextColor: RGBA
  private _placeholderColor: RGBA
  private _cursorColor: RGBA
  private _cursorStyle: CursorStyleOptions
  private _maxLength: number
  private _lastCommittedValue: string = ""
  private _keyBindingsMap: Map<string, InputAction>
  private _keyAliasMap: KeyAliasMap
  private _keyBindings: InputKeyBinding[]

  protected _defaultOptions = {
    backgroundColor: "transparent",
    textColor: "#FFFFFF",
    focusedBackgroundColor: "#1a1a1a",
    focusedTextColor: "#FFFFFF",
    placeholder: "",
    placeholderColor: "#666666",
    cursorColor: "#FFFFFF",
    cursorStyle: {
      style: "block",
      blinking: true,
    },
    maxLength: 1000,
    value: "",
  } satisfies Partial<InputRenderableOptions>

  constructor(ctx: RenderContext, options: InputRenderableOptions) {
    super(ctx, { ...options, buffered: true })

    this._backgroundColor = parseColor(options.backgroundColor || this._defaultOptions.backgroundColor)
    this._textColor = parseColor(options.textColor || this._defaultOptions.textColor)
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor || options.backgroundColor || this._defaultOptions.focusedBackgroundColor,
    )
    this._focusedTextColor = parseColor(
      options.focusedTextColor || options.textColor || this._defaultOptions.focusedTextColor,
    )
    this._placeholder = options.placeholder || this._defaultOptions.placeholder
    this._value = options.value || this._defaultOptions.value
    this._lastCommittedValue = this._value
    this._cursorPosition = this._value.length
    this._maxLength = options.maxLength || this._defaultOptions.maxLength

    this._placeholderColor = parseColor(options.placeholderColor || this._defaultOptions.placeholderColor)
    this._cursorColor = parseColor(options.cursorColor || this._defaultOptions.cursorColor)
    this._cursorStyle = options.cursorStyle || this._defaultOptions.cursorStyle

    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, options.keyAliasMap || {})
    this._keyBindings = options.keyBindings || []
    const mergedBindings = mergeKeyBindings(defaultInputKeybindings, this._keyBindings)
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap)
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

      this._ctx.setCursorPosition(absoluteCursorX, absoluteCursorY, true)
      this._ctx.setCursorColor(this._cursorColor)
    }
  }

  public focus(): void {
    super.focus()
    this._ctx.setCursorStyle(this._cursorStyle.style, this._cursorStyle.blinking)
    this._ctx.setCursorColor(this._cursorColor)
    this.updateCursorPosition()
  }

  public blur(): void {
    super.blur()
    this._ctx.setCursorPosition(0, 0, false)

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
      this.requestRender()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this._value)
    }
  }

  public set placeholder(placeholder: string) {
    if (this._placeholder !== placeholder) {
      this._placeholder = placeholder
      this.requestRender()
    }
  }

  public get cursorPosition(): number {
    return this._cursorPosition
  }

  public set cursorPosition(position: number) {
    const newPosition = Math.max(0, Math.min(position, this._value.length))
    if (this._cursorPosition !== newPosition) {
      this._cursorPosition = newPosition
      this.requestRender()
      this.updateCursorPosition()
    }
  }

  public insertText(text: string): void {
    if (this._value.length + text.length > this._maxLength) {
      return
    }

    const beforeCursor = this._value.substring(0, this._cursorPosition)
    const afterCursor = this._value.substring(this._cursorPosition)
    this._value = beforeCursor + text + afterCursor
    this._cursorPosition += text.length
    this.requestRender()
    this.updateCursorPosition()
    this.emit(InputRenderableEvents.INPUT, this._value)
  }

  public deleteCharacter(direction: "backward" | "forward"): void {
    if (direction === "backward" && this._cursorPosition > 0) {
      const beforeCursor = this._value.substring(0, this._cursorPosition - 1)
      const afterCursor = this._value.substring(this._cursorPosition)
      this._value = beforeCursor + afterCursor
      this._cursorPosition--
      this.requestRender()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this._value)
    } else if (direction === "forward" && this._cursorPosition < this._value.length) {
      const beforeCursor = this._value.substring(0, this._cursorPosition)
      const afterCursor = this._value.substring(this._cursorPosition + 1)
      this._value = beforeCursor + afterCursor
      this.requestRender()
      this.updateCursorPosition()
      this.emit(InputRenderableEvents.INPUT, this._value)
    }
  }

  public handleKeyPress(key: KeyEvent): boolean {
    const bindingKey = getKeyBindingKey({
      name: key.name,
      ctrl: key.ctrl,
      shift: key.shift,
      meta: key.meta,
      super: key.super,
      action: "move-left" as InputAction,
    })

    const action = this._keyBindingsMap.get(bindingKey)

    if (action) {
      switch (action) {
        case "move-left":
          this.cursorPosition = this._cursorPosition - 1
          return true
        case "move-right":
          this.cursorPosition = this._cursorPosition + 1
          return true
        case "move-home":
          this.cursorPosition = 0
          return true
        case "move-end":
          this.cursorPosition = this._value.length
          return true
        case "delete-backward":
          this.deleteCharacter("backward")
          return true
        case "delete-forward":
          this.deleteCharacter("forward")
          return true
        case "submit":
          if (this._value !== this._lastCommittedValue) {
            this._lastCommittedValue = this._value
            this.emit(InputRenderableEvents.CHANGE, this._value)
          }
          this.emit(InputRenderableEvents.ENTER, this._value)
          return true
      }
    }

    if (!key.ctrl && !key.meta && !key.super && !key.hyper) {
      if (key.name === "space") {
        this.insertText(" ")
        return true
      }

      if (
        key.sequence &&
        key.sequence.length === 1 &&
        key.sequence.charCodeAt(0) >= 32 &&
        key.sequence.charCodeAt(0) <= 126
      ) {
        this.insertText(key.sequence)
        return true
      }
    }

    return false
  }

  public set maxLength(maxLength: number) {
    this._maxLength = maxLength
    if (this._value.length > maxLength) {
      this._value = this._value.substring(0, maxLength)
      this.requestRender()
    }
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

  public set placeholderColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.placeholderColor)
    if (this._placeholderColor !== newColor) {
      this._placeholderColor = newColor
      this.requestRender()
    }
  }

  public set cursorColor(value: ColorInput) {
    const newColor = parseColor(value ?? this._defaultOptions.cursorColor)
    if (this._cursorColor !== newColor) {
      this._cursorColor = newColor
      if (this._focused) {
        this._ctx.requestRender()
      }
    }
  }

  public get cursorStyle(): CursorStyleOptions {
    return this._cursorStyle
  }

  public set cursorStyle(style: CursorStyleOptions) {
    const newStyle = style
    if (this.cursorStyle.style !== newStyle.style || this.cursorStyle.blinking !== newStyle.blinking) {
      this._cursorStyle = newStyle
      if (this._focused) {
        this._ctx.requestRender()
      }
    }
  }

  public updateFromLayout(): void {
    super.updateFromLayout()
    this.updateCursorPosition()
  }

  protected onResize(width: number, height: number): void {
    super.onResize(width, height)
    this.updateCursorPosition()
  }

  protected onRemove(): void {
    if (this._focused) {
      this._ctx.setCursorPosition(0, 0, false)
    }
  }

  public set keyBindings(bindings: InputKeyBinding[]) {
    this._keyBindings = bindings
    const mergedBindings = mergeKeyBindings(defaultInputKeybindings, bindings)
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap)
  }

  public set keyAliasMap(aliases: KeyAliasMap) {
    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, aliases)
    const mergedBindings = mergeKeyBindings(defaultInputKeybindings, this._keyBindings)
    this._keyBindingsMap = buildKeyBindingsMap(mergedBindings, this._keyAliasMap)
  }
}
