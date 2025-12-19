import { test, expect, beforeEach, afterEach } from "bun:test"
import { TreeSitterClient } from "./client"
import { CodeRenderable } from "../../renderables/Code"
import { SyntaxStyle } from "../../syntax-style"
import { RGBA } from "../RGBA"
import { createTestRenderer, type TestRenderer } from "../../testing"
import { tmpdir } from "os"
import { join } from "path"

let client: TreeSitterClient
let renderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
const dataPath = join(tmpdir(), "tree-sitter-table-test")

const syntaxStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromValues(1, 1, 1, 1) },
})

beforeEach(async () => {
  client = new TreeSitterClient({ dataPath })
  await client.initialize()

  const testRenderer = await createTestRenderer({ width: 60, height: 20 })
  renderer = testRenderer.renderer
  renderOnce = testRenderer.renderOnce
  captureFrame = testRenderer.captureCharFrame
})

afterEach(async () => {
  if (renderer) {
    renderer.destroy()
  }
  if (client) {
    await client.destroy()
  }
})

async function renderTable(markdown: string, conceal: boolean = true): Promise<string> {
  // Let CodeRenderable handle the transformation via its treeSitterClient
  const code = new CodeRenderable(renderer, {
    id: "table",
    content: markdown,
    filetype: "markdown",
    syntaxStyle,
    conceal,
    treeSitterClient: client,
  })

  renderer.root.add(code)
  await renderOnce()
  // Wait for async highlighting to complete
  await new Promise((resolve) => setTimeout(resolve, 100))
  await renderOnce()

  // Trim each line to remove terminal width padding
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

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Name  | Age |
    | ----- | --- |
    | Alice | 30  |
    | Bob   | 5   |"
  `)
})

test("table with inline code (backticks)", async () => {
  const markdown = `| Command | Description |
|---|---|
| \`npm install\` | Install deps |
| \`npm run build\` | Build project |
| \`npm test\` | Run tests |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Command       | Description   |
    | ------------- | ------------- |
    | npm install   | Install deps  |
    | npm run build | Build project |
    | npm test      | Run tests     |"
  `)
})

test("table with bold text", async () => {
  const markdown = `| Feature | Status |
|---|---|
| **Authentication** | Done |
| **API** | WIP |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Feature        | Status |
    | -------------- | ------ |
    | Authentication | Done   |
    | API            | WIP    |"
  `)
})

test("table with italic text", async () => {
  const markdown = `| Item | Note |
|---|---|
| One | *important* |
| Two | *ok* |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Item | Note      |
    | ---- | --------- |
    | One  | important |
    | Two  | ok        |"
  `)
})

test("table with mixed formatting", async () => {
  const markdown = `| Type | Value | Notes |
|---|---|---|
| **Bold** | \`code\` | *italic* |
| Plain | **strong** | \`cmd\` |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Type  | Value  | Notes  |
    | ----- | ------ | ------ |
    | Bold  | code   | italic |
    | Plain | strong | cmd    |"
  `)
})

test("table with alignment markers (left, center, right)", async () => {
  const markdown = `| Left | Center | Right |
|:---|:---:|---:|
| A | B | C |
| Long text | X | Y |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Left      | Center | Right |
    | :-------- | :----: | ----: |
    | A         | B      | C     |
    | Long text | X      | Y     |"
  `)
})

test("table with empty cells", async () => {
  const markdown = `| A | B |
|---|---|
| X |  |
|  | Y |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | A   | B   |
    | --- | --- |
    | X   |     |
    |     | Y   |"
  `)
})

test("table with long header and short content", async () => {
  const markdown = `| Very Long Column Header | Short |
|---|---|
| A | B |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Very Long Column Header | Short |
    | ----------------------- | ----- |
    | A                       | B     |"
  `)
})

test("table with short header and long content", async () => {
  const markdown = `| X | Y |
|---|---|
| This is very long content | Short |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | X                         | Y     |
    | ------------------------- | ----- |
    | This is very long content | Short |"
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

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Not | A | Table |
    |---|---|---|
    | Should | Stay | Raw |

    | Real | Table     |
    | ---- | --------- |
    | Is   | Formatted |"
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

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Table1 | A   |
    | ------ | --- |
    | X      | Y   |

    Some text between.

    | Table2       | BB  |
    | ------------ | --- |
    | Long content | Z   |"
  `)
})

test("table with escaped pipe character", async () => {
  const markdown = `| Command | Output |
|---|---|
| echo | Hello |
| ls \\| grep | Filtered |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Command    | Output   |
    | ---------- | -------- |
    | echo       | Hello    |
    | ls \\| grep | Filtered |"
  `)
})

test("table with unicode characters", async () => {
  const markdown = `| Emoji | Name |
|---|---|
| 🎉 | Party |
| 🚀 | Rocket |
| 日本語 | Japanese |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Emoji  | Name     |
    | ------ | -------- |
    | 🎉     | Party    |
    | 🚀     | Rocket   |
    | 日本語 | Japanese |"
  `)
})

test("table with links", async () => {
  const markdown = `| Name | Link |
|---|---|
| Google | [link](https://google.com) |
| GitHub | [gh](https://github.com) |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Name   | Link                     |
    | ------ | ------------------------ |
    | Google | link (https://google.com) |
    | GitHub | gh (https://github.com)   |"
  `)
})

test("single row table (header + delimiter only)", async () => {
  const markdown = `| Only | Header |
|---|---|`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Only | Header |
    |---|---|"
  `)
})

test("table with many columns", async () => {
  const markdown = `| A | B | C | D | E |
|---|---|---|---|---|
| 1 | 2 | 3 | 4 | 5 |`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | A   | B   | C   | D   | E   |
    | --- | --- | --- | --- | --- |
    | 1   | 2   | 3   | 4   | 5   |"
  `)
})

test("no tables returns original content", async () => {
  const markdown = `# Just a heading

Some paragraph text.

- List item`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
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

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    | Description                     |
    | ------------------------------- |
    | This has bold and code together |
    | And italic with nested bold     |"
  `)
})

// Tests with conceal=false - formatting markers should be visible and columns sized accordingly

test("conceal=false: table with bold text", async () => {
  const markdown = `| Feature | Status |
|---|---|
| **Authentication** | Done |
| **API** | WIP |`

  expect(await renderTable(markdown, false)).toMatchInlineSnapshot(`
    "
    | Feature            | Status |
    | ------------------ | ------ |
    | **Authentication** | Done   |
    | **API**            | WIP    |"
  `)
})

test("conceal=false: table with inline code", async () => {
  const markdown = `| Command | Description |
|---|---|
| \`npm install\` | Install deps |
| \`npm run build\` | Build project |`

  expect(await renderTable(markdown, false)).toMatchInlineSnapshot(`
    "
    | Command         | Description   |
    | --------------- | ------------- |
    | \`npm install\`   | Install deps  |
    | \`npm run build\` | Build project |"
  `)
})

test("conceal=false: table with italic text", async () => {
  const markdown = `| Item | Note |
|---|---|
| One | *important* |
| Two | *ok* |`

  expect(await renderTable(markdown, false)).toMatchInlineSnapshot(`
    "
    | Item | Note        |
    | ---- | ----------- |
    | One  | *important* |
    | Two  | *ok*        |"
  `)
})

test("conceal=false: table with mixed formatting", async () => {
  const markdown = `| Type | Value | Notes |
|---|---|---|
| **Bold** | \`code\` | *italic* |
| Plain | **strong** | \`cmd\` |`

  expect(await renderTable(markdown, false)).toMatchInlineSnapshot(`
    "
    | Type     | Value      | Notes    |
    | -------- | ---------- | -------- |
    | **Bold** | \`code\`     | *italic* |
    | Plain    | **strong** | \`cmd\`    |"
  `)
})

test("conceal=false: table with unicode characters", async () => {
  const markdown = `| Emoji | Name |
|---|---|
| 🎉 | Party |
| 🚀 | Rocket |
| 日本語 | Japanese |`

  expect(await renderTable(markdown, false)).toMatchInlineSnapshot(`
    "
    | Emoji  | Name     |
    | ------ | -------- |
    | 🎉     | Party    |
    | 🚀     | Rocket   |
    | 日本語 | Japanese |"
  `)
})

test("conceal=false: basic table alignment", async () => {
  const markdown = `| Name | Age |
|---|---|
| Alice | 30 |
| Bob | 5 |`

  expect(await renderTable(markdown, false)).toMatchInlineSnapshot(`
    "
    | Name  | Age |
    | ----- | --- |
    | Alice | 30  |
    | Bob   | 5   |"
  `)
})

test("table with paragraphs before and after", async () => {
  const markdown = `This is a paragraph before the table.

| Name | Age |
|---|---|
| Alice | 30 |

This is a paragraph after the table.`

  expect(await renderTable(markdown)).toMatchInlineSnapshot(`
    "
    This is a paragraph before the table.

    | Name  | Age |
    | ----- | --- |
    | Alice | 30  |

    This is a paragraph after the table."
  `)
})
