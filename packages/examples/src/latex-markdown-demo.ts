import {
  BoxRenderable,
  CliRenderer,
  MarkdownRenderable,
  RGBA,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextAttributes,
  TextRenderable,
  createCliRenderer,
  parseColor,
  type KeyEvent,
} from "@opentui/core"
import { LatexRenderable, registerLatexMarkdown } from "@opentui/latex"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const ROOT_ID = "latex-markdown-demo-root"

function getMarkdownContent(latexEnabled: boolean): string {
  const mode = latexEnabled
    ? "LaTeX Markdown is **enabled**. Press `M` to unregister it and reveal the raw source."
    : "LaTeX Markdown is **disabled**. Press `M` to register it and render the math."

  return String.raw`# LaTeX Markdown

${mode}

The same Markdown source is used in both modes. Only the package registration changes.

## Greatest Hits

- Quadratic formula: $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$
- Euler identity: $e^{i\pi} + 1 = 0$
- Indexed symbols: \(\alpha_i^2 + \beta_j^2 \le \gamma^2\)
- Tiny calculus: $\frac{dy}{dx} = \lim_{h \to 0}\frac{f(x+h)-f(x)}{h}$
- Logic: $\forall x \in X, \exists y \in Y$

## Display Math

$$
\frac{\sum_{i=1}^{n} x_i}{n}
$$

$$
\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

## Table Playground

Tables use the same registered Markdown transform:

| Scene | Formula | Terminal rendering |
| --- | --- | --- |
| Geometry | $\sqrt{a^2+b^2}$ | distance |
| Statistics | $\frac{\sum x_i}{n}$ | average |
| Logic | $\alpha_i \Rightarrow \beta_i$ | implication |
| Physics | $E = mc^2$ | energy |

## Theorem Card

> If $a^2 + b^2 = c^2$, a right triangle is hiding in the grid.
>
> The same Markdown blockquote can mix text, links, and math like $\theta \le 90^\circ$.

## Notebook Snippets

1. Start with a symbolic signal: $s(t) = A\sin(\omega t + \phi)$.
2. Normalize it with $\frac{s(t)-\mu}{\sigma}$.
3. Compare two outcomes: $p(x) \ge q(x)$.
4. Finish with an infinite horizon: $\sum_{n=0}^{\infty} r^n$.

## Code Safety

Inline code stays untouched: \`$x^2$\`

\`\`\`tex
\frac{this}{also stays untouched}
\`\`\`

## Symbol Sampler

| Input | Output |
| --- | --- |
| \`$\\alpha_i^2$\` | $\alpha_i^2$ |
| \`$x \\le y$\` | $x \le y$ |
| \`$A \\cap B$\` | $A \cap B$ |
| \`$p \\to q$\` | $p \to q$ |

## More Display Blocks

$$
\sqrt{1 + \frac{x^2}{1 - x^2}}
$$

$$
\frac{\alpha + \beta}{\gamma + \delta}
$$

That is a lot of math for a terminal, and it still scrolls like ordinary Markdown.
`
}

const galleryFormulas = [
  {
    title: "Quadratic",
    content: String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
    color: "#FDE68A",
  },
  {
    title: "Mean",
    content: String.raw`\frac{\sum x_i}{n}`,
    color: "#A7F3D0",
  },
  {
    title: "Gradient",
    content: String.raw`\nabla f(x)`,
    color: "#BAE6FD",
  },
  {
    title: "Signal",
    content: String.raw`A\sin(\omega t + \phi)`,
    color: "#F0ABFC",
  },
  {
    title: "Logic",
    content: String.raw`\forall x \in X \to y`,
    color: "#C4B5FD",
  },
]

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: parseColor("#E5E7EB") },
  "markup.heading": { fg: parseColor("#67E8F9"), bold: true },
  "markup.heading.1": { fg: parseColor("#FDE68A"), bold: true, underline: true },
  "markup.strong": { fg: parseColor("#F8FAFC"), bold: true },
  "markup.italic": { fg: parseColor("#F8FAFC"), italic: true },
  "markup.list": { fg: parseColor("#A7F3D0") },
  "markup.quote": { fg: parseColor("#94A3B8"), italic: true },
  "markup.raw": { fg: parseColor("#BAE6FD"), bg: parseColor("#111827") },
  "markup.raw.block": { fg: parseColor("#BAE6FD"), bg: parseColor("#111827") },
  "markup.raw.inline": { fg: parseColor("#BAE6FD"), bg: parseColor("#111827") },
  "markup.link": { fg: parseColor("#93C5FD"), underline: true },
  "markup.link.label": { fg: parseColor("#BFDBFE"), underline: true },
  "markup.link.url": { fg: parseColor("#93C5FD"), underline: true },
  "punctuation.special": { fg: parseColor("#64748B") },
  conceal: { fg: parseColor("#64748B") },
})

let unregisterMarkdownLatex: (() => void) | null = null
let latexMarkdownEnabled = true
let markdownDisplay: MarkdownRenderable | null = null
let badgeText: TextRenderable | null = null
let modeText: TextRenderable | null = null
let keyHandler: ((key: KeyEvent) => void) | null = null

function setLatexMarkdownEnabled(enabled: boolean): void {
  latexMarkdownEnabled = enabled

  if (enabled && !unregisterMarkdownLatex) {
    unregisterMarkdownLatex = registerLatexMarkdown()
  } else if (!enabled && unregisterMarkdownLatex) {
    unregisterMarkdownLatex()
    unregisterMarkdownLatex = null
  }

  if (badgeText) {
    badgeText.content = enabled ? "math: registered" : "math: raw source"
    badgeText.fg = enabled ? "#5EEAD4" : "#FCA5A5"
  }

  if (modeText) {
    modeText.content = enabled
      ? "M: unregister math transform and show raw LaTeX"
      : "M: register math transform and render formulas"
    modeText.fg = enabled ? "#A7F3D0" : "#FCA5A5"
  }

  if (markdownDisplay) {
    markdownDisplay.content = ""
    markdownDisplay.content = getMarkdownContent(enabled)
  }
}

function handleKeyPress(key: KeyEvent): void {
  if ((key.name?.toLowerCase() === "m" || key.raw === "M") && !key.ctrl && !key.meta) {
    setLatexMarkdownEnabled(!latexMarkdownEnabled)
  }
}

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor("#0B1020")
  setLatexMarkdownEnabled(true)

  const root = new BoxRenderable(renderer, {
    id: ROOT_ID,
    width: "100%",
    height: "100%",
    padding: 1,
    flexDirection: "column",
    backgroundColor: RGBA.fromHex("#0B1020"),
  })
  renderer.root.add(root)

  const header = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-header`,
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 1,
  })
  root.add(header)

  const headerText = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-header-text`,
    flexDirection: "column",
    flexGrow: 1,
  })
  header.add(headerText)

  headerText.add(
    new TextRenderable(renderer, {
      id: `${ROOT_ID}-title`,
      content: "LaTeX Markdown Lab",
      fg: "#F8FAFC",
      attributes: TextAttributes.BOLD,
    }),
  )

  headerText.add(
    new TextRenderable(renderer, {
      id: `${ROOT_ID}-subtitle`,
      content: "Markdown math, display blocks, tables, quotes, and standalone formulas",
      fg: "#94A3B8",
    }),
  )

  badgeText = new TextRenderable(renderer, {
    id: `${ROOT_ID}-badge`,
    content: "math: registered",
    fg: "#5EEAD4",
    attributes: TextAttributes.BOLD,
    flexShrink: 0,
  })
  header.add(badgeText)

  modeText = new TextRenderable(renderer, {
    id: `${ROOT_ID}-mode`,
    content: "M: unregister math transform and show raw LaTeX",
    fg: "#A7F3D0",
    marginBottom: 1,
  })
  root.add(modeText)

  const body = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-body`,
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    gap: 2,
  })
  root.add(body)

  const markdownPanel = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-markdown-panel`,
    flexGrow: 1,
    height: "100%",
    border: true,
    borderStyle: "rounded",
    borderColor: "#2563EB",
    padding: 1,
    flexDirection: "column",
  })
  body.add(markdownPanel)

  markdownPanel.add(
    new TextRenderable(renderer, {
      id: `${ROOT_ID}-markdown-label`,
      content: "MarkdownRenderable",
      fg: "#93C5FD",
      attributes: TextAttributes.BOLD,
      marginBottom: 1,
    }),
  )

  const scroll = new ScrollBoxRenderable(renderer, {
    id: `${ROOT_ID}-scroll`,
    width: "100%",
    flexGrow: 1,
    scrollbar: true,
  })
  markdownPanel.add(scroll)

  markdownDisplay = new MarkdownRenderable(renderer, {
      id: `${ROOT_ID}-markdown`,
      content: getMarkdownContent(latexMarkdownEnabled),
      syntaxStyle,
      fg: "#E5E7EB",
      tableOptions: {
        widthMode: "content",
        style: "grid",
      },
    })
  scroll.add(markdownDisplay)

  const standalonePanel = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-standalone-panel`,
    width: 42,
    height: "100%",
    border: true,
    borderStyle: "rounded",
    borderColor: "#14B8A6",
    padding: 1,
    flexDirection: "column",
    flexShrink: 0,
  })
  body.add(standalonePanel)

  standalonePanel.add(
    new TextRenderable(renderer, {
      id: `${ROOT_ID}-standalone-label`,
      content: "LatexRenderable",
      fg: "#5EEAD4",
      attributes: TextAttributes.BOLD,
      marginBottom: 1,
    }),
  )

  for (const [index, formula] of galleryFormulas.entries()) {
    const item = new BoxRenderable(renderer, {
      id: `${ROOT_ID}-gallery-${index}`,
      width: "100%",
      border: ["left"],
      borderColor: formula.color,
      paddingLeft: 1,
      marginBottom: 1,
      flexDirection: "column",
    })
    standalonePanel.add(item)

    item.add(
      new TextRenderable(renderer, {
        id: `${ROOT_ID}-gallery-${index}-title`,
        content: formula.title,
        fg: formula.color,
        attributes: TextAttributes.BOLD,
      }),
    )

    item.add(
      new LatexRenderable(renderer, {
        id: `${ROOT_ID}-gallery-${index}-formula`,
        content: formula.content,
        fg: "#F8FAFC",
        align: "center",
        width: "100%",
      }),
    )
  }

  standalonePanel.add(
    new TextRenderable(renderer, {
      id: `${ROOT_ID}-note`,
      content:
        "Press M to flip Markdown math between rendered formulas and raw source. Standalone LatexRenderable cards stay rendered.",
      fg: "#CBD5E1",
      wrapMode: "word",
    }),
  )

  keyHandler = handleKeyPress
  renderer.keyInput.on("keypress", keyHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (keyHandler) {
    renderer.keyInput.off("keypress", keyHandler)
    keyHandler = null
  }
  unregisterMarkdownLatex?.()
  unregisterMarkdownLatex = null
  markdownDisplay = null
  badgeText = null
  modeText = null
  renderer.root.remove(ROOT_ID)
  renderer.setCursorPosition(0, 0, false)
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
