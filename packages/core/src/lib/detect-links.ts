import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"

const URL_SCOPES = ["markup.link.url", "string.special.url"]
const RAW_SCOPES = ["markup.raw", "markup.raw.block"]
const MAX_LINK_TARGET_BYTES = 512
const textEncoder = new TextEncoder()

type SourceRange = readonly [start: number, end: number]

interface LinkRange {
  start: number
  end: number
  url: string
}

interface MarkdownDestination {
  start: number
  end: number
  url?: string
}

export function detectLinks(
  chunks: TextChunk[],
  context: { content: string; highlights: SimpleHighlight[]; sourceRanges?: ReadonlyArray<SourceRange> },
): TextChunk[] {
  const ranges = collectLinkRanges(context.content, context.highlights)
  if (ranges.length === 0) return chunks

  const sourceRanges = context.sourceRanges ?? getExactSequentialSourceRanges(chunks, context.content)
  if (!sourceRanges) return chunks
  const result: TextChunk[] = []
  let linkIndex = 0

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]
    const sourceRange = sourceRanges[chunkIndex]
    if (!sourceRange) {
      result.push(chunk)
      continue
    }

    while (linkIndex < ranges.length && ranges[linkIndex].end <= sourceRange[0]) linkIndex++
    const range = ranges[linkIndex]
    if (!range || range.start >= sourceRange[1]) {
      result.push(chunk)
      continue
    }

    const sourceText = context.content.slice(sourceRange[0], sourceRange[1])
    if (chunk.text !== sourceText) {
      result.push({ ...chunk, link: { url: range.url } })
      continue
    }

    splitChunkAtLinks(chunk, sourceRange, ranges, linkIndex, result)
  }

  return result
}

function collectLinkRanges(content: string, highlights: SimpleHighlight[]): LinkRange[] {
  const ranges: LinkRange[] = []
  const explicitDestinations: LinkRange[] = []
  const markdownDestinations: MarkdownDestination[] = []
  const labels: SourceRange[] = []
  const excludedBareRanges: SourceRange[] = []

  for (const [start, end, group] of highlights) {
    if (group === "markup.link.label") {
      labels.push([start, end])
      excludedBareRanges.push([start, end])
    }
    if (RAW_SCOPES.some((scope) => group === scope || group.startsWith(`${scope}.`))) {
      excludedBareRanges.push([start, end])
    }
    if (!URL_SCOPES.includes(group)) continue

    const normalized =
      group === "markup.link.url" ? normalizeMarkdownDestination(content.slice(start, end)) : content.slice(start, end)
    const url = isLinkTargetSupported(normalized) ? normalized : undefined
    if (url) explicitDestinations.push({ start, end, url })
    if (group === "markup.link.url") markdownDestinations.push({ start, end, url })
    excludedBareRanges.push([start, end])
  }

  labels.sort(compareSourceRanges)
  const labelsByEnd = [...labels].sort((left, right) => left[1] - right[1] || left[0] - right[0])
  markdownDestinations.sort((left, right) => left.start - right.start)
  const pairedLabels = new Set<SourceRange>()
  let labelIndex = 0
  let latestLabel: SourceRange | undefined
  for (const destination of markdownDestinations) {
    while (labelIndex < labelsByEnd.length && labelsByEnd[labelIndex][1] <= destination.start) {
      latestLabel = labelsByEnd[labelIndex++]
    }
    if (latestLabel && /^\]\(\s*$/u.test(content.slice(latestLabel[1], destination.start))) {
      pairedLabels.add(latestLabel)
      if (destination.url) ranges.push({ start: latestLabel[0], end: latestLabel[1], url: destination.url })
    }
    latestLabel = undefined
  }
  ranges.push(...explicitDestinations)

  excludedBareRanges.sort(compareSourceRanges)
  collectBareHttpUrls(content, excludedBareRanges, ranges)
  const referenceDefinitions = new Set(
    labels
      .filter((label) => content[label[1]] === "]" && content[label[1] + 1] === ":")
      .map((label) => labelKey(content, label)),
  )
  for (const label of labels) {
    const isBracketLabel = content[label[0] - 1] === "[" && content[label[1]] === "]"
    const isImageDescription = content[label[0] - 2] === "!"
    const isReference = content[label[1] + 1] === "[" || referenceDefinitions.has(labelKey(content, label))
    if (pairedLabels.has(label) || !isBracketLabel || isImageDescription || isReference) continue
    const labelRanges: LinkRange[] = []
    collectBareHttpUrls(content.slice(label[0], label[1]), [], labelRanges)
    for (const range of labelRanges) {
      ranges.push({ start: range.start + label[0], end: range.end + label[0], url: range.url })
    }
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end)
  return ranges
}

function normalizeMarkdownDestination(destination: string): string {
  let normalized = destination.trim()
  if (normalized.startsWith("<") && normalized.endsWith(">")) normalized = normalized.slice(1, -1)
  normalized = normalized.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1")
  normalized = normalized.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot);/gi, (entity, numeric, named) => {
    if (numeric) {
      const hexadecimal = numeric[0]?.toLowerCase() === "x"
      const codePoint = Number.parseInt(hexadecimal ? numeric.slice(1) : numeric, hexadecimal ? 16 : 10)
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return entity
      return String.fromCodePoint(codePoint)
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"' }[String(named).toLowerCase()] ?? entity
  })
  try {
    return encodeURI(normalized).replace(/%25([\da-f]{2})/gi, "%$1")
  } catch {
    return ""
  }
}

function collectBareHttpUrls(content: string, excludedRanges: SourceRange[], ranges: LinkRange[]): void {
  let excludedIndex = 0
  let index = 0

  while (index < content.length) {
    const schemeLength = getHttpSchemeLength(content, index)
    const hasStartBoundary = index === 0 || !/[\p{L}\p{N}_@]/u.test(previousCodePoint(content, index))
    if (schemeLength === 0 || !hasStartBoundary) {
      index++
      continue
    }

    while (excludedIndex < excludedRanges.length && excludedRanges[excludedIndex][1] <= index) excludedIndex++

    let end = index + schemeLength
    let hasControl = false
    const nextExcludedStart = excludedIndex < excludedRanges.length ? excludedRanges[excludedIndex][0] : content.length
    while (end < content.length && end < nextExcludedStart && !isUrlBoundary(content.charCodeAt(end), content[end])) {
      if (content.charCodeAt(end) < 0x20 || content.charCodeAt(end) === 0x7f) hasControl = true
      end++
    }

    const insideExcluded =
      excludedIndex < excludedRanges.length &&
      excludedRanges[excludedIndex][0] <= index &&
      index < excludedRanges[excludedIndex][1]
    const trimmedEnd = trimUrlEnd(content, index, end)
    const url = content.slice(index, trimmedEnd)
    if (!hasControl && !insideExcluded && isHttpUrl(url)) ranges.push({ start: index, end: trimmedEnd, url })
    index = Math.max(end, index + 1)
  }
}

function getHttpSchemeLength(content: string, start: number): number {
  if (matchesAsciiCaseInsensitive(content, start, "https://")) return 8
  if (matchesAsciiCaseInsensitive(content, start, "http://")) return 7
  return 0
}

function matchesAsciiCaseInsensitive(content: string, start: number, expected: string): boolean {
  if (start + expected.length > content.length) return false
  for (let offset = 0; offset < expected.length; offset++) {
    const code = content.charCodeAt(start + offset)
    const lowerCode = code >= 0x41 && code <= 0x5a ? code + 0x20 : code
    if (lowerCode !== expected.charCodeAt(offset)) return false
  }
  return true
}

function isUrlBoundary(code: number, character: string): boolean {
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    character === "<" ||
    character === ">" ||
    character === '"'
  )
}

function previousCodePoint(content: string, end: number): string {
  const last = content.charCodeAt(end - 1)
  const startsSurrogatePair =
    last >= 0xdc00 &&
    last <= 0xdfff &&
    end >= 2 &&
    content.charCodeAt(end - 2) >= 0xd800 &&
    content.charCodeAt(end - 2) <= 0xdbff
  return content.slice(startsSurrogatePair ? end - 2 : end - 1, end)
}

function trimUrlEnd(content: string, start: number, initialEnd: number): number {
  const balances = new Map<string, number>([
    [")", 0],
    ["]", 0],
    ["}", 0],
  ])
  for (let index = start; index < initialEnd; index++) {
    const character = content[index]
    if (character === "(") balances.set(")", balances.get(")")! + 1)
    else if (character === "[") balances.set("]", balances.get("]")! + 1)
    else if (character === "{") balances.set("}", balances.get("}")! + 1)
    else if (balances.has(character)) balances.set(character, balances.get(character)! - 1)
  }

  let end = initialEnd
  let removedTerminalApostrophe = false
  while (end > start) {
    const character = content[end - 1]
    if (/[.,;:!?']/.test(character)) {
      removedTerminalApostrophe ||= character === "'"
      end--
      continue
    }
    if (
      !removedTerminalApostrophe &&
      end - start >= 2 &&
      content[end - 2] === "'" &&
      /s/i.test(character) &&
      isAuthorityPossessive(content, start, end)
    ) {
      end -= 2
      continue
    }
    const balance = balances.get(character)
    if (balance !== undefined && balance < 0) {
      balances.set(character, balance + 1)
      end--
      continue
    }
    break
  }
  return end
}

function isAuthorityPossessive(content: string, start: number, end: number): boolean {
  const authorityStart = start + getHttpSchemeLength(content, start)
  for (let index = authorityStart; index < end - 2; index++) {
    if (content[index] === "/" || content[index] === "?" || content[index] === "#") return false
  }
  return true
}

function isHttpUrl(url: string): boolean {
  if (!isLinkTargetSupported(url)) return false
  try {
    const parsed = new URL(url)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0
  } catch {
    return false
  }
}

function isSafeLinkTarget(url: string): boolean {
  return url.length > 0 && !/[\u0000-\u001f\u007f-\u009f]/.test(url)
}

export function isLinkTargetSupported(url: string): boolean {
  return isSafeLinkTarget(url) && textEncoder.encode(url).length <= MAX_LINK_TARGET_BYTES
}

export function normalizeMarkdownLinkTarget(destination: string): string {
  return normalizeMarkdownDestination(destination)
}

function splitChunkAtLinks(
  chunk: TextChunk,
  sourceRange: SourceRange,
  ranges: LinkRange[],
  initialRangeIndex: number,
  result: TextChunk[],
): void {
  let offset = sourceRange[0]
  let rangeIndex = initialRangeIndex
  while (offset < sourceRange[1]) {
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= offset) rangeIndex++
    const range = ranges[rangeIndex]
    if (!range || range.start >= sourceRange[1]) {
      result.push({ ...chunk, text: chunk.text.slice(offset - sourceRange[0]), link: undefined })
      return
    }
    if (offset < range.start) {
      const end = Math.min(range.start, sourceRange[1])
      result.push({ ...chunk, text: chunk.text.slice(offset - sourceRange[0], end - sourceRange[0]), link: undefined })
      offset = end
      continue
    }
    const end = Math.min(range.end, sourceRange[1])
    result.push({
      ...chunk,
      text: chunk.text.slice(offset - sourceRange[0], end - sourceRange[0]),
      link: { url: range.url },
    })
    offset = end
  }
}

function getExactSequentialSourceRanges(chunks: TextChunk[], content: string): SourceRange[] | undefined {
  const ranges: SourceRange[] = []
  let offset = 0
  for (const chunk of chunks) {
    ranges.push([offset, offset + chunk.text.length])
    offset += chunk.text.length
  }
  return offset === content.length && chunks.every((chunk, index) => chunk.text === content.slice(...ranges[index]))
    ? ranges
    : undefined
}

function compareSourceRanges(left: SourceRange, right: SourceRange): number {
  return left[0] - right[0] || left[1] - right[1]
}

function labelKey(content: string, range: SourceRange): string {
  return content.slice(range[0], range[1]).trim().replace(/\s+/gu, " ").toLowerCase()
}
