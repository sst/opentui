import { type RenderContext } from "../types"
import { StyledText } from "../lib/styled-text"
import { SyntaxStyle, type StyleDefinition } from "../syntax-style"
import { getTreeSitterClient, treeSitterToStyledText, TreeSitterClient } from "../lib/tree-sitter"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable"
import type { OptimizedBuffer } from "../buffer"
import type { SimpleHighlight } from "../lib/tree-sitter/types"
import type { TextChunk } from "../text-buffer"
import { treeSitterToTextChunks } from "../lib/tree-sitter-styled-text"
import { createTextAttributes } from "../utils"

function defaultStyle(syntaxStyle: SyntaxStyle | undefined): StyleDefinition | undefined {
  if (!syntaxStyle) return undefined
  return syntaxStyle.getStyle("default")
}

function defaultAttributes(style: StyleDefinition | undefined): number {
  if (!style) return 0
  return createTextAttributes({
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,
    dim: style.dim,
  })
}

export interface HighlightContext {
  content: string
  filetype: string
  syntaxStyle: SyntaxStyle
}

export type OnHighlightCallback = (
  highlights: SimpleHighlight[],
  context: HighlightContext,
) => SimpleHighlight[] | undefined | Promise<SimpleHighlight[] | undefined>

export interface ChunkRenderContext extends HighlightContext {
  highlights: SimpleHighlight[]
}

export type OnChunksCallback = (
  chunks: TextChunk[],
  context: ChunkRenderContext,
) => TextChunk[] | undefined | Promise<TextChunk[] | undefined>

export interface CodeOptions extends TextBufferOptions {
  content?: string
  filetype?: string
  syntaxStyle: SyntaxStyle
  treeSitterClient?: TreeSitterClient
  conceal?: boolean
  drawUnstyledText?: boolean
  streaming?: boolean
  onHighlight?: OnHighlightCallback
  onChunks?: OnChunksCallback
}

export class CodeRenderable extends TextBufferRenderable {
  private _content: string
  private _filetype?: string
  private _syntaxStyle: SyntaxStyle
  private _isHighlighting: boolean = false
  private _treeSitterClient: TreeSitterClient
  private _highlightsDirty: boolean = false
  private _highlightSnapshotId: number = 0
  private _conceal: boolean
  private _drawUnstyledText: boolean
  private _shouldRenderTextBuffer: boolean = true
  private _streaming: boolean
  private _hadInitialContent: boolean = false
  private _lastHighlights: SimpleHighlight[] = []
  private _onHighlight?: OnHighlightCallback
  private _onChunks?: OnChunksCallback
  private _autoFg: boolean
  private _autoBg: boolean
  private _autoAttributes: boolean

  protected _contentDefaultOptions = {
    content: "",
    conceal: true,
    drawUnstyledText: true,
    streaming: false,
  } satisfies Partial<CodeOptions>

  constructor(ctx: RenderContext, options: CodeOptions) {
    const style = defaultStyle(options.syntaxStyle)
    super(ctx, {
      ...options,
      fg: options.fg ?? style?.fg,
      bg: options.bg ?? style?.bg,
      attributes: options.attributes ?? defaultAttributes(style),
    })

    this._content = options.content ?? this._contentDefaultOptions.content
    this._filetype = options.filetype
    this._syntaxStyle = options.syntaxStyle
    this._treeSitterClient = options.treeSitterClient ?? getTreeSitterClient()
    this._conceal = options.conceal ?? this._contentDefaultOptions.conceal
    this._drawUnstyledText = options.drawUnstyledText ?? this._contentDefaultOptions.drawUnstyledText
    this._streaming = options.streaming ?? this._contentDefaultOptions.streaming
    this._onHighlight = options.onHighlight
    this._onChunks = options.onChunks
    this._autoFg = options.fg === undefined
    this._autoBg = options.bg === undefined
    this._autoAttributes = options.attributes === undefined

    if (this._content.length > 0) {
      this.textBuffer.setText(this._content)
      this.updateTextInfo()
      this._shouldRenderTextBuffer = this._drawUnstyledText || !this._filetype
    }

    this._highlightsDirty = this._content.length > 0
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content !== value) {
      this._content = value
      this._highlightsDirty = true
      this._highlightSnapshotId++

      if (this._streaming && !this._drawUnstyledText && this._filetype) {
        return
      }

      this.textBuffer.setText(value)
      this.updateTextInfo()
    }
  }

  get filetype(): string | undefined {
    return this._filetype
  }

  set filetype(value: string | undefined) {
    if (this._filetype !== value) {
      this._filetype = value
      this._highlightsDirty = true
    }
  }

  get syntaxStyle(): SyntaxStyle {
    return this._syntaxStyle
  }

  set syntaxStyle(value: SyntaxStyle) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      this.applySyntaxDefaults()
      this._highlightsDirty = true
    }
  }

  private applySyntaxDefaults(): void {
    const style = defaultStyle(this._syntaxStyle)
    if (this._autoFg) {
      this.fg = style?.fg
    }
    if (this._autoBg) {
      this.bg = style?.bg
    }
    if (this._autoAttributes) {
      this.attributes = defaultAttributes(style)
    }
  }

  get conceal(): boolean {
    return this._conceal
  }

  set conceal(value: boolean) {
    if (this._conceal !== value) {
      this._conceal = value
      this._highlightsDirty = true
    }
  }

  get drawUnstyledText(): boolean {
    return this._drawUnstyledText
  }

  set drawUnstyledText(value: boolean) {
    if (this._drawUnstyledText !== value) {
      this._drawUnstyledText = value
      this._highlightsDirty = true
    }
  }

  get streaming(): boolean {
    return this._streaming
  }

  set streaming(value: boolean) {
    if (this._streaming !== value) {
      this._streaming = value
      this._hadInitialContent = false
      this._lastHighlights = []
      this._highlightsDirty = true
    }
  }

  get treeSitterClient(): TreeSitterClient {
    return this._treeSitterClient
  }

  set treeSitterClient(value: TreeSitterClient) {
    if (this._treeSitterClient !== value) {
      this._treeSitterClient = value
      this._highlightsDirty = true
    }
  }

  get onHighlight(): OnHighlightCallback | undefined {
    return this._onHighlight
  }

  set onHighlight(value: OnHighlightCallback | undefined) {
    if (this._onHighlight !== value) {
      this._onHighlight = value
      this._highlightsDirty = true
    }
  }

  get onChunks(): OnChunksCallback | undefined {
    return this._onChunks
  }

  set onChunks(value: OnChunksCallback | undefined) {
    if (this._onChunks !== value) {
      this._onChunks = value
      this._highlightsDirty = true
    }
  }

  get isHighlighting(): boolean {
    return this._isHighlighting
  }

  protected async transformChunks(chunks: TextChunk[], context: ChunkRenderContext): Promise<TextChunk[]> {
    if (!this._onChunks) return chunks

    const modified = await this._onChunks(chunks, context)
    return modified ?? chunks
  }

  private ensureVisibleTextBeforeHighlight(): void {
    if (this.isDestroyed) return

    const content = this._content

    if (!this._filetype) {
      this._shouldRenderTextBuffer = true
      return
    }

    const isInitialContent = this._streaming && !this._hadInitialContent
    const shouldDrawUnstyledNow = this._streaming ? isInitialContent && this._drawUnstyledText : this._drawUnstyledText

    if (this._streaming && !isInitialContent) {
      this._shouldRenderTextBuffer = true
    } else if (shouldDrawUnstyledNow) {
      this.textBuffer.setText(content)
      this._shouldRenderTextBuffer = true
    } else {
      this._shouldRenderTextBuffer = false
    }
  }

  private async startHighlight(): Promise<void> {
    const content = this._content
    const filetype = this._filetype
    const syntaxStyle = this._syntaxStyle
    const snapshotId = ++this._highlightSnapshotId

    if (!filetype) return
    if (!syntaxStyle) {
      this.textBuffer.setText(content)
      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._highlightsDirty = false
      this.updateTextInfo()
      this.requestRender()
      return
    }

    const isInitialContent = this._streaming && !this._hadInitialContent
    if (isInitialContent) {
      this._hadInitialContent = true
    }

    this._isHighlighting = true

    try {
      const result = await this._treeSitterClient.highlightOnce(content, filetype)

      if (snapshotId !== this._highlightSnapshotId) {
        return
      }

      if (this.isDestroyed) return

      let highlights = result.highlights ?? []

      if (this._onHighlight && highlights.length >= 0) {
        const context: HighlightContext = {
          content,
          filetype,
          syntaxStyle,
        }
        const modified = await this._onHighlight(highlights, context)
        if (modified !== undefined) {
          highlights = modified
        }
      }

      if (snapshotId !== this._highlightSnapshotId) {
        return
      }

      if (this.isDestroyed) return

      if (highlights.length > 0) {
        if (this._streaming) {
          this._lastHighlights = highlights
        }
      }

      if (highlights.length > 0 || this._onChunks) {
        const context: ChunkRenderContext = {
          content,
          filetype,
          syntaxStyle,
          highlights,
        }

        let chunks = treeSitterToTextChunks(content, highlights, syntaxStyle, {
          enabled: this._conceal,
        })

        chunks = await this.transformChunks(chunks, context)

        if (snapshotId !== this._highlightSnapshotId) {
          return
        }

        if (this.isDestroyed) return

        const styledText = new StyledText(chunks)
        this.textBuffer.setStyledText(styledText)
      } else {
        this.textBuffer.setText(content)
      }

      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._highlightsDirty = false
      this.updateTextInfo()
      this.requestRender()
    } catch (error) {
      if (snapshotId !== this._highlightSnapshotId) {
        return
      }

      console.warn("Code highlighting failed, falling back to plain text:", error)
      if (this.isDestroyed) return
      this.textBuffer.setText(content)
      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._highlightsDirty = false
      this.updateTextInfo()
      this.requestRender()
    }
  }

  public getLineHighlights(lineIdx: number) {
    return this.textBuffer.getLineHighlights(lineIdx)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this._highlightsDirty) {
      if (this.isDestroyed) return

      if (this._content.length === 0) {
        this._shouldRenderTextBuffer = false
        this._highlightsDirty = false
      } else if (!this._filetype) {
        this._shouldRenderTextBuffer = true
        this._highlightsDirty = false
      } else {
        this.ensureVisibleTextBeforeHighlight()
        this._highlightsDirty = false
        this.startHighlight()
      }
    }

    if (!this._shouldRenderTextBuffer) return
    super.renderSelf(buffer)
  }
}
