export const SEXTANT_SAMPLE_COUNT = 6
export const SEXTANT_SAMPLE_CHANNELS = SEXTANT_SAMPLE_COUNT * 3

function tiePriority(sample: number, patternDither: number): number {
  const value = Math.sin(patternDither * 8191 + sample * 127.1) * 43758.5453
  return value - Math.floor(value)
}

export function sextantMaskByLuminance(
  samples: Uint8Array,
  strength: number,
  densityDither: number,
  patternDither: number,
): number {
  if (samples.length !== SEXTANT_SAMPLE_CHANNELS) {
    throw new RangeError(`sextant samples must contain exactly ${SEXTANT_SAMPLE_CHANNELS} channels`)
  }
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError("sextant strength must be between 0 and 1")
  }
  if (!Number.isFinite(densityDither) || densityDither < 0 || densityDither > 1) {
    throw new RangeError("sextant density dither must be between 0 and 1")
  }
  if (!Number.isFinite(patternDither) || patternDither < 0 || patternDither > 1) {
    throw new RangeError("sextant pattern dither must be between 0 and 1")
  }
  // Match the point ramp's apparent area: low strengths skip whole cells and the strongest video mark fills half a cell.
  const expectedOccupancy = Math.max(0, Math.min(3, (strength - 1 / 7) * 3.5))
  const wholeOccupancy = Math.floor(expectedOccupancy)
  const occupied = wholeOccupancy + (densityDither < expectedOccupancy - wholeOccupancy ? 1 : 0)
  if (occupied === 0) return 0

  let mask = 0
  for (let selection = 0; selection < occupied; selection += 1) {
    let brightestSample = -1
    let brightestLuminance = -1
    let brightestPriority = -1
    for (let sample = 0; sample < SEXTANT_SAMPLE_COUNT; sample += 1) {
      if ((mask & (1 << sample)) !== 0) continue
      const offset = sample * 3
      const luminance = samples[offset]! * 0.2126 + samples[offset + 1]! * 0.7152 + samples[offset + 2]! * 0.0722
      const priority = tiePriority(sample, patternDither)
      if (luminance > brightestLuminance || (luminance === brightestLuminance && priority > brightestPriority)) {
        brightestSample = sample
        brightestLuminance = luminance
        brightestPriority = priority
      }
    }
    mask |= 1 << brightestSample
  }
  return mask
}

export function sextantAverageColor(samples: Uint8Array, mask: number): number {
  if (samples.length !== SEXTANT_SAMPLE_CHANNELS) {
    throw new RangeError(`sextant samples must contain exactly ${SEXTANT_SAMPLE_CHANNELS} channels`)
  }
  if (!Number.isInteger(mask) || mask < 1 || mask > 63)
    throw new RangeError("sextant color mask must be between 1 and 63")
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (let sample = 0; sample < SEXTANT_SAMPLE_COUNT; sample += 1) {
    if ((mask & (1 << sample)) === 0) continue
    const offset = sample * 3
    red += samples[offset]!
    green += samples[offset + 1]!
    blue += samples[offset + 2]!
    count += 1
  }
  return (Math.round(red / count) << 16) | (Math.round(green / count) << 8) | Math.round(blue / count)
}

function chromaGamutScale(luminance: number, deviation: number): number {
  if (deviation > 0) return (1 - luminance) / deviation
  if (deviation < 0) return luminance / -deviation
  return 1
}

export function luminancePreservingColor(source: number, base: number, sourceMix: number): number {
  if (!Number.isFinite(sourceMix) || sourceMix < 0 || sourceMix > 1) {
    throw new RangeError("source color mix must be between 0 and 1")
  }
  const sourceRed = ((source >> 16) & 0xff) / 255
  const sourceGreen = ((source >> 8) & 0xff) / 255
  const sourceBlue = (source & 0xff) / 255
  const baseRed = ((base >> 16) & 0xff) / 255
  const baseGreen = ((base >> 8) & 0xff) / 255
  const baseBlue = (base & 0xff) / 255
  const sourceLuminance = sourceRed * 0.2126 + sourceGreen * 0.7152 + sourceBlue * 0.0722
  const baseLuminance = baseRed * 0.2126 + baseGreen * 0.7152 + baseBlue * 0.0722
  const redDeviation = sourceRed - sourceLuminance
  const greenDeviation = sourceGreen - sourceLuminance
  const blueDeviation = sourceBlue - sourceLuminance
  const gamutScale = Math.min(
    1,
    chromaGamutScale(baseLuminance, redDeviation),
    chromaGamutScale(baseLuminance, greenDeviation),
    chromaGamutScale(baseLuminance, blueDeviation),
  )
  const red = baseRed + (baseLuminance + redDeviation * gamutScale - baseRed) * sourceMix
  const green = baseGreen + (baseLuminance + greenDeviation * gamutScale - baseGreen) * sourceMix
  const blue = baseBlue + (baseLuminance + blueDeviation * gamutScale - baseBlue) * sourceMix
  return (Math.round(red * 255) << 16) | (Math.round(green * 255) << 8) | Math.round(blue * 255)
}

function glyphForMask(mask: number): string {
  // Unicode reuses the existing empty, left, right, and full block glyphs for four of the 64 masks.
  if (mask === 0) return " "
  if (mask === 21) return "▌"
  if (mask === 42) return "▐"
  if (mask === 63) return "█"
  const omittedMasks = mask > 42 ? 2 : mask > 21 ? 1 : 0
  return String.fromCodePoint(0x1fb00 + mask - 1 - omittedMasks)
}

const SEXTANT_GLYPHS = Array.from({ length: 64 }, (_, mask) => glyphForMask(mask))

export function sextantGlyph(mask: number): string {
  if (!Number.isInteger(mask) || mask < 0 || mask > 63) throw new RangeError("sextant mask must be between 0 and 63")
  return SEXTANT_GLYPHS[mask]!
}
