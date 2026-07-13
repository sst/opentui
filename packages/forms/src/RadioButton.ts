import {
  OptimizedBuffer,
  Renderable,
  RGBA,
  parseColor,
  type ColorInput,
  type KeyEvent,
  type RenderableOptions,
  type RenderContext,
} from "@opentui/core"

export type RadioButtonDefaultDesigns = "classic" | "filled" | "minimal" | "paren" | "arrow"

export type RadioButtonDesign = RadioButtonDefaultDesigns | [string, string]

const BUILTIN_INDICATORS: Record<RadioButtonDefaultDesigns, [string, string]> = {
  classic: ["○", "◉"],
  paren: ["( )", "(●)"],
  filled: ["[ ]", "[●]"],
  minimal: ["·", "•"],
  arrow: ["▷", "▶"],
}


function resolveIndicators(design: RadioButtonDesign): [string, string] {
  return Array.isArray(design) ? design : BUILTIN_INDICATORS[design]
}

export interface RadioButtonRenderableOptions extends RenderableOptions<RadioButtonRenderable> {
  label?: string
  checked?: boolean
  value?: any
  design?: RadioButtonDesign
  group?: string

  backgroundColor?: ColorInput
  textColor?: ColorInput
  focusedBackgroundColor?: ColorInput
  focusedTextColor?: ColorInput
  checkedTextColor?: ColorInput
  focusIndicatorColor?: ColorInput
}

export enum RadioButtonRenderableEvents {
  CHANGED = "changed",
  SELECTED = "selected",
}

export class RadioButtonRenderable extends Renderable {
  protected override _focusable: boolean = true

  // Group registries are stored in a WeakMap keyed by RenderContext to keep them mutually exclusive.
  private static readonly _registries = new WeakMap<RenderContext, Map<string, Set<RadioButtonRenderable>>>()

  private static getRegistry(ctx: RenderContext): Map<string, Set<RadioButtonRenderable>> {
    let registry = RadioButtonRenderable._registries.get(ctx)
    if (!registry) {
      registry = new Map()
      RadioButtonRenderable._registries.set(ctx, registry)
    }
    return registry
  }

  private static getMembersFromRegistry(ctx: RenderContext, group: string): Set<RadioButtonRenderable> {
    const registry = RadioButtonRenderable.getRegistry(ctx)
    let members = registry.get(group)
    if (!members) {
      members = new Set()
      registry.set(group, members)
    }
    return members
  }

  static getSelected(ctx: RenderContext, group: string): RadioButtonRenderable | null {
    for (const btn of RadioButtonRenderable._registries.get(ctx)?.get(group) ?? []) {
      if (btn.checked) return btn
    }
    return null
  }

  static getSelectedValue(ctx: RenderContext, group: string): any {
    return RadioButtonRenderable.getSelected(ctx, group)?.value ?? null
  }

  private _label: string
  private _checked: boolean
  private _value: any
  private _design: RadioButtonDesign
  private _group: string | undefined

  private _backgroundColor: RGBA
  private _textColor: RGBA
  private _focusedBackgroundColor: RGBA
  private _focusedTextColor: RGBA
  private _checkedTextColor: RGBA
  private _focusIndicatorColor: RGBA

  protected _defaultOptions = {
    label: "",
    checked: false,
    design: "classic" as RadioButtonDesign,
    backgroundColor: "transparent",
    textColor: "#CCCCCC",
    focusedBackgroundColor: "#1a1a2e",
    focusedTextColor: "#FFFFFF",
    checkedTextColor: "#7EB8F7",
    focusIndicatorColor: "#F7C948",
  } satisfies Partial<RadioButtonRenderableOptions>

  constructor(ctx: RenderContext, options: RadioButtonRenderableOptions) {
    super(ctx, { ...options, buffered: true })

    this._label = options.label ?? this._defaultOptions.label
    this._checked = options.checked ?? this._defaultOptions.checked
    this._value = options.value
    this._design = options.design ?? this._defaultOptions.design
    this._group = undefined

    this._backgroundColor = parseColor(options.backgroundColor ?? this._defaultOptions.backgroundColor)
    this._textColor = parseColor(options.textColor ?? this._defaultOptions.textColor)
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor ?? this._defaultOptions.focusedBackgroundColor,
    )
    this._focusedTextColor = parseColor(options.focusedTextColor ?? this._defaultOptions.focusedTextColor)
    this._checkedTextColor = parseColor(options.checkedTextColor ?? this._defaultOptions.checkedTextColor)
    this._focusIndicatorColor = parseColor(options.focusIndicatorColor ?? this._defaultOptions.focusIndicatorColor)

    if (options.group) {
      this._joinGroupInitial(options.group)
    }

    this.requestRender()
  }

  // Adds this button to the specified group during construction
  // clearing any existing selection in that group if this button is checked.
  private _joinGroupInitial(group: string): void {
    const members = RadioButtonRenderable.getMembersFromRegistry(this.ctx, group)
    if (this._checked) {
      for (const sibling of members) {
        if (sibling._checked) {
          sibling._checked = false
          sibling.requestRender()
        }
      }
    }
    this._group = group
    members.add(this)
  }

  protected override renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {
    if (!this.visible || !this.frameBuffer) return
    if (this.isDirty) this.refreshFrameBuffer()
  }

  private refreshFrameBuffer(): void {
    if (!this.frameBuffer) return

    const bgColor = this._focused ? this._focusedBackgroundColor : this._backgroundColor
    this.frameBuffer.clear(bgColor)

    const [unchecked, checked] = resolveIndicators(this._design)
    const indicator = this._checked ? checked : unchecked
    const baseTextColor = this._focused ? this._focusedTextColor : this._textColor
    const indicatorColor = this._checked ? this._checkedTextColor : baseTextColor

    let x = 0
    if (this._focused) {
      this.frameBuffer.drawText(">", x, 0, this._focusIndicatorColor)
    }
    x += 2

    this.frameBuffer.drawText(indicator, x, 0, indicatorColor)
    x += [...indicator].length + 1

    if (this._label) this.frameBuffer.drawText(this._label, x, 0, baseTextColor)
  }

  private _moveTo(target: RadioButtonRenderable): void {
    this.blur()
    target.select()
    target.focus()
  }

  public override handleKeyPress(key: KeyEvent): boolean {
    switch (key.name) {
      case "up":
        this.moveUp()
        return true
      case "down":
        this.moveDown()
        return true
      case "space":
        this.select()
        return true
    }

    return false
  }

  public select(): void {
    if (this._group) {
      for (const sibling of RadioButtonRenderable.getMembersFromRegistry(this.ctx, this._group)) {
        if (sibling !== this) sibling.deselect()
      }
    }
    if (!this._checked) {
      this._checked = true
      this.requestRender()
      this.emit(RadioButtonRenderableEvents.CHANGED, true, this._value)
    }
    this.emit(RadioButtonRenderableEvents.SELECTED, this._value)
  }

  public deselect(): void {
    if (this._checked) {
      this._checked = false
      this.requestRender()
      this.emit(RadioButtonRenderableEvents.CHANGED, false, this._value)
    }
  }

  public moveUp(): void {
    if (!this._group) return
    const siblings = Array.from(RadioButtonRenderable.getMembersFromRegistry(this.ctx, this._group))
    const idx = siblings.indexOf(this)
    const target = siblings[idx - 1]
    if (idx > 0 && target) this._moveTo(target)
  }

  public moveDown(): void {
    if (!this._group) return
    const siblings = Array.from(RadioButtonRenderable.getMembersFromRegistry(this.ctx, this._group))
    const idx = siblings.indexOf(this)
    const target = siblings[idx + 1]
    if (idx >= 0 && idx < siblings.length - 1 && target) this._moveTo(target)
  }

  public override destroy(): void {
    if (this._group) {
      const registry = RadioButtonRenderable._registries.get(this.ctx)
      const members = registry?.get(this._group)
      members?.delete(this)
      if (members && members.size === 0) registry!.delete(this._group)
    }
    super.destroy()
  }

  public get checked(): boolean {
    return this._checked
  }

  public set checked(value: boolean) {
    if (value) {
      this.select()
    } else {
      this.deselect()
    }
  }

  public get value(): any {
    return this._value
  }

  public set value(value: any) {
    this._value = value
  }

  public get label(): string {
    return this._label
  }

  public set label(label: string) {
    this._label = label
    this.requestRender()
  }

  public get design(): RadioButtonDesign {
    return this._design
  }

  public set design(design: RadioButtonDesign) {
    this._design = design
    this.requestRender()
  }

  public get group(): string | undefined {
    return this._group
  }

  // Atomically moves a button from one group to another.
  // Clears all selection in the destination group & keeps the current button selected.
  public set group(next: string | undefined) {
    if (next === this._group) return

    if (this._group) {
      const registry = RadioButtonRenderable._registries.get(this.ctx)
      const members = registry?.get(this._group)
      members?.delete(this)
      if (members && members.size === 0) registry!.delete(this._group)
    }

    this._group = next

    if (next) {
      const members = RadioButtonRenderable.getMembersFromRegistry(this.ctx, next)
      if (this._checked) {
        for (const sibling of members) sibling.deselect()
      }
      members.add(this)
    }
  }

  public set backgroundColor(value: ColorInput) {
    const c = parseColor(value ?? this._defaultOptions.backgroundColor)
    if (this._backgroundColor !== c) {
      this._backgroundColor = c
      this.requestRender()
    }
  }

  public set textColor(value: ColorInput) {
    const c = parseColor(value ?? this._defaultOptions.textColor)
    if (this._textColor !== c) {
      this._textColor = c
      this.requestRender()
    }
  }

  public set focusedBackgroundColor(value: ColorInput) {
    const c = parseColor(value ?? this._defaultOptions.focusedBackgroundColor)
    if (this._focusedBackgroundColor !== c) {
      this._focusedBackgroundColor = c
      this.requestRender()
    }
  }

  public set focusedTextColor(value: ColorInput) {
    const c = parseColor(value ?? this._defaultOptions.focusedTextColor)
    if (this._focusedTextColor !== c) {
      this._focusedTextColor = c
      this.requestRender()
    }
  }

  public set checkedTextColor(value: ColorInput) {
    const c = parseColor(value ?? this._defaultOptions.checkedTextColor)
    if (this._checkedTextColor !== c) {
      this._checkedTextColor = c
      this.requestRender()
    }
  }
}
