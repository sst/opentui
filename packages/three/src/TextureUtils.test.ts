import { describe, expect, it } from "bun:test"
import { Color } from "three"
import { TextureUtils } from "./TextureUtils.js"

describe("TextureUtils.createGradient", () => {
  it("clamps size 1 up to 2 instead of dividing by zero", () => {
    // size=1 makes `x / (size - 1)` and `y / (size - 1)` divide by zero,
    // producing NaN that Uint8ClampedArray silently clamps to 0 - a solid
    // black pixel instead of the requested gradient.
    const texture = TextureUtils.createGradient(1, new Color(1, 0, 0), new Color(0, 0, 1), "horizontal")
    const data = texture.image.data as Uint8ClampedArray

    expect(texture.image.width).toBe(2)
    expect(texture.image.height).toBe(2)
    // First column should be the start color (red), not black.
    expect(data[0]).toBe(255)
    expect(data[1]).toBe(0)
    expect(data[2]).toBe(0)
  })

  it("clamps size 0 up to 2", () => {
    const texture = TextureUtils.createGradient(0, new Color(1, 0, 0), new Color(0, 0, 1))
    expect(texture.image.width).toBe(2)
    expect(texture.image.height).toBe(2)
  })

  it("clamps negative size up to 2", () => {
    const texture = TextureUtils.createGradient(-5, new Color(1, 0, 0), new Color(0, 0, 1))
    expect(texture.image.width).toBe(2)
    expect(texture.image.height).toBe(2)
  })

  it("floors a non-integer size", () => {
    const texture = TextureUtils.createGradient(4.7, new Color(1, 0, 0), new Color(0, 0, 1))
    expect(texture.image.width).toBe(4)
    expect(texture.image.height).toBe(4)
  })

  it("leaves a normal size untouched", () => {
    const texture = TextureUtils.createGradient(16, new Color(1, 0, 0), new Color(0, 0, 1))
    expect(texture.image.width).toBe(16)
    expect(texture.image.height).toBe(16)
  })
})
