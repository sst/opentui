import type { TextChunk } from "../text-buffer"
import { StyledText } from "./styled-text"
import { SyntaxStyle } from "./syntax-style"
import { TreeSitterClient } from "./tree-sitter/client"
import type { SimpleHighlight } from "./tree-sitter/types"

function treeSitterToTextChunks(content: string, highlights: SimpleHighlight[], syntaxStyle: SyntaxStyle): TextChunk[] {
  const chunks: TextChunk[] = []

  const styleStack: string[] = ["default"]
  let currentIndex = 0

  const events: Array<{ index: number; type: "start" | "end"; group?: string }> = []

  for (const [startIndex, endIndex, group] of highlights) {
    events.push({ index: startIndex, type: "start", group })
    events.push({ index: endIndex, type: "end", group })
  }

  events.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index
    return a.type === "start" ? -1 : 1
  })

  for (const event of events) {
    if (event.index > currentIndex) {
      const text = content.slice(currentIndex, event.index)
      if (text.length > 0) {
        const currentStyle = syntaxStyle.mergeStyles(...styleStack)
        chunks.push({
          __isChunk: true,
          text,
          fg: currentStyle.fg,
          bg: currentStyle.bg,
          attributes: currentStyle.attributes,
        })
      }
      currentIndex = event.index
    }

    if (event.type === "start") {
      styleStack.push(event.group!)
    } else {
      const index = styleStack.lastIndexOf(event.group!)
      if (index !== -1) {
        styleStack.splice(index, 1)
      }
    }
  }

  if (currentIndex < content.length) {
    const text = content.slice(currentIndex)
    const currentStyle = syntaxStyle.mergeStyles(...styleStack)
    chunks.push({
      __isChunk: true,
      text,
      fg: currentStyle.fg,
      bg: currentStyle.bg,
      attributes: currentStyle.attributes,
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
