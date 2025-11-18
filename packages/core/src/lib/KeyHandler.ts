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
  source: "raw" | "kitty"
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
    this.source = key.source
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
  protected useKittyKeyboard: boolean

  constructor(useKittyKeyboard: boolean = false) {
    super()

    this.useKittyKeyboard = useKittyKeyboard
  }

  public processInput(data: string): boolean {
    const parsedKey = parseKeypress(data, { useKittyKeyboard: this.useKittyKeyboard })

    if (!parsedKey) {
      return false
    }

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

    return true
  }

  public processPaste(data: string): void {
    const cleanedData = Bun.stripANSI(data)
    this.emit("paste", new PasteEvent(cleanedData))
  }
}

/**
 * This class is used internally by the renderer to ensure global handlers
 * can preventDefault before renderable handlers process events.
 */
export class InternalKeyHandler extends KeyHandler {
  private renderableHandlers: Map<keyof KeyHandlerEventMap, Set<Function>> = new Map()

  constructor(useKittyKeyboard: boolean = false) {
    super(useKittyKeyboard)
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
