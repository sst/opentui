import type { StyleDefinition, ThemeTokenStyle } from "./lib/syntax-style"
import { RGBA } from "./lib/RGBA"
import { resolveRenderLib, type RenderLib } from "./zig"
import { type Pointer } from "bun:ffi"
import { createTextAttributes } from "./utils"
import { convertThemeToStyles } from "./lib/syntax-style"

export class NativeSyntaxStyle {
  private lib: RenderLib
  private stylePtr: Pointer
  private _destroyed: boolean = false
  private nameCache: Map<string, number> = new Map()

  constructor(lib: RenderLib, ptr: Pointer) {
    this.lib = lib
    this.stylePtr = ptr
  }

  static create(): NativeSyntaxStyle {
    const lib = resolveRenderLib()
    const ptr = lib.createSyntaxStyle()
    return new NativeSyntaxStyle(lib, ptr)
  }

  static fromTheme(theme: ThemeTokenStyle[]): NativeSyntaxStyle {
    const style = NativeSyntaxStyle.create()
    const flatStyles = convertThemeToStyles(theme)

    for (const [name, styleDef] of Object.entries(flatStyles)) {
      style.registerStyle(name, styleDef)
    }

    return style
  }

  static fromStyles(styles: Record<string, StyleDefinition>): NativeSyntaxStyle {
    const style = NativeSyntaxStyle.create()

    for (const [name, styleDef] of Object.entries(styles)) {
      style.registerStyle(name, styleDef)
    }

    return style
  }

  private guard(): void {
    if (this._destroyed) throw new Error("NativeSyntaxStyle is destroyed")
  }

  public registerStyle(name: string, style: StyleDefinition): number {
    this.guard()

    const attributes = createTextAttributes({
      bold: style.bold,
      italic: style.italic,
      underline: style.underline,
      dim: style.dim,
    })

    const id = this.lib.syntaxStyleRegister(this.stylePtr, name, style.fg || null, style.bg || null, attributes)

    this.nameCache.set(name, id)

    return id
  }

  public resolveStyleId(name: string): number | null {
    this.guard()

    // Check cache first
    const cached = this.nameCache.get(name)
    if (cached !== undefined) return cached

    const id = this.lib.syntaxStyleResolveByName(this.stylePtr, name)

    if (id !== null) {
      this.nameCache.set(name, id)
    }

    return id
  }

  public getStyleId(name: string): number | null {
    this.guard()

    const id = this.resolveStyleId(name)
    if (id !== null) return id

    // Try base name if it's a scoped style
    if (name.includes(".")) {
      const baseName = name.split(".")[0]
      return this.resolveStyleId(baseName)
    }

    return null
  }

  public get ptr(): Pointer {
    this.guard()
    return this.stylePtr
  }

  public getStyleCount(): number {
    this.guard()
    return this.lib.syntaxStyleGetStyleCount(this.stylePtr)
  }

  public clearNameCache(): void {
    this.nameCache.clear()
  }

  public destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.nameCache.clear()
    this.lib.destroySyntaxStyle(this.stylePtr)
  }
}
