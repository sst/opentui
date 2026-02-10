import type { RGBA } from "./lib/RGBA"
import type { EventEmitter } from "events"
import type { Selection } from "./lib/selection"
import type { Renderable } from "./Renderable"
import type { InternalKeyHandler, KeyHandler } from "./lib/KeyHandler"

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

// Constants for attribute bit packing
export const ATTRIBUTE_BASE_BITS = 8
export const ATTRIBUTE_BASE_MASK = 0xff

/**
 * Extract the base 8 bits of attributes from a u32 attribute value.
 * Currently we only use the first 8 bits for standard text attributes.
 */
export function getBaseAttributes(attr: number): number {
  return attr & ATTRIBUTE_BASE_MASK
}

export type CursorStyle = "block" | "line" | "underline"

export interface CursorStyleOptions {
  style: CursorStyle
  blinking: boolean
}

export enum DebugOverlayCorner {
  topLeft = 0,
  topRight = 1,
  bottomLeft = 2,
  bottomRight = 3,
}

export type WidthMethod = "wcwidth" | "unicode"

export interface RendererEvents {
  resize: (width: number, height: number) => void
  key: (data: Buffer) => void
  "memory:snapshot": (snapshot: { heapUsed: number; heapTotal: number; arrayBuffers: number }) => void
  selection: (selection: Selection) => void
  "debugOverlay:toggle": (enabled: boolean) => void
}

export interface RenderContext extends EventEmitter {
  addToHitGrid: (x: number, y: number, width: number, height: number, id: number) => void
  pushHitGridScissorRect: (x: number, y: number, width: number, height: number) => void
  popHitGridScissorRect: () => void
  clearHitGridScissorRects: () => void
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
  hasSelection: boolean
  getSelection: () => Selection | null
  requestSelectionUpdate: () => void
  currentFocusedRenderable: Renderable | null
  focusRenderable: (renderable: Renderable) => void
  registerLifecyclePass: (renderable: Renderable) => void
  unregisterLifecyclePass: (renderable: Renderable) => void
  getLifecyclePasses: () => Set<Renderable>
  keyInput: KeyHandler
  _internalKeyInput: InternalKeyHandler
  clearSelection: () => void
  startSelection: (renderable: Renderable, x: number, y: number) => void
  updateSelection: (
    currentRenderable: Renderable | undefined,
    x: number,
    y: number,
    options?: { finishDragging?: boolean },
  ) => void
}

export type Timeout = ReturnType<typeof setTimeout> | undefined

export interface ViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Highlight {
  start: number
  end: number
  styleId: number
  priority?: number | null
  hlRef?: number | null
}

export interface LineInfo {
  lineStarts: number[]
  lineWidths: number[]
  maxLineWidth: number
  lineSources: number[]
  lineWraps: number[]
}

export interface LineInfoProvider {
  get lineInfo(): LineInfo
  get lineCount(): number
  get virtualLineCount(): number
  get scrollY(): number
}

export interface CapturedSpan {
  text: string
  fg: RGBA
  bg: RGBA
  attributes: number
  width: number
}

export interface CapturedLine {
  spans: CapturedSpan[]
}

export interface CapturedFrame {
  cols: number
  rows: number
  cursor: [number, number]
  lines: CapturedLine[]
}
