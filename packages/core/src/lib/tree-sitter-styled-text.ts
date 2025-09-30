import type { TextChunk } from "../text-buffer"
import { StyledText } from "./styled-text"
import { SyntaxStyle } from "./syntax-style"
import { TreeSitterClient } from "./tree-sitter/client"
import type { SimpleHighlight } from "./tree-sitter/types"
import { createTextAttributes } from "../utils"

export function treeSitterToTextChunks(
  content: string,
  highlights: SimpleHighlight[],
  syntaxStyle: SyntaxStyle,
): TextChunk[] {
  const chunks: TextChunk[] = []
  const defaultStyle = syntaxStyle.getStyle("default")
  let currentIndex = 0

  for (let i = 0; i < highlights.length; i++) {
    const [startIndex, endIndex, group] = highlights[i]

    if (startIndex < currentIndex) continue
    if (currentIndex < startIndex) {
      const text = content.slice(currentIndex, startIndex)
      chunks.push({
        __isChunk: true,
        text,
        fg: defaultStyle?.fg,
        bg: defaultStyle?.bg,
        attributes: defaultStyle
          ? createTextAttributes({
              bold: defaultStyle.bold,
              italic: defaultStyle.italic,
              underline: defaultStyle.underline,
              dim: defaultStyle.dim,
            })
          : 0,
      })
      currentIndex = startIndex
    }

    let resolvedStyle = syntaxStyle.getStyle(group)
    let j = i + 1
    while (j < highlights.length && highlights[j][0] === startIndex) {
      const [, , nextGroup] = highlights[j]
      const nextStyle = syntaxStyle.getStyle(nextGroup)
      if (nextStyle) {
        resolvedStyle = nextStyle
      }
      j++
    }
    i = j - 1 // Skip the processed highlights

    const text = content.slice(startIndex, endIndex)
    const styleToUse = resolvedStyle || defaultStyle
    chunks.push({
      __isChunk: true,
      text,
      fg: styleToUse?.fg,
      bg: styleToUse?.bg,
      attributes: styleToUse
        ? createTextAttributes({
            bold: styleToUse.bold,
            italic: styleToUse.italic,
            underline: styleToUse.underline,
            dim: styleToUse.dim,
          })
        : 0,
    })
    currentIndex = endIndex
  }

  if (currentIndex < content.length) {
    const text = content.slice(currentIndex)
    chunks.push({
      __isChunk: true,
      text,
      fg: defaultStyle?.fg,
      bg: defaultStyle?.bg,
      attributes: defaultStyle
        ? createTextAttributes({
            bold: defaultStyle.bold,
            italic: defaultStyle.italic,
            underline: defaultStyle.underline,
            dim: defaultStyle.dim,
          })
        : 0,
    })
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

  if (result.highlights && result.highlights.length > 0) {
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
