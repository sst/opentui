export type LatexRenderMode = "unicode" | "ascii"

export interface LatexRenderOptions {
  mode?: LatexRenderMode
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
}

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
  const normalizedSource = source.replaceAll("\\\\", "\n")
  const rows = normalizedSource.split(/\r?\n/).map((line) => new LatexParser(line, mode).parse())
  const width = Math.max(0, ...rows.map((row) => row.width))
  const lines = rows.flatMap((row) => row.lines.map((line) => padRight(line, width)))

  return {
    lines: lines.length > 0 ? lines : [""],
    width,
    height: Math.max(1, lines.length),
    text: lines.join("\n"),
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

    return textBox(this.consume())
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
        const numerator = this.parseRequiredArgument()
        const denominator = this.parseRequiredArgument()
        return fractionBox(numerator, denominator, this.mode)
      }
      case "sqrt": {
        const index = this.parseOptionalArgument()
        const radicand = this.parseRequiredArgument()
        return sqrtBox(index ? new LatexParser(index, this.mode).parse() : null, radicand, this.mode)
      }
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
    let superscript: string | undefined
    let subscript: string | undefined

    while (this.peek() === "^" || this.peek() === "_") {
      const kind = this.consume()
      const value = flattenBox(this.parseScriptArgument())

      if (kind === "^") {
        superscript = value
      } else {
        subscript = value
      }
    }

    return scriptBox(base, superscript, subscript, this.mode)
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

  private parseRequiredArgument(): LatexBox {
    this.consumeWhitespace()

    if (this.peek() === "{") {
      this.consume()
      const box = this.parse("}")
      this.consumeIf("}")
      return box
    }

    return this.parseAtom()
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
}

function textBox(text: string): LatexBox {
  const lines = text.split(/\r?\n/)
  return makeBox(lines, 0)
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

function sqrtBox(index: LatexBox | null, radicand: LatexBox, mode: LatexRenderMode): LatexBox {
  const indexText = index ? toSuperscript(flattenBox(index), mode) : ""

  if (mode === "ascii") {
    return textBox(`${index ? `root[${flattenBox(index)}]` : "sqrt"}(${flattenBox(radicand)})`)
  }

  if (radicand.height === 1) {
    return textBox(`${indexText}√${radicand.lines[0] ?? ""}`)
  }

  const width = Math.max(1, radicand.width)
  const lines = [` ${"─".repeat(width)}`, ...radicand.lines.map((line, row) => `${row === 0 ? "√" : " "}${padRight(line, width)}`)]

  if (indexText.length > 0) {
    lines[0] = `${indexText}${lines[0]}`
  }

  return makeBox(lines, radicand.baseline + 1)
}

function scriptBox(base: LatexBox, superscript: string | undefined, subscript: string | undefined, mode: LatexRenderMode): LatexBox {
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

  return convertScript(value, SUPERSCRIPT, "^")
}

function toSubscript(value: string, mode: LatexRenderMode): string {
  if (mode === "ascii") {
    return needsParens(value) ? `_(${value})` : `_${value}`
  }

  return convertScript(value, SUBSCRIPT, "_")
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

function makeBox(lines: string[], baseline: number): LatexBox {
  const normalizedLines = lines.length > 0 ? lines : [""]
  const width = Math.max(0, ...normalizedLines.map(displayWidth))
  return {
    lines: normalizedLines.map((line) => padRight(line, width)),
    width,
    height: normalizedLines.length,
    baseline: Math.max(0, Math.min(baseline, normalizedLines.length - 1)),
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
