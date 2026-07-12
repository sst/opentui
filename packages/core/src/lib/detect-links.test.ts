import { describe, expect, test } from "bun:test"
import { detectLinks } from "../index.js"
import type { TextChunk } from "../text-buffer.js"
import { RGBA } from "./RGBA.js"
import { admitLinkTarget, detectBareLinks, detectSourceLinks } from "./detect-links.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"

function chunk(text: string): TextChunk {
  return { __isChunk: true, text, fg: RGBA.fromInts(255, 255, 255, 255), attributes: 0 }
}

describe("detectLinks public API", () => {
  test("mutates and returns the same array, including one-character labels", () => {
    const content = "[x](https://example.com)"
    const highlights: SimpleHighlight[] = [
      [1, 2, "markup.link.label"],
      [4, 23, "markup.link.url"],
    ]
    const chunks = [chunk("x"), chunk("https://example.com")]

    expect(detectLinks(chunks, { content, highlights })).toBe(chunks)
    expect(chunks.map((item) => item.link)).toEqual([{ url: "https://example.com" }, { url: "https://example.com" }])
  })

  test("preserves dense explicit link mapping", () => {
    const parts: string[] = []
    const highlights: SimpleHighlight[] = []
    const chunks: TextChunk[] = []
    const expected: Array<{ url: string }> = []
    let offset = 0

    for (let index = 0; index < 2_000; index++) {
      const label = `label-${index}`
      const url = `https://target-${index}.test`
      const source = `[${label}](${url})`
      parts.push(source)
      highlights.push(
        [offset + 1, offset + 1 + label.length, "markup.link.label"],
        [offset + label.length + 3, offset + label.length + 3 + url.length, "markup.link.url"],
      )
      chunks.push(chunk(label), chunk(url))
      expected.push({ url }, { url })
      offset += source.length + 1
    }

    expect(detectLinks(chunks, { content: parts.join(" "), highlights })).toBe(chunks)
    expect(chunks.map((item) => item.link)).toEqual(expected)
  })

  test("leaves missing and nonmonotonic chunks unchanged", () => {
    const content = "[first](https://first.test) [second](https://second.test)"
    const highlights: SimpleHighlight[] = [
      [1, 6, "markup.link.label"],
      [8, 26, "markup.link.url"],
      [29, 35, "markup.link.label"],
      [37, 56, "markup.link.url"],
    ]
    const chunks = [chunk("missing"), chunk("second"), chunk("first")]

    detectLinks(chunks, { content, highlights })
    expect(chunks.map((item) => item.link)).toEqual([undefined, { url: "https://second.test" }, undefined])
  })
})

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

  test("handles the former quadratic alternating suffix at review scale", () => {
    const content = `https://x.test/${")] }".replace(" ", "").repeat(16_000)}`
    expect(detectBareLinks(content)).toHaveLength(1)
  })

  test("rejects empty and decoded C0, DEL, and C1 targets", () => {
    expect(admitLinkTarget("")).toBeUndefined()
    for (const control of ["\0", "\x07", "\x1b", "\x7f", "\x80", "\x9c", "&#7;"]) {
      expect(admitLinkTarget(`https://safe.example/${control}`)).toBeUndefined()
    }
  })
})
