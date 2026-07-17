import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"

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
    // Skip ranges whose URL is empty or whitespace-only: opening an OSC 8 link
    // with no target produces a phantom hover with no URL.
    if (url.trim().length === 0) continue
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

  // When chunks carry sourceStart/sourceEnd (set by treeSitterToTextChunks),
  // use exact offset overlap — no indexOf drift possible.
  const hasSourceOffsets = chunks.length > 0 && chunks[0].sourceStart !== undefined

  if (hasSourceOffsets) {
    for (const chunk of chunks) {
      const start = chunk.sourceStart!
      const end = chunk.sourceEnd!
      if (start === end) continue
      for (const range of ranges) {
        if (start < range.end && end > range.start) {
          // Don't linkify chunks that are purely whitespace / punctuation from conceal
          if (chunk.text.trim().length === 0) break
          chunk.link = { url: range.url }
          break
        }
      }
    }
  } else {
    // Legacy fallback: indexOf-based matching for chunks without source offsets.
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
  }

  return chunks
}
