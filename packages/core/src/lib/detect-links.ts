import { decodeHTML } from "entities"
import { Lexer, type Token } from "marked"
import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"

export interface SourceLink {
  start: number
  end: number
  url: string
}

const URL_SCOPES = new Set(["markup.link.url", "string.special.url"])
const EXCLUDED_SCOPES = new Set(["markup.link.label", "markup.raw", "markup.raw.inline", "markup.raw.block"])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const URL_START = /https?:\/\//giu

export function admitLinkTarget(target: string): string | undefined {
  const decoded = decodeHTML(target)
  if (!decoded || CONTROL_CHARACTERS.test(decoded)) return undefined
  return decoded
}

export function detectLinks(
  chunks: TextChunk[],
  context: { content: string; highlights: SimpleHighlight[] },
): TextChunk[] {
  const ranges = detectSourceLinks(context.content, context.highlights)
  if (ranges.length === 0) return chunks

  let contentPosition = 0
  let rangeIndex = 0
  for (const chunk of chunks) {
    if (chunk.text.length === 0) continue
    const start = context.content.indexOf(chunk.text, contentPosition)
    if (start < 0) continue
    while (ranges[rangeIndex] && ranges[rangeIndex].end <= start) rangeIndex++
    const range = ranges[rangeIndex]
    if (range && start + chunk.text.length > range.start) chunk.link = { url: range.url }
    contentPosition = start + chunk.text.length
  }
  return chunks
}

export function detectSourceLinks(content: string, highlights: SimpleHighlight[]): SourceLink[] {
  const detected = detectExplicitLinks(content, highlights)
  const explicit = detected.links.sort((left, right) => left.start - right.start || left.end - right.end)
  const bare = detectBareLinks(content, detected.excluded)
  const links: SourceLink[] = []
  let explicitIndex = 0

  for (const candidate of bare) {
    while (explicit[explicitIndex] && explicit[explicitIndex].end <= candidate.start) {
      links.push(explicit[explicitIndex++])
    }
    if (explicit[explicitIndex] && explicit[explicitIndex].start < candidate.end) continue
    links.push(candidate)
  }
  while (explicit[explicitIndex]) links.push(explicit[explicitIndex++])
  return links
}

export function detectBareLinks(text: string, excluded: Array<{ start: number; end: number }> = []): SourceLink[] {
  const links: SourceLink[] = []
  const ranges = [...excluded].sort((left, right) => left.start - right.start)
  let excludedIndex = 0
  let match: RegExpExecArray | null
  URL_START.lastIndex = 0

  while ((match = URL_START.exec(text))) {
    const start = match.index
    while (ranges[excludedIndex] && ranges[excludedIndex].end <= start) excludedIndex++
    if (ranges[excludedIndex] && start >= ranges[excludedIndex].start) {
      URL_START.lastIndex = ranges[excludedIndex].end
      continue
    }

    const lowerBound = ranges[excludedIndex - 1]?.end ?? 0
    const upperBound = ranges[excludedIndex]?.start ?? text.length
    let segmentStart = start
    let segmentEnd = start
    while (segmentStart > lowerBound && !/\s/u.test(text[segmentStart - 1])) segmentStart--
    while (segmentEnd < upperBound && !/\s/u.test(text[segmentEnd])) segmentEnd++
    const source = text.slice(segmentStart, segmentEnd)
    collectBareTokens(Lexer.lexInline(source), source, segmentStart, links)
    URL_START.lastIndex = segmentEnd
  }
  return links
}

function collectBareTokens(tokens: Token[], source: string, sourceStart: number, links: SourceLink[]): void {
  let offset = 0
  for (const token of tokens) {
    const start = source.indexOf(token.raw, offset)
    if (start < 0) continue
    if (token.type === "link" && /^https?:\/\//iu.test(token.raw)) {
      const url = admitLinkTarget(token.href)
      if (url) links.push({ start: sourceStart + start, end: sourceStart + start + token.raw.length, url })
    } else if ("tokens" in token && Array.isArray(token.tokens)) {
      collectBareTokens(token.tokens, token.raw, sourceStart + start, links)
    }
    offset = start + token.raw.length
  }
}

function detectExplicitLinks(content: string, highlights: SimpleHighlight[]) {
  const links: SourceLink[] = []
  const excluded: Array<{ start: number; end: number }> = []

  for (let index = 0; index < highlights.length; index++) {
    const [start, end, group] = highlights[index]
    if (EXCLUDED_SCOPES.has(group) || URL_SCOPES.has(group)) excluded.push({ start, end })
    if (!URL_SCOPES.has(group)) continue

    const url = resolveMarkdownDestination(content.slice(start, end))
    if (!url) continue
    links.push({ start, end, url })
    if (group !== "markup.link.url") continue

    for (let previous = index - 1; previous >= 0; previous--) {
      const [labelStart, labelEnd, previousGroup] = highlights[previous]
      if (previousGroup === "markup.link.label" && /^\]\(\s*<?$/u.test(content.slice(labelEnd, start))) {
        if (content[labelStart - 2] !== "!") links.push({ start: labelStart, end: labelEnd, url })
        break
      }
      if (URL_SCOPES.has(previousGroup)) break
    }
  }
  return { links, excluded }
}

function resolveMarkdownDestination(destination: string): string | undefined {
  const token = Lexer.lexInline(`[x](${destination})`)[0]
  if (token?.type !== "link") return undefined
  return admitLinkTarget(token.href)
}
