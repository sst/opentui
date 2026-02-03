import { Renderable, type RenderableOptions } from "../Renderable"
import { BoxRenderable } from "./Box"
import { CodeRenderable, type CodeOptions } from "./Code"
import { TextRenderable } from "./Text"
import type { RenderContext } from "../types"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA"
import type { MouseEvent as OtuiMouseEvent } from "../renderer"
import type { SyntaxStyle } from "../syntax-style"

export interface DiffLineClickInfo {
  visualLineIndex: number
  logicalLineNumber?: number
  side: "left" | "right" | "unified"
  type: "add" | "remove" | "context" | "empty"
  content: string
}

export interface DiffLineRenderableOptions extends RenderableOptions<DiffLineRenderable> {
  content: string
  lineNumber?: number
  type: "add" | "remove" | "context" | "empty"
  side: "left" | "right" | "unified"
  showLineNumber?: boolean
  lineBg?: ColorInput
  lineFg?: ColorInput
  signText?: string
  signColor?: ColorInput
  gutterBg?: ColorInput
  gutterFg?: ColorInput
  gutterWidth?: number
  visualLineIndex?: number
  onClick?: (info: DiffLineClickInfo) => void
  filetype?: string
  syntaxStyle?: SyntaxStyle
}

export class DiffLineRenderable extends Renderable {
  private _content: string
  private _lineNumber?: number
  private _type: "add" | "remove" | "context" | "empty"
  private _side: "left" | "right" | "unified"
  private _showLineNumber: boolean
  private _lineBg: RGBA
  private _lineFg: RGBA
  private _signText?: string
  private _signColor?: RGBA
  private _gutterBg: RGBA
  private _gutterFg: RGBA
  private _gutterWidth: number
  private _visualLineIndex: number
  private _onClick?: (info: DiffLineClickInfo) => void
  private _filetype?: string
  private _syntaxStyle?: SyntaxStyle

  // Child components
  private _gutterBox?: BoxRenderable
  private _gutterText?: TextRenderable
  private _signBox?: BoxRenderable
  private _signTextRenderable?: TextRenderable
  private _contentCode?: CodeRenderable
  private _contentBox?: BoxRenderable

  constructor(ctx: RenderContext, options: DiffLineRenderableOptions) {
    super(ctx, {
      ...options,
      flexDirection: "row",
      height: 1,
      width: options.width ?? "100%",
    })

    this._content = options.content
    this._lineNumber = options.lineNumber
    this._type = options.type
    this._side = options.side
    this._showLineNumber = options.showLineNumber ?? true
    this._lineBg = parseColor(options.lineBg ?? "transparent")
    this._lineFg = parseColor(options.lineFg ?? "#e6edf3")
    this._signText = options.signText
    this._signColor = options.signColor ? parseColor(options.signColor) : undefined
    this._gutterBg = parseColor(options.gutterBg ?? "#161b22")
    this._gutterFg = parseColor(options.gutterFg ?? "#6b7280")
    this._gutterWidth = options.gutterWidth ?? 5
    this._visualLineIndex = options.visualLineIndex ?? 0
    this._onClick = options.onClick
    this._filetype = options.filetype
    this._syntaxStyle = options.syntaxStyle
    this.onMouseUp = this.handleMouseUp.bind(this)

    // Build child components
    this.buildChildren()
  }

  private buildChildren(): void {
    this.clearChildren()

    // Gutter (line number area)
    if (this._showLineNumber && this._gutterWidth > 0) {
      this._gutterBox = new BoxRenderable(this.ctx, {
        id: `${this.id}-gutter`,
        width: this._gutterWidth,
        height: 1,
        backgroundColor: this._gutterBg,
        justifyContent: "flex-end",
        paddingRight: 1,
      })

      const lineNumStr = this._lineNumber !== undefined && this._type !== "empty" ? this._lineNumber.toString() : ""

      this._gutterText = new TextRenderable(this.ctx, {
        id: `${this.id}-gutter-text`,
        content: lineNumStr,
        fg: this._gutterFg,
      })

      this._gutterBox.add(this._gutterText)
      this.add(this._gutterBox)
    }

    // Sign (+/-)
    if (this._signText) {
      this._signBox = new BoxRenderable(this.ctx, {
        id: `${this.id}-sign`,
        width: 1,
        height: 1,
        backgroundColor: this._lineBg,
      })

      this._signTextRenderable = new TextRenderable(this.ctx, {
        id: `${this.id}-sign-text`,
        content: this._signText,
        fg: this._signColor ?? this._lineFg,
      })

      this._signBox.add(this._signTextRenderable)
      this.add(this._signBox)
    }

    // Content area - use CodeRenderable for syntax highlighting if filetype is provided
    if (this._filetype && this._syntaxStyle && this._content.length > 0) {
      const codeOptions: CodeOptions = {
        id: `${this.id}-content`,
        content: this._content,
        filetype: this._filetype,
        syntaxStyle: this._syntaxStyle,
        bg: this._lineBg,
        fg: this._lineFg,
        flexGrow: 1,
        height: 1,
        wrapMode: "none",
        truncate: true,
        drawUnstyledText: true,
      }

      this._contentCode = new CodeRenderable(this.ctx, codeOptions)
      this._contentBox = new BoxRenderable(this.ctx, {
        id: `${this.id}-content-box`,
        flexGrow: 1,
        height: 1,
        backgroundColor: this._lineBg,
      })
      this._contentBox.add(this._contentCode)
      this.add(this._contentBox)
    } else {
      // Plain text fallback
      this._contentBox = new BoxRenderable(this.ctx, {
        id: `${this.id}-content`,
        flexGrow: 1,
        height: 1,
        backgroundColor: this._lineBg,
      })

      const contentText = new TextRenderable(this.ctx, {
        id: `${this.id}-content-text`,
        content: this._content,
        fg: this._lineFg,
      })

      this._contentBox.add(contentText)
      this.add(this._contentBox)
    }
  }

  private clearChildren(): void {
    if (this._gutterBox) {
      this.remove(this._gutterBox.id)
      this._gutterBox.destroy()
      this._gutterBox = undefined
      this._gutterText = undefined
    }
    if (this._signBox) {
      this.remove(this._signBox.id)
      this._signBox.destroy()
      this._signBox = undefined
      this._signTextRenderable = undefined
    }
    if (this._contentCode) {
      this.remove(this._contentCode.id)
      this._contentCode.destroy()
      this._contentCode = undefined
    }
    if (this._contentBox) {
      this.remove(this._contentBox.id)
      this._contentBox.destroy()
      this._contentBox = undefined
    }
  }

  private handleMouseUp(event: OtuiMouseEvent): void {
    if (event.button === 0 && this._onClick) {
      const info: DiffLineClickInfo = {
        visualLineIndex: this._visualLineIndex,
        logicalLineNumber: this._lineNumber,
        side: this._side,
        type: this._type,
        content: this._content,
      }
      this._onClick(info)
      event.stopPropagation()
    }
  }

  // Getters and setters for reactive properties

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content !== value) {
      this._content = value
      this.buildChildren()
      this.requestRender()
    }
  }

  get lineNumber(): number | undefined {
    return this._lineNumber
  }

  set lineNumber(value: number | undefined) {
    if (this._lineNumber !== value) {
      this._lineNumber = value
      if (this._gutterText) {
        this._gutterText.content = value !== undefined ? value.toString() : ""
      }
      this.requestRender()
    }
  }

  get type(): "add" | "remove" | "context" | "empty" {
    return this._type
  }

  set type(value: "add" | "remove" | "context" | "empty") {
    if (this._type !== value) {
      this._type = value
      this.buildChildren()
      this.requestRender()
    }
  }

  get side(): "left" | "right" | "unified" {
    return this._side
  }

  set side(value: "left" | "right" | "unified") {
    if (this._side !== value) {
      this._side = value
      this.requestRender()
    }
  }

  get showLineNumber(): boolean {
    return this._showLineNumber
  }

  set showLineNumber(value: boolean) {
    if (this._showLineNumber !== value) {
      this._showLineNumber = value
      this.buildChildren()
      this.requestRender()
    }
  }

  get lineBg(): RGBA {
    return this._lineBg
  }

  set lineBg(value: ColorInput) {
    const parsed = parseColor(value)
    if (!this._lineBg.equals(parsed)) {
      this._lineBg = parsed
      // Update child backgrounds
      if (this._signBox) this._signBox.backgroundColor = parsed
      if (this._contentCode) this._contentCode.bg = parsed
      if (this._contentBox) this._contentBox.backgroundColor = parsed
      this.requestRender()
    }
  }

  get lineFg(): RGBA {
    return this._lineFg
  }

  set lineFg(value: ColorInput) {
    const parsed = parseColor(value)
    if (!this._lineFg.equals(parsed)) {
      this._lineFg = parsed
      if (this._contentCode) this._contentCode.fg = parsed
      this.requestRender()
    }
  }

  get signText(): string | undefined {
    return this._signText
  }

  set signText(value: string | undefined) {
    if (this._signText !== value) {
      this._signText = value
      this.buildChildren()
      this.requestRender()
    }
  }

  get signColor(): RGBA | undefined {
    return this._signColor
  }

  set signColor(value: ColorInput | undefined) {
    const parsed = value ? parseColor(value) : undefined
    if (
      (this._signColor === undefined && parsed !== undefined) ||
      (this._signColor !== undefined && parsed === undefined) ||
      (this._signColor && parsed && !this._signColor.equals(parsed))
    ) {
      this._signColor = parsed
      if (this._signTextRenderable && parsed) {
        this._signTextRenderable.fg = parsed
      }
      this.requestRender()
    }
  }

  get gutterBg(): RGBA {
    return this._gutterBg
  }

  set gutterBg(value: ColorInput) {
    const parsed = parseColor(value)
    if (!this._gutterBg.equals(parsed)) {
      this._gutterBg = parsed
      if (this._gutterBox) this._gutterBox.backgroundColor = parsed
      this.requestRender()
    }
  }

  get gutterFg(): RGBA {
    return this._gutterFg
  }

  set gutterFg(value: ColorInput) {
    const parsed = parseColor(value)
    if (!this._gutterFg.equals(parsed)) {
      this._gutterFg = parsed
      if (this._gutterText) this._gutterText.fg = parsed
      this.requestRender()
    }
  }

  get gutterWidth(): number {
    return this._gutterWidth
  }

  set gutterWidth(value: number) {
    if (this._gutterWidth !== value) {
      this._gutterWidth = value
      this.buildChildren()
      this.requestRender()
    }
  }

  get visualLineIndex(): number {
    return this._visualLineIndex
  }

  set visualLineIndex(value: number) {
    this._visualLineIndex = value
  }

  get onClick(): ((info: DiffLineClickInfo) => void) | undefined {
    return this._onClick
  }

  set onClick(value: ((info: DiffLineClickInfo) => void) | undefined) {
    this._onClick = value
  }

  get filetype(): string | undefined {
    return this._filetype
  }

  set filetype(value: string | undefined) {
    if (this._filetype !== value) {
      this._filetype = value
      this.buildChildren()
      this.requestRender()
    }
  }

  get syntaxStyle(): SyntaxStyle | undefined {
    return this._syntaxStyle
  }

  set syntaxStyle(value: SyntaxStyle | undefined) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      if (this._contentCode && value) {
        this._contentCode.syntaxStyle = value
      }
      this.requestRender()
    }
  }

  public override destroy(): void {
    this.clearChildren()
    super.destroy()
  }
}
