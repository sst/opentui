import { describe, expect, test } from "bun:test"
import { admitLinkTarget, detectBareLinks, detectMarkdownLinks, detectSourceLinks } from "./detect-links.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"

describe("detectSourceLinks", () => {
  test("uses Marked-resolved explicit destinations and keeps labels continuous", () => {
    const content =
      "[a&amp;b](https://example.test/?a=1&amp;b=2) [angle](<https://x.test/a%20b>) [escape](https://x.test/a\\(b\\))"
    const highlights: SimpleHighlight[] = [
      [1, 8, "markup.link.label"],
      [10, 43, "markup.link.url"],
      [46, 51, "markup.link.label"],
      [53, 75, "markup.link.url"],
      [78, 84, "markup.link.label"],
      [86, 107, "markup.link.url"],
    ]

    expect(
      detectSourceLinks(content, highlights).map(({ start, end, url }) => [content.slice(start, end), url]),
    ).toEqual([
      ["a&amp;b", "https://example.test/?a=1&b=2"],
      ["https://example.test/?a=1&amp;b=2", "https://example.test/?a=1&b=2"],
      ["angle", "https://x.test/a%20b"],
      ["<https://x.test/a%20b>", "https://x.test/a%20b"],
      ["escape", "https://x.test/a(b)"],
      ["https://x.test/a\\(b\\)", "https://x.test/a(b)"],
    ])
  })

  test("keeps explicit links authoritative without a dense quadratic fixture", () => {
    const content = Array.from(
      { length: 64 },
      (_, index) => `[https://label${index}.test](https://target${index}.test)`,
    ).join(" ")
    const highlights: SimpleHighlight[] = []
    for (const match of content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)) {
      const label = match.index + 1
      const url = label + match[1].length + 2
      highlights.push(
        [label, label + match[1].length, "markup.link.label"],
        [url, url + match[2].length, "markup.link.url"],
      )
    }

    const links = detectSourceLinks(content, highlights)
    expect(links).toHaveLength(128)
    expect(links.every((link) => !link.url.includes("label"))).toBe(true)
  })

  test("preserves escaped and semicolonless ampersands in explicit targets", () => {
    const content =
      "[escaped](https://x.test/?q=\\&copy;) [literal](https://x.test/?a=1&copy) [entity](https://x.test/?a=1&amp;b=2)"
    const highlights: SimpleHighlight[] = []
    for (const match of content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)) {
      const labelStart = match.index + 1
      const urlStart = labelStart + match[1].length + 2
      highlights.push(
        [labelStart, labelStart + match[1].length, "markup.link.label"],
        [urlStart, urlStart + match[2].length, "markup.link.url"],
      )
    }

    expect(detectSourceLinks(content, highlights).map((link) => link.url)).toEqual([
      "https://x.test/?q=&copy;",
      "https://x.test/?q=&copy;",
      "https://x.test/?a=1&copy",
      "https://x.test/?a=1&copy",
      "https://x.test/?a=1&b=2",
      "https://x.test/?a=1&b=2",
    ])
  })

  test("links a normal label after an escaped image marker", () => {
    const content = "\\![label](https://x.test)"
    const highlights: SimpleHighlight[] = [
      [3, 8, "markup.link.label"],
      [10, 24, "markup.link.url"],
    ]

    expect(detectSourceLinks(content, highlights)).toEqual([
      { start: 3, end: 8, url: "https://x.test" },
      { start: 10, end: 24, url: "https://x.test" },
    ])
  })

  test("decorates source ranges through the highlight hook", () => {
    const content = "plain https://x.test text"
    const highlights: SimpleHighlight[] = [[0, content.length, "spell"]]
    const context: { content: string; linkRanges?: Array<{ start: number; end: number; url: string }> } = { content }

    expect(detectMarkdownLinks(highlights, context)).toBe(highlights)
    expect(context.linkRanges).toEqual([{ start: 6, end: 20, url: "https://x.test" }])
  })
})

describe("parser-owned bare URLs", () => {
  test("uses excluded ranges as hard boundaries and resumes after them", () => {
    const content = "https://safe.example`https://code.example`HTTPS://AFTER.EXAMPLE"
    const codeStart = content.indexOf("`")
    expect(detectBareLinks(content, [{ start: codeStart, end: content.lastIndexOf("`") + 1 }])).toEqual([
      { start: 0, end: 20, url: "https://safe.example" },
      { start: 42, end: 63, url: "HTTPS://AFTER.EXAMPLE" },
    ])
  })

  test("matches Marked's case and punctuation semantics", () => {
    expect(
      detectBareLinks("HTTPS://EXAMPLE.COM, https://x.test/a(b). https://x.test/foo).").map((link) => link.url),
    ).toEqual(["HTTPS://EXAMPLE.COM", "https://x.test/a(b)", "https://x.test/foo"])
  })

  test("preserves semicolonless entity names in bare URL targets", () => {
    expect(detectBareLinks("https://x.test/?a=1&copy https://x.test/?a=1&not").map((link) => link.url)).toEqual([
      "https://x.test/?a=1&copy",
      "https://x.test/?a=1&not",
    ])
  })

  test("handles the former quadratic alternating suffix at review scale", () => {
    const content = `https://x.test/${")] }".replace(" ", "").repeat(16_000)}`
    expect(detectBareLinks(content)).toHaveLength(1)
  })

  test("rejects empty and decoded C0, DEL, and C1 targets", () => {
    expect(admitLinkTarget("")).toBeUndefined()
    for (const control of ["\0", "\x07", "\x1b", "\x7f", "\x80", "\x9c"]) {
      expect(admitLinkTarget(`https://safe.example/${control}`)).toBeUndefined()
    }

    const content = "[x](https://safe.example/&#7;)"
    expect(
      detectSourceLinks(content, [
        [1, 2, "markup.link.label"],
        [4, 29, "markup.link.url"],
      ]),
    ).toEqual([])
  })
})
