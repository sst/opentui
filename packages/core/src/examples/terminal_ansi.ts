#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  RGBA,
  TextAttributes,
  TextRenderable,
  FrameBufferRenderable,
  BoxRenderable,
} from "../index"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

/**
 * This demo showcases 256 indexed ANSI colors using RGBA.fromIndex().
 * It renders the full 0-255 palette as colored blocks in a grid.
 */

let scrollBox: ScrollBoxRenderable | null = null

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor(RGBA.fromIndex(0)) // Use indexed black

  const mainContainer = new BoxRenderable(renderer, {
    id: "main-container",
    flexGrow: 1,
    flexDirection: "column",
  })
  renderer.root.add(mainContainer)

  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "ansi-scroll-box",
    stickyScroll: false,
    border: true,
    borderColor: RGBA.fromIndex(1),
    title: "256 ANSI Indexed Colors (Ctrl+C to exit)",
    titleAlignment: "center",
    contentOptions: {
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
    },
  })
  mainContainer.add(scrollBox)

  const contentContainer = new BoxRenderable(renderer, {
    id: "ansi-content",
    width: "auto",
    flexDirection: "column",
  })
  scrollBox.add(contentContainer)

  // --- Standard colors (0-7) ---
  const standardLabel = new TextRenderable(renderer, {
    id: "standard-label",
    content: "Standard Colors (0-7)",
    fg: RGBA.fromIndex(15),
  })
  contentContainer.add(standardLabel)

  const standardBuffer = new FrameBufferRenderable(renderer, {
    id: "standard-buffer",
    width: 40,
    height: 2,
    marginTop: 1,
  })
  contentContainer.add(standardBuffer)
  drawColorRow(standardBuffer.frameBuffer, 0, 8, 40)

  // --- Bright colors (8-15) ---
  const brightLabel = new TextRenderable(renderer, {
    id: "bright-label",
    content: "Bright Colors (8-15)",
    fg: RGBA.fromIndex(15),
    marginTop: 1,
  })
  contentContainer.add(brightLabel)

  const brightBuffer = new FrameBufferRenderable(renderer, {
    id: "bright-buffer",
    width: 40,
    height: 2,
    marginTop: 1,
  })
  contentContainer.add(brightBuffer)
  drawColorRow(brightBuffer.frameBuffer, 8, 16, 40)

  // --- 6x6x6 Color Cube (16-231) ---
  const cubeLabel = new TextRenderable(renderer, {
    id: "cube-label",
    content: "6x6x6 Color Cube (16-231)",
    fg: RGBA.fromIndex(15),
    marginTop: 1,
  })
  contentContainer.add(cubeLabel)

  const cubeBuffer = new FrameBufferRenderable(renderer, {
    id: "cube-buffer",
    width: 72,
    height: 12,
    marginTop: 1,
  })
  contentContainer.add(cubeBuffer)
  drawColorCube(cubeBuffer.frameBuffer)

  // --- Grayscale Ramp (232-255) ---
  const grayLabel = new TextRenderable(renderer, {
    id: "gray-label",
    content: "Grayscale Ramp (232-255)",
    fg: RGBA.fromIndex(15),
    marginTop: 1,
  })
  contentContainer.add(grayLabel)

  const grayBuffer = new FrameBufferRenderable(renderer, {
    id: "gray-buffer",
    width: 72,
    height: 2,
    marginTop: 1,
  })
  contentContainer.add(grayBuffer)
  drawColorRow(grayBuffer.frameBuffer, 232, 256, 72)

  // --- Info text ---
  const infoText = new TextRenderable(renderer, {
    id: "info-text",
    content: "All colors rendered using RGBA.fromIndex(n) — indexed color meta is packed into RGBA[4]",
    fg: RGBA.fromIndex(244),
    marginTop: 2,
  })
  contentContainer.add(infoText)
}

function drawColorRow(
  buffer: FrameBufferRenderable["frameBuffer"],
  startIndex: number,
  endIndex: number,
  width: number,
): void {
  const count = endIndex - startIndex
  const cellWidth = Math.floor(width / count)

  for (let i = 0; i < count; i++) {
    const colorIndex = startIndex + i
    const bg = RGBA.fromIndex(colorIndex)
    const fg = colorIndex < 8 || (colorIndex >= 232 && colorIndex < 244)
      ? RGBA.fromIndex(15)
      : RGBA.fromIndex(0)
    const label = colorIndex.toString().padStart(3, " ")

    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < cellWidth; dx++) {
        const x = i * cellWidth + dx
        if (dy === 0 && dx < label.length) {
          buffer.drawText(label[dx], x, dy, fg, bg, TextAttributes.NONE)
        } else {
          buffer.setCell(x, dy, " ", fg, bg)
        }
      }
    }
  }
}

function drawColorCube(buffer: FrameBufferRenderable["frameBuffer"]): void {
  // 6x6x6 cube: 6 rows of 36 colors, each cell 2 chars wide
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 36; col++) {
      const colorIndex = 16 + row * 36 + col
      const bg = RGBA.fromIndex(colorIndex)
      const x = col * 2
      const y = row * 2

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          buffer.setCell(x + dx, y + dy, " ", RGBA.fromIndex(0), bg)
        }
      }
    }
  }
}

export function destroy(renderer: CliRenderer): void {
  if (scrollBox) {
    renderer.root.remove("main-container")
    scrollBox = null
  }
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
