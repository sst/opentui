import { test, expect, describe } from "bun:test"
import { detectLinks } from "./detect-links.js"
import type { TextChunk } from "../text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"
import { RGBA } from "./RGBA.js"

function chunk(text: string): TextChunk {
  return { __isChunk: true, text, fg: RGBA.fromInts(255, 255, 255, 255), attributes: 0 }
}

describe("detectLinks", () => {
  test("detects bare HTTP URLs and splits surrounding text", () => {
    const content = "See https://example.com/docs, then continue"
    const chunks = [chunk(content)]

    const result = detectLinks(chunks, { content, highlights: [], sourceRanges: [[0, content.length]] })

    expect(result.map(({ text, link }) => [text, link?.url])).toEqual([
      ["See ", undefined],
      ["https://example.com/docs", "https://example.com/docs"],
      [", then continue", undefined],
    ])
  })

  test("keeps balanced URL parentheses and trims unmatched punctuation", () => {
    const content = 'See https://example.com/a((b)). Then "https://example.org/x".'
    const chunks = [chunk(content)]

    const result = detectLinks(chunks, { content, highlights: [], sourceRanges: [[0, content.length]] })
    const links = result.filter((value) => value.link).map((value) => value.link!.url)

    expect(links).toEqual(["https://example.com/a((b))", "https://example.org/x"])
  })

  test("does not detect URLs in raw Markdown ranges or across control characters", () => {
    const content = "`https://code.example` https://bad.example\u0007suffix"
    const highlights: SimpleHighlight[] = [[0, 22, "markup.raw"]]
    const chunks = [chunk(content)]

    const result = detectLinks(chunks, { content, highlights, sourceRanges: [[0, content.length]] })

    expect(result.every((value) => value.link === undefined)).toBe(true)
  })

  test("normalizes angle-bracket destinations and Markdown escapes", () => {
    const content = String.raw`[label](<https://example.com/a\(b\)>)`
    const destinationStart = content.indexOf("<")
    const destinationEnd = content.lastIndexOf(">") + 1
    const highlights: SimpleHighlight[] = [
      [1, 6, "markup.link.label"],
      [destinationStart, destinationEnd, "markup.link.url"],
    ]
    const chunks = [chunk(content)]

    const result = detectLinks(chunks, { content, highlights, sourceRanges: [[0, content.length]] })
    const linked = result.filter((value) => value.link)

    expect(linked.length).toBeGreaterThan(0)
    expect(linked.every((value) => value.link?.url === "https://example.com/a(b)")).toBe(true)
  })

  test("does not associate an unrelated label with a later autolink", () => {
    const content = "[shortcut] then <https://example.com>"
    const urlStart = content.indexOf("<")
    const highlights: SimpleHighlight[] = [
      [1, 9, "markup.link.label"],
      [urlStart, content.length, "markup.link.url"],
    ]
    const chunks = [chunk(content)]

    const result = detectLinks(chunks, { content, highlights, sourceRanges: [[0, content.length]] })
    const shortcut = result.find((value) => value.text.includes("shortcut"))

    expect(shortcut?.link).toBeUndefined()
  })

  test("percent-encodes spaces in angle-bracket destinations", () => {
    const content = "[label](<https://example.com/a b>)"
    const start = content.indexOf("<")
    const highlights: SimpleHighlight[] = [
      [1, 6, "markup.link.label"],
      [start, content.indexOf(">") + 1, "markup.link.url"],
    ]

    const result = detectLinks([chunk(content)], { content, highlights, sourceRanges: [[0, content.length]] })

    expect(result.find((value) => value.link)?.link?.url).toBe("https://example.com/a%20b")
  })

  test("preserves valid percent escapes in Markdown destinations", () => {
    const content = "[label](https://example.com/a%20b)"
    const start = content.indexOf("https://")
    const highlights: SimpleHighlight[] = [
      [1, 6, "markup.link.label"],
      [start, content.indexOf(")"), "markup.link.url"],
    ]

    const result = detectLinks([chunk(content)], { content, highlights, sourceRanges: [[0, content.length]] })

    expect(result.find((value) => value.link)?.link?.url).toBe("https://example.com/a%20b")
  })

  test("stops a bare URL before an adjacent raw Markdown range", () => {
    const content = "https://outside.example`https://inside.example`"
    const rawStart = content.indexOf("`")
    const highlights: SimpleHighlight[] = [[rawStart, content.length, "markup.raw"]]

    const result = detectLinks([chunk(content)], { content, highlights, sourceRanges: [[0, content.length]] })
    const linked = result.filter((value) => value.link)

    expect(linked.map((value) => value.text).join("")).toBe("https://outside.example")
    expect(linked.every((value) => value.link?.url === "https://outside.example")).toBe(true)
  })

  test("does not detect a URL joined to an astral Unicode letter", () => {
    const content = "𐐀https://example.com"

    const result = detectLinks([chunk(content)], { content, highlights: [], sourceRanges: [[0, content.length]] })

    expect(result.every((value) => value.link === undefined)).toBe(true)
  })

  test("gives an explicit link label precedence over a bare URL inside it", () => {
    const content = "[https://shown.example extra](https://target.example)"
    const destinationStart = content.lastIndexOf("https://")
    const highlights: SimpleHighlight[] = [
      [1, content.indexOf("]"), "markup.link.label"],
      [destinationStart, content.length - 1, "markup.link.url"],
    ]

    const result = detectLinks([chunk(content)], { content, highlights })
    expect(result.find((value) => value.text === "https://shown.example extra")?.link?.url).toBe(
      "https://target.example",
    )
  })

  test("detects a bare URL inside a label without an explicit destination", () => {
    const content = "[https://example.com]"
    const highlights: SimpleHighlight[] = [[1, content.length - 1, "markup.link.label"]]

    const result = detectLinks([chunk(content)], { content, highlights })

    expect(result.find((value) => value.link)?.link?.url).toBe("https://example.com")
  })

  test("does not override reference links with a bare URL from their label", () => {
    const content = "[https://shown.example][ref]\n\n[ref]: https://target.example"
    const shownEnd = content.indexOf("]")
    const referenceStart = content.indexOf("[ref]")
    const definitionStart = content.lastIndexOf("[ref]")
    const destinationStart = content.lastIndexOf("https://")
    const highlights: SimpleHighlight[] = [
      [1, shownEnd, "markup.link.label"],
      [referenceStart + 1, referenceStart + 4, "markup.link.label"],
      [definitionStart + 1, definitionStart + 4, "markup.link.label"],
      [destinationStart, content.length, "markup.link.url"],
    ]

    const result = detectLinks([chunk(content)], { content, highlights })

    expect(result.every((value) => value.link?.url !== "https://shown.example")).toBe(true)
  })

  test("does not detect bare URLs in link titles or labels with unsupported explicit destinations", () => {
    const longDestination = `https://target.example/${"a".repeat(512)}`
    const content = `[https://shown.example]( ${longDestination} "https://title.example")`
    const destinationStart = content.indexOf(longDestination)
    const titleStart = content.indexOf('"')
    const highlights: SimpleHighlight[] = [
      [1, content.indexOf("]"), "markup.link.label"],
      [destinationStart, destinationStart + longDestination.length, "markup.link.url"],
      [titleStart, content.lastIndexOf('"') + 1, "markup.link.label"],
    ]

    const result = detectLinks([chunk(content)], { content, highlights })

    expect(result.every((value) => value.link === undefined)).toBe(true)
  })

  test("pairs an explicit destination with its outer label when the label contains an image", () => {
    const longDestination = `https://target.example/${"a".repeat(512)}`
    const content = `[prefix ![alt](image.png) https://shown.example]( ${longDestination})`
    const innerLabelStart = content.indexOf("[alt") + 1
    const innerDestinationStart = content.indexOf("image.png")
    const outerLabelEnd = content.lastIndexOf("](")
    const outerDestinationStart = content.indexOf(longDestination)
    const highlights: SimpleHighlight[] = [
      [1, outerLabelEnd, "markup.link.label"],
      [innerLabelStart, innerLabelStart + 3, "markup.link.label"],
      [innerDestinationStart, innerDestinationStart + "image.png".length, "markup.link.url"],
      [outerDestinationStart, outerDestinationStart + longDestination.length, "markup.link.url"],
    ]

    const result = detectLinks([chunk(content)], { content, highlights })

    expect(result.every((value) => value.link?.url !== "https://shown.example")).toBe(true)
  })

  test("detects case-insensitive schemes and apostrophes inside URL paths", () => {
    const content = "HTTP://EXAMPLE.COM/path https://example.com/O'Brien"

    const result = detectLinks([chunk(content)], { content, highlights: [] })

    expect(result.filter((value) => value.link).map((value) => value.text)).toEqual([
      "HTTP://EXAMPLE.COM/path",
      "https://example.com/O'Brien",
    ])
  })

  test("does not include possessive or closing quote apostrophes in bare URLs", () => {
    const content = "Visit https://example.com's docs, url('https://example.org'), or https://example.net/McDonald's."

    const result = detectLinks([chunk(content)], { content, highlights: [] })

    expect(result.filter((value) => value.link).map((value) => [value.text, value.link?.url])).toEqual([
      ["https://example.com", "https://example.com"],
      ["https://example.org", "https://example.org"],
      ["https://example.net/McDonald's", "https://example.net/McDonald's"],
    ])
  })

  test("trims alternating unmatched delimiters from a bare URL", () => {
    const content = "https://example.com/path])])"

    const result = detectLinks([chunk(content)], { content, highlights: [] })

    expect(result.find((value) => value.link)?.link?.url).toBe("https://example.com/path")
  })

  test("does not guess source ranges for transformed chunks", () => {
    const content = "[label](https://example.com)"
    const highlights: SimpleHighlight[] = [
      [1, 6, "markup.link.label"],
      [8, 27, "markup.link.url"],
    ]
    const transformed = [chunk("label"), chunk(" "), chunk("https://example.com")]

    const result = detectLinks(transformed, { content, highlights })

    expect(result).toBe(transformed)
    expect(result.every((value) => value.link === undefined)).toBe(true)
  })

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

    const result = detectLinks(chunks, {
      content,
      highlights,
      sourceRanges: [
        [0, 1],
        [1, 11],
        [11, 13],
        [13, 32],
        [32, 33],
      ],
    })

    // The URL chunk should still get its link despite concealed offsets
    expect(result.find((c) => c.text === "https://example.com")!.link).toEqual({ url: "https://example.com" })
    // The label chunk should also get the link
    expect(result.find((c) => c.text === "Click here")!.link).toEqual({ url: "https://example.com" })
  })
})
