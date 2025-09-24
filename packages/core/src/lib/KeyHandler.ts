import { EventEmitter } from "events"
import { parseKeypress, type KeyEventType, type ParsedKey } from "./parse.keypress"
import { ANSI } from "../ansi"

export class KeyEvent implements ParsedKey {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  option: boolean
  sequence: string
  number: boolean
  raw: string
  eventType: KeyEventType
  code?: string
  super?: boolean
  hyper?: boolean
  capsLock?: boolean
  numLock?: boolean
  baseCode?: number

  private _defaultPrevented: boolean = false

  constructor(key: ParsedKey) {
    this.name = key.name
    this.ctrl = key.ctrl
    this.meta = key.meta
    this.shift = key.shift
    this.option = key.option
    this.sequence = key.sequence
    this.number = key.number
    this.raw = key.raw
    this.eventType = key.eventType
    this.code = key.code
    this.super = key.super
    this.hyper = key.hyper
    this.capsLock = key.capsLock
    this.numLock = key.numLock
    this.baseCode = key.baseCode
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented
  }
  preventDefault(): void {
    this._defaultPrevented = true
  }
}

export class PasteEvent {
  text: string
  private _defaultPrevented: boolean = false

  constructor(text: string) {
    this.text = text
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented
  }

  preventDefault(): void {
    this._defaultPrevented = true
  }
}

export type KeyHandlerEventMap = {
  keypress: [KeyEvent]
  keyrepeat: [KeyEvent]
  keyrelease: [KeyEvent]
  paste: [PasteEvent]
}

export class KeyHandler extends EventEmitter<KeyHandlerEventMap> {
  protected stdin: NodeJS.ReadStream
  protected useKittyKeyboard: boolean
  protected listener: (key: Buffer) => void
  protected pasteMode: boolean = false
  protected pasteBuffer: string[] = []

  constructor(stdin?: NodeJS.ReadStream, useKittyKeyboard: boolean = false) {
    super()

    this.stdin = stdin || process.stdin
    this.useKittyKeyboard = useKittyKeyboard

    this.listener = (key: Buffer) => {
      let data = key.toString()
      if (data.startsWith(ANSI.bracketedPasteStart)) {
        this.pasteMode = true
      }
      if (this.pasteMode) {
        this.pasteBuffer.push(Bun.stripANSI(data))
        if (data.endsWith(ANSI.bracketedPasteEnd)) {
          this.pasteMode = false
          this.emit("paste", new PasteEvent(this.pasteBuffer.join("")))
          this.pasteBuffer = []
        }
        return
      }
      const parsedKey = parseKeypress(key, { useKittyKeyboard: this.useKittyKeyboard })

      switch (parsedKey.eventType) {
        case "press":
          this.emit("keypress", new KeyEvent(parsedKey))
          break
        case "repeat":
          this.emit("keyrepeat", new KeyEvent(parsedKey))
          break
        case "release":
          this.emit("keyrelease", new KeyEvent(parsedKey))
          break
        default:
          this.emit("keypress", new KeyEvent(parsedKey))
          break
      }
    }
    this.stdin.on("data", this.listener)
  }

  public destroy(): void {
    this.stdin.removeListener("data", this.listener)
  }
}

/**
 * This class is used internally by the renderer to ensure global handlers
 * can preventDefault before renderable handlers process events.
 */
export class InternalKeyHandler extends KeyHandler {
  private renderableHandlers: Map<keyof KeyHandlerEventMap, Set<Function>> = new Map()

  constructor(stdin?: NodeJS.ReadStream, useKittyKeyboard: boolean = false) {
    super(stdin, useKittyKeyboard)
  }

  public emit<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean {
    return this.emitWithPriority(event, ...args)
  }

  private emitWithPriority<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean {
    const hasGlobalListeners = super.emit(event as any, ...args)
    const renderableSet = this.renderableHandlers.get(event)
    let hasRenderableListeners = false

    if (renderableSet && renderableSet.size > 0) {
      hasRenderableListeners = true

      if (event === "keypress" || event === "keyrepeat" || event === "keyrelease" || event === "paste") {
        const keyEvent = args[0]
        if (keyEvent.defaultPrevented) return hasGlobalListeners || hasRenderableListeners
      }

      for (const handler of renderableSet) {
        handler(...args)
      }
    }

    return hasGlobalListeners || hasRenderableListeners
  }

  public onInternal<K extends keyof KeyHandlerEventMap>(
    event: K,
    handler: (...args: KeyHandlerEventMap[K]) => void,
  ): void {
    if (!this.renderableHandlers.has(event)) {
      this.renderableHandlers.set(event, new Set())
    }
    this.renderableHandlers.get(event)!.add(handler)
  }

  public offInternal<K extends keyof KeyHandlerEventMap>(
    event: K,
    handler: (...args: KeyHandlerEventMap[K]) => void,
  ): void {
    const handlers = this.renderableHandlers.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }
}
