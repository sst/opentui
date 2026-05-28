import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"

const URL_SCOPES = ["markup.link.url", "string.special.url"]
const BARE_URL_RE = /https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)?/g
const RAW_SCOPES = ["markup.raw", "markup.raw.block"]

function trimUrlEnd(url: string): string {
  return url.replace(/[.,;:!?\]]+$/, "")
}

function trimConcealedUrlEnd(content: string, start: number, url: string, highlights: SimpleHighlight[]): string {
  let trimmed = trimUrlEnd(url)
  let end = start + trimmed.length

  while (true) {
    const concealedSuffix = highlights.find(
      ([rangeStart, rangeEnd, group]) => group === "conceal" && rangeStart >= start && rangeEnd === end,
    )
    if (!concealedSuffix) return trimmed
    trimmed = trimUrlEnd(content.slice(start, concealedSuffix[0]))
    end = start + trimmed.length
  }
}

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
      if (prev === "conceal") continue
      if (!prev.startsWith("markup.link")) break
    }
  }

  for (const match of content.matchAll(BARE_URL_RE)) {
    const rawUrl = match[0]
    const start = match.index ?? 0
    const url = trimConcealedUrlEnd(content, start, rawUrl, highlights)
    if (!url) continue
    const end = start + url.length
    if (
      highlights.some(
        ([rangeStart, rangeEnd, group]) =>
          start < rangeEnd && end > rangeStart && (URL_SCOPES.includes(group) || RAW_SCOPES.includes(group)),
      )
    ) {
      continue
    }
    ranges.push({ start, end, url })
  }

  if (ranges.length === 0) return chunks

  ranges.sort((a, b) => a.start - b.start || b.end - a.end)

  // Use content.indexOf to find each chunk's position in the original content.
  // This handles concealed text correctly because concealed chunks are either
  // empty (length 0, skipped) or single-char replacements (length 1, skipped).
  // Non-concealed chunks with length > 1 are exact substrings of content in order.
  let contentPos = 0
  let rangeIndex = 0
  const linkedChunks: TextChunk[] = []
  for (const chunk of chunks) {
    if (chunk.text.length === 0) {
      linkedChunks.push(chunk)
      continue
    }

    const idx = content.indexOf(chunk.text, contentPos)
    if (idx < 0) {
      linkedChunks.push(chunk)
      continue
    }

    const chunkEnd = idx + chunk.text.length
    let offset = 0
    let nextRangeIndex = rangeIndex

    while (nextRangeIndex < ranges.length && ranges[nextRangeIndex].end <= idx) {
      nextRangeIndex += 1
    }

    for (let i = nextRangeIndex; i < ranges.length && ranges[i].start < chunkEnd; i += 1) {
      const range = ranges[i]
      const overlapStart = Math.max(idx, range.start)
      const overlapEnd = Math.min(chunkEnd, range.end)
      if (overlapStart >= overlapEnd) continue

      const localStart = overlapStart - idx
      const localEnd = overlapEnd - idx
      if (localEnd <= offset) continue

      if (localStart > offset) {
        linkedChunks.push({ ...chunk, text: chunk.text.slice(offset, localStart) })
      }

      linkedChunks.push({
        ...chunk,
        text: chunk.text.slice(Math.max(localStart, offset), localEnd),
        link: { url: range.url },
      })

      offset = localEnd
    }

    if (offset < chunk.text.length) {
      linkedChunks.push({ ...chunk, text: chunk.text.slice(offset) })
    }

    if (
      offset === 0 &&
      chunk.text.length === 1 &&
      (nextRangeIndex > rangeIndex || (ranges[nextRangeIndex] && idx >= ranges[nextRangeIndex].start))
    ) {
      continue
    }

    rangeIndex = nextRangeIndex
    contentPos = idx + chunk.text.length
  }

  return linkedChunks
}
