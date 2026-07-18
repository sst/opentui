import { decodeHTMLStrict } from "entities"
import { Lexer, type Token, type Tokens } from "marked"
import type { LinkRange, SimpleHighlight } from "./tree-sitter/types.js"

export type SourceLink = LinkRange

const URL_SCOPES = new Set(["markup.link.url", "string.special.url"])
const EXCLUDED_SCOPES = new Set(["markup.link.label", "markup.raw", "markup.raw.inline", "markup.raw.block"])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const URL_START = /https?:\/\//giu
const MARKDOWN_ENTITY = /&(?:#\d+|#[xX][\dA-Fa-f]+|[A-Za-z][A-Za-z\d]+);/gu

export function admitLinkTarget(target: string): string | undefined {
  if (!target || CONTROL_CHARACTERS.test(target)) return undefined
  return target
}

export function detectMarkdownLinks(
  highlights: SimpleHighlight[],
  context: { content: string; linkRanges?: LinkRange[] },
): SimpleHighlight[] {
  const links = detectSourceLinks(context.content, highlights)
  if (links.length > 0) context.linkRanges = links
  return highlights
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
      const url = resolveMarkedLinkTarget(token as Tokens.Link)
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
        const marker = labelStart - 2
        if (content[marker] !== "!" || isEscaped(content, marker)) links.push({ start: labelStart, end: labelEnd, url })
        break
      }
      if (URL_SCOPES.has(previousGroup)) break
    }
  }
  return { links, excluded }
}

function resolveMarkdownDestination(destination: string): string | undefined {
  const token = Lexer.lexInline(`[x](${decodeMarkdownEntities(destination)})`)[0]
  if (token?.type !== "link") return undefined
  return admitLinkTarget(token.href)
}

export function resolveMarkedLinkTarget(token: Tokens.Link | Tokens.Image): string | undefined {
  const decoded = decodeMarkdownEntities(token.raw)
  if (decoded === token.raw) return admitLinkTarget(token.href)
  const resolved = Lexer.lexInline(decoded)[0]
  if (resolved?.type === token.type) return admitLinkTarget(resolved.href)
  return admitLinkTarget(decodeHTMLStrict(token.href))
}

function decodeMarkdownEntities(source: string): string {
  if (!source.includes("&")) return source
  return source.replace(MARKDOWN_ENTITY, (entity, offset) =>
    isEscaped(source, offset) ? entity : decodeHTMLStrict(entity),
  )
}

function isEscaped(source: string, offset: number): boolean {
  let backslashes = 0
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index--) backslashes++
  return backslashes % 2 === 1
}
