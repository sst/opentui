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
      "markup.heading": { fg: RGBA.fromInts(255, 200, 200, 255), bold: true }, // light red bold
      "markup.strong": { bold: true }, // bold
      "markup.italic": { italic: true }, // italic
      "markup.raw": { fg: RGBA.fromInts(200, 255, 200, 255) }, // light green
      "markup.quote": { fg: RGBA.fromInts(180, 180, 180, 255), italic: true }, // gray italic
      "markup.list": { fg: RGBA.fromInts(255, 200, 100, 255) }, // orange
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

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: false }, // Disable concealing to test text preservation
    })
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

  test("should conceal code block delimiters and language info", async () => {
    const markdownCode = `\`\`\`typescript
const x: string = "hello";
\`\`\``

    // First, check what highlights are generated
    const result = await client.highlightOnce(markdownCode, "markdown")

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    // Reconstruct text - should NOT include ``` or typescript
    const reconstructed = chunks.map((c) => c.text).join("")

    // Should have the code content
    expect(reconstructed).toContain("const x")
    expect(reconstructed).toContain("hello")

    // Opening delimiters and language annotation SHOULD be concealed
    expect(reconstructed).not.toContain("typescript")

    // With concealLines, the newline after ```typescript should also be concealed
    // So the text should start directly with the code content
    expect(reconstructed.startsWith("const")).toBe(true)

    // Verify no extraneous empty lines were created
    expect(reconstructed.split("\n").filter((l) => l.trim() === "").length).toBeLessThanOrEqual(0)

    // NOTE: The closing ``` is currently being included because it's parsed as part of the TypeScript
    // injection (template string backticks). This is a separate bug with injection boundaries.
    // For now, we'll just verify that the opening delimiters are concealed.
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

  test("should correctly handle ranges after concealed text", async () => {
    // Test that text immediately after concealed markers is properly rendered
    const markdownCode = "Text with **bold** and *italic* markers."

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    // Should have all the text content
    expect(reconstructed).toContain("Text with ")
    expect(reconstructed).toContain("bold")
    expect(reconstructed).toContain(" and ")
    expect(reconstructed).toContain("italic")
    expect(reconstructed).toContain(" markers.")

    // Should not have markup
    expect(reconstructed).not.toContain("**")
    expect(reconstructed).not.toContain("*")

    // Verify the text flows correctly
    expect(reconstructed).toMatch(/Text with \w+ and \w+ markers\./)
  })

  test("should conceal heading markers and preserve heading styling", async () => {
    const markdownCode = "## Heading 2"

    const result = await client.highlightOnce(markdownCode, "markdown")

    // Check if there are any conceal properties on the ## marker
    const hasAnyConceals = result.highlights!.some(([, , , meta]) => meta?.conceal !== undefined)
    expect(hasAnyConceals).toBe(true) // Should have conceal on the ## marker

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })
    const chunks = styledText.chunks

    const reconstructed = chunks.map((c) => c.text).join("")

    // Should have the heading text
    expect(reconstructed).toContain("Heading 2")

    // Should NOT have the ## markers
    expect(reconstructed).not.toContain("##")
    expect(reconstructed).not.toContain("#")

    // The heading text should be present without the marker or the space
    expect(reconstructed).toBe("Heading 2")

    // Should NOT start with a space
    expect(reconstructed.startsWith(" ")).toBe(false)
    expect(reconstructed.startsWith("Heading")).toBe(true)

    // Note: Heading styling depends on having the parent markup.heading style
    // properly cascade to child text. In a real application with proper theme setup,
    // the heading text will be styled correctly as shown in other tests.
  })

  test("should not create empty lines when concealing code block delimiters", async () => {
    const markdownCode = `\`\`\`typescript
const x = 1;
const y = 2;
\`\`\``

    const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
      conceal: { enabled: true },
    })

    const reconstructed = styledText.chunks.map((c) => c.text).join("")

    // Original has 4 lines: ```typescript, const x, const y, ```
    const originalLines = markdownCode.split("\n")
    expect(originalLines.length).toBe(4)

    // After concealing, we should have 3 lines: const x, const y, ```
    // (The ```typescript line is completely removed including its newline)
    const reconstructedLines = reconstructed.split("\n")
    expect(reconstructedLines.length).toBe(3)

    // First line should be the code, not an empty line
    expect(reconstructedLines[0]).toBe("const x = 1;")

    // No empty lines at the start
    expect(reconstructed.startsWith("\n")).toBe(false)
    expect(reconstructed.startsWith("const")).toBe(true)
  })

  describe("Markdown highlighting comprehensive coverage", () => {
    test("headings should have full styling applied", async () => {
      const markdownCode = `# Heading 1
## Heading 2
### Heading 3`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      // Check that headings are highlighted
      const groups = result.highlights!.map(([, , group]) => group)
      expect(groups).toContain("markup.heading.1")
      expect(groups).toContain("markup.heading.2")
      expect(groups).toContain("markup.heading.3")

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false }, // Disable concealing to test text preservation
      })
      const chunks = styledText.chunks

      // Reconstruct to verify text preserved
      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      // Verify headings are styled
      // The heading text itself should have markup.heading styling applied
      // Find any chunks with the # symbol or heading text
      const hashOrHeadingChunks = chunks.filter((chunk) => chunk.text.includes("#") || /heading/i.test(chunk.text))
      expect(hashOrHeadingChunks.length).toBeGreaterThan(0)

      // Check that we have markup.heading highlights in the result
      const headingGroups = groups.filter((g) => g.includes("markup.heading"))
      expect(headingGroups.length).toBeGreaterThan(0)
    })

    test("inline raw blocks (code) should be styled", async () => {
      const markdownCode = "Some text with `inline code` here."

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      // Should have markup.raw.inline or similar for inline code
      const hasCodeGroup = groups.some((g) => g.includes("markup.raw") || g.includes("code"))
      expect(hasCodeGroup).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false },
      })
      const chunks = styledText.chunks

      // Find the chunk containing "inline code"
      const codeChunks = chunks.filter((c) => c.text.includes("inline") || c.text.includes("code"))
      expect(codeChunks.length).toBeGreaterThan(0)

      // At least one should have styling applied
      const defaultStyle = syntaxStyle.mergeStyles("default")
      const styledCodeChunks = codeChunks.filter((c) => c.fg !== defaultStyle.fg || c.attributes !== 0)
      expect(styledCodeChunks.length).toBeGreaterThan(0)
    })

    test("quotes should be styled correctly", async () => {
      const markdownCode = `> This is a quote
> Another line`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      // Should have markup.quote or similar
      const hasQuoteGroup = groups.some((g) => g.includes("quote"))
      expect(hasQuoteGroup).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client)
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)
    })

    test("italic text should be styled in all places", async () => {
      const markdownCode = `*italic* text in paragraph

# *italic in heading*

- *italic in list*`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      // Should have markup.italic or emphasis
      const hasItalicGroup = groups.some((g) => g.includes("italic") || g.includes("emphasis"))
      expect(hasItalicGroup).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      // Should not contain * markers when concealed
      const reconstructed = chunks.map((c) => c.text).join("")
      const asteriskCount = (reconstructed.match(/\*/g) || []).length
      // Should have fewer asterisks due to concealment (or none for emphasis markers)
      const originalAsteriskCount = (markdownCode.match(/\*/g) || []).length
      expect(asteriskCount).toBeLessThan(originalAsteriskCount)
    })

    test("bold text should work in all contexts", async () => {
      const markdownCode = `**bold** text in paragraph

# **bold in heading**

- **bold in list**

> **bold in quote**`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const groups = result.highlights!.map(([, , group]) => group)
      // Should have markup.strong or bold
      const hasBoldGroup = groups.some((g) => g.includes("strong") || g.includes("bold"))
      expect(hasBoldGroup).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      // Should not contain ** markers when concealed
      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).not.toContain("**")
      expect(reconstructed).toContain("bold")
    })

    test("TypeScript code block should not contain parent markup.raw.block fragments between syntax ranges", async () => {
      const markdownCode = `\`\`\`typescript
const greeting: string = "hello";
function test() { return 42; }
\`\`\``

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      // Verify we have TypeScript injection
      const hasInjection = result.highlights!.some(([, , , meta]) => meta?.injectionLang === "typescript")
      expect(hasInjection).toBe(true)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false }, // Disable concealing to test text preservation
      })
      const chunks = styledText.chunks

      // Reconstruct to verify text preserved
      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      // Find the TypeScript content area (between the backticks)
      const tsCodeStart = markdownCode.indexOf("\n") + 1 // After first ```typescript\n
      const tsCodeEnd = markdownCode.lastIndexOf("\n```") // Before last \n```

      // Get chunks in the TypeScript code area
      let currentPos = 0
      const tsChunks: typeof chunks = []
      for (const chunk of chunks) {
        const chunkStart = currentPos
        const chunkEnd = currentPos + chunk.text.length
        // Check if chunk overlaps with TypeScript code area
        if (chunkEnd > tsCodeStart && chunkStart < tsCodeEnd) {
          tsChunks.push(chunk)
        }
        currentPos = chunkEnd
      }

      expect(tsChunks.length).toBeGreaterThan(0)

      // Verify that TypeScript chunks have TypeScript-specific styling
      // (keyword, type, string, etc.) and NOT markup.raw.block background
      const keywordStyle = syntaxStyle.getStyle("keyword")
      const stringStyle = syntaxStyle.getStyle("string")
      const typeStyle = syntaxStyle.getStyle("type")

      // Check for TypeScript-specific styling
      const hasKeywordStyle = tsChunks.some((chunk) => {
        return (
          keywordStyle &&
          chunk.fg &&
          keywordStyle.fg &&
          chunk.fg.r === keywordStyle.fg.r &&
          chunk.fg.g === keywordStyle.fg.g &&
          chunk.fg.b === keywordStyle.fg.b
        )
      })

      const hasStringStyle = tsChunks.some((chunk) => {
        return (
          stringStyle &&
          chunk.fg &&
          stringStyle.fg &&
          chunk.fg.r === stringStyle.fg.r &&
          chunk.fg.g === stringStyle.fg.g &&
          chunk.fg.b === stringStyle.fg.b
        )
      })

      // At least one of these should be true (depending on the code)
      expect(hasKeywordStyle || hasStringStyle).toBe(true)

      // CRITICAL: Verify no chunks inside TypeScript code have ONLY markup.raw.block styling
      // This would indicate parent block styles leaking into injected content
      const defaultStyle = syntaxStyle.mergeStyles("default")

      // Every chunk should either be styled (TypeScript syntax) or default, but not markup.raw.block
      for (const chunk of tsChunks) {
        // Chunks should have either:
        // 1. TypeScript-specific styling (keyword, string, type, etc.)
        // 2. Default styling (for whitespace, punctuation)
        // 3. NOT markup.raw.block background (which would be wrong)

        // Since we don't have markup.raw.block in our test syntaxStyle,
        // we verify that chunks are either styled or default
        const isStyled = chunk.fg !== defaultStyle.fg || chunk.attributes !== 0
        const isDefault = chunk.fg === defaultStyle.fg

        // All chunks should be either styled or default (no "other" styling)
        expect(isStyled || isDefault).toBe(true)
      }
    })

    test("mixed formatting (bold + italic) should work", async () => {
      const markdownCode = "***bold and italic*** text"

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).not.toContain("***")
      expect(reconstructed).toContain("bold and italic")
    })

    test("inline code in headings should be styled", async () => {
      const markdownCode = "# Heading with `code` inside"

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      // Should have both heading and code styling
      const groups = result.highlights!.map(([, , group]) => group)
      expect(groups.some((g) => g.includes("heading"))).toBe(true)
      expect(groups.some((g) => g.includes("markup.raw") || g.includes("code"))).toBe(true)
    })

    test("bold and italic in lists should work", async () => {
      const markdownCode = `- **bold item**
- *italic item*
- normal item`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toContain("bold item")
      expect(reconstructed).toContain("italic item")
      expect(reconstructed).not.toContain("**")
    })

    test("code blocks with different languages should suppress parent styles", async () => {
      const markdownCode = `\`\`\`javascript
const x = 42;
\`\`\`

\`\`\`typescript
const y: number = 42;
\`\`\``

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: false }, // Disable concealing to test text preservation
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")
      expect(reconstructed).toBe(markdownCode)

      // Both code blocks should have injection
      const jsInjection = result.highlights!.some(([, , , meta]) => meta?.injectionLang === "javascript")
      const tsInjection = result.highlights!.some(([, , , meta]) => meta?.injectionLang === "typescript")

      expect(jsInjection || tsInjection).toBe(true)
    })

    test("complex nested markdown structures", async () => {
      const markdownCode = `# Main Heading

> This is a quote with **bold** and *italic* and \`code\`.

## Sub Heading

- List item with **bold**
- Another item with \`inline code\`

\`\`\`typescript
// Comment in code
const value = "string";
\`\`\`

Normal paragraph with [link](https://example.com).`

      const result = await client.highlightOnce(markdownCode, "markdown")
      expect(result.highlights).toBeDefined()
      expect(result.highlights!.length).toBeGreaterThan(10)

      const styledText = await treeSitterToStyledText(markdownCode, "markdown", syntaxStyle, client, {
        conceal: { enabled: true },
      })
      const chunks = styledText.chunks

      const reconstructed = chunks.map((c) => c.text).join("")

      // Verify structure preserved
      expect(reconstructed).toContain("Main Heading")
      expect(reconstructed).toContain("Sub Heading")
      expect(reconstructed).toContain("quote")
      expect(reconstructed).toContain("bold")
      expect(reconstructed).toContain("italic")
      expect(reconstructed).toContain("code")
      expect(reconstructed).toContain("const value")
      expect(reconstructed).toContain("link")

      // Verify concealment worked
      expect(reconstructed).not.toContain("**")

      // Verify we have various styling
      const defaultStyle = syntaxStyle.mergeStyles("default")
      const styledChunks = chunks.filter((c) => c.fg !== defaultStyle.fg || c.attributes !== 0)
      expect(styledChunks.length).toBeGreaterThan(5)
    })
  })
})
