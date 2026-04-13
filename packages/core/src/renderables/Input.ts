import type { OptimizedBuffer } from "../buffer.js"
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
  /** Input type, use "password" to mask characters */
  type?: "text" | "password"
  /** Character used to mask input in password mode (must be exactly 1 character) */
  maskChar?: string
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
  private _maskChar: string

  // Only specify defaults that differ from TextareaRenderable/EditBufferRenderable
  private static readonly defaultOptions = {
    // Different from Textarea's null
    placeholder: "",
    // Input-specific
    maxLength: 1000,
    value: "",
    type: "text" as const,
    maskChar: "*",
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
    this._maskChar = options.maskChar ?? defaults.maskChar

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
    if (this._type === "password") {
      const result = super.deleteToLineStart()
      this.emit(InputRenderableEvents.INPUT, this.plainText)
      return result
    }
    const result = super.deleteWordBackward()
    this.emit(InputRenderableEvents.INPUT, this.plainText)
    return result
  }

  public override deleteWordForward(): boolean {
    if (this._type === "password") {
      const result = super.deleteToLineEnd()
      this.emit(InputRenderableEvents.INPUT, this.plainText)
      return result
    }
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

  public set type(type: "text" | "password") {
    this._type = type
    this.requestRender()
  }

  public get type(): "text" | "password" {
    return this._type
  }

  public set maskChar(maskChar: string) {
    if (maskChar.length !== 1) {
      throw new Error("maskChar must be exactly 1 character")
    }
    this._maskChar = maskChar
    this.requestRender()
  }

  public get maskChar(): string {
    return this._maskChar
  }

  public override getSelectedText(): string {
    if (this._type === "password") return ""
    return super.getSelectedText()
  }

  public override moveWordForward(options?: { select?: boolean }): boolean {
    if (this._type !== "password") return super.moveWordForward(options)
    const select = options?.select ?? false
    this.updateSelectionForMovement(select, true)
    this.editBuffer.setCursorByOffset(this.plainText.length)
    this.updateSelectionForMovement(select, false)
    this.requestRender()
    return true
  }

  public override moveWordBackward(options?: { select?: boolean }): boolean {
    if (this._type !== "password") return super.moveWordBackward(options)
    const select = options?.select ?? false
    this.updateSelectionForMovement(select, true)
    this.editBuffer.setCursorByOffset(0)
    this.updateSelectionForMovement(select, false)
    this.requestRender()
    return true
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (this._type !== "password") {
      super.renderSelf(buffer)
      return
    }

    const bg = this._backgroundColor
    const fg = this._textColor

    buffer.fillRect(this.x, this.y, this.width, 1, bg)

    const text = this.plainText

    if (text.length === 0) {
      const placeholder = this.placeholder
      if (placeholder) {
        buffer.drawText(placeholder, this.x, this.y, this.placeholderColor, bg)
      }
      return
    }

    const masked = this._maskChar.repeat(text.length)
    const viewport = this.editorView.getViewport()
    const offsetX = viewport.offsetX
    const sliced = masked.slice(offsetX, offsetX + this.width)

    const sel = this.editorView.getSelection()
    const selection = sel
      ? {
          start: Math.max(0, sel.start - offsetX),
          end: Math.max(0, sel.end - offsetX),
          bgColor: this._selectionBg,
          fgColor: this._selectionFg,
        }
      : undefined

    buffer.drawText(sliced, this.x, this.y, fg, bg, this._defaultAttributes, selection)
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
