import type { PasteEvent } from "../lib/KeyHandler"
import type { CursorStyleOptions, RenderContext } from "../types"
import { TextareaRenderable, type TextareaOptions } from "./Textarea"

export interface InputRenderableOptions extends Omit<TextareaOptions, "initialValue" | "placeholder" | "keyBindings"> {
  placeholder?: string
  maxLength?: number
  value?: string
}

// TODO: make this just plain strings instead of an enum (same for other events)
export enum InputRenderableEvents {
  INPUT = "input",
  CHANGE = "change",
  ENTER = "enter",
}

export class InputRenderable extends TextareaRenderable {
  private _maxLength: number

  private static readonly defaultOptions = {
    backgroundColor: "transparent",
    textColor: "#FFFFFF",
    focusedBackgroundColor: "transparent",
    focusedTextColor: "#FFFFFF",
    placeholder: "",
    placeholderColor: "#666666",
    cursorColor: "#FFFFFF",
    cursorStyle: {
      style: "block" as const,
      blinking: true,
    },
    maxLength: 1000,
    value: "",
  } satisfies Partial<InputRenderableOptions>

  constructor(ctx: RenderContext, options: InputRenderableOptions) {
    const defaults = InputRenderable.defaultOptions

    // Convert Input options to Textarea options
    const textareaOptions: TextareaOptions = {
      ...options,
      height: options.height ?? 1,
      wrapMode: "none",
      selectable: false, // Disable selection for single-line input
      initialValue: options.value || defaults.value,
      backgroundColor: options.backgroundColor || defaults.backgroundColor,
      textColor: options.textColor || defaults.textColor,
      focusedBackgroundColor:
        options.focusedBackgroundColor || options.backgroundColor || defaults.focusedBackgroundColor,
      focusedTextColor: options.focusedTextColor || options.textColor || defaults.focusedTextColor,
      placeholder: options.placeholder ?? defaults.placeholder,
      placeholderColor: options.placeholderColor || defaults.placeholderColor,
      cursorColor: options.cursorColor || defaults.cursorColor,
      cursorStyle: options.cursorStyle || defaults.cursorStyle,
      keyBindings: [{ name: "return", action: "submit" }],
    }

    super(ctx, textareaOptions)

    this._maxLength = options.maxLength || defaults.maxLength
    const initialValue = options.value || defaults.value

    // Set cursor to end of initial value
    if (initialValue) {
      this.cursorOffset = initialValue.length
    }

    this.editBuffer.on("content-changed", () => {
      this.emit(InputRenderableEvents.INPUT, this.plainText)
    })
  }

  public override newLine(): boolean {
    // Don't allow newlines in single line input
    return false
  }

  public override handlePaste(event: PasteEvent): void {
    // Strip newlines from pasted text and enforce maxLength
    this.insertText(event.text)
  }

  public override insertText(text: string): void {
    // Strip newlines and enforce maxLength
    const sanitized = text.replace(/\n|\r/g, "")
    if (!sanitized) return

    const currentLength = this.plainText.length
    const remaining = this._maxLength - currentLength
    if (remaining <= 0) return

    const toInsert = sanitized.substring(0, remaining)
    super.insertText(toInsert)
  }

  public get value(): string {
    return this.plainText
  }

  public set value(value: string) {
    const newValue = value.substring(0, this._maxLength)
    const currentValue = this.plainText
    if (currentValue !== newValue) {
      this.setText(newValue, { history: false })
      this.cursorOffset = newValue.length
    }
  }

  override submit(): boolean {
    return this.emit(InputRenderableEvents.ENTER, this.plainText)
  }

  /**
   * @deprecated use `cursorOffset` instead
   */
  public get cursorPosition(): number {
    return this.cursorOffset
  }

  /**
   * @deprecated use `cursorOffset` instead
   */
  public set cursorPosition(position: number) {
    const textLength = this.plainText.length
    const newPosition = Math.max(0, Math.min(position, textLength))
    this.cursorOffset = newPosition
  }

  public set maxLength(maxLength: number) {
    this._maxLength = maxLength
    const currentValue = this.plainText
    if (currentValue.length > maxLength) {
      const truncated = currentValue.substring(0, maxLength)
      this.setText(truncated, { history: false })
    }
  }

  public get maxLength(): number {
    return this._maxLength
  }

  public set placeholder(placeholder: string) {
    super.placeholder = placeholder
  }

  public get placeholder(): string {
    // Constrain to string type
    return typeof super.placeholder === "string" ? super.placeholder : ""
  }

  public override get cursorStyle(): CursorStyleOptions {
    return super.cursorStyle
  }

  public override set cursorStyle(style: CursorStyleOptions) {
    super.cursorStyle = style
  }
}
