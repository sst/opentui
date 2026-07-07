import {
  OptimizedBuffer,
  Renderable,
  RGBA,
  parseColor,
  type ColorInput,
  type KeyEvent,
  type RenderableOptions,
  type RenderContext,
  type InternalKeyBinding as BaseKeyBinding,
  mergeKeyBindings,
  buildKeyBindingsMap,
  getKeyBindingAction,
  defaultKeyAliases,
  mergeKeyAliases,
} from "@opentui/core"

type KeyAliasMap = Record<string, string>

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

export type RadioButtonAction = "select" | "move-up" | "move-down"
export type RadioButtonKeyBinding = BaseKeyBinding<RadioButtonAction>

const defaultRadioKeyBindings: RadioButtonKeyBinding[] = [
  { name: "up", action: "move-up" },
  { name: "down", action: "move-down" },
  { name: "return", action: "select" },
  { name: "linefeed", action: "select" },
  { name: "space", action: "select" },
]

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

  keyBindings?: RadioButtonKeyBinding[]
  keyAliasMap?: KeyAliasMap
}

export enum RadioButtonRenderableEvents {
  CHANGED = "changed",
  SELECTED = "selected",
}

export class RadioButtonRenderable extends Renderable {
  protected override _focusable: boolean = true

  private static readonly _groups = new Map<string, Set<RadioButtonRenderable>>()

  static getSelected(group: string): RadioButtonRenderable | null {
    for (const btn of RadioButtonRenderable._groups.get(group) ?? []) {
      if (btn.checked) return btn
    }
    return null
  }

  static getSelectedValue(group: string): any {
    return RadioButtonRenderable.getSelected(group)?.value ?? null
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

  private _keyBindingsMap: Map<string, RadioButtonAction>
  private _keyAliasMap: KeyAliasMap
  private _keyBindings: RadioButtonKeyBinding[]

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
    this._group = options.group

    this._backgroundColor = parseColor(options.backgroundColor ?? this._defaultOptions.backgroundColor)
    this._textColor = parseColor(options.textColor ?? this._defaultOptions.textColor)
    this._focusedBackgroundColor = parseColor(
      options.focusedBackgroundColor ?? this._defaultOptions.focusedBackgroundColor,
    )
    this._focusedTextColor = parseColor(options.focusedTextColor ?? this._defaultOptions.focusedTextColor)
    this._checkedTextColor = parseColor(options.checkedTextColor ?? this._defaultOptions.checkedTextColor)
    this._focusIndicatorColor = parseColor(options.focusIndicatorColor ?? this._defaultOptions.focusIndicatorColor)

    this._keyAliasMap = mergeKeyAliases(defaultKeyAliases, options.keyAliasMap ?? {})
    this._keyBindings = options.keyBindings ?? []
    const mergeBindings = mergeKeyBindings(defaultRadioKeyBindings, this._keyBindings)
    this._keyBindingsMap = buildKeyBindingsMap(mergeBindings, this._keyAliasMap)

    if (this._group) {
      if (!RadioButtonRenderable._groups.has(this._group)) {
        RadioButtonRenderable._groups.set(this._group, new Set())
      }
      RadioButtonRenderable._groups.get(this._group)!.add(this)
    }

    this.requestRender()
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
    const action = getKeyBindingAction(this._keyBindingsMap, key)
    switch (action) {
      case "move-up":
        this.moveUp()
        return true
      case "move-down":
        this.moveDown()
        return true
      case "select":
        this.select()
        return true
    }

    return false
  }

  public select(): void {
    if (this._group) {
      for (const sibling of RadioButtonRenderable._groups.get(this._group) ?? []) {
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
    const siblings = Array.from(RadioButtonRenderable._groups.get(this._group) ?? [])
    const idx = siblings.indexOf(this)
    const target = siblings[idx - 1]
    if (idx > 0 && target) this._moveTo(target)
  }

  public moveDown(): void {
    if (!this._group) return
    const siblings = Array.from(RadioButtonRenderable._groups.get(this._group) ?? [])
    const idx = siblings.indexOf(this)
    const target = siblings[idx + 1]
    if (idx >= 0 && idx < siblings.length - 1 && target) this._moveTo(target)
  }

  public override destroy(): void {
    if (this._group) {
      RadioButtonRenderable._groups.get(this._group)?.delete(this)
      if (RadioButtonRenderable._groups.get(this._group)?.size === 0) {
        RadioButtonRenderable._groups.delete(this._group)
      }
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
