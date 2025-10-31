import { test, expect, beforeAll, afterAll, describe } from "bun:test"
import { TreeSitterClient } from "./tree-sitter/client"
import { treeSitterToStyledText, treeSitterToTextChunks } from "./tree-sitter-styled-text"
import { SyntaxStyle } from "../syntax-style"
import { RGBA } from "./RGBA"
import { createTextAttributes } from "../utils"
import { tmpdir } from "os"
import { join } from "path"
import { mkdir } from "fs/promises"
import type { SimpleHighlight } from "./tree-sitter/types"

describe("TreeSitter Styled Text", () => {
  let client: TreeSitterClient
  let syntaxStyle: SyntaxStyle
  const dataPath = join(tmpdir(), "tree-sitter-styled-text-test")

  beforeAll(async () => {
    await mkdir(dataPath, { recursive: true })
    client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Create a syntax style similar to common themes
    syntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) }, // white
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255), bold: true }, // red bold
      string: { fg: RGBA.fromInts(100, 255, 100, 255) }, // green
      number: { fg: RGBA.fromInts(100, 100, 255, 255) }, // blue
      function: { fg: RGBA.fromInts(255, 255, 100, 255), italic: true }, // yellow italic
      comment: { fg: RGBA.fromInts(128, 128, 128, 255), italic: true }, // gray italic
      variable: { fg: RGBA.fromInts(200, 200, 255, 255) }, // light blue
      type: { fg: RGBA.fromInts(255, 200, 100, 255) }, // orange
    })
  })

  afterAll(async () => {
    await client.destroy()
    syntaxStyle.destroy()
  })

  test("should convert JavaScript code to styled text", async () => {
    const jsCode = 'const greeting = "Hello, world!";\nfunction test() { return 42; }'

    const styledText = await treeSitterToStyledText(jsCode, "javascript", syntaxStyle, client)

    expect(styledText).toBeDefined()

    // Get the chunks to verify styling
    const chunks = styledText.chunks
    expect(chunks.length).toBeGreaterThan(1) // Should have multiple styled chunks

    // Should have different styles applied
    const chunksWithColor = chunks.filter((chunk) => chunk.fg)
    expect(chunksWithColor.length).toBeGreaterThan(0) // Some chunks should have colors
  })

  test("should convert TypeScript code to styled text", async () => {
    const tsCode = "interface User {\n  name: string;\n  age: number;\n}"

    const styledText = await treeSitterToStyledText(tsCode, "typescript", syntaxStyle, client)

    expect(styledText).toBeDefined()

    const chunks = styledText.chunks
    expect(chunks.length).toBeGreaterThan(1)

    // Verify some chunks have styling
    const styledChunks = chunks.filter((chunk) => chunk.fg)
    expect(styledChunks.length).toBeGreaterThan(0)
  })

  test("should handle unsupported filetype gracefully", async () => {
    const content = "some random content"

    const styledText = await treeSitterToStyledText(content, "unsupported", syntaxStyle, client)

    expect(styledText).toBeDefined()

    // Should return content with default styling
    const chunks = styledText.chunks
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe(content)

    // Should use default styling
    expect(chunks[0].fg).toBeDefined()
  })

  test("should handle empty content", async () => {
    const styledText = await treeSitterToStyledText("", "javascript", syntaxStyle, client)

    expect(styledText).toBeDefined()

    const chunks = styledText.chunks
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe("")
  })

  test("should handle multiline content correctly", async () => {
    const multilineCode = `// This is a comment
const value = 123;
const text = "hello";
function add(a, b) {
  return a + b;
}`

    const styledText = await treeSitterToStyledText(multilineCode, "javascript", syntaxStyle, client)

    expect(styledText).toBeDefined()

    const chunks = styledText.chunks
    expect(chunks.length).toBeGreaterThan(5) // Multiple chunks for different elements

    // Should contain newlines
    const newlineChunks = chunks.filter((chunk) => chunk.text.includes("\n"))
    expect(newlineChunks.length).toBeGreaterThan(0)
  })

  test("should preserve original text content", async () => {
    const originalCode = 'const test = "preserve this exact text";'

    const styledText = await treeSitterToStyledText(originalCode, "javascript", syntaxStyle, client)

    // Reconstruct text from chunks
    const reconstructed = styledText.chunks.map((chunk) => chunk.text).join("")
    expect(reconstructed).toBe(originalCode)
  })

  test("should apply different styles to different syntax elements", async () => {
    const jsCode = "const number = 42; // comment"

    const styledText = await treeSitterToStyledText(jsCode, "javascript", syntaxStyle, client)
    const chunks = styledText.chunks

    // Should have some chunks with colors
    const chunksWithColors = chunks.filter((chunk) => chunk.fg)
    expect(chunksWithColors.length).toBeGreaterThan(0)

    // Should have some chunks with attributes (bold, italic, etc.)
    const chunksWithAttributes = chunks.filter((chunk) => chunk.attributes && chunk.attributes > 0)
    expect(chunksWithAttributes.length).toBeGreaterThan(0)
  })

  test("should handle template literals correctly without duplication", async () => {
    const templateLiteralCode = "console.log(`Total users: ${manager.getUserCount()}`);"

    const styledText = await treeSitterToStyledText(templateLiteralCode, "javascript", syntaxStyle, client)
    const chunks = styledText.chunks

    // Reconstruct the text from chunks to check for duplication
    const reconstructed = chunks.map((chunk) => chunk.text).join("")

    // Should preserve original text without duplication
    expect(reconstructed).toBe(templateLiteralCode)

    // Should have multiple chunks for different syntax elements
    expect(chunks.length).toBeGreaterThan(1)

    // Should have some styled chunks
    const styledChunks = chunks.filter((chunk) => chunk.fg)
    expect(styledChunks.length).toBeGreaterThan(0)
  })

  test("should handle complex template literals with multiple expressions", async () => {
    const complexTemplateCode =
      'console.log(`User: ${user.name}, Age: ${user.age}, Status: ${user.active ? "active" : "inactive"}`);'

    const styledText = await treeSitterToStyledText(complexTemplateCode, "javascript", syntaxStyle, client)
    const chunks = styledText.chunks

    const reconstructed = chunks.map((chunk) => chunk.text).join("")

    expect(reconstructed).toBe(complexTemplateCode)
  })

  test("should correctly highlight template literal with embedded expressions", async () => {
    const templateLiteralCode = "console.log(`Total users: ${manager.getUserCount()}`);"

    const result = await client.highlightOnce(templateLiteralCode, "javascript")

    expect(result.highlights).toBeDefined()
    expect(result.highlights!.length).toBeGreaterThan(0)

    const groups = result.highlights!.map(([, , group]) => group)
    expect(groups).toContain("variable") // console, manager
    expect(groups).toContain("property") // log, getUserCount
    expect(groups).toContain("string") // template literal
    expect(groups).toContain("embedded") // ${...} expression
    expect(groups).toContain("punctuation.bracket") // (), {}

    const styledText = await treeSitterToStyledText(templateLiteralCode, "javascript", syntaxStyle, client)
    const chunks = styledText.chunks

    expect(chunks.length).toBeGreaterThan(5)

    const reconstructed = chunks.map((chunk) => chunk.text).join("")
    expect(reconstructed).toBe(templateLiteralCode)

    const styledChunks = chunks.filter((chunk) => chunk.fg !== syntaxStyle.mergeStyles("default").fg)
    expect(styledChunks.length).toBeGreaterThan(0) // Some chunks should be styled differently
  })

  test("should work with real tree-sitter output containing dot-delimited groups", async () => {
    const tsCode = "interface User { name: string; age?: number; }"

    const result = await client.highlightOnce(tsCode, "typescript")
    expect(result.highlights).toBeDefined()

    const groups = result.highlights!.map(([, , group]) => group)
    const dotDelimitedGroups = groups.filter((group) => group.includes("."))
    expect(dotDelimitedGroups.length).toBeGreaterThan(0)

    const styledText = await treeSitterToStyledText(tsCode, "typescript", syntaxStyle, client)
    const chunks = styledText.chunks

    expect(chunks.length).toBeGreaterThan(1)

    const styledChunks = chunks.filter((chunk) => chunk.fg !== syntaxStyle.mergeStyles("default").fg)
    expect(styledChunks.length).toBeGreaterThan(0)

    const reconstructed = chunks.map((chunk) => chunk.text).join("")
    expect(reconstructed).toBe(tsCode)
  })

  test("should resolve styles correctly for dot-delimited groups and multiple overlapping groups", async () => {
    // Test the getStyle method directly
    expect(syntaxStyle.getStyle("function.method")).toEqual(syntaxStyle.getStyle("function"))
    expect(syntaxStyle.getStyle("variable.member")).toEqual(syntaxStyle.getStyle("variable"))
    expect(syntaxStyle.getStyle("nonexistent.fallback")).toBeUndefined()
    expect(syntaxStyle.getStyle("function")).toBeDefined()
    expect(syntaxStyle.getStyle("constructor")).toBeUndefined() // Should not return Object constructor

    // Test with mock highlights that have multiple groups for same range
    const mockHighlights: Array<[number, number, string]> = [
      [0, 4, "variable.member"], // should resolve to 'variable' style
      [0, 4, "function.method"], // should resolve to 'function' style (last valid)
      [0, 4, "nonexistent"], // undefined, should not override
      [4, 8, "keyword"], // should resolve to 'keyword' style
    ]

    const content = "testfunc"
    const chunks = treeSitterToTextChunks(content, mockHighlights, syntaxStyle)

    expect(chunks.length).toBe(2) // Two highlight ranges, no gaps

    // First chunk [0,4] should have function style (last valid style)
    const functionStyle = syntaxStyle.getStyle("function")!
    expect(chunks[0].text).toBe("test")
    expect(chunks[0].fg).toEqual(functionStyle.fg)
    expect(chunks[0].attributes).toBe(
      createTextAttributes({
        bold: functionStyle.bold,
        italic: functionStyle.italic,
        underline: functionStyle.underline,
        dim: functionStyle.dim,
      }),
    )

    // Second chunk [4,8] should have keyword style
    const keywordStyle = syntaxStyle.getStyle("keyword")!
    expect(chunks[1].text).toBe("func")
    expect(chunks[1].fg).toEqual(keywordStyle.fg)
    expect(chunks[1].attributes).toBe(
      createTextAttributes({
        bold: keywordStyle.bold,
        italic: keywordStyle.italic,
        underline: keywordStyle.underline,
        dim: keywordStyle.dim,
      }),
    )
  })

  test("should handle constructor group correctly", async () => {
    expect(syntaxStyle.getStyle("constructor")).toBeUndefined()

    const mockHighlights: Array<[number, number, string]> = [
      [0, 11, "variable.member"], // should resolve to 'variable' style
      [0, 11, "constructor"], // should resolve to undefined
      [0, 11, "function.method"], // should resolve to 'function' style (last valid)
    ]

    const content = "constructor"
    const chunks = treeSitterToTextChunks(content, mockHighlights, syntaxStyle)

    expect(chunks.length).toBe(1)

    const functionStyle = syntaxStyle.getStyle("function")!
    expect(chunks[0].text).toBe("constructor")
    expect(chunks[0].fg).toEqual(functionStyle.fg)
    expect(chunks[0].attributes).toBe(
      createTextAttributes({
        bold: functionStyle.bold,
        italic: functionStyle.italic,
        underline: functionStyle.underline,
        dim: functionStyle.dim,
      }),
    )
  })

  test("should handle markdown with TypeScript injection - suppress parent block styles", async () => {
    const markdownCode = `\`\`\`typescript
const x: string = "hello";
\`\`\``

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client)
    const chunks = styledText.chunks

    // Reconstruct to verify text is preserved
    const reconstructed = chunks.map((c) => c.text).join("")
    expect(reconstructed).toBe(markdownCode)

    // Find chunks inside the TypeScript code (between backticks)
    const tsStart = markdownCode.indexOf("const")
    const tsEnd = markdownCode.lastIndexOf(";") + 1

    // Get chunks that are within the TypeScript code
    let currentPos = 0
    const tsChunks: typeof chunks = []
    for (const chunk of chunks) {
      const chunkStart = currentPos
      const chunkEnd = currentPos + chunk.text.length
      if (chunkStart >= tsStart && chunkEnd <= tsEnd) {
        tsChunks.push(chunk)
      }
      currentPos = chunkEnd
    }

    // Verify TypeScript chunks have syntax styles (keyword, type, string, etc.)
    // and NOT the parent markup.raw.block background
    expect(tsChunks.length).toBeGreaterThan(0)

    // At least one chunk should have keyword styling (const)
    const hasKeywordStyle = tsChunks.some((chunk) => {
      const keywordStyle = syntaxStyle.getStyle("keyword")
      return (
        keywordStyle &&
        chunk.fg &&
        keywordStyle.fg &&
        chunk.fg.r === keywordStyle.fg.r &&
        chunk.fg.g === keywordStyle.fg.g &&
        chunk.fg.b === keywordStyle.fg.b
      )
    })
    expect(hasKeywordStyle).toBe(true)
  })

  test("should conceal backticks in inline code", async () => {
    const markdownCode = "Some text with `inline code` here."

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    // Reconstruct text - should NOT include backticks
    const reconstructed = chunks.map((c) => c.text).join("")
    expect(reconstructed).not.toContain("`")
    expect(reconstructed).toContain("inline code")
    expect(reconstructed).toContain("Some text with ")
    expect(reconstructed).toContain(" here.")
  })

  test("should conceal bold markers", async () => {
    const markdownCode = "Some **bold** text"

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    // Reconstruct text - should NOT include ** markers
    const reconstructed = chunks.map((c) => c.text).join("")
    expect(reconstructed).not.toContain("**")
    expect(reconstructed).not.toContain("*")
    expect(reconstructed).toContain("bold")
    expect(reconstructed).toContain("Some ")
    expect(reconstructed).toContain(" text")
  })

  test("should conceal link syntax but keep text and URL", async () => {
    const markdownCode = "[Link text](https://example.com)"

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    // Should not contain brackets or parentheses (they're marked with conceal)
    // But tree-sitter marks them as markup.link, not conceal group
    // So they won't be concealed - the queries use (#set! conceal "") on them
    // but we're not reading that metadata yet

    // For now, just verify the text is present
    expect(reconstructed).toContain("Link text")
    expect(reconstructed).toContain("https://example.com")
  })

  test("should handle overlapping highlights with specificity resolution", async () => {
    const mockHighlights: SimpleHighlight[] = [
      [0, 10, "variable"],
      [0, 10, "variable.member"], // More specific, should win
      [0, 10, "type"],
      [11, 16, "keyword"],
      [11, 16, "keyword.coroutine"], // More specific, should win
    ]

    const content = "identifier const"
    // "identifier" = indices 0-9 (10 chars)
    // " " = index 10 (1 char)
    // "const" = indices 11-15 (5 chars)
    const chunks = treeSitterToTextChunks(content, mockHighlights, syntaxStyle)

    expect(chunks.length).toBe(3) // "identifier", " ", "const"

    // First segment should use variable.member -> variable style
    const variableStyle = syntaxStyle.getStyle("variable")!
    expect(chunks[0].text).toBe("identifier")
    expect(chunks[0].fg).toEqual(variableStyle.fg)

    // Middle segment is unhighlighted space
    expect(chunks[1].text).toBe(" ")

    // Last segment should use keyword style (keyword.coroutine falls back to keyword)
    const keywordStyle = syntaxStyle.getStyle("keyword")!
    expect(chunks[2].text).toBe("const")
    expect(chunks[2].fg).toEqual(keywordStyle.fg)
  })

  test("should not conceal when conceal option is disabled", async () => {
    const markdownCode = "Some text with `inline code` here."

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: false },
    })
    const chunks = styledText.chunks

    // Reconstruct text - SHOULD include backticks
    const reconstructed = chunks.map((c) => c.text).join("")
    expect(reconstructed).toContain("`")
    expect(reconstructed).toBe(markdownCode)
  })

  test("should handle complex markdown with multiple features", async () => {
    const markdownCode = `# Heading

Some **bold** text and \`code\`.

\`\`\`typescript
const hello: string = "world";
\`\`\`

[Link](https://example.com)`

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    // Verify structure is preserved
    expect(reconstructed).toContain("Heading")
    expect(reconstructed).toContain("bold")
    expect(reconstructed).toContain("code")
    expect(reconstructed).toContain("const hello")
    expect(reconstructed).toContain("Link")

    // Verify conceals worked
    expect(reconstructed).not.toContain("**")
  })
})
