import { test, expect, beforeEach, afterEach } from "bun:test"
import { MarkdownRenderable } from "../Markdown"
import { SyntaxStyle } from "../../syntax-style"
import { RGBA } from "../../lib/RGBA"
import { createTestRenderer, type TestRenderer } from "../../testing"

let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})

beforeEach(async () => {
  const testRenderer = await createTestRenderer({ width: 60, height: 40 })
  renderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
})

afterEach(async () => {
  if (renderer) {
    renderer.destroy()
  }
})

async function renderMarkdown(markdown: string, conceal: boolean = true): Promise<string> {
  const md = new MarkdownRenderable(renderer, {
    id: "markdown",
    content: markdown,
    syntaxStyle,
    conceal,
  })

  renderer.root.add(md)
  await renderOnce()

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  return "\n" + lines.join("\n").trimEnd()
}

test("basic table alignment", async () => {
  const markdown = `| Name | Age |
|---|---|
| Alice | 30 |
| Bob | 5 |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───────┌─────┐
    │Name   │Age  │
    │───────│─────│
    │Alice  │30   │
    │───────│─────│
    │Bob    │5    │
    └───────└─────┘"
  `)
})

test("table with inline code (backticks)", async () => {
  const markdown = `| Command | Description |
|---|---|
| \`npm install\` | Install deps |
| \`npm run build\` | Build project |
| \`npm test\` | Run tests |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───────────────┌───────────────┐
    │Command        │Description    │
    │───────────────│───────────────│
    │npm install    │Install deps   │
    │───────────────│───────────────│
    │npm run build  │Build project  │
    │───────────────│───────────────│
    │npm test       │Run tests      │
    └───────────────└───────────────┘"
  `)
})

test("table with bold text", async () => {
  const markdown = `| Feature | Status |
|---|---|
| **Authentication** | Done |
| **API** | WIP |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌────────────────┌────────┐
    │Feature         │Status  │
    │────────────────│────────│
    │Authentication  │Done    │
    │────────────────│────────│
    │API             │WIP     │
    └────────────────└────────┘"
  `)
})

test("table with italic text", async () => {
  const markdown = `| Item | Note |
|---|---|
| One | *important* |
| Two | *ok* |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌──────┌───────────┐
    │Item  │Note       │
    │──────│───────────│
    │One   │important  │
    │──────│───────────│
    │Two   │ok         │
    └──────└───────────┘"
  `)
})

test("table with mixed formatting", async () => {
  const markdown = `| Type | Value | Notes |
|---|---|---|
| **Bold** | \`code\` | *italic* |
| Plain | **strong** | \`cmd\` |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───────┌────────┌────────┐
    │Type   │Value   │Notes   │
    │───────│────────│────────│
    │Bold   │code    │italic  │
    │───────│────────│────────│
    │Plain  │strong  │cmd     │
    └───────└────────└────────┘"
  `)
})

test("table with alignment markers (left, center, right)", async () => {
  const markdown = `| Left | Center | Right |
|:---|:---:|---:|
| A | B | C |
| Long text | X | Y |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───────────┌────────┌───────┐
    │Left       │Center  │Right  │
    │───────────│────────│───────│
    │A          │B       │C      │
    │───────────│────────│───────│
    │Long text  │X       │Y      │
    └───────────└────────└───────┘"
  `)
})

test("table with empty cells", async () => {
  const markdown = `| A | B |
|---|---|
| X |  |
|  | Y |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───┌───┐
    │A  │B  │
    │───│───│
    │X  │   │
    │───│───│
    │   │Y  │
    └───└───┘"
  `)
})

test("table with long header and short content", async () => {
  const markdown = `| Very Long Column Header | Short |
|---|---|
| A | B |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌─────────────────────────┌───────┐
    │Very Long Column Header  │Short  │
    │─────────────────────────│───────│
    │A                        │B      │
    └─────────────────────────└───────┘"
  `)
})

test("table with short header and long content", async () => {
  const markdown = `| X | Y |
|---|---|
| This is very long content | Short |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───────────────────────────┌───────┐
    │X                          │Y      │
    │───────────────────────────│───────│
    │This is very long content  │Short  │
    └───────────────────────────└───────┘"
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

    ┌──────┌───────────┐
    │Real  │Table      │
    │──────│───────────│
    │Is    │Formatted  │
    └──────└───────────┘"
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
    ┌────────┌───┐
    │Table1  │A  │
    │────────│───│
    │X       │Y  │
    └────────└───┘

    Some text between.

    ┌──────────────┌────┐
    │Table2        │BB  │
    │──────────────│────│
    │Long content  │Z   │
    └──────────────└────┘"
  `)
})

test("table with escaped pipe character", async () => {
  const markdown = `| Command | Output |
|---|---|
| echo | Hello |
| ls \\| grep | Filtered |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌───────────┌──────────┐
    │Command    │Output    │
    │───────────│──────────│
    │echo       │Hello     │
    │───────────│──────────│
    │ls | grep  │Filtered  │
    └───────────└──────────┘"
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
    ┌────────┌──────────┐
    │Emoji   │Name      │
    │────────│──────────│
    │🎉      │Party     │
    │────────│──────────│
    │🚀      │Rocket    │
    │────────│──────────│
    │日本語  │Japanese  │
    └────────└──────────┘"
  `)
})

test("table with links", async () => {
  const markdown = `| Name | Link |
|---|---|
| Google | [link](https://google.com) |
| GitHub | [gh](https://github.com) |`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    ┌────────┌───────────────────────────┐
    │Name    │Link                       │
    │────────│───────────────────────────│
    │Google  │link (https://google.com)  │
    │────────│───────────────────────────│
    │GitHub  │gh (https://github.com)    │
    └────────└───────────────────────────┘"
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
    ┌───┌───┌───┌───┌───┐
    │A  │B  │C  │D  │E  │
    │───│───│───│───│───│
    │1  │2  │3  │4  │5  │
    └───└───└───└───└───┘"
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
    ┌─────────────────────────────────┐
    │Description                      │
    │─────────────────────────────────│
    │This has bold and code together  │
    │─────────────────────────────────│
    │And italic with nested bold      │
    └─────────────────────────────────┘"
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
    ┌────────────────────┌────────┐
    │Feature             │Status  │
    │────────────────────│────────│
    │**Authentication**  │Done    │
    │────────────────────│────────│
    │**API**             │WIP     │
    └────────────────────└────────┘"
  `)
})

test("conceal=false: table with inline code", async () => {
  const markdown = `| Command | Description |
|---|---|
| \`npm install\` | Install deps |
| \`npm run build\` | Build project |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌─────────────────┌───────────────┐
    │Command          │Description    │
    │─────────────────│───────────────│
    │\`npm install\`    │Install deps   │
    │─────────────────│───────────────│
    │\`npm run build\`  │Build project  │
    └─────────────────└───────────────┘"
  `)
})

test("conceal=false: table with italic text", async () => {
  const markdown = `| Item | Note |
|---|---|
| One | *important* |
| Two | *ok* |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌──────┌─────────────┐
    │Item  │Note         │
    │──────│─────────────│
    │One   │*important*  │
    │──────│─────────────│
    │Two   │*ok*         │
    └──────└─────────────┘"
  `)
})

test("conceal=false: table with mixed formatting", async () => {
  const markdown = `| Type | Value | Notes |
|---|---|---|
| **Bold** | \`code\` | *italic* |
| Plain | **strong** | \`cmd\` |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌──────────┌────────────┌──────────┐
    │Type      │Value       │Notes     │
    │──────────│────────────│──────────│
    │**Bold**  │\`code\`      │*italic*  │
    │──────────│────────────│──────────│
    │Plain     │**strong**  │\`cmd\`     │
    └──────────└────────────└──────────┘"
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
    ┌────────┌──────────┐
    │Emoji   │Name      │
    │────────│──────────│
    │🎉      │Party     │
    │────────│──────────│
    │🚀      │Rocket    │
    │────────│──────────│
    │日本語  │Japanese  │
    └────────└──────────┘"
  `)
})

test("conceal=false: basic table alignment", async () => {
  const markdown = `| Name | Age |
|---|---|
| Alice | 30 |
| Bob | 5 |`

  expect(await renderMarkdown(markdown, false)).toMatchInlineSnapshot(`
    "
    ┌───────┌─────┐
    │Name   │Age  │
    │───────│─────│
    │Alice  │30   │
    │───────│─────│
    │Bob    │5    │
    └───────└─────┘"
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

    ┌───────┌─────┐
    │Name   │Age  │
    │───────│─────│
    │Alice  │30   │
    └───────└─────┘

    This is a paragraph after the table."
  `)
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

// Blockquote tests

test("simple blockquote", async () => {
  const markdown = `> This is a quote
> spanning multiple lines`

  expect(await renderMarkdown(markdown)).toMatchInlineSnapshot(`
    "
    > This is a quote
    spanning multiple lines"
  `)
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

    ---

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

    ---

    Press ? for help"
  `)
})

// Custom renderNode tests

test("custom renderNode can override heading rendering", async () => {
  const { TextRenderable } = await import("../Text")
  const { StyledText } = await import("../../lib/styled-text")

  const md = new MarkdownRenderable(renderer, {
    id: "custom-heading",
    content: `# Custom Heading

Regular paragraph.`,
    syntaxStyle,
    renderNode: (token, ctx) => {
      if (token.type === "heading") {
        return new TextRenderable(renderer, {
          id: "custom",
          content: new StyledText([{ __isChunk: true, text: `[CUSTOM] ${(token as any).text}`, attributes: 0 }]),
          width: "100%",
        })
      }
      return ctx.defaultRender()
    },
  })

  renderer.root.add(md)
  await renderOnce()

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
  const { BoxRenderable } = await import("../Box")
  const { TextRenderable } = await import("../Text")

  const md = new MarkdownRenderable(renderer, {
    id: "custom-code",
    content: `\`\`\`js
const x = 1;
\`\`\``,
    syntaxStyle,
    renderNode: (token, ctx) => {
      if (token.type === "code") {
        const box = new BoxRenderable(renderer, {
          id: "code-box",
          border: true,
          borderStyle: "single",
        })
        box.add(
          new TextRenderable(renderer, {
            id: "code-text",
            content: `CODE: ${(token as any).text}`,
          }),
        )
        return box
      }
      return ctx.defaultRender()
    },
  })

  renderer.root.add(md)
  await renderOnce()

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

test("custom renderNode returning null uses default", async () => {
  const md = new MarkdownRenderable(renderer, {
    id: "custom-null",
    content: `# Heading

Paragraph text.`,
    syntaxStyle,
    renderNode: () => null,
  })

  renderer.root.add(md)
  await renderOnce()

  const lines = captureFrame()
    .split("\n")
    .map((line) => line.trimEnd())
  expect("\n" + lines.join("\n").trimEnd()).toMatchInlineSnapshot(`
    "
    Heading

    Paragraph text."
  `)
})
