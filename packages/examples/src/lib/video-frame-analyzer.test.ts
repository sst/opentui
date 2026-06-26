import { expect, test } from "bun:test"

import {
  RECEIVER_HEIGHT,
  RECEIVER_WIDTH,
  VIDEO_FRAME_WIDTH,
  analyzeVideoFrame,
  smoothVideoFrameColor,
  type VideoFrameColor,
} from "./video-frame-analyzer.js"

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

function colorFrame(red: number, green: number, blue: number): Uint8Array {
  const rgba = frame()
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = red
    rgba[offset + 1] = green
    rgba[offset + 2] = blue
  }
  return rgba
}

function fillContentCell(rgba: Uint8Array, column: number, row: number, value: number): void {
  fillColorContentCell(rgba, column, row, value, value, value)
}

function fillColorContentCell(
  rgba: Uint8Array,
  column: number,
  row: number,
  red: number,
  green: number,
  blue: number,
): void {
  const sourceTop = Math.floor((row * VIDEO_FRAME_HEIGHT) / RECEIVER_HEIGHT)
  const sourceBottom = Math.max(sourceTop + 1, Math.floor(((row + 1) * VIDEO_FRAME_HEIGHT) / RECEIVER_HEIGHT))
  const sourceLeft = SOURCE_CROP_LEFT + Math.floor((column * SOURCE_CROP_WIDTH) / RECEIVER_WIDTH)
  const sourceRight =
    SOURCE_CROP_LEFT +
    Math.max(sourceLeft - SOURCE_CROP_LEFT + 1, Math.floor(((column + 1) * SOURCE_CROP_WIDTH) / RECEIVER_WIDTH))
  for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY += 1) {
    for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX += 1) {
      const source = (sourceY * VIDEO_FRAME_WIDTH + sourceX) * 4
      rgba[source] = red
      rgba[source + 1] = green
      rgba[source + 2] = blue
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
  expect(second.isSceneCut).toBe(false)
})

test("detects a hard scene cut without treating local motion as a cut", () => {
  const firstFrame = frame(20)
  const secondFrame = frame(20)
  for (let row = 0; row < VIDEO_FRAME_HEIGHT; row += 1) {
    for (let column = 0; column < VIDEO_FRAME_WIDTH / 2; column += 1) {
      const left = (row * VIDEO_FRAME_WIDTH + column) * 4
      const right = (row * VIDEO_FRAME_WIDTH + VIDEO_FRAME_WIDTH - column - 1) * 4
      firstFrame.fill(230, left, left + 3)
      secondFrame.fill(230, right, right + 3)
    }
  }
  const first = analyzeVideoFrame(firstFrame, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  const cut = analyzeVideoFrame(secondFrame, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT, first)

  expect(cut.isSceneCut).toBe(true)
  expect(cut.sceneCutScore).toBeGreaterThan(0.7)
})

test("does not classify a full-frame exposure flash as a scene cut", () => {
  const scene = frame(25)
  for (let row = 12; row < 92; row += 1) {
    for (let column = 20; column < 82; column += 1) {
      const offset = (row * VIDEO_FRAME_WIDTH + column) * 4
      scene.fill(170, offset, offset + 3)
    }
  }
  const before = analyzeVideoFrame(scene, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  const flash = analyzeVideoFrame(frame(255), VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT, before)
  const recovered = analyzeVideoFrame(scene, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT, flash)

  expect(flash.isSceneCut).toBe(false)
  expect(recovered.isSceneCut).toBe(false)
})

test("reports a framing target for an off-center subject outside the centered crop", () => {
  const rgba = frame(20)
  for (let row = 25; row < 82; row += 1) {
    for (let column = 145; column < 181; column += 1) {
      const offset = (row * VIDEO_FRAME_WIDTH + column) * 4
      rgba[offset] = 230
      rgba[offset + 1] = 230
      rgba[offset + 2] = 230
    }
  }

  const analysis = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)

  expect(analysis.framingTarget!.x).toBeGreaterThan(0.45)
  expect(Math.abs(analysis.framingTarget!.y)).toBeLessThan(0.2)
})

test("crop tracking does not manufacture motion in a static source frame", () => {
  const rgba = frame()
  for (let row = 0; row < VIDEO_FRAME_HEIGHT; row += 1) {
    for (let column = 0; column < VIDEO_FRAME_WIDTH; column += 1) {
      const value = 25 + ((column * 7 + Math.floor(column / 11) * 31 + row * 3) % 190)
      const offset = (row * VIDEO_FRAME_WIDTH + column) * 4
      rgba.fill(value, offset, offset + 3)
    }
  }
  const first = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT, null, { cropCenter: { x: 0, y: 0 } })
  const tracked = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT, first, {
    cropCenter: { x: 0.2, y: 0 },
  })

  expect(tracked.motionMagnitude).toBeLessThan(0.018)
  expect(Math.abs(tracked.motionDirection.x)).toBeLessThan(0.08)
})

test("crop tracking preserves genuine source motion", () => {
  const firstFrame = frame(25)
  const secondFrame = frame(25)
  for (let row = 8; row < 20; row += 1) {
    for (let column = 18; column < 27; column += 1) fillContentCell(firstFrame, column, row, 230)
    for (let column = 28; column < 37; column += 1) fillContentCell(secondFrame, column, row, 230)
  }
  const first = analyzeVideoFrame(firstFrame, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT, null, {
    cropCenter: { x: 0, y: 0 },
  })
  const tracked = analyzeVideoFrame(secondFrame, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT, first, {
    cropCenter: { x: 0.04, y: 0 },
  })

  expect(tracked.motionMagnitude).toBeGreaterThan(0.018)
  expect(tracked.motionDirection.x).toBeGreaterThan(0.1)
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

test("extracts scene and accent colors from the retained crop", () => {
  const analysis = analyzeVideoFrame(colorFrame(220, 45, 35), VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)

  expect(analysis.sceneColor).not.toBeNull()
  expect(analysis.accentColor).not.toBeNull()
  expect(analysis.sceneColor!.hue).toBeGreaterThan(20)
  expect(analysis.sceneColor!.hue).toBeLessThan(40)
  expect(analysis.sceneColor!.chroma).toBeGreaterThan(0.15)
})

test("excluded cover-crop colors do not affect extracted colors", () => {
  const baseline = colorFrame(35, 180, 80)
  const coloredSides = baseline.slice()
  for (let row = 0; row < VIDEO_FRAME_HEIGHT; row += 1) {
    for (let column = 0; column < SOURCE_CROP_LEFT; column += 1) {
      for (const sourceColumn of [column, VIDEO_FRAME_WIDTH - column - 1]) {
        const offset = (row * VIDEO_FRAME_WIDTH + sourceColumn) * 4
        coloredSides[offset] = 220
        coloredSides[offset + 1] = 30
        coloredSides[offset + 2] = 180
      }
    }
  }

  const baselineColor = analyzeVideoFrame(baseline, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT).sceneColor
  const coloredSidesColor = analyzeVideoFrame(coloredSides, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT).sceneColor

  expect(coloredSidesColor).toEqual(baselineColor)
})

test("neutral frames do not invent a video hue", () => {
  const analysis = analyzeVideoFrame(frame(120), VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  expect(analysis.sceneColor).toBeNull()
  expect(analysis.accentColor).toBeNull()
})

test("a tiny saturated region does not control the scene palette", () => {
  const rgba = frame(120)
  fillColorContentCell(rgba, 12, 12, 220, 20, 20)
  const analysis = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  expect(analysis.sceneColor).toBeNull()
})

test("a sparse saturated highlight cannot suppress a represented scene color", () => {
  const rgba = frame(120)
  for (let column = 4; column < 44; column += 1) fillColorContentCell(rgba, column, 12, 60, 90, 170)
  for (let column = 46; column < 56; column += 1) fillColorContentCell(rgba, column, 12, 230, 20, 190)

  const analysis = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)

  expect(analysis.sceneColor).not.toBeNull()
  expect(analysis.sceneColor!.hue).toBeGreaterThan(250)
  expect(analysis.sceneColor!.hue).toBeLessThan(280)
})

test("bright saturated colors remain eligible for extraction", () => {
  const analysis = analyzeVideoFrame(colorFrame(255, 255, 0), VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  expect(analysis.sceneColor).not.toBeNull()
  expect(analysis.sceneColor!.hue).toBeGreaterThan(100)
  expect(analysis.sceneColor!.hue).toBeLessThan(120)
})

test("complementary mixtures select a represented hue instead of their cancellation residual", () => {
  const rgba = colorFrame(0, 255, 0)
  for (let row = 0; row < RECEIVER_HEIGHT; row += 1) {
    for (let column = 36; column < RECEIVER_WIDTH; column += 1) {
      const sourceTop = Math.floor((row * VIDEO_FRAME_HEIGHT) / RECEIVER_HEIGHT)
      const sourceBottom = Math.max(sourceTop + 1, Math.floor(((row + 1) * VIDEO_FRAME_HEIGHT) / RECEIVER_HEIGHT))
      const sourceLeft = SOURCE_CROP_LEFT + Math.floor((column * SOURCE_CROP_WIDTH) / RECEIVER_WIDTH)
      const sourceRight =
        SOURCE_CROP_LEFT +
        Math.max(sourceLeft - SOURCE_CROP_LEFT + 1, Math.floor(((column + 1) * SOURCE_CROP_WIDTH) / RECEIVER_WIDTH))
      for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY += 1) {
        for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX += 1) {
          const offset = (sourceY * VIDEO_FRAME_WIDTH + sourceX) * 4
          rgba[offset] = 255
          rgba[offset + 1] = 0
          rgba[offset + 2] = 255
        }
      }
    }
  }
  const analysis = analyzeVideoFrame(rgba, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)
  expect(analysis.sceneColor).not.toBeNull()
  expect(analysis.sceneColor!.hue).toBeGreaterThan(130)
  expect(analysis.sceneColor!.hue).toBeLessThan(155)
  expect(analysis.accentColor).not.toBeNull()
  expect(analysis.accentColor!.hue).toBeGreaterThan(315)
  expect(analysis.accentColor!.hue).toBeLessThan(345)
})

test("video color smoothing follows the shortest path across hue wrap", () => {
  const color = (hue: number): VideoFrameColor => {
    const radians = (hue * Math.PI) / 180
    return {
      lightness: 0.6,
      a: Math.cos(radians) * 0.15,
      b: Math.sin(radians) * 0.15,
      chroma: 0.15,
      hue,
      confidence: 1,
    }
  }
  const smoothed = smoothVideoFrameColor(color(359), color(1), 250, 250)!
  expect(Math.min(smoothed.hue, 360 - smoothed.hue)).toBeLessThan(1)
})

test("video color smoothing holds the previous color through neutral frames", () => {
  const previous: VideoFrameColor = { lightness: 0.6, a: 0.1, b: 0.05, chroma: 0.112, hue: 26.6, confidence: 0.8 }
  expect(smoothVideoFrameColor(previous, null, 100, 400)).toBe(previous)
  expect(smoothVideoFrameColor(null, previous, 100, 400)).toBe(previous)
})

test("rejects frames that do not match their dimensions", () => {
  expect(() => analyzeVideoFrame(new Uint8Array(12), VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT)).toThrow("exactly")
})
