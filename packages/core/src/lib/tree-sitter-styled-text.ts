import type { TextChunk } from "../text-buffer"
import { StyledText } from "./styled-text"
import { SyntaxStyle } from "./syntax-style"
import { TreeSitterClient } from "./tree-sitter/client"
import type { SimpleHighlight } from "./tree-sitter/types"

// Re-export for convenience
export { SyntaxStyle } from "./syntax-style"
export type { StyleDefinition } from "./syntax-style"

function treeSitterToTextChunks(content: string, highlights: SimpleHighlight[], syntaxStyle: SyntaxStyle): TextChunk[] {
  const chunks: TextChunk[] = []

  // Style stack to handle nested highlights (like HAST approach)
  const styleStack: string[] = ["default"]
  let currentIndex = 0

  // Create events for highlight starts and ends
  const events: Array<{ index: number; type: "start" | "end"; group?: string }> = []

  for (const [startIndex, endIndex, group] of highlights) {
    events.push({ index: startIndex, type: "start", group })
    events.push({ index: endIndex, type: "end", group })
  }

  // Sort events by index, with starts before ends at the same index
  events.sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index
    return a.type === "start" ? -1 : 1
  })

  for (const event of events) {
    // Create chunk for text before this event
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

    // Update style stack
    if (event.type === "start") {
      styleStack.push(event.group!)
    } else {
      // Find and remove the matching group from stack
      const index = styleStack.lastIndexOf(event.group!)
      if (index !== -1) {
        styleStack.splice(index, 1)
      }
    }
  }

  // Handle remaining content after all highlights
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
  const start = performance.now()
  const result = await client.highlightOnce(content, filetype)
  const end = performance.now()
  console.log(`ts client highlightOnce in ${end - start}ms`)

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
