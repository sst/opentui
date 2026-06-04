import {
  BoxRenderable,
  CliRenderer,
  RGBA,
  TextAttributes,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
} from "@opentui/core"
import { LatexRenderable } from "@opentui/latex"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

const ROOT_ID = "latex-markdown-demo-root"

interface FormulaSlide {
  title: string
  kicker: string
  content: string
  note: string
  color: string
}

const slides: FormulaSlide[] = [
  {
    title: "Powers and Subscripts",
    kicker: "Math italic identifiers and compact scripts",
    content: String.raw`\alpha_i^2 + \beta_j^2 \le \gamma^2`,
    note: "The basic building block: Greek letters, mathematical italic variables, subscripts, superscripts, and relation symbols.",
    color: "#A7F3D0",
  },
  {
    title: "Euler Identity",
    kicker: "Symbols in a compact inline expression",
    content: String.raw`e^{i\pi} + 1 = 0`,
    note: "A simple single-line expression that shows math italic, Greek symbols, and superscripts without needing display layout.",
    color: "#FDE68A",
  },
  {
    title: "Pythagorean Distance",
    kicker: "Square root with scripts",
    content: String.raw`\sqrt{a^2 + b^2}`,
    note: "Single-line square roots stay compact, while variables still render with math-style glyphs.",
    color: "#93C5FD",
  },
  {
    title: "Quadratic Formula",
    kicker: "Fraction plus nested root",
    content: String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
    note: "A dense classic formula combining a display fraction, plus/minus, a square root, and polynomial terms.",
    color: "#FDBA74",
  },
  {
    title: "Sample Mean",
    kicker: "Compact fraction style",
    content: String.raw`\frac{\sum_{i=1}^{n} x_i}{n}`,
    note: "Fraction arguments render in compact style, so the summation stays readable instead of turning into a tall numerator.",
    color: "#A7F3D0",
  },
  {
    title: "Weighted Average",
    kicker: "Nested sum in a ratio",
    content: String.raw`\frac{\sum_{i=1}^{n} w_i x_i}{\sum_{i=1}^{n} w_i}`,
    note: "Both numerator and denominator use compact summation notation inside a larger display fraction.",
    color: "#5EEAD4",
  },
  {
    title: "Finite Product",
    kicker: "Large operator limits",
    content: String.raw`\prod_{k=1}^{n}\left(1 + \frac{x}{k}\right)`,
    note: "Product limits use the same display-style operator layout as summations, with compact fractions inside parentheses.",
    color: "#93C5FD",
  },
  {
    title: "Derivative Definition",
    kicker: "Limit plus quotient",
    content: String.raw`\lim_{h \to 0}\frac{f(x+h)-f(x)}{h}`,
    note: "Display-style limits put the condition under lim while the quotient remains compact and centered.",
    color: "#F0ABFC",
  },
  {
    title: "Nested Radical",
    kicker: "Root enclosure and nested fraction",
    content: String.raw`\sqrt{1 + \frac{x^2}{1 - x^2}}`,
    note: "Multiline roots use an enclosure so the radicand reads as one expression.",
    color: "#FDE68A",
  },
  {
    title: "Cube Root",
    kicker: "Indexed radical marker",
    content: String.raw`\sqrt[3]{1 + \frac{x^2}{1 - x^2}}`,
    note: "Indexed roots use dedicated cube and fourth-root glyphs when available, then fall back to upper-left indices.",
    color: "#F9A8D4",
  },
  {
    title: "Gaussian Integral",
    kicker: "Bounded integral",
    content: String.raw`\int_{0}^{\infty} e^{-x^2}\,dx`,
    note: "Bounded integrals use a tall terminal integral with upper and lower bounds.",
    color: "#BAE6FD",
  },
  {
    title: "Line Integral",
    kicker: "Contour operator",
    content: String.raw`\oint_{\gamma} f(z)\,dz`,
    note: "Contour integrals keep the path label visually tied to the operator.",
    color: "#C4B5FD",
  },
  {
    title: "Cauchy Integral Formula",
    kicker: "Contour integral with stacked fractions",
    content: String.raw`f(a) = \frac{1}{2\pi i}\oint_{\gamma}\frac{f(z)}{z-a}\,dz`,
    note: "A focused complex-analysis example: italic identifiers, a contour path under the operator, and spaced denominator terms.",
    color: "#C4B5FD",
  },
  {
    title: "Signal Phase",
    kicker: "Named operators and Greek parameters",
    content: String.raw`A\sin(\omega t + \phi)`,
    note: "Named functions such as sin stay roman while variables and Greek parameters remain mathematical.",
    color: "#F0ABFC",
  },
  {
    title: "Normalized Signal",
    kicker: "Greek parameters in a quotient",
    content: String.raw`\frac{s(t)-\mu}{\sigma}`,
    note: "A compact statistics-style transform with Greek symbols and an expression numerator.",
    color: "#67E8F9",
  },
  {
    title: "Logic Statement",
    kicker: "Quantifiers and set membership",
    content: String.raw`\forall x \in X, \exists y \in Y`,
    note: "Logical quantifiers, set membership, and uppercase mathematical symbols are rendered in a single line.",
    color: "#DDD6FE",
  },
  {
    title: "Set Relation",
    kicker: "Subset, union, intersection",
    content: String.raw`A \cap B \subseteq A \cup B`,
    note: "Set operators provide a good symbol sampler without needing multiline layout.",
    color: "#A5B4FC",
  },
]

let slideIndex = 0
let slideTitle: TextRenderable | null = null
let slideKicker: TextRenderable | null = null
let slideCounter: TextRenderable | null = null
let slideFormula: LatexRenderable | null = null
let slideSource: TextRenderable | null = null
let slideNote: TextRenderable | null = null
let slideRail: TextRenderable | null = null
let badgeText: TextRenderable | null = null
let modeText: TextRenderable | null = null
let keyHandler: ((key: KeyEvent) => void) | null = null

function getSlideRail(): string {
  return slides
    .map((slide, index) => {
      const marker = index === slideIndex ? `[${index + 1}]` : `${index + 1}`
      return marker
    })
    .join(" ")
}

function currentSlide(): FormulaSlide {
  return slides[slideIndex] ?? slides[0]!
}

function moveSlide(delta: number): void {
  slideIndex = (slideIndex + delta + slides.length) % slides.length
  updateSlide()
}

function updateSlide(): void {
  const slide = currentSlide()

  if (slideTitle) {
    slideTitle.content = slide.title
    slideTitle.fg = slide.color
  }

  if (slideKicker) {
    slideKicker.content = slide.kicker
  }

  if (slideCounter) {
    slideCounter.content = `${slideIndex + 1}/${slides.length}`
  }

  if (slideFormula) {
    slideFormula.content = slide.content
    slideFormula.fg = "#F8FAFC"
  }

  if (slideSource) {
    slideSource.content = slide.content
  }

  if (slideNote) {
    slideNote.content = slide.note
  }

  if (slideRail) {
    slideRail.content = getSlideRail()
  }
}

function handleKeyPress(key: KeyEvent): void {
  const keyName = key.name?.toLowerCase()
  const raw = key.raw?.toLowerCase()

  if (keyName === "right" || keyName === "arrowright" || keyName === "n" || raw === "n") {
    moveSlide(1)
    return
  }

  if (keyName === "left" || keyName === "arrowleft" || keyName === "p" || raw === "p") {
    moveSlide(-1)
  }
}

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor("#0B1020")

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
      content: "LaTeX Formula Showcase",
      fg: "#F8FAFC",
      attributes: TextAttributes.BOLD,
    }),
  )

  headerText.add(
    new TextRenderable(renderer, {
      id: `${ROOT_ID}-subtitle`,
      content: "One formula at a time, progressing from simple notation to complex display math",
      fg: "#94A3B8",
    }),
  )

  badgeText = new TextRenderable(renderer, {
    id: `${ROOT_ID}-badge`,
    content: `${slides.length} slides`,
    fg: "#5EEAD4",
    attributes: TextAttributes.BOLD,
    flexShrink: 0,
  })
  header.add(badgeText)

  modeText = new TextRenderable(renderer, {
    id: `${ROOT_ID}-mode`,
    content: "←/→ or P/N: move through formulas",
    fg: "#A7F3D0",
    marginBottom: 1,
  })
  root.add(modeText)

  const body = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-body`,
    width: "100%",
    flexGrow: 1,
    flexDirection: "column",
  })
  root.add(body)

  const stagePanel = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-stage-panel`,
    width: "100%",
    flexGrow: 1,
    height: "100%",
    border: true,
    borderStyle: "rounded",
    borderColor: "#2563EB",
    padding: 1,
    flexDirection: "column",
  })
  body.add(stagePanel)

  const slideHeader = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-slide-header`,
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 1,
  })
  stagePanel.add(slideHeader)

  const slideHeading = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-slide-heading`,
    flexDirection: "column",
    flexGrow: 1,
  })
  slideHeader.add(slideHeading)

  slideTitle = new TextRenderable(renderer, {
    id: `${ROOT_ID}-slide-title`,
    content: "",
    fg: "#A7F3D0",
    attributes: TextAttributes.BOLD,
  })
  slideHeading.add(slideTitle)

  slideKicker = new TextRenderable(renderer, {
    id: `${ROOT_ID}-slide-kicker`,
    content: "",
    fg: "#94A3B8",
  })
  slideHeading.add(slideKicker)

  slideCounter = new TextRenderable(renderer, {
    id: `${ROOT_ID}-slide-counter`,
    content: "",
    fg: "#CBD5E1",
    attributes: TextAttributes.BOLD,
    flexShrink: 0,
  })
  slideHeader.add(slideCounter)

  const formulaStage = new BoxRenderable(renderer, {
    id: `${ROOT_ID}-formula-stage`,
    width: "100%",
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    border: ["top", "bottom"],
    borderColor: "#1E3A8A",
    marginBottom: 1,
  })
  stagePanel.add(formulaStage)

  slideFormula = new LatexRenderable(renderer, {
    id: `${ROOT_ID}-slide-formula`,
    content: "",
    fg: "#F8FAFC",
    align: "center",
    width: "100%",
  })
  formulaStage.add(slideFormula)

  slideNote = new TextRenderable(renderer, {
    id: `${ROOT_ID}-slide-note`,
    content: "",
    fg: "#CBD5E1",
    wrapMode: "word",
    marginBottom: 1,
  })
  stagePanel.add(slideNote)

  slideSource = new TextRenderable(renderer, {
    id: `${ROOT_ID}-slide-source`,
    content: "",
    fg: "#FDE68A",
    bg: "#111827",
    wrapMode: "word",
  })
  stagePanel.add(slideSource)

  slideRail = new TextRenderable(renderer, {
    id: `${ROOT_ID}-slide-rail`,
    content: "",
    fg: "#CBD5E1",
    marginTop: 1,
    wrapMode: "word",
  })
  stagePanel.add(slideRail)

  updateSlide()

  keyHandler = handleKeyPress
  renderer.keyInput.on("keypress", keyHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (keyHandler) {
    renderer.keyInput.off("keypress", keyHandler)
    keyHandler = null
  }
  badgeText = null
  modeText = null
  slideTitle = null
  slideKicker = null
  slideCounter = null
  slideFormula = null
  slideSource = null
  slideNote = null
  slideRail = null
  slideIndex = 0
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
