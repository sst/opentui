import { getKeyHandler } from "./KeyHandler"
import type { Renderable } from "../Renderable"
import type { ParsedKey } from "./parse.keypress"
import type { CliRenderer } from "../renderer"

export type FocusKeyHandler = (key: ParsedKey, focusNext: () => void, focusPrev: () => void) => void

interface FocusManagerConfig {
  onKey?: FocusKeyHandler
}

export class FocusManager {
  private static instance: FocusManager | null = null

  private keyUnsubscribe: (() => void) | null = null
  private readonly renderer: CliRenderer
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
    this.onKey = config?.onKey
  }

  private getFocusables(): Renderable[] {
    console.log(
      "Focusables:",
      this.renderer.focusables.map((callback) => callback.id),
    )

    return this.renderer.focusables
  }

  private isVisible(r: Renderable): boolean {
    return r["visible"] === true
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
    this.renderer.focusedRenderable = null
  }

  private initFocus(): void {
    const first = this.getFocusables().find((r) => this.isVisible(r))
    if (first) {
      this.renderer.focusedRenderable = first
      first.focus()
    }
  }

  private findNextFocusable(): Renderable | null {
    const focusables = this.getFocusables()
    if (!this.renderer.focusedRenderable) return focusables.find((r) => this.isVisible(r)) ?? null

    const startIndex = focusables.indexOf(this.renderer.focusedRenderable) + 1
    for (let i = startIndex; i < focusables.length; i++) {
      if (this.isVisible(focusables[i])) return focusables[i]
    }
    return focusables.find((r) => this.isVisible(r)) ?? null
  }

  private focusNext(): void {
    const next = this.findNextFocusable()
    if (!next) return
    this.renderer.focusedRenderable?.blur()
    this.renderer.focusedRenderable = next
    next.focus()
  }

  private findPrevFocusable(): Renderable | null {
    const focusables = this.getFocusables()
    if (!this.renderer.focusedRenderable) return [...focusables].reverse().find((r) => this.isVisible(r)) ?? null

    const startIndex = focusables.indexOf(this.renderer.focusedRenderable) - 1
    for (let i = startIndex; i >= 0; i--) {
      if (this.isVisible(focusables[i])) return focusables[i]
    }
    return [...focusables].reverse().find((r) => this.isVisible(r)) ?? null
  }

  private focusPrev(): void {
    const prev = this.findPrevFocusable()
    if (!prev) return
    this.renderer.focusedRenderable?.blur()
    this.renderer.focusedRenderable = prev
    prev.focus()
  }
}
