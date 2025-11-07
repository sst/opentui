#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  RGBA,
  TextAttributes,
  TextRenderable,
  FrameBufferRenderable,
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
} from "../index"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import type { TerminalColors } from "../lib/terminal-palette"
import { PaletteGridRenderable } from "./lib/PaletteGrid"
import { HexListRenderable } from "./lib/HexList"

/**
 * This demo showcases terminal palette detection.
 * Enter a palette size (1-256) in the input field and press Enter to fetch colors.
 */

let scrollBox: ScrollBoxRenderable | null = null
let contentContainer: BoxRenderable | null = null
let paletteGrid: PaletteGridRenderable | null = null
let statusText: TextRenderable | null = null
let hexList: HexListRenderable | null = null
let specialColorsBuffer: FrameBufferRenderable | null = null
let terminalColors: TerminalColors | null = null
let keyboardHandler: ((key: any) => void) | null = null
let paletteSizeInput: InputRenderable | null = null

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
    content: "Enter palette size (1-256) and press Enter to fetch | Press 'c' to clear cache",
    fg: RGBA.fromInts(148, 163, 184), // Slate-400 - softer contrast
  })
  contentContainer.add(subtitleText)

  // Add input field for palette size
  const inputContainer = new BoxRenderable(renderer, {
    id: "input-container",
    flexDirection: "row",
    marginTop: 1,
  })
  contentContainer.add(inputContainer)

  const inputLabel = new TextRenderable(renderer, {
    id: "input-label",
    content: "Palette Size: ",
    fg: RGBA.fromInts(148, 163, 184),
  })
  inputContainer.add(inputLabel)

  paletteSizeInput = new InputRenderable(renderer, {
    id: "palette-size-input",
    width: 10,
    height: 1,
    backgroundColor: RGBA.fromInts(30, 41, 59),
    textColor: RGBA.fromInts(255, 255, 255),
    placeholder: "16",
    placeholderColor: RGBA.fromInts(100, 116, 139),
    cursorColor: RGBA.fromInts(139, 92, 246), // Purple cursor
    value: "16",
    maxLength: 3,
  })
  inputContainer.add(paletteSizeInput)

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

  // Create palette grid - will be populated when palette is fetched
  paletteGrid = new PaletteGridRenderable(renderer, {
    id: "palette-grid",
    colors: [],
    marginTop: 2,
  })
  contentContainer.add(paletteGrid)

  // Set up input submit handler
  paletteSizeInput.on(InputRenderableEvents.ENTER, async (value: string) => {
    const size = parseInt(value, 10)
    if (isNaN(size) || size < 1 || size > 256) {
      if (statusText) {
        statusText.content = "Status: Invalid palette size. Please enter a number between 1 and 256."
        statusText.fg = RGBA.fromInts(239, 68, 68) // Red error
      }
      return
    }
    await fetchAndDisplayPalette(renderer, size)
  })

  // Set up keyboard handler
  keyboardHandler = async (key) => {
    if (key.name === "c") {
      clearPaletteCache(renderer)
    }
  }

  renderer.keyInput.on("keypress", keyboardHandler)

  // Focus the input field on start
  paletteSizeInput.focus()
}

async function fetchAndDisplayPalette(renderer: CliRenderer, size: number): Promise<void> {
  if (!statusText || !paletteGrid) return

  try {
    const wasAlreadyCached = renderer.paletteDetectionStatus === "cached"
    statusText.content = `Status: ${wasAlreadyCached ? "Using cached palette" : "Fetching palette..."}`
    statusText.fg = RGBA.fromInts(250, 204, 21) // Amber - warm loading state

    const startTime = performance.now()
    terminalColors = await renderer.getPalette({ size })
    const elapsed = Math.round(performance.now() - startTime)

    statusText.content = `Status: Palette (${size} colors) fetched in ${elapsed}ms (${wasAlreadyCached ? "from cache" : "from terminal"})`
    statusText.fg = RGBA.fromInts(34, 197, 94) // Emerald - fresh success state

    drawPalette(renderer, terminalColors, size)
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
  statusText.content = "Status: Cache cleared. Enter a size and press Enter to fetch palette again."
  statusText.fg = RGBA.fromInts(148, 163, 184) // Slate-400 - neutral info state
}

function drawPalette(renderer: CliRenderer, terminalColors: TerminalColors, size: number): void {
  const colors = terminalColors.palette.slice(0, size)

  // Update the palette grid with new colors
  if (paletteGrid) {
    paletteGrid.colors = colors
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

  // Update the hex list with new colors
  if (!hexList) {
    hexList = new HexListRenderable(renderer, {
      id: "hex-list",
      colors: colors,
      marginTop: 2,
    })
    contentContainer!.add(hexList)
  } else {
    hexList.colors = colors
  }
}

export function destroy(renderer: CliRenderer): void {
  if (keyboardHandler) {
    renderer.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  if (paletteSizeInput) {
    paletteSizeInput.destroy()
    paletteSizeInput = null
  }

  if (scrollBox) {
    renderer.root.remove("main-container")
    scrollBox = null
  }

  contentContainer = null
  paletteGrid = null
  hexList = null
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
