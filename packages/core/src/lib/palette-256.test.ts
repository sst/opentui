import { expect, test } from "bun:test"

import { fillMissingWithGenerated256, generate256PaletteFromBase16 } from "./palette-256"

const base16 = [
  "#1a1a1a",
  "#e53b39",
  "#00b648",
  "#ffc90d",
  "#4eb3ec",
  "#b191f9",
  "#4eb3ec",
  "#a4a4a4",
  "#797979",
  "#ff8d4d",
  "#00b648",
  "#ffc90d",
  "#4eb3ec",
  "#b191f9",
  "#4eb3ec",
  "#e7e7e7",
] as const

test("generate256PaletteFromBase16 returns full 256 palette", () => {
  const palette = generate256PaletteFromBase16(base16, "#0f0f0f", "#e7e7e7")

  expect(palette.length).toBe(256)
  expect(palette[0]).toBe(base16[0])
  expect(palette[15]).toBe(base16[15])
  expect(palette[16]).toBe("#0f0f0f")
  expect(palette[231]).toBe("#e7e7e7")
})

test("fillMissingWithGenerated256 preserves existing palette entries", () => {
  const partial = [...base16, ...Array(240).fill(null)] as Array<string | null>
  partial[20] = "#123456"

  const filled = fillMissingWithGenerated256(partial, "#0f0f0f", "#e7e7e7")

  expect(filled.length).toBe(256)
  expect(filled[20]).toBe("#123456")
  expect(filled[21]).toMatch(/^#[0-9a-f]{6}$/)
})
