import { resolveRenderLib, type RenderLib } from "./zig"
import type { Pointer } from "bun:ffi"
import { OptimizedBuffer } from "./buffer"

export class NativePtySession {
  private lib: RenderLib
  private ptr: Pointer | null
  public cols: number
  public rows: number
  private destroyed: boolean = false

  constructor(ptr: Pointer, cols: number, rows: number, lib: RenderLib) {
    this.ptr = ptr
    this.cols = cols
    this.rows = rows
    this.lib = lib
  }

  static create(cols: number, rows: number): NativePtySession {
    const lib = resolveRenderLib()
    const sess = lib.terminalSessionCreate(cols, rows)
    if (!sess) throw new Error(`Failed to create native PTY session (cols=${cols}, rows=${rows})`)
    return new NativePtySession(sess, cols, rows, lib)
  }

  write(data: string | Uint8Array): number {
    if (this.destroyed || !this.ptr) {
      console.warn("Attempted to write to destroyed PTY session")
      return 0
    }
    try {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
      return this.lib.terminalSessionWrite(this.ptr, bytes)
    } catch (e) {
      console.error("PTY write error:", e)
      return 0
    }
  }

  resize(cols: number, rows: number): void {
    if (this.destroyed || !this.ptr) {
      console.warn("Attempted to resize destroyed PTY session")
      return
    }
    this.cols = cols
    this.rows = rows
    try {
      this.lib.terminalSessionResize(this.ptr, cols, rows)
    } catch (e) {
      console.error("PTY resize error:", e)
    }
  }

  tick(): number {
    if (this.destroyed || !this.ptr) return 0
    try {
      return this.lib.terminalSessionTick(this.ptr)
    } catch (e) {
      console.error("PTY tick error:", e)
      return 0
    }
  }

  render(target: OptimizedBuffer, x: number, y: number): void {
    if (this.destroyed || !this.ptr) return
    try {
      this.lib.terminalSessionRender(this.ptr, target.ptr, x, y)
    } catch (e) {
      console.error("PTY render error:", e)
    }
  }

  destroy(): void {
    if (this.destroyed || !this.ptr) return
    this.destroyed = true
    try {
      this.lib.terminalSessionDestroy(this.ptr)
    } catch (e) {
      console.error("PTY destroy error:", e)
    }
    this.ptr = null
  }
}

export function createPtySession(cols: number, rows: number): NativePtySession {
  return NativePtySession.create(cols, rows)
}
