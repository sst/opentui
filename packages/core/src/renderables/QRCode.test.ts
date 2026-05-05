import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { BoxRenderable } from "./Box.js"
import {
  encodeQRCode,
  getQRCodeAlignmentPatternPositions,
  getQRCodeFormatBits,
  getQRCodeVersionBits,
  type EncodedQRCode,
} from "../lib/qrcode.js"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer.js"
import { QRCodeRenderable } from "./QRCode.js"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let resize: (width: number, height: number) => void
let captureCharFrame: () => string
let captureSpans: ReturnType<typeof createTestRenderer> extends Promise<infer T>
  ? T extends { captureSpans: infer TCaptureSpans }
    ? TCaptureSpans
    : never
  : never

describe("QR code ISO-derived vectors", () => {
  it("matches published alignment pattern positions", () => {
    expect(getQRCodeAlignmentPatternPositions(2)).toEqual([6, 18])
    expect(getQRCodeAlignmentPatternPositions(7)).toEqual([6, 22, 38])
    expect(getQRCodeAlignmentPatternPositions(32)).toEqual([6, 34, 60, 86, 112, 138])
    expect(getQRCodeAlignmentPatternPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170])
  })

  it("matches the published format-string example for L mask 4", () => {
    expect(toBinaryString(getQRCodeFormatBits("low", 4), 15)).toBe("110011000101111")
  })

  it("matches the published version-7 information example", () => {
    expect(toBinaryString(getQRCodeVersionBits(7), 18)).toBe("000111110010010100")
  })

  it("throws when version information is requested below version 7", () => {
    expect(() => getQRCodeVersionBits(6)).toThrow(
      "QR version information is only defined for versions 7 and above, got 6",
    )
  })
})

describe("encodeQRCode", () => {
  it("writes the dark module at the ISO-defined coordinate", () => {
    const qr = encodeQRCode("HELLO WORLD")

    expect(qr.version).toBe(1)
    expect(qr.size).toBe(21)
    expect(qr.modules[4 * qr.version + 9]![8]).toBe(true)
  })

  it("places the selected format bits in both format information regions", () => {
    const qr = encodeQRCode("HELLO WORLD", "medium")
    const expectedFormatBits = getQRCodeFormatBits("medium", qr.mask)

    expect(readPrimaryFormatBits(qr.modules)).toBe(expectedFormatBits)
    expect(readSecondaryFormatBits(qr.modules)).toBe(expectedFormatBits)
  })

  it("places version information correctly for version 7 and above", () => {
    const qr = encodeExactVersionQRCode(7)
    const expectedVersionBits = getQRCodeVersionBits(qr.version)

    expect(readTopRightVersionBits(qr.modules)).toBe(expectedVersionBits)
    expect(readBottomLeftVersionBits(qr.modules)).toBe(expectedVersionBits)
  })

  it("draws alignment patterns at the published coordinates", () => {
    const qr = encodeExactVersionQRCode(7)
    const positions = getQRCodeAlignmentPatternPositions(qr.version)

    for (let y = 0; y < positions.length; y++) {
      for (let x = 0; x < positions.length; x++) {
        const overlapsFinderCorner =
          (x === 0 && y === 0) || (x === 0 && y === positions.length - 1) || (x === positions.length - 1 && y === 0)

        if (!overlapsFinderCorner) {
          expectAlignmentPattern(qr.modules, positions[x]!, positions[y]!)
        }
      }
    }
  })
})

describe("QRCodeRenderable", () => {
  beforeEach(async () => {
    ;({
      renderer: testRenderer,
      renderOnce,
      resize,
      captureCharFrame,
      captureSpans,
    } = await createTestRenderer({
      width: 80,
      height: 40,
    }))
  })

  afterEach(() => {
    testRenderer.destroy()
  })

  it("uses the default 4-module quiet zone in its intrinsic size", async () => {
    const qr = new QRCodeRenderable(testRenderer, {
      content: "HELLO WORLD",
    })

    testRenderer.root.add(qr)
    await renderOnce()

    expect(qr.width).toBe(80)
    expect(qr.height).toBe(15)
  })

  it("updates intrinsic dimensions when the scale changes", async () => {
    const qr = new QRCodeRenderable(testRenderer, {
      content: "HELLO WORLD",
      quietZone: 2,
      scale: 1,
    })

    testRenderer.root.add(qr)
    await renderOnce()

    expect(qr.width).toBe(80)
    expect(qr.height).toBe(13)

    const initialFrame = captureCharFrame()
    expect(initialFrame).toContain("█")

    qr.scale = 2
    await renderOnce()

    expect(qr.width).toBe(80)
    expect(qr.height).toBe(25)
    expect(captureCharFrame()).not.toBe(initialFrame)
  })

  it("shrinks to fit a smaller parent height", async () => {
    const container = new BoxRenderable(testRenderer, {
      width: 60,
      height: 20,
      flexDirection: "column",
    })
    const qr = new QRCodeRenderable(testRenderer, {
      content: "HELLO WORLD",
      scale: 2,
    })

    container.add(qr)
    testRenderer.root.add(container)
    await renderOnce()

    expect(qr.width).toBe(60)
    expect(qr.height).toBe(15)
  })

  it("collapses when the available height cannot fit scale 1", async () => {
    const container = new BoxRenderable(testRenderer, {
      width: 33,
      height: 16,
      flexDirection: "column",
    })
    const qr = new QRCodeRenderable(testRenderer, {
      content: "https://opentui.com/docs/getting-started",
      quietZone: 2,
      scale: 2,
    })

    container.add(qr)
    testRenderer.root.add(container)
    await renderOnce()

    expect(qr.getLayoutNode().getComputedLayout().height).toBe(0)
    expect(captureCharFrame()).not.toContain("█")
    expect(captureCharFrame()).not.toContain("▀")
    expect(captureCharFrame()).not.toContain("▄")
  })

  it("renders fallback content when the available size cannot fit scale 1", async () => {
    const container = new BoxRenderable(testRenderer, {
      width: 24,
      height: 4,
      flexDirection: "column",
    })
    const qr = new QRCodeRenderable(testRenderer, {
      content: "https://opentui.com/docs/getting-started",
      quietZone: 2,
      scale: 2,
      fallbackContent: "Resize for QR",
      fallbackColor: "#94a3b8",
    })

    container.add(qr)
    testRenderer.root.add(container)
    await renderOnce()

    expect(captureCharFrame()).toContain("Resize for QR")
    expect(captureCharFrame()).not.toContain("█")
    expect(captureCharFrame()).not.toContain("▀")
    expect(captureCharFrame()).not.toContain("▄")
  })

  it("grows back to the preferred scale after being too small", async () => {
    const container = new BoxRenderable(testRenderer, {
      width: "100%",
      height: "100%",
      maxWidth: 72,
      maxHeight: 38,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    })
    const qr = new QRCodeRenderable(testRenderer, {
      content: "opentui.com",
      quietZone: 2,
      scale: 2,
      fallbackContent: "Resize for QR",
    })

    container.add(qr)
    testRenderer.root.add(container)
    await renderOnce()

    expect(qr.getLayoutNode().getComputedLayout().width).toBe(50)
    expect(qr.getLayoutNode().getComputedLayout().height).toBe(25)

    resize(40, 16)
    await renderOnce()

    expect(captureCharFrame()).toContain("Resize for QR")

    resize(80, 40)
    await renderOnce()

    expect(qr.getLayoutNode().getComputedLayout().width).toBe(50)
    expect(qr.getLayoutNode().getComputedLayout().height).toBe(25)
    expect(captureCharFrame()).toContain("█")
  })

  it("keeps the parent background outside the centered QR square when stretched", async () => {
    const container = new BoxRenderable(testRenderer, {
      width: 60,
      height: 20,
      backgroundColor: "#112233",
      flexDirection: "column",
    })
    const qr = new QRCodeRenderable(testRenderer, {
      content: "HELLO WORLD",
      scale: 2,
      backgroundColor: "#ffffff",
    })

    container.add(qr)
    testRenderer.root.add(container)
    await renderOnce()

    const qrRow = captureSpans().lines[2]?.spans ?? []
    expect(qrRow.length).toBeGreaterThan(1)
    expect(qrRow[0]?.bg.equals(qr.backgroundColor)).toBe(false)
    expect(qrRow.some((span) => span.bg.equals(qr.backgroundColor))).toBe(true)
    expect(qrRow[qrRow.length - 1]?.bg.equals(qr.backgroundColor)).toBe(false)
  })
})

function encodeExactVersionQRCode(targetVersion: number): EncodedQRCode {
  for (let length = 1; length <= 600; length++) {
    const qr = encodeQRCode("A".repeat(length), "high")
    if (qr.version === targetVersion) {
      return qr
    }
  }

  throw new Error(`Could not generate a QR code at version ${targetVersion}`)
}

function readPrimaryFormatBits(modules: boolean[][]): number {
  const coordinates: Array<[number, number]> = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ]

  return readBitsAtCoordinates(modules, coordinates)
}

function readSecondaryFormatBits(modules: boolean[][]): number {
  const size = modules.length
  const coordinates: Array<[number, number]> = []

  for (let i = 0; i < 8; i++) {
    coordinates.push([size - 1 - i, 8])
  }

  for (let i = 8; i < 15; i++) {
    coordinates.push([8, size - 15 + i])
  }

  return readBitsAtCoordinates(modules, coordinates)
}

function readTopRightVersionBits(modules: boolean[][]): number {
  const size = modules.length
  const coordinates: Array<[number, number]> = []

  for (let i = 0; i < 18; i++) {
    coordinates.push([size - 11 + (i % 3), Math.floor(i / 3)])
  }

  return readBitsAtCoordinates(modules, coordinates)
}

function readBottomLeftVersionBits(modules: boolean[][]): number {
  const coordinates: Array<[number, number]> = []

  for (let i = 0; i < 18; i++) {
    coordinates.push([Math.floor(i / 3), modules.length - 11 + (i % 3)])
  }

  return readBitsAtCoordinates(modules, coordinates)
}

function readBitsAtCoordinates(modules: boolean[][], coordinates: Array<[number, number]>): number {
  let bits = 0

  for (let i = 0; i < coordinates.length; i++) {
    const [x, y] = coordinates[i]!
    if (modules[y]![x]) {
      bits |= 1 << i
    }
  }

  return bits
}

function expectAlignmentPattern(modules: boolean[][], centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      const expected = distance !== 1
      expect(modules[centerY + dy]![centerX + dx]).toBe(expected)
    }
  }
}

function toBinaryString(value: number, width: number): string {
  return value.toString(2).padStart(width, "0")
}
