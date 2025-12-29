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
  private _highlightsDirty: boolean = false
  private _highlightSnapshotId: number = 0
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

    // Always set initial content so lineCount is correct for measure functions
    // This prevents width glitches in parent components like LineNumberRenderable
    // The _shouldRenderTextBuffer flag controls whether we actually draw it
    if (this._content.length > 0) {
      this.textBuffer.setText(this._content)
      this.updateTextInfo()
      // Only render if drawUnstyledText is true or there's no filetype (fallback mode)
      this._shouldRenderTextBuffer = this._drawUnstyledText || !this._filetype
    }

    // Mark as dirty if there's initial content (even without filetype, we need to show it)
    this._highlightsDirty = this._content.length > 0
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content !== value) {
      this._content = value
      this._highlightsDirty = true
      // Invalidate any in-flight highlight operations so they don't overwrite with stale content
      this._highlightSnapshotId++

      // Always update text buffer for measure functions (like gutter width calculation)
      // The _shouldRenderTextBuffer flag controls whether we actually draw it
      this.textBuffer.setText(value)
      this.updateTextInfo()
    }
  }

  get filetype(): string | undefined {
    return this._filetype
  }

  set filetype(value: string) {
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
      this._highlightsDirty = true
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

  private ensureVisibleTextBeforeHighlight(): void {
    if (this.isDestroyed) return

    const content = this._content

    // No filetype means fallback - always render
    if (!this._filetype) {
      this._shouldRenderTextBuffer = true
      return
    }

    // Determine if this is initial content when streaming
    const isInitialContent = this._streaming && !this._hadInitialContent

    // Handle initial fallback display
    const shouldDrawUnstyledNow = this._streaming ? isInitialContent && this._drawUnstyledText : this._drawUnstyledText

    if (this._streaming && !isInitialContent) {
      // Use cached highlights for partial styling if available
      if (this._lastHighlights.length > 0) {
        const chunks = treeSitterToTextChunks(content, this._lastHighlights, this._syntaxStyle, {
          enabled: this._conceal,
        })
        const partialStyledText = new StyledText(chunks)
        this.textBuffer.setStyledText(partialStyledText)
        this._shouldRenderTextBuffer = true
        this.updateTextInfo()
      } else {
        // No cached highlights - render plain text (buffer already has content)
        this._shouldRenderTextBuffer = true
      }
    } else if (shouldDrawUnstyledNow) {
      // Show plain text before highlights arrive
      // Reset to plain text in case buffer has styled text from previous highlight
      this.textBuffer.setText(content)
      this._shouldRenderTextBuffer = true
    } else {
      // Don't show anything until highlights arrive
      // Text buffer still has content for lineCount etc, just don't render it
      this._shouldRenderTextBuffer = false
    }
  }

  private async startHighlight(): Promise<void> {
    // Capture snapshot of current state
    const content = this._content
    const filetype = this._filetype
    const snapshotId = ++this._highlightSnapshotId

    if (!filetype) return

    // Mark as initial content if streaming
    const isInitialContent = this._streaming && !this._hadInitialContent
    if (isInitialContent) {
      this._hadInitialContent = true
    }

    this._isHighlighting = true

    try {
      const result = await this._treeSitterClient.highlightOnce(content, filetype)

      // Check if this result is stale (newer highlight was started)
      if (snapshotId !== this._highlightSnapshotId) {
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
        // No highlights, use plain text
        this.textBuffer.setText(content)
      }

      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._highlightsDirty = false
      this.updateTextInfo() // Must be after _isHighlighting = false so listeners see correct state
      this.requestRender()
    } catch (error) {
      // Check if this result is stale
      if (snapshotId !== this._highlightSnapshotId) {
        return
      }

      console.warn("Code highlighting failed, falling back to plain text:", error)
      if (this.isDestroyed) return
      this.textBuffer.setText(content)
      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._highlightsDirty = false
      this.updateTextInfo() // Must be after _isHighlighting = false so listeners see correct state
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
        // Empty content - nothing to render
        this._shouldRenderTextBuffer = false
        this._highlightsDirty = false
      } else if (!this._filetype) {
        // No filetype - render plain text (buffer already has content)
        this._shouldRenderTextBuffer = true
        this._highlightsDirty = false
      } else {
        // Has filetype - determine visibility and start highlighting
        this.ensureVisibleTextBeforeHighlight()
        this._highlightsDirty = false
        this.startHighlight()
      }
    }

    if (!this._shouldRenderTextBuffer) return
    super.renderSelf(buffer)
  }
}
