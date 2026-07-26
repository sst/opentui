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
  cropCenter: MotionVector
  framingTarget: MotionVector | null
  sceneCutScore: number
  isSceneCut: boolean
  sceneColor: VideoFrameColor | null
  accentColor: VideoFrameColor | null
  sourceHistogram: Float32Array
  sourceStructure: Float32Array
  sceneReferenceStructure: Float32Array | null
  sourceRgba: Uint8Array
  sourceLuminance: Float32Array
  previousSourceLuminance: Float32Array | null
  sourceWidth: number
  sourceHeight: number
}

export interface VideoFrameAnalysisOptions {
  cropCenter?: MotionVector
  receiverAspect?: number
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

function sourceHistogram(luminance: Float32Array): Float32Array {
  const histogram = new Float32Array(16)
  for (const value of luminance) histogram[Math.min(histogram.length - 1, Math.floor(value * histogram.length))]! += 1
  for (let index = 0; index < histogram.length; index += 1) histogram[index]! /= luminance.length
  return histogram
}

function histogramDistance(left: Float32Array, right: Float32Array): number {
  let distance = 0
  for (let index = 0; index < left.length; index += 1) distance += Math.abs((left[index] ?? 0) - (right[index] ?? 0))
  return Math.min(1, distance * 0.5)
}

const STRUCTURE_WIDTH = 12
const STRUCTURE_HEIGHT = 8

function sourceStructure(luminance: Float32Array, width: number, height: number): Float32Array {
  const gridWidth = STRUCTURE_WIDTH
  const gridHeight = STRUCTURE_HEIGHT
  const means = new Float32Array(gridWidth * gridHeight)
  let frameMean = 0
  for (const value of luminance) frameMean += value
  frameMean /= luminance.length
  let variance = 0
  for (const value of luminance) variance += (value - frameMean) ** 2
  const deviation = Math.max(0.08, Math.sqrt(variance / luminance.length))
  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    const top = Math.floor((gridY * height) / gridHeight)
    const bottom = Math.max(top + 1, Math.floor(((gridY + 1) * height) / gridHeight))
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const left = Math.floor((gridX * width) / gridWidth)
      const right = Math.max(left + 1, Math.floor(((gridX + 1) * width) / gridWidth))
      let total = 0
      for (let row = top; row < bottom; row += 1) {
        for (let column = left; column < right; column += 1) total += luminance[row * width + column] ?? 0
      }
      const mean = total / ((bottom - top) * (right - left))
      means[gridY * gridWidth + gridX] = Math.max(-1, Math.min(1, (mean - frameMean) / deviation))
    }
  }
  return means
}

function structureEnergy(structure: Float32Array): number {
  let energy = 0
  for (const value of structure) energy += Math.abs(value)
  return energy / structure.length
}

function structureDistance(left: Float32Array, right: Float32Array): number {
  let bestDistance = Number.POSITIVE_INFINITY
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
      let distance = 0
      let samples = 0
      for (let row = Math.max(0, -offsetY); row < Math.min(STRUCTURE_HEIGHT, STRUCTURE_HEIGHT - offsetY); row += 1) {
        for (
          let column = Math.max(0, -offsetX);
          column < Math.min(STRUCTURE_WIDTH, STRUCTURE_WIDTH - offsetX);
          column += 1
        ) {
          const leftIndex = row * STRUCTURE_WIDTH + column
          const rightIndex = (row + offsetY) * STRUCTURE_WIDTH + column + offsetX
          distance += Math.abs((left[leftIndex] ?? 0) - (right[rightIndex] ?? 0))
          samples += 1
        }
      }
      bestDistance = Math.min(bestDistance, distance / samples)
    }
  }
  return Math.min(1, bestDistance)
}

function calculateFramingTarget(luminance: Float32Array, width: number, height: number): MotionVector | null {
  const bins = new Uint32Array(32)
  for (const value of luminance) bins[Math.min(bins.length - 1, Math.floor(value * bins.length))]! += 1
  let backgroundBin = 0
  for (let index = 1; index < bins.length; index += 1) {
    if (bins[index]! > bins[backgroundBin]!) backgroundBin = index
  }
  const background = (backgroundBin + 0.5) / bins.length
  let total = 0
  let weightedX = 0
  let weightedY = 0
  for (let row = 1; row < height - 1; row += 2) {
    for (let column = 1; column < width - 1; column += 2) {
      const index = row * width + column
      const contrast = Math.max(0, Math.abs((luminance[index] ?? 0) - background) - 0.035)
      const edge = Math.hypot(
        (luminance[index + 1] ?? 0) - (luminance[index - 1] ?? 0),
        (luminance[index + width] ?? 0) - (luminance[index - width] ?? 0),
      )
      const weight = contrast * 0.7 + edge * 0.3
      total += weight
      weightedX += weight * normalizedCoordinate(column, width)
      weightedY += weight * normalizedCoordinate(row, height)
    }
  }
  return total > width * height * 0.002 ? { x: weightedX / total, y: weightedY / total } : null
}

export function analyzeVideoFrame(
  rgba: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  previous: VideoFrameAnalysis | null = null,
  options: VideoFrameAnalysisOptions = {},
): VideoFrameAnalysis {
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError("video frame dimensions must be positive integers")
  }
  const expectedLength = sourceWidth * sourceHeight * 4
  if (rgba.length !== expectedLength) throw new RangeError(`RGBA frame must contain exactly ${expectedLength} bytes`)

  const sourceLuminance = new Float32Array(sourceWidth * sourceHeight)
  for (let index = 0; index < sourceLuminance.length; index += 1) {
    const offset = index * 4
    const red = rgba[offset] ?? 0
    const green = rgba[offset + 1] ?? 0
    const blue = rgba[offset + 2] ?? 0
    sourceLuminance[index] = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
  }
  const sourceAspect = sourceWidth / sourceHeight
  const histogram = sourceHistogram(sourceLuminance)
  const structure = sourceStructure(sourceLuminance, sourceWidth, sourceHeight)
  const sourceFramingTarget = calculateFramingTarget(sourceLuminance, sourceWidth, sourceHeight)
  const defaultReceiverAspect = RECEIVER_WIDTH / RECEIVER_HEIGHT / TERMINAL_CELL_ASPECT
  const configuredReceiverAspect = options.receiverAspect
  const receiverAspect =
    typeof configuredReceiverAspect === "number" && Number.isFinite(configuredReceiverAspect)
      ? Math.max(0.1, Math.min(4, configuredReceiverAspect))
      : defaultReceiverAspect
  const cropWidth = sourceAspect > receiverAspect ? Math.max(1, Math.round(sourceHeight * receiverAspect)) : sourceWidth
  const cropHeight =
    sourceAspect > receiverAspect ? sourceHeight : Math.max(1, Math.round(sourceWidth / receiverAspect))
  const movableWidth = sourceWidth - cropWidth
  const movableHeight = sourceHeight - cropHeight
  const framingTarget = sourceFramingTarget
    ? {
        x: movableWidth > 0 ? Math.max(-1, Math.min(1, sourceFramingTarget.x / (movableWidth / sourceWidth))) : 0,
        y: movableHeight > 0 ? Math.max(-1, Math.min(1, sourceFramingTarget.y / (movableHeight / sourceHeight))) : 0,
      }
    : null
  const cropCenterX = Math.max(-1, Math.min(1, options.cropCenter?.x ?? 0))
  const cropCenterY = Math.max(-1, Math.min(1, options.cropCenter?.y ?? 0))
  const cropLeft = Math.round(((sourceWidth - cropWidth) * (cropCenterX + 1)) / 2)
  const cropTop = Math.round(((sourceHeight - cropHeight) * (cropCenterY + 1)) / 2)
  const cropLuminance = new Float32Array(cropWidth * cropHeight)
  for (let row = 0; row < cropHeight; row += 1) {
    const sourceStart = (cropTop + row) * sourceWidth + cropLeft
    cropLuminance.set(sourceLuminance.subarray(sourceStart, sourceStart + cropWidth), row * cropWidth)
  }
  const cropIntensity = normalizeLuminance(cropLuminance)
  const luminance = new Float32Array(RECEIVER_CELL_COUNT)
  const previousLuminance = new Float32Array(RECEIVER_CELL_COUNT)
  const intensity = new Float32Array(RECEIVER_CELL_COUNT)
  const previousSource =
    previous && previous.sourceWidth === sourceWidth && previous.sourceHeight === sourceHeight
      ? previous.sourceLuminance
      : null
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
      let previousRawTotal = 0
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
          if (previousSource) previousRawTotal += previousSource[sourceIndex] ?? 0
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
      previousLuminance[index] = previousSource ? previousRawTotal / sampleCount : luminance[index]!
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
  const hueNeighborhoodSceneScore = (center: number): number => {
    const cellCount = hueNeighborhoodCellCount(center)
    const averageWeight = hueNeighborhoodWeight(center) / Math.max(1, cellCount)
    return cellCount * (1 - Math.min(0.15, averageWeight * 4))
  }
  const hueBinDistance = (left: number, right: number): number => {
    const distance = Math.abs(left - right)
    return Math.min(distance, COLOR_HUE_BINS - distance)
  }
  let sceneBin = -1
  for (let bin = 0; bin < COLOR_HUE_BINS; bin += 1) {
    if (hueNeighborhoodCellCount(bin) < RECEIVER_CELL_COUNT * 0.02) continue
    if (hueNeighborhoodWeight(bin) <= 0.04) continue
    const score = hueNeighborhoodSceneScore(bin)
    const sceneScore = sceneBin < 0 ? Number.NEGATIVE_INFINITY : hueNeighborhoodSceneScore(sceneBin)
    const equallyRepresented = Math.abs(score - sceneScore) < 0.000001
    if (
      sceneBin === -1 ||
      score > sceneScore ||
      (equallyRepresented && hueNeighborhoodWeight(bin) < hueNeighborhoodWeight(sceneBin))
    ) {
      sceneBin = bin
    }
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
  if (previousSource) {
    for (let index = 0; index < difference.length; index += 1) {
      const value = Math.abs((luminance[index] ?? 0) - (previousLuminance[index] ?? 0))
      difference[index] = value
      differenceTotal += value
    }
  }
  const luminanceCentroid = calculateCentroid(luminance)
  const previousCentroid = previousSource ? calculateCentroid(previousLuminance) : luminanceCentroid
  const edges = calculateEdges(intensity)
  const structureValid = structureEnergy(structure) >= 0.08
  const previousReference = previous?.sceneReferenceStructure ?? null
  const spatialDistance = structureValid && previousReference ? structureDistance(structure, previousReference) : 0
  const exposureDistance = previous ? histogramDistance(histogram, previous.sourceHistogram) : 0
  const sceneCutScore = Math.min(1, spatialDistance * (1 + exposureDistance * 0.35))
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
    cropCenter: { x: cropCenterX, y: cropCenterY },
    framingTarget,
    sceneCutScore,
    isSceneCut: sceneCutScore >= 0.48,
    sceneColor: stableSceneColor,
    accentColor,
    sourceHistogram: histogram,
    sourceStructure: structure,
    sceneReferenceStructure: structureValid ? structure : previousReference,
    sourceRgba: rgba,
    sourceLuminance,
    previousSourceLuminance: previousSource,
    sourceWidth,
    sourceHeight,
  }
}

function smoothColorWindow(lightness: number): number {
  const dark = Math.max(0, Math.min(1, (lightness - 0.08) / 0.14))
  const bright = Math.max(0, Math.min(1, (0.995 - lightness) / 0.095))
  return dark * bright
}
