import { EventEmitter } from "events"
import { parseKeypress, type KeyEventType, type ParsedKey } from "./parse.keypress"
import { ANSI } from "../ansi"
import type { Renderable } from "../Renderable"
import { findClosestKeyboardScope } from "./focus-traversal"

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
  repeated?: boolean

  private _defaultPrevented: boolean = false
  private _propagationStopped: boolean = false

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
    this.repeated = key.repeated
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented
  }

  get propagationStopped(): boolean {
    return this._propagationStopped
  }

  preventDefault(): void {
    this._defaultPrevented = true
  }

  stopPropagation(): void {
    this._propagationStopped = true
  }
}

export class PasteEvent {
  text: string
  private _defaultPrevented: boolean = false
  private _propagationStopped: boolean = false

  constructor(text: string) {
    this.text = text
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented
  }

  get propagationStopped(): boolean {
    return this._propagationStopped
  }

  preventDefault(): void {
    this._defaultPrevented = true
  }

  stopPropagation(): void {
    this._propagationStopped = true
  }
}

export type KeyHandlerEventMap = {
  keypress: [KeyEvent]
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

    try {
      switch (parsedKey.eventType) {
        case "press":
          this.emit("keypress", new KeyEvent(parsedKey))
          break
        case "release":
          this.emit("keyrelease", new KeyEvent(parsedKey))
          break
        default:
          this.emit("keypress", new KeyEvent(parsedKey))
          break
      }
    } catch (error) {
      console.error(`[KeyHandler] Error processing input:`, error)
      return true
    }

    return true
  }

  public processPaste(data: string): void {
    try {
      const cleanedData = Bun.stripANSI(data)
      this.emit("paste", new PasteEvent(cleanedData))
    } catch (error) {
      console.error(`[KeyHandler] Error processing paste:`, error)
    }
  }
}

/**
 * Internal key handler used by the renderer with priority-based dispatch.
 * Focused renderables inside a trap-focus scope receive events first (scope isolation).
 * Otherwise, global handlers run first so they can preventDefault before renderables.
 */
export class InternalKeyHandler extends KeyHandler {
  private renderableHandlers: Map<keyof KeyHandlerEventMap, Set<Function>> = new Map()
  private focusedRenderableProvider: (() => Renderable | null) | null = null

  constructor(useKittyKeyboard: boolean = false) {
    super(useKittyKeyboard)
  }

  public override emit<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean {
    return this.emitWithPriority(event, ...args)
  }

  private emitWithPriority<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean {
    if (event === "keypress" || event === "keyrelease" || event === "paste") {
      const focusedRenderable = this.focusedRenderableProvider?.()
      if (focusedRenderable && !focusedRenderable.isDestroyed) {
        // When the focused renderable is inside a trap-focus scope, dispatch
        // to it first so the scope can stopPropagation before global handlers.
        // Otherwise, run global handlers first so they can preventDefault.
        if (this.isInsideTrapFocusScope(focusedRenderable)) {
          return this.emitScopeFirst(event, args, focusedRenderable)
        }
        return this.emitGlobalFirst(event, args, focusedRenderable)
      }
    }

    const hasGlobalListeners = this.emitGlobalListeners(event, ...args)
    if (this.eventPropagationStopped(event, ...args)) {
      return hasGlobalListeners
    }

    const hasRenderableListeners = this.emitInternalListeners(event, ...args)
    return hasGlobalListeners || hasRenderableListeners
  }

  private emitScopeFirst<K extends keyof KeyHandlerEventMap>(
    event: K,
    args: KeyHandlerEventMap[K],
    focusedRenderable: Renderable,
  ): boolean {
    const keyEvent = args[0]
    this.dispatchToRenderable(event, keyEvent, focusedRenderable)
    if (keyEvent.propagationStopped) {
      return true
    }

    const hasGlobalListeners = this.emitGlobalListeners(event, ...args)
    if (this.eventPropagationStopped(event, ...args)) {
      return hasGlobalListeners
    }

    const hasRenderableListeners = this.emitInternalListeners(event, ...args)
    return hasGlobalListeners || hasRenderableListeners
  }

  private emitGlobalFirst<K extends keyof KeyHandlerEventMap>(
    event: K,
    args: KeyHandlerEventMap[K],
    focusedRenderable: Renderable,
  ): boolean {
    const hasGlobalListeners = this.emitGlobalListeners(event, ...args)
    if (this.eventPropagationStopped(event, ...args)) {
      return hasGlobalListeners
    }

    const keyEvent = args[0]
    if (!keyEvent.defaultPrevented) {
      this.dispatchToRenderable(event, keyEvent, focusedRenderable)
    }
    if (keyEvent.propagationStopped) {
      return true
    }

    const hasRenderableListeners = this.emitInternalListeners(event, ...args)
    return hasGlobalListeners || hasRenderableListeners
  }

  private dispatchToRenderable(event: string, keyEvent: KeyEvent | PasteEvent, renderable: Renderable): void {
    switch (event) {
      case "keypress":
        renderable.processKeyEvent(keyEvent as KeyEvent)
        break
      case "keyrelease":
        renderable.processKeyReleaseEvent(keyEvent as KeyEvent)
        break
      case "paste":
        renderable.processPasteEvent(keyEvent as PasteEvent)
        break
    }
  }

  private isInsideTrapFocusScope(renderable: Renderable): boolean {
    return findClosestKeyboardScope(renderable) !== null
  }

  private emitGlobalListeners<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean {
    let hasGlobalListeners = false
    const globalListeners = this.listeners(event as any)
    if (globalListeners.length === 0) return false

    hasGlobalListeners = true
    for (const listener of globalListeners) {
      try {
        listener(...args)
      } catch (error) {
        console.error(`[KeyHandler] Error in global ${event} handler:`, error)
      }
      if (this.eventPropagationStopped(event, ...args)) {
        return hasGlobalListeners
      }
    }
    return hasGlobalListeners
  }

  private emitInternalListeners<K extends keyof KeyHandlerEventMap>(event: K, ...args: KeyHandlerEventMap[K]): boolean {
    const renderableSet = this.renderableHandlers.get(event)
    // Snapshot the handler list so listeners added during dispatch (e.g., via focus changes)
    // do not receive the in-flight key event.
    const renderableHandlers = renderableSet && renderableSet.size > 0 ? [...renderableSet] : []
    let hasRenderableListeners = false

    if (renderableSet && renderableSet.size > 0) {
      hasRenderableListeners = true

      if (this.eventPreventedOrStopped(event, ...args)) {
        return hasRenderableListeners
      }

      for (const handler of renderableHandlers) {
        try {
          handler(...args)
        } catch (error) {
          console.error(`[KeyHandler] Error in renderable ${event} handler:`, error)
        }

        if (this.eventPropagationStopped(event, ...args)) {
          return hasRenderableListeners
        }
      }
    }

    return hasRenderableListeners
  }

  private eventPreventedOrStopped<K extends keyof KeyHandlerEventMap>(
    event: K,
    ...args: KeyHandlerEventMap[K]
  ): boolean {
    if (event === "keypress" || event === "keyrelease" || event === "paste") {
      const keyEvent = args[0]
      return keyEvent.defaultPrevented || keyEvent.propagationStopped
    }
    return false
  }

  private eventPropagationStopped<K extends keyof KeyHandlerEventMap>(
    event: K,
    ...args: KeyHandlerEventMap[K]
  ): boolean {
    if (event === "keypress" || event === "keyrelease" || event === "paste") {
      const keyEvent = args[0]
      return keyEvent.propagationStopped
    }
    return false
  }

  public setFocusedRenderableProvider(provider: () => Renderable | null): void {
    this.focusedRenderableProvider = provider
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
