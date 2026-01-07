import { RGBA } from "@opentui/core"

const hexToRGBA = (hex: number, alpha = 255) => RGBA.fromInts((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, alpha)

export const VUE_COLORS = {
  primary: 0x4fc08d,
  secondary: 0x42b883,
  dark: 0x35495e,
} as const

export const TAG_COLORS = {
  id: { textColor: 0x6b7280, backgroundColor: 0xf3f4f6 },
  size: { textColor: 0x059669, backgroundColor: 0xd1fae5 },
  hidden: { textColor: 0xdc2626, backgroundColor: 0xfee2e2 },
  focused: { textColor: 0x2563eb, backgroundColor: 0xdbeafe },
} as const

export const HIGHLIGHT = {
  border: hexToRGBA(VUE_COLORS.primary),
  background: hexToRGBA(VUE_COLORS.primary, 40),
  tooltipBg: hexToRGBA(VUE_COLORS.primary, 230),
  tooltipFg: RGBA.fromInts(0, 0, 0, 255),
} as const
