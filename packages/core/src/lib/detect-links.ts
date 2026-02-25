import type { TextChunk } from "../text-buffer"
import type { SimpleHighlight } from "./tree-sitter/types"

const URL_SCOPES = ["markup.link.url", "string.special.url"]

export function detectLinks(
  chunks: TextChunk[],
  context: { content: string; highlights: SimpleHighlight[] },
): TextChunk[] {
  const content = context.content
  const highlights = context.highlights

  const ranges: Array<{ start: number; end: number; url: string }> = []

  for (let i = 0; i < highlights.length; i++) {
    const [start, end, group] = highlights[i]
    if (!URL_SCOPES.includes(group)) continue

    const url = content.slice(start, end)
    ranges.push({ start, end, url })

    for (let j = i - 1; j >= 0; j--) {
      const [labelStart, labelEnd, prev] = highlights[j]
      if (prev === "markup.link.label") {
        ranges.push({ start: labelStart, end: labelEnd, url })
        break
      }
      if (!prev.startsWith("markup.link")) break
    }
  }

  if (ranges.length === 0) return chunks

  // Use content.indexOf to find each chunk's position in the original content.
  // This handles concealed text correctly because concealed chunks are either
  // empty (length 0, skipped) or single-char replacements (length 1, skipped).
  // Non-concealed chunks with length > 1 are exact substrings of content in order.
  let contentPos = 0
  for (const chunk of chunks) {
    if (chunk.text.length <= 1) continue

    const idx = content.indexOf(chunk.text, contentPos)
    if (idx < 0) continue

    for (const range of ranges) {
      if (idx < range.end && idx + chunk.text.length > range.start) {
        chunk.link = { url: range.url }
        break
      }
    }

    contentPos = idx + chunk.text.length
  }

  return chunks
}
