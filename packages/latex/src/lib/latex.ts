export type LatexRenderMode = "unicode" | "ascii"
export type LatexRenderLayout = "display" | "inline"

export interface LatexRenderOptions {
  mode?: LatexRenderMode
  layout?: LatexRenderLayout
}

export interface LatexRenderResult {
  lines: string[]
  width: number
  height: number
  text: string
}

interface LatexBox {
  lines: string[]
  width: number
  height: number
  baseline: number
  atomKind?: LatexAtomKind
}

type LatexAtomKind = "largeOperator" | "limitOperator" | "integralOperator"

const EMPTY_BOX: LatexBox = {
  lines: [""],
  width: 0,
  height: 1,
  baseline: 0,
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  f: "ᶠ",
  g: "ᵍ",
  h: "ʰ",
  i: "ⁱ",
  j: "ʲ",
  k: "ᵏ",
  l: "ˡ",
  m: "ᵐ",
  n: "ⁿ",
  o: "ᵒ",
  p: "ᵖ",
  r: "ʳ",
  s: "ˢ",
  t: "ᵗ",
  u: "ᵘ",
  v: "ᵛ",
  w: "ʷ",
  x: "ˣ",
  y: "ʸ",
  z: "ᶻ",
}

const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  h: "ₕ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  l: "ₗ",
  m: "ₘ",
  n: "ₙ",
  o: "ₒ",
  p: "ₚ",
  r: "ᵣ",
  s: "ₛ",
  t: "ₜ",
  u: "ᵤ",
  v: "ᵥ",
  x: "ₓ",
}

const MATH_ITALIC_LOWERCASE_START = 0x1d44e
const MATH_ITALIC_UPPERCASE_START = 0x1d434

const UNICODE_COMMANDS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
  lim: "lim",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  log: "log",
  ln: "ln",
  exp: "exp",
  times: "×",
  div: "÷",
  cdot: "·",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  neq: "≠",
  ne: "≠",
  approx: "≈",
  sim: "∼",
  equiv: "≡",
  propto: "∝",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  land: "∧",
  lor: "∨",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  degree: "°",
  circ: "∘",
  bullet: "•",
  ellipsis: "…",
  ldots: "…",
  cdots: "⋯",
}

const ASCII_COMMANDS: Record<string, string> = {
  alpha: "alpha",
  beta: "beta",
  gamma: "gamma",
  delta: "delta",
  epsilon: "epsilon",
  theta: "theta",
  lambda: "lambda",
  mu: "mu",
  pi: "pi",
  sigma: "sigma",
  phi: "phi",
  omega: "omega",
  Gamma: "Gamma",
  Delta: "Delta",
  Theta: "Theta",
  Lambda: "Lambda",
  Pi: "Pi",
  Sigma: "Sigma",
  Phi: "Phi",
  Omega: "Omega",
  infty: "infinity",
  partial: "d",
  nabla: "nabla",
  sum: "sum",
  prod: "prod",
  int: "int",
  oint: "oint",
  lim: "lim",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  log: "log",
  ln: "ln",
  exp: "exp",
  times: "*",
  div: "/",
  cdot: "*",
  pm: "+/-",
  mp: "-/+",
  le: "<=",
  leq: "<=",
  ge: ">=",
  geq: ">=",
  neq: "!=",
  ne: "!=",
  approx: "~",
  sim: "~",
  equiv: "==",
  propto: "~",
  in: "in",
  notin: "notin",
  subset: "subset",
  subseteq: "subseteq",
  supset: "supset",
  supseteq: "supseteq",
  cup: "U",
  cap: "n",
  forall: "forall",
  exists: "exists",
  neg: "not",
  land: "and",
  lor: "or",
  to: "->",
  rightarrow: "->",
  leftarrow: "<-",
  leftrightarrow: "<->",
  Rightarrow: "=>",
  Leftarrow: "<=",
  Leftrightarrow: "<=>",
  degree: "deg",
  circ: "o",
  bullet: "*",
  ellipsis: "...",
  ldots: "...",
  cdots: "...",
}

export function renderLatexToLines(source: string, options: LatexRenderOptions = {}): LatexRenderResult {
  const mode = options.mode ?? "unicode"
  const layout = options.layout ?? "display"
  const normalizedSource = source.replaceAll("\\\\", "\n")
  const rows = normalizedSource.split(/\r?\n/).map((line) => new LatexParser(line, mode, layout).parse())
  const width = Math.max(0, ...rows.map((row) => row.width))
  const lines = rows.flatMap((row) => row.lines.map((line) => padRight(line, width)))

  return {
    lines: lines.length > 0 ? lines : [""],
    width,
    height: Math.max(1, lines.length),
    text: lines.map(trimRight).join("\n"),
  }
}

export function renderLatexToString(source: string, options: LatexRenderOptions = {}): string {
  return renderLatexToLines(source, options).text
}

class LatexParser {
  private position = 0

  constructor(
    private readonly source: string,
    private readonly mode: LatexRenderMode,
    private readonly layout: LatexRenderLayout,
  ) {}

  parse(stop = ""): LatexBox {
    const boxes: LatexBox[] = []

    while (!this.done()) {
      if (stop && this.peek() === stop) {
        break
      }

      const char = this.peek()

      if (char === "^" || char === "_") {
        if (boxes.length === 0) {
          boxes.push(textBox(this.consume()))
          continue
        }

        const base = boxes.pop()!
        boxes.push(this.parseScripts(base))
        continue
      }

      boxes.push(this.parseAtom(stop))
    }

    return concatBoxes(boxes)
  }

  private parseAtom(stop = ""): LatexBox {
    if (this.done()) {
      return EMPTY_BOX
    }

    const char = this.peek()

    if (stop && char === stop) {
      return EMPTY_BOX
    }

    if (char === "{") {
      this.consume()
      const box = this.parse("}")
      this.consumeIf("}")
      return box
    }

    if (char === "\\") {
      return this.parseCommand()
    }

    if (char === "~") {
      this.consume()
      return textBox(" ")
    }

    if (/\s/.test(char)) {
      this.consumeWhitespace()
      return textBox(" ")
    }

    if (char === "-" && this.isBinaryMinus()) {
      this.consume()
      return textBox(" - ")
    }

    return textBox(this.formatMathCharacter(this.consume()))
  }

  private parseCommand(): LatexBox {
    this.consumeIf("\\")
    const name = this.readCommandName()

    if (name.length === 0) {
      return textBox("\\")
    }

    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac": {
        const numerator = this.parseRequiredArgument("inline")
        const denominator = this.parseRequiredArgument("inline")
        if (this.layout === "inline") {
          return inlineFractionBox(numerator, denominator)
        }
        return fractionBox(numerator, denominator, this.mode)
      }
      case "sqrt": {
        const index = this.parseOptionalArgument()
        const radicand = this.parseRequiredArgument()
        return sqrtBox(index ? new LatexParser(index, this.mode, this.layout).parse() : null, radicand, this.mode)
      }
      case "sum":
      case "prod":
        return operatorBox(this.resolveCommand(name), "largeOperator")
      case "lim":
        return operatorBox(this.resolveCommand(name), "limitOperator")
      case "int":
      case "oint":
        return operatorBox(this.resolveCommand(name), "integralOperator")
      case "text":
      case "mathrm":
      case "mathbf":
      case "mathit":
      case "operatorname":
        return textBox(this.parseRawGroup())
      case "left":
      case "right":
      case "big":
      case "Big":
      case "bigg":
      case "Bigg":
        return this.parseAtom()
      case ",":
        return textBox(" ")
      case ";":
        return textBox("  ")
      case ":":
        return textBox(" ")
      case "!":
        return EMPTY_BOX
      default:
        return textBox(this.resolveCommand(name))
    }
  }

  private parseScripts(base: LatexBox): LatexBox {
    let superscript: LatexBox | undefined
    let subscript: LatexBox | undefined

    while (this.peek() === "^" || this.peek() === "_") {
      const kind = this.consume()
      const value = this.parseScriptArgument()

      if (kind === "^") {
        superscript = value
      } else {
        subscript = value
      }
    }

    if (base.atomKind === "largeOperator") {
      if (this.layout === "display") {
        return largeOperatorBox(base, superscript, subscript)
      }
    } else if (base.atomKind === "limitOperator") {
      if (this.layout === "display") {
        return limitOperatorBox(base, superscript, subscript)
      }

      return inlineLimitOperatorBox(base, superscript, subscript, this.mode)
    } else if (base.atomKind === "integralOperator") {
      if (this.layout === "display") {
        return integralOperatorBox(base, superscript, subscript, this.mode)
      }
    }

    return scriptBox(
      base,
      superscript ? flattenBox(superscript) : undefined,
      subscript ? flattenBox(subscript) : undefined,
      this.mode,
    )
  }

  private parseScriptArgument(): LatexBox {
    this.consumeWhitespace()

    if (this.peek() === "{") {
      this.consume()
      const box = this.parse("}")
      this.consumeIf("}")
      return box
    }

    return this.parseAtom()
  }

  private parseRequiredArgument(layout: LatexRenderLayout = this.layout): LatexBox {
    this.consumeWhitespace()

    if (this.peek() === "{") {
      if (layout !== this.layout) {
        return new LatexParser(this.readGroupContent(), this.mode, layout).parse()
      }

      this.consume()
      const box = this.parse("}")
      this.consumeIf("}")
      return box
    }

    return this.parseAtom()
  }

  private readGroupContent(): string {
    if (this.peek() !== "{") {
      return ""
    }

    this.consume()
    let depth = 1
    let value = ""

    while (!this.done() && depth > 0) {
      const char = this.consume()

      if (char === "{") {
        depth++
      } else if (char === "}") {
        depth--
        if (depth === 0) {
          break
        }
      }

      value += char
    }

    return value
  }

  private parseOptionalArgument(): string | null {
    this.consumeWhitespace()

    if (this.peek() !== "[") {
      return null
    }

    this.consume()
    let value = ""
    while (!this.done() && this.peek() !== "]") {
      value += this.consume()
    }
    this.consumeIf("]")
    return value
  }

  private parseRawGroup(): string {
    this.consumeWhitespace()

    if (this.peek() !== "{") {
      return ""
    }

    this.consume()
    let depth = 1
    let value = ""

    while (!this.done() && depth > 0) {
      const char = this.consume()

      if (char === "{") {
        depth++
      } else if (char === "}") {
        depth--
        if (depth === 0) {
          break
        }
      }

      value += char
    }

    return value.replace(/\s+/g, " ")
  }

  private resolveCommand(name: string): string {
    if (this.mode === "ascii") {
      return ASCII_COMMANDS[name] ?? name
    }

    return UNICODE_COMMANDS[name] ?? name
  }

  private formatMathCharacter(char: string): string {
    if (this.mode === "ascii") {
      return char
    }

    if (/^[a-z]$/.test(char)) {
      if (char === "h") {
        return "ℎ"
      }

      return String.fromCodePoint(MATH_ITALIC_LOWERCASE_START + char.charCodeAt(0) - "a".charCodeAt(0))
    }

    if (/^[A-Z]$/.test(char)) {
      return String.fromCodePoint(MATH_ITALIC_UPPERCASE_START + char.charCodeAt(0) - "A".charCodeAt(0))
    }

    return char
  }

  private readCommandName(): string {
    if (this.done()) {
      return ""
    }

    let name = ""
    while (!this.done() && /[A-Za-z]/.test(this.peek())) {
      name += this.consume()
    }

    if (name.length > 0) {
      return name
    }

    return this.consume()
  }

  private consumeWhitespace(): void {
    while (!this.done() && /\s/.test(this.peek())) {
      this.consume()
    }
  }

  private consumeIf(char: string): boolean {
    if (this.peek() === char) {
      this.consume()
      return true
    }

    return false
  }

  private consume(): string {
    return this.source[this.position++] ?? ""
  }

  private peek(): string {
    return this.source[this.position] ?? ""
  }

  private done(): boolean {
    return this.position >= this.source.length
  }

  private isBinaryMinus(): boolean {
    const previous = this.source[this.position - 1] ?? ""
    const next = this.source[this.position + 1] ?? ""

    if (previous.length === 0 || next.length === 0) {
      return false
    }

    return !/[\\\s{[(^_+\-=,]/.test(previous) && !/[\s})\]^_+\-=,]/.test(next)
  }
}

function textBox(text: string): LatexBox {
  const lines = text.split(/\r?\n/)
  return makeBox(lines, 0)
}

function operatorBox(text: string, atomKind: LatexAtomKind): LatexBox {
  return makeBox([text], 0, atomKind)
}

function fractionBox(numerator: LatexBox, denominator: LatexBox, mode: LatexRenderMode): LatexBox {
  const width = Math.max(1, numerator.width, denominator.width)
  const bar = (mode === "ascii" ? "-" : "─").repeat(width)
  const lines = [
    ...numerator.lines.map((line) => center(line, width)),
    bar,
    ...denominator.lines.map((line) => center(line, width)),
  ]

  return makeBox(lines, numerator.height)
}

function largeOperatorBox(
  base: LatexBox,
  superscript: LatexBox | undefined,
  subscript: LatexBox | undefined,
): LatexBox {
  if (!superscript && !subscript) {
    return base
  }

  const baseText = flattenBox(base)
  const superText = superscript ? flattenBox(superscript) : ""
  const subText = subscript ? flattenBox(subscript) : ""
  const width = Math.max(displayWidth(baseText), displayWidth(superText), displayWidth(subText), 1)
  const lines: string[] = []

  if (superscript) {
    lines.push(center(superText, width))
  }

  const baseline = lines.length
  lines.push(center(baseText, width))

  if (subscript) {
    lines.push(center(subText, width))
  }

  return makeBox(lines, baseline)
}

function limitOperatorBox(
  base: LatexBox,
  superscript: LatexBox | undefined,
  subscript: LatexBox | undefined,
): LatexBox {
  if (!superscript && !subscript) {
    return base
  }

  const baseText = flattenBox(base)
  const superText = superscript ? flattenBox(superscript) : ""
  const subText = subscript ? flattenBox(subscript) : ""
  const width = Math.max(displayWidth(baseText), displayWidth(superText), displayWidth(subText), 1)
  const lines = [center(baseText, width)]

  if (subscript) {
    lines.push(center(subText, width))
  }

  if (superscript) {
    lines.unshift(center(superText, width))
    return makeBox(lines, 1)
  }

  return makeBox(lines, 0)
}

function inlineLimitOperatorBox(
  base: LatexBox,
  superscript: LatexBox | undefined,
  subscript: LatexBox | undefined,
  mode: LatexRenderMode,
): LatexBox {
  const baseText = flattenBox(base)
  const superText = superscript ? flattenBox(superscript) : ""
  const subText = subscript ? flattenBox(subscript) : ""

  if (mode === "ascii") {
    const suffix = `${subscript ? `_${subText}` : ""}${superscript ? `^${superText}` : ""}`
    return textBox(`${baseText}${suffix}`)
  }

  const qualifier = subscript ? ` ${subText}` : ""
  const suffix = superscript ? toSuperscript(superText, mode) : ""
  return textBox(`${baseText}${qualifier}${suffix} `)
}

function integralOperatorBox(
  base: LatexBox,
  superscript: LatexBox | undefined,
  subscript: LatexBox | undefined,
  mode: LatexRenderMode,
): LatexBox {
  const baseText = flattenBox(base)

  if (baseText === "∮" && mode === "unicode") {
    return contourIntegralBox(baseText, superscript, subscript)
  }

  if (!superscript && !subscript) {
    return mode === "ascii" ? base : makeBox(["⌠", "⎮", "⌡"], 1)
  }

  if (mode === "ascii") {
    return scriptBox(
      base,
      superscript ? flattenBox(superscript) : undefined,
      subscript ? flattenBox(subscript) : undefined,
      mode,
    )
  }

  const superText = superscript ? flattenBox(superscript) : ""
  const subText = subscript ? flattenBox(subscript) : ""
  const width = Math.max(displayWidth(superText), displayWidth(subText), 1)
  const lines: string[] = []

  if (superscript) {
    lines.push(center(superText, width))
  }

  lines.push(center("⌠", width), center("⎮", width), center("⌡", width))

  if (subscript) {
    lines.push(center(subText, width))
  }

  return makeBox(lines, superscript ? 2 : 1)
}

function contourIntegralBox(
  baseText: string,
  superscript: LatexBox | undefined,
  subscript: LatexBox | undefined,
): LatexBox {
  const superText = superscript ? flattenBox(superscript) : ""
  const subText = subscript ? flattenBox(subscript) : ""
  const width = Math.max(displayWidth(baseText), displayWidth(superText), displayWidth(subText), 1)
  const lines: string[] = []

  if (superscript) {
    lines.push(center(superText, width))
  }

  const baseline = lines.length
  lines.push(center(baseText, width))

  if (subscript) {
    lines.push(center(subText, width))
  }

  return makeBox(
    lines.map((line) => ` ${line} `),
    baseline,
  )
}

function inlineFractionBox(numerator: LatexBox, denominator: LatexBox): LatexBox {
  const numeratorText = wrapInlineFractionPart(flattenBox(numerator), "numerator")
  const denominatorText = wrapInlineFractionPart(flattenBox(denominator), "denominator")
  return textBox(`${numeratorText}/${denominatorText}`)
}

function wrapInlineFractionPart(value: string, position: "numerator" | "denominator"): string {
  return needsInlineFractionParens(value, position) ? `(${value})` : value
}

function sqrtBox(index: LatexBox | null, radicand: LatexBox, mode: LatexRenderMode): LatexBox {
  const indexValue = index ? flattenBox(index) : ""

  if (mode === "ascii") {
    return textBox(`${index ? `root[${indexValue}]` : "sqrt"}(${flattenBox(radicand)})`)
  }

  const root = rootMarker(indexValue, mode)

  if (radicand.height === 1) {
    return textBox(`${root.indexText}${root.glyph}${radicand.lines[0] ?? ""}`)
  }

  const width = Math.max(1, radicand.width)
  const prefixWidth = Math.max(2, displayWidth(root.glyph) + 1, displayWidth(root.indexText) + 1)
  const lines = [
    `${root.indexText.padEnd(prefixWidth)}┌${"─".repeat(width + 1)}`,
    ...radicand.lines.map((line, row) => {
      const radical = row === radicand.baseline ? root.glyph : ""
      return `${radical.padEnd(prefixWidth)}│ ${padRight(line, width)}`
    }),
  ]

  return makeBox(lines, radicand.baseline + 1)
}

function rootMarker(indexValue: string, mode: LatexRenderMode): { glyph: string; indexText: string } {
  if (mode === "ascii" || indexValue.length === 0) {
    return { glyph: "√", indexText: "" }
  }

  if (indexValue === "3") {
    return { glyph: "∛", indexText: "" }
  }

  if (indexValue === "4") {
    return { glyph: "∜", indexText: "" }
  }

  return {
    glyph: "√",
    indexText: toSuperscript(indexValue, mode),
  }
}

function scriptBox(
  base: LatexBox,
  superscript: string | undefined,
  subscript: string | undefined,
  mode: LatexRenderMode,
): LatexBox {
  const baseText = flattenBox(base)
  const superText = superscript ? toSuperscript(superscript, mode) : ""
  const subText = subscript ? toSubscript(subscript, mode) : ""

  if (mode === "ascii") {
    const suffix = `${subscript ? `_${needsParens(subscript) ? `(${subscript})` : subscript}` : ""}${
      superscript ? `^${needsParens(superscript) ? `(${superscript})` : superscript}` : ""
    }`
    return textBox(`${baseText}${suffix}`)
  }

  return textBox(`${baseText}${subText}${superText}`)
}

function toSuperscript(value: string, mode: LatexRenderMode): string {
  if (mode === "ascii") {
    return needsParens(value) ? `^(${value})` : `^${value}`
  }

  return convertScript(normalizeMathItalic(value), SUPERSCRIPT, "^")
}

function toSubscript(value: string, mode: LatexRenderMode): string {
  if (mode === "ascii") {
    return needsParens(value) ? `_(${value})` : `_${value}`
  }

  return convertScript(normalizeMathItalic(value), SUBSCRIPT, "_")
}

function normalizeMathItalic(value: string): string {
  let normalized = ""

  for (const char of value) {
    const codePoint = char.codePointAt(0)

    if (char === "ℎ") {
      normalized += "h"
    } else if (codePoint && codePoint >= MATH_ITALIC_LOWERCASE_START && codePoint < MATH_ITALIC_LOWERCASE_START + 26) {
      normalized += String.fromCharCode("a".charCodeAt(0) + codePoint - MATH_ITALIC_LOWERCASE_START)
    } else if (codePoint && codePoint >= MATH_ITALIC_UPPERCASE_START && codePoint < MATH_ITALIC_UPPERCASE_START + 26) {
      normalized += String.fromCharCode("A".charCodeAt(0) + codePoint - MATH_ITALIC_UPPERCASE_START)
    } else {
      normalized += char
    }
  }

  return normalized
}

function convertScript(value: string, map: Record<string, string>, prefix: string): string {
  const chars = [...value]
  const converted = chars.map((char) => map[char])

  if (converted.every((char) => char !== undefined)) {
    return converted.join("")
  }

  return `${prefix}${needsParens(value) ? `(${value})` : value}`
}

function concatBoxes(boxes: LatexBox[]): LatexBox {
  const visibleBoxes = boxes.filter((box) => box.width > 0 || box.lines.some((line) => line.length > 0))
  if (visibleBoxes.length === 0) {
    return EMPTY_BOX
  }

  const baseline = Math.max(...visibleBoxes.map((box) => box.baseline))
  const below = Math.max(...visibleBoxes.map((box) => box.height - box.baseline - 1))
  const height = baseline + below + 1
  const lines: string[] = []

  for (let y = 0; y < height; y++) {
    let line = ""

    for (const box of visibleBoxes) {
      const sourceY = y - (baseline - box.baseline)
      if (sourceY < 0 || sourceY >= box.height) {
        line += " ".repeat(box.width)
      } else {
        line += padRight(box.lines[sourceY] ?? "", box.width)
      }
    }

    lines.push(trimRight(line))
  }

  return makeBox(lines, baseline)
}

function makeBox(lines: string[], baseline: number, atomKind?: LatexAtomKind): LatexBox {
  const normalizedLines = lines.length > 0 ? lines : [""]
  const width = Math.max(0, ...normalizedLines.map(displayWidth))
  return {
    lines: normalizedLines.map((line) => padRight(line, width)),
    width,
    height: normalizedLines.length,
    baseline: Math.max(0, Math.min(baseline, normalizedLines.length - 1)),
    atomKind,
  }
}

function flattenBox(box: LatexBox): string {
  return trimRight(box.lines.join(" ").replace(/\s+/g, " "))
}

function center(value: string, width: number): string {
  const valueWidth = displayWidth(value)
  if (valueWidth >= width) {
    return value
  }

  const left = Math.floor((width - valueWidth) / 2)
  return `${" ".repeat(left)}${value}${" ".repeat(width - valueWidth - left)}`
}

function padRight(value: string, width: number): string {
  const valueWidth = displayWidth(value)
  if (valueWidth >= width) {
    return value
  }

  return value + " ".repeat(width - valueWidth)
}

function trimRight(value: string): string {
  return value.replace(/\s+$/g, "")
}

function displayWidth(value: string): number {
  return [...value].length
}

function needsParens(value: string): boolean {
  return [...value].length !== 1 || /\s/.test(value)
}

function needsInlineFractionParens(value: string, position: "numerator" | "denominator"): boolean {
  const normalized = normalizeMathItalic(value)

  if (/[\s+\-*/=<>±∓]/.test(normalized)) {
    return true
  }

  return position === "denominator" && /^\d+[A-Za-z]+$/.test(normalized)
}
