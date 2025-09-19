import type { TextChunk } from "../text-buffer"
import { RGBA } from "./RGBA"
import { createTextAttributes } from "../utils"
import { StyledText } from "./styled-text"
import { TreeSitterClient } from "./tree-sitter/client"
import type { HighlightResponse } from "./tree-sitter/types"

export interface StyleDefinition {
  fg?: RGBA
  bg?: RGBA
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
}

interface MergedStyle {
  fg?: RGBA
  bg?: RGBA
  attributes: number
}

export class SyntaxStyle {
  private styles: Record<string, StyleDefinition>
  private mergedStyleCache: Map<string, MergedStyle>

  constructor(styles: Record<string, StyleDefinition>) {
    this.styles = styles
    this.mergedStyleCache = new Map()
  }

  mergeStyles(...styleNames: string[]): MergedStyle {
    const cacheKey = styleNames.join(":")
    const cached = this.mergedStyleCache.get(cacheKey)
    if (cached) return cached

    const styleDefinition: StyleDefinition = {}

    for (const name of styleNames) {
      const style = this.styles[name]
      if (!style) continue

      if (style.fg) styleDefinition.fg = style.fg
      if (style.bg) styleDefinition.bg = style.bg
      if (style.bold !== undefined) styleDefinition.bold = style.bold
      if (style.italic !== undefined) styleDefinition.italic = style.italic
      if (style.underline !== undefined) styleDefinition.underline = style.underline
      if (style.dim !== undefined) styleDefinition.dim = style.dim
    }

    const attributes = createTextAttributes({
      bold: styleDefinition.bold,
      italic: styleDefinition.italic,
      underline: styleDefinition.underline,
      dim: styleDefinition.dim,
    })

    const merged: MergedStyle = {
      fg: styleDefinition.fg,
      bg: styleDefinition.bg,
      attributes,
    }

    this.mergedStyleCache.set(cacheKey, merged)

    return merged
  }

  clearCache(): void {
    this.mergedStyleCache.clear()
  }

  getCacheSize(): number {
    return this.mergedStyleCache.size
  }
}

function treeSitterToTextChunks(
  content: string,
  highlights: HighlightResponse[],
  syntaxStyle: SyntaxStyle,
): TextChunk[] {
  const lines = content.split("\n")
  const chunks: TextChunk[] = []

  // Create a map of line highlights for easier lookup
  const lineHighlightMap = new Map<number, HighlightResponse>()
  for (const lineHighlight of highlights) {
    lineHighlightMap.set(lineHighlight.line, lineHighlight)
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineContent = lines[lineIndex]
    const lineHighlight = lineHighlightMap.get(lineIndex)

    if (!lineHighlight || lineHighlight.highlights.length === 0) {
      // No highlights for this line, use default style
      const defaultStyle = syntaxStyle.mergeStyles("default")
      chunks.push({
        __isChunk: true,
        text: lineContent,
        fg: defaultStyle.fg,
        bg: defaultStyle.bg,
        attributes: defaultStyle.attributes,
      })
    } else {
      // Sort highlights by start column to process them in order
      const sortedHighlights = [...lineHighlight.highlights].sort((a, b) => a.startCol - b.startCol)
      let lastCol = 0

      for (const highlight of sortedHighlights) {
        // Add unhighlighted text before this highlight (if any)
        if (highlight.startCol > lastCol) {
          const defaultStyle = syntaxStyle.mergeStyles("default")
          chunks.push({
            __isChunk: true,
            text: lineContent.slice(lastCol, highlight.startCol),
            fg: defaultStyle.fg,
            bg: defaultStyle.bg,
            attributes: defaultStyle.attributes,
          })
        }

        // Add highlighted text
        const highlightStyle = syntaxStyle.mergeStyles(highlight.group)
        chunks.push({
          __isChunk: true,
          text: lineContent.slice(highlight.startCol, highlight.endCol),
          fg: highlightStyle.fg,
          bg: highlightStyle.bg,
          attributes: highlightStyle.attributes,
        })

        lastCol = highlight.endCol
      }

      // Add remaining unhighlighted text at end of line (if any)
      if (lastCol < lineContent.length) {
        const defaultStyle = syntaxStyle.mergeStyles("default")
        chunks.push({
          __isChunk: true,
          text: lineContent.slice(lastCol),
          fg: defaultStyle.fg,
          bg: defaultStyle.bg,
          attributes: defaultStyle.attributes,
        })
      }
    }

    // Add newline except for the last line
    if (lineIndex < lines.length - 1) {
      const defaultStyle = syntaxStyle.mergeStyles("default")
      chunks.push({
        __isChunk: true,
        text: "\n",
        fg: defaultStyle.fg,
        bg: defaultStyle.bg,
        attributes: defaultStyle.attributes,
      })
    }
  }

  return chunks
}

export async function treeSitterToStyledText(
  content: string,
  filetype: string,
  syntaxStyle: SyntaxStyle,
  client: TreeSitterClient,
): Promise<StyledText> {
  const result = await client.highlightOnce(content, filetype)

  if (result.highlights) {
    const chunks = treeSitterToTextChunks(content, result.highlights, syntaxStyle)
    return new StyledText(chunks)
  } else {
    // No highlights available, return content with default styling
    const defaultStyle = syntaxStyle.mergeStyles("default")
    const chunks: TextChunk[] = [
      {
        __isChunk: true,
        text: content,
        fg: defaultStyle.fg,
        bg: defaultStyle.bg,
        attributes: defaultStyle.attributes,
      },
    ]
    return new StyledText(chunks)
  }
}
