import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  ScrollBoxRenderable,
  type StyledText,
  TextRenderable,
  bold,
  dim,
  italic,
  link,
  t,
  underline,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

// Adapted from The Proportional Web by Oskar Wickström, licensed under the MIT License.
// https://github.com/owickstrom/the-proportional-web

const PAPER = "#FFFFFF"
const INK = "#000000"
const PAGE_WIDTH_MAX = 72
const BODY_WIDTH_MAX = 66
const PAGE_MARGIN_WIDE = 3
const ASIDE_WIDTH = 20
const WIDE_BREAKPOINT = 112
const ASIDE_COPY = "On wide screens this note occupies the margin. On narrow screens it returns to the reading order."

interface DocumentLayout {
  pageWidth: number
  bodyWidth: number
  pageMargin: number
  asideWidth: number
  wide: boolean
}

interface Paragraph {
  renderable: TextRenderable
  source: string
  indent: number
}

interface ContentsEntry {
  label: string
  targetId: string
  indent: number
}

let renderer: CliRenderer | null = null
let mainContainer: BoxRenderable | null = null
let scrollBox: ScrollBoxRenderable | null = null
let page: BoxRenderable | null = null
let annotationRow: BoxRenderable | null = null
let annotationAside: BoxRenderable | null = null
let annotationAsideText: TextRenderable | null = null
let tableText: TextRenderable | null = null
let figureText: TextRenderable | null = null
let currentBodyWidth = BODY_WIDTH_MAX
let currentPageMargin = PAGE_MARGIN_WIDE

const bodyWidthElements: Array<BoxRenderable | TextRenderable> = []
const paragraphs: Paragraph[] = []
const horizontalRules: TextRenderable[] = []

function documentLayout(terminalWidth: number): DocumentLayout {
  const availableWidth = Math.max(1, terminalWidth - 1)
  const pageWidth = Math.min(PAGE_WIDTH_MAX, availableWidth)
  const pageMargin = pageWidth >= PAGE_WIDTH_MAX ? PAGE_MARGIN_WIDE : pageWidth >= 24 ? 2 : 1
  const bodyWidth = Math.max(1, pageWidth - pageMargin * 2)
  const wide = terminalWidth >= WIDE_BREAKPOINT && pageWidth === PAGE_WIDTH_MAX

  return {
    pageWidth,
    bodyWidth,
    pageMargin,
    asideWidth: wide ? ASIDE_WIDTH : Math.max(1, bodyWidth - pageMargin),
    wide,
  }
}

function justifyLine(words: readonly string[], width: number, prefix: string): string {
  if (words.length <= 1) return prefix + words.join("")

  const characterCount = words.reduce((total, word) => total + word.length, 0)
  const gapCount = words.length - 1
  const spaceCount = width - prefix.length - characterCount
  const gapWidth = Math.floor(spaceCount / gapCount)
  let extraSpaces = spaceCount % gapCount
  let line = prefix

  for (let index = 0; index < words.length; index += 1) {
    line += words[index]
    if (index >= gapCount) continue

    line += " ".repeat(gapWidth + (extraSpaces > 0 ? 1 : 0))
    extraSpaces = Math.max(0, extraSpaces - 1)
  }

  return line
}

function justifyParagraph(source: string, width: number, indent: number): string {
  const safeIndent = width >= 32 ? Math.min(indent, width - 1) : 0
  if (width < 20) return " ".repeat(safeIndent) + source

  const words = source.trim().split(/\s+/)
  const lines: Array<{ words: string[]; prefix: string }> = []
  let lineWords: string[] = []
  let prefix = " ".repeat(safeIndent)
  let lineLength = prefix.length

  for (const word of words) {
    const separatorWidth = lineWords.length === 0 ? 0 : 1
    if (lineWords.length > 0 && lineLength + separatorWidth + word.length > width) {
      lines.push({ words: lineWords, prefix })
      lineWords = []
      prefix = ""
      lineLength = 0
    }

    lineWords.push(word)
    lineLength += (lineWords.length === 1 ? 0 : 1) + word.length
  }

  if (lineWords.length > 0) lines.push({ words: lineWords, prefix })

  return lines
    .map((line, index) => {
      const isLastLine = index === lines.length - 1
      return isLastLine ? line.prefix + line.words.join(" ") : justifyLine(line.words, width, line.prefix)
    })
    .join("\n")
}

function ornamentalRule(width: number): string {
  if (width <= 1) return "❧".slice(0, width)
  if (width < 7) return ` ${"─".repeat(Math.max(1, width - 2))}`

  // Reserve an extra cell because terminals disagree on whether U+2767 is narrow or wide.
  const innerWidth = width - 2
  const marker = " ❧  "
  const lineWidth = innerWidth - marker.length
  const leftWidth = Math.floor(lineWidth / 2)
  return ` ${"─".repeat(leftWidth)}${marker}${"─".repeat(lineWidth - leftWidth)}`
}

function addBodyElement<T extends BoxRenderable | TextRenderable>(element: T): T {
  bodyWidthElements.push(element)
  return element
}

function addBodyText(
  parent: BoxRenderable,
  id: string,
  content: string | StyledText,
  marginTop: number = 0,
  marginBottom: number = 0,
): TextRenderable {
  const text = addBodyElement(
    new TextRenderable(renderer!, {
      id,
      content,
      width: currentBodyWidth,
      marginTop,
      marginBottom,
      fg: INK,
      selectionBg: INK,
      selectionFg: PAPER,
      wrapMode: "word",
    }),
  )
  parent.add(text)
  return text
}

function addChapterHeading(parent: BoxRenderable, id: string, label: string, marginTop: number = 2): BoxRenderable {
  const heading = addBodyElement(
    new BoxRenderable(renderer!, {
      id,
      width: currentBodyWidth,
      marginTop,
      marginBottom: 1,
      border: ["bottom"],
      borderStyle: "single",
      borderColor: INK,
    }),
  )
  heading.add(new TextRenderable(renderer!, { content: t`${bold(label.toUpperCase())}`, fg: INK }))
  parent.add(heading)
  return heading
}

function addSectionHeading(parent: BoxRenderable, id: string, label: string, marginTop: number = 1): TextRenderable {
  return addBodyText(parent, id, t`${bold(label.toUpperCase())}`, marginTop, 1)
}

function addSubheading(parent: BoxRenderable, id: string, label: string, marginTop: number = 1): TextRenderable {
  return addBodyText(parent, id, t`${italic(label)}`, marginTop, 1)
}

function addParagraph(
  parent: BoxRenderable,
  id: string,
  source: string,
  indent: number = 0,
  marginBottom: number = 0,
): TextRenderable {
  const paragraph = addBodyText(parent, id, justifyParagraph(source, currentBodyWidth, indent), 0, marginBottom)
  paragraphs.push({ renderable: paragraph, source, indent })
  return paragraph
}

function addCenteredText(
  parent: BoxRenderable,
  id: string,
  content: StyledText,
  marginBottom: number = 0,
): BoxRenderable {
  const container = addBodyElement(
    new BoxRenderable(renderer!, {
      id,
      width: currentBodyWidth,
      alignItems: "center",
      marginBottom,
    }),
  )
  container.add(new TextRenderable(renderer!, { content, fg: INK }))
  parent.add(container)
  return container
}

function addHorizontalRule(parent: BoxRenderable, id: string): void {
  const rule = addBodyText(parent, id, ornamentalRule(currentBodyWidth), 1, 1)
  rule.wrapMode = "none"
  horizontalRules.push(rule)
}

function createTitle(parent: BoxRenderable): void {
  const title = addBodyElement(
    new BoxRenderable(renderer!, {
      id: "proportional-title",
      width: currentBodyWidth,
      alignItems: "center",
      marginTop: 2,
      marginBottom: 3,
    }),
  )
  title.add(new TextRenderable(renderer!, { content: t`${bold("THE PROPORTIONAL TERMINAL")}`, fg: INK }))
  title.add(new TextRenderable(renderer!, { content: "A prose layout composed with OpenTUI", fg: INK }))
  title.add(new TextRenderable(renderer!, { content: t`${dim("OpenTUI edition, v0.2.0")}`, fg: INK }))
  parent.add(title)
}

function createContents(parent: BoxRenderable): void {
  addChapterHeading(parent, "proportional-contents-heading", "Contents", 0)
  const entries: ContentsEntry[] = [
    { label: "Foreword", targetId: "proportional-foreword", indent: 0 },
    { label: "1  Terminal foundations", targetId: "proportional-foundations", indent: 0 },
    { label: "1.1  Cells and glyphs", targetId: "proportional-typography", indent: 3 },
    { label: "1.2  Measure and rhythm", targetId: "proportional-sizing", indent: 3 },
    { label: "1.3  Ink and attributes", targetId: "proportional-colors", indent: 3 },
    { label: "2  Document hierarchy", targetId: "proportional-elements", indent: 0 },
    { label: "2.1  Chapter, section, subsection", targetId: "proportional-headings", indent: 3 },
    { label: "2.2  Prose and emphasis", targetId: "proportional-emphasis", indent: 3 },
    { label: "2.3  Ornament and disclosure", targetId: "proportional-horizontal-rule", indent: 3 },
    { label: "2.4  Marginal notes", targetId: "proportional-asides", indent: 3 },
    { label: "2.5  Quotations and figures", targetId: "proportional-blockquotes", indent: 3 },
    { label: "2.6  Lists and tables", targetId: "proportional-lists", indent: 3 },
    { label: "2.7  Code", targetId: "proportional-code-heading", indent: 3 },
    { label: "3  Responsive composition", targetId: "proportional-usage", indent: 0 },
    { label: "3.1  Wide terminals", targetId: "proportional-purpose", indent: 3 },
    { label: "3.2  Narrow terminals", targetId: "proportional-getting-started", indent: 3 },
    { label: "3.3  Resize", targetId: "proportional-resize", indent: 3 },
    { label: "4  Interaction", targetId: "proportional-related", indent: 0 },
    {
      label: "4.1  Scrolling and selection",
      targetId: "proportional-related-web-typography",
      indent: 3,
    },
    { label: "4.2  Contents navigation", targetId: "proportional-related-tufte", indent: 3 },
    { label: "4.3  Terminal links", targetId: "proportional-links", indent: 3 },
    { label: "5  OpenTUI implementation", targetId: "proportional-implementation", indent: 0 },
    { label: "5.1  Renderable tree", targetId: "proportional-renderable-tree", indent: 3 },
    { label: "5.2  Layout updates", targetId: "proportional-layout-updates", indent: 3 },
    { label: "5.3  Lifecycle", targetId: "proportional-lifecycle", indent: 3 },
    { label: "Afterword", targetId: "proportional-afterword", indent: 0 },
  ]

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    addContentsEntry(parent, `proportional-contents-${index}`, entry, index === entries.length - 1 ? 2 : 0)
  }
}

function scrollToSection(targetId: string): void {
  if (!scrollBox) return

  const target = scrollBox.content.findDescendantById(targetId)
  if (!target) return

  const targetTop = scrollBox.scrollTop + target.y - scrollBox.viewport.y
  scrollBox.scrollTo(Math.max(0, targetTop))
  scrollBox.focus()
}

function addContentsEntry(parent: BoxRenderable, id: string, entry: ContentsEntry, marginBottom: number): void {
  const prefix = " ".repeat(entry.indent)
  const content = prefix + entry.label
  const text = addBodyElement(
    new TextRenderable(renderer!, {
      id,
      width: currentBodyWidth,
      content,
      marginBottom,
      fg: INK,
      selectable: false,
      wrapMode: "word",
    }),
  )

  text.onMouseDown = (event) => {
    scrollToSection(entry.targetId)
    event.stopPropagation()
  }
  text.onMouseOver = () => {
    text.content = t`${prefix}${underline(entry.label)}`
  }
  text.onMouseOut = () => {
    text.content = content
  }
  parent.add(text)
}

function createBringhurstQuote(parent: BoxRenderable): void {
  const quote = addBodyElement(
    new BoxRenderable(renderer!, {
      id: "proportional-bringhurst-quote",
      width: currentBodyWidth,
      paddingLeft: 3,
      paddingRight: 3,
      marginBottom: 1,
    }),
  )
  quote.add(
    new TextRenderable(renderer!, {
      content: t`${italic('"Typography is the craft of endowing human language with a durable visual form."')}

${dim("Robert Bringhurst, The Elements of Typographic Style, 2002")}`,
      fg: INK,
      wrapMode: "word",
    }),
  )
  parent.add(quote)
}

function createFoundations(parent: BoxRenderable): void {
  addChapterHeading(parent, "proportional-foreword", "Foreword")
  addParagraph(
    parent,
    "proportional-foreword-copy-one",
    "OpenTUI applications usually optimize for controls, logs, editors, and data. This example asks a different question: how should a long-form document feel when rows and columns are the medium?",
  )
  addParagraph(
    parent,
    "proportional-foreword-copy-two",
    "The answer is built from OpenTUI primitives rather than a document renderer. Boxes establish measure and rhythm, text renderables carry hierarchy, and a scroll box turns the composition into a navigable reading surface.",
    3,
    1,
  )

  addChapterHeading(parent, "proportional-foundations", "1  Terminal foundations")
  createBringhurstQuote(parent)
  addSectionHeading(parent, "proportional-typography", "1.1  Cells and glyphs", 0)
  addSubheading(parent, "proportional-single-face", "1.1.1 The terminal grid", 0)
  addParagraph(
    parent,
    "proportional-face-copy-one",
    "OpenTUI lays content into terminal cells. Most glyphs advance one column, while wide graphemes occupy two; rows and columns therefore matter more than bytes, code points, or JavaScript string length.",
  )
  addParagraph(
    parent,
    "proportional-face-copy-two",
    "The typeface is chosen by the reader's terminal. The document controls only attributes such as bold, italic, dim, and underline, so hierarchy must remain legible without relying on font family or point size.",
    3,
    1,
  )

  addSectionHeading(parent, "proportional-sizing", "1.2  Measure and rhythm")
  addSubheading(parent, "proportional-sizing-detail", "1.2.1 A bounded reading column", 0)
  addParagraph(
    parent,
    "proportional-sizing-copy",
    "The page is at most seventy-two columns, with a sixty-six-column inner measure and three-column margins. Wider terminals reveal whitespace instead of stretching prose; vertical spacing advances in whole rows.",
    0,
    1,
  )
  addBodyText(parent, "proportional-scale", t`${dim("PAGE   72 cols\nTEXT   66 cols\nRHYTHM  1 row")}`, 0, 1)

  addSubheading(parent, "proportional-justification", "1.2.2 Justification")
  addParagraph(
    parent,
    "proportional-justification-copy",
    "The example justifies plain paragraphs before assigning them to TextRenderable. Space is distributed only between words, the final line remains ragged, and very narrow terminals fall back to native word wrapping.",
    0,
    1,
  )

  addSubheading(parent, "proportional-indentation", "1.2.3 Paragraph rhythm")
  addParagraph(
    parent,
    "proportional-indentation-copy-one",
    "Successive paragraphs begin with a three-column indent instead of spending another terminal row on blank space.",
  )
  addParagraph(
    parent,
    "proportional-indentation-copy-two",
    "That convention makes paragraph boundaries visible while keeping the scrollable document compact and regular.",
    3,
    1,
  )

  addSectionHeading(parent, "proportional-colors", "1.3  Ink and attributes")
  addParagraph(
    parent,
    "proportional-colors-copy",
    "The renderer uses black on white deliberately. StyledText chunks add weight, italics, dim text, underlines, and OSC 8 links without turning the document into a palette demonstration.",
    0,
    1,
  )
}

function createHeadingExamples(parent: BoxRenderable): void {
  addParagraph(
    parent,
    "proportional-headings-copy",
    "The hierarchy maps directly to renderables: ruled chapter boxes, uppercase section text, and italic subsection text.",
    0,
    1,
  )
  addChapterHeading(parent, "proportional-heading-one", "1  Rendering a document", 0)
  addSectionHeading(parent, "proportional-heading-two", "1.2  Flow and measure", 0)
  addSubheading(parent, "proportional-heading-three", "1.2.1 Responsive reflow", 0)
}

function createDetails(parent: BoxRenderable): void {
  const details = addBodyElement(
    new BoxRenderable(renderer!, {
      id: "proportional-details",
      width: currentBodyWidth,
      border: ["top", "bottom"],
      borderStyle: "single",
      borderColor: INK,
      paddingTop: 1,
      paddingBottom: 1,
      marginBottom: 1,
    }),
  )
  details.add(new TextRenderable(renderer!, { content: t`${italic("⌄  Render tree")}`, fg: INK }))
  details.add(
    new TextRenderable(renderer!, {
      content:
        '\nScrollBoxRenderable\n  BoxRenderable "page"\n    BoxRenderable "chapter"\n    TextRenderable "paragraph"\n    BoxRenderable "aside"',
      fg: INK,
      wrapMode: "word",
    }),
  )
  parent.add(details)
}

function createAnnotation(parent: BoxRenderable): void {
  annotationRow = new BoxRenderable(renderer!, {
    id: "proportional-annotation-row",
    width: currentBodyWidth,
    position: "relative",
    marginBottom: 1,
  })
  parent.add(annotationRow)

  addParagraph(
    annotationRow,
    "proportional-annotation-body",
    "A note belongs near the sentence that gives it meaning. On a sufficiently wide display it can occupy the right margin without interrupting the text; on a narrow display it should return to the reading order.",
  )

  annotationAside = new BoxRenderable(renderer!, {
    id: "proportional-annotation-aside",
    width: Math.max(1, currentBodyWidth - currentPageMargin),
    marginLeft: currentPageMargin,
    marginTop: 1,
  })
  annotationAsideText = new TextRenderable(renderer!, {
    content: `❧  ${ASIDE_COPY}`,
    fg: INK,
    wrapMode: "word",
  })
  annotationAside.add(annotationAsideText)
  annotationRow.add(annotationAside)
}

function createBlockquote(parent: BoxRenderable): void {
  const quote = addBodyElement(
    new BoxRenderable(renderer!, {
      id: "proportional-blockquote",
      width: currentBodyWidth,
      paddingLeft: 3,
      paddingRight: 3,
      marginBottom: 1,
    }),
  )
  quote.add(
    new TextRenderable(renderer!, {
      content: t`${italic(
        '"The terminal is not a small browser. Its rows and columns are the medium, not a limitation to disguise."',
      )}

${bold("THE PROPORTIONAL TERMINAL")}
${italic("Working notes")}
${dim("2026")}`,
      fg: INK,
      wrapMode: "word",
    }),
  )
  parent.add(quote)
}

function createFigure(parent: BoxRenderable): void {
  const figure = addBodyElement(
    new BoxRenderable(renderer!, {
      id: "proportional-figure",
      width: currentBodyWidth,
      alignItems: "center",
      marginTop: 1,
      marginBottom: 1,
    }),
  )
  figureText = new TextRenderable(renderer!, {
    content: "",
    fg: INK,
    wrapMode: "none",
  })
  figure.add(figureText)
  parent.add(figure)
  addBodyText(
    parent,
    "proportional-figure-caption",
    t`${bold("OPEN TUI")}, ${italic("A Grid of Terminal Cells")}, 2026, glyphs arranged by row and column.`,
    0,
    1,
  )
}

function createLists(parent: BoxRenderable): void {
  addBodyText(
    parent,
    "proportional-lists-copy",
    `• TextRenderable
• BoxRenderable
• ScrollBoxRenderable

1. Create the renderer
2. Compose the renderable tree
3. Focus the scroll box
4. Destroy the tree on exit`,
    0,
    1,
  )
}

function createTable(parent: BoxRenderable): void {
  tableText = addBodyText(parent, "proportional-table", "", 0, 1)
}

function createCodeBlock(parent: BoxRenderable): void {
  addBodyText(
    parent,
    "proportional-code",
    `const page = new BoxRenderable(renderer, {
  width: 72,
  paddingLeft: 3,
  paddingRight: 3,
})

scrollBox.add(page)`,
    1,
    1,
  )
}

function createElements(parent: BoxRenderable): void {
  addChapterHeading(parent, "proportional-elements", "2  Document hierarchy")
  addSectionHeading(parent, "proportional-headings", "2.1  Chapter, section, subsection", 0)
  createHeadingExamples(parent)

  addSectionHeading(parent, "proportional-emphasis", "2.2  Prose and emphasis")
  addBodyText(
    parent,
    "proportional-emphasis-copy",
    t`StyledText keeps ${italic("emphasis")} inside a flowing paragraph, gives ${bold(
      "important phrases",
    )} additional weight, and leaves ordinary prose unadorned.`,
    0,
    1,
  )

  addSectionHeading(parent, "proportional-horizontal-rule", "2.3  Ornament and disclosure")
  addParagraph(
    parent,
    "proportional-horizontal-rule-copy",
    "The ornamental rule marks a deliberate break in thought. A bordered box is reserved for disclosure, where the boundary communicates structure rather than decoration.",
  )
  addHorizontalRule(parent, "proportional-rule")
  createDetails(parent)

  addSectionHeading(parent, "proportional-asides", "2.4  Marginal notes")
  createAnnotation(parent)

  addSectionHeading(parent, "proportional-blockquotes", "2.5  Quotations and figures")
  createBlockquote(parent)
  addParagraph(
    parent,
    "proportional-figures-copy",
    "A figure can use the terminal grid as its canvas, while its caption remains selectable text in the document flow.",
  )
  createFigure(parent)

  addSectionHeading(parent, "proportional-lists", "2.6  Lists and tables")
  createLists(parent)
  createTable(parent)

  addSectionHeading(parent, "proportional-code-heading", "2.7  Code")
  addParagraph(
    parent,
    "proportional-code-copy",
    "Code needs no simulated editor chrome. It uses the same cells as the prose and is distinguished by syntax, indentation, and surrounding space.",
  )
  createCodeBlock(parent)
}

function createResponsiveComposition(parent: BoxRenderable): void {
  addChapterHeading(parent, "proportional-usage", "3  Responsive composition")
  addSectionHeading(parent, "proportional-purpose", "3.1  Wide terminals", 0)
  addParagraph(
    parent,
    "proportional-purpose-copy",
    "At 112 columns and above, the seventy-two-column page is centered and the note moves into a twenty-column right margin. The prose measure does not change.",
    0,
    1,
  )

  addSectionHeading(parent, "proportional-getting-started", "3.2  Narrow terminals")
  addParagraph(
    parent,
    "proportional-getting-started-copy",
    "Below the wide breakpoint, the page aligns to the left and contracts with the viewport. Marginal notes return to the reading order, tables stack their fields, and the figure simplifies.",
    0,
    1,
  )

  addSectionHeading(parent, "proportional-resize", "3.3  Resize")
  addParagraph(
    parent,
    "proportional-resize-copy",
    "The renderer's resize event recomputes page margins, paragraph line breaks, the ornamental rule, table presentation, figure detail, and aside placement from one layout description.",
    0,
    1,
  )
}

function createInteraction(parent: BoxRenderable): void {
  addChapterHeading(parent, "proportional-related", "4  Interaction")
  addSectionHeading(parent, "proportional-related-web-typography", "4.1  Scrolling and selection", 0)
  addParagraph(
    parent,
    "proportional-related-web-typography-copy",
    "ScrollBoxRenderable provides keyboard, wheel, scrollbar, and page navigation. Text remains selectable across the document, with high-contrast selection colors on the white field.",
    0,
    1,
  )

  addSectionHeading(parent, "proportional-related-tufte", "4.2  Contents navigation")
  addParagraph(
    parent,
    "proportional-related-tufte-copy",
    "Each contents entry is a TextRenderable with mouse handlers. Hover underlines the label; clicking computes the target's content offset and scrolls its heading to the top of the viewport.",
    0,
    1,
  )

  addSectionHeading(parent, "proportional-links", "4.3  Terminal links")
  addParagraph(
    parent,
    "proportional-links-copy",
    "The attribution is an OSC 8 link carried by a StyledText chunk. Supporting terminals can open it directly without exposing a long URL in the composition.",
    0,
    1,
  )
}

function createImplementation(parent: BoxRenderable): void {
  addChapterHeading(parent, "proportional-implementation", "5  OpenTUI implementation")
  addSectionHeading(parent, "proportional-renderable-tree", "5.1  Renderable tree", 0)
  addParagraph(
    parent,
    "proportional-renderable-tree-copy",
    "A ScrollBoxRenderable owns one page BoxRenderable. The page contains chapter boxes, text nodes, figures, a disclosure box, and an aside that switches between relative and absolute positioning.",
    0,
    1,
  )
  addBodyText(
    parent,
    "proportional-renderable-tree-code",
    `ScrollBoxRenderable
└─ BoxRenderable "page"
   ├─ BoxRenderable "chapter"
   ├─ TextRenderable "paragraph"
   └─ BoxRenderable "aside"`,
    0,
    1,
  )

  addSectionHeading(parent, "proportional-layout-updates", "5.2  Layout updates")
  addParagraph(
    parent,
    "proportional-layout-updates-copy",
    "OpenTUI's Yoga-backed layout handles the structural flow. The example updates only values that express document policy: measure, margins, positioning mode, and content that depends on available columns.",
    0,
    1,
  )

  addSectionHeading(parent, "proportional-lifecycle", "5.3  Lifecycle")
  addParagraph(
    parent,
    "proportional-lifecycle-copy",
    "The run function constructs and focuses the document, while destroy removes the resize listener and recursively destroys the renderable tree. Returning to the examples menu leaves no document state behind.",
    0,
    1,
  )
}

function createAfterword(parent: BoxRenderable): void {
  addChapterHeading(parent, "proportional-afterword", "Afterword")
  addParagraph(
    parent,
    "proportional-afterword-copy-one",
    "OpenTUI does not need browser semantics to present a considered document. Its layout, text, mouse, selection, and scrolling primitives are enough when the composition treats the terminal grid as its own medium.",
  )
  addParagraph(
    parent,
    "proportional-afterword-copy-two",
    "The visual method is adapted from The Proportional Web by Oskar Wickström, itself inspired by Robert Bringhurst's The Elements of Typographic Style; the structure and examples here are specific to OpenTUI.",
    3,
    1,
  )
  addCenteredText(
    parent,
    "proportional-attribution",
    t`${underline(link("https://owickstrom.github.io/the-proportional-web/")("The Proportional Web"))} ${dim(
      "— MIT licensed",
    )}`,
    2,
  )
}

function createDocument(parent: BoxRenderable): void {
  createTitle(parent)
  createContents(parent)
  createFoundations(parent)
  createElements(parent)
  createResponsiveComposition(parent)
  createInteraction(parent)
  createImplementation(parent)
  createAfterword(parent)
}

function updateTable(width: number): void {
  if (!tableText) return

  if (width >= 60) {
    const nameWidth = 24
    const roleWidth = 24
    const header = "RENDERABLE".padEnd(nameWidth) + "ROLE".padEnd(roleWidth) + "MEASURE"
    const text = "TextRenderable".padEnd(nameWidth) + "styled prose".padEnd(roleWidth) + "66 cols"
    const box = "BoxRenderable".padEnd(nameWidth) + "page structure".padEnd(roleWidth) + "72 cols"
    const scroll = "ScrollBoxRenderable".padEnd(nameWidth) + "viewport".padEnd(roleWidth) + "terminal"
    tableText.content = t`${bold(header)}\n${"─".repeat(width)}\n${text}\n${box}\n${scroll}`
    return
  }

  tableText.content = t`${bold("RENDERABLE / ROLE / MEASURE")}\n${"─".repeat(width)}

TextRenderable
styled prose / 66 cols

BoxRenderable
page structure / 72 cols

ScrollBoxRenderable
viewport / terminal`
}

function updateFigure(width: number): void {
  if (!figureText) return

  figureText.content =
    width >= 30
      ? `         column →
       0   1   2
     ┌───┬───┬───┐
row 0│ A │ a │ 1 │
     ├───┼───┼───┤
row 1│ B │ b │ 2 │
     └───┴───┴───┘`
      : "[A][a][1]"
}

function applyLayout(terminalWidth: number): void {
  if (!page || !scrollBox || !annotationRow || !annotationAside || !annotationAsideText) return

  const layout = documentLayout(terminalWidth)
  currentBodyWidth = layout.bodyWidth
  currentPageMargin = layout.pageMargin
  scrollBox.content.alignItems = layout.wide ? "center" : "flex-start"
  page.width = layout.pageWidth
  page.paddingLeft = layout.pageMargin
  page.paddingRight = layout.pageMargin

  for (const element of bodyWidthElements) element.width = layout.bodyWidth
  for (const paragraph of paragraphs) {
    paragraph.renderable.content = justifyParagraph(paragraph.source, layout.bodyWidth, paragraph.indent)
  }
  for (const rule of horizontalRules) rule.content = ornamentalRule(layout.bodyWidth)

  annotationRow.width = layout.bodyWidth
  annotationAside.position = layout.wide ? "absolute" : "relative"
  annotationAside.left = layout.wide ? layout.bodyWidth + layout.pageMargin : 0
  annotationAside.top = 0
  annotationAside.width = layout.asideWidth
  annotationAside.marginLeft = layout.wide ? 0 : layout.pageMargin
  annotationAside.marginTop = layout.wide ? 0 : 1
  annotationAsideText.content = layout.wide ? ASIDE_COPY : `❧  ${ASIDE_COPY}`

  updateTable(layout.bodyWidth)
  updateFigure(layout.bodyWidth)
}

function handleResize(width: number): void {
  applyLayout(width)
}

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  const layout = documentLayout(renderer.terminalWidth)
  currentBodyWidth = layout.bodyWidth
  currentPageMargin = layout.pageMargin
  renderer.setBackgroundColor(PAPER)

  mainContainer = new BoxRenderable(renderer, {
    id: "proportional-document-container",
    width: "100%",
    height: "100%",
    backgroundColor: PAPER,
  })
  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "proportional-document-scroll",
    width: "100%",
    height: "100%",
    backgroundColor: PAPER,
    scrollY: true,
    scrollX: false,
    contentOptions: {
      alignItems: layout.wide ? "center" : "flex-start",
      backgroundColor: PAPER,
    },
    scrollbarOptions: {
      trackOptions: {
        foregroundColor: INK,
        backgroundColor: PAPER,
      },
    },
  })
  page = new BoxRenderable(renderer, {
    id: "proportional-document-page",
    width: layout.pageWidth,
    flexDirection: "column",
    alignItems: "flex-start",
    paddingLeft: layout.pageMargin,
    paddingRight: layout.pageMargin,
    paddingBottom: 3,
    backgroundColor: PAPER,
    overflow: "visible",
  })

  createDocument(page)
  scrollBox.add(page)
  mainContainer.add(scrollBox)
  renderer.root.add(mainContainer)
  renderer.on("resize", handleResize)
  scrollBox.focus()
  applyLayout(renderer.terminalWidth)
}

export function destroy(rendererInstance: CliRenderer): void {
  rendererInstance.off("resize", handleResize)

  if (mainContainer) {
    rendererInstance.root.remove(mainContainer.id)
    mainContainer.destroyRecursively()
  }

  bodyWidthElements.length = 0
  paragraphs.length = 0
  horizontalRules.length = 0
  renderer = null
  mainContainer = null
  scrollBox = null
  page = null
  annotationRow = null
  annotationAside = null
  annotationAsideText = null
  tableText = null
  figureText = null
  currentBodyWidth = BODY_WIDTH_MAX
  currentPageMargin = PAGE_MARGIN_WIDE
}

if (import.meta.main) {
  const standaloneRenderer = await createCliRenderer({ exitOnCtrlC: true })
  run(standaloneRenderer)
  setupCommonDemoKeys(standaloneRenderer)
}
