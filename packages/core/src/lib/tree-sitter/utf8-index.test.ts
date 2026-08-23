import { describe, expect, test } from "bun:test"
import type { Utf8EditChange } from "./types.js"
import { convertUtf8EditChanges, Utf8ContentIndex } from "./utf8-index.js"

const byteLength = (value: string) => new TextEncoder().encode(value).length

function replaceUtf8(content: string, start: number, end: number, replacement: string): [string, Utf8EditChange] {
  const next = content.slice(0, start) + replacement + content.slice(end)
  const point = (value: string, index: number) => {
    const lines = value.slice(0, index).split("\n")
    return { row: lines.length - 1, column: byteLength(lines.at(-1)!) }
  }
  return [
    next,
    {
      startIndex: byteLength(content.slice(0, start)),
      oldEndIndex: byteLength(content.slice(0, end)),
      newEndIndex: byteLength(next.slice(0, start + replacement.length)),
      startPosition: point(content, start),
      oldEndPosition: point(content, end),
      newEndPosition: point(next, start + replacement.length),
    },
  ]
}

describe("UTF-8 edit conversion", () => {
  test.each([
    ["emoji", "const x = '😀';\r\nnext", "😀", "🧑🏽‍💻"],
    ["combining", "const x = 'é';\r\nnext", "é", "ä"],
    ["CJK", "const x = '漢字';\r\nnext", "漢字", "界"],
    ["multiline CRLF", "head\r\nalpha\r\ntail", "alpha", "一\r\n😀"],
  ])("converts %s byte offsets and columns to UTF-16", (_name, content, oldText, replacement) => {
    const start = content.indexOf(oldText)
    const [next, utf8Edit] = replaceUtf8(content, start, start + oldText.length, replacement)
    const { edits, index } = convertUtf8EditChanges(content, next, [utf8Edit], new Utf8ContentIndex(content))
    const edit = edits[0]!

    expect(edit.coordinateSpace).toBe("utf16")
    expect(edit.startIndex).toBe(start)
    expect(edit.oldEndIndex).toBe(start + oldText.length)
    expect(edit.newEndIndex).toBe(start + replacement.length)
    expect(edit.startPosition.column).toBe(content.slice(0, start).split("\n").at(-1)!.length)
    expect(edit.newEndPosition.column).toBe(
      next
        .slice(0, start + replacement.length)
        .split("\n")
        .at(-1)!.length,
    )
    expect(index.byteIndexAtUtf16Index(next.length)).toBe(byteLength(next))
  })
})
