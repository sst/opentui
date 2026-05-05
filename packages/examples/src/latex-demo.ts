import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  type KeyEvent,
  LatexRenderable,
  MarkdownRenderable,
  parseColor,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextRenderable,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const THEME = {
  bg: "#0b1020",
  panel: "#111827",
  panelAlt: "#0f172a",
  border: "#334155",
  accent: "#38bdf8",
  text: "#e5e7eb",
  muted: "#94a3b8",
  error: "#fb7185",
} as const

const markdownStyle = SyntaxStyle.fromStyles({
  default: { fg: parseColor(THEME.text) },
  conceal: { fg: parseColor(THEME.muted) },
  "markup.heading": { fg: parseColor(THEME.accent), bold: true },
  "markup.heading.1": { fg: parseColor("#67e8f9"), bold: true, underline: true },
  "markup.heading.2": { fg: parseColor("#93c5fd"), bold: true },
  "markup.strong": { fg: parseColor("#f8fafc"), bold: true },
  "markup.bold": { fg: parseColor("#f8fafc"), bold: true },
  "markup.italic": { fg: parseColor("#c4b5fd"), italic: true },
  "markup.raw": { fg: parseColor("#bae6fd"), bg: parseColor("#1e293b") },
  "markup.raw.block": { fg: parseColor("#bae6fd"), bg: parseColor("#1e293b") },
  "markup.raw.inline": { fg: parseColor("#bae6fd"), bg: parseColor("#1e293b") },
  "markup.list": { fg: parseColor(THEME.accent) },
  "punctuation.special": { fg: parseColor(THEME.muted) },
})

const formulas = [
  {
    label: "Inline scripts",
    source: "x^2 + y_1",
    displayMode: false,
  },
  {
    label: "Stacked fraction",
    source: "\\frac{1}{\\sqrt{x+1}}",
    displayMode: true,
  },
  {
    label: "Definite integral",
    source: "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
    displayMode: true,
  },
  {
    label: "Limit",
    source: "\\lim_{x\\to 0} \\frac{\\sin x}{x} = 1",
    displayMode: true,
  },
  {
    label: "Infinite series",
    source: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
    displayMode: true,
  },
  {
    label: "Product",
    source: "\\prod_{k=1}^{n} k = n!",
    displayMode: true,
  },
  {
    label: "Derivative",
    source: "\\frac{d}{dx}x^3 = 3x^2",
    displayMode: true,
  },
  {
    label: "Simple matrix",
    source: "\\begin{matrix}a&b\\\\c&d\\end{matrix}",
    displayMode: true,
  },
  {
    label: "Macro expansion",
    source: "\\RR^2 \\to \\RR",
    displayMode: false,
  },
] as const

const macros = {
  "\\RR": "\\mathbb{R}",
}

const markdownContent = `# Markdown math

Inline math is opt-in, so ordinary prices like $12.50 stay readable when math is disabled.
This example enables it, so $x^2 + y_1$ renders in the paragraph.

## Display math

$$
\\frac{a+b}{\\sqrt{c+1}}
$$

### Calculus

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

$$
\\lim_{x\\to 0} \\frac{\\sin x}{x} = 1
$$

$$
\\frac{d}{dx}x^3 = 3x^2
$$

### Large operators

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

$$
\\prod_{k=1}^{n} k = n!
$$

## Tables

| Source | Rendered |
|---|---|
| \`$x^2$\` | $x^2$ |
| \`$y_1$\` | $y_1$ |
| \`$\\RR^2$\` | $\\RR^2$ |
| \`$\\int_0^1 x \\, dx$\` | $\\int_0^1 x \\, dx$ |
| \`$\\lim_{h\\to0} h$\` | $\\lim_{h\\to0} h$ |
| \`$\\sum_{n=1}^4 n$\` | $\\sum_{n=1}^4 n$ |

## Error fallback

Invalid LaTeX stays selectable as source text and is styled with the configured error color:

$$\\definitelybad$$
`

let root: BoxRenderable | null = null
let formulaScroll: ScrollBoxRenderable | null = null
let markdownOutput: MarkdownRenderable | null = null
let statusText: TextRenderable | null = null
let keyboardHandler: ((key: KeyEvent) => void) | null = null
let concealMarkdown = true

function updateStatus(): void {
  if (!statusText) return
  statusText.content = `Markdown conceal: ${concealMarkdown ? "on" : "off"} | C toggle conceal | R clear selection | Formula list scrolls vertically`
}

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor(THEME.bg)

  concealMarkdown = true

  root = new BoxRenderable(renderer, {
    id: "latex-demo-root",
    flexDirection: "column",
    padding: 1,
    backgroundColor: THEME.bg,
    width: "100%",
    height: "100%",
  })
  renderer.root.add(root)

  const header = new BoxRenderable(renderer, {
    id: "latex-demo-header",
    height: 4,
    border: true,
    borderStyle: "double",
    borderColor: THEME.accent,
    backgroundColor: THEME.panel,
    title: "LaTeX Rendering Demo",
    titleAlignment: "center",
    padding: 1,
    flexShrink: 0,
  })
  root.add(header)

  statusText = new TextRenderable(renderer, {
    id: "latex-demo-status",
    content: "",
    fg: THEME.muted,
    wrapMode: "word",
  })
  header.add(statusText)

  const directPanel = new BoxRenderable(renderer, {
    id: "latex-demo-direct-panel",
    height: 20,
    marginTop: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: THEME.border,
    backgroundColor: THEME.panel,
    title: "LatexRenderable",
    padding: 1,
    flexDirection: "column",
    flexShrink: 0,
  })
  root.add(directPanel)

  const formulaLabel = new TextRenderable(renderer, {
    id: "latex-demo-formula-label",
    content: "LatexRenderable samples:",
    fg: THEME.muted,
  })
  directPanel.add(formulaLabel)

  formulaScroll = new ScrollBoxRenderable(renderer, {
    id: "latex-demo-formula-scroll",
    height: 15,
    marginTop: 1,
    backgroundColor: THEME.panel,
    scrollX: false,
    scrollY: true,
    flexShrink: 0,
  })
  directPanel.add(formulaScroll)

  formulas.forEach((formula, index) => {
    const row = new BoxRenderable(renderer, {
      id: `latex-demo-formula-row-${index}`,
      flexDirection: "row",
      columnGap: 1,
      marginBottom: 1,
      flexShrink: 0,
    })
    formulaScroll?.add(row)

    const label = new TextRenderable(renderer, {
      id: `latex-demo-formula-label-${index}`,
      content: `${formula.label}:`,
      width: 18,
      fg: THEME.muted,
      flexShrink: 0,
    })
    row.add(label)

    const output = new LatexRenderable(renderer, {
      id: `latex-demo-formula-output-${index}`,
      content: formula.source,
      displayMode: formula.displayMode,
      macros,
      fg: THEME.text,
      selectable: true,
      selectionBg: "#164e63",
      selectionFg: "#ffffff",
    })
    row.add(output)
  })

  const invalidRow = new BoxRenderable(renderer, {
    id: "latex-demo-invalid-row",
    flexDirection: "row",
    columnGap: 1,
    marginBottom: 1,
    flexShrink: 0,
  })
  formulaScroll.add(invalidRow)

  const invalidLabel = new TextRenderable(renderer, {
    id: "latex-demo-invalid-label",
    content: "Invalid input:",
    width: 18,
    fg: THEME.muted,
    flexShrink: 0,
  })
  invalidRow.add(invalidLabel)

  const invalidLatex = new LatexRenderable(renderer, {
    id: "latex-demo-invalid",
    content: "\\definitelybad",
    displayMode: false,
    errorFg: THEME.error,
    selectable: true,
  })
  invalidRow.add(invalidLatex)

  const markdownScroll = new ScrollBoxRenderable(renderer, {
    id: "latex-demo-markdown-scroll",
    marginTop: 1,
    border: true,
    borderStyle: "single",
    borderColor: THEME.border,
    backgroundColor: THEME.panelAlt,
    title: "MarkdownRenderable with math enabled",
    padding: 1,
    scrollY: true,
    scrollX: false,
    flexGrow: 1,
    flexShrink: 1,
  })
  root.add(markdownScroll)

  markdownOutput = new MarkdownRenderable(renderer, {
    id: "latex-demo-markdown",
    content: markdownContent,
    syntaxStyle: markdownStyle,
    fg: THEME.text,
    bg: THEME.panelAlt,
    conceal: concealMarkdown,
    width: "100%",
    math: {
      latexOptions: {
        macros,
        errorFg: THEME.error,
      },
    },
  })
  markdownScroll.add(markdownOutput)
  formulaScroll.focus()

  updateStatus()

  keyboardHandler = (key: KeyEvent) => {
    if (key.name === "c" && !key.ctrl && !key.meta) {
      concealMarkdown = !concealMarkdown
      if (markdownOutput) {
        markdownOutput.conceal = concealMarkdown
      }
      updateStatus()
      return
    }

    if (key.name === "r" && !key.ctrl && !key.meta) {
      renderer.clearSelection()
    }
  }

  renderer.keyInput.on("keypress", keyboardHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (keyboardHandler) {
    renderer.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  root?.destroyRecursively()
  root = null
  formulaScroll = null
  markdownOutput = null
  statusText = null
  concealMarkdown = true
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
    enableMouseMovement: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
