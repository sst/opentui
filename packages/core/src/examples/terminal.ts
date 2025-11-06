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
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import type { TerminalColors } from "../lib/terminal-palette"

/**
 * This demo showcases terminal palette detection.
 * Press 'p' to fetch and display the terminal's color palette.
 */

let parentContainer: BoxRenderable | null = null
let paletteBuffer: FrameBufferRenderable | null = null
let statusText: TextRenderable | null = null
let hexListText: TextRenderable | null = null
let specialColorsText: TextRenderable | null = null
let terminalColors: TerminalColors | null = null
let keyboardHandler: ((key: any) => void) | null = null

export function run(renderer: CliRenderer): void {
  renderer.start()
  const backgroundColor = RGBA.fromInts(15, 23, 42) // Slate-900 inspired
  renderer.setBackgroundColor(backgroundColor)

  parentContainer = new BoxRenderable(renderer, {
    id: "terminal-palette-container",
    zIndex: 10,
  })
  renderer.root.add(parentContainer)

  const titleText = new TextRenderable(renderer, {
    id: "terminal_title",
    content: "Terminal Palette Demo",
    position: "absolute",
    left: 2,
    top: 1,
    fg: RGBA.fromInts(139, 92, 246), // Vibrant purple
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  parentContainer.add(titleText)

  const subtitleText = new TextRenderable(renderer, {
    id: "terminal_subtitle",
    content: "Press 'p' to fetch terminal colors | Press 'c' to clear cache",
    position: "absolute",
    left: 2,
    top: 2,
    fg: RGBA.fromInts(148, 163, 184), // Slate-400 - softer contrast
    zIndex: 1000,
  })
  parentContainer.add(subtitleText)

  statusText = new TextRenderable(renderer, {
    id: "terminal_status",
    content: "Status: Ready to fetch palette",
    position: "absolute",
    left: 2,
    top: 3,
    fg: RGBA.fromInts(56, 189, 248), // Sky blue - modern accent
    zIndex: 1000,
  })
  parentContainer.add(statusText)

  const instructionsText = new TextRenderable(renderer, {
    id: "terminal_instructions",
    content: "Press Escape to return to menu",
    position: "absolute",
    left: 2,
    top: 4,
    fg: RGBA.fromInts(100, 116, 139), // Slate-500 - muted but readable
    zIndex: 1000,
  })
  parentContainer.add(instructionsText)

  // Create framebuffer for palette display (just the color grid)
  paletteBuffer = new FrameBufferRenderable(renderer, {
    id: "palette-buffer",
    width: 64,
    height: 32,
    position: "absolute",
    left: 2,
    top: 6,
    zIndex: 100,
  })
  renderer.root.add(paletteBuffer)
  paletteBuffer.frameBuffer.clear(RGBA.fromInts(30, 41, 59, 255)) // Slate-800 background

  // Set up keyboard handler
  keyboardHandler = async (key) => {
    if (key.name === "p") {
      await fetchAndDisplayPalette(renderer)
    } else if (key.name === "c") {
      clearPaletteCache(renderer)
    }
  }

  renderer.keyInput.on("keypress", keyboardHandler)
}

async function fetchAndDisplayPalette(renderer: CliRenderer): Promise<void> {
  if (!statusText || !paletteBuffer) return

  try {
    const status = renderer.paletteDetectionStatus
    statusText.content = `Status: ${status === "cached" ? "Using cached palette" : "Fetching palette..."}`
    statusText.fg = RGBA.fromInts(250, 204, 21) // Amber - warm loading state

    const startTime = Date.now()
    terminalColors = await renderer.getPalette()
    const elapsed = Date.now() - startTime

    statusText.content = `Status: Palette fetched in ${elapsed}ms (${status === "cached" ? "from cache" : "from terminal"})`
    statusText.fg = RGBA.fromInts(34, 197, 94) // Emerald - fresh success state

    drawPalette(renderer, paletteBuffer, terminalColors)
  } catch (error) {
    if (statusText) {
      statusText.content = `Status: Error - ${error instanceof Error ? error.message : String(error)}`
      statusText.fg = RGBA.fromInts(239, 68, 68) // Red-500 - modern error state
    }
  }
}

function clearPaletteCache(renderer: CliRenderer): void {
  if (!statusText) return

  renderer.clearPaletteCache()
  statusText.content = "Status: Cache cleared. Press 'p' to fetch palette again."
  statusText.fg = RGBA.fromInts(148, 163, 184) // Slate-400 - neutral info state
}

function drawPalette(renderer: CliRenderer, paletteBufferRenderable: FrameBufferRenderable, terminalColors: TerminalColors): void {
  const buffer = paletteBufferRenderable.frameBuffer

  // Clear the buffer
  buffer.clear(RGBA.fromInts(30, 41, 59, 255)) // Slate-800 background

  const colors = terminalColors.palette

  // Draw a 16x16 grid of colors (256 colors total)
  // Each color is represented as a 4x2 block of cells
  const blockWidth = 4
  const blockHeight = 2

  for (let i = 0; i < 256; i++) {
    const color = colors[i]
    if (!color) continue

    const row = Math.floor(i / 16)
    const col = i % 16

    const x = col * blockWidth
    const y = row * blockHeight

    // Parse hex color
    const hex = color.replace("#", "")
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    const rgba = RGBA.fromInts(r, g, b)

    // Draw the color block using spaces with background color
    for (let dy = 0; dy < blockHeight; dy++) {
      for (let dx = 0; dx < blockWidth; dx++) {
        buffer.setCell(x + dx, y + dy, " ", RGBA.fromInts(255, 255, 255), rgba)
      }
    }

    // Add color index number in the center of the block (if block is large enough)
    if (blockWidth >= 3 && blockHeight >= 1) {
      const indexStr = i.toString()
      const textX = x + Math.floor((blockWidth - indexStr.length) / 2)
      const textY = y + Math.floor(blockHeight / 2)

      // Choose text color based on background brightness
      const brightness = (r * 299 + g * 587 + b * 114) / 1000
      const textColor = brightness > 128 ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)

      if (indexStr.length <= blockWidth) {
        for (let ci = 0; ci < indexStr.length; ci++) {
          buffer.drawText(indexStr[ci], textX + ci, textY, textColor, rgba, TextAttributes.NONE)
        }
      }
    }
  }

  // Create hex list below the grid
  const hexLines: string[] = []
  const hexListColumns = 4
  for (let i = 0; i < 256; i += hexListColumns) {
    const line: string[] = []
    for (let j = 0; j < hexListColumns && i + j < 256; j++) {
      const color = colors[i + j]
      if (color) {
        line.push(`${(i + j).toString().padStart(3, " ")}: ${color.toUpperCase()}`)
      }
    }
    hexLines.push(line.join("  "))
  }

  if (!hexListText) {
    hexListText = new TextRenderable(renderer, {
      id: "hex-list",
      content: hexLines.join("\n"),
      position: "absolute",
      left: 2,
      top: 39, // Below the grid (top: 6 + height: 32 = 38, +1 for spacing)
      fg: RGBA.fromInts(148, 163, 184),
      zIndex: 100,
    })
    renderer.root.add(hexListText)
  } else {
    hexListText.content = hexLines.join("\n")
  }

  // Create special colors list to the right of the grid
  const specialColors = [
    { label: "Default FG", value: terminalColors.defaultForeground },
    { label: "Default BG", value: terminalColors.defaultBackground },
    { label: "Cursor", value: terminalColors.cursorColor },
    { label: "Mouse FG", value: terminalColors.mouseForeground },
    { label: "Mouse BG", value: terminalColors.mouseBackground },
    { label: "Tek FG", value: terminalColors.tekForeground },
    { label: "Tek BG", value: terminalColors.tekBackground },
    { label: "Highlight BG", value: terminalColors.highlightBackground },
    { label: "Highlight FG", value: terminalColors.highlightForeground },
  ]

  const specialLines = specialColors.map(({ label, value }) => {
    if (value) {
      return `${label.padEnd(12)}: ${value.toUpperCase()}`
    }
    return `${label.padEnd(12)}: N/A`
  })

  if (!specialColorsText) {
    specialColorsText = new TextRenderable(renderer, {
      id: "special-colors",
      content: specialLines.join("\n"),
      position: "absolute",
      left: 68, // Right of the 64-width grid + 4 spacing
      top: 6,
      fg: RGBA.fromInts(148, 163, 184),
      zIndex: 100,
    })
    renderer.root.add(specialColorsText)
  } else {
    specialColorsText.content = specialLines.join("\n")
  }
}

export function destroy(renderer: CliRenderer): void {
  if (keyboardHandler) {
    renderer.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  if (parentContainer) {
    renderer.root.remove("terminal-palette-container")
    parentContainer = null
  }

  if (paletteBuffer) {
    renderer.root.remove("palette-buffer")
    paletteBuffer = null
  }

  if (hexListText) {
    renderer.root.remove("hex-list")
    hexListText = null
  }

  if (specialColorsText) {
    renderer.root.remove("special-colors")
    specialColorsText = null
  }

  statusText = null
  terminalColors = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
