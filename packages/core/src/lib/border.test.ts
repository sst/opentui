import { test, expect, describe, spyOn, afterEach } from "bun:test"
import { isValidBorderStyle, parseBorderStyle, type BorderStyle } from "./border"

describe("isValidBorderStyle", () => {
  test("returns true for valid border styles", () => {
    expect(isValidBorderStyle("single")).toBe(true)
    expect(isValidBorderStyle("double")).toBe(true)
    expect(isValidBorderStyle("rounded")).toBe(true)
    expect(isValidBorderStyle("heavy")).toBe(true)
  })

  test("returns false for invalid border styles", () => {
    expect(isValidBorderStyle("invalid")).toBe(false)
    expect(isValidBorderStyle("")).toBe(false)
    expect(isValidBorderStyle(null)).toBe(false)
    expect(isValidBorderStyle(undefined)).toBe(false)
    expect(isValidBorderStyle(123)).toBe(false)
    expect(isValidBorderStyle({})).toBe(false)
    expect(isValidBorderStyle([])).toBe(false)
  })
})

describe("parseBorderStyle", () => {
  let warnSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    warnSpy?.mockRestore()
  })

  test("returns valid border styles unchanged", () => {
    expect(parseBorderStyle("single")).toBe("single")
    expect(parseBorderStyle("double")).toBe("double")
    expect(parseBorderStyle("rounded")).toBe("rounded")
    expect(parseBorderStyle("heavy")).toBe("heavy")
  })

  test("falls back to 'single' for invalid string values", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {})

    expect(parseBorderStyle("invalid")).toBe("single")
    expect(parseBorderStyle("")).toBe("single")
    expect(parseBorderStyle("SINGLE")).toBe("single") // case sensitive
    expect(parseBorderStyle("Single")).toBe("single")
  })

  test("falls back to custom fallback for invalid values", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {})

    expect(parseBorderStyle("invalid", "double")).toBe("double")
    expect(parseBorderStyle("invalid", "rounded")).toBe("rounded")
    expect(parseBorderStyle("invalid", "heavy")).toBe("heavy")
  })

  test("falls back silently for undefined/null without warning", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {})

    expect(parseBorderStyle(undefined)).toBe("single")
    expect(parseBorderStyle(null)).toBe("single")
    expect(warnSpy).not.toHaveBeenCalled()
  })

  test("logs warning for invalid non-null/undefined values", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {})

    parseBorderStyle("invalid-style")

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      'Invalid borderStyle "invalid-style", falling back to "single". Valid values are: single, double, rounded, heavy',
    )
  })

  describe("regression: does not crash with unexpected value types", () => {
    test("handles invalid values", () => {
      warnSpy = spyOn(console, "warn").mockImplementation(() => {})

      expect(parseBorderStyle(123 as unknown as BorderStyle)).toBe("single")
      expect(parseBorderStyle({} as unknown as BorderStyle)).toBe("single")
      expect(parseBorderStyle(true as unknown as BorderStyle)).toBe("single")
      expect(parseBorderStyle((() => "single") as unknown as BorderStyle)).toBe("single")
    })
  })
})
