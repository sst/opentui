import { test, expect, describe } from "bun:test"
import { detectLinks } from "./detect-links.js"
import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"
import type { TreeSitterClient } from "./tree-sitter/client.js"
import { afterEach, beforeEach } from "node:test"
import { getTreeSitterClient, treeSitterToTextChunks } from "./tree-sitter/index.js"
import { destroySingleton } from "./singleton.js"
import { SyntaxStyle } from "../syntax-style.js"

let treeSitterClient: TreeSitterClient

beforeEach(async () => {
  treeSitterClient = getTreeSitterClient()
})

afterEach(async () => {
  getTreeSitterClient().destroy()
  destroySingleton("tree-sitter-client")
})

const parse = async (
  content: string,
  filetype: string,
): Promise<{ highlights: SimpleHighlight[]; chunks: TextChunk[] }> => {
  const syntaxStyle = SyntaxStyle.create()

  const { highlights } = await treeSitterClient.highlightOnce(content, filetype)
  if (!highlights) throw new Error("Failed to get highlights from TreeSitterClient")

  const chunks = treeSitterToTextChunks(content, highlights, syntaxStyle, { enabled: true })

  return { highlights, chunks }
}

describe("detectLinks", () => {
  test("should set link on markup.link.url chunks", async () => {
    const content = "[Click here](https://example.com)"
    const { highlights, chunks } = await parse(content, "markdown")

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "https://example.com")?.link).toEqual({ url: "https://example.com" })
    expect(result.find((c) => c.text === "Click here")?.link).toEqual({ url: "https://example.com" })
  })

  test("should set link on string.special.url chunks", async () => {
    const content = "// see https://example.com for details"
    const { highlights, chunks } = await parse(content, "typescript")

    console.log(highlights, chunks)

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "https://example.com")?.link).toEqual({ url: "https://example.com" })
  })

  test("should not set link on non-URL chunks", async () => {
    const content = "const x = 42"
    const { highlights, chunks } = await parse(content, "markdown")

    const result = detectLinks(chunks, { content, highlights })

    for (const c of result) {
      expect(c.link).toBeUndefined()
    }
  })

  test("should return chunks unchanged when no URL scopes exist", async () => {
    const content = "hello world"
    const { highlights, chunks } = await parse(content, "markdown")

    const result = detectLinks(chunks, { content, highlights })

    expect(result).toBe(chunks)
  })

  test("should detect links when chunks have concealed text", async () => {
    // Original content: [Click here](https://example.com)
    // With concealment, `[` and `]` are concealed to empty strings,
    // and `(` and `)` are concealed to empty strings.
    // This means chunk text lengths don't match original byte offsets.
    const content = "[Click here](https://example.com)"
    const { highlights, chunks } = await parse(content, "markdown")

    const result = detectLinks(chunks, { content, highlights })

    // The URL chunk should still get its link despite concealed offsets
    expect(result.find((c) => c.text === "https://example.com")?.link).toEqual({ url: "https://example.com" })
    // The label chunk should also get the link
    expect(result.find((c) => c.text === "Click here")?.link).toEqual({ url: "https://example.com" })
  })
})
