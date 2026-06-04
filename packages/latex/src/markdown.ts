import { registerMarkdownContentTransform } from "@opentui/core"
import { renderLatexToString } from "./lib/latex.js"

let unregisterLatexMarkdown: (() => void) | null = null

export function registerLatexMarkdown(): () => void {
  if (unregisterLatexMarkdown) {
    return unregisterLatexMarkdown
  }

  unregisterLatexMarkdown = registerMarkdownContentTransform(renderMarkdownMath)

  return () => {
    unregisterLatexMarkdown?.()
    unregisterLatexMarkdown = null
  }
}

export function renderMarkdownMath(content: string): string {
  let output = ""
  let lineStart = 0
  let inFence: string | null = null
  let displayMathLines: string[] | null = null

  while (lineStart < content.length) {
    const lineEnd = content.indexOf("\n", lineStart)
    const hasNewline = lineEnd >= 0
    const end = hasNewline ? lineEnd : content.length
    const line = content.slice(lineStart, end)
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})/)

    if (displayMathLines) {
      const displayEnd = line.indexOf("$$")
      if (displayEnd >= 0) {
        const beforeDisplayEnd = line.slice(0, displayEnd)
        if (beforeDisplayEnd.length > 0) {
          displayMathLines.push(beforeDisplayEnd)
        }
        output += renderLatexToString(displayMathLines.join("\n"))
        const afterDisplay = line.slice(displayEnd + 2)
        if (afterDisplay.length > 0) {
          output += renderInlineMarkdownMath(afterDisplay)
        }
        displayMathLines = null
      } else {
        displayMathLines.push(line)
      }
    } else if (fence) {
      const marker = fence[1]![0]
      if (!inFence) {
        inFence = marker
      } else if (inFence === marker) {
        inFence = null
      }

      output += line
    } else if (inFence) {
      output += line
    } else {
      const displayStart = findDisplayMathLineStart(line)
      if (displayStart >= 0) {
        const beforeDisplay = line.slice(0, displayStart)
        const afterOpen = line.slice(displayStart + 2)
        const displayEnd = afterOpen.indexOf("$$")

        output += renderInlineMarkdownMath(beforeDisplay)

        if (displayEnd >= 0) {
          output += renderLatexToString(afterOpen.slice(0, displayEnd))
          output += renderInlineMarkdownMath(afterOpen.slice(displayEnd + 2))
        } else {
          displayMathLines = afterOpen.length > 0 ? [afterOpen] : []
        }
      } else {
        output += renderInlineMarkdownMath(line)
      }
    }

    if (hasNewline && !displayMathLines) {
      output += "\n"
    }

    lineStart = hasNewline ? lineEnd + 1 : content.length
  }

  if (displayMathLines) {
    output += renderLatexToString(displayMathLines.join("\n"))
  }

  return output
}

function findDisplayMathLineStart(line: string): number {
  const start = line.indexOf("$$")
  if (start < 0 || isEscaped(line, start)) {
    return -1
  }

  const before = line.slice(0, start)
  return before.trim().length === 0 ? start : -1
}

function renderInlineMarkdownMath(line: string): string {
  let output = ""
  let index = 0

  while (index < line.length) {
    if (line[index] === "`") {
      const end = findInlineCodeEnd(line, index)
      if (end >= 0) {
        output += line.slice(index, end)
        index = end
        continue
      }
    }

    const bracketMath = tryReadBracketMath(line, index)
    if (bracketMath) {
      output += renderLatexToString(bracketMath.content)
      index = bracketMath.end
      continue
    }

    const dollarMath = tryReadDollarMath(line, index)
    if (dollarMath) {
      const rendered = renderLatexToString(dollarMath.content)
      output += dollarMath.display ? `\n${rendered}\n` : rendered
      index = dollarMath.end
      continue
    }

    output += line[index]
    index += 1
  }

  return output
}

function findInlineCodeEnd(line: string, start: number): number {
  let tickCount = 0
  while (line[start + tickCount] === "`") {
    tickCount += 1
  }

  const marker = "`".repeat(tickCount)
  const end = line.indexOf(marker, start + tickCount)
  return end >= 0 ? end + tickCount : -1
}

function tryReadBracketMath(line: string, start: number): { content: string; end: number } | null {
  if (line[start] !== "\\" || (line[start + 1] !== "(" && line[start + 1] !== "[")) {
    return null
  }

  const closer = line[start + 1] === "(" ? "\\)" : "\\]"
  const end = line.indexOf(closer, start + 2)
  if (end < 0) {
    return null
  }

  return {
    content: line.slice(start + 2, end),
    end: end + closer.length,
  }
}

function tryReadDollarMath(line: string, start: number): { content: string; end: number; display: boolean } | null {
  if (line[start] !== "$" || isEscaped(line, start)) {
    return null
  }

  const display = line[start + 1] === "$"
  const delimiter = display ? "$$" : "$"
  const contentStart = start + delimiter.length

  if (!display && /\s|\d/.test(line[contentStart] ?? "")) {
    return null
  }

  let searchFrom = contentStart
  while (searchFrom < line.length) {
    const end = line.indexOf(delimiter, searchFrom)
    if (end < 0) {
      return null
    }

    if (!isEscaped(line, end) && (display || !/\s/.test(line[end - 1] ?? ""))) {
      return {
        content: line.slice(contentStart, end),
        end: end + delimiter.length,
        display,
      }
    }

    searchFrom = end + delimiter.length
  }

  return null
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 1
}
