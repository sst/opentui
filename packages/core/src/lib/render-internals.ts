import type { RenderContext } from "../types.js"

const stableRenderCallbacks = new WeakSet<(...args: any[]) => void>()
const scopedRenderRequests = new WeakSet<RenderContext>()

export function registerStableRenderCallback(callback: (...args: any[]) => void): void {
  stableRenderCallbacks.add(callback)
}

export function isStableRenderCallback(callback: (...args: any[]) => void): boolean {
  return stableRenderCallbacks.has(callback)
}

export function isScopedRenderRequest(ctx: RenderContext): boolean {
  return scopedRenderRequests.has(ctx)
}

export function requestScopedRender(ctx: RenderContext): void {
  scopedRenderRequests.add(ctx)
  try {
    ctx.requestRender()
  } finally {
    scopedRenderRequests.delete(ctx)
  }
}
