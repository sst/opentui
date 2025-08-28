const PUNCTUATION = new Set(Array.from(",./\\;:'\"`~!@#$%^&*()-=+[]{}<>?|"))

const isWhitespace = (ch: string) => ch === " " || ch === "\t"
const isNewline = (ch: string) => ch === "\n" || ch === "\r"
const isPunctuation = (ch: string) => PUNCTUATION.has(ch)
const isWordChar = (ch: string) => /[A-Za-z0-9_]/.test(ch)

type Kind = "space" | "punct" | "word" | "other"
const kindOf = (ch: string): Kind => {
  if (isWhitespace(ch)) return "space"
  if (isNewline(ch)) return "other"
  if (isPunctuation(ch)) return "punct"
  if (isWordChar(ch)) return "word"
  return "other"
}

function nextWordEnd(text: string, caret: number): number {
  const n = text.length
  let i = caret

  // Skip initial whitespace
  while (i < n && isWhitespace(text[i])) {
    i++
  }

  if (i >= n) return n

  let isFirstIteration = true

  // Find next boundary
  while (i < n - 1) {
    const left = text[i]
    const right = text[i + 1]

    // First iteration: skip single punctuation if followed by non-punct
    if (isFirstIteration && isPunctuation(left) && !isPunctuation(right) && right !== "\n") {
      isFirstIteration = false
      i++
      continue
    }
    isFirstIteration = false

    const leftKind = kindOf(left)
    const rightKind = kindOf(right)

    // Stop at boundaries or newlines
    if ((leftKind !== rightKind && !isWhitespace(left)) || right === "\n") {
      return i + 1
    }

    i++
  }

  return n
}

function previousWordStart(text: string, caret: number): number {
  let i = caret

  // Skip initial whitespace
  while (i > 0 && isWhitespace(text[i - 1])) {
    i--
  }

  if (i <= 0) return 0

  let isFirstIteration = true

  // Find preceding boundary
  while (i > 0) {
    const left = text[i - 1]
    const right = i < text.length ? text[i] : ""

    // First iteration: skip single punctuation if preceded by non-punct
    if (isFirstIteration && isPunctuation(right) && !isPunctuation(left) && left !== "\n") {
      isFirstIteration = false
      i--
      continue
    }
    isFirstIteration = false

    const leftKind = kindOf(left)
    const rightKind = kindOf(right)

    // Stop at boundaries or newlines
    if ((leftKind !== rightKind && !isWhitespace(right)) || left === "\n") {
      return i
    }

    i--
  }

  return 0
}

export function nextWordEndCrossLines(text: string, caret: number): number {
  let i = nextWordEnd(text, caret)
  if (i < text.length && text[i] === "\n") {
    i++
    i = nextWordEnd(text, i)
  }
  return i
}

export function previousWordStartCrossLines(text: string, caret: number): number {
  let i = previousWordStart(text, caret)
  if (i > 0 && text[i - 1] === "\n") {
    i--
    i = previousWordStart(text, i)
  }
  return i
}
