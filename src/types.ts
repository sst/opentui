import { hexToRgb } from "./utils"

export class RGBA {
  buffer: Float32Array

  constructor(buffer: Float32Array) {
    this.buffer = buffer
  }

  static fromArray(array: Float32Array) {
    return new RGBA(array)
  }

  static fromValues(r: number, g: number, b: number, a: number = 1.0) {
    return new RGBA(new Float32Array([r, g, b, a]))
  }

  static fromInts(r: number, g: number, b: number, a: number = 255) {
    return new RGBA(new Float32Array([r / 255, g / 255, b / 255, a / 255]))
  }

  static fromHex(hex: string): RGBA {
    return hexToRgb(hex)
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

  map<R>(fn: (value: number) => R) {
    return [fn(this.r), fn(this.g), fn(this.b), fn(this.a)]
  }

  toString() {
    return `rgba(${this.r.toFixed(2)}, ${this.g.toFixed(2)}, ${this.b.toFixed(2)}, ${this.a.toFixed(2)})`
  }
}

export type ColorInput = string | RGBA

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

export interface RenderContext {
  addToHitGrid: (x: number, y: number, width: number, height: number, id: number) => void
  width: () => number
  height: () => number
}

export interface SelectionState {
  anchor: { x: number; y: number }
  focus: { x: number; y: number }
  isActive: boolean
  isSelecting: boolean
}

