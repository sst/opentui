export type AppearanceMode = "dark" | "light"

export interface ColorStop {
  background: string
  foreground: string
  shadow: string
  accent: string
}

const LIGHT_SURFACE = "#FFF9F2"
const LIGHT_INK = "#171411"

function mixHex(from: string, to: string, progress: number): string {
  const fromValue = Number.parseInt(from.slice(1), 16)
  const toValue = Number.parseInt(to.slice(1), 16)
  const channels = [16, 8, 0].map((shift) => {
    const start = (fromValue >> shift) & 0xff
    const end = (toValue >> shift) & 0xff
    return Math.round(start + (end - start) * progress)
      .toString(16)
      .padStart(2, "0")
  })
  return `#${channels.join("")}`
}

export function paletteForAppearance(palette: ColorStop, mode: AppearanceMode): ColorStop {
  if (mode === "dark") return palette
  return {
    background: mixHex(LIGHT_SURFACE, palette.background, 0.08),
    foreground: mixHex(LIGHT_INK, palette.foreground, 0.34),
    shadow: mixHex(LIGHT_SURFACE, palette.shadow, 0.62),
    accent: mixHex(LIGHT_INK, palette.accent, 0.64),
  }
}
