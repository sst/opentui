export type QRErrorCorrectionLevel = "low" | "medium" | "quartile" | "high"

export interface EncodedQRCode {
  version: number
  size: number
  mask: number
  modules: boolean[][]
}

const BYTE_MODE_INDICATOR = 0b0100
const MIN_VERSION = 1
const MAX_VERSION = 40

const ERROR_CORRECTION_LEVELS: Record<QRErrorCorrectionLevel, { ordinal: number; formatBits: number }> = {
  low: { ordinal: 0, formatBits: 1 },
  medium: { ordinal: 1, formatBits: 0 },
  quartile: { ordinal: 2, formatBits: 3 },
  high: { ordinal: 3, formatBits: 2 },
}

const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
]

const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19,
    19, 20, 21, 22, 24, 25,
  ],
  [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31,
    33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43,
    45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48,
    51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
]

export function encodeQRCode(content: string, errorCorrectionLevel: QRErrorCorrectionLevel = "medium"): EncodedQRCode {
  const bytes = [...new TextEncoder().encode(content)]
  const level = ERROR_CORRECTION_LEVELS[errorCorrectionLevel]
  const version = findVersionThatFits(bytes.length, level.ordinal)
  const dataCodewords = encodeDataCodewords(bytes, version, level.ordinal)
  const { modules, mask } = buildMatrix(version, level, dataCodewords)

  return {
    version,
    size: modules.length,
    mask,
    modules,
  }
}

export function getQRCodeAlignmentPatternPositions(version: number): number[] {
  if (version < MIN_VERSION || version > MAX_VERSION) {
    throw new RangeError(`QR version out of range: ${version}`)
  }

  return getAlignmentPatternPositions(version)
}

export function getQRCodeFormatBits(errorCorrectionLevel: QRErrorCorrectionLevel, mask: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new RangeError(`QR mask out of range: ${mask}`)
  }

  return computeFormatBits(ERROR_CORRECTION_LEVELS[errorCorrectionLevel].formatBits, mask)
}

export function getQRCodeVersionBits(version: number): number {
  if (version < MIN_VERSION || version > MAX_VERSION) {
    throw new RangeError(`QR version out of range: ${version}`)
  }

  if (version < 7) {
    throw new RangeError(`QR version information is only defined for versions 7 and above, got ${version}`)
  }

  return computeVersionBits(version)
}

function findVersionThatFits(byteLength: number, errorCorrectionOrdinal: number): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    const capacityBits = getNumDataCodewords(version, errorCorrectionOrdinal) * 8
    const requiredBits = 4 + getByteModeCharCountBits(version) + byteLength * 8

    if (requiredBits <= capacityBits) {
      return version
    }
  }

  throw new RangeError(`QR content is too long to encode (${byteLength} bytes)`)
}

function encodeDataCodewords(data: number[], version: number, errorCorrectionOrdinal: number): number[] {
  const capacityBits = getNumDataCodewords(version, errorCorrectionOrdinal) * 8
  const bits: number[] = []

  appendBits(BYTE_MODE_INDICATOR, 4, bits)
  appendBits(data.length, getByteModeCharCountBits(version), bits)

  for (const byte of data) {
    appendBits(byte, 8, bits)
  }

  appendBits(0, Math.min(4, capacityBits - bits.length), bits)
  appendBits(0, (8 - (bits.length % 8)) % 8, bits)

  for (let padByte = 0xec; bits.length < capacityBits; padByte = padByte === 0xec ? 0x11 : 0xec) {
    appendBits(padByte, 8, bits)
  }

  const codewords = new Array<number>(bits.length / 8).fill(0)
  for (let i = 0; i < bits.length; i++) {
    codewords[i >>> 3] |= bits[i]! << (7 - (i & 7))
  }

  return codewords
}

function buildMatrix(
  version: number,
  errorCorrectionLevel: { ordinal: number; formatBits: number },
  dataCodewords: number[],
): { modules: boolean[][]; mask: number } {
  const size = version * 4 + 17
  const modules = createSquareMatrix(size, false)
  const functionModules = createSquareMatrix(size, false)

  drawFunctionPatterns(modules, functionModules, version, errorCorrectionLevel.formatBits)
  const allCodewords = addErrorCorrectionAndInterleave(dataCodewords, version, errorCorrectionLevel.ordinal)
  drawCodewords(modules, functionModules, allCodewords)

  let bestMask = 0
  let bestPenalty = Number.POSITIVE_INFINITY

  for (let mask = 0; mask < 8; mask++) {
    applyMask(modules, functionModules, mask)
    drawFormatBits(modules, functionModules, errorCorrectionLevel.formatBits, mask)

    const penalty = calculatePenalty(modules)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMask = mask
    }

    applyMask(modules, functionModules, mask)
  }

  applyMask(modules, functionModules, bestMask)
  drawFormatBits(modules, functionModules, errorCorrectionLevel.formatBits, bestMask)

  return { modules, mask: bestMask }
}

function createSquareMatrix(size: number, value: boolean): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(value))
}

function drawFunctionPatterns(
  modules: boolean[][],
  functionModules: boolean[][],
  version: number,
  formatBits: number,
): void {
  const size = modules.length

  for (let i = 0; i < size; i++) {
    setFunctionModule(modules, functionModules, 6, i, i % 2 === 0)
    setFunctionModule(modules, functionModules, i, 6, i % 2 === 0)
  }

  drawFinderPattern(modules, functionModules, 3, 3)
  drawFinderPattern(modules, functionModules, size - 4, 3)
  drawFinderPattern(modules, functionModules, 3, size - 4)

  const alignmentPositions = getAlignmentPatternPositions(version)
  for (let y = 0; y < alignmentPositions.length; y++) {
    for (let x = 0; x < alignmentPositions.length; x++) {
      const overlapsFinderCorner =
        (x === 0 && y === 0) ||
        (x === 0 && y === alignmentPositions.length - 1) ||
        (x === alignmentPositions.length - 1 && y === 0)

      if (!overlapsFinderCorner) {
        drawAlignmentPattern(modules, functionModules, alignmentPositions[x]!, alignmentPositions[y]!)
      }
    }
  }

  drawFormatBits(modules, functionModules, formatBits, 0)
  drawVersionBits(modules, functionModules, version)
}

function drawFinderPattern(modules: boolean[][], functionModules: boolean[][], centerX: number, centerY: number): void {
  const size = modules.length

  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = centerX + dx
      const y = centerY + dy

      if (x < 0 || x >= size || y < 0 || y >= size) {
        continue
      }

      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      setFunctionModule(modules, functionModules, x, y, distance !== 2 && distance !== 4)
    }
  }
}

function drawAlignmentPattern(
  modules: boolean[][],
  functionModules: boolean[][],
  centerX: number,
  centerY: number,
): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      setFunctionModule(modules, functionModules, centerX + dx, centerY + dy, distance !== 1)
    }
  }
}

function drawFormatBits(
  modules: boolean[][],
  functionModules: boolean[][],
  errorCorrectionFormatBits: number,
  mask: number,
): void {
  const size = modules.length
  const bits = computeFormatBits(errorCorrectionFormatBits, mask)

  for (let i = 0; i <= 5; i++) {
    setFunctionModule(modules, functionModules, 8, i, getBit(bits, i))
  }

  setFunctionModule(modules, functionModules, 8, 7, getBit(bits, 6))
  setFunctionModule(modules, functionModules, 8, 8, getBit(bits, 7))
  setFunctionModule(modules, functionModules, 7, 8, getBit(bits, 8))

  for (let i = 9; i < 15; i++) {
    setFunctionModule(modules, functionModules, 14 - i, 8, getBit(bits, i))
  }

  for (let i = 0; i < 8; i++) {
    setFunctionModule(modules, functionModules, size - 1 - i, 8, getBit(bits, i))
  }

  for (let i = 8; i < 15; i++) {
    setFunctionModule(modules, functionModules, 8, size - 15 + i, getBit(bits, i))
  }

  setFunctionModule(modules, functionModules, 8, size - 8, true)
}

function drawVersionBits(modules: boolean[][], functionModules: boolean[][], version: number): void {
  if (version < 7) {
    return
  }

  const size = modules.length
  const bits = computeVersionBits(version)

  for (let i = 0; i < 18; i++) {
    const bit = getBit(bits, i)
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    setFunctionModule(modules, functionModules, a, b, bit)
    setFunctionModule(modules, functionModules, b, a, bit)
  }
}

function setFunctionModule(
  modules: boolean[][],
  functionModules: boolean[][],
  x: number,
  y: number,
  isDark: boolean,
): void {
  modules[y]![x] = isDark
  functionModules[y]![x] = true
}

function addErrorCorrectionAndInterleave(
  dataCodewords: number[],
  version: number,
  errorCorrectionOrdinal: number,
): number[] {
  const blockCount = NUM_ERROR_CORRECTION_BLOCKS[errorCorrectionOrdinal]![version]!
  const eccLength = ECC_CODEWORDS_PER_BLOCK[errorCorrectionOrdinal]![version]!
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8)
  const shortBlockDataLength = Math.floor(rawCodewords / blockCount) - eccLength
  const longBlockCount = rawCodewords % blockCount
  const shortBlockCount = blockCount - longBlockCount
  const divisor = computeReedSolomonDivisor(eccLength)

  const dataBlocks: number[][] = []
  const eccBlocks: number[][] = []

  let offset = 0
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
    const dataLength = shortBlockDataLength + (blockIndex >= shortBlockCount ? 1 : 0)
    const blockData = dataCodewords.slice(offset, offset + dataLength)
    offset += dataLength

    dataBlocks.push(blockData)
    eccBlocks.push(computeReedSolomonRemainder(blockData, divisor))
  }

  const result: number[] = []
  const maxDataLength = shortBlockDataLength + (longBlockCount > 0 ? 1 : 0)

  for (let i = 0; i < maxDataLength; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) {
        result.push(block[i]!)
      }
    }
  }

  for (let i = 0; i < eccLength; i++) {
    for (const block of eccBlocks) {
      result.push(block[i]!)
    }
  }

  return result
}

function drawCodewords(modules: boolean[][], functionModules: boolean[][], codewords: number[]): void {
  const size = modules.length
  let bitIndex = 0

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right = 5
    }

    for (let vertical = 0; vertical < size; vertical++) {
      const upward = ((right + 1) & 2) === 0
      const y = upward ? size - 1 - vertical : vertical

      for (let columnOffset = 0; columnOffset < 2; columnOffset++) {
        const x = right - columnOffset
        if (functionModules[y]![x] || bitIndex >= codewords.length * 8) {
          continue
        }

        modules[y]![x] = getBit(codewords[bitIndex >>> 3]!, 7 - (bitIndex & 7))
        bitIndex++
      }
    }
  }
}

function applyMask(modules: boolean[][], functionModules: boolean[][], mask: number): void {
  const size = modules.length

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (functionModules[y]![x]) {
        continue
      }

      let invert = false
      switch (mask) {
        case 0:
          invert = (x + y) % 2 === 0
          break
        case 1:
          invert = y % 2 === 0
          break
        case 2:
          invert = x % 3 === 0
          break
        case 3:
          invert = (x + y) % 3 === 0
          break
        case 4:
          invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
          break
        case 5:
          invert = ((x * y) % 2) + ((x * y) % 3) === 0
          break
        case 6:
          invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
          break
        case 7:
          invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
          break
        default:
          throw new RangeError(`Unsupported QR mask ${mask}`)
      }

      if (invert) {
        modules[y]![x] = !modules[y]![x]
      }
    }
  }
}

function calculatePenalty(modules: boolean[][]): number {
  const size = modules.length
  let penalty = 0

  for (let y = 0; y < size; y++) {
    let runColor = false
    let runLength = 0
    const runHistory = [0, 0, 0, 0, 0, 0, 0]

    for (let x = 0; x < size; x++) {
      const cell = modules[y]![x]!
      if (cell === runColor) {
        runLength++
        if (runLength === 5) {
          penalty += 3
        } else if (runLength > 5) {
          penalty++
        }
      } else {
        addFinderPenaltyHistory(runHistory, runLength, size)
        if (!runColor) {
          penalty += countFinderLikePatterns(runHistory) * 40
        }
        runColor = cell
        runLength = 1
      }
    }

    penalty += terminateFinderPenalty(runHistory, runColor, runLength, size) * 40
  }

  for (let x = 0; x < size; x++) {
    let runColor = false
    let runLength = 0
    const runHistory = [0, 0, 0, 0, 0, 0, 0]

    for (let y = 0; y < size; y++) {
      const cell = modules[y]![x]!
      if (cell === runColor) {
        runLength++
        if (runLength === 5) {
          penalty += 3
        } else if (runLength > 5) {
          penalty++
        }
      } else {
        addFinderPenaltyHistory(runHistory, runLength, size)
        if (!runColor) {
          penalty += countFinderLikePatterns(runHistory) * 40
        }
        runColor = cell
        runLength = 1
      }
    }

    penalty += terminateFinderPenalty(runHistory, runColor, runLength, size) * 40
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const cell = modules[y]![x]!
      if (cell === modules[y]![x + 1]! && cell === modules[y + 1]![x]! && cell === modules[y + 1]![x + 1]!) {
        penalty += 3
      }
    }
  }

  let darkModules = 0
  for (const row of modules) {
    for (const cell of row) {
      if (cell) {
        darkModules++
      }
    }
  }

  const totalModules = size * size
  const balancePenalty = Math.ceil(Math.abs(darkModules * 20 - totalModules * 10) / totalModules) - 1
  penalty += Math.max(0, balancePenalty) * 10

  return penalty
}

function addFinderPenaltyHistory(runHistory: number[], runLength: number, size: number): void {
  if (runHistory[0] === 0) {
    runLength += size
  }

  runHistory.pop()
  runHistory.unshift(runLength)
}

function countFinderLikePatterns(runHistory: number[]): number {
  const n = runHistory[1]!
  const corePattern =
    n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n

  return (
    Number(corePattern && runHistory[0]! >= n * 4 && runHistory[6]! >= n) +
    Number(corePattern && runHistory[6]! >= n * 4 && runHistory[0]! >= n)
  )
}

function terminateFinderPenalty(runHistory: number[], runColor: boolean, runLength: number, size: number): number {
  if (runColor) {
    addFinderPenaltyHistory(runHistory, runLength, size)
    runLength = 0
  }

  addFinderPenaltyHistory(runHistory, runLength + size, size)
  return countFinderLikePatterns(runHistory)
}

function computeReedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[result.length - 1] = 1

  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j]!, root)
      if (j + 1 < result.length) {
        result[j] ^= result[j + 1]!
      }
    }
    root = reedSolomonMultiply(root, 0x02)
  }

  return result
}

function computeReedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)

  for (const value of data) {
    const factor = value ^ result.shift()!
    result.push(0)

    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= reedSolomonMultiply(divisor[i]!, factor)
    }
  }

  return result
}

function reedSolomonMultiply(left: number, right: number): number {
  let result = 0

  for (let bit = 7; bit >= 0; bit--) {
    result = (result << 1) ^ (((result >>> 7) & 1) * 0x11d)
    if (((right >>> bit) & 1) !== 0) {
      result ^= left
    }
  }

  return result
}

function getAlignmentPatternPositions(version: number): number[] {
  if (version === 1) {
    return []
  }

  const count = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2
  const positions = [6]

  for (let position = version * 4 + 10; positions.length < count; position -= step) {
    positions.splice(1, 0, position)
  }

  return positions
}

function computeFormatBits(errorCorrectionFormatBits: number, mask: number): number {
  const data = (errorCorrectionFormatBits << 3) | mask
  let remainder = data

  for (let i = 0; i < 10; i++) {
    remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) * 0x537)
  }

  return ((data << 10) | remainder) ^ 0x5412
}

function computeVersionBits(version: number): number {
  let remainder = version

  for (let i = 0; i < 12; i++) {
    remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) * 0x1f25)
  }

  return (version << 12) | remainder
}

function getNumRawDataModules(version: number): number {
  let count = (16 * version + 128) * version + 64

  if (version >= 2) {
    const alignmentPatternCount = Math.floor(version / 7) + 2
    count -= (25 * alignmentPatternCount - 10) * alignmentPatternCount - 55

    if (version >= 7) {
      count -= 36
    }
  }

  return count
}

function getNumDataCodewords(version: number, errorCorrectionOrdinal: number): number {
  return (
    Math.floor(getNumRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[errorCorrectionOrdinal]![version]! *
      NUM_ERROR_CORRECTION_BLOCKS[errorCorrectionOrdinal]![version]!
  )
}

function getByteModeCharCountBits(version: number): number {
  return version <= 9 ? 8 : 16
}

function appendBits(value: number, bitCount: number, bits: number[]): void {
  for (let i = bitCount - 1; i >= 0; i--) {
    bits.push((value >>> i) & 1)
  }
}

function getBit(value: number, bitIndex: number): boolean {
  return ((value >>> bitIndex) & 1) !== 0
}
