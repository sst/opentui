import { expect, test } from "bun:test"

import { sextantAverageColor, sextantGlyph, sextantMaskByLuminance } from "./sextant-cell.js"

test("maps sextant masks around the unified block characters", () => {
  expect(sextantGlyph(0)).toBe(" ")
  expect(sextantGlyph(1)).toBe("\u{1fb00}")
  expect(sextantGlyph(3)).toBe("\u{1fb02}")
  expect(sextantGlyph(21)).toBe("▌")
  expect(sextantGlyph(22)).toBe("\u{1fb14}")
  expect(sextantGlyph(42)).toBe("▐")
  expect(sextantGlyph(43)).toBe("\u{1fb28}")
  expect(sextantGlyph(62)).toBe("\u{1fb3b}")
  expect(sextantGlyph(63)).toBe("█")
})

test("uses cinematic strength for density and source luminance for placement", () => {
  const samples = new Uint8Array([10, 10, 10, 20, 20, 20, 30, 30, 30, 40, 40, 40, 50, 50, 50, 60, 60, 60])

  expect(sextantMaskByLuminance(samples, 0)).toBe(32)
  expect(sextantMaskByLuminance(samples, 0.33)).toBe(48)
  expect(sextantMaskByLuminance(samples, 1)).toBe(62)
  expect(sextantAverageColor(samples, 48)).toBe(0x373737)
})
