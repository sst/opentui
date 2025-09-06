import { getKeyHandler } from "./KeyHandler"
import type { Renderable } from "../Renderable"
import { YGTreeWalker } from "./YGTreeWalker"
import type { ParsedKey } from "./parse.keypress"
import type { CliRenderer } from "../renderer"
import { globalEmitter } from "./globalEmitter"

export type FocusKeyHandler = (key: ParsedKey, focusNext: () => void, focusPrev: () => void) => void

interface FocusManagerConfig {
  onKey?: FocusKeyHandler
}

export class FocusManager {
  private static instance: FocusManager | null = null

  private globalListener: () => void

  private keyUnsubscribe: (() => void) | null = null
  private readonly renderer: CliRenderer
  private walker: YGTreeWalker | null = null
  private onKey?: FocusKeyHandler

  static install(renderer: CliRenderer, config?: FocusManagerConfig): FocusManager {
    if (this.instance) return this.instance
    const mgr = new FocusManager(renderer, config)
    this.instance = mgr
    mgr.attach()
    mgr.initFocus()
    return mgr
  }

  static uninstall(): void {
    this.instance?.detach()
    this.instance = null
  }

  constructor(renderer: CliRenderer, config?: FocusManagerConfig) {
    this.renderer = renderer
    this.walker = new YGTreeWalker(this.renderer.root, (n) => this.isFocusable(n))
    this.onKey = config?.onKey

    this.globalListener = () => this.walker?.reset()
    globalEmitter.on("treeChanged", this.globalListener)
  }

  private getWalker(): YGTreeWalker {
    if (!this.walker) throw new Error("Walker not initialized")

    if (this.renderer.focusedRenderable) {
      this.walker.currentNode = this.renderer.focusedRenderable
    }

    return this.walker
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
        }
      }
    }

    keyHandler.on("keypress", keypress)
    this.keyUnsubscribe = () => keyHandler.off("keypress", keypress)
  }

  private detach(): void {
    this.keyUnsubscribe?.()
    this.keyUnsubscribe = null
    globalEmitter.off("treeChanged", this.globalListener)
    this.renderer.focusedRenderable = null
    this.walker = null
  }

  private isFocusable(r: Renderable): boolean {
    return r["focusable"] === true && r["_visible"] === true
  }

  private initFocus() {
    const walker = this.getWalker()
    const first = walker.firstAccepted()
    if (first) {
      this.renderer.focusedRenderable = first
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
    this.renderer.focusedRenderable?.blur()
    this.renderer.focusedRenderable = next
    this.renderer.focusedRenderable.focus()
  }

  private findPrevFocusable(): Renderable | null {
    const walker = this.getWalker()
    const prev = walker.prevAccepted()
    return prev ?? walker.lastAccepted()
  }

  private focusPrev() {
    const prev = this.findPrevFocusable()
    if (!prev) return
    this.renderer.focusedRenderable?.blur()
    this.renderer.focusedRenderable = prev
    this.renderer.focusedRenderable.focus()
  }
}
