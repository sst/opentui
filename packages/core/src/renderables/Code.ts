import { type RenderContext } from "../types"
import { StyledText } from "../lib/styled-text"
import { SyntaxStyle } from "../lib/syntax-style"
import { getTreeSitterClient, treeSitterToStyledText, TreeSitterClient } from "../lib/tree-sitter"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable"

export interface CodeOptions extends TextBufferOptions {
  content?: string
  filetype: string
  syntaxStyle: SyntaxStyle
  treeSitterClient?: TreeSitterClient
}

export class CodeRenderable extends TextBufferRenderable {
  private _content: string
  private _filetype: string
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

  get filetype(): string {
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
    if (this._isHighlighting) {
      this._pendingRehighlight = true
      return
    }

    this._isHighlighting = true

    try {
      const styledText = await treeSitterToStyledText(
        content,
        this._filetype,
        this._syntaxStyle,
        this._treeSitterClient,
      )
      this.textBuffer.setStyledText(styledText)
      this.updateTextInfo()
    } catch (error) {
      // Fallback to unstyled text if highlighting fails
      console.warn("Code highlighting failed, falling back to plain text:", error)
      const fallbackStyledText = this.createFallbackStyledText(content)
      this.textBuffer.setStyledText(fallbackStyledText)
      this.updateTextInfo()
    } finally {
      this._isHighlighting = false

      if (this._pendingRehighlight) {
        this._pendingRehighlight = false
        process.nextTick(() => this.updateContent(this._content))
      }
    }
  }

  private createFallbackStyledText(content: string): StyledText {
    const defaultStyle = this._syntaxStyle.mergeStyles("default")
    const chunks = [
      {
        __isChunk: true as const,
        text: content,
        fg: defaultStyle.fg,
        bg: defaultStyle.bg,
        attributes: defaultStyle.attributes,
      },
    ]
    return new StyledText(chunks)
  }
}
