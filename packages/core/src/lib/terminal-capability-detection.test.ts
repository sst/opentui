import { test, expect, describe } from "bun:test"
import { isCapabilityResponse, isPixelResolutionResponse, parsePixelResolution } from "./terminal-capability-detection"

describe("isCapabilityResponse", () => {
  test("detects DECRPM responses", () => {
    expect(isCapabilityResponse("\x1b[?1016;2$y")).toBe(true)
    expect(isCapabilityResponse("\x1b[?2027;0$y")).toBe(true)
    expect(isCapabilityResponse("\x1b[?2031;2$y")).toBe(true)
    expect(isCapabilityResponse("\x1b[?1004;1$y")).toBe(true)
    expect(isCapabilityResponse("\x1b[?2026;2$y")).toBe(true)
    expect(isCapabilityResponse("\x1b[?2004;2$y")).toBe(true)
  })

  test("detects CPR responses for width detection", () => {
    expect(isCapabilityResponse("\x1b[1;2R")).toBe(true) // explicit width
    expect(isCapabilityResponse("\x1b[1;3R")).toBe(true) // scaled text
  })

  test("does not detect regular CPR responses as capabilities", () => {
    // Regular cursor position reports are NOT capabilities
    expect(isCapabilityResponse("\x1b[10;5R")).toBe(false)
    expect(isCapabilityResponse("\x1b[20;30R")).toBe(false)
  })

  test("detects XTVersion responses", () => {
    expect(isCapabilityResponse("\x1bP>|kitty(0.40.1)\x1b\\")).toBe(true)
    expect(isCapabilityResponse("\x1bP>|ghostty 1.1.3\x1b\\")).toBe(true)
    expect(isCapabilityResponse("\x1bP>|tmux 3.5a\x1b\\")).toBe(true)
  })

  test("detects Kitty graphics responses", () => {
    expect(isCapabilityResponse("\x1b_Gi=1;OK\x1b\\")).toBe(true)
    expect(isCapabilityResponse("\x1b_Gi=1;EINVAL:Zero width/height not allowed\x1b\\")).toBe(true)
  })

  test("detects DA1 (Device Attributes) responses", () => {
    expect(isCapabilityResponse("\x1b[?62;c")).toBe(true)
    expect(isCapabilityResponse("\x1b[?62;22c")).toBe(true)
    expect(isCapabilityResponse("\x1b[?1;2;4c")).toBe(true)
    expect(isCapabilityResponse("\x1b[?6c")).toBe(true)
  })

  test("detects Kitty keyboard query responses", () => {
    expect(isCapabilityResponse("\x1b[?0u")).toBe(true)
    expect(isCapabilityResponse("\x1b[?1u")).toBe(true)
    expect(isCapabilityResponse("\x1b[?31u")).toBe(true)
  })

  test("does not detect regular keypresses", () => {
    expect(isCapabilityResponse("a")).toBe(false)
    expect(isCapabilityResponse("A")).toBe(false)
    expect(isCapabilityResponse("\x1b")).toBe(false)
    expect(isCapabilityResponse("\x1ba")).toBe(false)
  })

  test("does not detect arrow keys", () => {
    expect(isCapabilityResponse("\x1b[A")).toBe(false)
    expect(isCapabilityResponse("\x1b[B")).toBe(false)
    expect(isCapabilityResponse("\x1b[C")).toBe(false)
    expect(isCapabilityResponse("\x1b[D")).toBe(false)
  })

  test("does not detect function keys", () => {
    expect(isCapabilityResponse("\x1bOP")).toBe(false)
    expect(isCapabilityResponse("\x1b[11~")).toBe(false)
    expect(isCapabilityResponse("\x1b[24~")).toBe(false)
  })

  test("does not detect modified arrow keys", () => {
    expect(isCapabilityResponse("\x1b[1;2A")).toBe(false)
    expect(isCapabilityResponse("\x1b[1;5C")).toBe(false)
  })

  test("does not detect mouse sequences", () => {
    expect(isCapabilityResponse("\x1b[<35;20;5m")).toBe(false)
    expect(isCapabilityResponse("\x1b[<0;10;10M")).toBe(false)
  })
})

describe("isPixelResolutionResponse", () => {
  test("detects pixel resolution responses", () => {
    expect(isPixelResolutionResponse("\x1b[4;720;1280t")).toBe(true)
    expect(isPixelResolutionResponse("\x1b[4;1080;1920t")).toBe(true)
    expect(isPixelResolutionResponse("\x1b[4;0;0t")).toBe(true)
  })

  test("does not detect other sequences", () => {
    expect(isPixelResolutionResponse("a")).toBe(false)
    expect(isPixelResolutionResponse("\x1b[A")).toBe(false)
    expect(isPixelResolutionResponse("\x1b[?1016;2$y")).toBe(false)
  })
})

describe("parsePixelResolution", () => {
  test("parses valid pixel resolution responses", () => {
    expect(parsePixelResolution("\x1b[4;720;1280t")).toEqual({ width: 1280, height: 720 })
    expect(parsePixelResolution("\x1b[4;1080;1920t")).toEqual({ width: 1920, height: 1080 })
    expect(parsePixelResolution("\x1b[4;0;0t")).toEqual({ width: 0, height: 0 })
  })

  test("returns null for invalid sequences", () => {
    expect(parsePixelResolution("a")).toBeNull()
    expect(parsePixelResolution("\x1b[A")).toBeNull()
    expect(parsePixelResolution("\x1b[?1016;2$y")).toBeNull()
  })
})

describe("real-world terminal capability sequences", () => {
  test("kitty terminal full response - individual sequences", () => {
    // Should detect multiple capability sequences
    expect(isCapabilityResponse("\x1b[?1016;2$y")).toBe(true)
    expect(isCapabilityResponse("\x1b[?2027;0$y")).toBe(true)
    expect(isCapabilityResponse("\x1b[1;2R")).toBe(true)
    expect(isCapabilityResponse("\x1b[1;3R")).toBe(true)
    expect(isCapabilityResponse("\x1bP>|kitty(0.40.1)\x1b\\")).toBe(true)
    expect(isCapabilityResponse("\x1b_Gi=1;EINVAL:Zero width/height not allowed\x1b\\")).toBe(true)
    expect(isCapabilityResponse("\x1b[?62;c")).toBe(true)
  })

  test("ghostty terminal response - individual sequences", () => {
    expect(isCapabilityResponse("\x1bP>|ghostty 1.1.3\x1b\\")).toBe(true)
    expect(isCapabilityResponse("\x1b_Gi=1;OK\x1b\\")).toBe(true)
    expect(isCapabilityResponse("\x1b[?62;22c")).toBe(true)
  })

  test("alacritty terminal response - individual sequences", () => {
    expect(isCapabilityResponse("\x1b[?1016;0$y")).toBe(true)
    expect(isCapabilityResponse("\x1b[?6c")).toBe(true)
  })

  test("vscode terminal minimal response", () => {
    expect(isCapabilityResponse("\x1b[?1016;2$y")).toBe(true)
  })
})
