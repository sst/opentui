export const VIDEO_FRAME_WIDTH = 192
export const RECEIVER_WIDTH = 56
export const RECEIVER_HEIGHT = 28
export const RECEIVER_CELL_COUNT = RECEIVER_WIDTH * RECEIVER_HEIGHT
const TERMINAL_CELL_ASPECT = 2
const COLOR_HUE_BINS = 24

export interface VideoFrameColor {
  lightness: number
  a: number
  b: number
  chroma: number
  hue: number
  confidence: number
}

export function smoothVideoFrameColor(
  previous: VideoFrameColor | null,
  next: VideoFrameColor | null,
  deltaMs: number,
  responseMs: number,
): VideoFrameColor | null {
  if (!next) return previous
  if (!previous) return next
  const safeDeltaMs = Number.isFinite(deltaMs) ? Math.max(0, Math.min(250, deltaMs)) : 0
  const progress = 1 - Math.exp(-safeDeltaMs / Math.max(1, responseMs))
  const lightness = previous.lightness + (next.lightness - previous.lightness) * progress
  const a = previous.a + (next.a - previous.a) * progress
  const b = previous.b + (next.b - previous.b) * progress
  const chroma = Math.hypot(a, b)
  return {
    lightness,
    a,
    b,
    chroma,
    hue: (Math.atan2(b, a) * 180) / Math.PI + (b < 0 ? 360 : 0),
    confidence: previous.confidence + (next.confidence - previous.confidence) * progress,
  }
}

export interface MotionVector {
  x: number
  y: number
}

export interface VideoFrameAnalysis {
  luminance: Float32Array
  intensity: Float32Array
  edges: Float32Array
  detail: Float32Array
  difference: Float32Array
  motionMagnitude: number
  motionCentroid: MotionVector
  motionDirection: MotionVector
  luminanceCentroid: MotionVector
  sceneColor: VideoFrameColor | null
  accentColor: VideoFrameColor | null
}

const EMPTY_VECTOR: MotionVector = { x: 0, y: 0 }

function srgbToLinear(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function rgbToOklab(red: number, green: number, blue: number): VideoFrameColor {
  const r = srgbToLinear(red)
  const g = srgbToLinear(green)
  const b = srgbToLinear(blue)
  const lRoot = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const mRoot = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const sRoot = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot
  const bValue = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot
  const chroma = Math.hypot(a, bValue)
  return {
    lightness,
    a,
    b: bValue,
    chroma,
    hue: (Math.atan2(bValue, a) * 180) / Math.PI + (bValue < 0 ? 360 : 0),
    confidence: 0,
  }
}

function accumulatedColor(
  lightness: number,
  a: number,
  b: number,
  weight: number,
  totalWeight: number,
): VideoFrameColor {
  const normalizedLightness = lightness / weight
  const normalizedA = a / weight
  const normalizedB = b / weight
  const chroma = Math.hypot(normalizedA, normalizedB)
  return {
    lightness: normalizedLightness,
    a: normalizedA,
    b: normalizedB,
    chroma,
    hue: (Math.atan2(normalizedB, normalizedA) * 180) / Math.PI + (normalizedB < 0 ? 360 : 0),
    confidence: Math.min(1, weight / Math.max(0.000001, totalWeight)),
  }
}

function normalizedCoordinate(index: number, length: number): number {
  return ((index + 0.5) / length) * 2 - 1
}

function calculateCentroid(values: Float32Array): MotionVector {
  let total = 0
  let weightedX = 0
  let weightedY = 0
  for (let row = 0; row < RECEIVER_HEIGHT; row += 1) {
    for (let column = 0; column < RECEIVER_WIDTH; column += 1) {
      const value = values[row * RECEIVER_WIDTH + column] ?? 0
      total += value
      weightedX += value * normalizedCoordinate(column, RECEIVER_WIDTH)
      weightedY += value * normalizedCoordinate(row, RECEIVER_HEIGHT)
    }
  }
  return total > 0.000001 ? { x: weightedX / total, y: weightedY / total } : EMPTY_VECTOR
}

function calculateEdges(luminance: Float32Array): Float32Array {
  const edges = new Float32Array(RECEIVER_CELL_COUNT)
  for (let row = 0; row < RECEIVER_HEIGHT; row += 1) {
    const above = Math.max(0, row - 1)
    const below = Math.min(RECEIVER_HEIGHT - 1, row + 1)
    for (let column = 0; column < RECEIVER_WIDTH; column += 1) {
      const left = Math.max(0, column - 1)
      const right = Math.min(RECEIVER_WIDTH - 1, column + 1)
      const horizontal = (luminance[row * RECEIVER_WIDTH + right] ?? 0) - (luminance[row * RECEIVER_WIDTH + left] ?? 0)
      const vertical =
        (luminance[below * RECEIVER_WIDTH + column] ?? 0) - (luminance[above * RECEIVER_WIDTH + column] ?? 0)
      edges[row * RECEIVER_WIDTH + column] = Math.min(1, Math.hypot(horizontal, vertical))
    }
  }
  return edges
}

function calculateDetail(intensity: Float32Array, edges: Float32Array): Float32Array {
  const detail = new Float32Array(RECEIVER_CELL_COUNT)
  for (let row = 0; row < RECEIVER_HEIGHT; row += 1) {
    for (let column = 0; column < RECEIVER_WIDTH; column += 1) {
      let neighborhood = 0
      let samples = 0
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sampleRow = Math.max(0, Math.min(RECEIVER_HEIGHT - 1, row + offsetY))
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleColumn = Math.max(0, Math.min(RECEIVER_WIDTH - 1, column + offsetX))
          neighborhood += intensity[sampleRow * RECEIVER_WIDTH + sampleColumn] ?? 0
          samples += 1
        }
      }
      const index = row * RECEIVER_WIDTH + column
      const localContrast = Math.abs((intensity[index] ?? 0) - neighborhood / samples)
      detail[index] = Math.min(1, (edges[index] ?? 0) * 0.72 + localContrast * 1.8)
    }
  }
  return detail
}

function normalizeLuminance(luminance: Float32Array): Float32Array {
  const bins = new Uint32Array(64)
  for (const value of luminance) bins[Math.min(bins.length - 1, Math.floor(value * bins.length))]! += 1
  const lowTarget = Math.floor(luminance.length * 0.05)
  const highTarget = Math.floor(luminance.length * 0.95)
  let count = 0
  let lowBin = 0
  let highBin = bins.length - 1
  for (let index = 0; index < bins.length; index += 1) {
    count += bins[index]!
    if (count >= lowTarget) {
      lowBin = index
      break
    }
  }
  count = 0
  for (let index = 0; index < bins.length; index += 1) {
    count += bins[index]!
    if (count >= highTarget) {
      highBin = index
      break
    }
  }

  const low = lowBin / bins.length
  const high = (highBin + 1) / bins.length
  const range = high - low
  const intensity = new Float32Array(luminance.length)
  for (let index = 0; index < luminance.length; index += 1) {
    const value = range > 0.08 ? ((luminance[index] ?? 0) - low) / range : (luminance[index] ?? 0)
    intensity[index] = Math.max(0, Math.min(1, value)) ** 0.82
  }
  return intensity
}

export function analyzeVideoFrame(
  rgba: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  previous: VideoFrameAnalysis | null = null,
): VideoFrameAnalysis {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError("video frame dimensions must be positive integers")
  }
  const expectedLength = sourceWidth * sourceHeight * 4
  if (rgba.length !== expectedLength) throw new RangeError(`RGBA frame must contain exactly ${expectedLength} bytes`)

  const sourceLuminance = new Float32Array(sourceWidth * sourceHeight)
  for (let index = 0; index < sourceLuminance.length; index += 1) {
    const offset = index * 4
    sourceLuminance[index] =
      ((rgba[offset] ?? 0) * 0.2126 + (rgba[offset + 1] ?? 0) * 0.7152 + (rgba[offset + 2] ?? 0) * 0.0722) / 255
  }
  const sourceAspect = sourceWidth / sourceHeight
  const receiverAspect = RECEIVER_WIDTH / RECEIVER_HEIGHT / TERMINAL_CELL_ASPECT
  const cropWidth = sourceAspect > receiverAspect ? Math.max(1, Math.round(sourceHeight * receiverAspect)) : sourceWidth
  const cropHeight =
    sourceAspect > receiverAspect ? sourceHeight : Math.max(1, Math.round(sourceWidth / receiverAspect))
  const cropLeft = Math.floor((sourceWidth - cropWidth) / 2)
  const cropTop = Math.floor((sourceHeight - cropHeight) / 2)
  const cropLuminance = new Float32Array(cropWidth * cropHeight)
  for (let row = 0; row < cropHeight; row += 1) {
    const sourceStart = (cropTop + row) * sourceWidth + cropLeft
    cropLuminance.set(sourceLuminance.subarray(sourceStart, sourceStart + cropWidth), row * cropWidth)
  }
  const cropIntensity = normalizeLuminance(cropLuminance)
  const luminance = new Float32Array(RECEIVER_CELL_COUNT)
  const intensity = new Float32Array(RECEIVER_CELL_COUNT)
  const hueWeights = new Float32Array(COLOR_HUE_BINS)
  const hueLightness = new Float32Array(COLOR_HUE_BINS)
  const hueA = new Float32Array(COLOR_HUE_BINS)
  const hueB = new Float32Array(COLOR_HUE_BINS)
  const hueCellCounts = new Uint16Array(COLOR_HUE_BINS)
  let sceneWeight = 0
  let colorCellCount = 0
  for (let row = 0; row < RECEIVER_HEIGHT; row += 1) {
    const sourceTop = cropTop + Math.floor((row * cropHeight) / RECEIVER_HEIGHT)
    const sourceBottom =
      cropTop + Math.max(sourceTop - cropTop + 1, Math.floor(((row + 1) * cropHeight) / RECEIVER_HEIGHT))
    for (let column = 0; column < RECEIVER_WIDTH; column += 1) {
      const sourceLeft = cropLeft + Math.floor((column * cropWidth) / RECEIVER_WIDTH)
      const sourceRight =
        cropLeft + Math.max(sourceLeft - cropLeft + 1, Math.floor(((column + 1) * cropWidth) / RECEIVER_WIDTH))
      let rawTotal = 0
      let intensityTotal = 0
      let redTotal = 0
      let greenTotal = 0
      let blueTotal = 0
      let sampleCount = 0
      for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY += 1) {
        for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX += 1) {
          const sourceIndex = sourceY * sourceWidth + sourceX
          const cropIndex = (sourceY - cropTop) * cropWidth + sourceX - cropLeft
          rawTotal += sourceLuminance[sourceIndex] ?? 0
          intensityTotal += cropIntensity[cropIndex] ?? 0
          const rgbaOffset = sourceIndex * 4
          redTotal += rgba[rgbaOffset] ?? 0
          greenTotal += rgba[rgbaOffset + 1] ?? 0
          blueTotal += rgba[rgbaOffset + 2] ?? 0
          sampleCount += 1
        }
      }
      const index = row * RECEIVER_WIDTH + column
      luminance[index] = rawTotal / sampleCount
      intensity[index] = intensityTotal / sampleCount
      const color = rgbToOklab(redTotal / sampleCount, greenTotal / sampleCount, blueTotal / sampleCount)
      const lightnessWeight = smoothColorWindow(color.lightness)
      const weight = Math.max(0, color.chroma - 0.018) * lightnessWeight
      if (weight > 0) {
        colorCellCount += 1
        sceneWeight += weight
        const hueBin = Math.min(COLOR_HUE_BINS - 1, Math.floor((color.hue / 360) * COLOR_HUE_BINS))
        hueCellCounts[hueBin]! += 1
        hueWeights[hueBin]! += weight
        hueLightness[hueBin]! += color.lightness * weight
        hueA[hueBin]! += color.a * weight
        hueB[hueBin]! += color.b * weight
      }
    }
  }

  const hueNeighborhoodWeight = (center: number): number =>
    hueWeights[(center + COLOR_HUE_BINS - 1) % COLOR_HUE_BINS]! +
    hueWeights[center]! +
    hueWeights[(center + 1) % COLOR_HUE_BINS]!
  const hueNeighborhoodCellCount = (center: number): number =>
    hueCellCounts[(center + COLOR_HUE_BINS - 1) % COLOR_HUE_BINS]! +
    hueCellCounts[center]! +
    hueCellCounts[(center + 1) % COLOR_HUE_BINS]!
  const hueBinDistance = (left: number, right: number): number => {
    const distance = Math.abs(left - right)
    return Math.min(distance, COLOR_HUE_BINS - distance)
  }
  let sceneBin = -1
  for (let bin = 0; bin < COLOR_HUE_BINS; bin += 1) {
    if (hueNeighborhoodCellCount(bin) < RECEIVER_CELL_COUNT * 0.02) continue
    if (sceneBin === -1 || hueNeighborhoodWeight(bin) > hueNeighborhoodWeight(sceneBin)) sceneBin = bin
  }
  let accentBin = -1
  for (let bin = 0; bin < COLOR_HUE_BINS; bin += 1) {
    if (sceneBin < 0) break
    if (hueBinDistance(bin, sceneBin) <= 2) continue
    if (hueNeighborhoodCellCount(bin) < RECEIVER_CELL_COUNT * 0.02) continue
    if (accentBin === -1 || hueNeighborhoodWeight(bin) > hueNeighborhoodWeight(accentBin)) accentBin = bin
  }
  const neighborhoodColor = (center: number): { color: VideoFrameColor; cellCount: number } | null => {
    if (center < 0) return null
    let weight = 0
    let lightness = 0
    let a = 0
    let b = 0
    let cellCount = 0
    for (const offset of [-1, 0, 1]) {
      const bin = (center + offset + COLOR_HUE_BINS) % COLOR_HUE_BINS
      weight += hueWeights[bin]!
      lightness += hueLightness[bin]!
      a += hueA[bin]!
      b += hueB[bin]!
      cellCount += hueCellCounts[bin]!
    }
    if (weight <= 0.04 || cellCount < RECEIVER_CELL_COUNT * 0.02) return null
    return { color: accumulatedColor(lightness, a, b, weight, sceneWeight), cellCount }
  }
  const sceneNeighborhood = neighborhoodColor(sceneBin)
  const accentNeighborhood = neighborhoodColor(accentBin)
  const stableSceneColor = sceneNeighborhood?.color ?? null
  const accentColor = accentNeighborhood?.color ?? stableSceneColor
  if (stableSceneColor) stableSceneColor.confidence = sceneNeighborhood!.cellCount / RECEIVER_CELL_COUNT
  if (accentColor)
    accentColor.confidence = (accentNeighborhood?.cellCount ?? sceneNeighborhood?.cellCount ?? 0) / RECEIVER_CELL_COUNT

  const difference = new Float32Array(RECEIVER_CELL_COUNT)
  let differenceTotal = 0
  if (previous) {
    for (let index = 0; index < difference.length; index += 1) {
      const value = Math.abs((luminance[index] ?? 0) - (previous.luminance[index] ?? 0))
      difference[index] = value
      differenceTotal += value
    }
  }
  const luminanceCentroid = calculateCentroid(luminance)
  const previousCentroid = previous?.luminanceCentroid ?? luminanceCentroid
  const edges = calculateEdges(intensity)
  return {
    luminance,
    intensity,
    edges,
    detail: calculateDetail(intensity, edges),
    difference,
    motionMagnitude: differenceTotal / RECEIVER_CELL_COUNT,
    motionCentroid: calculateCentroid(difference),
    motionDirection: {
      x: luminanceCentroid.x - previousCentroid.x,
      y: luminanceCentroid.y - previousCentroid.y,
    },
    luminanceCentroid,
    sceneColor: stableSceneColor,
    accentColor,
  }
}

function smoothColorWindow(lightness: number): number {
  const dark = Math.max(0, Math.min(1, (lightness - 0.08) / 0.14))
  const bright = Math.max(0, Math.min(1, (0.995 - lightness) / 0.095))
  return dark * bright
}
