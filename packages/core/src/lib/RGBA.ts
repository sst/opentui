export type RGBTriplet = readonly [number, number, number]
export type ColorKind = "rgb" | "indexed" | "default"
export type ColorInput = string | RGBA

export const COLOR_TAG_RGB = 256
export const COLOR_TAG_DEFAULT = 257
export const DEFAULT_FOREGROUND_RGB: RGBTriplet = [255, 255, 255]
export const DEFAULT_BACKGROUND_RGB: RGBTriplet = [0, 0, 0]

const RGBA_BUFFER_STRIDE = 5

const ANSI16_RGB: readonly RGBTriplet[] = [
  [0x00, 0x00, 0x00],
  [0x80, 0x00, 0x00],
  [0x00, 0x80, 0x00],
  [0x80, 0x80, 0x00],
  [0x00, 0x00, 0x80],
  [0x80, 0x00, 0x80],
  [0x00, 0x80, 0x80],
  [0xc0, 0xc0, 0xc0],
  [0x80, 0x80, 0x80],
  [0xff, 0x00, 0x00],
  [0x00, 0xff, 0x00],
  [0xff, 0xff, 0x00],
  [0x00, 0x00, 0xff],
  [0xff, 0x00, 0xff],
  [0x00, 0xff, 0xff],
  [0xff, 0xff, 0xff],
]

const ANSI_256_CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const

export interface NormalizedColorValue {
  rgba: RGBA
  tag: number
}

function normalizeColorTag(tag: number | undefined): number {
  const normalizedTag = tag != null && Number.isFinite(tag) ? Math.round(tag) : COLOR_TAG_RGB

  if (normalizedTag === COLOR_TAG_RGB || normalizedTag === COLOR_TAG_DEFAULT) {
    return normalizedTag
  }

  if (Number.isInteger(normalizedTag) && normalizedTag >= 0 && normalizedTag <= 255) {
    return normalizedTag
  }

  return COLOR_TAG_RGB
}

function normalizeRGBABuffer(buffer: Float32Array): Float32Array {
  if (buffer.length === RGBA_BUFFER_STRIDE) {
    buffer[4] = normalizeColorTag(buffer[4])
    return buffer
  }

  const normalized = new Float32Array(RGBA_BUFFER_STRIDE)
  normalized[0] = buffer[0] ?? 0
  normalized[1] = buffer[1] ?? 0
  normalized[2] = buffer[2] ?? 0
  normalized[3] = buffer[3] ?? 0
  normalized[4] = COLOR_TAG_RGB

  return normalized
}

function withTag(rgba: RGBA, tag: number): RGBA {
  const tagged = RGBA.clone(rgba)
  tagged.tag = tag
  return tagged
}

function rgbaForAnsi256Index(index: number): RGBA {
  const [r, g, b] = ansi256IndexToRgb(index)
  return RGBA.fromInts(r, g, b)
}

export function normalizeIndexedColorIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new RangeError(`Indexed color must be an integer in the range 0..255, got ${index}`)
  }

  return index
}

export function ansi256IndexToRgb(index: number): RGBTriplet {
  const normalizedIndex = normalizeIndexedColorIndex(index)

  if (normalizedIndex < ANSI16_RGB.length) {
    return ANSI16_RGB[normalizedIndex]
  }

  if (normalizedIndex < 232) {
    const cubeIndex = normalizedIndex - 16
    const r = Math.floor(cubeIndex / 36)
    const g = Math.floor(cubeIndex / 6) % 6
    const b = cubeIndex % 6
    return [ANSI_256_CUBE_LEVELS[r], ANSI_256_CUBE_LEVELS[g], ANSI_256_CUBE_LEVELS[b]]
  }

  const value = 8 + (normalizedIndex - 232) * 10
  return [value, value, value]
}

export function decodeColorTag(tag: number): { kind: ColorKind; index?: number } {
  if (tag === COLOR_TAG_DEFAULT) {
    return { kind: "default" }
  }

  if (tag === COLOR_TAG_RGB) {
    return { kind: "rgb" }
  }

  return { kind: "indexed", index: normalizeIndexedColorIndex(tag) }
}

export class RGBA {
  buffer: Float32Array
  /** ANSI 16-color palette index (0-15) when this color was created from a
   *  standard named color (e.g. "red", "brightcyan"). Undefined for all other
   *  inputs so callers can fall back to truecolor without a separate flag. */
  ansi16Index?: number

  constructor(buffer: Float32Array) {
    this.buffer = normalizeRGBABuffer(buffer)
  }

  static fromArray(array: Float32Array) {
    return new RGBA(array)
  }

  static fromValues(r: number, g: number, b: number, a: number = 1.0, tag: number = COLOR_TAG_RGB) {
    return new RGBA(new Float32Array([r, g, b, a, normalizeColorTag(tag)]))
  }

  static clone(rgba: RGBA) {
    return RGBA.fromValues(rgba.r, rgba.g, rgba.b, rgba.a, rgba.tag)
  }

  static fromInts(r: number, g: number, b: number, a: number = 255, tag: number = COLOR_TAG_RGB) {
    return new RGBA(new Float32Array([r / 255, g / 255, b / 255, a / 255, normalizeColorTag(tag)]))
  }

  static fromHex(hex: string): RGBA {
    return hexToRgb(hex)
  }

  static fromIndex(index: number, snapshot?: ColorInput): RGBA {
    const normalizedIndex = normalizeIndexedColorIndex(index)
    return withTag(snapshot ? parseColor(snapshot) : rgbaForAnsi256Index(normalizedIndex), normalizedIndex)
  }

  static defaultForeground(snapshot?: ColorInput): RGBA {
    return withTag(snapshot ? parseColor(snapshot) : RGBA.fromInts(...DEFAULT_FOREGROUND_RGB), COLOR_TAG_DEFAULT)
  }

  static defaultBackground(snapshot?: ColorInput): RGBA {
    return withTag(snapshot ? parseColor(snapshot) : RGBA.fromInts(...DEFAULT_BACKGROUND_RGB), COLOR_TAG_DEFAULT)
  }

  static getIntentTag(rgba: RGBA): number {
    return rgba.tag
  }

  toInts(): [number, number, number, number] {
    return [Math.round(this.r * 255), Math.round(this.g * 255), Math.round(this.b * 255), Math.round(this.a * 255)]
  }

  get r(): number {
    return this.buffer[0]
  }

  set r(value: number) {
    this.buffer[0] = value
  }

  get g(): number {
    return this.buffer[1]
  }

  set g(value: number) {
    this.buffer[1] = value
  }

  get b(): number {
    return this.buffer[2]
  }

  set b(value: number) {
    this.buffer[2] = value
  }

  get a(): number {
    return this.buffer[3]
  }

  set a(value: number) {
    this.buffer[3] = value
  }

  get tag(): number {
    return normalizeColorTag(this.buffer[4])
  }

  set tag(value: number) {
    this.buffer[4] = normalizeColorTag(value)
  }

  map<R>(fn: (value: number) => R) {
    return [fn(this.r), fn(this.g), fn(this.b), fn(this.a)]
  }

  toString() {
    return `rgba(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`
  }

  equals(other?: RGBA): boolean {
    if (!other) return false
    return (
      this.r === other.r && this.g === other.g && this.b === other.b && this.a === other.a && this.tag === other.tag
    )
  }
}

export function normalizeColorValue(value: ColorInput | null | undefined): NormalizedColorValue | null {
  if (value == null) return null

  const rgba = parseColor(value)
  return { rgba, tag: rgba.tag }
}

export function hexToRgb(hex: string): RGBA {
  hex = hex.replace(/^#/, "")

  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  } else if (hex.length === 4) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
  }

  if (!/^[0-9A-Fa-f]{6}$/.test(hex) && !/^[0-9A-Fa-f]{8}$/.test(hex)) {
    console.warn(`Invalid hex color: ${hex}, defaulting to magenta`)
    return RGBA.fromValues(1, 0, 1, 1)
  }

  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255
  const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1

  return RGBA.fromValues(r, g, b, a)
}

export function rgbToHex(rgb: RGBA): string {
  const components = rgb.a === 1 ? [rgb.r, rgb.g, rgb.b] : [rgb.r, rgb.g, rgb.b, rgb.a]
  return (
    "#" +
    components
      .map((x) => {
        const hex = Math.floor(Math.max(0, Math.min(1, x) * 255)).toString(16)
        return hex.length === 1 ? "0" + hex : hex
      })
      .join("")
  )
}

export function hsvToRgb(h: number, s: number, v: number): RGBA {
  let r = 0,
    g = 0,
    b = 0

  const i = Math.floor(h / 60) % 6
  const f = h / 60 - Math.floor(h / 60)
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  switch (i) {
    case 0:
      r = v
      g = t
      b = p
      break
    case 1:
      r = q
      g = v
      b = p
      break
    case 2:
      r = p
      g = v
      b = t
      break
    case 3:
      r = p
      g = q
      b = v
      break
    case 4:
      r = t
      g = p
      b = v
      break
    case 5:
      r = v
      g = p
      b = q
      break
  }

  return RGBA.fromValues(r, g, b, 1)
}

const CSS_COLOR_NAMES: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
  silver: "#C0C0C0",
  gray: "#808080",
  grey: "#808080",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00FF00",
  aqua: "#00FFFF",
  teal: "#008080",
  navy: "#000080",
  fuchsia: "#FF00FF",
  purple: "#800080",
  orange: "#FFA500",
  brightblack: "#666666",
  brightred: "#FF6666",
  brightgreen: "#66FF66",
  brightblue: "#6666FF",
  brightyellow: "#FFFF66",
  brightcyan: "#66FFFF",
  brightmagenta: "#FF66FF",
  brightwhite: "#FFFFFF",
}

// Maps the subset of CSS_COLOR_NAMES that correspond to the 16-color ANSI
// palette to their canonical palette index (0 = black … 15 = brightwhite).
// Colors that exist in CSS_COLOR_NAMES but have no ANSI 16 equivalent
// (gray, silver, maroon, olive, …) are intentionally absent so callers
// continue to use truecolor for those inputs.
const ANSI_16_INDEX: Record<string, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightblack: 8,
  brightred: 9,
  brightgreen: 10,
  brightyellow: 11,
  brightblue: 12,
  brightmagenta: 13,
  brightcyan: 14,
  brightwhite: 15,
}

export function parseColor(color: ColorInput): RGBA {
  if (typeof color === "string") {
    const lowerColor = color.toLowerCase()

    if (lowerColor === "transparent") {
      return RGBA.fromValues(0, 0, 0, 0)
    }

    if (CSS_COLOR_NAMES[lowerColor]) {
      const rgba = hexToRgb(CSS_COLOR_NAMES[lowerColor])
      const ansi16 = ANSI_16_INDEX[lowerColor]
      if (ansi16 !== undefined) {
        rgba.ansi16Index = ansi16
      }
      return rgba
    }

    return hexToRgb(color)
  }
  return color
}
