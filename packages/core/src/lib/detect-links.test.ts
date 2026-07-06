import { test, expect, describe } from "bun:test"
import { detectLinks } from "./detect-links.js"
import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"
import { RGBA } from "./RGBA.js"

function chunk(text: string, sourceStart?: number, sourceEnd?: number): TextChunk {
  return {
    __isChunk: true,
    text,
    fg: RGBA.fromInts(255, 255, 255, 255),
    attributes: 0,
    sourceStart,
    sourceEnd,
  }
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

  test("should detect links when chunks have concealed text (legacy indexOf path)", () => {
    const content = "[Click here](https://example.com)"
    const highlights: SimpleHighlight[] = [
      [0, 1, "markup.link"],
      [1, 11, "markup.link.label"],
      [11, 13, "markup.link"],
      [13, 32, "markup.link.url"],
      [32, 33, "markup.link"],
    ]
    // Simulate concealed chunks WITHOUT sourceStart/sourceEnd (legacy path)
    const chunks = [
      chunk(""),
      chunk("Click here"),
      chunk(" "),
      chunk("https://example.com"),
      chunk(""),
    ]

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "https://example.com")!.link).toEqual({ url: "https://example.com" })
    expect(result.find((c) => c.text === "Click here")!.link).toEqual({ url: "https://example.com" })
  })

  // --- New tests for sourceStart/sourceEnd precise offset matching ---

  test("should use sourceStart/sourceEnd for precise link detection", () => {
    const content = "[Click here](https://example.com)"
    const highlights: SimpleHighlight[] = [
      [0, 1, "markup.link"],
      [1, 11, "markup.link.label"],
      [11, 13, "markup.link"],
      [13, 32, "markup.link.url"],
      [32, 33, "markup.link"],
    ]
    // Chunks with precise source offsets (as produced by treeSitterToTextChunks)
    const chunks = [
      chunk("", 0, 1),           // concealed `[`
      chunk("Click here", 1, 11), // label
      chunk(" ", 11, 13),         // concealed `](`
      chunk("https://example.com", 13, 32), // URL
      chunk("", 32, 33),          // concealed `)`
    ]

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "https://example.com")!.link).toEqual({ url: "https://example.com" })
    expect(result.find((c) => c.text === "Click here")!.link).toEqual({ url: "https://example.com" })
  })

  test("should NOT linkify whitespace-only concealed chunks even when they overlap URL range", () => {
    const content = "[Click here](https://example.com)"
    const highlights: SimpleHighlight[] = [
      [0, 1, "markup.link"],
      [1, 11, "markup.link.label"],
      [11, 13, "markup.link"],
      [13, 32, "markup.link.url"],
      [32, 33, "markup.link"],
    ]
    const chunks = [
      chunk("", 0, 1),
      chunk("Click here", 1, 11),
      chunk(" ", 11, 13),          // whitespace chunk overlapping link syntax range
      chunk("https://example.com", 13, 32),
      chunk("", 32, 33),
    ]

    const result = detectLinks(chunks, { content, highlights })

    // The whitespace chunk ` ` should NOT get a link — it's a conceal replacement
    const spaceChunk = result.find((c) => c.text === " ")!
    expect(spaceChunk.link).toBeUndefined()
  })

  test("should handle multiple links without position drift", () => {
    const content = "See [a](https://a.com) and [b](https://b.com) here"
    const highlights: SimpleHighlight[] = [
      [4, 5, "markup.link"],       // [
      [5, 6, "markup.link.label"], // a
      [6, 8, "markup.link"],       // ](
      [8, 21, "markup.link.url"],  // https://a.com
      [21, 22, "markup.link"],     // )
      [27, 28, "markup.link"],     // [
      [28, 29, "markup.link.label"], // b
      [29, 31, "markup.link"],     // ](
      [31, 44, "markup.link.url"], // https://b.com
      [44, 45, "markup.link"],     // )
    ]
    const chunks = [
      chunk("See ", 0, 4),
      chunk("", 4, 5),              // concealed [
      chunk("a", 5, 6),             // label
      chunk(" ", 6, 8),             // concealed ](
      chunk("https://a.com", 8, 21),
      chunk("", 21, 22),            // concealed )
      chunk(" and ", 22, 27),
      chunk("", 27, 28),            // concealed [
      chunk("b", 28, 29),           // label
      chunk(" ", 29, 31),           // concealed ](
      chunk("https://b.com", 31, 44),
      chunk("", 44, 45),            // concealed )
      chunk(" here", 45, 50),
    ]

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "a")!.link).toEqual({ url: "https://a.com" })
    expect(result.find((c) => c.text === "https://a.com")!.link).toEqual({ url: "https://a.com" })
    expect(result.find((c) => c.text === "b")!.link).toEqual({ url: "https://b.com" })
    expect(result.find((c) => c.text === "https://b.com")!.link).toEqual({ url: "https://b.com" })
    // Non-link text must NOT have links
    expect(result.find((c) => c.text === "See ")!.link).toBeUndefined()
    expect(result.find((c) => c.text === " and ")!.link).toBeUndefined()
    expect(result.find((c) => c.text === " here")!.link).toBeUndefined()
  })

  test("should not produce phantom links on unrelated text (regression)", () => {
    // This simulates the scenario where indexOf drift caused phantom links:
    // text after a link accidentally matched at a URL position.
    const content = "Check [docs](https://docs.example.com) for the API docs reference"
    const highlights: SimpleHighlight[] = [
      [6, 7, "markup.link"],        // [
      [7, 11, "markup.link.label"], // docs
      [11, 13, "markup.link"],      // ](
      [13, 37, "markup.link.url"],  // https://docs.example.com
      [37, 38, "markup.link"],      // )
    ]
    const chunks = [
      chunk("Check ", 0, 6),
      chunk("", 6, 7),
      chunk("docs", 7, 11),         // label — should get link
      chunk(" ", 11, 13),           // concealed ](
      chunk("https://docs.example.com", 13, 37),
      chunk("", 37, 38),
      chunk(" for the API ", 38, 51),
      chunk("docs", 51, 55),        // "docs" again in plain text — must NOT get link
      chunk(" reference", 55, 65),
    ]

    const result = detectLinks(chunks, { content, highlights })

    // First "docs" (the label) should have a link
    const labelChunk = result[2]
    expect(labelChunk.text).toBe("docs")
    expect(labelChunk.link).toEqual({ url: "https://docs.example.com" })

    // Second "docs" (plain text) must NOT have a link
    const plainChunk = result[7]
    expect(plainChunk.text).toBe("docs")
    expect(plainChunk.link).toBeUndefined()

    // Surrounding text must not have links
    expect(result.find((c) => c.text === "Check ")!.link).toBeUndefined()
    expect(result.find((c) => c.text === " for the API ")!.link).toBeUndefined()
    expect(result.find((c) => c.text === " reference")!.link).toBeUndefined()
  })

  test("should not open a hyperlink for an empty URL range (e.g. [text]())", () => {
    // markdown [text]() yields a markup.link.url highlight over an empty range
    const content = "[text]()"
    const highlights: SimpleHighlight[] = [
      [0, 1, "markup.link"],
      [1, 5, "markup.link.label"],
      [5, 6, "markup.link"], // ]
      [6, 7, "markup.link"], // (
      [7, 7, "markup.link.url"], // empty href between ( and )
      [7, 8, "markup.link"], // )
    ]
    const chunks = [chunk("["), chunk("text"), chunk("]"), chunk("("), chunk(")")]

    const result = detectLinks(chunks, { content, highlights })

    for (const c of result) {
      expect(c.link).toBeUndefined()
    }
  })

  test("should not open a hyperlink for a whitespace-only URL range (e.g. [text]( ))", () => {
    const content = "[text]( )"
    const highlights: SimpleHighlight[] = [
      [0, 1, "markup.link"],
      [1, 5, "markup.link.label"],
      [5, 6, "markup.link"], // ]
      [6, 7, "markup.link"], // (
      [7, 8, "markup.link.url"], // href is a single space
      [8, 9, "markup.link"], // )
    ]
    const chunks = [chunk("["), chunk("text"), chunk("]"), chunk("("), chunk(" "), chunk(")")]

    const result = detectLinks(chunks, { content, highlights })

    for (const c of result) {
      expect(c.link).toBeUndefined()
    }
  })

  test("should still attach a link for a real (non-empty, non-whitespace) URL", () => {
    const content = "[text](https://example.com)"
    const highlights: SimpleHighlight[] = [
      [0, 1, "markup.link"],
      [1, 5, "markup.link.label"],
      [5, 6, "markup.link"], // ]
      [6, 7, "markup.link"], // (
      [7, 26, "markup.link.url"], // https://example.com
      [26, 27, "markup.link"], // )
    ]
    const chunks = [
      chunk("[", 0, 1),
      chunk("text", 1, 5),
      chunk("]", 5, 6),
      chunk("(", 6, 7),
      chunk("https://example.com", 7, 26),
      chunk(")", 26, 27),
    ]

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "https://example.com")!.link).toEqual({ url: "https://example.com" })
    expect(result.find((c) => c.text === "text")!.link).toEqual({ url: "https://example.com" })
  })
})
