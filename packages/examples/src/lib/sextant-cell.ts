export const SEXTANT_SAMPLE_COUNT = 6
export const SEXTANT_SAMPLE_CHANNELS = SEXTANT_SAMPLE_COUNT * 3

export function sextantMaskByLuminance(samples: Uint8Array, strength: number): number {
  if (samples.length !== SEXTANT_SAMPLE_CHANNELS) {
    throw new RangeError(`sextant samples must contain exactly ${SEXTANT_SAMPLE_CHANNELS} channels`)
  }
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError("sextant strength must be between 0 and 1")
  }
  // Full video cells merge into visually louder slabs than full-strength point glyphs.
  const occupied = Math.max(1, Math.min(SEXTANT_SAMPLE_COUNT - 1, Math.ceil(strength ** 1.2 * 5)))
  let mask = 0
  for (let selection = 0; selection < occupied; selection += 1) {
    let brightestSample = -1
    let brightestLuminance = -1
    for (let sample = 0; sample < SEXTANT_SAMPLE_COUNT; sample += 1) {
      if ((mask & (1 << sample)) !== 0) continue
      const offset = sample * 3
      const luminance = samples[offset]! * 0.2126 + samples[offset + 1]! * 0.7152 + samples[offset + 2]! * 0.0722
      if (luminance > brightestLuminance) {
        brightestSample = sample
        brightestLuminance = luminance
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
