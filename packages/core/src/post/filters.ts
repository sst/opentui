import type { OptimizedBuffer } from "../buffer"

/**
 * Applies a scanline effect by darkening every nth row.
 */
export function applyScanlines(buffer: OptimizedBuffer, strength: number = 0.8, step: number = 2): void {
  const width = buffer.getWidth()
  const height = buffer.getHeight()
  const bg = buffer.buffers.bg

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x++) {
      const colorIndex = (y * width + x) * 4
      bg[colorIndex] *= strength // R
      bg[colorIndex + 1] *= strength // G
      bg[colorIndex + 2] *= strength // B
      // Keep Alpha the same
    }
  }
}

/**
 * Converts the buffer colors to grayscale.
 */
export function applyGrayscale(buffer: OptimizedBuffer): void {
  const size = buffer.getWidth() * buffer.getHeight()
  const fg = buffer.buffers.fg
  const bg = buffer.buffers.bg

  for (let i = 0; i < size; i++) {
    const colorIndex = i * 4

    // Grayscale foreground
    const fgR = fg[colorIndex]
    const fgG = fg[colorIndex + 1]
    const fgB = fg[colorIndex + 2]
    const fgLum = 0.299 * fgR + 0.587 * fgG + 0.114 * fgB
    fg[colorIndex] = fgLum
    fg[colorIndex + 1] = fgLum
    fg[colorIndex + 2] = fgLum

    // Grayscale background
    const bgR = bg[colorIndex]
    const bgG = bg[colorIndex + 1]
    const bgB = bg[colorIndex + 2]
    const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB
    bg[colorIndex] = bgLum
    bg[colorIndex + 1] = bgLum
    bg[colorIndex + 2] = bgLum
  }
}

/**
 * Applies a sepia tone to the buffer.
 */
export function applySepia(buffer: OptimizedBuffer): void {
  const size = buffer.getWidth() * buffer.getHeight()
  const fg = buffer.buffers.fg
  const bg = buffer.buffers.bg

  for (let i = 0; i < size; i++) {
    const colorIndex = i * 4

    // Sepia foreground
    let fgR = fg[colorIndex]
    let fgG = fg[colorIndex + 1]
    let fgB = fg[colorIndex + 2]
    let newFgR = Math.min(1.0, fgR * 0.393 + fgG * 0.769 + fgB * 0.189)
    let newFgG = Math.min(1.0, fgR * 0.349 + fgG * 0.686 + fgB * 0.168)
    let newFgB = Math.min(1.0, fgR * 0.272 + fgG * 0.534 + fgB * 0.131)
    fg[colorIndex] = newFgR
    fg[colorIndex + 1] = newFgG
    fg[colorIndex + 2] = newFgB

    // Sepia background
    let bgR = bg[colorIndex]
    let bgG = bg[colorIndex + 1]
    let bgB = bg[colorIndex + 2]
    let newBgR = Math.min(1.0, bgR * 0.393 + bgG * 0.769 + bgB * 0.189)
    let newBgG = Math.min(1.0, bgR * 0.349 + bgG * 0.686 + bgB * 0.168)
    let newBgB = Math.min(1.0, bgR * 0.272 + bgG * 0.534 + bgB * 0.131)
    bg[colorIndex] = newBgR
    bg[colorIndex + 1] = newBgG
    bg[colorIndex + 2] = newBgB
  }
}

/**
 * Inverts the colors in the buffer.
 */
export function applyInvert(buffer: OptimizedBuffer): void {
  const size = buffer.getWidth() * buffer.getHeight()
  const fg = buffer.buffers.fg
  const bg = buffer.buffers.bg

  for (let i = 0; i < size; i++) {
    const colorIndex = i * 4
    fg[colorIndex] = 1.0 - fg[colorIndex]
    fg[colorIndex + 1] = 1.0 - fg[colorIndex + 1]
    fg[colorIndex + 2] = 1.0 - fg[colorIndex + 2]

    bg[colorIndex] = 1.0 - bg[colorIndex]
    bg[colorIndex + 1] = 1.0 - bg[colorIndex + 1]
    bg[colorIndex + 2] = 1.0 - bg[colorIndex + 2]
  }
}

/**
 * Adds random noise to the buffer colors.
 */
export function applyNoise(buffer: OptimizedBuffer, strength: number = 0.1): void {
  const size = buffer.getWidth() * buffer.getHeight()
  const fg = buffer.buffers.fg
  const bg = buffer.buffers.bg

  for (let i = 0; i < size; i++) {
    const colorIndex = i * 4
    const noise = (Math.random() - 0.5) * strength

    fg[colorIndex] = Math.max(0, Math.min(1, fg[colorIndex] + noise))
    fg[colorIndex + 1] = Math.max(0, Math.min(1, fg[colorIndex + 1] + noise))
    fg[colorIndex + 2] = Math.max(0, Math.min(1, fg[colorIndex + 2] + noise))

    bg[colorIndex] = Math.max(0, Math.min(1, bg[colorIndex] + noise))
    bg[colorIndex + 1] = Math.max(0, Math.min(1, bg[colorIndex + 1] + noise))
    bg[colorIndex + 2] = Math.max(0, Math.min(1, bg[colorIndex + 2] + noise))
  }
}

/**
 * Applies a simplified chromatic aberration effect.
 */
export function applyChromaticAberration(buffer: OptimizedBuffer, strength: number = 1): void {
  const width = buffer.getWidth()
  const height = buffer.getHeight()
  const srcFg = Float32Array.from(buffer.buffers.fg) // Copy original fg data
  const destFg = buffer.buffers.fg
  const centerX = width / 2
  const centerY = height / 2

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX
      const dy = y - centerY
      const offset = Math.round((Math.sqrt(dx * dx + dy * dy) / Math.max(centerX, centerY)) * strength)

      const rX = Math.max(0, Math.min(width - 1, x - offset))
      const bX = Math.max(0, Math.min(width - 1, x + offset))

      const rIndex = (y * width + rX) * 4
      const gIndex = (y * width + x) * 4 // Green from original position
      const bIndex = (y * width + bX) * 4
      const destIndex = (y * width + x) * 4

      destFg[destIndex] = srcFg[rIndex] // Red from left offset
      destFg[destIndex + 1] = srcFg[gIndex + 1] // Green from center
      destFg[destIndex + 2] = srcFg[bIndex + 2] // Blue from right offset
      // Keep original Alpha
    }
  }
}

/**
 * Converts the buffer to ASCII art based on background brightness.
 */
export function applyAsciiArt(buffer: OptimizedBuffer, ramp: string = " .:-=+*#%@"): void {
  const width = buffer.getWidth()
  const height = buffer.getHeight()
  const chars = buffer.buffers.char
  const bg = buffer.buffers.bg
  const rampLength = ramp.length

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const colorIndex = index * 4
      const bgR = bg[colorIndex]
      const bgG = bg[colorIndex + 1]
      const bgB = bg[colorIndex + 2]
      const lum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB // Luminance
      const rampIndex = Math.min(rampLength - 1, Math.floor(lum * rampLength))
      chars[index] = ramp[rampIndex].charCodeAt(0)
    }
  }
}

interface ActiveGlitch {
  y: number
  type: "shift" | "flip" | "color"
  amount: number
}

export class DistortionEffect {
  // --- Configurable Parameters ---
  public glitchChancePerSecond: number = 0.5
  public maxGlitchLines: number = 3
  public minGlitchDuration: number = 0.05
  public maxGlitchDuration: number = 0.2
  public maxShiftAmount: number = 10
  public shiftFlipRatio: number = 0.6
  public colorGlitchChance: number = 0.2

  // --- Internal State ---
  private lastGlitchTime: number = 0
  private glitchDuration: number = 0
  private activeGlitches: ActiveGlitch[] = []

  constructor(options?: Partial<DistortionEffect>) {
    if (options) {
      Object.assign(this, options)
    }
  }

  /**
   * Applies the animated distortion/glitch effect to the buffer.
   */
  public apply(buffer: OptimizedBuffer, deltaTime: number): void {
    const width = buffer.getWidth()
    const height = buffer.getHeight()
    const buf = buffer.buffers
    // Note: Using internal timer based on deltaTime is more reliable than Date.now()

    // Update glitch timer
    this.lastGlitchTime += deltaTime

    // End current glitch if duration is over
    if (this.activeGlitches.length > 0 && this.lastGlitchTime >= this.glitchDuration) {
      this.activeGlitches = []
      this.glitchDuration = 0
    }

    // Chance to start a new glitch
    if (this.activeGlitches.length === 0 && Math.random() < this.glitchChancePerSecond * deltaTime) {
      this.lastGlitchTime = 0
      this.glitchDuration = this.minGlitchDuration + Math.random() * (this.maxGlitchDuration - this.minGlitchDuration)
      const numGlitches = 1 + Math.floor(Math.random() * this.maxGlitchLines)

      for (let i = 0; i < numGlitches; i++) {
        const y = Math.floor(Math.random() * height)
        let type: ActiveGlitch["type"]
        let amount = 0

        const typeRoll = Math.random()
        if (typeRoll < this.colorGlitchChance) {
          type = "color"
        } else {
          // Determine shift or flip based on remaining probability
          const shiftRoll = (typeRoll - this.colorGlitchChance) / (1 - this.colorGlitchChance)
          if (shiftRoll < this.shiftFlipRatio) {
            type = "shift"
            amount = Math.floor((Math.random() - 0.5) * 2 * this.maxShiftAmount)
          } else {
            type = "flip"
          }
        }

        // Avoid glitching the same line twice in one burst
        if (!this.activeGlitches.some((g) => g.y === y)) {
          this.activeGlitches.push({ y, type, amount })
        }
      }
    }

    // Apply active glitches
    if (this.activeGlitches.length > 0) {
      // Create temporary arrays lazily if needed (minor optimization for shift/flip)
      let tempChar: Uint32Array | null = null
      let tempFg: Float32Array | null = null
      let tempBg: Float32Array | null = null
      let tempAttr: Uint8Array | null = null

      for (const glitch of this.activeGlitches) {
        const y = glitch.y
        // Ensure y is within bounds (safer)
        if (y < 0 || y >= height) continue
        const baseIndex = y * width

        if (glitch.type === "shift" || glitch.type === "flip") {
          // Lazily create temp buffers only when needed for shift/flip
          if (!tempChar) {
            tempChar = new Uint32Array(width)
            tempFg = new Float32Array(width * 4)
            tempBg = new Float32Array(width * 4)
            tempAttr = new Uint8Array(width)
          }

          // 1. Copy original row data to temp buffers
          try {
            tempChar.set(buf.char.subarray(baseIndex, baseIndex + width))
            tempFg!.set(buf.fg.subarray(baseIndex * 4, (baseIndex + width) * 4))
            tempBg!.set(buf.bg.subarray(baseIndex * 4, (baseIndex + width) * 4))
            tempAttr!.set(buf.attributes.subarray(baseIndex, baseIndex + width))
          } catch (e) {
            // Handle potential range errors if buffer size changes unexpectedly
            console.error(`Error copying row ${y} for distortion:`, e)
            continue
          }

          if (glitch.type === "shift") {
            const shift = glitch.amount
            for (let x = 0; x < width; x++) {
              const srcX = (x - shift + width) % width // Wrap around shift
              const destIndex = baseIndex + x
              const srcTempIndex = srcX

              buf.char[destIndex] = tempChar[srcTempIndex]
              buf.attributes[destIndex] = tempAttr![srcTempIndex]

              const destColorIndex = destIndex * 4
              const srcTempColorIndex = srcTempIndex * 4

              buf.fg.set(tempFg!.subarray(srcTempColorIndex, srcTempColorIndex + 4), destColorIndex)
              buf.bg.set(tempBg!.subarray(srcTempColorIndex, srcTempColorIndex + 4), destColorIndex)
            }
          } else {
            // type === 'flip'
            for (let x = 0; x < width; x++) {
              const srcX = width - 1 - x // Flipped index
              const destIndex = baseIndex + x
              const srcTempIndex = srcX

              buf.char[destIndex] = tempChar[srcTempIndex]
              buf.attributes[destIndex] = tempAttr![srcTempIndex]

              const destColorIndex = destIndex * 4
              const srcTempColorIndex = srcTempIndex * 4

              buf.fg.set(tempFg!.subarray(srcTempColorIndex, srcTempColorIndex + 4), destColorIndex)
              buf.bg.set(tempBg!.subarray(srcTempColorIndex, srcTempColorIndex + 4), destColorIndex)
            }
          }
        } else if (glitch.type === "color") {
          const glitchStart = Math.floor(Math.random() * width)
          // Make glitch length at least 1 pixel, up to the rest of the line
          const maxPossibleLength = width - glitchStart
          // Introduce more variability: sometimes short, sometimes long, but not always full width
          let glitchLength = Math.floor(Math.random() * maxPossibleLength) + 1
          if (Math.random() < 0.2) {
            // 20% chance of a shorter, more intense glitch segment
            glitchLength = Math.floor(Math.random() * (width / 4)) + 1
          }
          glitchLength = Math.min(glitchLength, maxPossibleLength)

          for (let x = glitchStart; x < glitchStart + glitchLength; x++) {
            if (x >= width) break // Boundary check

            const destIndex = baseIndex + x
            const destColorIndex = destIndex * 4

            let rFg, gFg, bFg, rBg, gBg, bBg

            // More varied and "glitchy" colors
            const colorMode = Math.random()
            if (colorMode < 0.33) {
              // Pure random
              rFg = Math.random()
              gFg = Math.random()
              bFg = Math.random()
              rBg = Math.random()
              gBg = Math.random()
              bBg = Math.random()
            } else if (colorMode < 0.66) {
              // Single channel emphasis or block color
              const emphasis = Math.random()
              if (emphasis < 0.25) {
                rFg = Math.random()
                gFg = 0
                bFg = 0
              } // Red
              else if (emphasis < 0.5) {
                rFg = 0
                gFg = Math.random()
                bFg = 0
              } // Green
              else if (emphasis < 0.75) {
                rFg = 0
                gFg = 0
                bFg = Math.random()
              } // Blue
              else {
                // Bright glitch color
                const glitchColorRoll = Math.random()
                if (glitchColorRoll < 0.33) {
                  rFg = 1
                  gFg = 0
                  bFg = 1
                } // Magenta
                else if (glitchColorRoll < 0.66) {
                  rFg = 0
                  gFg = 1
                  bFg = 1
                } // Cyan
                else {
                  rFg = 1
                  gFg = 1
                  bFg = 0
                } // Yellow
              }
              // Background can be inverted or similar to FG
              if (Math.random() < 0.5) {
                rBg = 1 - rFg
                gBg = 1 - gFg
                bBg = 1 - bFg
              } else {
                rBg = rFg * (Math.random() * 0.5 + 0.2) // Darker shade of fg
                gBg = gFg * (Math.random() * 0.5 + 0.2)
                bBg = bFg * (Math.random() * 0.5 + 0.2)
              }
            } else {
              // Inverted or high contrast
              rFg = Math.random() > 0.5 ? 1 : 0
              gFg = Math.random() > 0.5 ? 1 : 0
              bFg = Math.random() > 0.5 ? 1 : 0
              rBg = 1 - rFg
              gBg = 1 - gFg
              bBg = 1 - bFg
            }

            buf.fg[destColorIndex] = rFg
            buf.fg[destColorIndex + 1] = gFg
            buf.fg[destColorIndex + 2] = bFg
            // Keep alpha buf.fg[destColorIndex + 3]

            buf.bg[destColorIndex] = rBg
            buf.bg[destColorIndex + 1] = gBg
            buf.bg[destColorIndex + 2] = bBg
            // Keep alpha buf.bg[destColorIndex + 3]
          }
        }
      }
    }
  }
}

/**
 * Applies a vignette effect by darkening the corners, optimized with precomputation.
 */
export class VignetteEffect {
  private _strength: number
  // Stores the base attenuation (0 at center, 1 at max distance) for each pixel
  private precomputedBaseAttenuation: Float32Array | null = null
  private cachedWidth: number = -1
  private cachedHeight: number = -1

  constructor(strength: number = 0.5) {
    this._strength = strength
  }

  public set strength(newStrength: number) {
    this._strength = Math.max(0, newStrength) // Ensure strength is non-negative
  }

  public get strength(): number {
    return this._strength
  }

  private _computeFactors(width: number, height: number): void {
    this.precomputedBaseAttenuation = new Float32Array(width * height)
    const centerX = width / 2
    const centerY = height / 2
    const maxDistSq = centerX * centerX + centerY * centerY
    const safeMaxDistSq = maxDistSq === 0 ? 1 : maxDistSq // Avoid division by zero

    for (let y = 0; y < height; y++) {
      const dy = y - centerY
      const dySq = dy * dy
      for (let x = 0; x < width; x++) {
        const dx = x - centerX
        const distSq = dx * dx + dySq
        // Calculate base attenuation (0 to 1 based on distance)
        const baseAttenuation = Math.min(1, distSq / safeMaxDistSq)
        const index = y * width + x
        this.precomputedBaseAttenuation[index] = baseAttenuation
      }
    }
    this.cachedWidth = width
    this.cachedHeight = height
  }

  /**
   * Applies the vignette effect using precomputed base attenuation and current strength.
   */
  public apply(buffer: OptimizedBuffer): void {
    const width = buffer.getWidth()
    const height = buffer.getHeight()
    const buf = buffer.buffers
    const size = width * height

    // Recompute base attenuation if dimensions changed or factors haven't been computed yet
    if (width !== this.cachedWidth || height !== this.cachedHeight || !this.precomputedBaseAttenuation) {
      this._computeFactors(width, height)
    }

    // Apply effect using precomputed base and current strength
    for (let i = 0; i < size; i++) {
      // Calculate the final factor dynamically
      const factor = Math.max(0, 1 - this.precomputedBaseAttenuation![i] * this._strength)
      const colorIndex = i * 4

      buf.fg[colorIndex] *= factor
      buf.fg[colorIndex + 1] *= factor
      buf.fg[colorIndex + 2] *= factor

      buf.bg[colorIndex] *= factor
      buf.bg[colorIndex + 1] *= factor
      buf.bg[colorIndex + 2] *= factor
    }
  }
}

/**
 * Adjusts the overall brightness of the buffer.
 */
export class BrightnessEffect {
  private _brightness: number

  constructor(brightness: number = 1.0) {
    this._brightness = Math.max(0, brightness) // Ensure brightness is non-negative
  }

  public set brightness(newBrightness: number) {
    this._brightness = Math.max(0, newBrightness)
  }

  public get brightness(): number {
    return this._brightness
  }

  /**
   * Applies the brightness adjustment to the buffer.
   */
  public apply(buffer: OptimizedBuffer): void {
    const size = buffer.getWidth() * buffer.getHeight()
    const fg = buffer.buffers.fg
    const bg = buffer.buffers.bg
    const factor = this._brightness

    // No need to process if brightness is 1 (no change)
    if (factor === 1.0) {
      return
    }

    for (let i = 0; i < size; i++) {
      const colorIndex = i * 4

      // Adjust foreground
      fg[colorIndex] = Math.min(1.0, fg[colorIndex] * factor)
      fg[colorIndex + 1] = Math.min(1.0, fg[colorIndex + 1] * factor)
      fg[colorIndex + 2] = Math.min(1.0, fg[colorIndex + 2] * factor)
      // Alpha fg[colorIndex + 3] remains unchanged

      // Adjust background
      bg[colorIndex] = Math.min(1.0, bg[colorIndex] * factor)
      bg[colorIndex + 1] = Math.min(1.0, bg[colorIndex + 1] * factor)
      bg[colorIndex + 2] = Math.min(1.0, bg[colorIndex + 2] * factor)
      // Alpha bg[colorIndex + 3] remains unchanged
    }
  }
}

/**
 * Applies a simple box blur. (Expensive and may look bad with text).
 */
export class BlurEffect {
  private _radius: number

  constructor(radius: number = 1) {
    this._radius = Math.max(0, Math.round(radius)) // Radius should be a non-negative integer
  }

  public set radius(newRadius: number) {
    this._radius = Math.max(0, Math.round(newRadius))
  }

  public get radius(): number {
    return this._radius
  }

  /**
   * Applies an optimized separable box blur using a moving average (sliding window).
   */
  public apply(buffer: OptimizedBuffer): void {
    const radius = this._radius
    if (radius <= 0) return // No blur if radius is 0 or less

    const width = buffer.getWidth()
    const height = buffer.getHeight()
    const buf = buffer.buffers // Get the full buffer object
    const srcFg = buf.fg
    const srcBg = buf.bg
    const destFg = buf.fg // We'll write back to the original buffer
    const destBg = buf.bg
    const chars = buf.char // Get reference to character buffer
    const size = width * height
    const numChannels = 4 // RGBA

    // Temporary buffer for the horizontal pass result
    const tempBufferFg = new Float32Array(size * numChannels)
    const tempBufferBg = new Float32Array(size * numChannels)

    const windowSize = radius * 2 + 1

    // --- Horizontal Pass --- Fg
    for (let y = 0; y < height; y++) {
      let sumR = 0,
        sumG = 0,
        sumB = 0,
        sumA = 0
      const baseRowIndex = y * width

      // Initialize sum for the first window
      for (let x = -radius; x <= radius; x++) {
        const sampleX = Math.max(0, Math.min(width - 1, x))
        const srcIndex = (baseRowIndex + sampleX) * numChannels
        sumR += srcFg[srcIndex]
        sumG += srcFg[srcIndex + 1]
        sumB += srcFg[srcIndex + 2]
        sumA += srcFg[srcIndex + 3]
      }

      // Slide the window across the row
      for (let x = 0; x < width; x++) {
        const destIndex = (baseRowIndex + x) * numChannels
        tempBufferFg[destIndex] = sumR / windowSize
        tempBufferFg[destIndex + 1] = sumG / windowSize
        tempBufferFg[destIndex + 2] = sumB / windowSize
        tempBufferFg[destIndex + 3] = sumA / windowSize

        // Subtract pixel leaving the window (left edge)
        const leavingX = Math.max(0, Math.min(width - 1, x - radius))
        const leavingIndex = (baseRowIndex + leavingX) * numChannels
        sumR -= srcFg[leavingIndex]
        sumG -= srcFg[leavingIndex + 1]
        sumB -= srcFg[leavingIndex + 2]
        sumA -= srcFg[leavingIndex + 3]

        // Add pixel entering the window (right edge)
        const enteringX = Math.max(0, Math.min(width - 1, x + radius + 1))
        const enteringIndex = (baseRowIndex + enteringX) * numChannels
        sumR += srcFg[enteringIndex]
        sumG += srcFg[enteringIndex + 1]
        sumB += srcFg[enteringIndex + 2]
        sumA += srcFg[enteringIndex + 3]
      }
    }

    // --- Horizontal Pass --- Bg
    for (let y = 0; y < height; y++) {
      let sumR = 0,
        sumG = 0,
        sumB = 0,
        sumA = 0
      const baseRowIndex = y * width
      for (let x = -radius; x <= radius; x++) {
        const sampleX = Math.max(0, Math.min(width - 1, x))
        const srcIndex = (baseRowIndex + sampleX) * numChannels
        sumR += srcBg[srcIndex]
        sumG += srcBg[srcIndex + 1]
        sumB += srcBg[srcIndex + 2]
        sumA += srcBg[srcIndex + 3]
      }
      for (let x = 0; x < width; x++) {
        const destIndex = (baseRowIndex + x) * numChannels
        tempBufferBg[destIndex] = sumR / windowSize
        tempBufferBg[destIndex + 1] = sumG / windowSize
        tempBufferBg[destIndex + 2] = sumB / windowSize
        tempBufferBg[destIndex + 3] = sumA / windowSize
        const leavingX = Math.max(0, Math.min(width - 1, x - radius))
        const leavingIndex = (baseRowIndex + leavingX) * numChannels
        sumR -= srcBg[leavingIndex]
        sumG -= srcBg[leavingIndex + 1]
        sumB -= srcBg[leavingIndex + 2]
        sumA -= srcBg[leavingIndex + 3]
        const enteringX = Math.max(0, Math.min(width - 1, x + radius + 1))
        const enteringIndex = (baseRowIndex + enteringX) * numChannels
        sumR += srcBg[enteringIndex]
        sumG += srcBg[enteringIndex + 1]
        sumB += srcBg[enteringIndex + 2]
        sumA += srcBg[enteringIndex + 3]
      }
    }

    // --- Vertical Pass --- Fg
    for (let x = 0; x < width; x++) {
      let sumR = 0,
        sumG = 0,
        sumB = 0,
        sumA = 0

      // Initialize sum for the first window
      for (let y = -radius; y <= radius; y++) {
        const sampleY = Math.max(0, Math.min(height - 1, y))
        const srcIndex = (sampleY * width + x) * numChannels
        sumR += tempBufferFg[srcIndex]
        sumG += tempBufferFg[srcIndex + 1]
        sumB += tempBufferFg[srcIndex + 2]
        sumA += tempBufferFg[srcIndex + 3]
      }

      // Slide the window down the column
      for (let y = 0; y < height; y++) {
        const destIndex = (y * width + x) * numChannels
        destFg[destIndex] = sumR / windowSize
        destFg[destIndex + 1] = sumG / windowSize
        destFg[destIndex + 2] = sumB / windowSize
        destFg[destIndex + 3] = sumA / windowSize

        // Subtract pixel leaving the window (top edge)
        const leavingY = Math.max(0, Math.min(height - 1, y - radius))
        const leavingIndex = (leavingY * width + x) * numChannels
        sumR -= tempBufferFg[leavingIndex]
        sumG -= tempBufferFg[leavingIndex + 1]
        sumB -= tempBufferFg[leavingIndex + 2]
        sumA -= tempBufferFg[leavingIndex + 3]

        // Add pixel entering the window (bottom edge)
        const enteringY = Math.max(0, Math.min(height - 1, y + radius + 1))
        const enteringIndex = (enteringY * width + x) * numChannels
        sumR += tempBufferFg[enteringIndex]
        sumG += tempBufferFg[enteringIndex + 1]
        sumB += tempBufferFg[enteringIndex + 2]
        sumA += tempBufferFg[enteringIndex + 3]
      }
    }

    // --- Vertical Pass --- Bg
    for (let x = 0; x < width; x++) {
      let sumR = 0,
        sumG = 0,
        sumB = 0,
        sumA = 0
      for (let y = -radius; y <= radius; y++) {
        const sampleY = Math.max(0, Math.min(height - 1, y))
        const srcIndex = (sampleY * width + x) * numChannels
        sumR += tempBufferBg[srcIndex]
        sumG += tempBufferBg[srcIndex + 1]
        sumB += tempBufferBg[srcIndex + 2]
        sumA += tempBufferBg[srcIndex + 3]
      }
      for (let y = 0; y < height; y++) {
        const destIndex = (y * width + x) * numChannels
        destBg[destIndex] = sumR / windowSize
        destBg[destIndex + 1] = sumG / windowSize
        destBg[destIndex + 2] = sumB / windowSize
        destBg[destIndex + 3] = sumA / windowSize
        const leavingY = Math.max(0, Math.min(height - 1, y - radius))
        const leavingIndex = (leavingY * width + x) * numChannels
        sumR -= tempBufferBg[leavingIndex]
        sumG -= tempBufferBg[leavingIndex + 1]
        sumB -= tempBufferBg[leavingIndex + 2]
        sumA -= tempBufferBg[leavingIndex + 3]
        const enteringY = Math.max(0, Math.min(height - 1, y + radius + 1))
        const enteringIndex = (enteringY * width + x) * numChannels
        sumR += tempBufferBg[enteringIndex]
        sumG += tempBufferBg[enteringIndex + 1]
        sumB += tempBufferBg[enteringIndex + 2]
        sumA += tempBufferBg[enteringIndex + 3]
      }
    }

    // --- Character Pass (Based on blurred FG Alpha) ---
    const charRamp = [" ", "░", "▒", "▓", " "] // Space, Light, Medium, Dark, Full
    const rampLength = charRamp.length

    for (let i = 0; i < size; i++) {
      const alphaIndex = i * numChannels + 3
      const fgAlpha = destFg[alphaIndex] // Get the final blurred FG alpha

      // Clamp alpha just in case, although blur should keep it in [0, 1]
      const clampedAlpha = Math.max(0, Math.min(1, fgAlpha))

      // Map alpha to character ramp
      // Ensure index doesn't exceed ramp bounds if alpha is exactly 1.0
      const rampIndex = Math.min(rampLength - 1, Math.floor(clampedAlpha * rampLength))

      chars[i] = charRamp[rampIndex].charCodeAt(0)
    }
  }
}

/**
 * Applies a bloom effect based on bright areas (Simplified).
 */
export class BloomEffect {
  private _threshold: number
  private _strength: number
  private _radius: number

  constructor(threshold: number = 0.8, strength: number = 0.2, radius: number = 2) {
    this._threshold = Math.max(0, Math.min(1, threshold))
    this._strength = Math.max(0, strength)
    this._radius = Math.max(0, Math.round(radius))
  }

  public set threshold(newThreshold: number) {
    this._threshold = Math.max(0, Math.min(1, newThreshold))
  }
  public get threshold(): number {
    return this._threshold
  }

  public set strength(newStrength: number) {
    this._strength = Math.max(0, newStrength)
  }
  public get strength(): number {
    return this._strength
  }

  public set radius(newRadius: number) {
    this._radius = Math.max(0, Math.round(newRadius))
  }
  public get radius(): number {
    return this._radius
  }

  public apply(buffer: OptimizedBuffer): void {
    const threshold = this._threshold
    const strength = this._strength
    const radius = this._radius

    if (strength <= 0 || radius <= 0) return // No bloom if strength or radius is non-positive

    const width = buffer.getWidth()
    const height = buffer.getHeight()
    // Operate directly on the buffer's data for bloom, but need a source copy temporarily
    const srcFg = Float32Array.from(buffer.buffers.fg)
    const srcBg = Float32Array.from(buffer.buffers.bg)
    const destFg = buffer.buffers.fg
    const destBg = buffer.buffers.bg

    const brightPixels: { x: number; y: number; intensity: number }[] = []

    // 1. Find bright pixels based on original data
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4
        // Consider max component brightness, or luminance? Using luminance.
        const fgLum = 0.299 * srcFg[index] + 0.587 * srcFg[index + 1] + 0.114 * srcFg[index + 2]
        const bgLum = 0.299 * srcBg[index] + 0.587 * srcBg[index + 1] + 0.114 * srcBg[index + 2]
        const lum = Math.max(fgLum, bgLum)
        if (lum > threshold) {
          const intensity = (lum - threshold) / (1 - threshold + 1e-6) // Add epsilon to avoid div by zero
          brightPixels.push({ x, y, intensity: Math.max(0, intensity) })
        }
      }
    }

    // If no bright pixels found, exit early
    if (brightPixels.length === 0) return

    // Initialize destination buffers by copying original state before applying bloom
    // This prevents bloom from compounding on itself within one frame pass
    destFg.set(srcFg)
    destBg.set(srcBg)

    // 2. Apply bloom spread from bright pixels onto the destination buffers
    for (const bright of brightPixels) {
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          if (kx === 0 && ky === 0) continue // Don't bloom self

          const sampleX = bright.x + kx
          const sampleY = bright.y + ky

          if (sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height) {
            const distSq = kx * kx + ky * ky // Use squared distance for falloff calculation
            const radiusSq = radius * radius
            if (distSq <= radiusSq) {
              // Simple linear falloff based on squared distance
              const falloff = 1 - distSq / radiusSq
              const bloomAmount = bright.intensity * strength * falloff
              const destIndex = (sampleY * width + sampleX) * 4

              // Add bloom to both fg and bg, clamping at 1.0
              destFg[destIndex] = Math.min(1.0, destFg[destIndex] + bloomAmount)
              destFg[destIndex + 1] = Math.min(1.0, destFg[destIndex + 1] + bloomAmount)
              destFg[destIndex + 2] = Math.min(1.0, destFg[destIndex + 2] + bloomAmount)

              destBg[destIndex] = Math.min(1.0, destBg[destIndex] + bloomAmount)
              destBg[destIndex + 1] = Math.min(1.0, destBg[destIndex + 1] + bloomAmount)
              destBg[destIndex + 2] = Math.min(1.0, destBg[destIndex + 2] + bloomAmount)
            }
          }
        }
      }
    }
  }
}
