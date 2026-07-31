import { type RenderableOptions, Renderable } from "../Renderable.js"
import type { KeyEvent, PasteEvent } from "../lib/KeyHandler.js"
import { RGBA } from "../lib/RGBA.js"
import type { RenderContext } from "../types.js"
import type { MouseEvent } from "../renderer.js"
import type { OptimizedBuffer } from "../buffer.js"
import { resolveRenderLib, type EmbeddedTerminalHandle, type EmbeddedTerminalMouse, type RenderLib } from "../zig.js"

export interface EmbeddedTerminalOptions extends RenderableOptions<EmbeddedTerminalRenderable> {
  cols?: number
  rows?: number
  maxScrollback?: number
  libraryPath?: string
  onData?: (data: Uint8Array) => void
  onTerminalResize?: (cols: number, rows: number) => void
}

const MOD_SHIFT = 1 << 0
const MOD_CTRL = 1 << 1
const MOD_ALT = 1 << 2
const MOD_SUPER = 1 << 3
const MOD_CAPS_LOCK = 1 << 4
const MOD_NUM_LOCK = 1 << 5

export class EmbeddedTerminalRenderable extends Renderable {
  private readonly lib: RenderLib
  private handle: EmbeddedTerminalHandle | null = null
  private _onData?: (data: Uint8Array) => void
  private _onTerminalResize?: (cols: number, rows: number) => void
  private keyreleaseHandler: ((key: KeyEvent) => void) | null = null

  constructor(ctx: RenderContext, options: EmbeddedTerminalOptions) {
    const cols = options.cols ?? (typeof options.width === "number" ? options.width : 80)
    const rows = options.rows ?? (typeof options.height === "number" ? options.height : 24)
    super(ctx, {
      ...options,
      width: options.width ?? cols,
      height: options.height ?? rows,
      buffered: true,
    })
    this._focusable = true
    this._onData = options.onData
    this._onTerminalResize = options.onTerminalResize
    this.lib = resolveRenderLib()

    try {
      this.handle = this.lib.createEmbeddedTerminal({
        cols,
        rows,
        maxScrollback: options.maxScrollback,
        libraryPath: options.libraryPath,
      })
      this.setupMouse()
    } catch (error) {
      this.destroy()
      throw error
    }
  }

  public get onData(): ((data: Uint8Array) => void) | undefined {
    return this._onData
  }

  public set onData(value: ((data: Uint8Array) => void) | undefined) {
    this._onData = value
  }

  public get onTerminalResize(): ((cols: number, rows: number) => void) | undefined {
    return this._onTerminalResize
  }

  public set onTerminalResize(value: ((cols: number, rows: number) => void) | undefined) {
    this._onTerminalResize = value
  }

  public write(data: string | Uint8Array): void {
    if (!this.handle) return
    this.lib.embeddedTerminalWrite(this.handle, data)
    this.flushResponses()
    this.requestRender()
  }

  public invalidate(): void {
    if (!this.handle) return
    this.lib.embeddedTerminalInvalidate(this.handle)
    this.requestRender()
  }

  public encodeKey(key: KeyEvent): Uint8Array {
    if (!this.handle) return new Uint8Array()
    const text = textualKey(key)
    return this.lib.embeddedTerminalEncodeKey(this.handle, {
      action: key.eventType === "release" ? "release" : key.repeated ? "repeat" : "press",
      key: physicalKey(key),
      mods: modifiers(key),
      text,
      unshiftedCodepoint: key.baseCode ?? text?.codePointAt(0) ?? 0,
    })
  }

  public encodePaste(bytes: Uint8Array): Uint8Array {
    if (!this.handle) return new Uint8Array()
    return this.lib.embeddedTerminalEncodePaste(this.handle, bytes)
  }

  public focus(): void {
    if (this.focused) return
    super.focus()
    if (!this.focused) return
    this.keyreleaseHandler = (key) => this.handleKeyPress(key)
    this.ctx._internalKeyInput.onInternal("keyrelease", this.keyreleaseHandler)
    try {
      this.send(this.handle ? this.lib.embeddedTerminalEncodeFocus(this.handle, true) : new Uint8Array())
    } catch (error) {
      this.removeKeyreleaseHandler()
      super.blur()
      throw error
    }
  }

  public blur(): void {
    if (!this.focused) return
    try {
      this.send(this.handle ? this.lib.embeddedTerminalEncodeFocus(this.handle, false) : new Uint8Array())
    } catch {
      // User callbacks must not prevent focus or native resource cleanup.
    } finally {
      this.removeKeyreleaseHandler()
      super.blur()
      this._ctx.setCursorPosition(0, 0, false)
    }
  }

  public handleKeyPress(key: KeyEvent): boolean {
    const output = this.encodeKey(key)
    this.send(output)
    return output.byteLength > 0
  }

  public handlePaste(event: PasteEvent): void {
    this.send(this.encodePaste(event.bytes))
  }

  protected onResize(width: number, height: number): void {
    super.onResize(width, height)
    if (!this.handle || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    const cols = Math.min(Math.floor(width), 0xffff)
    const rows = Math.min(Math.floor(height), 0xffff)
    this.lib.embeddedTerminalResize(this.handle, cols, rows)
    this.lib.embeddedTerminalInvalidate(this.handle)
    this.flushResponses()
    this._onTerminalResize?.(cols, rows)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this.handle || !this.visible || this.isDestroyed) return
    this.lib.embeddedTerminalCompose(this.handle, buffer.ptr, 0, 0)
    const cursor = this.lib.embeddedTerminalCursor(this.handle)
    const visible = this.focused && cursor.visible && cursor.hasValue
    this._ctx.setCursorPosition(this._screenX + cursor.x + 1, this._screenY + cursor.y + 1, visible)
    if (!visible) return
    this._ctx.setCursorStyle({
      style: cursor.style === "bar" ? "line" : cursor.style === "underline" ? "underline" : "block",
      blinking: cursor.blinking,
    })
    if (cursor.color) this._ctx.setCursorColor(RGBA.fromInts(cursor.color.r, cursor.color.g, cursor.color.b, 255))
  }

  protected destroySelf(): void {
    if (this.handle) {
      this.lib.destroyEmbeddedTerminal(this.handle)
      this.handle = null
    }
    this._ctx.setCursorPosition(0, 0, false)
    super.destroySelf()
  }

  private setupMouse(): void {
    this.onMouseDown = (event) => this.forwardMouse(event, "press")
    this.onMouseUp = (event) => this.forwardMouse(event, "release")
    this.onMouseMove = (event) => this.forwardMouse(event, "motion")
    this.onMouseDrag = (event) => this.forwardMouse(event, "motion")
    this.onMouseScroll = (event) => this.forwardMouse(event, "press")
  }

  private forwardMouse(event: MouseEvent, action: EmbeddedTerminalMouse["action"]): void {
    if (!this.handle) return
    if (event.type === "down" && event.button === 0) this.focus()
    const button = mouseButton(event)
    const output = this.lib.embeddedTerminalEncodeMouse(this.handle, {
      action,
      button,
      mods: modifiers(event.modifiers),
      x: event.x - this._screenX,
      y: event.y - this._screenY,
      anyButtonPressed: event.isDragging === true || event.type === "down",
    })
    if (event.type === "scroll" && output.byteLength === 0) {
      const direction = event.scroll?.direction
      if (direction !== "up" && direction !== "down") return
      this.lib.embeddedTerminalScroll(this.handle, direction === "up" ? -3 : 3)
      this.requestRender()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (output.byteLength === 0) return
    event.preventDefault()
    event.stopPropagation()
    this.send(output)
  }

  private flushResponses(): void {
    if (!this.handle) return
    this.send(this.lib.embeddedTerminalDrainResponses(this.handle))
  }

  private removeKeyreleaseHandler(): void {
    if (!this.keyreleaseHandler) return
    this.ctx._internalKeyInput.offInternal("keyrelease", this.keyreleaseHandler)
    this.keyreleaseHandler = null
  }

  private send(data: Uint8Array): void {
    if (data.byteLength > 0) this._onData?.(data)
  }
}

function modifiers(input: {
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
  option?: boolean
  super?: boolean
  capsLock?: boolean
  numLock?: boolean
}) {
  let value = 0
  if (input.shift) value |= MOD_SHIFT
  if (input.ctrl) value |= MOD_CTRL
  if (input.alt || input.meta || input.option) value |= MOD_ALT
  if (input.super) value |= MOD_SUPER
  if (input.capsLock) value |= MOD_CAPS_LOCK
  if (input.numLock) value |= MOD_NUM_LOCK
  return value
}

function physicalKey(key: KeyEvent) {
  const code = key.code
  if (code?.startsWith("Key") && code.length === 4) return 20 + code.charCodeAt(3) - 65
  if (code?.startsWith("Digit") && code.length === 6) return 6 + Number(code[5])
  if (code?.startsWith("F") && /^F(?:[1-9]|1[0-9]|2[0-5])$/.test(code)) return 120 + Number(code)
  return (
    {
      backspace: 53,
      enter: 58,
      return: 58,
      space: 63,
      tab: 64,
      delete: 68,
      end: 69,
      home: 71,
      insert: 72,
      pagedown: 73,
      pageup: 74,
      down: 75,
      left: 76,
      right: 77,
      up: 78,
      escape: 120,
    }[key.name.toLowerCase()] ?? 0
  )
}

function textualKey(key: KeyEvent) {
  if (key.sequence.length > 0 && !/[\p{Cc}]/u.test(key.sequence)) return key.sequence
  if (key.name === "space") return " "
  if (key.name.length === 0 || /[\p{Cc}]/u.test(key.name)) return
  if ([...key.name].length === 1 || /[^\x00-\x7f]/.test(key.name)) return key.name
}

function mouseButton(event: MouseEvent): EmbeddedTerminalMouse["button"] {
  if (event.type === "scroll") {
    if (event.scroll?.direction === "up") return "four"
    if (event.scroll?.direction === "down") return "five"
    if (event.scroll?.direction === "left") return "six"
    if (event.scroll?.direction === "right") return "seven"
    return
  }
  return ({ 0: "left", 1: "middle", 2: "right", 4: "four", 5: "five" } as const)[event.button]
}
