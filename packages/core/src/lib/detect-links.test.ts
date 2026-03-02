import { test, expect, describe } from "bun:test"
import { detectLinks } from "./detect-links"
import type { TextChunk } from "../text-buffer"
import type { SimpleHighlight } from "./tree-sitter/types"
import { RGBA } from "./RGBA"

function chunk(text: string): TextChunk {
  return { __isChunk: true, text, fg: RGBA.fromInts(255, 255, 255, 255), attributes: 0 }
}

describe("detectLinks", () => {
  test("should set link on markup.link.url chunks", () => {
    const content = "[Click here](https://example.com)"
    const highlights: SimpleHighlight[] = [
      [0, 1, "markup.link"],
      [1, 11, "markup.link.label"],
      [11, 13, "markup.link"],
      [13, 32, "markup.link.url"],
      [32, 33, "markup.link"],
    ]
    const chunks = [chunk("["), chunk("Click here"), chunk("]("), chunk("https://example.com"), chunk(")")]

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "https://example.com")!.link).toEqual({ url: "https://example.com" })
    expect(result.find((c) => c.text === "Click here")!.link).toEqual({ url: "https://example.com" })
  })

  test("should set link on string.special.url chunks", () => {
    const content = "// see https://example.com for details"
    const highlights: SimpleHighlight[] = [
      [0, 38, "comment"],
      [7, 26, "string.special.url"],
    ]
    const chunks = [chunk("// see "), chunk("https://example.com"), chunk(" for details")]

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "https://example.com")!.link).toEqual({ url: "https://example.com" })
  })

  test("should not set link on non-URL chunks", () => {
    const content = "const x = 42"
    const highlights: SimpleHighlight[] = [
      [0, 5, "keyword"],
      [6, 7, "variable"],
      [10, 12, "number"],
    ]
    const chunks = [chunk("const"), chunk(" "), chunk("x"), chunk(" = "), chunk("42")]

    const result = detectLinks(chunks, { content, highlights })

    for (const c of result) {
      expect(c.link).toBeUndefined()
    }
  })

  test("should return chunks unchanged when no URL scopes exist", () => {
    const content = "hello world"
    const highlights: SimpleHighlight[] = [[0, 5, "keyword"]]
    const chunks = [chunk("hello"), chunk(" world")]

    const result = detectLinks(chunks, { content, highlights })

    expect(result).toBe(chunks)
  })

  test("should detect links when chunks have concealed text", () => {
    // Original content: [Click here](https://example.com)
    // With concealment, `[` and `]` are concealed to empty strings,
    // and `(` and `)` are concealed to empty strings.
    // This means chunk text lengths don't match original byte offsets.
    const content = "[Click here](https://example.com)"
    const highlights: SimpleHighlight[] = [
      [0, 1, "markup.link"], // [
      [1, 11, "markup.link.label"], // Click here
      [11, 13, "markup.link"], // ](
      [13, 32, "markup.link.url"], // https://example.com
      [32, 33, "markup.link"], // )
    ]
    // Simulate concealed chunks: `[` -> "", `](` -> " ", `)` -> ""
    // The URL and label chunks remain unchanged.
    const chunks = [
      chunk(""), // concealed `[`
      chunk("Click here"), // label, unchanged
      chunk(" "), // concealed `](`
      chunk("https://example.com"), // URL, unchanged
      chunk(""), // concealed `)`
    ]

    const result = detectLinks(chunks, { content, highlights })

    // The URL chunk should still get its link despite concealed offsets
    expect(result.find((c) => c.text === "https://example.com")!.link).toEqual({ url: "https://example.com" })
    // The label chunk should also get the link
    expect(result.find((c) => c.text === "Click here")!.link).toEqual({ url: "https://example.com" })
  })
})
