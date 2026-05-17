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
  private _streamingStyledPrefixHighlights: SimpleHighlight[] = []
  private _streamingStyledPrefixContent: string = ""
  private _streamingStyledPrefixFiletype: string | undefined
  // Memoization slot for the chunks built from the chosen prefix in
  // `applyContentWithCachedStyling`. The prefix is identical between worker
  // round-trips, so during streaming this collapses the per-chunk-arrival
  // `treeSitterToTextChunks(prefix, …)` work to one rebuild per highlight
  // result. Key is the inputs that determine chunk output:
  //   - sourceHighlights identity: the highlights array reference only
  //     changes when a new parser reply lands, so reference equality is
  //     enough — no need to also compare the prefix string, which would
  //     cost O(prefix) bytes per lookup;
  //   - prefixEnd: pins the byte slice we cover within the source;
  //   - syntaxStyle / conceal / baseHighlight: chunk-time style inputs.
  private _cachedPrefixChunks: {
    sourceHighlights: SimpleHighlight[]
    prefixEnd: number
    syntaxStyle: SyntaxStyle
    conceal: boolean
    baseHighlight: string | undefined
    chunks: TextChunk[]
  } | null = null
  private _restyleDirty: boolean = false
  private _restylePromise: Promise<void> = Promise.resolve()
  private _preserveStyledTextUntilHighlight: boolean = false
  // Bumped on every setter that marks either dirty flag. The async restyle
  // path captures this at kick-off and bails after `await transformChunks` if
  // it moved — otherwise stale chunks could land on changed state.
  private _stateRevision: number = 0

  private static readonly STREAMING_KEYWORDS = new Set([
    "abstract",
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "module",
    "namespace",
    "new",
    "of",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "type",
    "typeof",
    "var",
    "void",
    "while",
    "yield",
  ])

  private static readonly STREAMING_OPERATOR_CHARS = new Set([
    "+",
    "-",
    "*",
    "/",
    "%",
    "=",
    "&",
    "|",
    "^",
    "!",
    "<",
    ">",
    "?",
    ":",
    ".",
  ])

  private static readonly STREAMING_PUNCTUATION_CHARS = new Set(["{", "}", "(", ")", "[", "]", ",", ";"])

  // The provisional lexer below is JS/TS-flavored: STREAMING_KEYWORDS lists
  // ECMAScript / TypeScript keywords, and the identifier rules match
  // C-family syntax. For other languages the lexer would mis-color (e.g.
  // colouring Rust's `for`/`if` while missing `fn`/`impl`, or treating
  // Python `pass` as plain). Gate it to filetypes we know map cleanly.
  // Markdown is included so its fenced JS/TS injection regions still get a
  // best-effort tail coloring during streaming.
  private static readonly STREAMING_LEXER_FILETYPES = new Set([
    "typescript",
    "tsx",
    "javascript",
    "jsx",
    "markdown",
  ])

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

  private clearHighlightCache(): void {
    this._lastHighlights = []
    this._lastHighlightContent = ""
    this._lastHighlightFiletype = undefined
    this.clearStreamingDisplayCache()
  }

  private clearStreamingDisplayCache(): void {
    this._streamingStyledPrefixHighlights = []
    this._streamingStyledPrefixContent = ""
    this._streamingStyledPrefixFiletype = undefined
    this._cachedPrefixChunks = null
    this._preserveStyledTextUntilHighlight = false
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
      this.clearHighlightCache()
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
      const endingStreaming = this._streaming && !value
      this._streaming = value
      this._hadInitialContent = false
      // Keep full-content parser highlights when leaving streaming so the
      // final frame can restyle synchronously instead of flashing plain text.
      if (!endingStreaming) {
        this.clearHighlightCache()
      } else {
        this.clearStreamingDisplayCache()
      }
      if (
        endingStreaming &&
        this._lastHighlightContent === this._content &&
        this._lastHighlightFiletype === this._filetype
      ) {
        this._highlightsDirty = false
        this._restyleDirty = true
        this._preserveStyledTextUntilHighlight = false
      } else {
        this._preserveStyledTextUntilHighlight = endingStreaming
        this._highlightsDirty = true
      }
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
      this.clearHighlightCache()
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
    } else if (this._preserveStyledTextUntilHighlight) {
      this._shouldRenderTextBuffer = true
    } else if (shouldDrawUnstyledNow) {
      if (this._streaming && !this._onChunks) {
        this.applyContentWithCachedStyling()
      } else {
        this.textBuffer.setText(content)
      }
      this._shouldRenderTextBuffer = true
    } else {
      this._shouldRenderTextBuffer = false
    }
  }

  private async startHighlight(): Promise<void> {
    const content = this._content
    const filetype = this._filetype
    const snapshotId = ++this._highlightSnapshotId
    const revision = this._stateRevision

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

      if (revision !== this._stateRevision) {
        bailStale()
        return
      }

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

      if (snapshotId !== this._highlightSnapshotId || revision !== this._stateRevision) {
        bailStale()
        return
      }

      if (this.isDestroyed) return

      // Cache for the cheap-restyle path: H3 reuses these highlights when
      // only chunk-affecting state changes (conceal, syntaxStyle, etc).
      this._lastHighlights = highlights
      this._lastHighlightContent = content
      this._lastHighlightFiletype = filetype
      this._streamingStyledPrefixHighlights = highlights
      this._streamingStyledPrefixContent = content
      this._streamingStyledPrefixFiletype = filetype

      if (this._streaming && this._drawUnstyledText && !this._onChunks) {
        const chunks = this.getStreamingDisplayChunks(content, content, highlights)
        const styledText = new StyledText(chunks)
        this.textBuffer.setStyledText(styledText)
      } else if (highlights.length > 0 || this._onChunks || this._baseHighlight) {
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

        if (snapshotId !== this._highlightSnapshotId || revision !== this._stateRevision) {
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
      this._preserveStyledTextUntilHighlight = false
      this._highlightsDirty = false
      this._restyleDirty = false
      this.updateTextInfo()
      this.requestRender()
    } catch (error) {
      if (snapshotId !== this._highlightSnapshotId || revision !== this._stateRevision) {
        bailStale()
        return
      }

      console.warn("Code highlighting failed, falling back to plain text:", error)
      if (this.isDestroyed) return
      this.textBuffer.setText(content)
      this._shouldRenderTextBuffer = true
      this._isHighlighting = false
      this._preserveStyledTextUntilHighlight = false
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
    this.clearHighlightCache()
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

  private getStableStreamingPrefixEnd(content: string): number {
    const lineBreak = content.lastIndexOf("\n")
    return lineBreak === -1 ? 0 : lineBreak + 1
  }

  // Per-char classifiers used by the provisional lexer. Inlined with
  // charCodeAt comparisons rather than RegExp.test — both are called once
  // per character on every streaming chunk, and charCode comparisons are
  // ~5–10× faster than even cached one-char regexes.
  private static isWhitespaceCode(c: number): boolean {
    // space, tab, newline, carriage return
    return c === 32 || c === 9 || c === 10 || c === 13
  }
  private static isDigitCode(c: number): boolean {
    return c >= 48 && c <= 57
  }
  private static isDigitOrUnderscoreCode(c: number): boolean {
    return (c >= 48 && c <= 57) || c === 95
  }
  private static isIdentifierStartCode(c: number): boolean {
    // A-Z, a-z, _, $
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36
  }
  private static isIdentifierPartCode(c: number): boolean {
    // A-Z, a-z, 0-9, _, $
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 36
  }
  private static isUppercaseCode(c: number): boolean {
    return c >= 65 && c <= 90
  }

  private getStreamingLexicalHighlights(content: string): SimpleHighlight[] {
    const highlights: SimpleHighlight[] = []
    const length = content.length
    let index = 0

    while (index < length) {
      const start = index
      const code = content.charCodeAt(index)

      if (CodeRenderable.isWhitespaceCode(code)) {
        index++
        continue
      }

      // Line comment `//`
      if (code === 47 && content.charCodeAt(index + 1) === 47) {
        index += 2
        while (index < length && content.charCodeAt(index) !== 10) index++
        highlights.push([start, index, "comment"])
        continue
      }

      // Block comment /* ... */
      if (code === 47 && content.charCodeAt(index + 1) === 42) {
        index += 2
        while (index < length && !(content.charCodeAt(index) === 42 && content.charCodeAt(index + 1) === 47)) index++
        index = Math.min(length, index + 2)
        highlights.push([start, index, "comment"])
        continue
      }

      // Quoted strings: " ' `
      if (code === 34 || code === 39 || code === 96) {
        const quote = code
        index++
        let escaped = false
        while (index < length) {
          const current = content.charCodeAt(index)
          index++
          if (escaped) {
            escaped = false
          } else if (current === 92) {
            // backslash
            escaped = true
          } else if (current === quote) {
            break
          }
        }
        highlights.push([start, index, "string"])
        continue
      }

      // Numbers, including `_` digit separators and a single decimal point
      if (CodeRenderable.isDigitCode(code)) {
        index++
        while (index < length && CodeRenderable.isDigitOrUnderscoreCode(content.charCodeAt(index))) index++
        if (content.charCodeAt(index) === 46 && CodeRenderable.isDigitCode(content.charCodeAt(index + 1))) {
          index++
          while (index < length && CodeRenderable.isDigitOrUnderscoreCode(content.charCodeAt(index))) index++
        }
        highlights.push([start, index, "number"])
        continue
      }

      // Identifiers; keyword/type tagging via the static keyword set.
      if (CodeRenderable.isIdentifierStartCode(code)) {
        index++
        while (index < length && CodeRenderable.isIdentifierPartCode(content.charCodeAt(index))) index++
        const text = content.slice(start, index)
        if (CodeRenderable.STREAMING_KEYWORDS.has(text)) {
          highlights.push([start, index, "keyword"])
        } else if (CodeRenderable.isUppercaseCode(content.charCodeAt(start))) {
          highlights.push([start, index, "type"])
        }
        continue
      }

      const char = content[index]
      if (CodeRenderable.STREAMING_OPERATOR_CHARS.has(char)) {
        index++
        while (index < length && CodeRenderable.STREAMING_OPERATOR_CHARS.has(content[index])) index++
        highlights.push([start, index, "operator"])
        continue
      }

      if (CodeRenderable.STREAMING_PUNCTUATION_CHARS.has(char)) {
        index++
        highlights.push([start, index, "punctuation"])
        continue
      }

      index++
    }

    return highlights
  }

  private getStreamingLexicalChunks(content: string): TextChunk[] {
    const lexicalContent =
      this._conceal && this._filetype === "markdown" ? content.replace(/^[ \t]*```.*(?:\n|$)/gm, "") : content

    const filetype = this._filetype
    const useLexer = filetype !== undefined && CodeRenderable.STREAMING_LEXER_FILETYPES.has(filetype)
    const highlights = useLexer ? this.getStreamingLexicalHighlights(lexicalContent) : []

    return treeSitterToTextChunks(lexicalContent, highlights, this._syntaxStyle, {
      enabled: this._conceal,
      baseHighlight: this._baseHighlight,
    })
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
      prefixEnd,
      syntaxStyle: this._syntaxStyle,
      conceal: this._conceal,
      baseHighlight: this._baseHighlight,
      chunks,
    }
    return chunks
  }

  private getStreamingDisplayChunks(
    currentContent: string,
    parserContent: string,
    parserHighlights: SimpleHighlight[],
  ): TextChunk[] {
    const stableEnd = currentContent.startsWith(parserContent)
      ? Math.min(this.getStableStreamingPrefixEnd(currentContent), parserContent.length)
      : 0
    // The spread is load-bearing: getCachedPrefixChunks returns the
    // memoized array directly, and we push tail chunks below — without
    // copying, the next cache hit would see the stale tail.
    const chunks =
      stableEnd > 0
        ? [...this.getCachedPrefixChunks(parserHighlights, currentContent.slice(0, stableEnd), stableEnd)]
        : []
    const tail = currentContent.slice(stableEnd)

    if (tail.length > 0) {
      chunks.push(...this.getStreamingLexicalChunks(tail))
    }

    return chunks
  }

  // Render the current content using parser highlights for completed lines and
  // cheap lexical highlighting for the active streaming tail. Tree-sitter can
  // legitimately reclassify incomplete syntax as more bytes arrive; the
  // provisional lexer trades semantic precision for stable colors while text is
  // still moving.
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
  // Falls back to plain `setText` when an async `onChunks` callback is
  // registered — running it on every
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

    let parserContent = ""
    let prefixSourceHighlights: SimpleHighlight[] = []
    let prefixEnd = 0

    if (!this._onChunks && this._filetype !== undefined) {
      for (const candidate of candidates) {
        if (candidate.filetype !== this._filetype || candidate.content.length === 0) continue
        const candidateEnd = this.getStreamingPrefixEnd(candidate.content, content)
        if (candidateEnd <= prefixEnd) continue
        parserContent = candidate.content.slice(0, candidateEnd)
        prefixSourceHighlights = candidate.highlights
        prefixEnd = candidateEnd
      }
    }

    if (this._onChunks || this._filetype === undefined) {
      this.textBuffer.setText(content)
      this.updateTextInfo()
      return
    }

    const chunks = this.getStreamingDisplayChunks(content, parserContent, prefixSourceHighlights)
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
    this._streamingStyledPrefixHighlights = this.getHighlightsWithin(parsedHighlights, prefixEnd)
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
