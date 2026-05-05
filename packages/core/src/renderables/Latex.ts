import { renderLatexToStyledText, type LatexStrictMode } from "./latex-renderer.js"
import { type ColorInput } from "../lib/RGBA.js"
import { type RenderContext } from "../types.js"
import { type TextChunk } from "../text-buffer.js"
import { StyledText } from "../lib/styled-text.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"

export interface LatexOptions extends TextBufferOptions {
  content?: string
  displayMode?: boolean
  macros?: Record<string, string>
  throwOnError?: boolean
  errorFg?: ColorInput
  strict?: LatexStrictMode
  maxSize?: number
  maxExpand?: number
}

export class LatexRenderable extends TextBufferRenderable {
  private _content: string
  private _displayMode: boolean
  private _macros?: Record<string, string>
  private _throwOnError: boolean
  private _errorFg: ColorInput
  private _strict?: LatexStrictMode
  private _maxSize?: number
  private _maxExpand?: number
  private _text: StyledText

  protected _contentDefaultOptions = {
    content: "",
    displayMode: true,
    throwOnError: false,
    errorFg: "red",
    wrapMode: "none" as const,
  } satisfies Partial<LatexOptions>

  constructor(ctx: RenderContext, options: LatexOptions) {
    super(ctx, {
      ...options,
      wrapMode: options.wrapMode ?? "none",
    })

    this._content = options.content ?? this._contentDefaultOptions.content
    this._displayMode = options.displayMode ?? this._contentDefaultOptions.displayMode
    this._macros = options.macros
    this._throwOnError = options.throwOnError ?? this._contentDefaultOptions.throwOnError
    this._errorFg = options.errorFg ?? this._contentDefaultOptions.errorFg
    this._strict = options.strict
    this._maxSize = options.maxSize
    this._maxExpand = options.maxExpand
    this._text = this.renderContent()
    this.updateTextBuffer()
  }

  private renderContent(): StyledText {
    return renderLatexToStyledText(this._content, {
      displayMode: this._displayMode,
      macros: this._macros,
      throwOnError: this._throwOnError,
      errorFg: this._errorFg,
      strict: this._strict,
      maxSize: this._maxSize,
      maxExpand: this._maxExpand,
    })
  }

  private rerenderContent(): void {
    this._text = this.renderContent()
    this.updateTextBuffer()
    this.updateTextInfo()
  }

  private updateTextBuffer(): void {
    this.textBuffer.setStyledText(this._text)
    this.refreshLocalSelection()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content !== value) {
      this._content = value
      this.rerenderContent()
    }
  }

  get chunks(): TextChunk[] {
    return this._text.chunks
  }

  get displayMode(): boolean {
    return this._displayMode
  }

  set displayMode(value: boolean) {
    if (this._displayMode !== value) {
      this._displayMode = value
      this.rerenderContent()
    }
  }

  get macros(): Record<string, string> | undefined {
    return this._macros
  }

  set macros(value: Record<string, string> | undefined) {
    if (this._macros !== value) {
      this._macros = value
      this.rerenderContent()
    }
  }

  get throwOnError(): boolean {
    return this._throwOnError
  }

  set throwOnError(value: boolean) {
    if (this._throwOnError !== value) {
      this._throwOnError = value
      this.rerenderContent()
    }
  }

  get errorFg(): ColorInput {
    return this._errorFg
  }

  set errorFg(value: ColorInput) {
    if (this._errorFg !== value) {
      this._errorFg = value
      this.rerenderContent()
    }
  }

  get strict(): LatexStrictMode | undefined {
    return this._strict
  }

  set strict(value: LatexStrictMode | undefined) {
    if (this._strict !== value) {
      this._strict = value
      this.rerenderContent()
    }
  }

  get maxSize(): number | undefined {
    return this._maxSize
  }

  set maxSize(value: number | undefined) {
    if (this._maxSize !== value) {
      this._maxSize = value
      this.rerenderContent()
    }
  }

  get maxExpand(): number | undefined {
    return this._maxExpand
  }

  set maxExpand(value: number | undefined) {
    if (this._maxExpand !== value) {
      this._maxExpand = value
      this.rerenderContent()
    }
  }
}
