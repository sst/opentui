#!/usr/bin/env bun

import { CliRenderer, createCliRenderer, RGBA, TextAttributes, GroupRenderable, TextRenderable } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

/**
 * This demo showcases framebuffers with multiple
 * overlapping framebuffers and transparency.
 */

let boxX = 10
let boxY = 10
let boxDx = 5
let boxDy = 3
let ballX = 20
let ballY = 20
let ballDx = 15
let ballDy = 10
let currentWidth = 10
let currentHeight = 5
let growingWidth = true
let growingHeight = true
let lastResizeTime = 0
const resizeInterval = 0.1
let parentContainer: GroupRenderable | null = null

export function run(renderer: CliRenderer): void {
  renderer.start()
  const backgroundColor = RGBA.fromInts(10, 10, 30)
  renderer.setBackgroundColor(backgroundColor)

  parentContainer = new GroupRenderable("framebuffer-container", {
    x: 0,
    y: 0,
    zIndex: 10,
    visible: true,
  })
  renderer.add(parentContainer)

  const titleText = new TextRenderable("framebuffer_title", {
    content: "FrameBuffer Demo",
    x: 2,
    y: 1,
    fg: RGBA.fromInts(255, 255, 100),
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  parentContainer.add(titleText)

  const subtitleText = new TextRenderable("framebuffer_subtitle", {
    content: "Showcasing framebuffers with transparency and partial drawing",
    x: 2,
    y: 2,
    fg: RGBA.fromInts(200, 200, 200),
    zIndex: 1000,
  })
  parentContainer.add(subtitleText)

  const instructionsText = new TextRenderable("framebuffer_instructions", {
    content: "Press Escape to return to menu",
    x: 2,
    y: 3,
    fg: RGBA.fromInts(150, 150, 150),
    zIndex: 1000,
  })
  parentContainer.add(instructionsText)

  const { frameBuffer: patternBuffer } = renderer.createFrameBuffer("pattern", {
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
    x: 0,
    y: 0,
    zIndex: 0,
    respectAlpha: true,
  })

  for (let y = 0; y < patternBuffer.getHeight(); y++) {
    for (let x = 0; x < patternBuffer.getWidth(); x++) {
      if ((x + y) % 5 === 0) {
        patternBuffer.drawText("·", x, y, RGBA.fromInts(50, 50, 80))
      }
    }
  }

  const boxObj = renderer.createFrameBuffer("moving-box", {
    width: 20,
    height: 10,
    x: 10,
    y: 10,
    zIndex: 1,
  })
  const boxBuffer = boxObj.frameBuffer

  const boxColor = RGBA.fromInts(80, 30, 100, 128)
  boxBuffer.fillRect(0, 0, 20, 10, boxColor)

  for (let x = 0; x < 20; x++) {
    boxBuffer.drawText("-", x, 0, RGBA.fromInts(150, 100, 200))
    boxBuffer.drawText("-", x, 9, RGBA.fromInts(150, 100, 200))
  }
  for (let y = 0; y < 10; y++) {
    boxBuffer.drawText("|", 0, y, RGBA.fromInts(150, 100, 200))
    boxBuffer.drawText("|", 19, y, RGBA.fromInts(150, 100, 200))
  }

  boxBuffer.drawText("+", 0, 0, RGBA.fromInts(200, 150, 255))
  boxBuffer.drawText("+", 19, 0, RGBA.fromInts(200, 150, 255))
  boxBuffer.drawText("+", 0, 9, RGBA.fromInts(200, 150, 255))
  boxBuffer.drawText("+", 19, 9, RGBA.fromInts(200, 150, 255))

  boxBuffer.drawText("Moving Box", 5, 2, RGBA.fromInts(255, 255, 255), RGBA.fromInts(100, 40, 120), TextAttributes.BOLD)

  const { frameBuffer: overlayBuffer } = renderer.createFrameBuffer("overlay", {
    width: 40,
    height: 15,
    x: 30,
    y: 15,
    zIndex: 2,
    respectAlpha: true,
  })

  for (let y = 0; y < overlayBuffer.getHeight(); y++) {
    for (let x = 0; x < overlayBuffer.getWidth(); x++) {
      if ((x + y) % 3 !== 0) {
        overlayBuffer.setCell(x, y, " ", RGBA.fromInts(255, 255, 255), RGBA.fromInts(0, 100, 150, 128))
      }
    }
  }

  overlayBuffer.drawText(
    "Transparent Overlay",
    10,
    2,
    RGBA.fromInts(255, 255, 255),
    RGBA.fromInts(0, 120, 180, 200),
    TextAttributes.BOLD,
  )
  overlayBuffer.drawText(
    "This overlay has transparent",
    5,
    5,
    RGBA.fromInts(255, 255, 255),
    RGBA.fromInts(0, 120, 180, 200),
  )
  overlayBuffer.drawText(
    "cells that let content below",
    5,
    6,
    RGBA.fromInts(255, 255, 255),
    RGBA.fromInts(0, 120, 180, 200),
  )
  overlayBuffer.drawText("show through!", 5, 7, RGBA.fromInts(255, 255, 255), RGBA.fromInts(0, 120, 180, 200))

  const ballObj = renderer.createFrameBuffer("ball", {
    width: 3,
    height: 3,
    x: 20,
    y: 20,
    zIndex: 3,
  })
  const ballBuffer = ballObj.frameBuffer

  ballBuffer.drawText(" ", 0, 0, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))
  ballBuffer.drawText(" ", 1, 0, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))
  ballBuffer.drawText(" ", 2, 0, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))
  ballBuffer.drawText(" ", 0, 1, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))
  ballBuffer.drawText("O", 1, 1, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))
  ballBuffer.drawText(" ", 2, 1, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))
  ballBuffer.drawText(" ", 0, 2, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))
  ballBuffer.drawText(" ", 1, 2, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))
  ballBuffer.drawText(" ", 2, 2, RGBA.fromInts(255, 255, 255), RGBA.fromInts(200, 50, 50))

  const resizableObj = renderer.createFrameBuffer("resizable-box", {
    width: 10,
    height: 5,
    x: 50,
    y: 8,
    zIndex: 3,
  })
  const resizableBuffer = resizableObj.frameBuffer

  function drawResizableContent() {
    resizableBuffer.clear(RGBA.fromInts(0, 0, 0, 0))

    for (let x = 0; x < resizableBuffer.getWidth(); x++) {
      resizableBuffer.drawText("=", x, 0, RGBA.fromInts(255, 200, 100))
      resizableBuffer.drawText("=", x, resizableBuffer.getHeight() - 1, RGBA.fromInts(255, 200, 100))
    }

    for (let y = 0; y < resizableBuffer.getHeight(); y++) {
      resizableBuffer.drawText("|", 0, y, RGBA.fromInts(255, 200, 100))
      resizableBuffer.drawText("|", resizableBuffer.getWidth() - 1, y, RGBA.fromInts(255, 200, 100))
    }

    resizableBuffer.drawText("+", 0, 0, RGBA.fromInts(255, 230, 150))
    resizableBuffer.drawText("+", resizableBuffer.getWidth() - 1, 0, RGBA.fromInts(255, 230, 150))
    resizableBuffer.drawText("+", 0, resizableBuffer.getHeight() - 1, RGBA.fromInts(255, 230, 150))
    resizableBuffer.drawText(
      "+",
      resizableBuffer.getWidth() - 1,
      resizableBuffer.getHeight() - 1,
      RGBA.fromInts(255, 230, 150),
    )

    if (resizableBuffer.getWidth() >= 18 && resizableBuffer.getHeight() >= 3) {
      resizableBuffer.drawText(
        "Resizable Box",
        Math.floor((resizableBuffer.getWidth() - 13) / 2),
        2,
        RGBA.fromInts(255, 255, 100),
        undefined,
        TextAttributes.BOLD,
      )
    }
  }

  drawResizableContent()

  // Create a large source framebuffer for partial drawing demonstration
  const sourceObj = renderer.createFrameBuffer("large-source", {
    width: 40,
    height: 20,
    x: 0,
    y: 0,
    zIndex: -1,
  })
  sourceObj.visible = false
  const sourceBuffer = sourceObj.frameBuffer

  // Fill source buffer with a pattern we can crop from
  for (let y = 0; y < sourceBuffer.getHeight(); y++) {
    for (let x = 0; x < sourceBuffer.getWidth(); x++) {
      const char = String.fromCharCode(65 + ((x + y) % 26)) // A-Z pattern
      const hue = (x * 10 + y * 5) % 360
      const r = Math.floor(128 + 127 * Math.sin((hue * Math.PI) / 180))
      const g = Math.floor(128 + 127 * Math.sin(((hue + 120) * Math.PI) / 180))
      const b = Math.floor(128 + 127 * Math.sin(((hue + 240) * Math.PI) / 180))
      sourceBuffer.drawText(char, x, y, RGBA.fromInts(r, g, b))
    }
  }

  // Create smaller framebuffers to demonstrate partial drawing
  const { frameBuffer: cropBuffer1 } = renderer.createFrameBuffer("crop-demo-1", {
    width: 12,
    height: 8,
    x: 5,
    y: 35,
    zIndex: 4,
  })

  const { frameBuffer: cropBuffer2 } = renderer.createFrameBuffer("crop-demo-2", {
    width: 15,
    height: 6,
    x: 25,
    y: 35,
    zIndex: 4,
  })

  const { frameBuffer: cropBuffer3 } = renderer.createFrameBuffer("crop-demo-3", {
    width: 10,
    height: 10,
    x: 45,
    y: 35,
    zIndex: 4,
  })

  // Label for the crop demo
  const cropDemoLabel = new TextRenderable("crop_demo_label", {
    content: "Partial FrameBuffer Drawing Demo:",
    x: 5,
    y: 34,
    fg: RGBA.fromInts(255, 255, 200),
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  parentContainer.add(cropDemoLabel)

  boxX = 10
  boxY = 10
  boxDx = 5
  boxDy = 3
  ballX = 20
  ballY = 20
  ballDx = 15
  ballDy = 10
  currentWidth = 10
  currentHeight = 5
  growingWidth = true
  growingHeight = true
  lastResizeTime = 0

  renderer.setFrameCallback(async (deltaTime) => {
    const clampedDelta = Math.min(deltaTime, 100) / 1000

    boxX += boxDx * clampedDelta
    boxY += boxDy * clampedDelta

    if (boxX < 0) {
      boxX = 0
      boxDx = Math.abs(boxDx)
    } else if (boxX + boxBuffer.getWidth() > renderer.terminalWidth) {
      boxX = renderer.terminalWidth - boxBuffer.getWidth()
      boxDx = -Math.abs(boxDx)
    }

    if (boxY < 5) {
      boxY = 5
      boxDy = Math.abs(boxDy)
    } else if (boxY + boxBuffer.getHeight() > renderer.terminalHeight) {
      boxY = renderer.terminalHeight - boxBuffer.getHeight()
      boxDy = -Math.abs(boxDy)
    }

    boxObj.x = Math.round(boxX)
    boxObj.y = Math.round(boxY)

    ballX += ballDx * clampedDelta
    ballY += ballDy * clampedDelta

    if (ballX < 0) {
      ballX = 0
      ballDx = Math.abs(ballDx)
    } else if (ballX + ballBuffer.getWidth() > renderer.terminalWidth) {
      ballX = renderer.terminalWidth - ballBuffer.getWidth()
      ballDx = -Math.abs(ballDx)
    }

    if (ballY < 5) {
      ballY = 5
      ballDy = Math.abs(ballDy)
    } else if (ballY + ballBuffer.getHeight() > renderer.terminalHeight) {
      ballY = renderer.terminalHeight - ballBuffer.getHeight()
      ballDy = -Math.abs(ballDy)
    }

    ballObj.x = Math.round(ballX)
    ballObj.y = Math.round(ballY)

    const time = Date.now() / 1000

    // Update partial drawing demonstration
    const scrollOffset = Math.floor(time * 3) % 20 // Scroll through source buffer

    // Clear crop demo buffers
    cropBuffer1.clear(RGBA.fromInts(0, 0, 0, 1))
    cropBuffer2.clear(RGBA.fromInts(0, 0, 0, 1))
    cropBuffer3.clear(RGBA.fromInts(0, 0, 0, 1))

    // Demo 1: Top-left crop that scrolls horizontally
    cropBuffer1.drawFrameBuffer(0, 0, sourceBuffer, scrollOffset, 0, 12, 8)
    cropBuffer1.drawText(
      "TopLeft",
      1,
      7,
      RGBA.fromInts(255, 255, 255),
      RGBA.fromInts(0, 0, 0, 180),
      TextAttributes.BOLD,
    )

    // Demo 2: Center crop - super simple slow movement
    const centerX = 10 + Math.floor((Math.sin(time * 0.3) + 1) * 5) // 10 to 20, very slow
    const centerY = 5 + Math.floor((Math.cos(time * 0.2) + 1) * 3) // 5 to 11, very slow
    cropBuffer2.drawFrameBuffer(0, 0, sourceBuffer, centerX, centerY, 15, 6)
    cropBuffer2.drawText("Center", 1, 5, RGBA.fromInts(255, 255, 255), RGBA.fromInts(0, 0, 0, 180), TextAttributes.BOLD)

    // Demo 3: Bottom-right crop - simple back and forth
    const brX = 20 + Math.floor((Math.sin(time * 0.4) + 1) * 5) // 20 to 30, very slow
    const brY = 5 + Math.floor((Math.cos(time * 0.4) + 1) * 3) // 5 to 11, same speed for circle
    cropBuffer3.drawFrameBuffer(0, 0, sourceBuffer, brX, brY, 10, 10)
    cropBuffer3.drawText(
      "BotRight",
      1,
      9,
      RGBA.fromInts(255, 255, 255),
      RGBA.fromInts(0, 0, 0, 180),
      TextAttributes.BOLD,
    )

    if (time - lastResizeTime > resizeInterval) {
      lastResizeTime = time

      if (growingWidth) {
        currentWidth++
        if (currentWidth >= 30) growingWidth = false
      } else {
        currentWidth--
        if (currentWidth <= 10) growingWidth = true
      }

      if (growingHeight) {
        currentHeight++
        if (currentHeight >= 15) growingHeight = false
      } else {
        currentHeight--
        if (currentHeight <= 5) growingHeight = true
      }

      resizableBuffer.resize(currentWidth, currentHeight)

      drawResizableContent()

      const centerX = 50
      const centerY = 8

      resizableObj.x = Math.round(centerX - currentWidth / 2)
      resizableObj.y = Math.round(centerY - currentHeight / 2)
    }

    const hue = (time * 20) % 360
    const r = Math.floor(128 + 127 * Math.sin((hue * Math.PI) / 180))
    const g = Math.floor(128 + 127 * Math.sin(((hue + 120) * Math.PI) / 180))
    const b = Math.floor(128 + 127 * Math.sin(((hue + 240) * Math.PI) / 180))

    if (Math.floor(time * 10) % 1 === 0) {
      overlayBuffer.clear(RGBA.fromInts(0, 0, 0, 0))

      for (let y = 0; y < overlayBuffer.getHeight(); y++) {
        for (let x = 0; x < overlayBuffer.getWidth(); x++) {
          if ((x + y) % 3 !== 0) {
            overlayBuffer.setCell(x, y, " ", RGBA.fromInts(255, 255, 255), RGBA.fromInts(r, g, b, 128))
          }
        }
      }

      overlayBuffer.drawText(
        "Transparent Overlay",
        10,
        2,
        RGBA.fromInts(255, 255, 255),
        RGBA.fromInts(255, 255, 255, 200),
        TextAttributes.BOLD,
      )
      overlayBuffer.drawText(
        "This overlay has transparent",
        5,
        5,
        RGBA.fromInts(255, 255, 255),
        RGBA.fromInts(255, 255, 255, 200),
      )
      overlayBuffer.drawText(
        "cells that let content below",
        5,
        6,
        RGBA.fromInts(255, 255, 255),
        RGBA.fromInts(255, 255, 255, 200),
      )
      overlayBuffer.drawText("show through!", 5, 7, RGBA.fromInts(255, 255, 255), RGBA.fromInts(255, 255, 255, 200))
    }
  })

  const debugInstructionsText = new TextRenderable("framebuffer_debug_instructions", {
    content: "Press 1-4 to change corner | Escape: Back to menu",
    x: 2,
    y: 2,
    fg: RGBA.fromInts(200, 200, 200),
    zIndex: 1000,
  })
  parentContainer.add(debugInstructionsText)
}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()

  if (parentContainer) {
    renderer.remove("framebuffer-container")
    parentContainer = null
  }

  renderer.remove("pattern")
  renderer.remove("moving-box")
  renderer.remove("overlay")
  renderer.remove("ball")
  renderer.remove("resizable-box")
  renderer.remove("large-source")
  renderer.remove("crop-demo-1")
  renderer.remove("crop-demo-2")
  renderer.remove("crop-demo-3")

  boxX = 10
  boxY = 10
  boxDx = 5
  boxDy = 3
  ballX = 20
  ballY = 20
  ballDx = 15
  ballDy = 10
  currentWidth = 10
  currentHeight = 5
  growingWidth = true
  growingHeight = true
  lastResizeTime = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
