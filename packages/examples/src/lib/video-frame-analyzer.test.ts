import { expect, test } from "bun:test"

import { RECEIVER_HEIGHT, RECEIVER_WIDTH, VIDEO_FRAME_WIDTH, analyzeVideoFrame } from "./video-frame-analyzer.js"

const VIDEO_FRAME_HEIGHT = Math.round(VIDEO_FRAME_WIDTH / (16 / 9))
const SOURCE_CROP_WIDTH = VIDEO_FRAME_HEIGHT
const SOURCE_CROP_LEFT = Math.floor((VIDEO_FRAME_WIDTH - SOURCE_CROP_WIDTH) / 2)

function frame(fill = 0): Uint8Array {
  const rgba = new Uint8Array(VIDEO_FRAME_WIDTH * VIDEO_FRAME_HEIGHT * 4)
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = fill
    rgba[offset + 1] = fill
    rgba[offset + 2] = fill
    rgba[offset + 3] = 255
  }
  return rgba
}

function fillContentCell(rgba: Uint8Array, column: number, row: number, value: number): void {
  const sourceTop = Math.floor((row * VIDEO_FRAME_HEIGHT) / RECEIVER_HEIGHT)
  const sourceBottom = Math.max(sourceTop + 1, Math.floor(((row + 1) * VIDEO_FRAME_HEIGHT) / RECEIVER_HEIGHT))
  const sourceLeft = SOURCE_CROP_LEFT + Math.floor((column * SOURCE_CROP_WIDTH) / RECEIVER_WIDTH)
  const sourceRight =
    SOURCE_CROP_LEFT +
    Math.max(sourceLeft - SOURCE_CROP_LEFT + 1, Math.floor(((column + 1) * SOURCE_CROP_WIDTH) / RECEIVER_WIDTH))
  for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY += 1) {
    for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX += 1) {
      const source = (sourceY * VIDEO_FRAME_WIDTH + sourceX) * 4
      rgba[source] = value
      rgba[source + 1] = value
      rgba[source + 2] = value
    }
  }
}

test("reduces each source region into one receiver cell", () => {
  const rgba = frame()
  fillContentCell(rgba, 7, 4, 255)

  const analysis = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)

  expect(analysis.luminance[4 * RECEIVER_WIDTH + 7]).toBeCloseTo(1, 5)
  expect(analysis.intensity[4 * RECEIVER_WIDTH + 7]).toBeCloseTo(1, 5)
  expect(analysis.luminance[4 * RECEIVER_WIDTH + 8]).toBe(0)
  expect(analysis.motionMagnitude).toBe(0)
})

test("expands low-contrast frames for readable terminal output", () => {
  const rgba = frame(80)
  for (let row = 6; row < 19; row += 1) {
    for (let column = 14; column < 37; column += 1) fillContentCell(rgba, column, row, 120)
  }

  const analysis = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)

  expect(analysis.intensity[12 * RECEIVER_WIDTH + 25]).toBeGreaterThan(0.9)
  expect(analysis.intensity[2 * RECEIVER_WIDTH + 2]).toBeLessThan(0.1)
})

test("finds contrast edges around a bright silhouette", () => {
  const rgba = frame()
  for (let row = 8; row < 17; row += 1) {
    for (let column = 18; column < 33; column += 1) fillContentCell(rgba, column, row, 255)
  }

  const analysis = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)

  expect(analysis.edges[12 * RECEIVER_WIDTH + 18]).toBeGreaterThan(0.9)
  expect(analysis.detail[12 * RECEIVER_WIDTH + 18]).toBeGreaterThan(0.65)
  expect(analysis.edges[12 * RECEIVER_WIDTH + 25]).toBe(0)
})

test("reports motion magnitude, centroid, and direction for a moving subject", () => {
  const left = frame()
  const right = frame()
  for (let row = 10; row < 15; row += 1) {
    for (let column = 8; column < 13; column += 1) fillContentCell(left, column, row, 255)
    for (let column = RECEIVER_WIDTH - 13; column < RECEIVER_WIDTH - 8; column += 1) {
      fillContentCell(right, column, row, 255)
    }
  }

  const first = analyzeVideoFrame(left, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  const second = analyzeVideoFrame(right, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT, first)

  expect(second.motionMagnitude).toBeGreaterThan(0.015)
  expect(Math.abs(second.motionCentroid.x)).toBeLessThan(0.1)
  expect(second.motionDirection.x).toBeGreaterThan(0.8)
  expect(Math.abs(second.motionDirection.y)).toBeLessThan(0.01)
})

test("cover-crops a 16:9 frame into the terminal-corrected square receiver", () => {
  const analysis = analyzeVideoFrame(frame(160), VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  const occupiedRows = Array.from({ length: RECEIVER_HEIGHT }, (_, row) =>
    analysis.intensity.subarray(row * RECEIVER_WIDTH, (row + 1) * RECEIVER_WIDTH).some((value) => value > 0),
  )

  expect(occupiedRows.every(Boolean)).toBe(true)
  expect(RECEIVER_WIDTH).toBe(RECEIVER_HEIGHT * 2)
})

test("excluded cover-crop pixels do not control retained contrast", () => {
  const baseline = frame(80)
  for (let row = 6; row < 22; row += 1) {
    for (let column = 14; column < 42; column += 1) fillContentCell(baseline, column, row, 120)
  }
  const brightSides = baseline.slice()
  for (let row = 0; row < VIDEO_FRAME_HEIGHT; row += 1) {
    for (let column = 0; column < SOURCE_CROP_LEFT; column += 1) {
      const left = (row * VIDEO_FRAME_WIDTH + column) * 4
      const right = (row * VIDEO_FRAME_WIDTH + VIDEO_FRAME_WIDTH - column - 1) * 4
      brightSides.fill(255, left, left + 3)
      brightSides.fill(255, right, right + 3)
    }
  }

  const baselineAnalysis = analyzeVideoFrame(baseline, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  const brightSidesAnalysis = analyzeVideoFrame(brightSides, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)

  expect(brightSidesAnalysis.intensity).toEqual(baselineAnalysis.intensity)
})

test("rejects frames that do not match their dimensions", () => {
  expect(() => analyzeVideoFrame(new Uint8Array(12), VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)).toThrow("exactly")
})
