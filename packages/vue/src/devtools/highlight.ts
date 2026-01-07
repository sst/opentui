import { Renderable, type CliRenderer, type OptimizedBuffer, RGBA } from "@opentui/core"
import { HIGHLIGHT } from "./theme"

function getTooltipPosition(
  target: { x: number; y: number; width: number; height: number },
  textLength: number,
  screen: { width: number; height: number },
): { x: number; y: number } {
  const hasSpaceAbove = target.y > 0
  const hasSpaceBelow = target.y + target.height < screen.height
  const aboveY = target.y - 1
  const belowY = target.y + target.height

  const y = hasSpaceAbove ? aboveY : hasSpaceBelow ? belowY : target.y
  const x = Math.max(0, Math.min(target.x, screen.width - textLength))

  return { x, y }
}

export interface HighlightController {
  highlight(renderable: Renderable | null): void
  setInspectMode(enabled: boolean): void
  clear(): void
  destroy(): void
}

const CHROMATIC_LEFT = RGBA.fromInts(255, 80, 100, 200)
const CHROMATIC_RIGHT = RGBA.fromInts(80, 220, 255, 200)
const BORDER_COLOR = RGBA.fromInts(79, 192, 141, 220)

export function createHighlightOverlay(cliRenderer: CliRenderer): HighlightController {
  let target: Renderable | null = null
  let inspectMode = false
  let destroyed = false

  const render = (buffer: OptimizedBuffer): void => {
    if (destroyed || !target || target.isDestroyed) return

    const { x, y, width: w, height: h } = target
    const screenW = cliRenderer.width
    const screenH = cliRenderer.height

    const outerX1 = Math.max(0, x - 1)
    const outerY1 = Math.max(0, y - 1)
    const outerX2 = Math.min(screenW - 1, x + w)
    const outerY2 = Math.min(screenH - 1, y + h)

    const isOnScreen = (px: number, py: number) => px >= 0 && px < screenW && py >= 0 && py < screenH

    const drawChromaticCorner = (cx: number, cy: number, char: string, isLeftSide: boolean) => {
      if (!isOnScreen(cx, cy)) return
      buffer.drawText(char, cx, cy, isLeftSide ? CHROMATIC_LEFT : CHROMATIC_RIGHT, undefined)
    }

    drawChromaticCorner(outerX1, outerY1, "┌", true)
    drawChromaticCorner(outerX2, outerY1, "┐", false)
    drawChromaticCorner(outerX1, outerY2, "└", true)
    drawChromaticCorner(outerX2, outerY2, "┘", false)

    for (let dx = outerX1 + 1; dx < outerX2; dx++) {
      if (isOnScreen(dx, outerY1)) {
        buffer.drawText("─", dx, outerY1, BORDER_COLOR, undefined)
      }
      if (isOnScreen(dx, outerY2)) {
        buffer.drawText("─", dx, outerY2, BORDER_COLOR, undefined)
      }
    }

    for (let dy = outerY1 + 1; dy < outerY2; dy++) {
      if (isOnScreen(outerX1, dy)) {
        buffer.drawText("│", outerX1, dy, BORDER_COLOR, undefined)
      }
      if (isOnScreen(outerX2, dy)) {
        buffer.drawText("│", outerX2, dy, BORDER_COLOR, undefined)
      }
    }

    const text = `${target.constructor.name} #${target.id} (${w}x${h})`
    const tooltip = getTooltipPosition(
      { x: outerX1, y: outerY1, width: outerX2 - outerX1 + 1, height: outerY2 - outerY1 + 1 },
      text.length,
      { width: screenW, height: screenH },
    )
    if (tooltip.y >= 0 && tooltip.y < screenH && tooltip.x >= 0) {
      buffer.drawText(text, tooltip.x, tooltip.y, HIGHLIGHT.tooltipFg, HIGHLIGHT.tooltipBg)
    }
  }

  cliRenderer.root.onMouse = (event) => {
    if (destroyed || !inspectMode) return
    if (event.type === "move" || event.type === "drag") {
      if (event.target !== target) {
        target = event.target
        cliRenderer.requestRender()
      }
    }
  }

  cliRenderer.addPostProcessFn(render)

  return {
    highlight: (r) => {
      if (destroyed) return
      target = r
      cliRenderer.requestRender()
    },
    setInspectMode: (on) => {
      if (destroyed) return
      inspectMode = on
      cliRenderer.requestRender()
    },
    clear: () => {
      if (destroyed) return
      target = null
      cliRenderer.requestRender()
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      target = null
      cliRenderer.removePostProcessFn(render)
      cliRenderer.root.onMouse = undefined
    },
  }
}
