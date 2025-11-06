import { type RenderContext } from "../types"
import { StyledText } from "../lib/styled-text"
import { SyntaxStyle } from "../syntax-style"
import { getTreeSitterClient, treeSitterToStyledText, TreeSitterClient } from "../lib/tree-sitter"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable"
import type { OptimizedBuffer } from "../buffer"
import type { SimpleHighlight } from "../lib/tree-sitter/types"
import { treeSitterToTextChunks } from "../lib/tree-sitter-styled-text"

export interface CodeOptions extends TextBufferOptions {
  content?: string
  filetype?: string
  syntaxStyle: SyntaxStyle
  treeSitterClient?: TreeSitterClient
  conceal?: boolean
  drawUnstyledText?: boolean
  streaming?: boolean
}

export class CodeRenderable extends TextBufferRenderable {
  private _content: string
  private _filetype?: string
  private _syntaxStyle: SyntaxStyle
  private _isHighlighting: boolean = false
  private _treeSitterClient: TreeSitterClient
  private _pendingRehighlight: boolean = false
  private _pendingUpdate: boolean = false
  private _currentHighlightId: number = 0
  private _conceal: boolean
  private _drawUnstyledText: boolean
  private _shouldRenderTextBuffer: boolean = true
  private _streaming: boolean
  private _hadInitialContent: boolean = false
  private _lastHighlights: SimpleHighlight[] = []

  protected _contentDefaultOptions = {
    content: "",
    conceal: true,
    drawUnstyledText: true,
    streaming: false,
  } satisfies Partial<CodeOptions>

  constructor(ctx: RenderContext, options: CodeOptions) {
    super(ctx, options)

    this._content = options.content ?? this._contentDefaultOptions.content
    this._filetype = options.filetype
    this._syntaxStyle = options.syntaxStyle
    this._treeSitterClient = options.treeSitterClient ?? getTreeSitterClient()
    this._conceal = options.conceal ?? this._contentDefaultOptions.conceal
    this._drawUnstyledText = options.drawUnstyledText ?? this._contentDefaultOptions.drawUnstyledText
    this._streaming = options.streaming ?? this._contentDefaultOptions.streaming

    this.updateContent(this._content)
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content !== value) {
      this._content = value
      this.scheduleUpdate()
    }
  }

  get filetype(): string | undefined {
    return this._filetype
  }

  set filetype(value: string) {
    if (this._filetype !== value) {
      this._filetype = value
      this.scheduleUpdate()
    }
  }

  get syntaxStyle(): SyntaxStyle {
    return this._syntaxStyle
  }

  set syntaxStyle(value: SyntaxStyle) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      this.scheduleUpdate()
    }
  }

  get conceal(): boolean {
    return this._conceal
  }

  set conceal(value: boolean) {
    if (this._conceal !== value) {
      this._conceal = value
      this.scheduleUpdate()
    }
  }

  get drawUnstyledText(): boolean {
    return this._drawUnstyledText
  }

  set drawUnstyledText(value: boolean) {
    if (this._drawUnstyledText !== value) {
      this._drawUnstyledText = value
      this.scheduleUpdate()
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
      this.scheduleUpdate()
    }
  }

  get treeSitterClient(): TreeSitterClient {
    return this._treeSitterClient
  }

  set treeSitterClient(value: TreeSitterClient) {
    if (this._treeSitterClient !== value) {
      this._treeSitterClient = value
      this.scheduleUpdate()
    }
  }

  private scheduleUpdate(): void {
    if (this._pendingUpdate) return
    this._pendingUpdate = true
    queueMicrotask(() => {
      this._pendingUpdate = false
      this.updateContent(this._content)
    })
  }

  private async updateContent(content: string): Promise<void> {
    if (content.length === 0) return

    if (!this._filetype) {
      this.fallback(content)
      this._shouldRenderTextBuffer = true
      return
    }

    this._currentHighlightId++
    const highlightId = this._currentHighlightId

    // Determine if this is the initial content when streaming
    const isInitialContent = this._streaming && !this._hadInitialContent
    if (isInitialContent) {
      this._hadInitialContent = true
    }

    // Handle initial fallback display
    const shouldDrawUnstyledNow = this._streaming ? isInitialContent && this._drawUnstyledText : this._drawUnstyledText

    // TODO: Setting initial text should not be necessary,
    // this is done to give the renderable initial dimensions
    // to solve the disappearing content in scrollbox.
    // What actually happens is that _getChildren() in the ContentRenderable
    // for the ScrollBox reduces # of children _to update_.
    // So children never get their dimensions updated,
    // and getChildrenSortedByPrimaryAxis() is just wrong then.
    // However, the main bottleneck there is the yoga-layout getters
    // are ridicoulously slow, so for a list with many children
    // that becomes a performance bottleneck the longer the list is.
    this.fallback(content)

    if (!shouldDrawUnstyledNow) {
      this._shouldRenderTextBuffer = false
    }

    if (this._streaming && !isInitialContent && this._lastHighlights.length > 0) {
      const chunks = treeSitterToTextChunks(content, this._lastHighlights, this._syntaxStyle, {
        enabled: this._conceal,
      })
      const partialStyledText = new StyledText(chunks)
      if (this.isDestroyed) return
      this.textBuffer.setStyledText(partialStyledText)
      this._shouldRenderTextBuffer = true
      this.updateTextInfo()
    }

    this._isHighlighting = true
    this._pendingRehighlight = false

    try {
      const result = await this._treeSitterClient.highlightOnce(content, this._filetype)

      if (highlightId !== this._currentHighlightId) {
        // This response is stale, ignore it
        return
      }

      if (this.isDestroyed) return

      if (result.highlights && result.highlights.length > 0) {
        if (this._streaming) {
          this._lastHighlights = result.highlights
        }

        const chunks = treeSitterToTextChunks(content, result.highlights, this._syntaxStyle, {
          enabled: this._conceal,
        })
        const styledText = new StyledText(chunks)
        this.textBuffer.setStyledText(styledText)
      } else {
        this.fallback(content)
      }

      this._shouldRenderTextBuffer = true
      this.updateTextInfo()
    } catch (error) {
      if (highlightId !== this._currentHighlightId) {
        return
      }
      console.warn("Code highlighting failed, falling back to plain text:", error)
      this.fallback(content)
      this._shouldRenderTextBuffer = true
    } finally {
      if (highlightId === this._currentHighlightId) {
        this._isHighlighting = false
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

  public getLineHighlights(lineIdx: number) {
    return this.textBuffer.getLineHighlights(lineIdx)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (!this._shouldRenderTextBuffer) return
    super.renderSelf(buffer)
  }
}
