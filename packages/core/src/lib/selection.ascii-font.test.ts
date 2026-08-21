import { describe, expect, it } from "bun:test"
import { ASCIIFontSelectionHelper, type LocalSelectionBounds } from "./selection.js"

function helper(text = "HI") {
  return new ASCIIFontSelectionHelper(
    () => text,
    () => "tiny",
  )
}

function bounds(anchorX: number, focusX: number, height = 2): LocalSelectionBounds {
  return {
    anchorX,
    anchorY: 0,
    focusX,
    focusY: 0,
    isActive: true,
  }
}

describe("ASCIIFontSelectionHelper", () => {
  // tiny "H" is 3 cols, letterspace 1, "I" is 1 col. Positions: H@0, I@4.
  const hStart = 0
  const iStart = 4
  const height = 2
  const width = 5

  it("includes both endpoint characters on a forward drag", () => {
    const sel = helper()
    sel.onLocalSelectionChanged(bounds(hStart, iStart), width, height)

    expect(sel.getSelection()).toEqual({ start: 0, end: 2 })
    expect(sel.hasSelection()).toBe(true)
  })

  it("includes both endpoint characters on a reverse drag", () => {
    const sel = helper()
    sel.onLocalSelectionChanged(bounds(iStart, hStart), width, height)

    expect(sel.getSelection()).toEqual({ start: 0, end: 2 })
  })

  it("stays empty on a press without drag", () => {
    const sel = helper()
    const changed = sel.onLocalSelectionChanged(bounds(hStart, hStart), width, height)

    expect(sel.getSelection()).toBe(null)
    expect(sel.hasSelection()).toBe(false)
    expect(changed).toBe(false)
  })

  it("clears when the local selection is inactive", () => {
    const sel = helper()
    sel.onLocalSelectionChanged(bounds(hStart, iStart), width, height)
    expect(sel.hasSelection()).toBe(true)

    sel.onLocalSelectionChanged(null, width, height)
    expect(sel.hasSelection()).toBe(false)
  })
})
