export type HexColor = `#${string}`

interface RGB {
  r: number
  g: number
  b: number
}

interface LAB {
  l: number
  a: number
  b: number
}

const D65 = {
  x: 0.95047,
  y: 1,
  z: 1.08883,
} as const

const f = (t: number): number => {
  if (t > 0.008856) return Math.cbrt(t)
  return 7.787 * t + 16 / 116
}

const fInv = (t: number): number => {
  const t3 = t * t * t
  if (t3 > 0.008856) return t3
  return (t - 16 / 116) / 7.787
}

const srgbToLinear = (value: number): number => {
  const x = value / 255
  if (x > 0.04045) return ((x + 0.055) / 1.055) ** 2.4
  return x / 12.92
}

const linearToSrgb = (value: number): number => {
  const companded = value > 0.0031308 ? 1.055 * Math.pow(value, 1 / 2.4) - 0.055 : 12.92 * value
  const clamped = Math.max(0, Math.min(1, companded))
  return Math.round(clamped * 255)
}

const hexToRgb = (hex: string): RGB => {
  const raw = hex.startsWith("#") ? hex.slice(1) : hex
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  }
}

const rgbToHex = (rgb: RGB): HexColor => {
  const toHex = (x: number): string => x.toString(16).padStart(2, "0")
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`
}

const rgbToLab = (rgb: RGB): LAB => {
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / D65.x
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / D65.y
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / D65.z

  const fx = f(x)
  const fy = f(y)
  const fz = f(z)

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

const labToRgb = (lab: LAB): RGB => {
  const fy = (lab.l + 16) / 116
  const fx = lab.a / 500 + fy
  const fz = fy - lab.b / 200

  const x = fInv(fx) * D65.x
  const y = fInv(fy) * D65.y
  const z = fInv(fz) * D65.z

  const rLinear = x * 3.2404542 - y * 1.5371385 - z * 0.4985314
  const gLinear = -x * 0.969266 + y * 1.8760108 + z * 0.041556
  const bLinear = x * 0.0556434 - y * 0.2040259 + z * 1.0572252

  return {
    r: linearToSrgb(rLinear),
    g: linearToSrgb(gLinear),
    b: linearToSrgb(bLinear),
  }
}

const lerpLab = (t: number, a: LAB, b: LAB): LAB => {
  return {
    l: a.l + t * (b.l - a.l),
    a: a.a + t * (b.a - a.a),
    b: a.b + t * (b.b - a.b),
  }
}

// Generates terminal 256 colors from ANSI base16 + background/foreground.
// References:
// - https://gist.github.com/jake-stewart/0a8ea46159a7da2c808e5be2177e1783
// - https://github.com/ghostty-org/ghostty/pull/10554
export function generate256PaletteFromBase16(
  base16: readonly string[],
  background: string,
  foreground: string,
): HexColor[] {
  if (base16.length < 16) {
    throw new Error(`Expected 16 ANSI colors, got ${String(base16.length)}`)
  }

  const out: HexColor[] = base16.slice(0, 16).map((c) => rgbToHex(hexToRgb(c)))
  const base8Lab = base16.slice(0, 8).map((hex) => rgbToLab(hexToRgb(hex)))
  const bgLab = rgbToLab(hexToRgb(background))
  const fgLab = rgbToLab(hexToRgb(foreground))

  for (let ri = 0; ri < 6; ri += 1) {
    const tr = ri / 5
    const c0 = lerpLab(tr, bgLab, base8Lab[1])
    const c1 = lerpLab(tr, base8Lab[2], base8Lab[3])
    const c2 = lerpLab(tr, base8Lab[4], base8Lab[5])
    const c3 = lerpLab(tr, base8Lab[6], fgLab)

    for (let gi = 0; gi < 6; gi += 1) {
      const tg = gi / 5
      const c4 = lerpLab(tg, c0, c1)
      const c5 = lerpLab(tg, c2, c3)

      for (let bi = 0; bi < 6; bi += 1) {
        const c6 = lerpLab(bi / 5, c4, c5)
        out.push(rgbToHex(labToRgb(c6)))
      }
    }
  }

  for (let i = 0; i < 24; i += 1) {
    const t = (i + 1) / 25
    out.push(rgbToHex(labToRgb(lerpLab(t, bgLab, fgLab))))
  }

  return out
}

// Fills missing entries in an existing palette without overwriting known colors.
export function fillMissingWithGenerated256(
  palette: readonly (string | null)[],
  background: string,
  foreground: string,
): (string | null)[] {
  if (palette.length < 16) return [...palette]

  const base16 = palette.slice(0, 16)
  if (base16.some((entry) => !entry)) {
    return [...palette]
  }

  const generated = generate256PaletteFromBase16(base16 as readonly string[], background, foreground)
  const size = Math.max(palette.length, generated.length)
  const out = Array.from({ length: size }, (_, idx) => palette[idx] ?? null)

  for (let i = 16; i < Math.min(size, generated.length); i += 1) {
    if (out[i] == null) out[i] = generated[i]
  }

  return out
}
