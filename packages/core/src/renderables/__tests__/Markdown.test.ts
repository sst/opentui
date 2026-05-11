import { test, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test"
import { Lexer } from "marked"
import { MarkdownRenderable, type MarkdownOptions } from "../Markdown.js"
import { CodeRenderable } from "../Code.js"
import { TextRenderable } from "../Text.js"
import { TextTableRenderable } from "../TextTable.js"
import { SyntaxStyle } from "../../syntax-style.js"
import { RGBA } from "../../lib/RGBA.js"
import { TreeSitterClient } from "../../lib/tree-sitter/index.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import {
  createTestRenderer,
  type MockMouse,
  type TestRenderer,
  MockTreeSitterClient,
  TestRecorder,
} from "../../testing.js"
import { TextAttributes, type CapturedFrame } from "../../types.js"

let renderer: TestRenderer
let mockMouse: MockMouse
let renderOnce: () => Promise<void>
let captureFrame: () => string
let captureSpans: () => CapturedFrame
let markdownTreeSitterClient: TreeSitterClient

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})

beforeAll(async () => {
  const dataPath = join(tmpdir(), "tree-sitter-markdown-renderable-test-data")
  await mkdir(dataPath, { recursive: true })

  markdownTreeSitterClient = new TreeSitterClient({ dataPath })
  await markdownTreeSitterClient.initialize()
})

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 60, height: 40 })
  renderer = testRenderer.renderer
  mockMouse = testRenderer.mockMouse
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
  captureSpans = testRenderer.captureSpans
})

afterEach(async () => {
  if (renderer) {
    renderer.destroy()
  }
})

afterAll(async () => {
  await markdownTreeSitterClient.destroy()
})

function createMarkdownRenderable(options: MarkdownOptions): MarkdownRenderable {
  return new MarkdownRenderable(renderer, {
    treeSitterClient: markdownTreeSitterClient,
    ...options,
  })
}

async function renderMarkdownRenderable(md: MarkdownRenderable, timeoutMs: number = 2000): Promise<void> {
  const hasPendingMarkdownParagraphHighlights = (): boolean => {
    const children = [...md.getChildren()]

    while (children.length > 0) {
      const child = children.pop()!
      if (child instanceof CodeRenderable && child.filetype === "markdown" && child.isHighlighting) {
        return true
      }
      children.push(...child.getChildren())
    }

    return false
  }

  const startedAt = Date.now()

  await renderOnce()

  while (hasPendingMarkdownParagraphHighlights() && Date.now() - startedAt < timeoutMs) {
    await Bun.sleep(10)
    await renderOnce()
  }

  if (hasPendingMarkdownParagraphHighlights()) {
    throw new Error("Timed out waiting for markdown paragraph highlights")
  }

  await renderOnce()
}

async function renderMarkdown(markdown: string, conceal: boolean = true): Promise<string> {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: markdown,
    syntaxStyle,
    conceal,
    tableOptions: { widthMode: "content" },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  return "\n" + lines.join("\n").trimEnd()
}

function findSpanContaining(frame: CapturedFrame, text: string) {
  for (const line of frame.lines) {
    const span = line.spans.find((candidate) => candidate.text.includes(text))
    if (span) return span
  }

  return undefined
}

test("basic table alignment", async () => {
  const markdown = `| Name | Age |
|---|---|
| Alice | 30 |
| Bob | 5 |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─────┬───┐
    │Name │Age│
    ├─────┼───┤
    │Alice│30 │
    ├─────┼───┤
    │Bob  │5  │
    └─────┴───┘"
  `)
})

test("tableOptions.widthMode configures markdown table layout", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-table-width-mode",
    content: "| Name | Age |\n|---|---|\n| Alice | 30 |",
    syntaxStyle,
    tableOptions: {
      widthMode: "full",
      columnFitter: "balanced",
    },
  })

  renderer.root.add(md)
  await renderer.idle()

  const table = md._blockStates[0]?.renderable as TextTableRenderable
  expect(table).toBeInstanceOf(TextTableRenderable)
  expect(table.columnWidthMode).toBe("full")
  expect(table.columnFitter).toBe("balanced")
})

test("tableOptions updates existing markdown table renderable", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-table-updates",
    content: "| Name | Age |\n|---|---|\n| Alice | 30 |",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderer.idle()

  const table = md._blockStates[0]?.renderable as TextTableRenderable
  expect(table).toBeInstanceOf(TextTableRenderable)
  expect(table.columnWidthMode).toBe("full")

  md.tableOptions = {
    widthMode: "full",
    columnFitter: "balanced",
    wrapMode: "word",
    cellPadding: 1,
    cellPaddingX: 2,
    cellPaddingY: 0,
    borders: false,
    selectable: false,
  }

  await renderer.idle()

  const updatedTable = md._blockStates[0]?.renderable as TextTableRenderable
  expect(updatedTable).toBe(table)
  expect(updatedTable.columnWidthMode).toBe("full")
  expect(updatedTable.columnFitter).toBe("balanced")
  expect(updatedTable.wrapMode).toBe("word")
  expect(updatedTable.cellPadding).toBe(0)
  expect(updatedTable.cellPaddingX).toBe(2)
  expect(updatedTable.cellPaddingY).toBe(0)
  expect(updatedTable.border).toBe(false)
  expect(updatedTable.outerBorder).toBe(false)
  expect(updatedTable.showBorders).toBe(false)
  expect(updatedTable.selectable).toBe(false)
})

test("tableOptions.cellPaddingX pads cells horizontally without vertical padding", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-table-horizontal-padding",
    content: "| A | B |\n|---|---|\n| 1 | 2 |",
    syntaxStyle,
    tableOptions: { style: "grid", widthMode: "content", cellPaddingX: 1, cellPaddingY: 0 },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    ┌───┬───┐
    │ A │ B │
    ├───┼───┤
    │ 1 │ 2 │
    └───┴───┘"
  `)
})

test("internalBlockMode=top-level defaults markdown tables to borderless columns", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-table-default-style",
    content: "| Name | Age |\n|---|---|\n| Alice | 30 |",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const table = md._blockStates[0]?.renderable as TextTableRenderable
  expect(table).toBeInstanceOf(TextTableRenderable)
  expect(table.columnWidthMode).toBe("content")
  expect(table.columnGap).toBe(2)
  expect(table.border).toBe(false)
  expect(table.outerBorder).toBe(false)
  expect(table.showBorders).toBe(false)

  const rendered = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(rendered).not.toContain("┌")
  expect(rendered).toMatch(/Name\s{2,}Age/)
  expect(rendered).toMatch(/Alice\s{2,}30/)
})

test("tableOptions.style updates existing markdown table renderable content layout", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-table-style-updates",
    content: "| Name | Age |\n|---|---|\n| Alice | 30 |",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const table = md._blockStates[0]?.renderable as TextTableRenderable
  expect(table).toBeInstanceOf(TextTableRenderable)
  expect(table.border).toBe(true)

  md.tableOptions = { style: "columns" }

  await renderer.idle()

  const updatedTable = md._blockStates[0]?.renderable as TextTableRenderable
  expect(updatedTable).toBe(table)
  expect(updatedTable.columnWidthMode).toBe("content")
  expect(updatedTable.columnGap).toBe(2)
  expect(updatedTable.border).toBe(false)
  expect(updatedTable.outerBorder).toBe(false)
  expect(updatedTable.showBorders).toBe(false)

  const rendered = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(rendered).not.toContain("┌")
  expect(rendered).toMatch(/Name\s{2,}Age/)
  expect(rendered).toMatch(/Alice\s{2,}30/)
})

test("borderless column tables keep visual spacing out of copied text", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-table-selection",
    content: "| Name | Age |\n|---|---|\n| Alice | 30 |",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const table = md._blockStates[0]?.renderable as TextTableRenderable
  expect(table).toBeInstanceOf(TextTableRenderable)

  const lines = captureFrame().split("\n")
  const headerY = lines.findIndex((line) => line.includes("Name"))
  const rowY = lines.findIndex((line) => line.includes("Alice"))
  const startX = lines[headerY]!.indexOf("Name")
  const endX = table.x + table.width - 1

  await mockMouse.drag(startX, headerY, endX, rowY)
  await renderer.idle()

  expect(table.getSelectedText()).toBe("Name\tAge\nAlice\t30")
})

test("table with inline code (backticks)", async () => {
  const markdown = `| Command | Description |
|---|---|
| \`npm install\` | Install deps |
| \`npm run build\` | Build project |
| \`npm test\` | Run tests |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─────────────┬─────────────┐
    │Command      │Description  │
    ├─────────────┼─────────────┤
    │npm install  │Install deps │
    ├─────────────┼─────────────┤
    │npm run build│Build project│
    ├─────────────┼─────────────┤
    │npm test     │Run tests    │
    └─────────────┴─────────────┘"
  `)
})

test("table with bold text", async () => {
  const markdown = `| Feature | Status |
|---|---|
| **Authentication** | Done |
| **API** | WIP |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌──────────────┬──────┐
    │Feature       │Status│
    ├──────────────┼──────┤
    │Authentication│Done  │
    ├──────────────┼──────┤
    │API           │WIP   │
    └──────────────┴──────┘"
  `)
})

test("table with italic text", async () => {
  const markdown = `| Item | Note |
|---|---|
| One | *important* |
| Two | *ok* |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌────┬─────────┐
    │Item│Note     │
    ├────┼─────────┤
    │One │important│
    ├────┼─────────┤
    │Two │ok       │
    └────┴─────────┘"
  `)
})

test("table with mixed formatting", async () => {
  const markdown = `| Type | Value | Notes |
|---|---|---|
| **Bold** | \`code\` | *italic* |
| Plain | **strong** | \`cmd\` |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─────┬──────┬──────┐
    │Type │Value │Notes │
    ├─────┼──────┼──────┤
    │Bold │code  │italic│
    ├─────┼──────┼──────┤
    │Plain│strong│cmd   │
    └─────┴──────┴──────┘"
  `)
})

test("table with alignment markers (left, center, right)", async () => {
  const markdown = `| Left | Center | Right |
|:---|:---:|---:|
| A | B | C |
| Long text | X | Y |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─────────┬──────┬─────┐
    │Left     │Center│Right│
    ├─────────┼──────┼─────┤
    │A        │B     │C    │
    ├─────────┼──────┼─────┤
    │Long text│X     │Y    │
    └─────────┴──────┴─────┘"
  `)
})

test("table with empty cells", async () => {
  const markdown = `| A | B |
|---|---|
| X |  |
|  | Y |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─┬─┐
    │A│B│
    ├─┼─┤
    │X│ │
    ├─┼─┤
    │ │Y│
    └─┴─┘"
  `)
})

test("table with long header and short content", async () => {
  const markdown = `| Very Long Column Header | Short |
|---|---|
| A | B |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───────────────────────┬─────┐
    │Very Long Column Header│Short│
    ├───────────────────────┼─────┤
    │A                      │B    │
    └───────────────────────┴─────┘"
  `)
})

test("table with short header and long content", async () => {
  const markdown = `| X | Y |
|---|---|
| This is very long content | Short |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─────────────────────────┬─────┐
    │X                        │Y    │
    ├─────────────────────────┼─────┤
    │This is very long content│Short│
    └─────────────────────────┴─────┘"
  `)
})

test("table inside code block should NOT be formatted", async () => {
  const markdown = `\`\`\`
| Not | A | Table |
|---|---|---|
| Should | Stay | Raw |
\`\`\`

| Real | Table |
|---|---|
| Is | Formatted |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    | Not | A | Table |
    |---|---|---|
    | Should | Stay | Raw |

    ┌────┬─────────┐
    │Real│Table    │
    ├────┼─────────┤
    │Is  │Formatted│
    └────┴─────────┘"
  `)
})

test("multiple tables in same document", async () => {
  const markdown = `| Table1 | A |
|---|---|
| X | Y |

Some text between.

| Table2 | BB |
|---|---|
| Long content | Z |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌──────┬─┐
    │Table1│A│
    ├──────┼─┤
    │X     │Y│
    └──────┴─┘

    Some text between.
    ┌────────────┬──┐
    │Table2      │BB│
    ├────────────┼──┤
    │Long content│Z │
    └────────────┴──┘"
  `)
})

test("table with escaped pipe character", async () => {
  const markdown = `| Command | Output |
|---|---|
| echo | Hello |
| ls \\| grep | Filtered |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─────────┬────────┐
    │Command  │Output  │
    ├─────────┼────────┤
    │echo     │Hello   │
    ├─────────┼────────┤
    │ls | grep│Filtered│
    └─────────┴────────┘"
  `)
})

test("table with unicode characters", async () => {
  const markdown = `| Emoji | Name |
|---|---|
| 🎉 | Party |
| 🚀 | Rocket |
| 日本語 | Japanese |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌──────┬────────┐
    │Emoji │Name    │
    ├──────┼────────┤
    │🎉    │Party   │
    ├──────┼────────┤
    │🚀    │Rocket  │
    ├──────┼────────┤
    │日本語│Japanese│
    └──────┴────────┘"
  `)
})

test("table with links", async () => {
  const markdown = `| Name | Link |
|---|---|
| Google | [link](https://google.com) |
| GitHub | [gh](https://github.com) |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌──────┬─────────────────────────┐
    │Name  │Link                     │
    ├──────┼─────────────────────────┤
    │Google│link (https://google.com)│
    ├──────┼─────────────────────────┤
    │GitHub│gh (https://github.com)  │
    └──────┴─────────────────────────┘"
  `)
})

test("single row table (header + delimiter only)", async () => {
  const markdown = `| Only | Header |
|---|---|`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    | Only | Header |
    |---|---|"
  `)
})

test("table with many columns", async () => {
  const markdown = `| A | B | C | D | E |
|---|---|---|---|---|
| 1 | 2 | 3 | 4 | 5 |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─┬─┬─┬─┬─┐
    │A│B│C│D│E│
    ├─┼─┼─┼─┼─┤
    │1│2│3│4│5│
    └─┴─┴─┴─┴─┘"
  `)
})

test("no tables returns original content", async () => {
  const markdown = `# Just a heading

Some paragraph text.

- List item`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Just a heading

    Some paragraph text.

    - List item"
  `)
})

test("table with nested inline formatting", async () => {
  const markdown = `| Description |
|---|
| This has **bold and \`code\`** together |
| And *italic with **nested bold*** |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───────────────────────────────┐
    │Description                    │
    ├───────────────────────────────┤
    │This has bold and code together│
    ├───────────────────────────────┤
    │And italic with nested bold    │
    └───────────────────────────────┘"
  `)
})

// Tests with conceal=false - formatting markers should be visible and columns sized accordingly

test("conceal=false: table with bold text", async () => {
  const markdown = `| Feature | Status |
|---|---|
| **Authentication** | Done |
| **API** | WIP |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌──────────────────┬──────┐
    │Feature           │Status│
    ├──────────────────┼──────┤
    │**Authentication**│Done  │
    ├──────────────────┼──────┤
    │**API**           │WIP   │
    └──────────────────┴──────┘"
  `)
})

test("conceal=false: table with inline code", async () => {
  const markdown = `| Command | Description |
|---|---|
| \`npm install\` | Install deps |
| \`npm run build\` | Build project |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌───────────────┬─────────────┐
    │Command        │Description  │
    ├───────────────┼─────────────┤
    │\`npm install\`  │Install deps │
    ├───────────────┼─────────────┤
    │\`npm run build\`│Build project│
    └───────────────┴─────────────┘"
  `)
})

test("conceal=false: table with italic text", async () => {
  const markdown = `| Item | Note |
|---|---|
| One | *important* |
| Two | *ok* |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌────┬───────────┐
    │Item│Note       │
    ├────┼───────────┤
    │One │*important*│
    ├────┼───────────┤
    │Two │*ok*       │
    └────┴───────────┘"
  `)
})

test("conceal=false: table with mixed formatting", async () => {
  const markdown = `| Type | Value | Notes |
|---|---|---|
| **Bold** | \`code\` | *italic* |
| Plain | **strong** | \`cmd\` |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌────────┬──────────┬────────┐
    │Type    │Value     │Notes   │
    ├────────┼──────────┼────────┤
    │**Bold**│\`code\`    │*italic*│
    ├────────┼──────────┼────────┤
    │Plain   │**strong**│\`cmd\`   │
    └────────┴──────────┴────────┘"
  `)
})

test("conceal=false: table with unicode characters", async () => {
  const markdown = `| Emoji | Name |
|---|---|
| 🎉 | Party |
| 🚀 | Rocket |
| 日本語 | Japanese |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌──────┬────────┐
    │Emoji │Name    │
    ├──────┼────────┤
    │🎉    │Party   │
    ├──────┼────────┤
    │🚀    │Rocket  │
    ├──────┼────────┤
    │日本語│Japanese│
    └──────┴────────┘"
  `)
})

test("conceal=false: basic table alignment", async () => {
  const markdown = `| Name | Age |
|---|---|
| Alice | 30 |
| Bob | 5 |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌─────┬───┐
    │Name │Age│
    ├─────┼───┤
    │Alice│30 │
    ├─────┼───┤
    │Bob  │5  │
    └─────┴───┘"
  `)
})

test("table with paragraphs before and after", async () => {
  const markdown = `This is a paragraph before the table.

| Name | Age |
|---|---|
| Alice | 30 |

This is a paragraph after the table.`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    This is a paragraph before the table.
    ┌─────┬───┐
    │Name │Age│
    ├─────┼───┤
    │Alice│30 │
    └─────┴───┘

    This is a paragraph after the table."
  `)
})

test("selection across markdown table includes table data", async () => {
  const markdown = `Intro line above table.

| Component | Status | Notes |
|---|---|---|
| Authentication | **Done** | OAuth2 + SSO |
| Payments API | *In Progress* | Retry + idempotency |
| Search Indexer | \`Done\` | Ranking + typo fix |

Outro line below table.`

  const md = createMarkdownRenderable({
    id: "markdown",
    content: markdown,
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const topBlock = md._blockStates[0]?.renderable as CodeRenderable | undefined
  const tableBlock = md._blockStates[1]?.renderable as TextTableRenderable | undefined
  const bottomBlock = md._blockStates[2]?.renderable as CodeRenderable | undefined

  expect(topBlock).toBeInstanceOf(CodeRenderable)
  expect(tableBlock).toBeInstanceOf(TextTableRenderable)
  expect(bottomBlock).toBeInstanceOf(CodeRenderable)

  const startX = topBlock!.x + 1
  const startY = topBlock!.y
  const endX = Math.max(bottomBlock!.x + bottomBlock!.width - 2, startX + 1)
  const endY = bottomBlock!.y

  await mockMouse.drag(startX, startY, endX, endY)
  await renderer.idle()

  const selectedText = renderer.getSelection()?.getSelectedText() ?? ""

  expect(selectedText).toContain("Authentication")
  expect(selectedText).toContain("Payments API")
  expect(selectedText).toContain("Retry + idempotency")
})

// Code block tests

test("code block with language", async () => {
  const markdown = `\`\`\`typescript
const x = 1;
console.log(x);
\`\`\``

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    const x = 1;
    console.log(x);"
  `)
})

test("code block without language", async () => {
  const markdown = `\`\`\`
plain code block
with multiple lines
\`\`\``

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    plain code block
    with multiple lines"
  `)
})

test("code block mixed with text", async () => {
  const markdown = `Here is some code:

\`\`\`js
function hello() {
  return "world";
}
\`\`\`

And here is more text after.`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Here is some code:
    function hello() {
      return "world";
    }

    And here is more text after."
  `)
})

test("multiple code blocks", async () => {
  const markdown = `First block:

\`\`\`python
print("hello")
\`\`\`

Second block:

\`\`\`rust
fn main() {}
\`\`\``

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    First block:
    print("hello")

    Second block:
    fn main() {}"
  `)
})

test("code block in conceal=false mode", async () => {
  const markdown = `\`\`\`js
const x = 1;
\`\`\``

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    const x = 1;"
  `)
})

test("code block concealment is disabled by default", async () => {
  const mockTreeSitterClient = new MockTreeSitterClient()
  mockTreeSitterClient.setMockResult({
    highlights: [[0, 1, "conceal", { conceal: "" }]],
  })

  const md = createMarkdownRenderable({
    id: "markdown-code-default-conceal",
    content: "```markdown\n# Hidden heading\n```",
    syntaxStyle,
    conceal: true,
    treeSitterClient: mockTreeSitterClient,
  })

  renderer.root.add(md)
  await renderer.idle()
  expect(mockTreeSitterClient.isHighlighting()).toBe(true)

  mockTreeSitterClient.resolveAllHighlightOnce()
  await Bun.sleep(10)
  await renderer.idle()

  const frame = captureFrame()
  expect(frame).toContain("# Hidden heading")
})

test("code block concealment can be enabled with concealCode", async () => {
  const mockTreeSitterClient = new MockTreeSitterClient()
  mockTreeSitterClient.setMockResult({
    highlights: [[0, 1, "conceal", { conceal: "" }]],
  })

  const md = createMarkdownRenderable({
    id: "markdown-code-conceal-enabled",
    content: "```markdown\n# Hidden heading\n```",
    syntaxStyle,
    conceal: true,
    concealCode: true,
    treeSitterClient: mockTreeSitterClient,
  })

  renderer.root.add(md)
  await renderer.idle()
  expect(mockTreeSitterClient.isHighlighting()).toBe(true)

  mockTreeSitterClient.resolveAllHighlightOnce()
  await Bun.sleep(10)
  await renderer.idle()

  const frame = captureFrame()
  expect(frame).not.toContain("# Hidden heading")
  expect(frame).toContain("Hidden heading")
})

test("toggling concealCode updates existing code block renderables", async () => {
  const mockTreeSitterClient = new MockTreeSitterClient()
  mockTreeSitterClient.setMockResult({
    highlights: [[0, 1, "conceal", { conceal: "" }]],
  })

  const md = createMarkdownRenderable({
    id: "markdown-code-conceal-toggle",
    content: "```markdown\n# Hidden heading\n```",
    syntaxStyle,
    conceal: true,
    concealCode: false,
    treeSitterClient: mockTreeSitterClient,
  })

  renderer.root.add(md)
  await renderer.idle()
  expect(mockTreeSitterClient.isHighlighting()).toBe(true)

  mockTreeSitterClient.resolveAllHighlightOnce()
  await Bun.sleep(10)
  await renderer.idle()

  const frameBefore = captureFrame()
  expect(frameBefore).toContain("# Hidden heading")

  md.concealCode = true
  renderer.requestRender()
  await renderer.idle()
  expect(mockTreeSitterClient.isHighlighting()).toBe(true)

  mockTreeSitterClient.resolveAllHighlightOnce()
  await Bun.sleep(10)
  await renderer.idle()

  const frameAfter = captureFrame()
  expect(frameAfter).not.toContain("# Hidden heading")
  expect(frameAfter).toContain("Hidden heading")
})

// Heading tests

test("headings h1 through h3", async () => {
  const markdown = `# Heading 1

## Heading 2

### Heading 3`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Heading 1

    Heading 2

    Heading 3"
  `)
})

test("headings with conceal=false show markers", async () => {
  const markdown = `# Heading 1

## Heading 2`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    # Heading 1

    ## Heading 2"
  `)
})

// List tests

test("unordered list", async () => {
  const markdown = `- Item one
- Item two
- Item three`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    - Item one
    - Item two
    - Item three"
  `)
})

test("ordered list", async () => {
  const markdown = `1. First item
2. Second item
3. Third item`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    1. First item
    2. Second item
    3. Third item"
  `)
})

test("list with inline formatting", async () => {
  const markdown = `- **Bold** item
- *Italic* item
- \`Code\` item`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    - Bold item
    - Italic item
    - Code item"
  `)
})

test("assistant-style top-level markdown layout", async () => {
  const md = createMarkdownRenderable({
    id: "assistant-style-layout",
    content: `# OpenTUI Markdown Demo

Welcome to the **MarkdownRenderable** showcase! This demonstrates automatic table alignment.

## Features

- Automatic **table column alignment** based on content width
- Proper handling of \`inline code\`, **bold**, and *italic* in tables

## Renderer Stress Cases

### Interleaved Code

Start with a short conclusion before any code appears.

\`\`\`ts
export function parse(input: string) {
  return input.trim().split(/\\\\s+/)
}
\`\`\`

Then continue with prose immediately after the code block.

### Quote, Table, Diff

> Quoted note after the list. It should preserve quote styling.

| Feature | Stress |
| --- | --- |
| Markdown | prose/code/table interleave |
| Renderer | wrapping and spacing |

\`\`\`diff
- const renderer = oldMarkdown
+ const renderer = experimentalMarkdown
\`\`\`

---`,
    syntaxStyle,
    internalBlockMode: "top-level",
    tableOptions: { style: "grid", widthMode: "content", cellPaddingX: 1 },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    OpenTUI Markdown Demo
    
    Welcome to the MarkdownRenderable showcase! This
    demonstrates automatic table alignment.
    
    Features
    
    - Automatic table column alignment based on content width
    - Proper handling of inline code, bold, and italic in tables
    
    Renderer Stress Cases
    
    Interleaved Code
    
    Start with a short conclusion before any code appears.
    
    export function parse(input: string) {
      return input.trim().split(/\\\\s+/)
    }
    
    Then continue with prose immediately after the code block.
    
    Quote, Table, Diff
    
    │ Quoted note after the list. It should preserve quote
    │ styling.

    ┌──────────┬─────────────────────────────┐
    │ Feature  │ Stress                      │
    ├──────────┼─────────────────────────────┤
    │ Markdown │ prose/code/table interleave │
    ├──────────┼─────────────────────────────┤
    │ Renderer │ wrapping and spacing        │
    └──────────┴─────────────────────────────┘
    
    - const renderer = oldMarkdown
    + const renderer = experimentalMarkdown
    
    ────────────────────────────────────────────────────────────"
  `)
})

test("top-level structural markdown blocks have exactly one blank row between them", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-structural-spacing",
    content: `Paragraph before quote.

> Quote text.

| A | B |
| --- | --- |
| 1 | 2 |

\`\`\`diff
- old
+ new
\`\`\`

Paragraph after diff.

---

## Next Section`,
    syntaxStyle,
    internalBlockMode: "top-level",
    tableOptions: { style: "grid", widthMode: "content", cellPaddingX: 1 },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    Paragraph before quote.
    
    │ Quote text.
    
    ┌───┬───┐
    │ A │ B │
    ├───┼───┤
    │ 1 │ 2 │
    └───┴───┘
    
    - old
    + new
    
    Paragraph after diff.
    
    ────────────────────────────────────────────────────────────
    
    Next Section"
  `)
})

// Blockquote tests

test("simple blockquote", async () => {
  const markdown = `> This is a quote
> spanning multiple lines`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    │ This is a quote
    │ spanning multiple lines"
  `)
})

test("blockquote uses markup.quote style for text and conceal style for bar", async () => {
  const quoteColor = RGBA.fromValues(0.25, 0.5, 0.75, 1)
  const concealColor = RGBA.fromValues(0.1, 0.2, 0.3, 1)
  const md = createMarkdownRenderable({
    id: "markdown-blockquote-style",
    content: "> Quote text",
    syntaxStyle: SyntaxStyle.fromStyles({
      default: { fg: RGBA.fromValues(1, 1, 1, 1) },
      conceal: { fg: concealColor },
      "markup.quote": { fg: quoteColor, italic: true },
    }),
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const spans = captureSpans()
  expect(findSpanContaining(spans, "│")?.fg?.toInts()).toEqual(concealColor.toInts())

  const textSpan = findSpanContaining(spans, "Quote text")
  expect(textSpan?.fg?.toInts()).toEqual(quoteColor.toInts())
  expect((textSpan?.attributes ?? 0) & TextAttributes.ITALIC).toBe(TextAttributes.ITALIC)
})

test("blockquote updates quote text and bar colors when syntaxStyle changes", async () => {
  const quoteColor1 = RGBA.fromValues(0.25, 0.5, 0.75, 1)
  const quoteColor2 = RGBA.fromValues(0.75, 0.5, 0.25, 1)
  const concealColor1 = RGBA.fromValues(0.1, 0.2, 0.3, 1)
  const concealColor2 = RGBA.fromValues(0.3, 0.2, 0.1, 1)
  const theme1 = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    conceal: { fg: concealColor1 },
    "markup.quote": { fg: quoteColor1, italic: true },
  })
  const theme2 = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 1, 1, 1) },
    conceal: { fg: concealColor2 },
    "markup.quote": { fg: quoteColor2, italic: true },
  })
  const md = createMarkdownRenderable({
    id: "markdown-blockquote-style-update",
    content: "> Quote text",
    syntaxStyle: theme1,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)
  expect(findSpanContaining(captureSpans(), "│")?.fg?.toInts()).toEqual(concealColor1.toInts())
  expect(findSpanContaining(captureSpans(), "Quote text")?.fg?.toInts()).toEqual(quoteColor1.toInts())

  md.syntaxStyle = theme2
  renderer.requestRender()
  await renderMarkdownRenderable(md)

  expect(findSpanContaining(captureSpans(), "│")?.fg?.toInts()).toEqual(concealColor2.toInts())
  expect(findSpanContaining(captureSpans(), "Quote text")?.fg?.toInts()).toEqual(quoteColor2.toInts())
})

test("fenced diff blocks color added and removed lines", async () => {
  const mockTreeSitterClient = new MockTreeSitterClient()
  mockTreeSitterClient.setMockResult({
    highlights: [
      [0, 5, "diff.minus"],
      [6, 11, "diff.plus"],
    ],
  })

  const md = createMarkdownRenderable({
    id: "markdown-diff-fence",
    content: "```diff\n- old\n+ new\n unchanged\n```",
    treeSitterClient: mockTreeSitterClient,
    syntaxStyle: SyntaxStyle.fromStyles({
      default: { fg: RGBA.fromValues(1, 1, 1, 1) },
      "diff.minus": { fg: RGBA.fromValues(1, 0, 0, 1) },
      "diff.plus": { fg: RGBA.fromValues(0, 1, 0, 1) },
    }),
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const codeBlock = md._blockStates[0]?.renderable
  expect(codeBlock).toBeInstanceOf(CodeRenderable)
  expect((codeBlock as CodeRenderable).filetype).toBe("diff")
  expect(mockTreeSitterClient.isHighlighting()).toBe(true)

  mockTreeSitterClient.resolveAllHighlightOnce()
  await Bun.sleep(10)
  await renderOnce()

  expect(findSpanContaining(captureSpans(), "- old")?.fg?.toInts()).toEqual(RGBA.fromValues(1, 0, 0, 1).toInts())
  expect(findSpanContaining(captureSpans(), "+ new")?.fg?.toInts()).toEqual(RGBA.fromValues(0, 1, 0, 1).toInts())
})

// Inline formatting tests

test("bold text", async () => {
  const markdown = `This has **bold** text in it.`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    This has bold text in it."
  `)
})

test("italic text", async () => {
  const markdown = `This has *italic* text in it.`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    This has italic text in it."
  `)
})

test("inline code", async () => {
  const markdown = `Use \`console.log()\` to debug.`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Use console.log() to debug."
  `)
})

test("mixed inline formatting", async () => {
  const markdown = `**Bold**, *italic*, and \`code\` together.`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Bold, italic, and code together."
  `)
})

test("inline formatting with conceal=false", async () => {
  const markdown = `**Bold**, *italic*, and \`code\` together.`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    **Bold**, *italic*, and \`code\` together."
  `)
})

// Link tests

test("links with conceal mode", async () => {
  const markdown = `Check out [OpenTUI](https://github.com/sst/opentui) for more.`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Check out OpenTUI (https://github.com/sst/opentui) for more."
  `)
})

test("links with conceal=false", async () => {
  const markdown = `Check out [OpenTUI](https://github.com/sst/opentui) for more.`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    Check out [OpenTUI](https://github.com/sst/opentui) for
    more."
  `)
})

// Horizontal rule

test("horizontal rule", async () => {
  const markdown = `Before

---

After`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Before
    ────────────────────────────────────────────────────────────
    
    After"
  `)
})

test("horizontal rule has one blank row before and after", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-hr-heading-spacing",
    content: "Before\n\n---\n\n## After",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    Before
    
    ────────────────────────────────────────────────────────────
    
    After"
  `)
})

// Complex document

test("complex markdown document", async () => {
  const markdown = `# Project Title

Welcome to **OpenTUI**, a terminal UI library.

## Features

- Automatic table alignment
- \`inline code\` support
- *Italic* and **bold** text

## Code Example

\`\`\`typescript
const md = new MarkdownRenderable(ctx, {
  content: "# Hello",
})
\`\`\`

## Links

Visit [GitHub](https://github.com) for more.

---

*Press \`?\` for help*`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Project Title

    Welcome to OpenTUI, a terminal UI library.

    Features

    - Automatic table alignment
    - inline code support
    - Italic and bold text

    Code Example

    const md = new MarkdownRenderable(ctx, {
      content: "# Hello",
    })

    Links

    Visit GitHub (https://github.com) for more.
    ────────────────────────────────────────────────────────────

    Press ? for help"
  `)
})

// Custom renderNode tests

test("custom renderNode can override heading rendering", async () => {
  const { TextRenderable } = await import("../Text.js")
  const { StyledText } = await import("../../lib/styled-text.js")

  // Helper to extract text from marked tokens
  const extractText = (node: any): string => {
    if (node.type === "text") return node.text
    if (node.tokens) return node.tokens.map(extractText).join("")
    return ""
  }

  const md = createMarkdownRenderable({
    id: "custom-heading",
    content: `# Custom Heading

Regular paragraph.`,
    syntaxStyle,
    renderNode: (node, ctx) => {
      if (node.type === "heading") {
        const text = extractText(node)
        return new TextRenderable(renderer, {
          id: "custom",
          content: new StyledText([{ __isChunk: true, text: `[CUSTOM] ${text}`, attributes: 0 }]),
          width: "100%",
        })
      }
      return ctx.defaultRender()
    },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    [CUSTOM] Custom Heading
    Regular paragraph."
  `)
})

test("custom renderNode can override code block rendering", async () => {
  const { BoxRenderable } = await import("../Box.js")
  const { TextRenderable } = await import("../Text.js")

  const md = createMarkdownRenderable({
    id: "custom-code",
    content: `\`\`\`js
const x = 1;
\`\`\``,
    syntaxStyle,
    renderNode: (node, ctx) => {
      if (node.type === "code") {
        const box = new BoxRenderable(renderer, {
          id: "code-box",
          border: true,
          borderStyle: "single",
        })
        box.add(
          new TextRenderable(renderer, {
            id: "code-text",
            content: `CODE: ${(node as any).text}`,
          }),
        )
        return box
      }
      return ctx.defaultRender()
    },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    ┌──────────────────────────────────────────────────────────┐
    │CODE: const x = 1;                                        │
    └──────────────────────────────────────────────────────────┘"
  `)
})

test("custom renderNode output survives top-level spacing updates", async () => {
  const md = createMarkdownRenderable({
    id: "custom-spacing-update",
    content: "Paragraph\n# Heading",
    syntaxStyle,
    internalBlockMode: "top-level",
    renderNode: (node, ctx) => {
      if (node.type === "heading") {
        return new TextRenderable(renderer, {
          id: "custom-text-spacing",
          content: "CUSTOM",
          width: "100%",
        })
      }

      return ctx.defaultRender()
    },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  md.content = "Paragraph\n\n# Heading"
  await renderMarkdownRenderable(md)

  expect(md._blockStates.map((state) => state.marginTop ?? 0)).toEqual([0, 1])

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())

  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    Paragraph
    CUSTOM"
  `)
})

test("renderNode setter updates existing markdown renderable", async () => {
  const md = createMarkdownRenderable({
    id: "render-node-setter",
    content: "# Heading",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  md.renderNode = (node, ctx) => {
    if (node.type !== "heading") return ctx.defaultRender()
    return new TextRenderable(renderer, {
      content: "CUSTOM",
      width: "100%",
    })
  }
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    CUSTOM"
  `)
})

test("renderNode setter rerenders same-type top-level blocks", async () => {
  const md = createMarkdownRenderable({
    id: "render-node-setter-top-level",
    content: "# Heading",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  md.renderNode = (node, ctx) => {
    if (node.type !== "heading") return ctx.defaultRender()
    return new TextRenderable(renderer, {
      content: "CUSTOM",
      width: "100%",
    })
  }
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    CUSTOM"
  `)
})

test("internalBlockMode setter updates existing markdown renderable", async () => {
  const md = createMarkdownRenderable({
    id: "internal-block-mode-setter",
    content: "Paragraph\n\n```ts\nconst x = 1\n```",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  md.internalBlockMode = "top-level"
  await renderMarkdownRenderable(md)

  expect(md._blockStates.map((state) => state.token.type)).toEqual(["paragraph", "code"])
  expect(md._blockStates.map((state) => state.marginTop ?? 0)).toEqual([0, 1])
})

test("custom top-level renderNode can increase default block margins", async () => {
  const md = createMarkdownRenderable({
    id: "custom-top-level-margin",
    content: "Paragraph\n\n# Heading",
    syntaxStyle,
    internalBlockMode: "top-level",
    renderNode: (node, ctx) => {
      const renderable = ctx.defaultRender()
      if (node.type === "heading" && renderable) renderable.marginTop = 2
      return renderable
    },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  expect(md._blockStates.map((state) => state.renderable.marginTop ?? 0)).toEqual([0, 2])
})

test("custom renderNode returning null uses default", async () => {
  const md = createMarkdownRenderable({
    id: "custom-null",
    content: `# Heading

Paragraph text.`,
    syntaxStyle,
    renderNode: () => null,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    Heading


    Paragraph text."
  `)
})

// Incomplete/invalid markdown tests

test("incomplete code block (no closing fence)", async () => {
  const markdown = `Here is some code:

\`\`\`javascript
const x = 1;
console.log(x);`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Here is some code:
    const x = 1;
    console.log(x);"
  `)
})

test("incomplete bold (no closing **)", async () => {
  const markdown = `This has **unclosed bold text`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    This has **unclosed bold text"
  `)
})

test("incomplete italic (no closing *)", async () => {
  const markdown = `This has *unclosed italic text`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    This has *unclosed italic text"
  `)
})

test("incomplete link (no closing paren)", async () => {
  const markdown = `Check out [this link](https://example.com`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Check out this link(https://example.com"
  `)
})

test("incomplete table (only header)", async () => {
  const markdown = `| Header1 | Header2 |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    | Header1 | Header2 |"
  `)
})

test("incomplete table (header + delimiter, no rows)", async () => {
  const markdown = `| Header1 | Header2 |
|---|---|`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    | Header1 | Header2 |
    |---|---|"
  `)
})

test("streaming-like content with partial code block", async () => {
  const markdown = `# Title

Some text before code.

\`\`\`py`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Title

    Some text before code."
  `)
})

test("malformed table with missing pipes", async () => {
  const markdown = `| A | B
|---|---
| 1 | 2`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─┬─┐
    │A│B│
    ├─┼─┤
    │1│2│
    └─┴─┘"
  `)
})

test("trailing blank lines do not add spacing", async () => {
  const markdown = `# Heading

Paragraph text.


`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Heading

    Paragraph text."
  `)
})

test("multiple trailing blank lines do not add spacing", async () => {
  const markdown = `First paragraph.

Second paragraph.



`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    First paragraph.

    Second paragraph."
  `)
})

test("blank lines between blocks add spacing", async () => {
  const markdown = `First

Second

Third`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    First

    Second

    Third"
  `)
})

test("code block at end with trailing blank lines", async () => {
  const markdown = `Text before

\`\`\`js
const x = 1;
\`\`\`

`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    Text before
    const x = 1;"
  `)
})

test("table at end with trailing blank lines", async () => {
  const markdown = `| A | B |
|---|---|
| 1 | 2 |


`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─┬─┐
    │A│B│
    ├─┼─┤
    │1│2│
    └─┴─┘"
  `)
})

// Incremental parsing tests

test("internalBlockMode=top-level preserves top-level block boundaries", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-blocks",
    content: "# Title\n\n```ts\nconst x = 1\n```\n\n| A |\n|---|\n| 1 |",
    syntaxStyle,
    streaming: false,
    internalBlockMode: "top-level",
    tableOptions: { widthMode: "content" },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  expect(md._blockStates.map((state) => state.token.type)).toEqual(["heading", "code", "table"])
  expect(md._blockStates[1]?.renderable).toBeInstanceOf(CodeRenderable)
  expect(md._blockStates[2]?.renderable).toBeInstanceOf(TextTableRenderable)
  expect(md._stableBlockCount).toBe(3)
})

test("internalBlockMode=top-level reuses table renderable when rows stream in", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-table-reuse",
    content: "| A | B |\n|---|---|\n| 1 | 2 |",
    syntaxStyle,
    streaming: true,
    internalBlockMode: "top-level",
    tableOptions: { widthMode: "content" },
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const table = md._blockStates[0]?.renderable
  expect(table).toBeInstanceOf(TextTableRenderable)

  md.content += "\n| 3 | 4 |"
  await renderMarkdownRenderable(md)

  expect(md._blockStates[0]?.renderable).toBe(table)
})

test("internalBlockMode=top-level updates code renderable filetype when fence changes to diff", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-code-kind-change",
    content: "```ts\nconst x = 1\n```",
    syntaxStyle,
    streaming: true,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const first = md._blockStates[0]?.renderable
  expect(first).toBeInstanceOf(CodeRenderable)

  md.content = "```diff\n- const x = 1\n+ const y = 2\n```"
  await renderMarkdownRenderable(md)

  expect(md._blockStates[0]?.renderable).toBe(first)
  expect((md._blockStates[0]?.renderable as CodeRenderable).filetype).toBe("diff")
})

test("internalBlockMode=top-level normalizes one blank row between top-level blocks", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-spacing",
    content: "# Title\n\nParagraph\n\n```ts\nconst x = 1\n```",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())

  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    Title
    
    Paragraph

    const x = 1"
  `)
})

test("internalBlockMode=top-level keeps tight paragraph list transitions tight", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-tight-list-spacing",
    content: "Paragraph:\n- one\n- two",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  expect(md._blockStates.map((state) => state.marginTop ?? 0)).toEqual([0, 0])

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())

  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    Paragraph:
    - one
    - two"
  `)
})

test("internalBlockMode=top-level preserves source blank line before lists", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-list-spacing",
    content: "The table alignment uses:\n\n1. AST-based parsing\n2. Caching",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    The table alignment uses:
    
    1. AST-based parsing
    2. Caching"
  `)
})

test("internalBlockMode=top-level tightens spacing when a blank line is removed", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-tighten-spacing",
    content: "Paragraph\n\n- one\n- two",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  md.content = "Paragraph\n- one\n- two"
  await renderMarkdownRenderable(md)

  expect(md._blockStates.map((state) => state.marginTop ?? 0)).toEqual([0, 0])

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())

  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    Paragraph
    - one
    - two"
  `)
})

test("internalBlockMode=top-level preserves spacing after tight fenced code blocks", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-tight-code-spacing",
    content: "```ts\nconst x = 1\n```\nParagraph",
    syntaxStyle,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  expect(md._blockStates.map((state) => state.marginTop ?? 0)).toEqual([0, 1])

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())

  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    const x = 1
    
    Paragraph"
  `)
})

test("incremental update reuses unchanged blocks when appending", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "# Hello\n\nParagraph 1",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderer.idle()

  // Get reference to first block
  const firstBlockBefore = md._blockStates[0]?.renderable

  // Append content
  md.content = "# Hello\n\nParagraph 1\n\nParagraph 2"
  await renderer.idle()

  // First block should be reused (same object reference)
  const firstBlockAfter = md._blockStates[0]?.renderable
  expect(firstBlockAfter).toBe(firstBlockBefore)
})

test("streaming mode keeps trailing tokens unstable", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "# Hello",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const frame1 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
  expect(frame1).toContain("Hello")

  // Extend the heading
  md.content = "# Hello World"
  await renderMarkdownRenderable(md)

  const frame2 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
  expect(frame2).toContain("Hello World")
})

test("streaming code blocks with concealCode=true do not flash unconcealed markdown", async () => {
  const mockTreeSitterClient = new MockTreeSitterClient()
  mockTreeSitterClient.setMockResult({
    highlights: [[0, 1, "conceal", { conceal: "" }]],
  })

  const recorder = new TestRecorder(renderer)
  recorder.rec()

  const md = createMarkdownRenderable({
    id: "markdown-streaming-conceal-flicker",
    content: "# Stream\n\n```markdown\n# Hidden heading\n```",
    syntaxStyle,
    conceal: true,
    concealCode: true,
    streaming: true,
    treeSitterClient: mockTreeSitterClient,
  })

  renderer.root.add(md)
  await renderer.idle()

  expect(mockTreeSitterClient.isHighlighting()).toBe(true)

  mockTreeSitterClient.resolveAllHighlightOnce()
  await Bun.sleep(10)
  await renderer.idle()

  recorder.stop()

  const frames = recorder.recordedFrames.map((frame) => frame.frame)
  const unconcealedFrames = frames.filter((frame) => frame.includes("# Hidden heading"))
  expect(unconcealedFrames.length).toBe(0)
})

test("non-streaming mode parses all tokens as stable", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "# Hello\n\nPara 1\n\nPara 2",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderer.idle()

  // Get parse state
  const parseState = md._parseState
  expect(parseState).not.toBeNull()
  expect(parseState!.tokens.length).toBeGreaterThan(0)
})

test("internalBlockMode=top-level exposes a conservative stable block prefix", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-top-level-stable-prefix",
    content: "# Title\n\nPara 1\n\n",
    syntaxStyle,
    streaming: true,
    internalBlockMode: "top-level",
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  md.content = "# Title\n\nPara 1\n\nPara 2"
  await renderMarkdownRenderable(md)

  expect(md._blockStates.map((state) => state.token.type)).toEqual(["heading", "paragraph", "paragraph"])
  expect(md._stableBlockCount).toBe(1)
})

test("default block mode still coalesces ordinary markdown blocks", async () => {
  const md = createMarkdownRenderable({
    id: "markdown-default-coalesced-blocks",
    content: "# Title\n\nPara 1",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  expect(md._blockStates).toHaveLength(1)
  expect(md._blockStates[0]?.token.type).toBe("paragraph")
  expect(md._stableBlockCount).toBe(0)
})

test("parse failure fallback leaves stable block count at zero", async () => {
  const lexerRef = Lexer as unknown as { lex: typeof Lexer.lex }
  const originalLex = lexerRef.lex

  lexerRef.lex = (() => {
    throw new Error("parse failed")
  }) as typeof Lexer.lex

  try {
    const md = createMarkdownRenderable({
      id: "markdown-parse-failure-stable-blocks",
      content: "# Broken",
      syntaxStyle,
      streaming: true,
      internalBlockMode: "top-level",
    })

    renderer.root.add(md)
    await renderMarkdownRenderable(md)

    expect(md._stableBlockCount).toBe(0)
    expect(md._blockStates).toHaveLength(1)
    expect(md._blockStates[0]?.renderable).toBeInstanceOf(CodeRenderable)
  } finally {
    lexerRef.lex = originalLex
  }
})

test("content update with same text does not rebuild", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "# Hello",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderer.idle()

  const blockBefore = md._blockStates[0]?.renderable

  // Set same content
  md.content = "# Hello"
  await renderer.idle()

  const blockAfter = md._blockStates[0]?.renderable
  expect(blockAfter).toBe(blockBefore)
})

test("block type change creates new renderable", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "# Hello",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderer.idle()

  const blockBefore = md._blockStates[0]?.renderable

  // Change from heading to paragraph
  md.content = "Hello"
  await renderer.idle()

  const blockAfter = md._blockStates[0]?.renderable
  // Non-special markdown blocks are coalesced and reused as one markdown code renderable
  expect(blockAfter).toBe(blockBefore)
})

test("streaming property can be toggled", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "# Hello",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  expect(md.streaming).toBe(false)
  const blockBefore = md._blockStates[0]?.renderable

  md.streaming = true
  expect(md.streaming).toBe(true)

  await renderMarkdownRenderable(md)

  const blockAfter = md._blockStates[0]?.renderable
  expect(blockAfter).toBe(blockBefore)

  const frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
  expect(frame).toContain("Hello")
})

test("clearCache forces full rebuild", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "# Hello\n\nWorld",
    syntaxStyle,
  })

  renderer.root.add(md)
  await renderer.idle()

  const parseStateBefore = md._parseState

  md.clearCache()
  await renderer.idle()

  const parseStateAfter = md._parseState
  // Parse state should be different (was cleared and rebuilt)
  expect(parseStateAfter).not.toBe(parseStateBefore)
})

test("streaming->non-streaming transition keeps final table row visible", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| Value |\n|---|\n| first |\n| second |",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderer.idle()

  const tableWhileStreaming = md._blockStates[0]?.renderable

  let frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame).toContain("first")
  expect(frame).toContain("second")

  md.streaming = false
  await renderer.idle()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame).toContain("first")
  expect(frame).toContain("second")
  expect(md._blockStates[0]?.renderable).toBe(tableWhileStreaming)
})

test("streaming table remains visible when a new block starts", async () => {
  const tableMarkdown = "| Value |\n|---|\n| first |\n| second |"
  const md = createMarkdownRenderable({
    id: "markdown",
    content: tableMarkdown,
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderer.idle()

  const tableWhileTrailing = md._blockStates[0]?.renderable

  let frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame).toContain("first")
  expect(frame).toContain("second")

  md.content = `${tableMarkdown}\n\nAfter table block.`
  await renderer.idle()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(md.streaming).toBe(true)
  expect(frame).toContain("first")
  expect(frame).toContain("second")
  expect(md._blockStates.length).toBeGreaterThan(1)
  expect(md._blockStates[0]?.renderable).toBe(tableWhileTrailing)
})

test("stream end mid-table finalizes full table snapshot", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)

  md.content = "| Name | Score |\n|---|---|\n"
  await renderer.idle()

  md.content = "| Name | Score |\n|---|---|\n| Alpha | 10 |\n"
  await renderer.idle()

  md.content = "| Name | Score |\n|---|---|\n| Alpha | 10 |\n| Bravo | 20 |\n"
  await renderer.idle()

  md.content = "| Name | Score |\n|---|---|\n| Alpha | 10 |\n| Bravo | 20 |\n| Charlie | 30 |"
  await renderer.idle()

  let frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame).toContain("Charlie")

  md.streaming = false
  await renderer.idle()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()

  expect(frame).toMatchInlineSnapshot(`
"┌──────────────────────────────┬───────────────────────────┐
│Name                          │Score                      │
├──────────────────────────────┼───────────────────────────┤
│Alpha                         │10                         │
├──────────────────────────────┼───────────────────────────┤
│Bravo                         │20                         │
├──────────────────────────────┼───────────────────────────┤
│Charlie                       │30                         │
└──────────────────────────────┴───────────────────────────┘"
`)
})

test("ignores content updates after markdown renderable is destroyed during streaming", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)

  md.content = "| Name | Score |\n|---|---|\n| Alpha | 10 |\n"
  await renderer.idle()

  md.destroyRecursively()
  expect(md.isDestroyed).toBe(true)

  expect(() => {
    md.content = "| Name | Score |\n|---|---|\n| Alpha | 10 |\n| Bravo | 20 |\n"
    md.streaming = false
  }).not.toThrow()

  await renderer.idle()
})

test("non-streaming->streaming transition keeps final table row visible", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| Value |\n|---|\n| first |\n| second |",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderer.idle()

  const tableWhileStable = md._blockStates[0]?.renderable

  let frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame).toContain("first")
  expect(frame).toContain("second")

  md.streaming = true
  await renderer.idle()

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame).toContain("first")
  expect(frame).toContain("second")
  expect(md._blockStates[0]?.renderable).toBe(tableWhileStable)
})

test("streaming table reuses renderable while updating row content", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| A |\n|---|\n| 1 |",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderer.idle()

  const tableBefore = md._blockStates[0]?.renderable

  md.content = "| B |\n|---|\n| 2 |"
  await renderer.idle()

  const tableAfterSameRows = md._blockStates[0]?.renderable
  expect(tableAfterSameRows).toBe(tableBefore)

  md.content = "| B |\n|---|\n| 2 |\n| 3 |"
  await renderer.idle()

  const tableAfterNewRow = md._blockStates[0]?.renderable
  expect(tableAfterNewRow).toBe(tableBefore)
})

test("table shows all rows when streaming is false", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| A |\n|---|\n| 1 |",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderer.idle()

  // Non-streaming should show all rows including the last
  const frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toContain("1")
})

test("table updates content when not streaming", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| A |\n|---|\n| 1 |",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderer.idle()

  const frame1 = captureFrame()
  expect(frame1).toContain("1")

  // Change cell content - should update immediately when not streaming
  md.content = "| A |\n|---|\n| 2 |"
  await renderer.idle()

  const frame2 = captureFrame()
  expect(frame2).toContain("2")
  expect(frame2).not.toContain("1")
})

test("table keeps unchanged cell chunks stable across updates", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |",
    syntaxStyle,
    streaming: false,
  })

  renderer.root.add(md)
  await renderer.idle()

  const table = md._blockStates[0]?.renderable as TextTableRenderable
  expect(table).toBeInstanceOf(TextTableRenderable)

  const headerBefore = table.content[0]?.[0]
  const firstRowBefore = table.content[1]?.[0]
  const secondRowSecondCellBefore = table.content[2]?.[1]
  const changedCellBefore = table.content[2]?.[0]

  md.content = "| A | B |\n|---|---|\n| 1 | 2 |\n| 33 | 4 |"
  await renderer.idle()

  const tableAfter = md._blockStates[0]?.renderable as TextTableRenderable
  expect(tableAfter).toBe(table)
  expect(tableAfter.content[0]?.[0]).toBe(headerBefore)
  expect(tableAfter.content[1]?.[0]).toBe(firstRowBefore)
  expect(tableAfter.content[2]?.[1]).toBe(secondRowSecondCellBefore)
  expect(tableAfter.content[2]?.[0]).not.toBe(changedCellBefore)
})

test("streaming table updates trailing row content", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| A |\n|---|\n| 1 |\n| 2 |",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderer.idle()

  const table = md._blockStates[0]?.renderable as TextTableRenderable
  const contentBefore = table.content

  md.content = "| A |\n|---|\n| 1 |\n| 200 |"
  await renderer.idle()

  const tableAfter = md._blockStates[0]?.renderable as TextTableRenderable
  const frame = captureFrame()
  expect(tableAfter).toBe(table)
  expect(tableAfter.content).not.toBe(contentBefore)
  expect(frame).toContain("200")
})

test("streaming complex tables keep final rows visible (issue #15244)", async () => {
  const vmHeader = "| VM | 状态 | Owner | Zone | CPU | Mem(GB) | Disk(GB) | Net | Uptime | Cost/月 | Notes |"
  const vmDelimiter = "|---|---|---|---|---|---|---|---|---|---|---|"
  const vmRows = [
    "| vm-api-01 | 🟢 运行中 | alice | us-east-1a | 8 | 32 | 500 | 1.2Gbps | 99.99% | 12,345 | 主节点 — steady |",
    "| vm-job-02 | 🟢 运行中 | bob | ap-south-1b | 16 | 64 | 1,024 | 950Mbps | 98.70% | 23,456 | 批处理 — spikes |",
    "| vm-batch-03 | 🟡 维护中 | carol | eu-west-1c | 32 | 128 | 2,048 | 2.4Gbps | 97.10% | 34,567 | 最后一行 — must stay |",
  ] as const

  const storageHeader = "| 存储池 | 状态 | 使用率 | 可用(GB) | 已用(GB) | 冗余 | 备注 |"
  const storageDelimiter = "|---|---|---|---|---|---|---|"
  const storageRows = [
    "| 热池A | 🟢 正常 | 72% | 12,500 | 32,500 | 3x | 混合负载 |",
    "| 温池B | 🟢 正常 | 81% | 8,250 | 35,750 | 2x | 历史数据 |",
    "| 冷池C | 🟡 告警 | 93% | 2,100 | 27,900 | 2x | 最后一行 — must stay |",
  ] as const

  const buildContent = (vmRowCount: number, storageRowCount: number): string =>
    `### VM details\n\n${vmHeader}\n${vmDelimiter}\n${vmRows.slice(0, vmRowCount).join("\n")}\n\n### Storage details\n\n${storageHeader}\n${storageDelimiter}\n${storageRows.slice(0, storageRowCount).join("\n")}`

  const md = createMarkdownRenderable({
    id: "markdown",
    content: "",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)

  for (const [vmRowCount, storageRowCount] of [
    [2, 2],
    [3, 2],
    [3, 3],
  ] as const) {
    md.content = buildContent(vmRowCount, storageRowCount)
    await renderMarkdownRenderable(md)
  }

  const tableBlocks = md._blockStates
    .map((state) => state.renderable)
    .filter((renderable): renderable is TextTableRenderable => renderable instanceof TextTableRenderable)

  const cellText = (cell: { text: string }[] | null | undefined): string =>
    cell?.map((chunk) => chunk.text).join("") ?? ""

  expect(tableBlocks).toHaveLength(2)

  const vmTable = tableBlocks[0]
  const storageTable = tableBlocks[1]

  expect(vmTable.content.length).toBe(4)
  expect(storageTable.content.length).toBe(4)
  expect(cellText(vmTable.content[3]?.[0])).toContain("vm-batch-03")
  expect(cellText(storageTable.content[3]?.[0])).toContain("冷池C")
})

test("streaming table with incomplete first row is rendered with padded cells", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| A |\n|---|\n|",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const frame1 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame1).toMatch(/[┌│└]/)
  expect(frame1).toContain("A")

  md.content = "| A |\n|---|\n| 1"
  await renderMarkdownRenderable(md)

  const frame2 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame2).toMatch(/[┌│└]/)
  expect(frame2).toContain("1")

  md.content = "| A |\n|---|\n| 1 |\n| 2 |"
  await renderMarkdownRenderable(md)

  const frame3 = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")

  expect(frame3).toMatch(/[┌│└]/)
  expect(frame3).toContain("1")
  expect(frame3).toContain("2")
})

test("streaming table transitions from raw text to table once first row appears", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| Header |",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  let frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toContain("| Header |")
  expect(frame).not.toMatch(/[┌│└]/)

  md.content = "| Header |\n|---|"
  await renderMarkdownRenderable(md)

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toContain("|---|")
  expect(frame).not.toMatch(/[┌│└]/)

  md.content = "| Header |\n|---|\n| D"
  await renderMarkdownRenderable(md)

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toMatch(/[┌│└]/)
  expect(frame).toContain("Header")
  expect(frame).toContain("D")
  expect(frame).not.toContain("|---|")
})

test("streaming table remains rendered when row count decreases", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "| A |\n|---|\n| 1 |\n| 2 |",
    syntaxStyle,
    streaming: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  let frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toMatch(/[┌│└]/)
  expect(frame).toContain("1")
  expect(frame).toContain("2")

  md.content = "| A |\n|---|\n| 1 |"
  await renderMarkdownRenderable(md)

  frame = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
  expect(frame).toMatch(/[┌│└]/)
  expect(frame).toContain("1")
  expect(frame).not.toContain("|---|")
})

test("conceal change updates rendered content", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "# Hello **bold**",
    syntaxStyle,
    conceal: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const frame1 = captureFrame()
  expect(frame1).not.toContain("**")
  expect(frame1).not.toContain("#")

  md.conceal = false
  renderer.requestRender()
  await renderMarkdownRenderable(md)

  const frame2 = captureFrame()
  expect(frame2).toContain("**")
  expect(frame2).toContain("#")
})

test("theme switching (syntaxStyle change)", async () => {
  const theme1 = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(1, 0, 0, 1) }, // Red
    "markup.heading.1": { fg: RGBA.fromValues(0, 1, 0, 1), bold: true }, // Green
  })

  const theme2 = SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromValues(0, 0, 1, 1) }, // Blue
    "markup.heading.1": { fg: RGBA.fromValues(1, 1, 0, 1), bold: true }, // Yellow
  })

  // Use the EXACT content from markdown-demo.ts to reproduce the issue
  const content = `# OpenTUI Markdown Demo

Welcome to the **MarkdownRenderable** showcase! This demonstrates automatic table alignment and syntax highlighting.

## Features

- Automatic **table column alignment** based on content width
- Proper handling of \`inline code\`, **bold**, and *italic* in tables
- Multiple syntax themes to choose from
- Conceal mode hides formatting markers

## Comparison Table

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Table alignment | **Done** | High | Uses \`marked\` parser |
| Conceal mode | *Working* | Medium | Hides \`**\`, \`\`\`, etc. |
| Theme switching | **Done** | Low | 3 themes available |
| Unicode support | 日本語 | High | CJK characters |

## Code Examples

Here's how to use it:

\`\`\`typescript
import { MarkdownRenderable } from "@opentui/core"

const md = createMarkdownRenderable({
  content: "# Hello World",
  syntaxStyle: mySyntaxStyle,
  conceal: true, // Hide formatting markers
})
\`\`\`

### API Reference

| Method | Parameters | Returns | Description |
|---|---|---|---|
| \`constructor\` | \`ctx, options\` | \`MarkdownRenderable\` | Create new instance |
| \`clearCache\` | none | \`void\` | Force re-render content |

## Inline Formatting Examples

| Style | Syntax | Rendered |
|---|---|---|
| Bold | \`**text**\` | **bold text** |
| Italic | \`*text*\` | *italic text* |
| Code | \`code\` | \`inline code\` |
| Link | \`[text](url)\` | [OpenTUI](https://github.com) |

## Mixed Content

> **Note**: This blockquote contains **bold** and \`code\` formatting.
> It should render correctly with proper styling.

### Emoji Support

| Emoji | Name | Category |
|---|---|---|
| 🚀 | Rocket | Transport |
| 🎨 | Palette | Art |
| ⚡ | Lightning | Nature |
| 🔥 | Fire | Nature |

---

## Alignment Examples

| Left | Center | Right |
|:---|:---:|---:|
| L1 | C1 | R1 |
| Left aligned | Centered text | Right aligned |
| Short | Medium length | Longer content here |

## Performance

The table alignment uses:
1. AST-based parsing with \`marked\`
2. Caching for repeated content
3. Smart width calculation accounting for concealed chars

---

*Press \`?\` for keybindings*
`

  const md = createMarkdownRenderable({
    id: "markdown",
    content,
    syntaxStyle: theme1,
    conceal: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const frame1 = captureSpans()
  const headingSpan1 = findSpanContaining(frame1, "OpenTUI Markdown Demo")
  expect(headingSpan1).toBeDefined()
  expect(headingSpan1!.fg.r).toBe(0)
  expect(headingSpan1!.fg.g).toBe(1)
  expect(headingSpan1!.fg.b).toBe(0)
  expect(headingSpan1!.attributes & TextAttributes.BOLD).toBeTruthy()

  // Switch theme
  md.syntaxStyle = theme2
  renderer.requestRender()
  await renderMarkdownRenderable(md)

  const frame2 = captureSpans()
  const headingSpan2 = findSpanContaining(frame2, "OpenTUI Markdown Demo")
  expect(headingSpan2).toBeDefined()
  expect(headingSpan2!.fg.r).toBe(1)
  expect(headingSpan2!.fg.g).toBe(1)
  expect(headingSpan2!.fg.b).toBe(0)
  expect(headingSpan2!.attributes & TextAttributes.BOLD).toBeTruthy()
})

// Paragraph rendering tests

test("paragraph links are rendered with markdown conceal behavior", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "Check [Google](https://google.com) out",
    syntaxStyle,
    conceal: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const paragraphChildren = md.getChildren()
  expect(paragraphChildren.length).toBe(1)
  expect(paragraphChildren[0]).toBeInstanceOf(CodeRenderable)
  expect(paragraphChildren[0]).not.toBeInstanceOf(TextRenderable)

  const frame = captureFrame()
  expect(frame).toContain("Google")
  expect(frame).toContain("https://google.com")
  expect(frame).not.toContain("[Google](https://google.com)")
})

test("paragraph initial render does not flash raw markdown markers", async () => {
  const recorder = new TestRecorder(renderer)
  recorder.rec()

  const md = createMarkdownRenderable({
    id: "markdown",
    content: "This has **bold** text.",
    syntaxStyle,
    conceal: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)
  recorder.stop()

  const paragraphChildren = md.getChildren()
  expect(paragraphChildren.length).toBe(1)
  expect(paragraphChildren[0]).toBeInstanceOf(CodeRenderable)
  expect(paragraphChildren[0]).not.toBeInstanceOf(TextRenderable)

  const rawMarkdownFrames = recorder.recordedFrames.filter((recorded) => recorded.frame.includes("**bold**"))
  expect(rawMarkdownFrames.length).toBe(0)

  const finalFrame = captureFrame()
  expect(finalFrame).toContain("This has bold text.")
})

test("paragraph updates do not flash raw markdown markers", async () => {
  const md = createMarkdownRenderable({
    id: "markdown",
    content: "**First** value",
    syntaxStyle,
    conceal: true,
  })

  renderer.root.add(md)
  await renderMarkdownRenderable(md)

  const paragraphChildrenBefore = md.getChildren()
  expect(paragraphChildrenBefore.length).toBe(1)
  expect(paragraphChildrenBefore[0]).toBeInstanceOf(CodeRenderable)
  expect(paragraphChildrenBefore[0]).not.toBeInstanceOf(TextRenderable)

  const recorder = new TestRecorder(renderer)
  recorder.rec()

  md.content = "**Second** value"
  await renderMarkdownRenderable(md)
  recorder.stop()

  const paragraphChildrenAfter = md.getChildren()
  expect(paragraphChildrenAfter.length).toBe(1)
  expect(paragraphChildrenAfter[0]).toBeInstanceOf(CodeRenderable)
  expect(paragraphChildrenAfter[0]).not.toBeInstanceOf(TextRenderable)

  const rawMarkdownFrames = recorder.recordedFrames.filter((recorded) => recorded.frame.includes("**Second**"))
  expect(rawMarkdownFrames.length).toBe(0)

  const finalFrame = captureFrame()
  expect(finalFrame).toContain("Second value")
  expect(finalFrame).not.toContain("**Second**")
})
