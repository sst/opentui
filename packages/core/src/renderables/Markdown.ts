import { type RenderContext } from "../types"
import { SyntaxStyle } from "../syntax-style"
import { type TreeSitterClient } from "../lib/tree-sitter"
import { CodeRenderable, type CodeOptions } from "./Code"
import { remark } from "remark"
import remarkGfm from "remark-gfm"
import type { Root, RootContent, Table, TableRow, TableCell, AlignType, PhrasingContent } from "mdast"

export interface MarkdownOptions extends Omit<CodeOptions, "filetype"> {
  content?: string
  syntaxStyle: SyntaxStyle
  treeSitterClient?: TreeSitterClient
  conceal?: boolean
}

interface CachedTableAlignment {
  originalText: string
  alignedText: string
}

export class MarkdownRenderable extends CodeRenderable {
  // Cache for table alignments (keyed by original table text)
  private _tableAlignmentCache: Map<string, CachedTableAlignment> = new Map()

  // Remark processor instance (reused)
  private _remarkProcessor = remark().use(remarkGfm)

  // Store raw content before transformation
  private _rawContent: string = ""

  constructor(ctx: RenderContext, options: MarkdownOptions) {
    // Transform content before passing to CodeRenderable
    const rawContent = options.content ?? ""
    const transformedContent = rawContent

    super(ctx, {
      ...options,
      content: transformedContent,
      filetype: "markdown",
    })

    this._rawContent = rawContent

    // Now transform and update
    if (rawContent.length > 0) {
      const processed = this.processMarkdown(rawContent)
      if (processed !== rawContent) {
        super.content = processed
      }
    }
  }

  get content(): string {
    return this._rawContent
  }

  set content(value: string) {
    if (this._rawContent !== value) {
      this._rawContent = value
      // Transform and pass to parent
      const processed = this.processMarkdown(value)
      super.content = processed
    }
  }

  /**
   * Count concealed characters in an AST node recursively.
   * Concealed chars are formatting markers like `, *, **
   */
  private countConcealedChars(node: PhrasingContent): number {
    let count = 0

    switch (node.type) {
      case "inlineCode":
        // Backticks: 2 chars (one on each side)
        count += 2
        break
      case "strong":
        // Bold markers: 4 chars (** on each side)
        count += 4
        // Recurse into children
        if ("children" in node) {
          for (const child of node.children) {
            count += this.countConcealedChars(child)
          }
        }
        break
      case "emphasis":
        // Italic markers: 2 chars (* on each side)
        count += 2
        // Recurse into children
        if ("children" in node) {
          for (const child of node.children) {
            count += this.countConcealedChars(child)
          }
        }
        break
      case "delete":
        // Strikethrough: 4 chars (~~ on each side)
        count += 4
        // Recurse into children
        if ("children" in node) {
          for (const child of node.children) {
            count += this.countConcealedChars(child)
          }
        }
        break
      case "link":
        // Links have []() syntax, but we keep the text visible
        // Concealed: [ ] ( url )
        if ("children" in node) {
          for (const child of node.children) {
            count += this.countConcealedChars(child)
          }
        }
        // Add brackets and parens + url length
        count += 4 // []()
        if (node.url) {
          count += node.url.length
        }
        break
      default:
        // For other container nodes, recurse into children
        if ("children" in node && Array.isArray((node as any).children)) {
          for (const child of (node as any).children) {
            count += this.countConcealedChars(child)
          }
        }
        break
    }

    return count
  }

  /**
   * Get display width of a table cell using AST for accurate concealment calculation.
   * When conceal is true, excludes markdown formatting characters.
   */
  private getCellDisplayWidth(cell: TableCell, cellText: string, conceal: boolean): number {
    const baseWidth = Bun.stringWidth(cellText.trim())
    if (!conceal) return baseWidth

    // Count concealed chars by traversing AST
    let concealedChars = 0
    for (const child of cell.children) {
      concealedChars += this.countConcealedChars(child)
    }

    return Math.max(0, baseWidth - concealedChars)
  }

  /**
   * Format a table node from the AST with aligned columns.
   */
  private formatTable(table: Table, content: string): string {
    const rows = table.children as TableRow[]
    if (rows.length < 2) {
      // Need at least header and delimiter row
      return content.slice(table.position!.start.offset!, table.position!.end.offset!)
    }

    // Extract cell data from each row, keeping AST nodes for width calculation
    const rowData: Array<{
      cells: Array<{ text: string; node: TableCell | null }>
      isDelimiter: boolean
    }> = []
    const alignments: AlignType[] = table.align || []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const cells: Array<{ text: string; node: TableCell | null }> = []

      for (const cell of row.children as TableCell[]) {
        // Get the raw text of the cell from the source
        if (cell.position) {
          const cellText = content.slice(cell.position.start.offset!, cell.position.end.offset!)
          cells.push({ text: cellText.trim(), node: cell })
        } else {
          cells.push({ text: "", node: null })
        }
      }

      // First row after header is the delimiter row
      // We detect it by checking if all cells look like ---
      const isDelimiter = i === 1 && cells.every((c) => /^:?-+:?$/.test(c.text))

      rowData.push({ cells, isDelimiter })
    }

    // Calculate column count
    const colCount = Math.max(...rowData.map((r) => r.cells.length))
    if (colCount === 0) {
      return content.slice(table.position!.start.offset!, table.position!.end.offset!)
    }

    // Calculate column widths based on display width using AST
    const colWidths: number[] = new Array(colCount).fill(3) // Minimum width of 3 for "---"

    for (const row of rowData) {
      if (row.isDelimiter) continue

      for (let col = 0; col < row.cells.length; col++) {
        const cell = row.cells[col]
        const displayWidth = cell.node
          ? this.getCellDisplayWidth(cell.node, cell.text, this.conceal)
          : Bun.stringWidth(cell.text)
        colWidths[col] = Math.max(colWidths[col], displayWidth)
      }
    }

    // Build formatted table
    const formattedRows: string[] = []

    for (const row of rowData) {
      const formattedCells: string[] = []

      for (let col = 0; col < colCount; col++) {
        const width = colWidths[col]
        const cell = row.cells[col] || { text: "", node: null }

        if (row.isDelimiter) {
          // Rebuild delimiter with proper width and alignment markers
          const align = alignments[col]
          if (align === "center") {
            formattedCells.push(":" + "-".repeat(width - 2) + ":")
          } else if (align === "left") {
            formattedCells.push(":" + "-".repeat(width - 1))
          } else if (align === "right") {
            formattedCells.push("-".repeat(width - 1) + ":")
          } else {
            formattedCells.push("-".repeat(width))
          }
        } else {
          // Pad content cell to column width
          const displayWidth = cell.node
            ? this.getCellDisplayWidth(cell.node, cell.text, this.conceal)
            : Bun.stringWidth(cell.text)
          const pad = width - displayWidth
          formattedCells.push(cell.text + " ".repeat(Math.max(0, pad)))
        }
      }

      formattedRows.push("| " + formattedCells.join(" | ") + " |")
    }

    return formattedRows.join("\n")
  }

  /**
   * Process markdown content, aligning tables.
   * Returns the processed content with aligned tables.
   */
  private processMarkdown(content: string): string {
    if (!content) return content

    // Parse markdown with remark
    let ast: Root
    try {
      ast = this._remarkProcessor.parse(content)
    } catch {
      // If parsing fails, return original content
      return content
    }

    // Find all table nodes and their positions
    const tableSections: Array<{
      startOffset: number
      endOffset: number
      originalText: string
      processedText: string
    }> = []

    const findTables = (node: Root | RootContent) => {
      if (node.type === "table" && node.position) {
        const originalText = content.slice(node.position.start.offset!, node.position.end.offset!)

        // Check cache
        const cached = this._tableAlignmentCache.get(originalText)
        if (cached) {
          tableSections.push({
            startOffset: node.position.start.offset!,
            endOffset: node.position.end.offset!,
            originalText,
            processedText: cached.alignedText,
          })
        } else {
          // Format the table
          const alignedText = this.formatTable(node as Table, content)

          // Cache the result
          this._tableAlignmentCache.set(originalText, {
            originalText,
            alignedText,
          })

          tableSections.push({
            startOffset: node.position.start.offset!,
            endOffset: node.position.end.offset!,
            originalText,
            processedText: alignedText,
          })
        }
      }

      // Recurse into children
      if ("children" in node) {
        for (const child of node.children) {
          findTables(child as RootContent)
        }
      }
    }

    findTables(ast)

    // If no tables found, return original content
    if (tableSections.length === 0) {
      return content
    }

    // Sort sections by start offset
    tableSections.sort((a, b) => a.startOffset - b.startOffset)

    // Build processed content by replacing table sections
    let result = ""
    let lastEnd = 0

    for (const section of tableSections) {
      // Add content before this section
      result += content.slice(lastEnd, section.startOffset)
      // Add processed section
      result += section.processedText
      lastEnd = section.endOffset
    }

    // Add remaining content after last section
    result += content.slice(lastEnd)

    return result
  }

  /**
   * Clear the table alignment cache.
   * Useful when you want to force re-computation of all tables.
   */
  public clearTableCache(): void {
    this._tableAlignmentCache.clear()
    // Re-process content
    const processed = this.processMarkdown(this._rawContent)
    super.content = processed
  }
}
