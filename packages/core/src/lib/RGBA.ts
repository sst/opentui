export class RGBA {
  buffer: Float32Array

  constructor(buffer: Float32Array) {
    this.buffer = buffer
  }

  static fromArray(array: Float32Array) {
    if (array.length === 4) {
      // Legacy 4-element array — add meta = 0 (RGB)
      const buf = new Float32Array(5)
      buf.set(array)
      return new RGBA(buf)
    }
    return new RGBA(array)
  }

  static fromValues(r: number, g: number, b: number, a: number = 1.0, meta: number = 0) {
    return new RGBA(new Float32Array([r, g, b, a, meta]))
  }

  static fromInts(r: number, g: number, b: number, a: number = 255) {
    return new RGBA(new Float32Array([r / 255, g / 255, b / 255, a / 255, 0]))
  }

  static fromIndex(index: number): RGBA {
    // Approximate RGB from 256-color palette, with indexed meta
    const meta = 256 + index // colorType=1 (indexed) * 256 + index
    if (index < 16) {
      // Standard + bright colors - use predefined values
      const STANDARD: [number, number, number][] = [
        [0, 0, 0], [0.5, 0, 0], [0, 0.5, 0], [0.5, 0.5, 0],
        [0, 0, 0.5], [0.5, 0, 0.5], [0, 0.5, 0.5], [0.75, 0.75, 0.75],
        [0.5, 0.5, 0.5], [1, 0, 0], [0, 1, 0], [1, 1, 0],
        [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
      ]
      const [r, g, b] = STANDARD[index]
      return new RGBA(new Float32Array([r, g, b, 1.0, meta]))
    } else if (index < 232) {
      // 6x6x6 color cube (indices 16-231)
      const ci = index - 16
      const ri = Math.floor(ci / 36)
      const gi = Math.floor((ci % 36) / 6)
      const bi = ci % 6
      return new RGBA(new Float32Array([
        ri === 0 ? 0 : (55 + ri * 40) / 255,
        gi === 0 ? 0 : (55 + gi * 40) / 255,
        bi === 0 ? 0 : (55 + bi * 40) / 255,
        1.0, meta,
      ]))
    } else {
      // Grayscale (indices 232-255)
      const gray = (8 + (index - 232) * 10) / 255
      return new RGBA(new Float32Array([gray, gray, gray, 1.0, meta]))
    }
  }

  static defaultColor(): RGBA {
    return new RGBA(new Float32Array([1.0, 1.0, 1.0, 1.0, 512])) // colorType=2 (default) * 256
  }

  static fromHex(hex: string): RGBA {
    return hexToRgb(hex)
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

  get meta(): number {
    return this.buffer[4]
  }

  set meta(value: number) {
    this.buffer[4] = value
  }

  get colorType(): number {
    return Math.floor(this.buffer[4] / 256)
  }

  get colorIndex(): number {
    return this.buffer[4] % 256
  }

  isRgb(): boolean {
    return this.colorType === 0
  }

  isIndexed(): boolean {
    return this.colorType === 1
  }

  isDefault(): boolean {
    return this.colorType === 2
  }

  map<R>(fn: (value: number) => R) {
    return [fn(this.r), fn(this.g), fn(this.b), fn(this.a)]
  }

  toString() {
    return `rgba(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`
  }

  equals(other?: RGBA): boolean {
    if (!other) return false
    return this.r === other.r && this.g === other.g && this.b === other.b && this.a === other.a && this.meta === other.meta
  }
}

export type ColorInput = string | RGBA

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

export function parseColor(color: ColorInput): RGBA {
  if (typeof color === "string") {
    const lowerColor = color.toLowerCase()

    if (lowerColor === "transparent") {
      return RGBA.fromValues(0, 0, 0, 0)
    }

    if (CSS_COLOR_NAMES[lowerColor]) {
      return hexToRgb(CSS_COLOR_NAMES[lowerColor])
    }

    return hexToRgb(color)
  }
  return color
}
