import { getKeyHandler } from "./KeyHandler"
import type { Renderable } from "../Renderable"
import { YGTreeWalker } from "./YGTreeWalker"
import type { ParsedKey } from "./parse.keypress"

export type FocusKeyHandler = (key: ParsedKey, focusNext: () => void, focusPrev: () => void) => void

interface FocusManagerConfig {
  onKey?: FocusKeyHandler
}

export class FocusManager {
  private static instance: FocusManager | null = null

  private keyUnsubscribe: (() => void) | null = null
  private readonly root: Renderable
  private current: Renderable | null = null
  private walker: YGTreeWalker | null = null
  private onKey?: FocusKeyHandler

  static install(root: Renderable, config?: FocusManagerConfig): FocusManager {
    if (this.instance) return this.instance
    const mgr = new FocusManager(root, config)
    this.instance = mgr
    mgr.attach()
    mgr.initFocus()
    return mgr
  }

  static uninstall(): void {
    this.instance?.detach()
    this.instance = null
  }

  constructor(root: Renderable, config?: FocusManagerConfig) {
    this.root = root
    this.walker = new YGTreeWalker(this.root, (n) => this.isFocusable(n))
    this.onKey = config?.onKey
  }

  private getWalker(): YGTreeWalker {
    if (this.current && this.walker) this.walker.currentNode = this.current
    return this.walker!
  }

  private attach(): void {
    const keyHandler = getKeyHandler()
    const keypress = (key: ParsedKey) => {
      if (this.onKey) {
        this.onKey(
          key,
          () => this.focusNext(),
          () => this.focusPrev(),
        )
      } else {
        if (key.name === "tab") {
          key.shift ? this.focusPrev() : this.focusNext()
        } else if (key.name === "up") {
          this.focusPrev()
        } else if (key.name === "down") {
          this.focusNext()
        }
      }
    }

    keyHandler.on("keypress", keypress)
    this.keyUnsubscribe = () => keyHandler.off("keypress", keypress)
  }

  private detach(): void {
    this.keyUnsubscribe?.()
    this.keyUnsubscribe = null
    this.current = null
    this.walker = null
  }

  private isFocusable(r: Renderable): boolean {
    return r["focusable"] === true && r["_visible"] === true
  }

  private initFocus() {
    const walker = this.getWalker()
    const first = walker.firstAccepted()
    if (first) {
      this.current = first
      first.focus()
    }
  }

  private findNextFocusable(): Renderable | null {
    const walker = this.getWalker()
    const next = walker.nextAccepted()
    return next ?? walker.firstAccepted()
  }

  private focusNext() {
    const next = this.findNextFocusable()
    if (!next) return
    this.current?.blur()
    this.current = next
    this.current.focus()
  }

  private findPrevFocusable(): Renderable | null {
    const walker = this.getWalker()
    const prev = walker.prevAccepted()
    return prev ?? walker.lastAccepted()
  }

  private focusPrev() {
    const prev = this.findPrevFocusable()
    if (!prev) return
    this.current?.blur()
    this.current = prev
    this.current.focus()
  }
}
