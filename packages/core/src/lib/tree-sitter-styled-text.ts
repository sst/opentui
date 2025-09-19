import type { TextChunk } from "../text-buffer"
import { StyledText } from "./styled-text"
import { SyntaxStyle } from "./syntax-style"
import { TreeSitterClient } from "./tree-sitter/client"
import type { HighlightResponse } from "./tree-sitter/types"

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
