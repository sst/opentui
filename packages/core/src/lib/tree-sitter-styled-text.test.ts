import { test, expect, beforeAll, afterAll, describe } from "bun:test"
import { TreeSitterClient } from "./tree-sitter/client"
import { treeSitterToStyledText } from "./tree-sitter-styled-text"
import { SyntaxStyle } from "./syntax-style"
import { RGBA } from "./RGBA"
import { tmpdir } from "os"
import { join } from "path"
import { mkdir } from "fs/promises"

describe("TreeSitter Styled Text", () => {
  let client: TreeSitterClient
  let syntaxStyle: SyntaxStyle
  const dataPath = join(tmpdir(), "tree-sitter-styled-text-test")

  beforeAll(async () => {
    await mkdir(dataPath, { recursive: true })
    client = new TreeSitterClient({ dataPath })
    await client.initialize()

    // Create a syntax style similar to common themes
    syntaxStyle = new SyntaxStyle({
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
})
