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
import type { TerminalColors } from "../lib/terminal-palette"

/**
 * This demo showcases terminal palette detection.
 * Press 'p' to fetch and display the terminal's color palette.
 */

let scrollBox: ScrollBoxRenderable | null = null
let contentContainer: BoxRenderable | null = null
let paletteBuffer: FrameBufferRenderable | null = null
let statusText: TextRenderable | null = null
let hexListBuffer: FrameBufferRenderable | null = null
let specialColorsBuffer: FrameBufferRenderable | null = null
let terminalColors: TerminalColors | null = null
let keyboardHandler: ((key: any) => void) | null = null

export function run(renderer: CliRenderer): void {
  renderer.start()
  const backgroundColor = RGBA.fromInts(15, 23, 42) // Slate-900 inspired
  renderer.setBackgroundColor(backgroundColor)

  const mainContainer = new BoxRenderable(renderer, {
    id: "main-container",
    flexGrow: 1,
    flexDirection: "column",
  })
  renderer.root.add(mainContainer)

  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "terminal-scroll-box",
    stickyScroll: false,
    border: true,
    borderColor: "#8B5CF6",
    title: "Terminal Palette Demo (Ctrl+C to exit)",
    titleAlignment: "center",
    contentOptions: {
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
    },
  })
  mainContainer.add(scrollBox)

  contentContainer = new BoxRenderable(renderer, {
    id: "terminal-palette-container",
    width: "auto",
    flexDirection: "column",
  })
  scrollBox.add(contentContainer)

  const subtitleText = new TextRenderable(renderer, {
    id: "terminal_subtitle",
    content: "Press 'p' to fetch terminal colors | Press 'c' to clear cache",
    fg: RGBA.fromInts(148, 163, 184), // Slate-400 - softer contrast
  })
  contentContainer.add(subtitleText)

  statusText = new TextRenderable(renderer, {
    id: "terminal_status",
    content: "Status: Ready to fetch palette",
    marginTop: 1,
    fg: RGBA.fromInts(56, 189, 248), // Sky blue - modern accent
  })
  contentContainer.add(statusText)

  const instructionsText = new TextRenderable(renderer, {
    id: "terminal_instructions",
    content: "Press Escape to return to menu",
    marginTop: 1,
    fg: RGBA.fromInts(100, 116, 139), // Slate-500 - muted but readable
  })
  contentContainer.add(instructionsText)

  // Create framebuffer for palette display (just the color grid)
  paletteBuffer = new FrameBufferRenderable(renderer, {
    id: "palette-buffer",
    width: 64,
    height: 32,
    marginTop: 2,
  })
  contentContainer.add(paletteBuffer)
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

  // Create special colors list with colored boxes
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

  // Create a framebuffer for special colors with colored boxes
  const specialBufferWidth = 30
  const specialBufferHeight = specialColors.length * 2
  
  if (!specialColorsBuffer) {
    specialColorsBuffer = new FrameBufferRenderable(renderer, {
      id: "special-colors-buffer",
      width: specialBufferWidth,
      height: specialBufferHeight,
      marginTop: 2,
    })
    contentContainer!.add(specialColorsBuffer)
  }

  const specialBuffer = specialColorsBuffer.frameBuffer
  specialBuffer.clear(RGBA.fromInts(30, 41, 59, 255)) // Slate-800 background

  specialColors.forEach(({ label, value }, index) => {
    const y = index * 2
    const boxWidth = 4
    
    if (value) {
      // Parse hex color
      const hex = value.replace("#", "")
      const r = parseInt(hex.substring(0, 2), 16)
      const g = parseInt(hex.substring(2, 4), 16)
      const b = parseInt(hex.substring(4, 6), 16)
      const rgba = RGBA.fromInts(r, g, b)

      // Draw colored box (4x2 block)
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < boxWidth; dx++) {
          specialBuffer.setCell(dx, y + dy, " ", RGBA.fromInts(255, 255, 255), rgba)
        }
      }

      // Draw label and hex value
      const text = `${label}: ${value.toUpperCase()}`
      const textColor = RGBA.fromInts(148, 163, 184)
      const bgColor = RGBA.fromInts(30, 41, 59, 255)
      for (let i = 0; i < text.length; i++) {
        specialBuffer.drawText(text[i], boxWidth + 1 + i, y, textColor, bgColor, TextAttributes.NONE)
      }
    } else {
      // Draw N/A
      const text = `${label}: N/A`
      const textColor = RGBA.fromInts(100, 116, 139)
      const bgColor = RGBA.fromInts(30, 41, 59, 255)
      for (let i = 0; i < text.length; i++) {
        specialBuffer.drawText(text[i], boxWidth + 1 + i, y, textColor, bgColor, TextAttributes.NONE)
      }
    }
  })

  // Create hex list below the special colors with colored boxes
  const hexListColumns = 4
  const hexBlockWidth = 4
  const hexBlockHeight = 2
  const hexSpacing = 2 // Horizontal spacing between items
  const hexItemWidth = 18 // Space for color box + spacing + index + hex
  const hexBufferWidth = hexListColumns * hexItemWidth
  const hexBufferHeight = Math.ceil(256 / hexListColumns) * (hexBlockHeight + 1) // Add spacing between rows

  if (!hexListBuffer) {
    hexListBuffer = new FrameBufferRenderable(renderer, {
      id: "hex-list-buffer",
      width: hexBufferWidth,
      height: hexBufferHeight,
      marginTop: 2,
    })
    contentContainer!.add(hexListBuffer)
  }

  const hexBuffer = hexListBuffer.frameBuffer
  hexBuffer.clear(RGBA.fromInts(30, 41, 59, 255)) // Slate-800 background

  for (let i = 0; i < 256; i++) {
    const color = colors[i]
    if (!color) continue

    const row = Math.floor(i / hexListColumns)
    const col = i % hexListColumns

    const x = col * hexItemWidth
    const y = row * (hexBlockHeight + 1) // Add spacing between rows

    // Parse hex color
    const hex = color.replace("#", "")
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    const rgba = RGBA.fromInts(r, g, b)

    // Draw colored box (4x2 block)
    for (let dy = 0; dy < hexBlockHeight; dy++) {
      for (let dx = 0; dx < hexBlockWidth; dx++) {
        hexBuffer.setCell(x + dx, y + dy, " ", RGBA.fromInts(255, 255, 255), rgba)
      }
    }

    // Draw index and hex value next to the box
    const text = `${i.toString().padStart(3, " ")}: ${color.toUpperCase()}`
    const textColor = RGBA.fromInts(148, 163, 184)
    const bgColor = RGBA.fromInts(30, 41, 59, 255)
    const textStartX = x + hexBlockWidth + 1
    for (let ci = 0; ci < text.length && textStartX + ci < x + hexItemWidth - hexSpacing; ci++) {
      hexBuffer.drawText(text[ci], textStartX + ci, y, textColor, bgColor, TextAttributes.NONE)
    }
  }
}

export function destroy(renderer: CliRenderer): void {
  if (keyboardHandler) {
    renderer.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  if (scrollBox) {
    renderer.root.remove("main-container")
    scrollBox = null
  }

  contentContainer = null
  paletteBuffer = null
  hexListBuffer = null
  specialColorsBuffer = null
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
