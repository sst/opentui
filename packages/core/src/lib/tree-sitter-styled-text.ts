import type { TextChunk } from "../text-buffer"
import { StyledText } from "./styled-text"
import { SyntaxStyle } from "./syntax-style"
import { TreeSitterClient } from "./tree-sitter/client"
import type { HighlightRange, HighlightResponse } from "./tree-sitter/types"

// Re-export for convenience
export { SyntaxStyle } from "./syntax-style"
export type { StyleDefinition } from "./syntax-style"

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
      // Process highlights with proper overlap handling
      const processedChunks = processHighlightsForLine(lineContent, lineHighlight.highlights, syntaxStyle)
      chunks.push(...processedChunks)
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

function processHighlightsForLine(
  lineContent: string,
  highlights: HighlightRange[],
  syntaxStyle: SyntaxStyle,
): TextChunk[] {
  const chunks: TextChunk[] = []

  if (highlights.length === 0) {
    const defaultStyle = syntaxStyle.mergeStyles("default")
    chunks.push({
      __isChunk: true,
      text: lineContent,
      fg: defaultStyle.fg,
      bg: defaultStyle.bg,
      attributes: defaultStyle.attributes,
    })
    return chunks
  }

  // Sort highlights by start column, then by specificity (shorter ranges first)
  const sortedHighlights = [...highlights].sort((a, b) => {
    if (a.startCol !== b.startCol) {
      return a.startCol - b.startCol
    }
    // If same start, prefer shorter ranges (more specific)
    return a.endCol - a.startCol - (b.endCol - b.startCol)
  })

  // Use a priority-based approach to handle overlaps
  // More specific highlights (shorter ranges) override broader ones
  const styleMap = new Map<number, { style: any; priority: number }>()

  for (const highlight of sortedHighlights) {
    const length = highlight.endCol - highlight.startCol
    const priority = -length // Shorter ranges have higher priority (negative length = higher priority)

    for (let col = highlight.startCol; col < highlight.endCol; col++) {
      const existing = styleMap.get(col)
      if (!existing || priority > existing.priority) {
        styleMap.set(col, {
          style: syntaxStyle.mergeStyles(highlight.group),
          priority,
        })
      }
    }
  }

  // Now build chunks based on the style map
  let currentStyle: any = null
  let currentStart = 0

  for (let col = 0; col <= lineContent.length; col++) {
    const styleAtCol = col < lineContent.length ? styleMap.get(col) : null
    const style = styleAtCol ? styleAtCol.style : syntaxStyle.mergeStyles("default")

    if (currentStyle === null) {
      currentStyle = style
      currentStart = col
    } else if (!stylesEqual(currentStyle, style) || col === lineContent.length) {
      // Style changed or end of line, create chunk
      const text = lineContent.slice(currentStart, col)
      if (text.length > 0) {
        chunks.push({
          __isChunk: true,
          text,
          fg: currentStyle.fg,
          bg: currentStyle.bg,
          attributes: currentStyle.attributes,
        })
      }
      currentStyle = style
      currentStart = col
    }
  }

  return chunks
}

function stylesEqual(style1: any, style2: any): boolean {
  return style1.fg === style2.fg && style1.bg === style2.bg && style1.attributes === style2.attributes
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
