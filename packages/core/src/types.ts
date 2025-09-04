import type { RGBA } from "./lib/RGBA"

export const TextAttributes = {
  NONE: 0,
  BOLD: 1 << 0, // 1
  DIM: 1 << 1, // 2
  ITALIC: 1 << 2, // 4
  UNDERLINE: 1 << 3, // 8
  BLINK: 1 << 4, // 16
  INVERSE: 1 << 5, // 32
  HIDDEN: 1 << 6, // 64
  STRIKETHROUGH: 1 << 7, // 128
}

export type CursorStyle = "block" | "line" | "underline"

export enum DebugOverlayCorner {
  topLeft = 0,
  topRight = 1,
  bottomLeft = 2,
  bottomRight = 3,
}

export type WidthMethod = "wcwidth" | "unicode"

export interface RenderContext {
  addToHitGrid: (x: number, y: number, width: number, height: number, id: number) => void
  width: number
  height: number
  requestRender: () => void
  setCursorPosition: (x: number, y: number, visible: boolean) => void
  setCursorStyle: (style: CursorStyle, blinking: boolean) => void
  setCursorColor: (color: RGBA) => void
  widthMethod: WidthMethod
  capabilities: any | null
  requestLive: () => void
  dropLive: () => void
}

export interface SelectionState {
  anchor: { x: number; y: number }
  focus: { x: number; y: number }
  isActive: boolean
  isSelecting: boolean
}

export type Timeout = ReturnType<typeof setTimeout> | undefined
