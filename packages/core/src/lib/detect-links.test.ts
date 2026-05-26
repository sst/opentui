import { test, expect, describe } from "bun:test"
import { detectLinks } from "./detect-links.js"
import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"
import { RGBA } from "./RGBA.js"

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

  test("should detect bare URLs without tree-sitter URL highlights", () => {
    const content = "Visit https://example.com/docs for details"
    const chunks = [chunk(content)]

    const result = detectLinks(chunks, { content, highlights: [] })

    expect(result.map((c) => c.text)).toEqual(["Visit ", "https://example.com/docs", " for details"])
    expect(result[1].link).toEqual({ url: "https://example.com/docs" })
  })

  test("should not detect bare URLs inside markdown code spans", () => {
    const content = "`https://opentui.com`"
    const chunks = [chunk(content)]
    const highlights: SimpleHighlight[] = [[0, content.length, "markup.raw"]]

    const result = detectLinks(chunks, { content, highlights })

    expect(result).toBe(chunks)
    expect(result[0].link).toBeUndefined()
  })

  test("should retain following link metadata after a concealed one-character replacement", () => {
    const content = "&emsp;[OpenTUI](https://opentui.com) suffix"
    const highlights: SimpleHighlight[] = [
      [0, 6, "character.special", { conceal: " " }],
      [6, 7, "markup.link"],
      [7, 14, "markup.link.label"],
      [14, 16, "markup.link"],
      [16, 35, "markup.link.url"],
      [35, 36, "markup.link"],
    ]
    const chunks = [chunk(" "), chunk("OpenTUI"), chunk(""), chunk(" suffix")]

    const result = detectLinks(chunks, { content, highlights })

    expect(result.find((c) => c.text === "OpenTUI")!.link).toEqual({ url: "https://opentui.com" })
  })

  test("should associate markdown label when conceal highlights separate it from the destination", () => {
    const content = "[OpenTUI](https://opentui.com)"
    const highlights: SimpleHighlight[] = [
      [1, 8, "markup.link.label"],
      [8, 10, "conceal", { conceal: "" }],
      [10, 29, "markup.link.url"],
    ]
    const chunks = [chunk("OpenTUI")]

    const result = detectLinks(chunks, { content, highlights })

    expect(result[0].link).toEqual({ url: "https://opentui.com" })
  })

  test("should preserve link metadata for single-character labels", () => {
    const content = "[x](https://opentui.com)"
    const highlights: SimpleHighlight[] = [
      [1, 2, "markup.link.label"],
      [2, 4, "conceal", { conceal: "" }],
      [4, 23, "markup.link.url"],
    ]
    const chunks = [chunk("x")]

    const result = detectLinks(chunks, { content, highlights })

    expect(result[0].link).toEqual({ url: "https://opentui.com" })
  })

  test("should preserve link metadata for single-character labels after visible single-character chunks", () => {
    const content = "x [x](https://opentui.com)"
    const highlights: SimpleHighlight[] = [
      [3, 4, "markup.link.label"],
      [4, 6, "conceal", { conceal: "" }],
      [6, 25, "markup.link.url"],
    ]
    const chunks = [chunk("x"), chunk(" "), chunk("x")]

    const result = detectLinks(chunks, { content, highlights })

    expect(result[2].link).toEqual({ url: "https://opentui.com" })
  })

  test("should omit concealed emphasis delimiters from bare URL targets", () => {
    const content = "**https://opentui.com**"
    const highlights: SimpleHighlight[] = [[21, 23, "conceal", { conceal: "" }]]
    const chunks = [chunk("https://opentui.com")]

    const result = detectLinks(chunks, { content, highlights })

    expect(result[0].link).toEqual({ url: "https://opentui.com" })
  })
})
