import { describe, expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"

import {
  animatedLogo,
  logoAnimationDuration,
  logoAnimationKind,
  logoAnimationProgress,
  shouldAutoPlayLogoAnimation,
} from "./opentui-logo-demo.js"

describe("logo animation direction", () => {
  test.each([
    ["Forward slant", "Three rows", "typeset"],
    ["Seven plain cells", "One row / typography", "typeset"],
    ["Unicode 16 outlined Latin", "One-cell capability probes", "typeset"],
    ["Combining underline", "One-cell capability probes", "combine"],
    ["Inverse quadrants, tracked", "Three rows / half width", "invert"],
    ["Braille, tracked", "Two rows / half width", "braille"],
    ["Sextant mosaic, tracked", "Legacy mosaics / two rows", "pack"],
    ["light connected strokes, tracked", "Connected stroke topology", "trace"],
    ["Dark-shade silhouette", "Original block studies", "density"],
    ["Original six-pixel alphabet", "Three rows", "build"],
  ] as const)("maps %s to %s", (name, category, expected) => {
    expect(logoAnimationKind({ name, category })).toBe(expected)
  })

  test("uses short, family-specific durations", () => {
    expect(logoAnimationDuration("typeset")).toBeLessThan(700)
    expect(logoAnimationDuration("braille")).toBeGreaterThan(logoAnimationDuration("pack"))
    expect(logoAnimationDuration("trace")).toBeGreaterThan(logoAnimationDuration("typeset"))
    expect(logoAnimationDuration("trace")).toBeLessThanOrEqual(900)
  })

  test("finishes without a slow easing tail", () => {
    expect(logoAnimationProgress(0, 600)).toBe(0)
    expect(logoAnimationProgress(300, 600)).toBe(0.5)
    expect(logoAnimationProgress(510, 600)).toBe(0.85)
    expect(logoAnimationProgress(600, 600)).toBe(1)
  })

  test("typeset animation resolves italic glyphs to roman", () => {
    const item = { name: "Seven plain cells", category: "One row / typography", content: "OpenTUI", note: "" }
    const opening = animatedLogo(item, 0, "#ffffff")
    const settled = animatedLogo(item, 1, "#ffffff")

    expect(opening.chunks.every((chunk) => Boolean((chunk.attributes ?? 0) & TextAttributes.ITALIC))).toBe(true)
    expect(settled.chunks.every((chunk) => !((chunk.attributes ?? 0) & TextAttributes.ITALIC))).toBe(true)
  })

  test("combining marks arrive softly before reaching full contrast", () => {
    const item = { name: "Combining underline", category: "One-cell capability probes", content: "O̲", note: "" }
    const openingMark = animatedLogo(item, 0, "#ffffff").chunks[1]
    const arrivingMark = animatedLogo(item, 0.3, "#ffffff").chunks[1]
    const settledMark = animatedLogo(item, 1, "#ffffff").chunks[1]

    expect(openingMark?.text).toBe("")
    expect(arrivingMark?.text).toBe("̲")
    expect(Boolean((arrivingMark?.attributes ?? 0) & TextAttributes.DIM)).toBe(true)
    expect(Boolean((settledMark?.attributes ?? 0) & TextAttributes.DIM)).toBe(false)
  })

  test("Braille animation constructs the target dot pattern", () => {
    const item = { name: "Braille, tracked", category: "Two rows / half width", content: "⣿", note: "" }

    expect(animatedLogo(item, 0, "#ffffff").chunks[0]?.text).toBe("⠀")
    expect(animatedLogo(item, 0.35, "#ffffff").chunks[0]?.text).not.toBe("⣿")
    expect(animatedLogo(item, 1, "#ffffff").chunks[0]?.text).toBe("⣿")
  })

  test("cell build follows a top-left to bottom-right half-cell diagonal", () => {
    const item = { name: "Original six-pixel alphabet", category: "Three rows", content: "███\n███", note: "" }
    const frame = animatedLogo(item, 0.4, "#ffffff").chunks

    expect(frame[0]?.text).toBe("█")
    expect(frame[1]?.text).toBe("▀")
    expect(frame[2]?.text).toBe(" ")
    expect(frame[4]?.text).toBe("▀")
    expect(frame[6]?.text).toBe(" ")
  })

  test("cell build only uses pixels present in each final half-block", () => {
    const item = { name: "Original six-pixel alphabet", category: "Three rows", content: "▄▀█", note: "" }

    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const [lower, upper, full] = animatedLogo(item, progress, "#ffffff").chunks
      expect([" ", "▄"]).toContain(lower?.text)
      expect([" ", "▀"]).toContain(upper?.text)
      expect([" ", "▀", "▄", "█"]).toContain(full?.text)
    }
  })

  test("auto-play runs for enabled manual and slideshow logo switches", () => {
    const focusedSwitch = {
      enabled: true,
      previousIndex: 0,
      nextIndex: 1,
      isPlaying: false,
      scrollMode: false,
      hasComparison: false,
    }

    expect(shouldAutoPlayLogoAnimation(focusedSwitch)).toBe(true)
    expect(shouldAutoPlayLogoAnimation({ ...focusedSwitch, isPlaying: true })).toBe(true)
    expect(shouldAutoPlayLogoAnimation({ ...focusedSwitch, enabled: false })).toBe(false)
    expect(shouldAutoPlayLogoAnimation({ ...focusedSwitch, nextIndex: 0 })).toBe(false)
    expect(shouldAutoPlayLogoAnimation({ ...focusedSwitch, scrollMode: true })).toBe(false)
    expect(shouldAutoPlayLogoAnimation({ ...focusedSwitch, hasComparison: true })).toBe(false)
  })
})
