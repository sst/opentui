export interface SearchEntry {
  chapter: string
  title: string
  url: string
  text: string
}

export interface SearchTerm {
  anywhere: RegExp
  whole: RegExp
}

export interface SearchPattern {
  terms: SearchTerm[]
  phrase: string
  first: RegExp
  words: RegExp
}

export interface SearchMatch {
  entry: SearchEntry
  pattern: SearchPattern
  score: number
}

export interface HighlightPart {
  text: string
  mark: boolean
}

const PREVIEW_LENGTH = 160

export function lookup(entries: SearchEntry[], query: string): SearchMatch[] {
  const pattern = compile(query)
  if (!pattern) return []

  return entries
    .map((entry) => ({ entry, pattern, score: score(entry, pattern) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.url.localeCompare(b.entry.url))
}

export function compile(query: string): SearchPattern | null {
  const sources = tokenize(query).map(quote)
  if (!sources.length) return null

  return {
    terms: sources.map((source) => ({
      anywhere: matcher(source, "giu"),
      whole: matcher(`${source}(?![\\p{L}\\p{N}])`, "iu"),
    })),
    phrase: query.toLowerCase(),
    first: matcher(`(?:${sources.join("|")})`, "iu"),
    words: matcher(`(${sources.map((source) => `${source}[\\p{L}\\p{N}]*`).join("|")})`, "giu"),
  }
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#_-]+/u)
    .filter(Boolean)
}

export function preview(text: string, pattern: SearchPattern): string {
  const at = text.search(pattern.first)
  const start = Math.max(0, at - PREVIEW_LENGTH / 3)
  let snippet = text.slice(start, start + PREVIEW_LENGTH)

  if (start > 0) snippet = `…${snippet.replace(/^\S*\s/, "")}`
  if (start + PREVIEW_LENGTH < text.length) snippet = `${snippet.replace(/\s\S*$/, "")}…`

  return snippet
}

export function highlightParts(text: string, pattern: SearchPattern): HighlightPart[] {
  return text.split(pattern.words).map((part, index) => ({
    text: part,
    mark: index % 2 === 1,
  }))
}

function score(entry: SearchEntry, pattern: SearchPattern): number {
  let total = 0

  for (const term of pattern.terms) {
    const inTitle = occurrences(entry.title, term.anywhere)
    const inText = occurrences(entry.text, term.anywhere)

    if (!inTitle && !inText) return 0

    total += inTitle * 30 + Math.min(inText, 5) * 2 + occurrences(entry.chapter, term.anywhere) * 10

    term.whole.lastIndex = 0
    if (term.whole.test(entry.title)) total += 20
  }

  if (pattern.terms.length > 1 && phrased(entry, pattern.phrase)) total += 40

  return total
}

function occurrences(text: string, term: RegExp): number {
  term.lastIndex = 0
  return (text.match(term) || []).length
}

function phrased(entry: SearchEntry, phrase: string): boolean {
  return `${entry.title} ${entry.chapter} ${entry.text}`.toLowerCase().includes(phrase)
}

function matcher(source: string, flags: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${source}`, flags)
}

function quote(term: string): string {
  return [...term].map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("-?")
}
