import { type RenderContext } from "../types"
import { StyledText } from "../lib/styled-text"
import { SyntaxStyle } from "../lib/syntax-style"
import { getTreeSitterClient, treeSitterToStyledText, TreeSitterClient } from "../lib/tree-sitter"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable"

export interface CodeOptions extends TextBufferOptions {
  content?: string
  filetype?: string
  syntaxStyle: SyntaxStyle
  treeSitterClient?: TreeSitterClient
}

export class CodeRenderable extends TextBufferRenderable {
  private _content: string
  private _filetype?: string
  private _syntaxStyle: SyntaxStyle
  private _isHighlighting: boolean = false
  private _treeSitterClient: TreeSitterClient
  private _pendingRehighlight: boolean = false

  protected _contentDefaultOptions = {
    content: "",
  } satisfies Partial<CodeOptions>

  constructor(ctx: RenderContext, options: CodeOptions) {
    super(ctx, options)

    this._content = options.content ?? this._contentDefaultOptions.content
    this._filetype = options.filetype
    this._syntaxStyle = options.syntaxStyle
    this._treeSitterClient = options.treeSitterClient ?? getTreeSitterClient()

    this.updateContent(this._content)
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content !== value) {
      this._content = value
      this.updateContent(value)
    }
  }

  get filetype(): string | undefined {
    return this._filetype
  }

  set filetype(value: string) {
    if (this._filetype !== value) {
      this._filetype = value
      this.updateContent(this._content)
    }
  }

  get syntaxStyle(): SyntaxStyle {
    return this._syntaxStyle
  }

  set syntaxStyle(value: SyntaxStyle) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      this.updateContent(this._content)
    }
  }

  private async updateContent(content: string): Promise<void> {
    if (content.length === 0) return
    if (this._isHighlighting) {
      this._pendingRehighlight = true
      return
    }

    if (!this._filetype) {
      this.fallback(content)
      return
    }

    this.fallback(content)

    this._isHighlighting = true

    try {
      const styledText = await treeSitterToStyledText(
        content,
        this._filetype,
        this._syntaxStyle,
        this._treeSitterClient,
      )
      if (this.isDestroyed) return
      this.textBuffer.setStyledText(styledText)
      this.updateTextInfo()
    } catch (error) {
      console.warn("Code highlighting failed, falling back to plain text:", error)
      this.fallback(content)
    } finally {
      this._isHighlighting = false

      if (this._pendingRehighlight) {
        this._pendingRehighlight = false
        process.nextTick(() => this.updateContent(this._content))
      }
    }
  }

  private fallback(content: string): void {
    const fallbackStyledText = this.createFallbackStyledText(content)
    if (this.isDestroyed) return
    this.textBuffer.setStyledText(fallbackStyledText)
    this.updateTextInfo()
  }

  private createFallbackStyledText(content: string): StyledText {
    const chunks = [
      {
        __isChunk: true as const,
        text: content,
        fg: this._defaultFg,
        bg: this._defaultBg,
        attributes: this._defaultAttributes,
      },
    ]
    return new StyledText(chunks)
  }
}
