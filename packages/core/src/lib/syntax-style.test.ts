import { test, expect, describe } from "bun:test"
import { SyntaxStyle, convertThemeToStyles, type ThemeTokenStyle } from "./syntax-style"
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

  test("should handle style named 'constructor' correctly", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      constructor: { fg: RGBA.fromInts(255, 200, 100, 255), bold: true },
    })

    // Should handle "constructor" as a regular style name
    const result = syntaxStyle.mergeStyles("constructor")
    expect(result.fg).toEqual(RGBA.fromInts(255, 200, 100, 255))
    expect(result.attributes).toBeGreaterThan(0) // Should have bold attribute

    // Should also work with dot-delimited constructor styles
    const fallbackResult = syntaxStyle.mergeStyles("constructor.special")
    expect(fallbackResult.fg).toEqual(RGBA.fromInts(255, 200, 100, 255))
    expect(fallbackResult.attributes).toBeGreaterThan(0)
  })

  test("should not return prototype properties when style is not defined", () => {
    const syntaxStyle = new SyntaxStyle({
      default: { fg: RGBA.fromInts(255, 255, 255, 255) },
      keyword: { fg: RGBA.fromInts(255, 100, 100, 255) },
    })

    // These are Object.prototype properties that should not be treated as styles
    const constructorResult = syntaxStyle.mergeStyles("constructor")
    expect(constructorResult.fg).toBeUndefined()
    expect(constructorResult.bg).toBeUndefined()
    expect(constructorResult.attributes).toBe(0)

    const toStringResult = syntaxStyle.mergeStyles("toString")
    expect(toStringResult.fg).toBeUndefined()
    expect(toStringResult.bg).toBeUndefined()
    expect(toStringResult.attributes).toBe(0)

    const hasOwnPropertyResult = syntaxStyle.mergeStyles("hasOwnProperty")
    expect(hasOwnPropertyResult.fg).toBeUndefined()
    expect(hasOwnPropertyResult.bg).toBeUndefined()
    expect(hasOwnPropertyResult.attributes).toBe(0)
  })
})

describe("Theme Conversion", () => {
  test("should convert theme definition to flat styles", () => {
    const theme: ThemeTokenStyle[] = [
      {
        scope: ["keyword", "keyword.control"],
        style: {
          foreground: "#569cd6",
          italic: true,
        },
      },
      {
        scope: ["string"],
        style: {
          foreground: "#9ece6a",
          bold: true,
        },
      },
      {
        scope: ["comment"],
        style: {
          foreground: "#51597d",
          italic: true,
          dim: true,
        },
      },
    ]

    const flatStyles = convertThemeToStyles(theme)

    expect(flatStyles.keyword).toBeDefined()
    expect(flatStyles.keyword.fg).toEqual(RGBA.fromHex("#569cd6"))
    expect(flatStyles.keyword.italic).toBe(true)
    expect(flatStyles.keyword.bold).toBeUndefined()

    expect(flatStyles["keyword.control"]).toBeDefined()
    expect(flatStyles["keyword.control"].fg).toEqual(RGBA.fromHex("#569cd6"))
    expect(flatStyles["keyword.control"].italic).toBe(true)

    expect(flatStyles.string).toBeDefined()
    expect(flatStyles.string.fg).toEqual(RGBA.fromHex("#9ece6a"))
    expect(flatStyles.string.bold).toBe(true)
    expect(flatStyles.string.italic).toBeUndefined()

    expect(flatStyles.comment).toBeDefined()
    expect(flatStyles.comment.fg).toEqual(RGBA.fromHex("#51597d"))
    expect(flatStyles.comment.italic).toBe(true)
    expect(flatStyles.comment.dim).toBe(true)
  })

  test("should handle background colors in theme conversion", () => {
    const theme: ThemeTokenStyle[] = [
      {
        scope: ["highlight"],
        style: {
          foreground: "#ffffff",
          background: "#ff0000",
          bold: true,
        },
      },
    ]

    const flatStyles = convertThemeToStyles(theme)

    expect(flatStyles.highlight.fg).toEqual(RGBA.fromHex("#ffffff"))
    expect(flatStyles.highlight.bg).toEqual(RGBA.fromHex("#ff0000"))
    expect(flatStyles.highlight.bold).toBe(true)
  })

  test("should create SyntaxStyle from theme using fromTheme", () => {
    const theme: ThemeTokenStyle[] = [
      {
        scope: ["keyword"],
        style: {
          foreground: "#569cd6",
          italic: true,
        },
      },
      {
        scope: ["string", "symbol"],
        style: {
          foreground: "#9ece6a",
        },
      },
    ]

    const syntaxStyle = SyntaxStyle.fromTheme(theme)

    const keywordResult = syntaxStyle.mergeStyles("keyword")
    expect(keywordResult.fg).toEqual(RGBA.fromHex("#569cd6"))
    expect(keywordResult.attributes).toBeGreaterThan(0) // Should have italic

    const stringResult = syntaxStyle.mergeStyles("string")
    expect(stringResult.fg).toEqual(RGBA.fromHex("#9ece6a"))

    const symbolResult = syntaxStyle.mergeStyles("symbol")
    expect(symbolResult.fg).toEqual(RGBA.fromHex("#9ece6a"))
  })

  test("should work with the provided theme example", () => {
    const theme: ThemeTokenStyle[] = [
      {
        scope: ["prompt"],
        style: {
          foreground: "#89ddff",
        },
      },
      {
        scope: ["comment"],
        style: {
          foreground: "#51597d",
          italic: true,
        },
      },
      {
        scope: ["comment.documentation"],
        style: {
          foreground: "#51597d",
          italic: true,
        },
      },
      {
        scope: ["string", "symbol"],
        style: {
          foreground: "#9ece6a",
        },
      },
      {
        scope: ["keyword.type"],
        style: {
          foreground: "#0db9d7",
          bold: true,
          italic: true,
        },
      },
    ]

    const syntaxStyle = SyntaxStyle.fromTheme(theme)

    const promptResult = syntaxStyle.mergeStyles("prompt")
    expect(promptResult.fg).toEqual(RGBA.fromHex("#89ddff"))

    const commentResult = syntaxStyle.mergeStyles("comment")
    expect(commentResult.fg).toEqual(RGBA.fromHex("#51597d"))
    expect(commentResult.attributes).toBeGreaterThan(0) // Should have italic

    const commentDocResult = syntaxStyle.mergeStyles("comment.documentation")
    expect(commentDocResult.fg).toEqual(RGBA.fromHex("#51597d"))
    expect(commentDocResult.attributes).toBeGreaterThan(0) // Should have italic

    const stringResult = syntaxStyle.mergeStyles("string")
    expect(stringResult.fg).toEqual(RGBA.fromHex("#9ece6a"))

    const symbolResult = syntaxStyle.mergeStyles("symbol")
    expect(symbolResult.fg).toEqual(RGBA.fromHex("#9ece6a"))

    const keywordTypeResult = syntaxStyle.mergeStyles("keyword.type")
    expect(keywordTypeResult.fg).toEqual(RGBA.fromHex("#0db9d7"))
    expect(keywordTypeResult.attributes).toBeGreaterThan(0) // Should have both bold and italic
  })

  test("should handle fallback for dot-delimited scopes in theme", () => {
    const theme: ThemeTokenStyle[] = [
      {
        scope: ["keyword"],
        style: {
          foreground: "#569cd6",
          italic: true,
        },
      },
    ]

    const syntaxStyle = SyntaxStyle.fromTheme(theme)

    const result = syntaxStyle.mergeStyles("keyword.operator")
    expect(result.fg).toEqual(RGBA.fromHex("#569cd6"))
    expect(result.attributes).toBeGreaterThan(0) // Should have italic
  })

  test("should handle different color input formats", () => {
    const redRGBA = RGBA.fromInts(255, 0, 0, 255)

    const theme: ThemeTokenStyle[] = [
      {
        scope: ["hex-color"],
        style: {
          foreground: "#ff0000",
        },
      },
      {
        scope: ["css-color"],
        style: {
          foreground: "red",
        },
      },
      {
        scope: ["rgba-color"],
        style: {
          foreground: redRGBA,
        },
      },
      {
        scope: ["transparent"],
        style: {
          foreground: "transparent",
        },
      },
    ]

    const syntaxStyle = SyntaxStyle.fromTheme(theme)

    const hexResult = syntaxStyle.mergeStyles("hex-color")
    expect(hexResult.fg).toEqual(RGBA.fromHex("#ff0000"))

    const cssResult = syntaxStyle.mergeStyles("css-color")
    expect(cssResult.fg).toEqual(RGBA.fromHex("#FF0000")) // CSS red

    const rgbaResult = syntaxStyle.mergeStyles("rgba-color")
    expect(rgbaResult.fg).toEqual(redRGBA)

    const transparentResult = syntaxStyle.mergeStyles("transparent")
    expect(transparentResult.fg).toEqual(RGBA.fromValues(0, 0, 0, 0))
  })
})
