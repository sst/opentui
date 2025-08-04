#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  RGBA,
  TextAttributes,
  FrameBufferRenderable,
  TextRenderable,
  StyledTextRenderable,
  t,
  type MouseEvent,
  OptimizedBuffer,
  BoxRenderable,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

interface TrailCell {
  x: number
  y: number
  timestamp: number
  isDrag?: boolean
}

let demoContainer: MouseInteractionFrameBuffer | null = null
let titleText: TextRenderable | null = null
let instructionsText: StyledTextRenderable | null = null
let draggableBoxes: DraggableBox[] = []
let nextZIndex = 101

class DraggableBox extends BoxRenderable {
  private isDragging = false
  private gotText = ""
  private dragOffsetX = 0
  private dragOffsetY = 0

  constructor(id: string, x: number, y: number, width: number, height: number, color: RGBA, label: string) {
    super(id, {
      x,
      y,
      width,
      height,
      zIndex: 100,
      bg: RGBA.fromValues(color.r, color.g, color.b, 0.8),
      borderColor: RGBA.fromValues(color.r * 1.2, color.g * 1.2, color.b * 1.2, 1.0),
      borderStyle: "rounded",
      title: label,
      titleAlignment: "center",
    })
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    if (this.isDragging) {
      const centerX = this.x + Math.floor(this.width / 2 - 2)
      const centerY = this.y + Math.floor(this.height / 2)
      buffer.drawText("drag", centerX, centerY, RGBA.fromInts(255, 255, 0))
    }

    if (this.gotText) {
      const centerX = this.x + Math.floor(this.width / 2 - this.gotText.length / 2)
      const centerY = this.y + Math.floor(this.height / 2)
      buffer.drawText("got", this.x + Math.floor(this.width / 2 - 2), centerY - 1, RGBA.fromInts(255, 255, 0))
      buffer.drawText(this.gotText, centerX, centerY + (this.isDragging ? 1 : 0), RGBA.fromInts(255, 255, 0))
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case "down":
        console.log("down", event.x, event.y)
        this.gotText = ""
        this.isDragging = true
        this.dragOffsetX = event.x - this.x
        this.dragOffsetY = event.y - this.y
        this.zIndex = nextZIndex++
        event.preventDefault()
        break

      case "drag-end":
        if (this.isDragging) {
          this.isDragging = false
          this.zIndex = 100
          event.preventDefault()
        }
        break

      case "drag":
        if (this.isDragging) {
          this.x = event.x - this.dragOffsetX
          this.y = event.y - this.dragOffsetY

          this.x = Math.max(0, Math.min(this.x, (this.ctx?.width() || 80) - this.width))
          this.y = Math.max(4, Math.min(this.y, (this.ctx?.height() || 24) - this.height))

          event.preventDefault()
        }
        break

      case "over":
        this.gotText = "over " + (event.source?.id || "over")
        break

      case "out":
        this.gotText = "out"
        break

      case "drop":
        this.gotText = event.source?.id || ""
        break
    }
  }
}

class MouseInteractionFrameBuffer extends FrameBufferRenderable {
  private readonly trailCells = new Map<string, TrailCell>()
  private readonly activatedCells = new Set<string>()
  private readonly TRAIL_FADE_DURATION = 3000

  private readonly TRAIL_COLOR = RGBA.fromInts(64, 224, 208, 255)
  private readonly DRAG_COLOR = RGBA.fromInts(255, 165, 0, 255)
  private readonly ACTIVATED_COLOR = RGBA.fromInts(255, 20, 147, 255)
  private readonly BACKGROUND_COLOR = RGBA.fromInts(15, 15, 35, 255)
  private readonly CURSOR_COLOR = RGBA.fromInts(255, 255, 255, 255)

  constructor(id: string, renderer: CliRenderer) {
    super(
      id,
      renderer.createFrameBuffer(id, {
        width: renderer.terminalWidth,
        height: renderer.terminalHeight,
        x: 0,
        y: 0,
        zIndex: 0,
      }).frameBuffer,
      {
        width: renderer.terminalWidth,
        height: renderer.terminalHeight,
        x: 0,
        y: 0,
        zIndex: 0,
      },
    )
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const currentTime = Date.now()

    this.frameBuffer.clear(this.BACKGROUND_COLOR)

    for (const [key, cell] of this.trailCells.entries()) {
      if (currentTime - cell.timestamp > this.TRAIL_FADE_DURATION) {
        this.trailCells.delete(key)
      }
    }

    for (const [, cell] of this.trailCells.entries()) {
      const age = currentTime - cell.timestamp
      const fadeRatio = 1 - age / this.TRAIL_FADE_DURATION

      if (fadeRatio > 0) {
        const baseColor = cell.isDrag ? this.DRAG_COLOR : this.TRAIL_COLOR
        const smoothAlpha = fadeRatio

        const fadedColor = RGBA.fromValues(baseColor.r, baseColor.g, baseColor.b, smoothAlpha)

        this.frameBuffer.setCellWithAlphaBlending(cell.x, cell.y, "█", fadedColor, this.BACKGROUND_COLOR)
      }
    }

    for (const cellKey of this.activatedCells) {
      const [x, y] = cellKey.split(",").map(Number)

      this.frameBuffer.drawText("█", x, y, this.ACTIVATED_COLOR, this.BACKGROUND_COLOR)
    }

    const recentTrails = Array.from(this.trailCells.values())
      .filter((cell) => currentTime - cell.timestamp < 100)
      .sort((a, b) => b.timestamp - a.timestamp)

    if (recentTrails.length > 0) {
      const latest = recentTrails[0]
      this.frameBuffer.setCellWithAlphaBlending(latest.x, latest.y, "+", this.CURSOR_COLOR, this.BACKGROUND_COLOR)
    }

    super.renderSelf(buffer)
  }

  protected onMouseEvent(event: MouseEvent): void {
    if (event.defaultPrevented) return

    const cellKey = `${event.x},${event.y}`
    console.log("event", event.type, event.button)
    switch (event.type) {
      case "move":
        this.trailCells.set(cellKey, {
          x: event.x,
          y: event.y,
          timestamp: Date.now(),
          isDrag: false,
        })
        break

      case "drag":
        this.trailCells.set(cellKey, {
          x: event.x,
          y: event.y,
          timestamp: Date.now(),
          isDrag: true,
        })
        break

      case "down":
        if (this.activatedCells.has(cellKey)) {
          this.activatedCells.delete(cellKey)
        } else {
          this.activatedCells.add(cellKey)
        }
        break
    }
  }

  public clearState(): void {
    this.trailCells.clear()
    this.activatedCells.clear()
  }
}

export function run(renderer: CliRenderer): void {
  renderer.start()
  const backgroundColor = RGBA.fromInts(15, 15, 35, 255)
  renderer.setBackgroundColor(backgroundColor)

  titleText = new TextRenderable("mouse_demo_title", {
    content: "Mouse Interaction Demo with Draggable Objects",
    x: 2,
    y: 1,
    fg: RGBA.fromInts(255, 215, 0),
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  renderer.add(titleText)

  instructionsText = renderer.createStyledText("mouse_demo_instructions", {
    fragment: t`Drag boxes around • Move mouse: turquoise trails
Hold + move: orange drag trails • Click cells: toggle pink
Escape: menu`,
    x: 2,
    y: 2,
    width: renderer.width - 4,
    height: 3,
    defaultFg: RGBA.fromInts(176, 196, 222),
    zIndex: 1000,
  })
  renderer.add(instructionsText)

  demoContainer = new MouseInteractionFrameBuffer("mouse-demo-buffer", renderer)
  renderer.add(demoContainer)

  draggableBoxes = [
    new DraggableBox("drag-box-1", 10, 8, 14, 6, RGBA.fromInts(200, 100, 150), "Box 1"),
    new DraggableBox("drag-box-2", 30, 12, 12, 6, RGBA.fromInts(100, 200, 150), "Box 2"),
    new DraggableBox("drag-box-3", 50, 15, 14, 7, RGBA.fromInts(150, 150, 200), "Box 3"),
    new DraggableBox("drag-box-4", 15, 20, 12, 6, RGBA.fromInts(200, 200, 100), "Box 4"),
  ]

  for (const box of draggableBoxes) {
    renderer.add(box)
  }
}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()

  if (demoContainer) {
    demoContainer.clearState()
    renderer.remove("mouse-demo-buffer")
    demoContainer = null
  }

  if (titleText) {
    renderer.remove("mouse_demo_title")
    titleText = null
  }

  if (instructionsText) {
    renderer.remove("mouse_demo_instructions")
    instructionsText = null
  }

  for (const box of draggableBoxes) {
    renderer.remove(box.id)
  }
  draggableBoxes = []
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
