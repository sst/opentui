import { test, expect, describe } from "bun:test"
import { SyntaxStyle } from "./syntax-style"
import { RGBA } from "./RGBA"

describe("SyntaxStyle", () => {
  test("should merge single style correctly", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255), bold: true },
    })

    const result = syntaxStyle.mergeStyles("keyword")

    expect(result.fg).toEqual(RGBA.fromInts(255, 100, 100, 255))
    expect(result.attributes).toBeGreaterThan(0) // Should have bold attribute
  })

  test("should merge multiple styles with later styles taking precedence", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255), bold: true },
      emphasis: { italic: true },
      override: { fg: RGBA.fromInts(100, 255, 100, 255) },
    })

    const result = syntaxStyle.mergeStyles("keyword", "emphasis", "override")

    expect(result.fg).toEqual(RGBA.fromInts(100, 255, 100, 255)) // Last fg wins
    expect(result.attributes).toBeGreaterThan(0) // Should have both bold and italic
  })

  test("should handle dot-delimited style names with fallback to base name", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255), bold: true },
      punctuation: { fg: RGBA.fromInts(100, 100, 100, 255) },
      type: { fg: RGBA.fromInts(255, 200, 100, 255) },
    })

    // Test exact match first
    const exactMatch = syntaxStyle.mergeStyles("keyword")
    expect(exactMatch.fg).toEqual(RGBA.fromInts(255, 100, 100, 255))
    expect(exactMatch.attributes).toBeGreaterThan(0)

    // Test fallback for dot-delimited names
    const fallbackMatch = syntaxStyle.mergeStyles("keyword.operator")
    expect(fallbackMatch.fg).toEqual(RGBA.fromInts(255, 100, 100, 255))
    expect(fallbackMatch.attributes).toBeGreaterThan(0)

    const punctuationFallback = syntaxStyle.mergeStyles("punctuation.bracket")
    expect(punctuationFallback.fg).toEqual(RGBA.fromInts(100, 100, 100, 255))

    const typeFallback = syntaxStyle.mergeStyles("type.builtin")
    expect(typeFallback.fg).toEqual(RGBA.fromInts(255, 200, 100, 255))
  })

  test("should return no styling for non-existent base names", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255) },
    })

    const nonExistent = syntaxStyle.mergeStyles("nonexistent.subtype")
    expect(nonExistent.fg).toBeUndefined()
    expect(nonExistent.bg).toBeUndefined()
    expect(nonExistent.attributes).toBe(0)
  })

  test("should prefer exact matches over fallback matches", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255) },
      "keyword.operator": { fg: RGBA.fromInts(100, 255, 100, 255) }, // Specific override
    })

    // Should use exact match, not fallback
    const exactMatch = syntaxStyle.mergeStyles("keyword.operator")
    expect(exactMatch.fg).toEqual(RGBA.fromInts(100, 255, 100, 255))

    // Should still fallback for non-exact matches
    const fallbackMatch = syntaxStyle.mergeStyles("keyword.control")
    expect(fallbackMatch.fg).toEqual(RGBA.fromInts(255, 100, 100, 255))
  })

  test("should handle multiple dot-delimited names in single merge", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255), bold: true },
      punctuation: { fg: RGBA.fromInts(100, 100, 100, 255) },
    })

    const result = syntaxStyle.mergeStyles("keyword.operator", "punctuation.bracket")

    // Later style should take precedence
    expect(result.fg).toEqual(RGBA.fromInts(100, 100, 100, 255))
    expect(result.attributes).toBeGreaterThan(0) // Should still have bold from keyword
  })

  test("should cache merged styles for performance", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255) },
    })

    expect(syntaxStyle.getCacheSize()).toBe(0)

    const result1 = syntaxStyle.mergeStyles("keyword.operator")
    expect(syntaxStyle.getCacheSize()).toBe(1)

    const result2 = syntaxStyle.mergeStyles("keyword.operator")
    expect(syntaxStyle.getCacheSize()).toBe(1) // Should not increase

    // Results should be identical (same object reference due to caching)
    expect(result1).toBe(result2)
  })

  test("should clear cache correctly", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255) },
    })

    syntaxStyle.mergeStyles("keyword")
    syntaxStyle.mergeStyles("keyword.operator")
    expect(syntaxStyle.getCacheSize()).toBe(2)

    syntaxStyle.clearCache()
    expect(syntaxStyle.getCacheSize()).toBe(0)
  })

  test("should handle all style attributes correctly", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      complex: {
        fg: RGBA.fromInts(255, 100, 100, 255),
        bg: RGBA.fromInts(50, 50, 50, 255),
        bold: true,
        italic: true,
        underline: true,
        dim: true,
      },
    })

    const result = syntaxStyle.mergeStyles("complex")

    expect(result.fg).toEqual(RGBA.fromInts(255, 100, 100, 255))
    expect(result.bg).toEqual(RGBA.fromInts(50, 50, 50, 255))
    expect(result.attributes).toBeGreaterThan(0) // Should have multiple attributes
  })

  test("should handle empty style names gracefully", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
    })

    const result = syntaxStyle.mergeStyles()

    expect(result.fg).toBeUndefined()
    expect(result.bg).toBeUndefined()
    expect(result.attributes).toBe(0)
  })

  test("should handle dot-delimited names with multiple dots", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255) },
    })

    // Should use first part before first dot
    const result = syntaxStyle.mergeStyles("keyword.control.flow")
    expect(result.fg).toEqual(RGBA.fromInts(255, 100, 100, 255))
  })
})
