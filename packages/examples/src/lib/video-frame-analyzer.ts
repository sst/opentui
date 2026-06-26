export const VIDEO_FRAME_WIDTH = 192
export const RECEIVER_WIDTH = 56
export const RECEIVER_HEIGHT = 28
export const RECEIVER_CELL_COUNT = RECEIVER_WIDTH * RECEIVER_HEIGHT
const TERMINAL_CELL_ASPECT = 2

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
}

const EMPTY_VECTOR: MotionVector = { x: 0, y: 0 }

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
      let sampleCount = 0
      for (let sourceY = sourceTop; sourceY < sourceBottom; sourceY += 1) {
        for (let sourceX = sourceLeft; sourceX < sourceRight; sourceX += 1) {
          const sourceIndex = sourceY * sourceWidth + sourceX
          const cropIndex = (sourceY - cropTop) * cropWidth + sourceX - cropLeft
          rawTotal += sourceLuminance[sourceIndex] ?? 0
          intensityTotal += cropIntensity[cropIndex] ?? 0
          sampleCount += 1
        }
      }
      const index = row * RECEIVER_WIDTH + column
      luminance[index] = rawTotal / sampleCount
      intensity[index] = intensityTotal / sampleCount
    }
  }

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
  }
}
