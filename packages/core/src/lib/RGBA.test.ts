import { test, expect, describe } from "bun:test"
import { RGBA, hexToRgb, rgbToHex, hsvToRgb, parseColor } from "./RGBA"

describe("RGBA class", () => {
  describe("constructor", () => {
    test("creates RGBA with Float32Array buffer", () => {
      const buffer = new Float32Array([0.5, 0.6, 0.7, 0.8])
      const rgba = new RGBA(buffer)
      expect(rgba.buffer).toBe(buffer)
    })

    test("buffer is mutable reference", () => {
      const buffer = new Float32Array([0.5, 0.6, 0.7, 0.8])
      const rgba = new RGBA(buffer)
      buffer[0] = 0.9
      expect(rgba.r).toBeCloseTo(0.9, 5)
    })
  })

  describe("fromArray", () => {
    test("creates RGBA from Float32Array", () => {
      const array = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const rgba = RGBA.fromArray(array)
      expect(rgba.r).toBeCloseTo(0.1, 5)
      expect(rgba.g).toBeCloseTo(0.2, 5)
      expect(rgba.b).toBeCloseTo(0.3, 5)
      expect(rgba.a).toBeCloseTo(0.4, 5)
    })

    test("uses same buffer reference", () => {
      const array = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const rgba = RGBA.fromArray(array)
      expect(rgba.buffer).toBe(array)
    })
  })

  describe("fromValues", () => {
    test("creates RGBA from individual values", () => {
      const rgba = RGBA.fromValues(0.2, 0.4, 0.6, 0.8)
      expect(rgba.r).toBeCloseTo(0.2, 5)
      expect(rgba.g).toBeCloseTo(0.4, 5)
      expect(rgba.b).toBeCloseTo(0.6, 5)
      expect(rgba.a).toBeCloseTo(0.8, 5)
    })

    test("defaults alpha to 1.0 when not provided", () => {
      const rgba = RGBA.fromValues(0.5, 0.5, 0.5)
      expect(rgba.a).toBe(1.0)
    })

    test("handles zero values", () => {
      const rgba = RGBA.fromValues(0, 0, 0, 0)
      expect(rgba.r).toBe(0)
      expect(rgba.g).toBe(0)
      expect(rgba.b).toBe(0)
      expect(rgba.a).toBe(0)
    })

    test("handles values greater than 1", () => {
      const rgba = RGBA.fromValues(1.5, 2.0, 2.5, 3.0)
      expect(rgba.r).toBe(1.5)
      expect(rgba.g).toBe(2.0)
      expect(rgba.b).toBe(2.5)
      expect(rgba.a).toBe(3.0)
    })

    test("handles negative values", () => {
      const rgba = RGBA.fromValues(-0.5, -0.2, -0.1, -0.3)
      expect(rgba.r).toBeCloseTo(-0.5, 5)
      expect(rgba.g).toBeCloseTo(-0.2, 5)
      expect(rgba.b).toBeCloseTo(-0.1, 5)
      expect(rgba.a).toBeCloseTo(-0.3, 5)
    })
  })

  describe("fromInts", () => {
    test("creates RGBA from integer values (0-255)", () => {
      const rgba = RGBA.fromInts(255, 128, 64, 255)
      expect(rgba.r).toBeCloseTo(1.0, 2)
      expect(rgba.g).toBeCloseTo(0.502, 2)
      expect(rgba.b).toBeCloseTo(0.251, 2)
      expect(rgba.a).toBeCloseTo(1.0, 2)
    })

    test("defaults alpha to 255 when not provided", () => {
      const rgba = RGBA.fromInts(100, 150, 200)
      expect(rgba.a).toBeCloseTo(1.0, 2)
    })

    test("handles zero values", () => {
      const rgba = RGBA.fromInts(0, 0, 0, 0)
      expect(rgba.r).toBe(0)
      expect(rgba.g).toBe(0)
      expect(rgba.b).toBe(0)
      expect(rgba.a).toBe(0)
    })

    test("handles max values (255)", () => {
      const rgba = RGBA.fromInts(255, 255, 255, 255)
      expect(rgba.r).toBeCloseTo(1.0, 2)
      expect(rgba.g).toBeCloseTo(1.0, 2)
      expect(rgba.b).toBeCloseTo(1.0, 2)
      expect(rgba.a).toBeCloseTo(1.0, 2)
    })

    test("converts mid-range values correctly", () => {
      const rgba = RGBA.fromInts(127, 127, 127, 127)
      expect(rgba.r).toBeCloseTo(0.498, 2)
      expect(rgba.g).toBeCloseTo(0.498, 2)
      expect(rgba.b).toBeCloseTo(0.498, 2)
      expect(rgba.a).toBeCloseTo(0.498, 2)
    })

    test("handles values greater than 255", () => {
      const rgba = RGBA.fromInts(300, 400, 500, 600)
      expect(rgba.r).toBeCloseTo(1.176, 2)
      expect(rgba.g).toBeCloseTo(1.569, 2)
      expect(rgba.b).toBeCloseTo(1.961, 2)
      expect(rgba.a).toBeCloseTo(2.353, 2)
    })
  })

  describe("fromHex", () => {
    test("creates RGBA from hex string", () => {
      const rgba = RGBA.fromHex("#FF8040")
      expect(rgba.r).toBeCloseTo(1.0, 2)
      expect(rgba.g).toBeCloseTo(0.502, 2)
      expect(rgba.b).toBeCloseTo(0.251, 2)
      expect(rgba.a).toBe(1)
    })

    test("creates RGBA from 8-digit hex with alpha", () => {
      const rgba = RGBA.fromHex("#FF804080")
      expect(rgba.r).toBeCloseTo(1.0, 2)
      expect(rgba.g).toBeCloseTo(0.502, 2)
      expect(rgba.b).toBeCloseTo(0.251, 2)
      expect(rgba.a).toBeCloseTo(0.502, 2)
    })

    test("creates RGBA from 4-digit hex with alpha", () => {
      const rgba = RGBA.fromHex("#F808")
      expect(rgba.r).toBeCloseTo(1.0, 2)
      expect(rgba.g).toBeCloseTo(0.533, 2)
      expect(rgba.b).toBeCloseTo(0.0, 2)
      expect(rgba.a).toBeCloseTo(0.533, 2)
    })
  })

  describe("toInts", () => {
    test("converts float values to integers (0-255)", () => {
      const rgba = RGBA.fromValues(1.0, 0.5, 0.25, 0.75)
      const ints = rgba.toInts()
      expect(ints).toEqual([255, 128, 64, 191])
    })

    test("handles zero values", () => {
      const rgba = RGBA.fromValues(0, 0, 0, 0)
      const ints = rgba.toInts()
      expect(ints).toEqual([0, 0, 0, 0])
    })

    test("rounds to nearest integer", () => {
      const rgba = RGBA.fromValues(0.501, 0.499, 0.5, 1.0)
      const ints = rgba.toInts()
      expect(ints).toEqual([128, 127, 128, 255])
    })

    test("handles out of range values when converting", () => {
      const rgba = RGBA.fromValues(1.5, -0.5, 2.0, 0.5)
      const ints = rgba.toInts()
      expect(ints[0]).toBe(383)
      expect(ints[1]).toBe(-127)
      expect(ints[2]).toBe(510)
      expect(ints[3]).toBe(128)
    })
  })

  describe("getters", () => {
    test("r getter returns red value", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      expect(rgba.r).toBeCloseTo(0.1, 5)
    })

    test("g getter returns green value", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      expect(rgba.g).toBeCloseTo(0.2, 5)
    })

    test("b getter returns blue value", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      expect(rgba.b).toBeCloseTo(0.3, 5)
    })

    test("a getter returns alpha value", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      expect(rgba.a).toBeCloseTo(0.4, 5)
    })
  })

  describe("setters", () => {
    test("r setter updates red value", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      rgba.r = 0.9
      expect(rgba.r).toBeCloseTo(0.9, 5)
      expect(rgba.buffer[0]).toBeCloseTo(0.9, 5)
    })

    test("g setter updates green value", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      rgba.g = 0.9
      expect(rgba.g).toBeCloseTo(0.9, 5)
      expect(rgba.buffer[1]).toBeCloseTo(0.9, 5)
    })

    test("b setter updates blue value", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      rgba.b = 0.9
      expect(rgba.b).toBeCloseTo(0.9, 5)
      expect(rgba.buffer[2]).toBeCloseTo(0.9, 5)
    })

    test("a setter updates alpha value", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      rgba.a = 0.9
      expect(rgba.a).toBeCloseTo(0.9, 5)
      expect(rgba.buffer[3]).toBeCloseTo(0.9, 5)
    })

    test("setters modify underlying buffer", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      rgba.r = 0.5
      rgba.g = 0.6
      rgba.b = 0.7
      rgba.a = 0.8
      expect(rgba.buffer[0]).toBeCloseTo(0.5, 5)
      expect(rgba.buffer[1]).toBeCloseTo(0.6, 5)
      expect(rgba.buffer[2]).toBeCloseTo(0.7, 5)
      expect(rgba.buffer[3]).toBeCloseTo(0.8, 5)
    })
  })

  describe("map", () => {
    test("applies function to all components", () => {
      const rgba = RGBA.fromValues(0.5, 0.6, 0.7, 0.8)
      const result = rgba.map((x) => x * 2)
      expect(result[0]).toBeCloseTo(1.0, 5)
      expect(result[1]).toBeCloseTo(1.2, 5)
      expect(result[2]).toBeCloseTo(1.4, 5)
      expect(result[3]).toBeCloseTo(1.6, 5)
    })

    test("can return different types", () => {
      const rgba = RGBA.fromValues(0.1, 0.2, 0.3, 0.4)
      const result = rgba.map((x) => Math.round(x * 255).toString())
      expect(result).toEqual(["26", "51", "77", "102"])
    })

    test("works with identity function", () => {
      const rgba = RGBA.fromValues(0.5, 0.6, 0.7, 0.8)
      const result = rgba.map((x) => x)
      expect(result[0]).toBeCloseTo(0.5, 5)
      expect(result[1]).toBeCloseTo(0.6, 5)
      expect(result[2]).toBeCloseTo(0.7, 5)
      expect(result[3]).toBeCloseTo(0.8, 5)
    })

    test("returns array in correct order (r, g, b, a)", () => {
      const rgba = RGBA.fromValues(1, 2, 3, 4)
      const result = rgba.map((x) => x)
      expect(result[0]).toBe(1)
      expect(result[1]).toBe(2)
      expect(result[2]).toBe(3)
      expect(result[3]).toBe(4)
    })
  })

  describe("toString", () => {
    test("formats as rgba string with 2 decimal places", () => {
      const rgba = RGBA.fromValues(0.5, 0.6, 0.7, 0.8)
      expect(rgba.toString()).toBe("rgba(0.50, 0.60, 0.70, 0.80)")
    })

    test("handles zero values", () => {
      const rgba = RGBA.fromValues(0, 0, 0, 0)
      expect(rgba.toString()).toBe("rgba(0.00, 0.00, 0.00, 0.00)")
    })

    test("handles max values", () => {
      const rgba = RGBA.fromValues(1, 1, 1, 1)
      expect(rgba.toString()).toBe("rgba(1.00, 1.00, 1.00, 1.00)")
    })

    test("rounds to 2 decimal places", () => {
      const rgba = RGBA.fromValues(0.12345, 0.6789, 0.11111, 0.99999)
      expect(rgba.toString()).toBe("rgba(0.12, 0.68, 0.11, 1.00)")
    })

    test("handles negative values", () => {
      const rgba = RGBA.fromValues(-0.5, -0.2, -0.1, -0.3)
      expect(rgba.toString()).toBe("rgba(-0.50, -0.20, -0.10, -0.30)")
    })

    test("handles values greater than 1", () => {
      const rgba = RGBA.fromValues(1.5, 2.0, 2.5, 3.0)
      expect(rgba.toString()).toBe("rgba(1.50, 2.00, 2.50, 3.00)")
    })
  })
})

describe("hexToRgb", () => {
  test("converts 6-digit hex with # prefix", () => {
    const rgba = hexToRgb("#FF8040")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts 6-digit hex without # prefix", () => {
    const rgba = hexToRgb("FF8040")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBe(1)
  })

  test("expands 3-digit hex to 6-digit", () => {
    const rgba = hexToRgb("#F80")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.533, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("expands 3-digit hex without # prefix", () => {
    const rgba = hexToRgb("F80")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.533, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("handles lowercase hex", () => {
    const rgba = hexToRgb("#ff8040")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBe(1)
  })

  test("handles mixed case hex", () => {
    const rgba = hexToRgb("#Ff8040")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts black (#000000)", () => {
    const rgba = hexToRgb("#000000")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("converts white (#FFFFFF)", () => {
    const rgba = hexToRgb("#FFFFFF")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts red (#FF0000)", () => {
    const rgba = hexToRgb("#FF0000")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("converts green (#00FF00)", () => {
    const rgba = hexToRgb("#00FF00")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("converts blue (#0000FF)", () => {
    const rgba = hexToRgb("#0000FF")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("returns magenta for invalid hex", () => {
    const rgba = hexToRgb("GGGGGG")
    expect(rgba.r).toBe(1)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(1)
    expect(rgba.a).toBe(1)
  })

  test("returns magenta for too short hex", () => {
    const rgba = hexToRgb("FF")
    expect(rgba.r).toBe(1)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(1)
    expect(rgba.a).toBe(1)
  })

  test("returns magenta for too long hex", () => {
    const rgba = hexToRgb("FF80401234")
    expect(rgba.r).toBe(1)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(1)
    expect(rgba.a).toBe(1)
  })

  test("returns magenta for empty string", () => {
    const rgba = hexToRgb("")
    expect(rgba.r).toBe(1)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(1)
    expect(rgba.a).toBe(1)
  })

  test("returns magenta for special characters", () => {
    const rgba = hexToRgb("#FF@040")
    expect(rgba.r).toBe(1)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(1)
    expect(rgba.a).toBe(1)
  })

  test("converts 8-digit hex with alpha channel", () => {
    const rgba = hexToRgb("#FF804080")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBeCloseTo(0.502, 2)
  })

  test("converts 8-digit hex without # prefix", () => {
    const rgba = hexToRgb("FF804080")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBeCloseTo(0.502, 2)
  })

  test("converts 4-digit hex with alpha channel", () => {
    const rgba = hexToRgb("#F808")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.533, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBeCloseTo(0.533, 2)
  })

  test("converts 4-digit hex without # prefix", () => {
    const rgba = hexToRgb("F808")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.533, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBeCloseTo(0.533, 2)
  })

  test("converts 8-digit hex with full alpha (FF)", () => {
    const rgba = hexToRgb("#FF8040FF")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBeCloseTo(1.0, 2)
  })

  test("converts 8-digit hex with zero alpha", () => {
    const rgba = hexToRgb("#FF804000")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBe(0)
  })

  test("converts 4-digit hex with full alpha (F)", () => {
    const rgba = hexToRgb("#F80F")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.533, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBeCloseTo(1.0, 2)
  })

  test("converts 4-digit hex with zero alpha", () => {
    const rgba = hexToRgb("#F800")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.533, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBe(0)
  })
})

describe("rgbToHex", () => {
  test("converts RGBA to hex string", () => {
    const rgba = RGBA.fromInts(255, 128, 64, 255)
    expect(rgbToHex(rgba)).toBe("#ff8040")
  })

  test("converts black to #000000", () => {
    const rgba = RGBA.fromValues(0, 0, 0, 1)
    expect(rgbToHex(rgba)).toBe("#000000")
  })

  test("converts white to #ffffff", () => {
    const rgba = RGBA.fromValues(1, 1, 1, 1)
    expect(rgbToHex(rgba)).toBe("#ffffff")
  })

  test("converts red to #ff0000", () => {
    const rgba = RGBA.fromValues(1, 0, 0, 1)
    expect(rgbToHex(rgba)).toBe("#ff0000")
  })

  test("converts green to #00ff00", () => {
    const rgba = RGBA.fromValues(0, 1, 0, 1)
    expect(rgbToHex(rgba)).toBe("#00ff00")
  })

  test("converts blue to #0000ff", () => {
    const rgba = RGBA.fromValues(0, 0, 1, 1)
    expect(rgbToHex(rgba)).toBe("#0000ff")
  })

  test("includes alpha channel when not fully opaque", () => {
    const rgba = RGBA.fromInts(255, 128, 64, 128)
    expect(rgbToHex(rgba)).toBe("#ff804080")
  })

  test("clamps values below 0 to 0", () => {
    const rgba = RGBA.fromValues(-0.5, -0.2, -0.1, 1)
    expect(rgbToHex(rgba)).toBe("#000000")
  })

  test("clamps values above 1 to 1", () => {
    const rgba = RGBA.fromValues(1.5, 2.0, 3.0, 1)
    expect(rgbToHex(rgba)).toBe("#ffffff")
  })

  test("rounds mid-range values correctly", () => {
    const rgba = RGBA.fromInts(127, 127, 127, 255)
    expect(rgbToHex(rgba)).toBe("#7f7f7f")
  })

  test("pads single digit hex with leading zero", () => {
    const rgba = RGBA.fromValues(0.02, 0.02, 0.02, 1)
    expect(rgbToHex(rgba)).toBe("#050505")
  })

  test("converts gray values correctly", () => {
    const rgba = RGBA.fromValues(0.5, 0.5, 0.5, 1)
    expect(rgbToHex(rgba)).toBe("#7f7f7f")
  })

  test("includes alpha channel when alpha is not 1.0", () => {
    const rgba = RGBA.fromInts(255, 128, 64, 128)
    expect(rgbToHex(rgba)).toBe("#ff804080")
  })

  test("excludes alpha channel when alpha is 1.0", () => {
    const rgba = RGBA.fromInts(255, 128, 64, 255)
    expect(rgbToHex(rgba)).toBe("#ff8040")
  })

  test("includes alpha channel for transparent color", () => {
    const rgba = RGBA.fromValues(1, 0, 0, 0)
    expect(rgbToHex(rgba)).toBe("#ff000000")
  })

  test("includes alpha channel for semi-transparent", () => {
    const rgba = RGBA.fromValues(0, 1, 0, 0.5)
    expect(rgbToHex(rgba)).toBe("#00ff007f")
  })

  test("excludes alpha for fully opaque black", () => {
    const rgba = RGBA.fromValues(0, 0, 0, 1)
    expect(rgbToHex(rgba)).toBe("#000000")
  })
})

describe("hsvToRgb", () => {
  test("converts HSV to RGB (red)", () => {
    const rgba = hsvToRgb(0, 1, 1)
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.0, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV to RGB (green)", () => {
    const rgba = hsvToRgb(120, 1, 1)
    expect(rgba.r).toBeCloseTo(0.0, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV to RGB (blue)", () => {
    const rgba = hsvToRgb(240, 1, 1)
    expect(rgba.r).toBeCloseTo(0.0, 2)
    expect(rgba.g).toBeCloseTo(0.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV to RGB (yellow)", () => {
    const rgba = hsvToRgb(60, 1, 1)
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV to RGB (cyan)", () => {
    const rgba = hsvToRgb(180, 1, 1)
    expect(rgba.r).toBeCloseTo(0.0, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV to RGB (magenta)", () => {
    const rgba = hsvToRgb(300, 1, 1)
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV with zero saturation to gray", () => {
    const rgba = hsvToRgb(180, 0, 0.5)
    expect(rgba.r).toBeCloseTo(0.5, 2)
    expect(rgba.g).toBeCloseTo(0.5, 2)
    expect(rgba.b).toBeCloseTo(0.5, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV with zero value to black", () => {
    const rgba = hsvToRgb(180, 1, 0)
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV to RGB (orange)", () => {
    const rgba = hsvToRgb(30, 1, 1)
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.5, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV with partial saturation", () => {
    const rgba = hsvToRgb(0, 0.5, 1)
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.5, 2)
    expect(rgba.b).toBeCloseTo(0.5, 2)
    expect(rgba.a).toBe(1)
  })

  test("converts HSV with partial value", () => {
    const rgba = hsvToRgb(0, 1, 0.5)
    expect(rgba.r).toBeCloseTo(0.5, 2)
    expect(rgba.g).toBeCloseTo(0.0, 2)
    expect(rgba.b).toBeCloseTo(0.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("handles hue > 360 (wraps around)", () => {
    const rgba1 = hsvToRgb(0, 1, 1)
    const rgba2 = hsvToRgb(360, 1, 1)
    expect(rgba1.r).toBeCloseTo(rgba2.r, 2)
    expect(rgba1.g).toBeCloseTo(rgba2.g, 2)
    expect(rgba1.b).toBeCloseTo(rgba2.b, 2)
  })

  test("handles hue = 359", () => {
    const rgba = hsvToRgb(359, 1, 1)
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.0, 2)
    expect(rgba.b).toBeCloseTo(0.0166, 2)
    expect(rgba.a).toBe(1)
  })

  test("always sets alpha to 1", () => {
    const rgba1 = hsvToRgb(0, 0, 0)
    const rgba2 = hsvToRgb(180, 0.5, 0.5)
    const rgba3 = hsvToRgb(360, 1, 1)
    expect(rgba1.a).toBe(1)
    expect(rgba2.a).toBe(1)
    expect(rgba3.a).toBe(1)
  })
})

describe("parseColor", () => {
  test("parses RGBA object directly", () => {
    const input = RGBA.fromValues(0.5, 0.6, 0.7, 0.8)
    const result = parseColor(input)
    expect(result).toBe(input)
  })

  test("parses hex string", () => {
    const rgba = parseColor("#FF8040")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.251, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses transparent keyword", () => {
    const rgba = parseColor("transparent")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(0)
  })

  test("parses TRANSPARENT (uppercase)", () => {
    const rgba = parseColor("TRANSPARENT")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(0)
  })

  test("parses black color name", () => {
    const rgba = parseColor("black")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("parses white color name", () => {
    const rgba = parseColor("white")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses red color name", () => {
    const rgba = parseColor("red")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("parses green color name", () => {
    const rgba = parseColor("green")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("parses blue color name", () => {
    const rgba = parseColor("blue")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses yellow color name", () => {
    const rgba = parseColor("yellow")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("parses cyan color name", () => {
    const rgba = parseColor("cyan")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses magenta color name", () => {
    const rgba = parseColor("magenta")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses silver color name", () => {
    const rgba = parseColor("silver")
    expect(rgba.r).toBeCloseTo(0.753, 2)
    expect(rgba.g).toBeCloseTo(0.753, 2)
    expect(rgba.b).toBeCloseTo(0.753, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses gray color name", () => {
    const rgba = parseColor("gray")
    expect(rgba.r).toBeCloseTo(0.502, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.502, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses grey color name (alternate spelling)", () => {
    const rgba = parseColor("grey")
    expect(rgba.r).toBeCloseTo(0.502, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.502, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses maroon color name", () => {
    const rgba = parseColor("maroon")
    expect(rgba.r).toBeCloseTo(0.502, 2)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("parses olive color name", () => {
    const rgba = parseColor("olive")
    expect(rgba.r).toBeCloseTo(0.502, 2)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("parses lime color name", () => {
    const rgba = parseColor("lime")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("parses aqua color name", () => {
    const rgba = parseColor("aqua")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses teal color name", () => {
    const rgba = parseColor("teal")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBeCloseTo(0.502, 2)
    expect(rgba.b).toBeCloseTo(0.502, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses navy color name", () => {
    const rgba = parseColor("navy")
    expect(rgba.r).toBe(0)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBeCloseTo(0.502, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses fuchsia color name", () => {
    const rgba = parseColor("fuchsia")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses purple color name", () => {
    const rgba = parseColor("purple")
    expect(rgba.r).toBeCloseTo(0.502, 2)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBeCloseTo(0.502, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses orange color name", () => {
    const rgba = parseColor("orange")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.647, 2)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("parses brightblack color name", () => {
    const rgba = parseColor("brightblack")
    expect(rgba.r).toBeCloseTo(0.4, 2)
    expect(rgba.g).toBeCloseTo(0.4, 2)
    expect(rgba.b).toBeCloseTo(0.4, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses brightred color name", () => {
    const rgba = parseColor("brightred")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.4, 2)
    expect(rgba.b).toBeCloseTo(0.4, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses brightgreen color name", () => {
    const rgba = parseColor("brightgreen")
    expect(rgba.r).toBeCloseTo(0.4, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(0.4, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses brightblue color name", () => {
    const rgba = parseColor("brightblue")
    expect(rgba.r).toBeCloseTo(0.4, 2)
    expect(rgba.g).toBeCloseTo(0.4, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses brightyellow color name", () => {
    const rgba = parseColor("brightyellow")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(0.4, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses brightcyan color name", () => {
    const rgba = parseColor("brightcyan")
    expect(rgba.r).toBeCloseTo(0.4, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses brightmagenta color name", () => {
    const rgba = parseColor("brightmagenta")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.4, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("parses brightwhite color name", () => {
    const rgba = parseColor("brightwhite")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(1.0, 2)
    expect(rgba.b).toBeCloseTo(1.0, 2)
    expect(rgba.a).toBe(1)
  })

  test("handles uppercase color names", () => {
    const rgba = parseColor("RED")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(0)
    expect(rgba.a).toBe(1)
  })

  test("handles mixed case color names", () => {
    const rgba = parseColor("BrightRed")
    expect(rgba.r).toBeCloseTo(1.0, 2)
    expect(rgba.g).toBeCloseTo(0.4, 2)
    expect(rgba.b).toBeCloseTo(0.4, 2)
    expect(rgba.a).toBe(1)
  })

  test("falls back to hex parser for unknown color names", () => {
    const rgba = parseColor("unknowncolor")
    expect(rgba.r).toBe(1)
    expect(rgba.g).toBe(0)
    expect(rgba.b).toBe(1)
    expect(rgba.a).toBe(1)
  })
})
