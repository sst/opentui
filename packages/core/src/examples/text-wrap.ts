#!/usr/bin/env bun
/**
 * Text wrapping example
 * Demonstrates automatic text wrapping when the wrap option is enabled
 */
import { CliRenderer, createCliRenderer, TextRenderable, BoxRenderable, type MouseEvent } from ".."
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let mainContainer: BoxRenderable | null = null
let contentBox: BoxRenderable | null = null
let textBox: BoxRenderable | null = null
let textRenderable: TextRenderable | null = null
let instructionsBox: BoxRenderable | null = null
let instructionsText1: TextRenderable | null = null
let instructionsText2: TextRenderable | null = null

// Resize state
let isResizing = false
let resizeDirection: "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e" | null = null
let resizeStartX = 0
let resizeStartY = 0
let resizeStartLeft = 0
let resizeStartTop = 0
let resizeStartWidth = 0
let resizeStartHeight = 0

// Helper function to detect resize direction based on mouse position
function getResizeDirection(
  mouseX: number,
  mouseY: number,
  boxLeft: number,
  boxTop: number,
  boxWidth: number,
  boxHeight: number,
): "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e" | null {
  // Check if mouse is exactly on the border (1 pixel wide)
  // Border coordinates: left edge, right edge, top edge, bottom edge
  const onLeftBorder = mouseX === boxLeft
  const onRightBorder = mouseX === boxLeft + boxWidth - 1
  const onTopBorder = mouseY === boxTop
  const onBottomBorder = mouseY === boxTop + boxHeight - 1

  // Check if mouse is within the box bounds (including border)
  const withinHorizontalBounds = mouseX >= boxLeft && mouseX <= boxLeft + boxWidth - 1
  const withinVerticalBounds = mouseY >= boxTop && mouseY <= boxTop + boxHeight - 1

  // Only detect resize if mouse is on a border AND within bounds
  const left = onLeftBorder && withinVerticalBounds
  const right = onRightBorder && withinVerticalBounds
  const top = onTopBorder && withinHorizontalBounds
  const bottom = onBottomBorder && withinHorizontalBounds

  if (top && left) return "nw"
  if (top && right) return "ne"
  if (bottom && left) return "sw"
  if (bottom && right) return "se"
  if (top) return "n"
  if (bottom) return "s"
  if (left) return "w"
  if (right) return "e"

  return null
}

// Mouse event handler for resizing
function handleTextBoxMouse(event: MouseEvent): void {
  if (!textBox) return

  switch (event.type) {
    case "move":
    case "over": {
      if (!isResizing) {
        const boxLeft = typeof textBox.left === "number" ? textBox.left : 0
        const boxTop = typeof textBox.top === "number" ? textBox.top : 0
        const direction = getResizeDirection(event.x, event.y, boxLeft, boxTop, textBox.width, textBox.height)
        resizeDirection = direction

        // Update cursor style based on resize direction
        if (direction) {
          const cursorMap = {
            nw: "nw-resize",
            ne: "ne-resize",
            sw: "sw-resize",
            se: "se-resize",
            n: "n-resize",
            s: "s-resize",
            w: "w-resize",
            e: "e-resize",
          } as const
          // Note: OpenTUI may not support custom cursor styles yet, but we can still track the direction
        }
      }
      break
    }

    case "down": {
      if (resizeDirection) {
        isResizing = true
        resizeStartX = event.x
        resizeStartY = event.y
        resizeStartWidth = textBox.width
        resizeStartHeight = textBox.height
        // Store the original position for resize calculations
        resizeStartLeft = typeof textBox.left === "number" ? textBox.left : 0
        resizeStartTop = typeof textBox.top === "number" ? textBox.top : 0
        event.stopPropagation()
      }
      break
    }

    case "drag": {
      if (isResizing && resizeDirection) {
        const deltaX = event.x - resizeStartX
        const deltaY = event.y - resizeStartY

        let newWidth = resizeStartWidth
        let newHeight = resizeStartHeight
        let newLeft = resizeStartLeft
        let newTop = resizeStartTop

        // Handle different resize directions
        switch (resizeDirection) {
          case "nw":
            newWidth = Math.max(10, resizeStartWidth - deltaX)
            newHeight = Math.max(5, resizeStartHeight - deltaY)
            newLeft = resizeStartLeft + (resizeStartWidth - newWidth)
            newTop = resizeStartTop + (resizeStartHeight - newHeight)
            break
          case "ne":
            newWidth = Math.max(10, resizeStartWidth + deltaX)
            newHeight = Math.max(5, resizeStartHeight - deltaY)
            newTop = resizeStartTop + (resizeStartHeight - newHeight)
            break
          case "sw":
            newWidth = Math.max(10, resizeStartWidth - deltaX)
            newHeight = Math.max(5, resizeStartHeight + deltaY)
            newLeft = resizeStartLeft + (resizeStartWidth - newWidth)
            break
          case "se":
            newWidth = Math.max(10, resizeStartWidth + deltaX)
            newHeight = Math.max(5, resizeStartHeight + deltaY)
            break
          case "n":
            newHeight = Math.max(5, resizeStartHeight - deltaY)
            newTop = resizeStartTop + (resizeStartHeight - newHeight)
            break
          case "s":
            newHeight = Math.max(5, resizeStartHeight + deltaY)
            break
          case "w":
            newWidth = Math.max(10, resizeStartWidth - deltaX)
            newLeft = resizeStartLeft + (resizeStartWidth - newWidth)
            break
          case "e":
            newWidth = Math.max(10, resizeStartWidth + deltaX)
            break
        }

        // Apply the new dimensions and position
        textBox.width = newWidth
        textBox.height = newHeight
        textBox.left = newLeft
        textBox.top = newTop

        event.stopPropagation()
      }
      break
    }

    case "up":
    case "drag-end": {
      if (isResizing) {
        isResizing = false
        resizeDirection = null
        event.stopPropagation()
      }
      break
    }

    case "out": {
      if (!isResizing) {
        resizeDirection = null
      }
      break
    }
  }
}

const longText =
  "This is a very long text that should wrap when the text wrapping is enabled. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. The text will automatically break into multiple lines based on the width of the container."

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#0d1117")

  // Create main container
  mainContainer = new BoxRenderable(renderer, {
    id: "mainContainer",
    flexGrow: 1,
    maxHeight: "100%",
    maxWidth: "100%",
    backgroundColor: "#161b22",
    zIndex: 1,
    borderColor: "#50565d",
    title: "Text Wrapping Demo",
    titleAlignment: "center",
    border: true,
    flexDirection: "column",
  })
  renderer.root.add(mainContainer)

  // Create content box for main demonstration area
  contentBox = new BoxRenderable(renderer, {
    id: "content-box",
    flexGrow: 1,
    backgroundColor: "#1a1a1a",
  })

  // Create a box for text demonstration
  textBox = new BoxRenderable(renderer, {
    id: "text-box",
    position: "absolute",
    left: 2,
    top: 2,
    width: 80,
    height: 15,
    borderStyle: "rounded",
    borderColor: "green",
    backgroundColor: "#0f0f0f",
    onMouse: handleTextBoxMouse,
  })
  contentBox.add(textBox)

  textRenderable = new TextRenderable(renderer, {
    id: "text-renderable",
    content: longText,
    fg: "white",
    wrapMode: "word",
    wrap: true, // Enable text wrapping
  })
  textBox.add(textRenderable)

  // Create instructions box
  instructionsBox = new BoxRenderable(renderer, {
    id: "instructions-box",
    width: "100%",
    flexDirection: "column",
    backgroundColor: "#1e1e2e",
    paddingLeft: 1,
  })

  // Instructions
  instructionsText1 = new TextRenderable(renderer, {
    id: "instructions-1",
    content:
      "Press 'w' to toggle text wrapping | Press 'm' to switch wrap mode (char/word) | Drag borders/corners to resize",
    fg: "yellow",
  })

  instructionsText2 = new TextRenderable(renderer, {
    id: "instructions-2",
    content: "Current Status: Text (wrap: true, mode: word)",
    fg: "c0caf5",
  })

  instructionsBox.add(instructionsText1)
  instructionsBox.add(instructionsText2)

  // Add content and instructions to main container
  mainContainer.add(contentBox)
  mainContainer.add(instructionsBox)

  // Handle keyboard input
  renderer.on("key", (data) => {
    const key = data.toString()

    if (key === "w" || key === "W") {
      // Toggle wrap on the text
      if (textRenderable && instructionsText2) {
        textRenderable.wrap = !textRenderable.wrap
        if (textRenderable.wrap) {
          instructionsText2.content = `Current Status: Text (wrap: true, mode: ${textRenderable.wrapMode})`
        } else {
          instructionsText2.content = "Current Status: Text (wrap: false)"
        }
      }
    } else if (key === "m" || key === "M") {
      if (textRenderable && textRenderable.wrap && instructionsText2) {
        textRenderable.wrapMode = textRenderable.wrapMode === "char" ? "word" : "char"
        instructionsText2.content = `Current Status: Text (wrap: true, mode: ${textRenderable.wrapMode})`
      }
    }
  })
}

export function destroy(renderer: CliRenderer): void {
  mainContainer?.destroyRecursively()
  mainContainer = null
  contentBox = null
  textBox = null
  textRenderable = null
  instructionsBox = null
  instructionsText1 = null
  instructionsText2 = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    targetFps: 30,
    enableMouseMovement: true,
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
  // renderer.start() is called by setupCommonDemoKeys
}
