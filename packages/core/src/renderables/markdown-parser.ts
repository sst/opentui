import { Lexer, Marked, type Token, type TokenizerAndRendererExtension, type Tokens } from "marked"

export interface ParseState {
  content: string
  tokens: Token[]
  stableTokenCount?: number
}

export interface MarkdownParserMathOptions {
  inline?: boolean
  block?: boolean
}

export interface MarkdownParserOptions {
  math?: MarkdownParserMathOptions | false
}

interface LatexMarkedToken extends Tokens.Generic {
  type: "latex_block" | "latex_inline"
  text: string
  displayMode: boolean
}

const blockLatexExtension: TokenizerAndRendererExtension = {
  name: "latex_block",
  level: "block",
  start(src: string): number | undefined {
    const index = src.search(/^ {0,3}\$\$/m)
    return index >= 0 ? index : undefined
  },
  tokenizer(src: string): LatexMarkedToken | undefined {
    const multiline = src.match(/^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n? {0,3}\$\$[ \t]*(?:\n+|$)/)
    if (multiline) {
      return {
        type: "latex_block",
        raw: multiline[0],
        text: multiline[1].trim(),
        displayMode: true,
      } as LatexMarkedToken
    }

    const singleLine = src.match(/^ {0,3}\$\$([^\n]+?)\$\$[ \t]*(?:\n+|$)/)
    if (!singleLine) return undefined

    return {
      type: "latex_block",
      raw: singleLine[0],
      text: singleLine[1].trim(),
      displayMode: true,
    } as LatexMarkedToken
  },
}

function findClosingInlineDollar(src: string, startIndex: number): number {
  for (let i = startIndex; i < src.length; i += 1) {
    const char = src[i]
    if (char === "\n" || char === "\r") return -1
    if (char === "\\") {
      i += 1
      continue
    }
    if (char !== "$" || src[i + 1] === "$") continue
    if (/\d/.test(src[i + 1] ?? "")) continue
    return i
  }

  return -1
}

const inlineLatexExtension: TokenizerAndRendererExtension = {
  name: "latex_inline",
  level: "inline",
  start(src: string): number | undefined {
    const index = src.indexOf("$")
    return index >= 0 ? index : undefined
  },
  tokenizer(src: string): LatexMarkedToken | undefined {
    if (!src.startsWith("$") || src.startsWith("$$") || /\s/.test(src[1] ?? "")) return undefined

    const closing = findClosingInlineDollar(src, 1)
    if (closing === -1) return undefined

    const text = src.slice(1, closing)
    if (text.trim().length === 0 || /\s$/.test(text)) return undefined

    return {
      type: "latex_inline",
      raw: src.slice(0, closing + 1),
      text,
      displayMode: false,
    } as LatexMarkedToken
  },
}

const lexerByMathMode = new Map<string, Marked>()

function getMathMode(options?: MarkdownParserOptions): string {
  const math = options?.math
  if (!math) return "none"
  const inline = math.inline ?? true
  const block = math.block ?? true
  if (inline && block) return "both"
  if (inline) return "inline"
  if (block) return "block"
  return "none"
}

function getMarkedForMathMode(mode: string): Marked {
  const existing = lexerByMathMode.get(mode)
  if (existing) return existing

  const marked = new Marked({ gfm: true })
  const extensions: TokenizerAndRendererExtension[] = []
  if (mode === "both" || mode === "block") extensions.push(blockLatexExtension)
  if (mode === "both" || mode === "inline") extensions.push(inlineLatexExtension)
  if (extensions.length > 0) {
    marked.use({ extensions })
  }
  lexerByMathMode.set(mode, marked)
  return marked
}

function lexMarkdown(content: string, options?: MarkdownParserOptions): Token[] {
  const mode = getMathMode(options)
  if (mode === "none") {
    return Lexer.lex(content, { gfm: true }) as Token[]
  }

  return getMarkedForMathMode(mode).lexer(content) as Token[]
}

/**
 * Incrementally parse markdown, reusing unchanged tokens from previous parse.
 * Compares token.raw at each offset - matching tokens keep same object reference.
 */
export function parseMarkdownIncremental(
  newContent: string,
  prevState: ParseState | null,
  trailingUnstable: number = 2,
  options?: MarkdownParserOptions,
): ParseState {
  if (!prevState || prevState.tokens.length === 0) {
    try {
      const tokens = lexMarkdown(newContent, options)
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
    const newTokens = lexMarkdown(remainingContent, options)
    return {
      content: newContent,
      tokens: [...stableTokens, ...newTokens],
      stableTokenCount: trailingUnstable === 0 ? stableTokens.length + newTokens.length : stableTokens.length,
    }
  } catch {
    try {
      const fullTokens = lexMarkdown(newContent, options)
      return { content: newContent, tokens: fullTokens, stableTokenCount: 0 }
    } catch {
      return { content: newContent, tokens: [], stableTokenCount: 0 }
    }
  }
}
