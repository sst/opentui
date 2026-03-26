import { Renderable, type RenderableOptions } from "../Renderable.js"
import { type RenderContext } from "../types.js"
import { SyntaxStyle, type StyleDefinition } from "../syntax-style.js"
import type { TextChunk } from "../text-buffer.js"
import { createTextAttributes } from "../utils.js"
import type { BorderStyle } from "../lib/border.js"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA.js"
import { type MarkedToken, type Token, type Tokens } from "marked"
import { CodeRenderable, type OnChunksCallback } from "./Code.js"
import {
  TextTableRenderable,
  type TextTableCellContent,
  type TextTableColumnFitter,
  type TextTableColumnWidthMode,
  type TextTableContent,
} from "./TextTable.js"
import type { TreeSitterClient } from "../lib/tree-sitter/index.js"
import { infoStringToFiletype } from "../lib/tree-sitter/resolve-ft.js"
import { parseMarkdownIncremental, type ParseState } from "./markdown-parser.js"
import type { OptimizedBuffer } from "../buffer.js"
import { detectLinks } from "../lib/detect-links.js"

export interface MarkdownTableOptions {
  /**
   * Strategy for sizing table columns.
   * - "content": columns fit to intrinsic content width.
   * - "full": columns expand to fill available width.
   */
  widthMode?: TextTableColumnWidthMode
  /**
   * Column fitting method when shrinking constrained tables.
   */
  columnFitter?: TextTableColumnFitter
  /**
   * Wrapping strategy for table cell content.
   */
  wrapMode?: "none" | "char" | "word"
  /**
   * Padding applied on all sides of each table cell.
   */
  cellPadding?: number
  /**
   * Enables/disables table border rendering.
   */
  borders?: boolean
  /**
   * Overrides outer border visibility. Defaults to `borders`.
   */
  outerBorder?: boolean
  /**
   * Border style for markdown tables.
   */
  borderStyle?: BorderStyle
  /**
   * Border color for markdown tables. Defaults to conceal style color.
   */
  borderColor?: ColorInput
  /**
   * Enables/disables selection support on markdown tables.
   */
  selectable?: boolean
}

export interface MarkdownOptions extends RenderableOptions<MarkdownRenderable> {
  content?: string
  syntaxStyle: SyntaxStyle
  fg?: ColorInput
  bg?: ColorInput
  /** Controls concealment for markdown syntax markers in markdown text blocks. */
  conceal?: boolean
  /** Controls concealment inside fenced code blocks rendered by CodeRenderable. */
  concealCode?: boolean
  treeSitterClient?: TreeSitterClient
  /**
   * Enable streaming mode for incremental content updates.
   *
   * Semantics:
   * - The trailing markdown block stays unstable while streaming is enabled.
   * - Tables render all rows produced by the markdown parser (including trailing rows).
   * - Incomplete table rows are normalized by the parser and rendered with empty cells
   *   where data is missing.
   *
   * Expectations:
   * - Keep this true while chunks are still being appended.
   * - Set this to false once streaming is complete to finalize trailing token parsing.
   */
  streaming?: boolean
  /**
   * Options for internally rendered markdown tables.
   */
  tableOptions?: MarkdownTableOptions
  /**
   * Custom node renderer. Return a Renderable to override default rendering,
   * or undefined/null to use default rendering.
   */
  renderNode?: (token: Token, context: RenderNodeContext) => Renderable | undefined | null
}

export interface RenderNodeContext {
  syntaxStyle: SyntaxStyle
  conceal: boolean
  concealCode: boolean
  treeSitterClient?: TreeSitterClient
  /** Creates default renderable for this token */
  defaultRender: () => Renderable | null
}

interface TableContentCache {
  content: TextTableContent
  cellKeys: Uint32Array[]
}

interface ResolvedTableRenderableOptions {
  columnWidthMode: TextTableColumnWidthMode
  columnFitter: TextTableColumnFitter
  wrapMode: "none" | "char" | "word"
  cellPadding: number
  border: boolean
  outerBorder: boolean
  showBorders: boolean
  borderStyle: BorderStyle
  borderColor: ColorInput
  selectable: boolean
}

const TRAILING_MARKDOWN_BLOCK_BREAKS_RE = /(?:\r?\n){2,}$/

function colorsEqual(left?: RGBA, right?: RGBA): boolean {
  if (!left || !right) return left === right
  return left.equals(right)
}

export interface BlockState {
  token: MarkedToken
  tokenRaw: string // Cache raw for comparison
  renderable: Renderable
  tableContentCache?: TableContentCache
}

export type { ParseState }

export class MarkdownRenderable extends Renderable {
  private _content: string = ""
  private _syntaxStyle: SyntaxStyle
  private _fg?: RGBA
  private _bg?: RGBA
  private _conceal: boolean
  private _concealCode: boolean
  private _treeSitterClient?: TreeSitterClient
  private _tableOptions?: MarkdownTableOptions
  private _renderNode?: MarkdownOptions["renderNode"]

  _parseState: ParseState | null = null
  private _streaming: boolean = false
  _blockStates: BlockState[] = []
  private _styleDirty: boolean = false
  private _linkifyMarkdownChunks: OnChunksCallback = (chunks, context) =>
    detectLinks(chunks, {
      content: context.content,
      highlights: context.highlights,
    })

  protected _contentDefaultOptions = {
    content: "",
    conceal: true,
    concealCode: false,
    streaming: false,
  } satisfies Partial<MarkdownOptions>

  constructor(ctx: RenderContext, options: MarkdownOptions) {
    super(ctx, {
      ...options,
      flexDirection: "column",
      flexShrink: options.flexShrink ?? 0,
    })

    this._syntaxStyle = options.syntaxStyle
    this._fg = options.fg ? parseColor(options.fg) : undefined
    this._bg = options.bg ? parseColor(options.bg) : undefined
    this._conceal = options.conceal ?? this._contentDefaultOptions.conceal
    this._concealCode = options.concealCode ?? this._contentDefaultOptions.concealCode
    this._content = options.content ?? this._contentDefaultOptions.content
    this._treeSitterClient = options.treeSitterClient
    this._tableOptions = options.tableOptions
    this._renderNode = options.renderNode
    this._streaming = options.streaming ?? this._contentDefaultOptions.streaming

    this.updateBlocks()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this.isDestroyed) return
    if (this._content !== value) {
      this._content = value
      this.updateBlocks()
      this.requestRender()
    }
  }

  get syntaxStyle(): SyntaxStyle {
    return this._syntaxStyle
  }

  set syntaxStyle(value: SyntaxStyle) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      // Mark dirty - actual re-render happens in renderSelf
      this._styleDirty = true
    }
  }

  get fg(): RGBA | undefined {
    return this._fg
  }

  set fg(value: ColorInput | undefined) {
    const next = value ? parseColor(value) : undefined
    if (!colorsEqual(this._fg, next)) {
      this._fg = next
      this._styleDirty = true
    }
  }

  get bg(): RGBA | undefined {
    return this._bg
  }

  set bg(value: ColorInput | undefined) {
    const next = value ? parseColor(value) : undefined
    if (!colorsEqual(this._bg, next)) {
      this._bg = next
      this._styleDirty = true
    }
  }

  get conceal(): boolean {
    return this._conceal
  }

  set conceal(value: boolean) {
    if (this._conceal !== value) {
      this._conceal = value
      // Mark dirty - actual re-render happens in renderSelf
      this._styleDirty = true
    }
  }

  get concealCode(): boolean {
    return this._concealCode
  }

  set concealCode(value: boolean) {
    if (this._concealCode !== value) {
      this._concealCode = value
      // Mark dirty - actual re-render happens in renderSelf
      this._styleDirty = true
    }
  }

  get streaming(): boolean {
    return this._streaming
  }

  set streaming(value: boolean) {
    if (this.isDestroyed) return
    if (this._streaming !== value) {
      this._streaming = value
      this.updateBlocks(true)
    }
  }

  get tableOptions(): MarkdownTableOptions | undefined {
    return this._tableOptions
  }

  set tableOptions(value: MarkdownTableOptions | undefined) {
    this._tableOptions = value
    this.applyTableOptionsToBlocks()
  }

  private getStyle(group: string): StyleDefinition | undefined {
    // The solid reconciler applies props via setters in JSX declaration order.
    // If `content` is set before `syntaxStyle`, updateBlocks() runs before
    // _syntaxStyle is initialized.
    if (!this._syntaxStyle) return undefined
    let style = this._syntaxStyle.getStyle(group)
    if (!style && group.includes(".")) {
      const baseName = group.split(".")[0]
      style = this._syntaxStyle.getStyle(baseName)
    }
    return style
  }

  private createChunk(text: string, group: string, link?: { url: string }): TextChunk {
    const style = this.getStyle(group) || this.getStyle("default")
    return {
      __isChunk: true,
      text,
      fg: style?.fg,
      bg: style?.bg,
      attributes: style
        ? createTextAttributes({
            bold: style.bold,
            italic: style.italic,
            underline: style.underline,
            dim: style.dim,
          })
        : 0,
      link,
    }
  }

  private createDefaultChunk(text: string): TextChunk {
    return this.createChunk(text, "default")
  }

  private renderInlineContent(tokens: Token[], chunks: TextChunk[]): void {
    for (const token of tokens) {
      this.renderInlineToken(token as MarkedToken, chunks)
    }
  }

  private renderInlineToken(token: MarkedToken, chunks: TextChunk[]): void {
    switch (token.type) {
      case "text":
        chunks.push(this.createDefaultChunk(token.text))
        break

      case "escape":
        chunks.push(this.createDefaultChunk(token.text))
        break

      case "codespan":
        if (this._conceal) {
          chunks.push(this.createChunk(token.text, "markup.raw"))
        } else {
          chunks.push(this.createChunk("`", "markup.raw"))
          chunks.push(this.createChunk(token.text, "markup.raw"))
          chunks.push(this.createChunk("`", "markup.raw"))
        }
        break

      case "strong":
        if (!this._conceal) {
          chunks.push(this.createChunk("**", "markup.strong"))
        }
        for (const child of token.tokens) {
          this.renderInlineTokenWithStyle(child as MarkedToken, chunks, "markup.strong")
        }
        if (!this._conceal) {
          chunks.push(this.createChunk("**", "markup.strong"))
        }
        break

      case "em":
        if (!this._conceal) {
          chunks.push(this.createChunk("*", "markup.italic"))
        }
        for (const child of token.tokens) {
          this.renderInlineTokenWithStyle(child as MarkedToken, chunks, "markup.italic")
        }
        if (!this._conceal) {
          chunks.push(this.createChunk("*", "markup.italic"))
        }
        break

      case "del":
        if (!this._conceal) {
          chunks.push(this.createChunk("~~", "markup.strikethrough"))
        }
        for (const child of token.tokens) {
          this.renderInlineTokenWithStyle(child as MarkedToken, chunks, "markup.strikethrough")
        }
        if (!this._conceal) {
          chunks.push(this.createChunk("~~", "markup.strikethrough"))
        }
        break

      case "link": {
        const linkHref = { url: token.href }
        if (this._conceal) {
          for (const child of token.tokens) {
            this.renderInlineTokenWithStyle(child as MarkedToken, chunks, "markup.link.label", linkHref)
          }
          chunks.push(this.createChunk(" (", "markup.link", linkHref))
          chunks.push(this.createChunk(token.href, "markup.link.url", linkHref))
          chunks.push(this.createChunk(")", "markup.link", linkHref))
        } else {
          chunks.push(this.createChunk("[", "markup.link", linkHref))
          for (const child of token.tokens) {
            this.renderInlineTokenWithStyle(child as MarkedToken, chunks, "markup.link.label", linkHref)
          }
          chunks.push(this.createChunk("](", "markup.link", linkHref))
          chunks.push(this.createChunk(token.href, "markup.link.url", linkHref))
          chunks.push(this.createChunk(")", "markup.link", linkHref))
        }
        break
      }

      case "image": {
        const imageHref = { url: token.href }
        if (this._conceal) {
          chunks.push(this.createChunk(token.text || "image", "markup.link.label", imageHref))
        } else {
          chunks.push(this.createChunk("![", "markup.link", imageHref))
          chunks.push(this.createChunk(token.text || "", "markup.link.label", imageHref))
          chunks.push(this.createChunk("](", "markup.link", imageHref))
          chunks.push(this.createChunk(token.href, "markup.link.url", imageHref))
          chunks.push(this.createChunk(")", "markup.link", imageHref))
        }
        break
      }

      case "br":
        chunks.push(this.createDefaultChunk("\n"))
        break

      default:
        if ("tokens" in token && Array.isArray(token.tokens)) {
          this.renderInlineContent(token.tokens, chunks)
        } else if ("text" in token && typeof token.text === "string") {
          chunks.push(this.createDefaultChunk(token.text))
        }
        break
    }
  }

  private renderInlineTokenWithStyle(
    token: MarkedToken,
    chunks: TextChunk[],
    styleGroup: string,
    link?: { url: string },
  ): void {
    switch (token.type) {
      case "text":
        chunks.push(this.createChunk(token.text, styleGroup, link))
        break

      case "escape":
        chunks.push(this.createChunk(token.text, styleGroup, link))
        break

      case "codespan":
        if (this._conceal) {
          chunks.push(this.createChunk(token.text, "markup.raw", link))
        } else {
          chunks.push(this.createChunk("`", "markup.raw", link))
          chunks.push(this.createChunk(token.text, "markup.raw", link))
          chunks.push(this.createChunk("`", "markup.raw", link))
        }
        break

      default:
        this.renderInlineToken(token, chunks)
        break
    }
  }

  private createMarkdownCodeRenderable(content: string, id: string, marginBottom: number = 0): CodeRenderable {
    return new CodeRenderable(this.ctx, {
      id,
      content,
      filetype: "markdown",
      syntaxStyle: this._syntaxStyle,
      fg: this._fg,
      bg: this._bg,
      conceal: this._conceal,
      drawUnstyledText: false,
      streaming: true,
      onChunks: this._linkifyMarkdownChunks,
      treeSitterClient: this._treeSitterClient,
      width: "100%",
      marginBottom,
    })
  }

  private createCodeRenderable(token: Tokens.Code, id: string, marginBottom: number = 0): Renderable {
    return new CodeRenderable(this.ctx, {
      id,
      content: token.text,
      filetype: infoStringToFiletype(token.lang ?? ""),
      syntaxStyle: this._syntaxStyle,
      fg: this._fg,
      bg: this._bg,
      conceal: this._concealCode,
      drawUnstyledText: !(this._streaming && this._concealCode),
      streaming: this._streaming,
      treeSitterClient: this._treeSitterClient,
      width: "100%",
      marginBottom,
    })
  }

  private applyMarkdownCodeRenderable(renderable: CodeRenderable, content: string, marginBottom: number): void {
    renderable.content = content
    renderable.filetype = "markdown"
    renderable.syntaxStyle = this._syntaxStyle
    renderable.fg = this._fg
    renderable.bg = this._bg
    renderable.conceal = this._conceal
    renderable.drawUnstyledText = false
    renderable.streaming = true
    renderable.marginBottom = marginBottom
  }

  private applyCodeBlockRenderable(renderable: CodeRenderable, token: Tokens.Code, marginBottom: number): void {
    renderable.content = token.text
    renderable.filetype = infoStringToFiletype(token.lang ?? "")
    renderable.syntaxStyle = this._syntaxStyle
    renderable.fg = this._fg
    renderable.bg = this._bg
    renderable.conceal = this._concealCode
    renderable.drawUnstyledText = !(this._streaming && this._concealCode)
    renderable.streaming = this._streaming
    renderable.marginBottom = marginBottom
  }

  private shouldRenderSeparately(token: MarkedToken): boolean {
    return token.type === "code" || token.type === "table" || token.type === "blockquote"
  }

  private getInterBlockMargin(token: MarkedToken, hasNextToken: boolean): number {
    if (!hasNextToken) return 0
    return this.shouldRenderSeparately(token) ? 1 : 0
  }

  private createMarkdownBlockToken(raw: string): MarkedToken {
    return {
      type: "paragraph",
      raw,
      text: raw,
      tokens: [],
    } as MarkedToken
  }

  private normalizeMarkdownBlockRaw(raw: string): string {
    return raw.replace(TRAILING_MARKDOWN_BLOCK_BREAKS_RE, "\n")
  }

  private buildRenderableTokens(tokens: MarkedToken[]): MarkedToken[] {
    if (this._renderNode) {
      return tokens.filter((token) => token.type !== "space")
    }

    const renderTokens: MarkedToken[] = []
    let markdownRaw = ""

    const flushMarkdownRaw = (): void => {
      if (markdownRaw.length === 0) return
      const normalizedRaw = this.normalizeMarkdownBlockRaw(markdownRaw)
      if (normalizedRaw.length > 0) {
        renderTokens.push(this.createMarkdownBlockToken(normalizedRaw))
      }
      markdownRaw = ""
    }

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]

      if (token.type === "space") {
        if (markdownRaw.length === 0) {
          continue
        }

        let nextIndex = i + 1
        while (nextIndex < tokens.length && tokens[nextIndex].type === "space") {
          nextIndex += 1
        }

        const nextToken = tokens[nextIndex]
        if (nextToken && !this.shouldRenderSeparately(nextToken)) {
          markdownRaw += token.raw
        }
        continue
      }

      if (this.shouldRenderSeparately(token)) {
        flushMarkdownRaw()
        renderTokens.push(token)
        continue
      }

      markdownRaw += token.raw
    }

    flushMarkdownRaw()

    return renderTokens
  }

  private getTableRowsToRender(table: Tokens.Table): Tokens.TableCell[][] {
    return table.rows
  }

  private hashString(value: string, seed: number): number {
    let hash = seed >>> 0
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  private hashTableToken(token: MarkedToken, seed: number, depth: number = 0): number {
    let hash = this.hashString(token.type, seed)

    if ("raw" in token && typeof token.raw === "string") {
      return this.hashString(token.raw, hash)
    }

    if ("text" in token && typeof token.text === "string") {
      hash = this.hashString(token.text, hash)
    }

    if (depth < 2 && "tokens" in token && Array.isArray(token.tokens)) {
      for (const child of token.tokens) {
        hash = this.hashTableToken(child as MarkedToken, hash, depth + 1)
      }
    }

    return hash >>> 0
  }

  private getTableCellKey(cell: Tokens.TableCell | undefined, isHeader: boolean): number {
    const seed = isHeader ? 2902232141 : 1371922141
    if (!cell) {
      return seed
    }

    if (typeof cell.text === "string") {
      return this.hashString(cell.text, seed)
    }

    if (Array.isArray(cell.tokens) && cell.tokens.length > 0) {
      let hash = seed ^ cell.tokens.length
      for (const token of cell.tokens) {
        hash = this.hashTableToken(token as MarkedToken, hash)
      }
      return hash >>> 0
    }

    return (seed ^ 2654435769) >>> 0
  }

  private createTableDataCellChunks(cell: Tokens.TableCell | undefined): TextChunk[] {
    const chunks: TextChunk[] = []
    if (cell) {
      this.renderInlineContent(cell.tokens, chunks)
    }
    return chunks.length > 0 ? chunks : [this.createDefaultChunk(" ")]
  }

  private createTableHeaderCellChunks(cell: Tokens.TableCell): TextChunk[] {
    const chunks: TextChunk[] = []
    this.renderInlineContent(cell.tokens, chunks)

    const baseChunks = chunks.length > 0 ? chunks : [this.createDefaultChunk(" ")]
    const headingStyle = this.getStyle("markup.heading") || this.getStyle("default")
    if (!headingStyle) {
      return baseChunks
    }

    const headingAttributes = createTextAttributes({
      bold: headingStyle.bold,
      italic: headingStyle.italic,
      underline: headingStyle.underline,
      dim: headingStyle.dim,
    })

    return baseChunks.map((chunk) => ({
      ...chunk,
      fg: headingStyle.fg ?? chunk.fg,
      bg: headingStyle.bg ?? chunk.bg,
      attributes: headingAttributes,
    }))
  }

  private buildTableContentCache(
    table: Tokens.Table,
    previous?: TableContentCache,
    forceRegenerate: boolean = false,
  ): { cache: TableContentCache | null; changed: boolean } {
    const colCount = table.header.length
    const rowsToRender = this.getTableRowsToRender(table)
    if (colCount === 0 || rowsToRender.length === 0) {
      return { cache: null, changed: previous !== undefined }
    }

    const content: TextTableContent = []
    const cellKeys: Uint32Array[] = []
    const totalRows = rowsToRender.length + 1

    let changed = forceRegenerate || !previous

    for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
      const rowContent: TextTableCellContent[] = []
      const rowKeys = new Uint32Array(colCount)

      for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
        const isHeader = rowIndex === 0
        const cell = isHeader ? table.header[colIndex] : rowsToRender[rowIndex - 1]?.[colIndex]
        const cellKey = this.getTableCellKey(cell, isHeader)
        rowKeys[colIndex] = cellKey

        const previousCellKey = previous?.cellKeys[rowIndex]?.[colIndex]
        const previousCellContent = previous?.content[rowIndex]?.[colIndex]

        if (!forceRegenerate && previousCellKey === cellKey && Array.isArray(previousCellContent)) {
          rowContent.push(previousCellContent)
          continue
        }

        changed = true
        rowContent.push(
          isHeader ? this.createTableHeaderCellChunks(table.header[colIndex]) : this.createTableDataCellChunks(cell),
        )
      }

      content.push(rowContent)
      cellKeys.push(rowKeys)
    }

    if (previous && !changed) {
      if (previous.content.length !== content.length) {
        changed = true
      } else {
        for (let rowIndex = 0; rowIndex < content.length; rowIndex += 1) {
          if ((previous.content[rowIndex]?.length ?? 0) !== content[rowIndex].length) {
            changed = true
            break
          }
        }
      }
    }

    return {
      cache: {
        content,
        cellKeys,
      },
      changed,
    }
  }

  private resolveTableRenderableOptions(): ResolvedTableRenderableOptions {
    const borders = this._tableOptions?.borders ?? true

    return {
      columnWidthMode: this._tableOptions?.widthMode ?? "full",
      columnFitter: this._tableOptions?.columnFitter ?? "proportional",
      wrapMode: this._tableOptions?.wrapMode ?? "word",
      cellPadding: this._tableOptions?.cellPadding ?? 0,
      border: borders,
      outerBorder: this._tableOptions?.outerBorder ?? borders,
      showBorders: borders,
      borderStyle: this._tableOptions?.borderStyle ?? "single",
      borderColor: this._tableOptions?.borderColor ?? this.getStyle("conceal")?.fg ?? "#888888",
      selectable: this._tableOptions?.selectable ?? true,
    }
  }

  private applyTableRenderableOptions(
    tableRenderable: TextTableRenderable,
    options: ResolvedTableRenderableOptions,
  ): void {
    tableRenderable.columnWidthMode = options.columnWidthMode
    tableRenderable.columnFitter = options.columnFitter
    tableRenderable.wrapMode = options.wrapMode
    tableRenderable.cellPadding = options.cellPadding
    tableRenderable.border = options.border
    tableRenderable.outerBorder = options.outerBorder
    tableRenderable.showBorders = options.showBorders
    tableRenderable.borderStyle = options.borderStyle
    tableRenderable.borderColor = options.borderColor
    tableRenderable.selectable = options.selectable
  }

  private applyTableOptionsToBlocks(): void {
    const options = this.resolveTableRenderableOptions()
    let updated = false

    for (const state of this._blockStates) {
      if (state.renderable instanceof TextTableRenderable) {
        this.applyTableRenderableOptions(state.renderable, options)
        updated = true
      }
    }

    if (updated) {
      this.requestRender()
    }
  }

  private createTextTableRenderable(
    content: TextTableContent,
    id: string,
    marginBottom: number = 0,
  ): TextTableRenderable {
    const options = this.resolveTableRenderableOptions()
    return new TextTableRenderable(this.ctx, {
      id,
      content,
      width: "100%",
      marginBottom,
      columnWidthMode: options.columnWidthMode,
      columnFitter: options.columnFitter,
      wrapMode: options.wrapMode,
      cellPadding: options.cellPadding,
      border: options.border,
      outerBorder: options.outerBorder,
      showBorders: options.showBorders,
      borderStyle: options.borderStyle,
      borderColor: options.borderColor,
      selectable: options.selectable,
    })
  }

  private createTableBlock(
    table: Tokens.Table,
    id: string,
    marginBottom: number = 0,
    previousCache?: TableContentCache,
    forceRegenerate: boolean = false,
  ): { renderable: Renderable; tableContentCache?: TableContentCache } {
    const { cache } = this.buildTableContentCache(table, previousCache, forceRegenerate)

    if (!cache) {
      return {
        renderable: this.createMarkdownCodeRenderable(table.raw, id, marginBottom),
      }
    }

    return {
      renderable: this.createTextTableRenderable(cache.content, id, marginBottom),
      tableContentCache: cache,
    }
  }

  private createDefaultRenderable(token: MarkedToken, index: number, hasNextToken: boolean = false): Renderable | null {
    const id = `${this.id}-block-${index}`
    const marginBottom = this.getInterBlockMargin(token, hasNextToken)

    if (token.type === "code") {
      return this.createCodeRenderable(token, id, marginBottom)
    }

    if (token.type === "table") {
      return this.createTableBlock(token, id, marginBottom).renderable
    }

    if (token.type === "space") {
      return null
    }

    if (!token.raw) {
      return null
    }

    return this.createMarkdownCodeRenderable(token.raw, id, marginBottom)
  }

  private updateBlockRenderable(state: BlockState, token: MarkedToken, index: number, hasNextToken: boolean): void {
    const marginBottom = this.getInterBlockMargin(token, hasNextToken)

    if (token.type === "code") {
      this.applyCodeBlockRenderable(state.renderable as CodeRenderable, token as Tokens.Code, marginBottom)
      return
    }

    if (token.type === "table") {
      const tableToken = token as Tokens.Table
      const { cache, changed } = this.buildTableContentCache(tableToken, state.tableContentCache)

      if (!cache) {
        if (state.renderable instanceof CodeRenderable) {
          this.applyMarkdownCodeRenderable(state.renderable, tableToken.raw, marginBottom)
          state.tableContentCache = undefined
          return
        }

        state.renderable.destroyRecursively()
        const fallbackRenderable = this.createMarkdownCodeRenderable(
          tableToken.raw,
          `${this.id}-block-${index}`,
          marginBottom,
        )
        this.add(fallbackRenderable)
        state.renderable = fallbackRenderable
        state.tableContentCache = undefined
        return
      }

      if (state.renderable instanceof TextTableRenderable) {
        if (changed) {
          state.renderable.content = cache.content
        }
        this.applyTableRenderableOptions(state.renderable, this.resolveTableRenderableOptions())
        state.renderable.marginBottom = marginBottom
        state.tableContentCache = cache
        return
      }

      state.renderable.destroyRecursively()
      const tableRenderable = this.createTextTableRenderable(cache.content, `${this.id}-block-${index}`, marginBottom)
      this.add(tableRenderable)
      state.renderable = tableRenderable
      state.tableContentCache = cache
      return
    }

    if (state.renderable instanceof CodeRenderable) {
      this.applyMarkdownCodeRenderable(state.renderable, token.raw, marginBottom)
      return
    }

    state.renderable.destroyRecursively()
    const markdownRenderable = this.createMarkdownCodeRenderable(token.raw, `${this.id}-block-${index}`, marginBottom)
    this.add(markdownRenderable)
    state.renderable = markdownRenderable
  }

  private updateBlocks(forceTableRefresh: boolean = false): void {
    if (this.isDestroyed) return
    if (!this._content) {
      this.clearBlockStates()
      this._parseState = null
      return
    }

    const trailingUnstable = this._streaming ? 2 : 0
    this._parseState = parseMarkdownIncremental(this._content, this._parseState, trailingUnstable)

    const tokens = this._parseState.tokens

    // Parse failure fallback
    if (tokens.length === 0 && this._content.length > 0) {
      this.clearBlockStates()
      const fallback = this.createMarkdownCodeRenderable(this._content, `${this.id}-fallback`)
      this.add(fallback)
      this._blockStates = [
        {
          token: { type: "text", raw: this._content, text: this._content } as MarkedToken,
          tokenRaw: this._content,
          renderable: fallback,
        },
      ]
      return
    }

    const blockTokens = this.buildRenderableTokens(tokens)
    const lastBlockIndex = blockTokens.length - 1

    let blockIndex = 0
    for (let i = 0; i < blockTokens.length; i++) {
      const token = blockTokens[i]
      const hasNextToken = i < lastBlockIndex
      const existing = this._blockStates[blockIndex]

      const shouldForceRefresh = forceTableRefresh

      // Same token object reference means unchanged
      if (existing && existing.token === token) {
        if (shouldForceRefresh) {
          this.updateBlockRenderable(existing, token, blockIndex, hasNextToken)
          existing.tokenRaw = token.raw
        }
        blockIndex++
        continue
      }

      // Same content, update reference
      if (existing && existing.tokenRaw === token.raw && existing.token.type === token.type) {
        existing.token = token
        if (shouldForceRefresh) {
          this.updateBlockRenderable(existing, token, blockIndex, hasNextToken)
          existing.tokenRaw = token.raw
        }
        blockIndex++
        continue
      }

      // Same type, different content - update in place
      if (existing && existing.token.type === token.type) {
        this.updateBlockRenderable(existing, token, blockIndex, hasNextToken)
        existing.token = token
        existing.tokenRaw = token.raw
        blockIndex++
        continue
      }

      // Different type or new block
      if (existing) {
        existing.renderable.destroyRecursively()
      }

      let renderable: Renderable | undefined
      let tableContentCache: TableContentCache | undefined

      if (this._renderNode) {
        const context: RenderNodeContext = {
          syntaxStyle: this._syntaxStyle,
          conceal: this._conceal,
          concealCode: this._concealCode,
          treeSitterClient: this._treeSitterClient,
          defaultRender: () => this.createDefaultRenderable(token, blockIndex, hasNextToken),
        }
        const custom = this._renderNode(token, context)
        if (custom) {
          renderable = custom
        }
      }

      if (!renderable) {
        if (token.type === "table") {
          const tableBlock = this.createTableBlock(
            token,
            `${this.id}-block-${blockIndex}`,
            this.getInterBlockMargin(token, hasNextToken),
          )
          renderable = tableBlock.renderable
          tableContentCache = tableBlock.tableContentCache
        } else {
          renderable = this.createDefaultRenderable(token, blockIndex, hasNextToken) ?? undefined
        }
      }

      if (token.type === "table" && !tableContentCache && renderable instanceof TextTableRenderable) {
        const { cache } = this.buildTableContentCache(token as Tokens.Table)
        tableContentCache = cache ?? undefined
      }

      if (renderable) {
        this.add(renderable)
        this._blockStates[blockIndex] = {
          token,
          tokenRaw: token.raw,
          renderable,
          tableContentCache,
        }
      }
      blockIndex++
    }

    while (this._blockStates.length > blockIndex) {
      const removed = this._blockStates.pop()!
      removed.renderable.destroyRecursively()
    }
  }

  private clearBlockStates(): void {
    for (const state of this._blockStates) {
      state.renderable.destroyRecursively()
    }
    this._blockStates = []
  }

  /**
   * Re-render existing blocks without rebuilding the parse state or block structure.
   * Used when only style/conceal changes - much faster than full rebuild.
   */
  private rerenderBlocks(): void {
    for (let i = 0; i < this._blockStates.length; i++) {
      const state = this._blockStates[i]
      const hasNextToken = i < this._blockStates.length - 1
      const marginBottom = this.getInterBlockMargin(state.token, hasNextToken)

      if (state.token.type === "code") {
        this.applyCodeBlockRenderable(state.renderable as CodeRenderable, state.token as Tokens.Code, marginBottom)
        continue
      }

      if (state.token.type === "table") {
        const tableToken = state.token as Tokens.Table
        const { cache } = this.buildTableContentCache(tableToken, state.tableContentCache, true)

        if (!cache) {
          if (state.renderable instanceof CodeRenderable) {
            this.applyMarkdownCodeRenderable(state.renderable, tableToken.raw, marginBottom)
          } else {
            state.renderable.destroyRecursively()
            const fallbackRenderable = this.createMarkdownCodeRenderable(
              tableToken.raw,
              `${this.id}-block-${i}`,
              marginBottom,
            )
            this.add(fallbackRenderable)
            state.renderable = fallbackRenderable
          }
          state.tableContentCache = undefined
          continue
        }

        if (state.renderable instanceof TextTableRenderable) {
          state.renderable.content = cache.content
          this.applyTableRenderableOptions(state.renderable, this.resolveTableRenderableOptions())
          state.renderable.marginBottom = marginBottom
          state.tableContentCache = cache
          continue
        }

        state.renderable.destroyRecursively()
        const tableRenderable = this.createTextTableRenderable(cache.content, `${this.id}-block-${i}`, marginBottom)
        this.add(tableRenderable)
        state.renderable = tableRenderable
        state.tableContentCache = cache
        continue
      }

      if (state.renderable instanceof CodeRenderable) {
        this.applyMarkdownCodeRenderable(state.renderable, state.token.raw, marginBottom)
        continue
      }

      state.renderable.destroyRecursively()
      const markdownRenderable = this.createMarkdownCodeRenderable(
        state.token.raw,
        `${this.id}-block-${i}`,
        marginBottom,
      )
      this.add(markdownRenderable)
      state.renderable = markdownRenderable
    }
  }

  public clearCache(): void {
    this._parseState = null
    this.clearBlockStates()
    this.updateBlocks()
    this.requestRender()
  }

  public refreshStyles(): void {
    this._styleDirty = false
    this.rerenderBlocks()
    this.requestRender()
  }

  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    // Check if style/conceal changed - re-render blocks before rendering
    if (this._styleDirty) {
      this._styleDirty = false
      this.rerenderBlocks()
    }
    super.renderSelf(buffer, deltaTime)
  }
}
