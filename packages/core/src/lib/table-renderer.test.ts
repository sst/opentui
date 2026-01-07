import { describe, it, expect } from "bun:test"
import { getDisplayWidth, padToWidth, truncateToWidth, detectTableRanges, parseTable } from "./table-renderer"

describe("getDisplayWidth", () => {
  it("returns correct width for ASCII characters", () => {
    expect(getDisplayWidth("hello")).toBe(5)
    expect(getDisplayWidth("")).toBe(0)
    expect(getDisplayWidth(" ")).toBe(1)
  })

  it("returns correct width for CJK characters", () => {
    expect(getDisplayWidth("中文")).toBe(4)
    expect(getDisplayWidth("日本語")).toBe(6)
    expect(getDisplayWidth("한글")).toBe(4)
  })

  it("returns correct width for mixed content", () => {
    expect(getDisplayWidth("Hello中文")).toBe(9)
    expect(getDisplayWidth("abc日本語xyz")).toBe(12)
  })

  it("returns correct width for hiragana and katakana", () => {
    expect(getDisplayWidth("あいう")).toBe(6)
    expect(getDisplayWidth("アイウ")).toBe(6)
  })
})

describe("padToWidth", () => {
  it("pads left-aligned content", () => {
    expect(padToWidth("hi", 5, "left")).toBe("hi   ")
  })

  it("pads right-aligned content", () => {
    expect(padToWidth("hi", 5, "right")).toBe("   hi")
  })

  it("pads center-aligned content", () => {
    expect(padToWidth("hi", 6, "center")).toBe("  hi  ")
    expect(padToWidth("hi", 5, "center")).toBe(" hi  ")
  })

  it("returns original string when already at target width", () => {
    expect(padToWidth("hello", 5, "left")).toBe("hello")
  })

  it("returns original string when exceeds target width", () => {
    expect(padToWidth("hello", 3, "left")).toBe("hello")
  })
})

describe("truncateToWidth", () => {
  it("returns original string when within limit", () => {
    expect(truncateToWidth("hello", 10)).toBe("hello")
  })

  it("truncates and adds ellipsis", () => {
    expect(truncateToWidth("hello world", 8)).toBe("hello w…")
  })

  it("handles very short max width", () => {
    expect(truncateToWidth("hello", 2)).toBe("he")
  })

  it("handles CJK characters correctly", () => {
    const result = truncateToWidth("中文テスト", 6)
    expect(getDisplayWidth(result)).toBeLessThanOrEqual(6)
  })
})

describe("detectTableRanges", () => {
  it("detects a simple table", () => {
    const content = `Some text

| A | B |
|---|---|
| 1 | 2 |

More text`
    const ranges = detectTableRanges(content, [])
    expect(ranges.length).toBe(1)
  })

  it("detects multiple tables", () => {
    const content = `| A | B |
|---|---|
| 1 | 2 |

text

| X | Y |
|---|---|
| 3 | 4 |`
    const ranges = detectTableRanges(content, [])
    expect(ranges.length).toBe(2)
  })

  it("ignores pipes in code blocks", () => {
    const content = `\`\`\`
| not | a | table |
\`\`\``
    const ranges = detectTableRanges(content, [])
    expect(ranges.length).toBe(0)
  })

  it("requires delimiter row", () => {
    const content = `| A | B |
| 1 | 2 |`
    const ranges = detectTableRanges(content, [])
    expect(ranges.length).toBe(0)
  })
})

describe("parseTable", () => {
  it("parses a simple table", () => {
    const content = `| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |`
    const table = parseTable(content)
    expect(table).not.toBeNull()
    expect(table!.rows.length).toBe(4)
    expect(table!.columnWidths.length).toBe(2)
    expect(table!.columnAligns).toEqual(["left", "left"])
  })

  it("parses alignment markers", () => {
    const content = `| Left | Center | Right |
|:-----|:------:|------:|
| a | b | c |`
    const table = parseTable(content)
    expect(table).not.toBeNull()
    expect(table!.columnAligns).toEqual(["left", "center", "right"])
  })

  it("calculates column widths correctly", () => {
    const content = `| Short | LongerColumn |
|-------|--------------|
| a | b |`
    const table = parseTable(content)
    expect(table).not.toBeNull()
    expect(table!.columnWidths[0]).toBe(5)
    expect(table!.columnWidths[1]).toBe(12)
  })

  it("handles CJK content width correctly", () => {
    const content = `| Name | City |
|------|------|
| 田中 | 東京 |`
    const table = parseTable(content)
    expect(table).not.toBeNull()
    expect(table!.columnWidths[0]).toBe(4)
    expect(table!.columnWidths[1]).toBe(4)
  })

  it("returns null for invalid table", () => {
    expect(parseTable("not a table")).toBeNull()
    expect(parseTable("|---|")).toBeNull()
  })
})
