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
  type RenderContext,
  type VNode,
  Box,
  type ProxiedVNode,
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
let draggableBoxes: ProxiedVNode<typeof BoxRenderable>[] = []
let nextZIndex = 101

function DraggableBox(
  props: {
    id: string
    x: number
    y: number
    width: number
    height: number
    color: RGBA
    label: string
  },
  children: VNode[] = [],
) {
  const bgColor = RGBA.fromValues(props.color.r, props.color.g, props.color.b, 0.8)
  const borderColor = RGBA.fromValues(props.color.r * 1.2, props.color.g * 1.2, props.color.b * 1.2, 1.0)

  let isDragging = false
  let gotText = ""
  let scrollText = ""
  let scrollTimestamp = 0
  let dragOffsetX = 0
  let dragOffsetY = 0
  let bounceScale = { value: 1 }
  let baseWidth: number = props.width
  let baseHeight: number = props.height
  let centerX: number = props.x + baseWidth / 2
  let centerY: number = props.y + baseHeight / 2
  let originalBg: RGBA = bgColor
  let dragBg: RGBA = RGBA.fromValues(props.color.r, props.color.g, props.color.b, 0.3)
  let originalBorderColor: RGBA = borderColor
  let dragBorderColor: RGBA = RGBA.fromValues(props.color.r * 1.2, props.color.g * 1.2, props.color.b * 1.2, 0.5)

  return Box(
    {
      id: props.id,
      position: "absolute",
      left: props.x,
      top: props.y,
      width: props.width,
      height: props.height,
      backgroundColor: bgColor,
      borderColor: borderColor,
      borderStyle: "rounded",
      title: props.label,
      titleAlignment: "center",
      border: true,
      zIndex: 100,
      renderAfter(buffer, deltaTime) {
        this.width = Math.round(baseWidth * bounceScale.value)
        this.height = Math.round(baseHeight * bounceScale.value)

        this.x = Math.round(centerX - this.width / 2)
        this.y = Math.round(centerY - this.height / 2)

        const currentTime = Date.now()
        if (scrollText && currentTime - scrollTimestamp > 2000) {
          scrollText = ""
        }

        const baseCenterX = this.x + Math.floor(this.width / 2)
        const baseCenterY = this.y + Math.floor(this.height / 2)

        let textLines = 0
        if (isDragging) textLines++
        if (scrollText) textLines++
        if (gotText) textLines += 2

        let currentY = textLines > 1 ? baseCenterY - Math.floor(textLines / 2) : baseCenterY

        if (isDragging) {
          const centerX = baseCenterX - 2
          buffer.drawText("drag", centerX, currentY, RGBA.fromInts(64, 224, 208))
          currentY++
        }

        if (scrollText) {
          const age = currentTime - scrollTimestamp
          const fadeRatio = Math.max(0, 1 - age / 2000)
          const alpha = Math.round(255 * fadeRatio)

          const centerX = baseCenterX - Math.floor(scrollText.length / 2)
          buffer.drawText(scrollText, centerX, currentY, RGBA.fromInts(255, 255, 0, alpha))
          currentY++
        }

        if (gotText) {
          const gotX = baseCenterX - 2
          const gotTextX = baseCenterX - Math.floor(gotText.length / 2)
          buffer.drawText("got", gotX, currentY, RGBA.fromInts(255, 182, 193))
          currentY++
          buffer.drawText(gotText, gotTextX, currentY, RGBA.fromInts(147, 226, 255))
        }
      },
      onMouse(event: MouseEvent): void {
        switch (event.type) {
          case "down":
            gotText = ""
            isDragging = true
            dragOffsetX = event.x - this.x
            dragOffsetY = event.y - this.y
            this.zIndex = nextZIndex++
            this.backgroundColor = dragBg
            this.borderColor = dragBorderColor
            event.preventDefault()
            break

          case "drag-end":
            if (isDragging) {
              isDragging = false
              this.zIndex = 100
              this.backgroundColor = originalBg
              this.borderColor = originalBorderColor
              event.preventDefault()
            }
            break

          case "drag":
            if (isDragging) {
              const newX = event.x - dragOffsetX
              const newY = event.y - dragOffsetY

              const boundedX = Math.max(0, Math.min(newX, this._ctx.width - this.width))
              const boundedY = Math.max(4, Math.min(newY, this._ctx.height - this.height))

              centerX = boundedX + this.width / 2
              centerY = boundedY + this.height / 2

              event.preventDefault()
            }
            break

          case "over":
            gotText = "over " + (event.source?.id || "")
            break

          case "out":
            gotText = "out"
            break

          case "drop":
            gotText = event.source?.id || ""
            const timeline = createTimeline()

            timeline.add(bounceScale, {
              value: 1.5,
              duration: 200,
              ease: "outExpo",
            })

            timeline.add(
              bounceScale,
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
              scrollText = `scroll ${event.scroll.direction}`
              scrollTimestamp = Date.now()
              event.preventDefault()
            }
            break
        }
      },
    },
    children,
  )
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
    super(renderer, {
      id,
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

  titleText = new TextRenderable(renderer, {
    id: "mouse_demo_title",
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

  instructionsText = new TextRenderable(renderer, {
    id: "mouse_demo_instructions",
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
    DraggableBox({
      id: "drag-box-1",
      x: 10,
      y: 8,
      width: 20,
      height: 10,
      color: RGBA.fromInts(200, 100, 150),
      label: "Box 1",
    }),
    DraggableBox({
      id: "drag-box-2",
      x: 30,
      y: 12,
      width: 18,
      height: 10,
      color: RGBA.fromInts(100, 200, 150),
      label: "Box 2",
    }),
    DraggableBox({
      id: "drag-box-3",
      x: 50,
      y: 15,
      width: 20,
      height: 11,
      color: RGBA.fromInts(150, 150, 200),
      label: "Box 3",
    }),
    DraggableBox({
      id: "drag-box-4",
      x: 15,
      y: 20,
      width: 18,
      height: 11,
      color: RGBA.fromInts(200, 200, 100),
      label: "Box 4",
    }),
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
