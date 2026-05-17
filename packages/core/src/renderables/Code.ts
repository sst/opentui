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

interface StreamingStyleLock {
  start: number
  end: number
  text: string
  scope: string
}

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
  private _streamingStyledPrefixHighlights: SimpleHighlight[] = []
  private _streamingStyledPrefixContent: string = ""
  private _streamingStyledPrefixFiletype: string | undefined
  private _streamingStyleLocks: StreamingStyleLock[] = []
  // Memoization slot for the chunks built from the chosen prefix in
  // `applyContentWithCachedStyling`. The prefix is identical between worker
  // round-trips, so during streaming this collapses the per-chunk-arrival
  // `treeSitterToTextChunks(prefix, …)` work to one rebuild per highlight
  // result. Key is the inputs that affect chunk output (source highlights
  // array identity, prefix string, prefix end, plus the three chunk-time
  // style settings).
  private _cachedPrefixChunks: {
    sourceHighlights: SimpleHighlight[]
    prefixContent: string
    prefixEnd: number
    syntaxStyle: SyntaxStyle
    conceal: boolean
    baseHighlight: string | undefined
    chunks: TextChunk[]
  } | null = null
  private _restyleDirty: boolean = false
  private _restylePromise: Promise<void> = Promise.resolve()
  // Bumped on every setter that marks either dirty flag. The async restyle
  // path captures this at kick-off and bails after `await transformChunks` if
  // it moved — otherwise stale chunks could land on changed state.
  private _stateRevision: number = 0

  private static readonly STREAMING_LOCK_SCOPE_PREFIXES: readonly string[] = [
    "type",
    "variable",
    "function",
    "constructor",
    "property",
    "module",
    "attribute",
    "label",
  ]

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
      this._streamingStyledPrefixHighlights = []
      this._streamingStyledPrefixContent = ""
      this._streamingStyledPrefixFiletype = undefined
      this._streamingStyleLocks = []
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
      // Streaming mode keeps a progressive display cache. Clearing the cache
      // on both entry and exit forces the next render to repopulate with the
      // appropriate content.
      this._lastHighlights = []
      this._lastHighlightContent = ""
      this._lastHighlightFiletype = undefined
      this._streamingStyledPrefixHighlights = []
      this._streamingStyledPrefixContent = ""
      this._streamingStyledPrefixFiletype = undefined
      this._streamingStyleLocks = []
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
      // Bump the snapshot so an in-flight highlight on the previous client
      // gets discarded when it returns — cached highlights came from a
      // different parser instance and may not even agree on scopes.
      this._highlightSnapshotId++
      this._stateRevision++
      this._lastHighlights = []
      this._lastHighlightContent = ""
      this._lastHighlightFiletype = undefined
      this._streamingStyledPrefixHighlights = []
      this._streamingStyledPrefixContent = ""
      this._streamingStyledPrefixFiletype = undefined
      this._streamingStyleLocks = []
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
      // Renderable can be destroyed between bumping the snapshot and the
      // worker reply arriving — don't request a render after teardown.
      if (this.isDestroyed) return
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
        bailStale()
        return
      }

      if (this.isDestroyed) return

      highlights = this.applyStreamingStyleLocks(content, highlights)

      // Cache for the cheap-restyle path: H3 reuses these highlights when
      // only chunk-affecting state changes (conceal, syntaxStyle, etc).
      this._lastHighlights = highlights
      this._lastHighlightContent = content
      this._lastHighlightFiletype = filetype
      this._streamingStyledPrefixHighlights = highlights
      this._streamingStyledPrefixContent = content
      this._streamingStyledPrefixFiletype = filetype

      if (highlights.length > 0 || this._onChunks || this._baseHighlight) {
        const context: ChunkRenderContext = {
          content,
          filetype,
          syntaxStyle: this._syntaxStyle,
          highlights,
        }

        let chunks = treeSitterToTextChunks(content, highlights, this._syntaxStyle, {
          enabled: this._conceal,
          baseHighlight: this._baseHighlight,
        })

        chunks = await this.transformChunks(chunks, context)

        if (snapshotId !== this._highlightSnapshotId) {
          bailStale()
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
      this._restyleDirty = false
      this.updateTextInfo()
      this.requestRender()
    } catch (error) {
      if (snapshotId !== this._highlightSnapshotId) {
        bailStale()
        return
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
    this._streamingStyledPrefixHighlights = []
    this._streamingStyledPrefixContent = ""
    this._streamingStyledPrefixFiletype = undefined
    this._streamingStyleLocks = []
    this._cachedPrefixChunks = null
    super.destroy()
  }

  private getStreamingPrefixEnd(cachedContent: string, currentContent: string): number {
    return currentContent.startsWith(cachedContent) ? cachedContent.length : 0
  }

  private getHighlightsWithin(highlights: SimpleHighlight[], end: number): SimpleHighlight[] {
    // Half-open ranges [start, end); `highlightEnd <= end` keeps highlights
    // that lie fully within the prefix. The source array is sorted by start
    // (see parser.worker.ts), so once we see a highlight whose start is at
    // or past the boundary it can't possibly fit and nothing after it can
    // either — break out instead of scanning the whole array.
    const result: SimpleHighlight[] = []
    for (let i = 0; i < highlights.length; i++) {
      const h = highlights[i]
      if (h[0] >= end) break
      if (h[1] <= end) result.push(h)
    }
    return result
  }

  private isStreamingStyleLockScope(scope: string, meta: any): boolean {
    if (meta?.conceal !== undefined || meta?.concealLines !== undefined) return false
    if (meta?.isInjection || meta?.containsInjection) return false

    for (const prefix of CodeRenderable.STREAMING_LOCK_SCOPE_PREFIXES) {
      if (scope === prefix || scope.startsWith(prefix + ".")) return true
    }
    return false
  }

  private applyStreamingStyleLocks(content: string, highlights: SimpleHighlight[]): SimpleHighlight[] {
    if (!this._streaming || highlights.length === 0) return highlights

    const nextLocks: StreamingStyleLock[] = []
    const stabilized = highlights.map((highlight) => {
      const [start, end, scope, meta] = highlight
      if (!this.isStreamingStyleLockScope(scope, meta)) return highlight

      const text = content.slice(start, end)
      if (text.length === 0) return highlight

      const existing = this._streamingStyleLocks.find(
        (lock) => lock.start === start && (text.startsWith(lock.text) || lock.text.startsWith(text)),
      )
      const lockedScope = existing?.scope ?? scope
      nextLocks.push({ start, end, text, scope: lockedScope })

      if (lockedScope === scope) return highlight
      return [start, end, lockedScope, meta] as SimpleHighlight
    })

    this._streamingStyleLocks = nextLocks
    return stabilized
  }

  // Lexical predicates used by getContinuationLength to detect whether the
  // streamed tail extends the prefix's last token (e.g. `User` + `Manager`
  // are one identifier). The character classes are JS/TS-flavored and also
  // cover C-family languages reasonably (Java, Rust, Go, Python, C#). On
  // languages with different identifier rules (Lisp's `-` and `?`, Ruby's
  // `?` and `!`, Clojure's `/`, etc.) the worst case is graceful
  // degradation: a continuation that should extend the previous token's
  // style instead falls into the plain-tail path. No incorrect styling is
  // applied — just less continuation. Revisit if this becomes visible for
  // a non-JS-family language.
  private isIdentifierChar(value: string): boolean {
    return /^[A-Za-z0-9_$]$/.test(value)
  }

  private isOperatorChar(value: string): boolean {
    return /^[+\-*/%=&|^!<>?:.~]$/.test(value)
  }

  private getContinuationLength(prefix: string, tail: string): number {
    if (prefix.length === 0 || tail.length === 0) return 0

    const previous = prefix[prefix.length - 1]
    const next = tail[0]
    const continuesIdentifier = this.isIdentifierChar(previous) && this.isIdentifierChar(next)
    const continuesOperator = this.isOperatorChar(previous) && this.isOperatorChar(next)
    if (!continuesIdentifier && !continuesOperator) return 0

    const isSameTokenChar = continuesIdentifier ? this.isIdentifierChar.bind(this) : this.isOperatorChar.bind(this)
    let length = 0
    while (length < tail.length && isSameTokenChar(tail[length])) {
      length++
    }
    return length
  }

  private getCachedPrefixChunks(
    sourceHighlights: SimpleHighlight[],
    prefixContent: string,
    prefixEnd: number,
  ): TextChunk[] {
    const cached = this._cachedPrefixChunks
    if (
      cached !== null &&
      cached.sourceHighlights === sourceHighlights &&
      cached.prefixContent === prefixContent &&
      cached.prefixEnd === prefixEnd &&
      cached.syntaxStyle === this._syntaxStyle &&
      cached.conceal === this._conceal &&
      cached.baseHighlight === this._baseHighlight
    ) {
      return cached.chunks
    }

    const prefixHighlights = this.getHighlightsWithin(sourceHighlights, prefixEnd)
    const chunks = treeSitterToTextChunks(prefixContent, prefixHighlights, this._syntaxStyle, {
      enabled: this._conceal,
      baseHighlight: this._baseHighlight,
    })
    this._cachedPrefixChunks = {
      sourceHighlights,
      prefixContent,
      prefixEnd,
      syntaxStyle: this._syntaxStyle,
      conceal: this._conceal,
      baseHighlight: this._baseHighlight,
      chunks,
    }
    return chunks
  }

  private appendTailToChunks(chunks: TextChunk[], prefix: string, tail: string): TextChunk[] {
    if (tail.length === 0) return chunks

    const continuationLength = this.getContinuationLength(prefix, tail)
    const result = [...chunks]
    if (continuationLength > 0 && result.length > 0) {
      const last = result[result.length - 1]
      result[result.length - 1] = {
        ...last,
        text: last.text + tail.slice(0, continuationLength),
      }
    }

    const rest = tail.slice(continuationLength)
    if (rest.length > 0) {
      result.push(
        ...treeSitterToTextChunks(rest, [], this._syntaxStyle, {
          enabled: this._conceal,
          baseHighlight: this._baseHighlight,
        }),
      )
    }

    return result
  }

  // Render the current content using cached highlights through the latest
  // parsed prefix. If the stream extends the same lexical token, the appended
  // token fragment inherits the previous token's style. This avoids both bad
  // extremes: whole-buffer plain flashes and split-token flicker like
  // `User` styled as a type while `Manager` is plain.
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
    const candidates = [
      {
        content: this._streamingStyledPrefixContent,
        filetype: this._streamingStyledPrefixFiletype,
        highlights: this._streamingStyledPrefixHighlights,
      },
      {
        content: this._lastHighlightContent,
        filetype: this._lastHighlightFiletype,
        highlights: this._lastHighlights,
      },
    ]

    let prefixContent = ""
    let prefixSourceHighlights: SimpleHighlight[] = []
    let prefixEnd = 0

    if (!this._onChunks && this._filetype !== undefined) {
      for (const candidate of candidates) {
        if (candidate.filetype !== this._filetype || candidate.content.length === 0) continue
        const candidateEnd = this.getStreamingPrefixEnd(candidate.content, content)
        if (candidateEnd <= prefixEnd) continue
        prefixContent = candidate.content.slice(0, candidateEnd)
        prefixSourceHighlights = candidate.highlights
        prefixEnd = candidateEnd
      }
    }

    if (prefixContent.length === 0) {
      this.textBuffer.setText(content)
      this.updateTextInfo()
      return
    }

    const prefixChunks = this.getCachedPrefixChunks(prefixSourceHighlights, prefixContent, prefixEnd)
    const tail = content.slice(prefixContent.length)
    const chunks = this.appendTailToChunks(prefixChunks, prefixContent, tail)
    const styledText = new StyledText(chunks)
    this.textBuffer.setStyledText(styledText)
    this._shouldRenderTextBuffer = true
    this.updateTextInfo()
  }

  // Streaming UX: when a highlight result lands stale (content has grown
  // while the worker was busy) and the new content extends what we parsed,
  // keep it as a progressive display cache. Skipped when an async onChunks
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

    const prefixEnd = this.getStreamingPrefixEnd(parsedContent, latest)
    if (prefixEnd === 0) return

    // This cache is display-only: it may represent a prefix, so do not write
    // it to _lastHighlights / _lastHighlightContent. The restyle path needs
    // those to remain complete-content highlight results.
    const stabilizedHighlights = this.applyStreamingStyleLocks(parsedContent, parsedHighlights)
    this._streamingStyledPrefixHighlights = this.getHighlightsWithin(stabilizedHighlights, prefixEnd)
    this._streamingStyledPrefixContent = parsedContent.slice(0, prefixEnd)
    this._streamingStyledPrefixFiletype = parsedFiletype

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
    if (!filetype || this._lastHighlightContent !== content || this._filetype !== filetype) {
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
