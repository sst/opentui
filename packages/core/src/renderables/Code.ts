import { type RenderContext } from "../types.js"
import { StyledText } from "../lib/styled-text.js"
import { SyntaxStyle } from "../syntax-style.js"
import { getTreeSitterClient, treeSitterToStyledText, TreeSitterClient } from "../lib/tree-sitter/index.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"
import type { OptimizedBuffer } from "../buffer.js"
import type { SimpleHighlight } from "../lib/tree-sitter/types.js"
import type { TextChunk } from "../text-buffer.js"
import { treeSitterToTextChunks } from "../lib/tree-sitter-styled-text.js"

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
  baseHighlight?: string
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
  private _lastHighlightContent: string = ""
  private _lastHighlightFiletype: string | undefined
  private _restyleDirty: boolean = false
  private _restylePromise: Promise<void> = Promise.resolve()
  // Bumped on every setter that marks either dirty flag. The async restyle
  // path captures this at kick-off and bails after `await transformChunks` if
  // it moved — otherwise stale chunks could land on changed state.
  private _stateRevision: number = 0

  // Scope categories that tree-sitter assigns reliably regardless of how
  // complete the parse tree is. Anything outside this set (function,
  // constructor, type, property, variable.member, label, …) tends to flip
  // between adjacent partial parses because the scope depends on syntactic
  // context the parser hasn't seen yet — that's the visible flashing the
  // user reports during streaming (e.g. `class UserManager` cycling between
  // type-orange and property-blue on consecutive worker round-trips).
  // While `_streaming` is true we apply only the stable subset; once the
  // stream ends we re-highlight and pick up the full assignments.
  private static readonly STREAMING_STABLE_PREFIXES: readonly string[] = [
    "keyword",
    "string",
    "comment",
    "number",
    "boolean",
    "constant",
    "operator",
    "punctuation",
    "markup",
    "spell",
    "nospell",
    "conceal",
  ]

  private filterStreamingHighlights(highlights: SimpleHighlight[]): SimpleHighlight[] {
    if (!this._streaming) return highlights
    return highlights.filter((h) => {
      const meta = h[3]
      // Conceal-driving highlights must survive the filter — losing them
      // would cause text to appear and disappear between partial parses
      // (e.g. markdown's `\`\`\`` fences would un-conceal mid-stream),
      // which is a worse glitch than a color flip would be.
      if (meta?.conceal !== undefined || meta?.concealLines !== undefined) return true
      // Injection containers and their markers stabilize the language-switch
      // boundaries (e.g. ` ```typescript ` opening a TS injection inside
      // markdown). Keep them so injected ranges don't reshape between
      // parses.
      if (meta?.isInjection || meta?.containsInjection) return true

      const name = h[2]
      for (const prefix of CodeRenderable.STREAMING_STABLE_PREFIXES) {
        if (name === prefix) return true
        if (name.startsWith(prefix + ".")) return true
      }
      return false
    })
  }
  private _baseHighlight?: string
  private _onHighlight?: OnHighlightCallback
  private _onChunks?: OnChunksCallback
  private _highlightingPromise: Promise<void> = Promise.resolve()

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
    this._baseHighlight = options.baseHighlight
    this._onHighlight = options.onHighlight
    this._onChunks = options.onChunks

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
      this._stateRevision++

      if (this._streaming && !this._drawUnstyledText && this._filetype) {
        this.requestRender()
        return
      }

      if (this._streaming) {
        // Streaming mode: reuse the cached styled prefix instead of wiping
        // the buffer back to plain on every chunk. That wipe is what makes
        // the visible text flicker between styled and plain on alternate
        // frames during a stream.
        this.applyContentWithCachedStyling()
      } else {
        this.textBuffer.setText(value)
        this.updateTextInfo()
      }
    }
  }

  get filetype(): string | undefined {
    return this._filetype
  }

  set filetype(value: string | undefined) {
    if (this._filetype !== value) {
      this._filetype = value
      this._highlightsDirty = true
      // Bump the snapshot so an in-flight highlight on the old filetype gets
      // discarded when it returns instead of accidentally applying parser
      // results for the wrong language.
      this._highlightSnapshotId++
      this._stateRevision++
      // Invalidate the restyle cache — its highlights are bound to the
      // previous filetype's parser.
      this._lastHighlights = []
      this._lastHighlightContent = ""
      this._lastHighlightFiletype = undefined
    }
  }

  get syntaxStyle(): SyntaxStyle {
    return this._syntaxStyle
  }

  set syntaxStyle(value: SyntaxStyle) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      this._restyleDirty = true
      this._stateRevision++
    }
  }

  get conceal(): boolean {
    return this._conceal
  }

  set conceal(value: boolean) {
    if (this._conceal !== value) {
      this._conceal = value
      this._restyleDirty = true
      this._stateRevision++
    }
  }

  get drawUnstyledText(): boolean {
    return this._drawUnstyledText
  }

  set drawUnstyledText(value: boolean) {
    if (this._drawUnstyledText !== value) {
      this._drawUnstyledText = value
      this._restyleDirty = true
      this._stateRevision++
    }
  }

  get streaming(): boolean {
    return this._streaming
  }

  set streaming(value: boolean) {
    if (this._streaming !== value) {
      this._streaming = value
      this._hadInitialContent = false
      // Streaming mode applies a stability-filtered subset of highlights so
      // identifier-class scopes don't flip mid-stream. Clearing the cache on
      // both entry and exit forces the next render to repopulate with the
      // appropriate subset.
      this._lastHighlights = []
      this._lastHighlightContent = ""
      this._lastHighlightFiletype = undefined
      this._highlightsDirty = true
      this._stateRevision++
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

  get baseHighlight(): string | undefined {
    return this._baseHighlight
  }

  set baseHighlight(value: string | undefined) {
    if (this._baseHighlight !== value) {
      this._baseHighlight = value
      this._restyleDirty = true
      this._stateRevision++
    }
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
      this._restyleDirty = true
      this._stateRevision++
    }
  }

  get isHighlighting(): boolean {
    return this._isHighlighting
  }

  get highlightingDone(): Promise<void> {
    return Promise.all([this._highlightingPromise, this._restylePromise]).then(() => undefined)
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
    const snapshotId = ++this._highlightSnapshotId

    if (!filetype) return

    const isInitialContent = this._streaming && !this._hadInitialContent
    if (isInitialContent) {
      this._hadInitialContent = true
    }

    this._isHighlighting = true

    // Cleanup for stale results: clear the in-flight flag and request a
    // render. The dirty flag was set by the caller that bumped the snapshot
    // id, so the next renderSelf will fire a fresh highlight on the latest
    // content.
    const bailStale = () => {
      this._isHighlighting = false
      this.requestRender()
    }

    try {
      const result = await this._treeSitterClient.highlightOnce(content, filetype)

      if (snapshotId !== this._highlightSnapshotId) {
        // Streaming UX: under fast appends every in-flight call ends up
        // stale by the time it returns, so the user would see nothing but
        // plain text until streaming stops. If the newer content just
        // extends what we parsed, apply our highlights to the prefix and
        // leave the tail unstyled — the next highlight will catch up.
        this.maybePartialApplyOnStale(content, filetype, result.highlights ?? [])
        bailStale()
        return
      }

      if (this.isDestroyed) return

      let highlights = result.highlights ?? []

      if (this._onHighlight && highlights.length >= 0) {
        const context: HighlightContext = {
          content,
          filetype,
          syntaxStyle: this._syntaxStyle,
        }
        const modified = await this._onHighlight(highlights, context)
        if (modified !== undefined) {
          highlights = modified
        }
      }

      if (snapshotId !== this._highlightSnapshotId) {
        bailStale(); return
      }

      if (this.isDestroyed) return

      // While streaming, downsample to scopes that stay stable across
      // partial parses. This is what stops identifiers (class names, member
      // names, types) from flashing between adjacent worker round-trips.
      // Apply the filter to both the cache and the chunks the buffer paints
      // so they don't disagree.
      const visibleHighlights = this.filterStreamingHighlights(highlights)

      // Cache for the cheap-restyle path: H3 reuses these highlights when
      // only chunk-affecting state changes (conceal, syntaxStyle, etc).
      this._lastHighlights = visibleHighlights
      this._lastHighlightContent = content
      this._lastHighlightFiletype = filetype

      if (visibleHighlights.length > 0 || this._onChunks || this._baseHighlight) {
        const context: ChunkRenderContext = {
          content,
          filetype,
          syntaxStyle: this._syntaxStyle,
          highlights: visibleHighlights,
        }

        let chunks = treeSitterToTextChunks(content, visibleHighlights, this._syntaxStyle, {
          enabled: this._conceal,
          baseHighlight: this._baseHighlight,
        })

        chunks = await this.transformChunks(chunks, context)

        if (snapshotId !== this._highlightSnapshotId) {
          bailStale(); return
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
      this._restyleDirty = false
      this.updateTextInfo()
      this.requestRender()
    } catch (error) {
      if (snapshotId !== this._highlightSnapshotId) {
        bailStale(); return
      }

      console.warn("Code highlighting failed, falling back to plain text:", error)
      if (this.isDestroyed) return
      this.textBuffer.setText(content)
      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._highlightsDirty = false
      this._restyleDirty = false
      this.updateTextInfo()
      this.requestRender()
    }
  }

  public getLineHighlights(lineIdx: number) {
    return this.textBuffer.getLineHighlights(lineIdx)
  }

  destroy(): void {
    if (this.isDestroyed) return
    // Drop the per-renderable highlight cache so a markdown document with
    // many fenced code blocks doesn't retain N copies of source text +
    // highlights after the renderables are gone.
    this._lastHighlights = []
    this._lastHighlightContent = ""
    this._lastHighlightFiletype = undefined
    super.destroy()
  }

  // Render the current content using whatever cached highlights cover its
  // prefix, with the unparsed tail (if any) emitted as a single plain chunk.
  // Used in two places that would otherwise wipe styling back to plain text:
  //
  //   - `set content` while streaming: the next chunk arrives every ~16ms
  //     but the worker takes ~16ms+ to reply, so calling textBuffer.setText
  //     on every set would alternate the buffer between styled and plain on
  //     every other frame — that's the visible flicker. Reusing the cached
  //     prefix keeps the styled portion stable while the tail extends.
  //
  //   - the stale-partial-apply path below, when a worker reply lands for a
  //     content prefix older than current.
  //
  // Falls back to plain `setText` when:
  //   - there is no usable cached prefix (no prior highlight, filetype
  //     differs, or current content isn't an extension of the cache);
  //   - an async `onChunks` callback is registered — running it on every
  //     incremental set-content would multiply user callback work and the
  //     async hop would re-introduce the same flicker we're trying to
  //     avoid. Plain text is the safer default in that combination.
  private applyContentWithCachedStyling(): void {
    if (this.isDestroyed) return
    const content = this._content
    const cached = this._lastHighlightContent
    const usableCache =
      !this._onChunks &&
      this._filetype !== undefined &&
      this._filetype === this._lastHighlightFiletype &&
      cached.length > 0 &&
      content.length >= cached.length &&
      content.startsWith(cached)

    if (!usableCache) {
      this.textBuffer.setText(content)
      this.updateTextInfo()
      return
    }

    const prefixChunks = treeSitterToTextChunks(cached, this._lastHighlights, this._syntaxStyle, {
      enabled: this._conceal,
      baseHighlight: this._baseHighlight,
    })
    const tail = content.slice(cached.length)
    const chunks: TextChunk[] = tail.length > 0 ? [...prefixChunks, { __isChunk: true, text: tail }] : prefixChunks
    const styledText = new StyledText(chunks)
    this.textBuffer.setStyledText(styledText)
    this.updateTextInfo()
  }

  // Streaming UX: when a highlight result lands stale (content has grown
  // while the worker was busy) and the new content extends what we parsed,
  // promote the parsed highlights to be our newest cache and re-render so
  // the styled prefix shows immediately. Skipped when an async onChunks
  // transform is set — partial+full chunk passes would double the user's
  // callback work.
  private maybePartialApplyOnStale(
    parsedContent: string,
    parsedFiletype: string,
    parsedHighlights: SimpleHighlight[],
  ): void {
    if (!this._streaming) return
    if (this.isDestroyed) return
    if (this._onChunks) return
    if (this._filetype !== parsedFiletype) return
    const latest = this._content
    if (latest.length <= parsedContent.length) return
    if (!latest.startsWith(parsedContent)) return

    // Promote: this is the newest highlight info we have, even if it's only
    // for a prefix. The next full highlight will replace it with a strictly
    // longer cache. Filtered to the stable-streaming subset so we don't
    // promote a flip-prone identifier scope into the cache.
    this._lastHighlights = this.filterStreamingHighlights(parsedHighlights)
    this._lastHighlightContent = parsedContent
    this._lastHighlightFiletype = parsedFiletype

    this.applyContentWithCachedStyling()
    this._shouldRenderTextBuffer = true
    this.requestRender()
  }

  // H3: re-run chunking against the last successful highlights without a
  // worker round-trip. Used when only chunk-affecting state changed
  // (conceal, syntaxStyle, drawUnstyledText, baseHighlight, onChunks).
  //
  // Synchronous when no async chunk transform is registered, so the same
  // frame that calls renderSelf can pick up the new styled text. Falls
  // through to a Promise when `_onChunks` is set.
  private restyleFromCache(): Promise<void> | void {
    if (this.isDestroyed) return
    // Clear dirty up-front so a re-entrant render while we're awaiting an
    // async transform doesn't kick off another restyle in parallel. State
    // changes between here and the apply step are caught by the
    // _stateRevision check after the await.
    this._restyleDirty = false

    const content = this._content
    const filetype = this._lastHighlightFiletype
    if (
      !filetype ||
      this._lastHighlightContent !== content ||
      this._filetype !== filetype
    ) {
      // Cache invalid: content changed since last highlight, the current
      // filetype no longer matches what produced the cached highlights, or
      // we never highlighted at all. Fall back to a full highlight.
      this._highlightsDirty = true
      this.requestRender()
      return
    }
    const highlights = this._lastHighlights

    if (highlights.length === 0 && !this._onChunks && !this._baseHighlight) {
      this.textBuffer.setText(content)
      this._shouldRenderTextBuffer = true
      this.updateTextInfo()
      this.requestRender()
      return
    }

    const chunks = treeSitterToTextChunks(content, highlights, this._syntaxStyle, {
      enabled: this._conceal,
      baseHighlight: this._baseHighlight,
    })

    if (!this._onChunks) {
      const styledText = new StyledText(chunks)
      this.textBuffer.setStyledText(styledText)
      this._shouldRenderTextBuffer = true
      this.updateTextInfo()
      this.requestRender()
      return
    }

    const revision = this._stateRevision
    const context: ChunkRenderContext = {
      content,
      filetype,
      syntaxStyle: this._syntaxStyle,
      highlights,
    }
    return this.transformChunks(chunks, context).then((transformed) => {
      if (this.isDestroyed) return
      // Drop the result if any setter bumped state during the transform: the
      // chunks were built from the captured (now stale) state, and a fresh
      // restyle/highlight will be pending anyway.
      if (revision !== this._stateRevision) return
      const styledText = new StyledText(transformed)
      this.textBuffer.setStyledText(styledText)
      this._shouldRenderTextBuffer = true
      this.updateTextInfo()
      this.requestRender()
    })
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this._highlightsDirty) {
      if (this.isDestroyed) return

      if (this._content.length === 0) {
        this._shouldRenderTextBuffer = false
        this._highlightsDirty = false
        this._restyleDirty = false
      } else if (!this._filetype) {
        // No filetype → render as plain text. In streaming mode with
        // drawUnstyledText=false, `set content` skipped the textBuffer
        // update, so the buffer still holds whatever the last successful
        // highlight applied (or is empty). Refresh it before painting.
        this.textBuffer.setText(this._content)
        this.updateTextInfo()
        this._shouldRenderTextBuffer = true
        this._highlightsDirty = false
        this._restyleDirty = false
      } else if (!this._isHighlighting) {
        // Coalesce: only one highlight in flight at a time. If content changes
        // again before the worker returns, the snapshot-id guard short-circuits
        // the stale result and the trailing requestRender() picks up the
        // latest content on the next frame. Without this guard, every set
        // content call during streaming spawns a concurrent worker round-trip.
        this.ensureVisibleTextBeforeHighlight()
        this._highlightsDirty = false
        this._highlightingPromise = this.startHighlight()
      }
    } else if (this._restyleDirty && !this._isHighlighting) {
      // H3: only style-side state changed. Re-chunk from cached highlights
      // without hitting the worker. If the cache turns out to be stale,
      // restyleFromCache promotes back to a full highlight.
      this._restylePromise = this.restyleFromCache() ?? Promise.resolve()
    }

    if (!this._shouldRenderTextBuffer) return
    super.renderSelf(buffer)
  }
}
