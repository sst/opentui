import { Lexer, type MarkedExtension, type MarkedToken } from "marked"

export interface ParseState {
  content: string
  tokens: MarkedToken[]
  stableTokenCount?: number
}

/**
 * Normalize MarkedExtension[] into the shape marked's Lexer expects
 * (same logic as `marked.use`): tokenizer functions collected under
 * `extensions.inline` / `extensions.block`, with `start` fns in
 * `startInline` / `startBlock`.
 */
export function normalizeExtensions(extensions?: MarkedExtension[]): Record<string, unknown> | undefined {
  if (!extensions || extensions.length === 0) return undefined
  const out: Record<string, unknown> = { renderers: {}, childTokens: {} }
  for (const ext of extensions) {
    for (const item of ext.extensions ?? []) {
      if ("tokenizer" in item && item.tokenizer) {
        const tokenizer = item.tokenizer
        if (item.level === "block") {
          const list = (out.block as unknown[] | undefined) ?? []
          list.unshift(tokenizer)
          out.block = list
          if (item.start) {
            const starts = (out.startBlock as unknown[] | undefined) ?? []
            starts.push(item.start)
            out.startBlock = starts
          }
        } else {
          const list = (out.inline as unknown[] | undefined) ?? []
          list.unshift(tokenizer)
          out.inline = list
          if (item.start) {
            const starts = (out.startInline as unknown[] | undefined) ?? []
            starts.push(item.start)
            out.startInline = starts
          }
        }
      }
      if ("renderer" in item && item.renderer) {
        const renderers = out.renderers as Record<string, unknown>
        renderers[item.name] = item.renderer
      }
    }
  }
  return out
}

/**
 * Incrementally parse markdown, reusing unchanged tokens from previous parse.
 * Compares token.raw at each offset - matching tokens keep same object reference.
 */
export function parseMarkdownIncremental(
  newContent: string,
  prevState: ParseState | null,
  trailingUnstable: number = 2,
  extensions?: MarkedExtension[],
): ParseState {
  const normalized = normalizeExtensions(extensions)
  const lex = (src: string) => (normalized ? Lexer.lex(src, { gfm: true, extensions: normalized }) : Lexer.lex(src))

  if (!prevState || prevState.tokens.length === 0) {
    try {
      const tokens = lex(newContent) as MarkedToken[]
      return {
        content: newContent,
        tokens,
        stableTokenCount: Math.max(0, tokens.length - trailingUnstable),
      }
    } catch {
      return { content: newContent, tokens: [], stableTokenCount: 0 }
    }
  }

  // Find how many tokens from start are unchanged
  let offset = 0
  let reuseCount = 0

  for (const token of prevState.tokens) {
    const tokenLength = token.raw.length
    if (offset + tokenLength <= newContent.length && newContent.startsWith(token.raw, offset)) {
      reuseCount++
      offset += tokenLength
    } else {
      break
    }
  }

  // Keep last N tokens unstable (e.g. "# Hello" might become "# Hello World")
  reuseCount = Math.max(0, reuseCount - trailingUnstable)

  offset = 0
  for (let i = 0; i < reuseCount; i++) {
    offset += prevState.tokens[i].raw.length
  }

  const stableTokens = prevState.tokens.slice(0, reuseCount)
  const remainingContent = newContent.slice(offset)

  if (!remainingContent) {
    return {
      content: newContent,
      tokens: stableTokens,
      stableTokenCount: stableTokens.length,
    }
  }

  try {
    const newTokens = lex(remainingContent) as MarkedToken[]
    return {
      content: newContent,
      tokens: [...stableTokens, ...newTokens],
      stableTokenCount: trailingUnstable === 0 ? stableTokens.length + newTokens.length : stableTokens.length,
    }
  } catch {
    try {
      const fullTokens = lex(newContent) as MarkedToken[]
      return { content: newContent, tokens: fullTokens, stableTokenCount: 0 }
    } catch {
      return { content: newContent, tokens: [], stableTokenCount: 0 }
    }
  }
}
