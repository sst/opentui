#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  RGBA,
  TextAttributes,
  FrameBufferRenderable,
  TextRenderable,
  t,
  type MouseEvent,
  OptimizedBuffer,
  BoxRenderable,
  createTimeline,
  engine,
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
let instructionsText: TextRenderable | null = null
let draggableBoxes: DraggableBox[] = []
let nextZIndex = 101

class DraggableBox extends BoxRenderable {
  private isDragging = false
  private gotText = ""
  private scrollText = ""
  private scrollTimestamp = 0
  private dragOffsetX = 0
  private dragOffsetY = 0
  private bounceScale = { value: 1 }
  private baseWidth: number
  private baseHeight: number
  private centerX: number
  private centerY: number
  private originalBg: RGBA
  private dragBg: RGBA
  private originalBorderColor: RGBA
  private dragBorderColor: RGBA

  constructor(id: string, x: number, y: number, width: number, height: number, color: RGBA, label: string) {
    const bgColor = RGBA.fromValues(color.r, color.g, color.b, 0.8)
    const borderColor = RGBA.fromValues(color.r * 1.2, color.g * 1.2, color.b * 1.2, 1.0)
    super(id, {
      position: "absolute",
      left: x,
      top: y,
      width,
      height,
      zIndex: 100,
      backgroundColor: bgColor,
      borderColor: borderColor,
      borderStyle: "rounded",
      title: label,
      titleAlignment: "center",
    })
    this.baseWidth = width
    this.baseHeight = height
    this.centerX = x + width / 2
    this.centerY = y + height / 2
    this.originalBg = bgColor
    this.dragBg = RGBA.fromValues(color.r, color.g, color.b, 0.3)
    this.originalBorderColor = borderColor
    this.dragBorderColor = RGBA.fromValues(color.r * 1.2, color.g * 1.2, color.b * 1.2, 0.5)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    this.width = Math.round(this.baseWidth * this.bounceScale.value)
    this.height = Math.round(this.baseHeight * this.bounceScale.value)

    this.x = Math.round(this.centerX - this.width / 2)
    this.y = Math.round(this.centerY - this.height / 2)

    super.renderSelf(buffer)

    const currentTime = Date.now()
    if (this.scrollText && currentTime - this.scrollTimestamp > 2000) {
      this.scrollText = ""
    }

    const baseCenterX = this.x + Math.floor(this.width / 2)
    const baseCenterY = this.y + Math.floor(this.height / 2)

    let textLines = 0
    if (this.isDragging) textLines++
    if (this.scrollText) textLines++
    if (this.gotText) textLines += 2

    let currentY = textLines > 1 ? baseCenterY - Math.floor(textLines / 2) : baseCenterY

    if (this.isDragging) {
      const centerX = baseCenterX - 2
      buffer.drawText("drag", centerX, currentY, RGBA.fromInts(64, 224, 208))
      currentY++
    }

    if (this.scrollText) {
      const age = currentTime - this.scrollTimestamp
      const fadeRatio = Math.max(0, 1 - age / 2000)
      const alpha = Math.round(255 * fadeRatio)

      const centerX = baseCenterX - Math.floor(this.scrollText.length / 2)
      buffer.drawText(this.scrollText, centerX, currentY, RGBA.fromInts(255, 255, 0, alpha))
      currentY++
    }

    if (this.gotText) {
      const gotX = baseCenterX - 2
      const gotTextX = baseCenterX - Math.floor(this.gotText.length / 2)
      buffer.drawText("got", gotX, currentY, RGBA.fromInts(255, 182, 193))
      currentY++
      buffer.drawText(this.gotText, gotTextX, currentY, RGBA.fromInts(147, 226, 255))
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case "down":
        this.gotText = ""
        this.isDragging = true
        this.dragOffsetX = event.x - this.x
        this.dragOffsetY = event.y - this.y
        this.zIndex = nextZIndex++
        this.backgroundColor = this.dragBg
        this.borderColor = this.dragBorderColor
        event.preventDefault()
        break

      case "drag-end":
        if (this.isDragging) {
          this.isDragging = false
          this.zIndex = 100
          this.backgroundColor = this.originalBg
          this.borderColor = this.originalBorderColor
          event.preventDefault()
        }
        break

      case "drag":
        if (this.isDragging) {
          const newX = event.x - this.dragOffsetX
          const newY = event.y - this.dragOffsetY

          const boundedX = Math.max(0, Math.min(newX, (this.ctx?.width() || 80) - this.width))
          const boundedY = Math.max(4, Math.min(newY, (this.ctx?.height() || 24) - this.height))

          this.centerX = boundedX + this.width / 2
          this.centerY = boundedY + this.height / 2

          event.preventDefault()
        }
        break

      case "over":
        this.gotText = "over " + (event.source?.id || "")
        break

      case "out":
        this.gotText = "out"
        break

      case "drop":
        this.gotText = event.source?.id || ""
        const timeline = createTimeline()

        timeline.add(this.bounceScale, {
          value: 1.5,
          duration: 200,
          ease: "outExpo",
        })

        timeline.add(
          this.bounceScale,
          {
            value: 1.0,
            duration: 400,
            ease: "outExpo",
          },
          150,
        )
        break

      case "scroll":
        if (event.scroll) {
          this.scrollText = `scroll ${event.scroll.direction}`
          this.scrollTimestamp = Date.now()
          event.preventDefault()
        }
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
    super(id, {
      width: renderer.terminalWidth,
      height: renderer.terminalHeight,
      zIndex: 0,
    })
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

  renderer.setFrameCallback(async (deltaTime: number) => {
    engine.update(deltaTime)
  })

  titleText = new TextRenderable("mouse_demo_title", {
    content: "Mouse Interaction Demo with Draggable Objects",
    width: "100%",
    position: "absolute",
    left: 2,
    top: 1,
    fg: RGBA.fromInts(72, 209, 204),
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  renderer.root.add(titleText)

  instructionsText = new TextRenderable("mouse_demo_instructions", {
    content: t`Drag boxes around • Move mouse: turquoise trails
Hold + move: orange drag trails • Click cells: toggle pink
Scroll on boxes: shows direction • Escape: menu`,
    position: "absolute",
    left: 2,
    top: 2,
    width: renderer.width - 4,
    height: 3,
    fg: RGBA.fromInts(176, 196, 222),
    zIndex: 1000,
  })
  renderer.root.add(instructionsText)

  demoContainer = new MouseInteractionFrameBuffer("mouse-demo-buffer", renderer)
  renderer.root.add(demoContainer)

  draggableBoxes = [
    new DraggableBox("drag-box-1", 10, 8, 20, 10, RGBA.fromInts(200, 100, 150), "Box 1"),
    new DraggableBox("drag-box-2", 30, 12, 18, 10, RGBA.fromInts(100, 200, 150), "Box 2"),
    new DraggableBox("drag-box-3", 50, 15, 20, 11, RGBA.fromInts(150, 150, 200), "Box 3"),
    new DraggableBox("drag-box-4", 15, 20, 18, 11, RGBA.fromInts(200, 200, 100), "Box 4"),
  ]

  for (const box of draggableBoxes) {
    renderer.root.add(box)
  }
}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()

  if (demoContainer) {
    demoContainer.clearState()
    renderer.root.remove("mouse-demo-buffer")
    demoContainer = null
  }

  if (titleText) {
    renderer.root.remove("mouse_demo_title")
    titleText = null
  }

  if (instructionsText) {
    renderer.root.remove("mouse_demo_instructions")
    instructionsText = null
  }

  for (const box of draggableBoxes) {
    renderer.root.remove(box.id)
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
