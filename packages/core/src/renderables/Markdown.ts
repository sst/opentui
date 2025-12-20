import { Renderable, type RenderableOptions } from "../Renderable"
import { type RenderContext } from "../types"
import { SyntaxStyle, type StyleDefinition } from "../syntax-style"
import { StyledText } from "../lib/styled-text"
import type { TextChunk } from "../text-buffer"
import { createTextAttributes } from "../utils"
import { Lexer, type MarkedToken, type Token, type Tokens } from "marked"
import { TextRenderable } from "./Text"
import { CodeRenderable } from "./Code"
import { BoxRenderable } from "./Box"
import type { TreeSitterClient } from "../lib/tree-sitter"

export interface MarkdownOptions extends RenderableOptions<MarkdownRenderable> {
  content?: string
  syntaxStyle: SyntaxStyle
  conceal?: boolean
  treeSitterClient?: TreeSitterClient
  /**
   * Custom node renderer. Return a Renderable to override default rendering,
   * or undefined/null to use default rendering.
   */
  renderNode?: (token: Token, context: RenderNodeContext) => Renderable | undefined | null
}

export interface RenderNodeContext {
  syntaxStyle: SyntaxStyle
  conceal: boolean
  treeSitterClient?: TreeSitterClient
  /** Creates default renderable for this token */
  defaultRender: () => Renderable | null
}

interface BlockChild {
  token: MarkedToken
  renderable: Renderable
}

export class MarkdownRenderable extends Renderable {
  private _content: string = ""
  private _syntaxStyle: SyntaxStyle
  private _conceal: boolean
  private _treeSitterClient?: TreeSitterClient
  private _renderNode?: MarkdownOptions["renderNode"]

  private _blockChildren: BlockChild[] = []
  private _childCache: Map<string, Renderable> = new Map()

  protected _contentDefaultOptions = {
    content: "",
    conceal: true,
  } satisfies Partial<MarkdownOptions>

  constructor(ctx: RenderContext, options: MarkdownOptions) {
    super(ctx, {
      ...options,
      flexDirection: "column",
    })

    this._syntaxStyle = options.syntaxStyle
    this._conceal = options.conceal ?? this._contentDefaultOptions.conceal
    this._content = options.content ?? this._contentDefaultOptions.content
    this._treeSitterClient = options.treeSitterClient
    this._renderNode = options.renderNode

    this.rebuildChildren()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content !== value) {
      this._content = value
      this.rebuildChildren()
      this.requestRender()
    }
  }

  get syntaxStyle(): SyntaxStyle {
    return this._syntaxStyle
  }

  set syntaxStyle(value: SyntaxStyle) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      this._childCache.clear()
      this.rebuildChildren()
      this.requestRender()
    }
  }

  get conceal(): boolean {
    return this._conceal
  }

  set conceal(value: boolean) {
    if (this._conceal !== value) {
      this._conceal = value
      this.rebuildChildren()
      this.requestRender()
    }
  }

  private getStyle(group: string): StyleDefinition | undefined {
    let style = this._syntaxStyle.getStyle(group)
    if (!style && group.includes(".")) {
      const baseName = group.split(".")[0]
      style = this._syntaxStyle.getStyle(baseName)
    }
    return style
  }

  private createChunk(text: string, group: string): TextChunk {
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
    }
  }

  private createDefaultChunk(text: string): TextChunk {
    return this.createChunk(text, "default")
  }

  private countConcealedChars(token: MarkedToken): number {
    let count = 0

    switch (token.type) {
      case "codespan":
        count += 2
        break
      case "strong":
        count += 4
        if (token.tokens) {
          for (const child of token.tokens) {
            count += this.countConcealedChars(child as MarkedToken)
          }
        }
        break
      case "em":
        count += 2
        if (token.tokens) {
          for (const child of token.tokens) {
            count += this.countConcealedChars(child as MarkedToken)
          }
        }
        break
      case "del":
        count += 4
        if (token.tokens) {
          for (const child of token.tokens) {
            count += this.countConcealedChars(child as MarkedToken)
          }
        }
        break
      case "link":
        if (token.tokens) {
          for (const child of token.tokens) {
            count += this.countConcealedChars(child as MarkedToken)
          }
        }
        count += 2
        break
      default:
        if ("tokens" in token && Array.isArray(token.tokens)) {
          for (const child of token.tokens) {
            count += this.countConcealedChars(child as MarkedToken)
          }
        }
        break
    }

    return count
  }

  private getCellDisplayWidth(cell: Tokens.TableCell): number {
    const baseWidth = Bun.stringWidth(cell.text.trim())
    if (!this._conceal) return baseWidth

    let concealedChars = 0
    for (const child of cell.tokens) {
      concealedChars += this.countConcealedChars(child as MarkedToken)
    }

    return Math.max(0, baseWidth - concealedChars)
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

      case "link":
        if (this._conceal) {
          for (const child of token.tokens) {
            this.renderInlineTokenWithStyle(child as MarkedToken, chunks, "markup.link.label")
          }
          chunks.push(this.createChunk(" (", "markup.link"))
          chunks.push(this.createChunk(token.href, "markup.link.url"))
          chunks.push(this.createChunk(")", "markup.link"))
        } else {
          chunks.push(this.createChunk("[", "markup.link"))
          for (const child of token.tokens) {
            this.renderInlineTokenWithStyle(child as MarkedToken, chunks, "markup.link.label")
          }
          chunks.push(this.createChunk("](", "markup.link"))
          chunks.push(this.createChunk(token.href, "markup.link.url"))
          chunks.push(this.createChunk(")", "markup.link"))
        }
        break

      case "image":
        if (this._conceal) {
          chunks.push(this.createChunk(token.text || "image", "markup.link.label"))
        } else {
          chunks.push(this.createChunk("![", "markup.link"))
          chunks.push(this.createChunk(token.text || "", "markup.link.label"))
          chunks.push(this.createChunk("](", "markup.link"))
          chunks.push(this.createChunk(token.href, "markup.link.url"))
          chunks.push(this.createChunk(")", "markup.link"))
        }
        break

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

  private renderInlineTokenWithStyle(token: MarkedToken, chunks: TextChunk[], styleGroup: string): void {
    switch (token.type) {
      case "text":
        chunks.push(this.createChunk(token.text, styleGroup))
        break

      case "escape":
        chunks.push(this.createChunk(token.text, styleGroup))
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

      default:
        this.renderInlineToken(token, chunks)
        break
    }
  }

  private renderHeadingChunks(token: Tokens.Heading): TextChunk[] {
    const chunks: TextChunk[] = []
    const group = `markup.heading.${token.depth}`
    const marker = "#".repeat(token.depth) + " "

    if (!this._conceal) {
      chunks.push(this.createChunk(marker, group))
    }

    for (const child of token.tokens) {
      this.renderInlineTokenWithStyle(child as MarkedToken, chunks, group)
    }

    return chunks
  }

  private renderParagraphChunks(token: Tokens.Paragraph): TextChunk[] {
    const chunks: TextChunk[] = []
    this.renderInlineContent(token.tokens, chunks)
    return chunks
  }

  private renderBlockquoteChunks(token: Tokens.Blockquote): TextChunk[] {
    const chunks: TextChunk[] = []
    for (const child of token.tokens) {
      chunks.push(this.createChunk("> ", "punctuation.special"))
      const childChunks = this.renderTokenToChunks(child as MarkedToken)
      chunks.push(...childChunks)
      chunks.push(this.createDefaultChunk("\n"))
    }
    return chunks
  }

  private renderListChunks(token: Tokens.List): TextChunk[] {
    const chunks: TextChunk[] = []
    let index = typeof token.start === "number" ? token.start : 1

    for (const item of token.items) {
      if (token.ordered) {
        chunks.push(this.createChunk(`${index}. `, "markup.list"))
        index++
      } else {
        chunks.push(this.createChunk("- ", "markup.list"))
      }

      for (let i = 0; i < item.tokens.length; i++) {
        const child = item.tokens[i]
        if (child.type === "text" && i === 0 && "tokens" in child && child.tokens) {
          this.renderInlineContent(child.tokens, chunks)
          chunks.push(this.createDefaultChunk("\n"))
        } else if (child.type === "paragraph" && i === 0) {
          this.renderInlineContent((child as Tokens.Paragraph).tokens, chunks)
          chunks.push(this.createDefaultChunk("\n"))
        } else {
          const childChunks = this.renderTokenToChunks(child as MarkedToken)
          chunks.push(...childChunks)
          chunks.push(this.createDefaultChunk("\n"))
        }
      }
    }

    return chunks
  }

  private renderThematicBreakChunks(): TextChunk[] {
    return [this.createChunk("---", "punctuation.special")]
  }

  private renderTableChunks(table: Tokens.Table): TextChunk[] {
    const chunks: TextChunk[] = []

    if (table.header.length === 0) {
      return chunks
    }

    if (table.rows.length === 0) {
      chunks.push(this.createDefaultChunk(table.raw))
      return chunks
    }

    const alignments = table.align
    const colCount = table.header.length
    const colWidths: number[] = new Array(colCount).fill(3)

    for (let col = 0; col < colCount; col++) {
      const cell = table.header[col]
      const displayWidth = this.getCellDisplayWidth(cell)
      colWidths[col] = Math.max(colWidths[col], displayWidth)
    }

    for (const row of table.rows) {
      for (let col = 0; col < row.length; col++) {
        const cell = row[col]
        const displayWidth = this.getCellDisplayWidth(cell)
        colWidths[col] = Math.max(colWidths[col], displayWidth)
      }
    }

    // Header row
    chunks.push(this.createChunk("| ", "punctuation.special"))
    for (let col = 0; col < colCount; col++) {
      const width = colWidths[col]
      const cell = table.header[col]
      const displayWidth = this.getCellDisplayWidth(cell)
      const pad = width - displayWidth

      const cellChunks: TextChunk[] = []
      this.renderInlineContent(cell.tokens, cellChunks)
      const style = this.getStyle("markup.heading") || this.getStyle("default")
      for (const chunk of cellChunks) {
        chunks.push({
          ...chunk,
          fg: style?.fg ?? chunk.fg,
          bg: style?.bg ?? chunk.bg,
          attributes: style
            ? createTextAttributes({
                bold: style.bold,
                italic: style.italic,
                underline: style.underline,
                dim: style.dim,
              })
            : chunk.attributes,
        })
      }

      if (pad > 0) {
        chunks.push(this.createDefaultChunk(" ".repeat(pad)))
      }
      chunks.push(this.createChunk(" | ", "punctuation.special"))
    }

    const lastChunk = chunks[chunks.length - 1]
    if (lastChunk.text === " | ") {
      lastChunk.text = " |"
    }
    chunks.push(this.createDefaultChunk("\n"))

    // Delimiter row
    chunks.push(this.createChunk("| ", "punctuation.special"))
    for (let col = 0; col < colCount; col++) {
      const width = colWidths[col]
      const align = alignments[col]
      let delimiter: string
      if (align === "center") {
        delimiter = ":" + "-".repeat(Math.max(1, width - 2)) + ":"
      } else if (align === "left") {
        delimiter = ":" + "-".repeat(Math.max(1, width - 1))
      } else if (align === "right") {
        delimiter = "-".repeat(Math.max(1, width - 1)) + ":"
      } else {
        delimiter = "-".repeat(width)
      }
      chunks.push(this.createChunk(delimiter, "punctuation.special"))
      chunks.push(this.createChunk(" | ", "punctuation.special"))
    }
    const lastDelimChunk = chunks[chunks.length - 1]
    if (lastDelimChunk.text === " | ") {
      lastDelimChunk.text = " |"
    }
    chunks.push(this.createDefaultChunk("\n"))

    // Data rows
    for (const row of table.rows) {
      chunks.push(this.createChunk("| ", "punctuation.special"))
      for (let col = 0; col < colCount; col++) {
        const width = colWidths[col]
        const cell = row[col]
        const displayWidth = cell ? this.getCellDisplayWidth(cell) : 0
        const pad = width - displayWidth

        const cellChunks: TextChunk[] = []
        if (cell) {
          this.renderInlineContent(cell.tokens, cellChunks)
        }
        chunks.push(...cellChunks)

        if (pad > 0) {
          chunks.push(this.createDefaultChunk(" ".repeat(pad)))
        }
        chunks.push(this.createChunk(" | ", "punctuation.special"))
      }

      const lastRowChunk = chunks[chunks.length - 1]
      if (lastRowChunk.text === " | ") {
        lastRowChunk.text = " |"
      }
      chunks.push(this.createDefaultChunk("\n"))
    }

    return chunks
  }

  private renderTokenToChunks(token: MarkedToken): TextChunk[] {
    switch (token.type) {
      case "heading":
        return this.renderHeadingChunks(token)
      case "paragraph":
        return this.renderParagraphChunks(token)
      case "blockquote":
        return this.renderBlockquoteChunks(token)
      case "list":
        return this.renderListChunks(token)
      case "hr":
        return this.renderThematicBreakChunks()
      case "table":
        return this.renderTableChunks(token)
      case "space":
        return []
      default:
        if ("raw" in token && token.raw) {
          return [this.createDefaultChunk(token.raw)]
        }
        return []
    }
  }

  private createTextRenderable(chunks: TextChunk[], id: string, marginBottom: number = 0): TextRenderable {
    return new TextRenderable(this.ctx, {
      id,
      content: new StyledText(chunks),
      width: "100%",
      marginBottom,
    })
  }

  private createCodeRenderable(token: Tokens.Code, id: string, marginBottom: number = 0): Renderable {
    return new CodeRenderable(this.ctx, {
      id,
      content: token.text,
      filetype: token.lang || undefined,
      syntaxStyle: this._syntaxStyle,
      conceal: this._conceal,
      treeSitterClient: this._treeSitterClient,
      width: "100%",
      marginBottom,
    })
  }

  private createTableRenderable(table: Tokens.Table, id: string, marginBottom: number = 0): Renderable {
    const colCount = table.header.length

    if (colCount === 0 || table.rows.length === 0) {
      return this.createTextRenderable([this.createDefaultChunk(table.raw)], id, marginBottom)
    }

    const tableBox = new BoxRenderable(this.ctx, {
      id,
      flexDirection: "row",
      marginBottom,
    })

    const borderColor = this.getStyle("punctuation.special")?.fg ?? "#888888"

    for (let col = 0; col < colCount; col++) {
      const isLastCol = col === colCount - 1

      const columnBox = new BoxRenderable(this.ctx, {
        id: `${id}-col-${col}`,
        flexDirection: "column",
        border: isLastCol ? true : ["top", "bottom", "left"],
        borderColor,
      })

      const headerCell = table.header[col]
      const headerChunks: TextChunk[] = []
      this.renderInlineContent(headerCell.tokens, headerChunks)
      const headingStyle = this.getStyle("markup.heading") || this.getStyle("default")
      const styledHeaderChunks = headerChunks.map((chunk) => ({
        ...chunk,
        fg: headingStyle?.fg ?? chunk.fg,
        bg: headingStyle?.bg ?? chunk.bg,
        attributes: headingStyle
          ? createTextAttributes({
              bold: headingStyle.bold,
              italic: headingStyle.italic,
              underline: headingStyle.underline,
              dim: headingStyle.dim,
            })
          : chunk.attributes,
      }))

      const headerBox = new BoxRenderable(this.ctx, {
        id: `${id}-col-${col}-header-box`,
        border: ["bottom"],
        borderColor,
      })
      headerBox.add(
        new TextRenderable(this.ctx, {
          id: `${id}-col-${col}-header`,
          content: new StyledText(styledHeaderChunks),
          height: 1,
          overflow: "hidden",
          paddingLeft: 1,
          paddingRight: 1,
        }),
      )
      columnBox.add(headerBox)

      for (let row = 0; row < table.rows.length; row++) {
        const cell = table.rows[row][col]
        const cellChunks: TextChunk[] = []
        if (cell) {
          this.renderInlineContent(cell.tokens, cellChunks)
        }

        const isLastRow = row === table.rows.length - 1
        const cellText = new TextRenderable(this.ctx, {
          id: `${id}-col-${col}-row-${row}`,
          content: new StyledText(cellChunks.length > 0 ? cellChunks : [this.createDefaultChunk(" ")]),
          height: 1,
          overflow: "hidden",
          paddingLeft: 1,
          paddingRight: 1,
        })

        if (isLastRow) {
          columnBox.add(cellText)
        } else {
          const cellBox = new BoxRenderable(this.ctx, {
            id: `${id}-col-${col}-row-${row}-box`,
            border: ["bottom"],
            borderColor,
          })
          cellBox.add(cellText)
          columnBox.add(cellBox)
        }
      }

      tableBox.add(columnBox)
    }

    return tableBox
  }

  private createDefaultRenderable(token: MarkedToken, index: number, hasNextToken: boolean = false): Renderable | null {
    const id = `${this.id}-block-${index}`
    const marginBottom = hasNextToken ? 1 : 0

    if (token.type === "code") {
      return this.createCodeRenderable(token, id, marginBottom)
    }

    if (token.type === "table") {
      return this.createTableRenderable(token, id, marginBottom)
    }

    if (token.type === "space") {
      return null
    }

    const chunks = this.renderTokenToChunks(token)
    if (chunks.length === 0) {
      return null
    }

    return this.createTextRenderable(chunks, id, marginBottom)
  }

  private getCacheKey(token: MarkedToken): string {
    return `${token.type}:${this._conceal}:${token.raw}`
  }

  private rebuildChildren(): void {
    for (const child of this._blockChildren) {
      this.remove(child.renderable.id)
    }
    this._blockChildren = []

    if (!this._content) return

    let tokens: MarkedToken[]
    try {
      tokens = Lexer.lex(this._content, { gfm: true }) as MarkedToken[]
    } catch {
      const text = this.createTextRenderable([this.createDefaultChunk(this._content)], `${this.id}-fallback`)
      this.add(text)
      this._blockChildren.push({
        token: { type: "text", raw: this._content, text: this._content } as MarkedToken,
        renderable: text,
      })
      return
    }

    const newCache = new Map<string, Renderable>()

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const hasNextToken = tokens.slice(i + 1).some((t) => t.type !== "space")
      const cacheKey = this.getCacheKey(token)

      let renderable = this._childCache.get(cacheKey)

      if (!renderable) {
        if (this._renderNode) {
          const context: RenderNodeContext = {
            syntaxStyle: this._syntaxStyle,
            conceal: this._conceal,
            treeSitterClient: this._treeSitterClient,
            defaultRender: () => this.createDefaultRenderable(token, i, hasNextToken),
          }
          const custom = this._renderNode(token, context)
          if (custom) {
            renderable = custom
          }
        }

        if (!renderable) {
          renderable = this.createDefaultRenderable(token, i, hasNextToken) ?? undefined
        }
      }

      if (renderable) {
        this.add(renderable)
        this._blockChildren.push({ token, renderable })
        newCache.set(cacheKey, renderable)
      }
    }

    this._childCache = newCache
  }

  public clearCache(): void {
    this._childCache.clear()
    this.rebuildChildren()
    this.requestRender()
  }
}
