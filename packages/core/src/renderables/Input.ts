import type { PasteEvent } from "../lib/KeyHandler"
import type { RenderContext } from "../types"
import {
  TextareaRenderable,
  type TextareaOptions,
  type TextareaAction,
  type KeyBinding as TextareaKeyBinding,
} from "./Textarea"

export type InputAction = TextareaAction
export type InputKeyBinding = TextareaKeyBinding

export interface InputRenderableOptions
  extends Omit<TextareaOptions, "height" | "minHeight" | "maxHeight" | "initialValue"> {
  /** Initial text value (newlines are stripped) */
  value?: string
  /** Maximum number of characters allowed */
  maxLength?: number
  /** Placeholder text (Input only supports string, not StyledText) */
  placeholder?: string
}

// TODO: make this just plain strings instead of an enum (same for other events)
export enum InputRenderableEvents {
  INPUT = "input",
  CHANGE = "change",
  ENTER = "enter",
}

/**
 * InputRenderable - A single-line text input component.
 *
 * Extends TextareaRenderable with single-line constraints:
 * - Height is always 1
 * - No text wrapping
 * - Newlines are stripped from input
 * - Enter key submits instead of inserting newline
 *
 * Inherits all keybindings from TextareaRenderable.
 */
export class InputRenderable extends TextareaRenderable {
  private _maxLength: number
  private _lastCommittedValue: string = ""

  // Only specify defaults that differ from TextareaRenderable/EditBufferRenderable
  private static readonly defaultOptions = {
    // Different from Textarea's null
    placeholder: "",
    // Input-specific
    maxLength: 1000,
    value: "",
  } satisfies Partial<InputRenderableOptions>

  constructor(ctx: RenderContext, options: InputRenderableOptions) {
    const defaults = InputRenderable.defaultOptions
    const maxLength = options.maxLength ?? defaults.maxLength
    // Sanitize initial value: strip newlines and enforce maxLength
    const rawValue = options.value ?? defaults.value
    const initialValue = rawValue.replace(/[\n\r]/g, "").substring(0, maxLength)

    super(ctx, {
      ...options,
      placeholder: options.placeholder ?? defaults.placeholder,
      initialValue,
      // Single-line constraints
      height: 1,
      wrapMode: "none",
      // Override return/linefeed to submit instead of newline
      keyBindings: [
        { name: "return", action: "submit" },
        { name: "linefeed", action: "submit" },
        ...(options.keyBindings || []),
      ],
    })

    this._maxLength = maxLength
    this._lastCommittedValue = this.plainText

    // Set cursor to end of initial value
    if (initialValue) {
      this.cursorOffset = initialValue.length
    }
  }

  /**
   * Prevent newlines in single-line input
   */
  public override newLine(): boolean {
    return false
  }

  /**
   * Handle paste - strip newlines and enforce maxLength
   */
  public override handlePaste(event: PasteEvent): void {
    const sanitized = event.text.replace(/[\n\r]/g, "")
    if (sanitized) {
      this.insertText(sanitized)
    }
  }

  /**
   * Insert text - strip newlines and enforce maxLength
   */
  public override insertText(text: string): void {
    const sanitized = text.replace(/[\n\r]/g, "")
    if (!sanitized) return

    const currentLength = this.plainText.length
    const remaining = this._maxLength - currentLength
    if (remaining <= 0) return

    const toInsert = sanitized.substring(0, remaining)
    super.insertText(toInsert)
    this.emit(InputRenderableEvents.INPUT, this.plainText)
  }

  public get value(): string {
    return this.plainText
  }

  public set value(value: string) {
    const newValue = value.substring(0, this._maxLength).replace(/[\n\r]/g, "")
    const currentValue = this.plainText
    if (currentValue !== newValue) {
      this.setText(newValue)
      this.cursorOffset = newValue.length
      this.emit(InputRenderableEvents.INPUT, newValue)
    }
  }

  public override focus(): void {
    super.focus()
    this._lastCommittedValue = this.plainText
  }

  public override blur(): void {
    if (!this.isDestroyed) {
      const currentValue = this.plainText
      if (currentValue !== this._lastCommittedValue) {
        this._lastCommittedValue = currentValue
        this.emit(InputRenderableEvents.CHANGE, currentValue)
      }
    }
    super.blur()
  }

  public override submit(): boolean {
    const currentValue = this.plainText
    if (currentValue !== this._lastCommittedValue) {
      this._lastCommittedValue = currentValue
      this.emit(InputRenderableEvents.CHANGE, currentValue)
    }
    this.emit(InputRenderableEvents.ENTER, currentValue)
    return true
  }

  public override deleteCharBackward(): boolean {
    const result = super.deleteCharBackward()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public override deleteChar(): boolean {
    const result = super.deleteChar()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public deleteCharacter(direction: "backward" | "forward"): void {
    if (direction === "backward") {
      this.deleteCharBackward()
    } else {
      this.deleteChar()
    }
  }

  public set maxLength(maxLength: number) {
    this._maxLength = maxLength
    const currentValue = this.plainText
    if (currentValue.length > maxLength) {
      this.setText(currentValue.substring(0, maxLength))
    }
  }

  public get maxLength(): number {
    return this._maxLength
  }

  public override set placeholder(placeholder: string) {
    super.placeholder = placeholder
  }

  public override get placeholder(): string {
    const p = super.placeholder
    return typeof p === "string" ? p : ""
  }

  public override set initialValue(value: string) {
    void 0
  }
}
