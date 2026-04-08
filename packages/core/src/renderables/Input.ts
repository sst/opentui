import type { PasteEvent } from "../lib/KeyHandler.js"
import { decodePasteBytes, stripAnsiSequences } from "../lib/paste.js"
import type { RenderContext } from "../types.js"
import {
  TextareaRenderable,
  type TextareaOptions,
  type TextareaAction,
  type KeyBinding as TextareaKeyBinding,
} from "./Textarea.js"

export type InputAction = TextareaAction
export type InputKeyBinding = TextareaKeyBinding

export interface InputRenderableOptions extends Omit<
  TextareaOptions,
  "height" | "minHeight" | "maxHeight" | "initialValue"
> {
  /** Initial text value (newlines are stripped) */
  value?: string
  /** Maximum number of characters allowed */
  maxLength?: number
  /** Placeholder text (Input only supports string, not StyledText) */
  placeholder?: string
  /** Input type ("text" or "password") */
  type?: "text" | "password"
  /** Character used to mask input when type is "password" */
  passwordChar?: string
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
  private _type: "text" | "password"
  private _passwordChar: string

  // Only specify defaults that differ from TextareaRenderable/EditBufferRenderable
  private static readonly defaultOptions = {
    // Different from Textarea's null
    placeholder: "",
    // Input-specific
    maxLength: 1000,
    value: "",
    type: "text",
    passwordChar: "●",
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
    this._type = options.type ?? defaults.type
    if (options.passwordChar) {
      this._passwordChar = InputRenderable.validatePasswordChar(options.passwordChar)
    } else {
      this._passwordChar = defaults.passwordChar
    }

    if (this._type === "password") {
      this.applyMask()
    }

    // Set cursor to end of initial value
    if (initialValue) {
      this.cursorOffset = initialValue.length
    }
  }

  private static validatePasswordChar(value: string): string {
    if (value.length !== 1) {
      console.warn(
        `Invalid passwordChar "${value}", falling back to "${InputRenderable.defaultOptions.passwordChar}". ` +
          `passwordChar must be a single character.`,
      )
      return InputRenderable.defaultOptions.passwordChar
    }
    return value
  }

  // Note: the mask codepoint replaces each source character 1:1 in the renderer.
  // This assumes the mask char and source characters share the same display width.
  // For single-line password inputs (ASCII text, single-width mask) this is correct.
  private applyMask(): void {
    const codepoint = this._passwordChar.codePointAt(0)!
    this.editorView.setMaskCodepoint(this._type === "password" ? codepoint : 0)
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
    const sanitized = stripAnsiSequences(decodePasteBytes(event.bytes)).replace(/[\n\r]/g, "")
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

  public override deleteLine(): boolean {
    const result = super.deleteLine()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public override deleteWordBackward(): boolean {
    const result = super.deleteWordBackward()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public override deleteWordForward(): boolean {
    const result = super.deleteWordForward()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public override deleteToLineStart(): boolean {
    const result = super.deleteToLineStart()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public override deleteToLineEnd(): boolean {
    const result = super.deleteToLineEnd()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public override undo(): boolean {
    const result = super.undo()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public override redo(): boolean {
    const result = super.redo()
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

  public get type(): "text" | "password" {
    return this._type
  }

  public set type(value: "text" | "password") {
    if (this._type !== value) {
      this._type = value
      this.applyMask()
      this.requestRender()
    }
  }

  public get passwordChar(): string {
    return this._passwordChar
  }

  public set passwordChar(value: string) {
    const char = InputRenderable.validatePasswordChar(value)
    if (this._passwordChar !== char) {
      this._passwordChar = char
      if (this._type === "password") {
        this.applyMask()
        this.requestRender()
      }
    }
  }

  public override set initialValue(value: string) {
    void 0
  }
}
