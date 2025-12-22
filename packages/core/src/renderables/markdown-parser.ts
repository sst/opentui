import { Lexer, type MarkedToken } from "marked"

export interface ParseState {
  content: string
  tokens: MarkedToken[]
}

/**
 * Incrementally parse markdown, reusing unchanged tokens from previous parse.
 *
 * Key insight: We compare token.raw at each offset position. If it matches,
 * we reuse the SAME token object (by reference). This allows consumers to
 * detect unchanged tokens with `prevToken === newToken`.
 *
 * @param newContent - The new markdown content
 * @param prevState - Previous parse state (or null for first parse)
 * @param trailingUnstable - Number of trailing tokens to always re-parse (for streaming)
 */
export function parseMarkdownIncremental(
  newContent: string,
  prevState: ParseState | null,
  trailingUnstable: number = 2,
): ParseState {
  // First parse or empty previous
  if (!prevState || prevState.tokens.length === 0) {
    try {
      const tokens = Lexer.lex(newContent, { gfm: true }) as MarkedToken[]
      return { content: newContent, tokens }
    } catch {
      return { content: newContent, tokens: [] }
    }
  }

  // Find how many tokens from start are unchanged
  let offset = 0
  let reuseCount = 0

  for (const token of prevState.tokens) {
    const tokenEnd = offset + token.raw.length

    // Check if new content at this position exactly matches the token's raw
    if (tokenEnd <= newContent.length && newContent.slice(offset, tokenEnd) === token.raw) {
      reuseCount++
      offset = tokenEnd
    } else {
      break
    }
  }

  // Keep last N tokens as unstable (they might change with more content)
  // Example: "# Hello" might become "# Hello World" - the heading token changes
  reuseCount = Math.max(0, reuseCount - trailingUnstable)

  // Recalculate offset for stable tokens only
  offset = 0
  for (let i = 0; i < reuseCount; i++) {
    offset += prevState.tokens[i].raw.length
  }

  // Reuse stable tokens (SAME object references!)
  const stableTokens = prevState.tokens.slice(0, reuseCount)
  const remainingContent = newContent.slice(offset)

  if (!remainingContent) {
    return { content: newContent, tokens: stableTokens }
  }

  try {
    const newTokens = Lexer.lex(remainingContent, { gfm: true }) as MarkedToken[]
    return { content: newContent, tokens: [...stableTokens, ...newTokens] }
  } catch {
    // Parse error - return what we have
    return { content: newContent, tokens: stableTokens }
  }
}
