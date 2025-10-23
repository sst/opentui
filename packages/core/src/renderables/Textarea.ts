import { type RenderContext, type Highlight } from "../types"
import { EditBufferRenderable, type EditBufferOptions } from "./EditBufferRenderable"
import type { KeyEvent } from "../lib/KeyHandler"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"

export type TextareaAction =
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down"
  | "select-left"
  | "select-right"
  | "select-up"
  | "select-down"
  | "line-home"
  | "line-end"
  | "select-line-home"
  | "select-line-end"
  | "buffer-home"
  | "buffer-end"
  | "delete-line"
  | "delete-to-line-end"
  | "backspace"
  | "delete"
  | "newline"
  | "undo"
  | "redo"

export interface KeyBinding {
  name: string
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  action: TextareaAction
}

const defaultTextareaKeybindings: KeyBinding[] = [
  { name: "left", action: "move-left" },
  { name: "right", action: "move-right" },
  { name: "up", action: "move-up" },
  { name: "down", action: "move-down" },
  { name: "left", shift: true, action: "select-left" },
  { name: "right", shift: true, action: "select-right" },
  { name: "up", shift: true, action: "select-up" },
  { name: "down", shift: true, action: "select-down" },
  { name: "home", action: "line-home" },
  { name: "end", action: "line-end" },
  { name: "home", shift: true, action: "select-line-home" },
  { name: "end", shift: true, action: "select-line-end" },
  { name: "a", ctrl: true, action: "buffer-home" },
  { name: "e", ctrl: true, action: "buffer-end" },
  { name: "d", ctrl: true, action: "delete-line" },
  { name: "k", ctrl: true, action: "delete-to-line-end" },
  { name: "backspace", action: "backspace" },
  { name: "delete", action: "delete" },
  { name: "return", action: "newline" },
  { name: "enter", action: "newline" },
  { name: "z", ctrl: true, action: "undo" },
  { name: "z", ctrl: true, shift: true, action: "redo" },
  { name: "y", ctrl: true, action: "redo" },
]

export interface TextareaOptions extends EditBufferOptions {
  value?: string
  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  placeholder?: string | null
  placeholderColor?: ColorInput
  keyBindings?: KeyBinding[]
}

export class TextareaRenderable extends EditBufferRenderable {
  private _placeholder: string | null
  private _unfocusedBackgroundColor: RGBA
  private _unfocusedTextColor: RGBA
  private _focusedBackgroundColor: RGBA
  private _focusedTextColor: RGBA
  private _placeholderColor: RGBA
  private _keyBindingsMap: Map<string, TextareaAction>
  private _actionHandlers: Map<TextareaAction, () => boolean>

  private static readonly defaults = {
    value: "",
    backgroundColor: "transparent",
    textColor: "#FFFFFF",
    focusedBackgroundColor: "transparent",
    focusedTextColor: "#FFFFFF",
    placeholder: null,
    placeholderColor: "#666666",
  } satisfies Partial<TextareaOptions>

  constructor(ctx: RenderContext, options: TextareaOptions) {
    const defaults = TextareaRenderable.defaults

    // Pass base colors to parent constructor (these become the unfocused colors)
    const baseOptions = {
      ...options,
      backgroundColor: options.backgroundColor || defaults.backgroundColor,
      textColor: options.textColor || defaults.textColor,
    }
    super(ctx, baseOptions)

    // Store unfocused colors separately (parent's properties get overwritten when focused)
    this._unfocusedBackgroundColor = parseColor(options.backgroundColor || defaults.backgroundColor)
    this._unfocusedTextColor = parseColor(options.textColor || defaults.textColor)
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor || options.backgroundColor || defaults.focusedBackgroundColor,
    )
    this._focusedTextColor = parseColor(options.focusedTextColor || options.textColor || defaults.focusedTextColor)
    this._placeholder = options.placeholder ?? defaults.placeholder
    this._placeholderColor = parseColor(options.placeholderColor || defaults.placeholderColor)

    const mergedBindings = this.mergeKeyBindings(defaultTextareaKeybindings, options.keyBindings || [])
    this._keyBindingsMap = this.buildKeyBindingsMap(mergedBindings)
    this._actionHandlers = this.buildActionHandlers()

    this.updateValue(options.value ?? defaults.value)
    this.updateColors()

    this.editBuffer.setPlaceholder(this._placeholder)
    this.editBuffer.setPlaceholderColor(this._placeholderColor)
  }

  private mergeKeyBindings(defaults: KeyBinding[], custom: KeyBinding[]): KeyBinding[] {
    const map = new Map<string, KeyBinding>()
    for (const binding of defaults) {
      const key = this.getKeyBindingKey(binding)
      map.set(key, binding)
    }
    for (const binding of custom) {
      const key = this.getKeyBindingKey(binding)
      map.set(key, binding)
    }
    return Array.from(map.values())
  }

  private getKeyBindingKey(binding: KeyBinding): string {
    return `${binding.name}:${!!binding.ctrl}:${!!binding.shift}:${!!binding.meta}`
  }

  private buildKeyBindingsMap(bindings: KeyBinding[]): Map<string, TextareaAction> {
    const map = new Map<string, TextareaAction>()
    for (const binding of bindings) {
      const key = this.getKeyBindingKey(binding)
      map.set(key, binding.action)
    }
    return map
  }

  private buildActionHandlers(): Map<TextareaAction, () => boolean> {
    return new Map([
      ["move-left", () => this.moveCursorLeft()],
      ["move-right", () => this.moveCursorRight()],
      ["move-up", () => this.moveCursorUp()],
      ["move-down", () => this.moveCursorDown()],
      ["select-left", () => this.moveCursorLeft({ select: true })],
      ["select-right", () => this.moveCursorRight({ select: true })],
      ["select-up", () => this.moveCursorUp({ select: true })],
      ["select-down", () => this.moveCursorDown({ select: true })],
      ["line-home", () => this.gotoLineHome()],
      ["line-end", () => this.gotoLineEnd()],
      ["select-line-home", () => this.gotoLineHome({ select: true })],
      ["select-line-end", () => this.gotoLineEnd({ select: true })],
      ["buffer-home", () => this.gotoBufferHome()],
      ["buffer-end", () => this.gotoBufferEnd()],
      ["delete-line", () => this.deleteLine()],
      ["delete-to-line-end", () => this.deleteToLineEnd()],
      ["backspace", () => this.deleteCharBackward()],
      ["delete", () => this.deleteChar()],
      ["newline", () => this.newLine()],
      ["undo", () => this.undo()],
      ["redo", () => this.redo()],
    ])
  }

  public handlePaste(text: string): void {
    this.insertText(text)
  }

  public handleKeyPress(key: KeyEvent | string): boolean {
    const keyName = typeof key === "string" ? key : key.name
    const keySequence = typeof key === "string" ? key : key.sequence
    const keyCtrl = typeof key === "string" ? false : key.ctrl
    const keyShift = typeof key === "string" ? false : key.shift
    const keyMeta = typeof key === "string" ? false : key.meta

    const bindingKeyWithShift = this.getKeyBindingKey({
      name: keyName,
      ctrl: keyCtrl,
      shift: keyShift,
      meta: keyMeta,
      action: "move-left",
    })

    const action = this._keyBindingsMap.get(bindingKeyWithShift)

    if (action) {
      const handler = this._actionHandlers.get(action)
      if (handler) {
        return handler()
      }
    }

    if (keySequence && !keyCtrl && !keyMeta) {
      const firstCharCode = keySequence.charCodeAt(0)

      if (firstCharCode < 32) {
        return false
      }

      if (firstCharCode === 127) {
        return false
      }

      this.insertText(keySequence)
      return true
    }

    return false
  }

  get value(): string {
    return this.editBuffer.getText()
  }

  set value(value: string) {
    this.updateValue(value)
  }

  private updateValue(value: string): void {
    this.editBuffer.setText(value, { history: false })
    this.yogaNode.markDirty()
    this.requestRender()
  }

  private updateColors(): void {
    const effectiveBg = this._focused ? this._focusedBackgroundColor : this._unfocusedBackgroundColor
    const effectiveFg = this._focused ? this._focusedTextColor : this._unfocusedTextColor

    super.backgroundColor = effectiveBg
    super.textColor = effectiveFg
  }

  public insertChar(char: string): void {
    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    this.editBuffer.insertChar(char)
    this.requestRender()
  }

  public insertText(text: string): void {
    if (this.hasSelection()) {
      this.deleteSelectedText()
    }

    this.editBuffer.insertText(text)
    this.requestRender()
  }

  public deleteChar(): boolean {
    if (this.hasSelection()) {
      this.deleteSelectedText()
      return true
    }

    this._ctx.clearSelection()
    this.editBuffer.deleteChar()
    this.requestRender()
    return true
  }

  public deleteCharBackward(): boolean {
    if (this.hasSelection()) {
      this.deleteSelectedText()
      return true
    }

    this._ctx.clearSelection()
    this.editBuffer.deleteCharBackward()
    this.requestRender()
    return true
  }

  private deleteSelectedText(): void {
    this.editorView.deleteSelectedText()

    this._ctx.clearSelection()
    this.requestRender()
  }

  public newLine(): boolean {
    this._ctx.clearSelection()
    this.editBuffer.newLine()
    this.requestRender()
    return true
  }

  public deleteLine(): boolean {
    this._ctx.clearSelection()
    this.editBuffer.deleteLine()
    this.requestRender()
    return true
  }

  public moveCursorLeft(options?: { select?: boolean }): boolean {
    const select = options?.select ?? false
    this.handleShiftSelection(select, true)
    this.editBuffer.moveCursorLeft()
    this.handleShiftSelection(select, false)
    this.requestRender()
    return true
  }

  public moveCursorRight(options?: { select?: boolean }): boolean {
    const select = options?.select ?? false
    this.handleShiftSelection(select, true)
    this.editBuffer.moveCursorRight()
    this.handleShiftSelection(select, false)
    this.requestRender()
    return true
  }

  public moveCursorUp(options?: { select?: boolean }): boolean {
    const select = options?.select ?? false
    this.handleShiftSelection(select, true)
    this.editorView.moveUpVisual()
    this.handleShiftSelection(select, false)
    this.requestRender()
    return true
  }

  public moveCursorDown(options?: { select?: boolean }): boolean {
    const select = options?.select ?? false
    this.handleShiftSelection(select, true)
    this.editorView.moveDownVisual()
    this.handleShiftSelection(select, false)
    this.requestRender()
    return true
  }

  public gotoLine(line: number): void {
    this.editBuffer.gotoLine(line)
    this.requestRender()
  }

  public gotoLineHome(options?: { select?: boolean }): boolean {
    const select = options?.select ?? false
    this.handleShiftSelection(select, true)
    const cursor = this.editorView.getCursor()
    this.editBuffer.setCursor(cursor.row, 0)
    this.handleShiftSelection(select, false)
    this.requestRender()
    return true
  }

  public gotoLineEnd(options?: { select?: boolean }): boolean {
    const select = options?.select ?? false
    this.handleShiftSelection(select, true)
    const cursor = this.editorView.getCursor()

    this.editBuffer.gotoLine(9999)
    const afterCursor = this.editorView.getCursor()

    if (afterCursor.row !== cursor.row) {
      this.editBuffer.setCursor(cursor.row, 9999)
    }
    this.handleShiftSelection(select, false)
    this.requestRender()
    return true
  }

  public gotoBufferHome(): boolean {
    this.editBuffer.setCursor(0, 0)
    this.requestRender()
    return true
  }

  public gotoBufferEnd(): boolean {
    this.editBuffer.gotoLine(999999)
    this.requestRender()
    return true
  }

  public deleteToLineEnd(): boolean {
    const cursor = this.editorView.getCursor()
    const startCol = cursor.col

    const tempCursor = this.editorView.getCursor()
    this.editBuffer.setCursor(tempCursor.row, 9999)
    const endCursor = this.editorView.getCursor()
    const endCol = endCursor.col

    this.editBuffer.setCursor(cursor.row, startCol)

    if (endCol > startCol) {
      for (let i = 0; i < endCol - startCol; i++) {
        this.deleteChar()
      }
    }

    this.requestRender()
    return true
  }

  public undo(): boolean {
    this._ctx.clearSelection()
    this.editBuffer.undo()
    this.requestRender()
    return true
  }

  public redo(): boolean {
    this._ctx.clearSelection()
    this.editBuffer.redo()
    this.requestRender()
    return true
  }

  private handleShiftSelection(shiftPressed: boolean, isBeforeMovement: boolean): void {
    if (!this.selectable) return

    if (!shiftPressed) {
      this._ctx.clearSelection()
      return
    }

    const visualCursor = this.editorView.getVisualCursor()

    const viewport = this.editorView.getViewport()
    const cursorX = this.x + visualCursor.visualCol
    const cursorY = this.y + (visualCursor.visualRow - viewport.offsetY)

    if (isBeforeMovement) {
      if (!this._ctx.hasSelection) {
        this._ctx.startSelection(this, cursorX, cursorY)
      }
    } else {
      this._ctx.updateSelection(this, cursorX, cursorY)
    }
  }

  public focus(): void {
    super.focus()
    this.updateColors()
  }

  public blur(): void {
    super.blur()
    this.updateColors()
  }

  get placeholder(): string | null {
    return this._placeholder
  }

  set placeholder(value: string | null) {
    if (this._placeholder !== value) {
      this._placeholder = value
      this.editBuffer.setPlaceholder(value)
      this.requestRender()
    }
  }

  override get backgroundColor(): RGBA {
    return this._unfocusedBackgroundColor
  }

  override set backgroundColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.backgroundColor)
    if (this._unfocusedBackgroundColor !== newColor) {
      this._unfocusedBackgroundColor = newColor
      this.updateColors()
    }
  }

  override get textColor(): RGBA {
    return this._unfocusedTextColor
  }

  override set textColor(value: RGBA | string | undefined) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.textColor)
    if (this._unfocusedTextColor !== newColor) {
      this._unfocusedTextColor = newColor
      this.updateColors()
    }
  }

  set focusedBackgroundColor(value: ColorInput) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.focusedBackgroundColor)
    if (this._focusedBackgroundColor !== newColor) {
      this._focusedBackgroundColor = newColor
      this.updateColors()
    }
  }

  set focusedTextColor(value: ColorInput) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.focusedTextColor)
    if (this._focusedTextColor !== newColor) {
      this._focusedTextColor = newColor
      this.updateColors()
    }
  }

  set placeholderColor(value: ColorInput) {
    const newColor = parseColor(value ?? TextareaRenderable.defaults.placeholderColor)
    if (this._placeholderColor !== newColor) {
      this._placeholderColor = newColor
      this.editBuffer.setPlaceholderColor(newColor)
      this.requestRender()
    }
  }
}
