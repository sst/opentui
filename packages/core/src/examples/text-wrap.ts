#!/usr/bin/env bun
/**
 * Text wrapping example
 * Demonstrates automatic text wrapping when the wrap option is enabled
 */
import { CliRenderer, createCliRenderer, TextRenderable, BoxRenderable, type MouseEvent, t, fg, bold } from ".."
import { TextNodeRenderable } from "../renderables/TextNode"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let mainContainer: BoxRenderable | null = null
let contentBox: BoxRenderable | null = null
let textBox: ScrollBoxRenderable | null = null
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
        // Use the computed screen position of the textBox
        const boxLeft = textBox.x
        const boxTop = textBox.y
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
        // Store the original position - convert from absolute screen coords to relative coords within contentBox
        // contentBox has padding: 1, so subtract padding to get relative coordinates
        const contentPadding = contentBox ? 1 : 0
        resizeStartLeft = textBox.x - contentPadding
        resizeStartTop = textBox.y - contentPadding
        event.stopPropagation()
      }
      break
    }

    case "drag": {
      // Don't handle drag here - let the global handler manage it
      // Don't stop propagation so global handler can receive events
      break
    }

    case "up":
    case "drag-end": {
      // Don't handle resize end here - let the global handler manage it
      // Don't stop propagation so global handler can receive events
      break
    }

    case "out": {
      if (!isResizing) {
        resizeDirection = null
      }
      // During resize, keep the original resizeDirection - don't clear it
      break
    }
  }
}

// Global mouse handler for resize operations
function handleGlobalMouse(event: MouseEvent): void {
  switch (event.type) {
    case "move":
    case "drag": {
      // Only handle if we're in a resize operation
      if (isResizing && resizeDirection && textBox) {
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

        // Constrain to content box bounds (accounting for padding: 1)
        if (contentBox) {
          const contentPadding = 1
          const maxWidth = contentBox.width - 2 * contentPadding
          const maxHeight = contentBox.height - 2 * contentPadding
          const minLeft = contentPadding
          const minTop = contentPadding
          const maxLeft = contentBox.width - newWidth - contentPadding
          const maxTop = contentBox.height - newHeight - contentPadding

          newWidth = Math.min(newWidth, maxWidth)
          newHeight = Math.min(newHeight, maxHeight)
          newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft))
          newTop = Math.max(minTop, Math.min(newTop, maxTop))
        }

        // Apply the new dimensions and position
        textBox.width = newWidth
        textBox.height = newHeight
        textBox.left = newLeft
        textBox.top = newTop
      }
      break
    }

    case "up": {
      // End resize operation on any mouse up
      if (isResizing) {
        isResizing = false
        resizeDirection = null
      }
      break
    }
  }
}

// Create styled demo text using TextNodes
function createDemoText(): TextNodeRenderable {
  const titleNode = TextNodeRenderable.fromString("🎨 OpenTUI Text Wrapping Demo", {
    fg: "#7aa2f7",
    attributes: 1, // bold
  })

  const introNode = TextNodeRenderable.fromString("\n\nWelcome to the ", {
    fg: "#c0caf5",
  })

  const highlightNode = TextNodeRenderable.fromString("text wrapping demonstration", {
    fg: "#9ece6a",
    attributes: 1, // bold
  })

  const introContNode = TextNodeRenderable.fromString(
    ". This example showcases how OpenTUI handles automatic text wrapping with styled content using TextNodes.",
    {
      fg: "#c0caf5",
    },
  )

  const featuresTitle = TextNodeRenderable.fromString("\n\n✨ Key Features:", {
    fg: "#bb9af7",
    attributes: 1,
  })

  const feature1Node = TextNodeRenderable.fromNodes([
    TextNodeRenderable.fromString("\n• ", { fg: "#9ece6a" }),
    TextNodeRenderable.fromString("Word-based wrapping", { fg: "#c0caf5", attributes: 1 }),
    TextNodeRenderable.fromString(" - Preserves word boundaries when breaking lines", { fg: "#565f89" }),
  ])

  const feature2Node = TextNodeRenderable.fromNodes([
    TextNodeRenderable.fromString("\n• ", { fg: "#9ece6a" }),
    TextNodeRenderable.fromString("Character-based wrapping", { fg: "#c0caf5", attributes: 1 }),
    TextNodeRenderable.fromString(" - Breaks at any character for precise control", { fg: "#565f89" }),
  ])

  const feature3Node = TextNodeRenderable.fromNodes([
    TextNodeRenderable.fromString("\n• ", { fg: "#9ece6a" }),
    TextNodeRenderable.fromString("Dynamic resizing", { fg: "#c0caf5", attributes: 1 }),
    TextNodeRenderable.fromString(" - Text reflows automatically as container dimensions change", { fg: "#565f89" }),
  ])

  const feature4Node = TextNodeRenderable.fromNodes([
    TextNodeRenderable.fromString("\n• ", { fg: "#9ece6a" }),
    TextNodeRenderable.fromString("Rich styling", { fg: "#c0caf5", attributes: 1 }),
    TextNodeRenderable.fromString(" - Individual text segments can have different colors and attributes", {
      fg: "#565f89",
    }),
  ])

  const demoTitle = TextNodeRenderable.fromString("\n\n🔧 How It Works:", {
    fg: "#bb9af7",
    attributes: 1,
  })

  const demoText = TextNodeRenderable.fromString(
    "\n\nTextNodes are created with specific styling and then composed together to form rich, formatted text content. Each node can contain different foreground colors, background colors, and text attributes like ",
    {
      fg: "#c0caf5",
    },
  )

  const boldExample = TextNodeRenderable.fromString("bold", {
    fg: "#f7768e",
    attributes: 1,
  })

  const demoCont = TextNodeRenderable.fromString(", ", {
    fg: "#c0caf5",
  })

  const italicExample = TextNodeRenderable.fromString("italic", {
    fg: "#f7768e",
    attributes: 2,
  })

  const demoCont2 = TextNodeRenderable.fromString(", and ", {
    fg: "#c0caf5",
  })

  const underlineExample = TextNodeRenderable.fromString("underline", {
    fg: "#f7768e",
    attributes: 4,
  })

  const demoCont3 = TextNodeRenderable.fromString(
    ". When the container is resized, the text automatically reflows to fit the new dimensions while maintaining the specified wrapping mode.",
    {
      fg: "#c0caf5",
    },
  )

  const codeTitle = TextNodeRenderable.fromString("\n\n💻 Example Code:", {
    fg: "#bb9af7",
    attributes: 1,
  })

  const codeBlock = TextNodeRenderable.fromString(
    `\n\nconst styledText = TextNodeRenderable.fromNodes([
  TextNodeRenderable.fromString("Hello ", { fg: "#9ece6a" }),
  TextNodeRenderable.fromString("World", { fg: "#7aa2f7", attributes: 1 }),
  TextNodeRenderable.fromString("!", { fg: "#f7768e" })
]);

textRenderable.add(styledText);`,
    {
      fg: "#c0caf5",
      bg: "#1a1a2e",
    },
  )

  const interactionTitle = TextNodeRenderable.fromString("\n\n🎮 Try It Out:", {
    fg: "#bb9af7",
    attributes: 1,
  })

  const interactionText = TextNodeRenderable.fromString(
    "\n\nDrag the borders or corners of this text box to resize it and watch how the text wrapping adapts in real-time. Press ",
    {
      fg: "#c0caf5",
    },
  )

  const keyW = TextNodeRenderable.fromString("W", {
    fg: "#9ece6a",
    attributes: 1,
  })

  const interactionCont = TextNodeRenderable.fromString(" to toggle wrapping on/off, ", {
    fg: "#c0caf5",
  })

  const keyM = TextNodeRenderable.fromString("M", {
    fg: "#bb9af7",
    attributes: 1,
  })

  const interactionCont2 = TextNodeRenderable.fromString(" to switch between word and character wrapping modes, and ", {
    fg: "#c0caf5",
  })

  const keyD = TextNodeRenderable.fromString("D", {
    fg: "#f7768e",
    attributes: 1,
  })

  const interactionCont3 = TextNodeRenderable.fromString(
    " to download and display the Babylon.js library source code. The text will reflow instantly to demonstrate the different wrapping behaviors.",
    {
      fg: "#c0caf5",
    },
  )

  const conclusionNode = TextNodeRenderable.fromString(
    "\n\n🚀 This demonstrates the power of OpenTUI's flexible text rendering system, combining rich styling with dynamic layout capabilities!",
    {
      fg: "#9ece6a",
      attributes: 1,
    },
  )

  return TextNodeRenderable.fromNodes([
    titleNode,
    introNode,
    highlightNode,
    introContNode,
    featuresTitle,
    feature1Node,
    feature2Node,
    feature3Node,
    feature4Node,
    demoTitle,
    demoText,
    boldExample,
    demoCont,
    italicExample,
    demoCont2,
    underlineExample,
    demoCont3,
    codeTitle,
    codeBlock,
    interactionTitle,
    interactionText,
    keyW,
    interactionCont,
    keyM,
    interactionCont2,
    keyD,
    interactionCont3,
    conclusionNode,
  ])
}

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#0a0a14")

  // Add global mouse handler for resize operations
  renderer.root.onMouse = handleGlobalMouse

  // Create main container (no border, just layout)
  mainContainer = new BoxRenderable(renderer, {
    id: "mainContainer",
    flexGrow: 1,
    maxHeight: "100%",
    maxWidth: "100%",
    backgroundColor: "#0f0f23",
    flexDirection: "column",
  })
  renderer.root.add(mainContainer)

  // Create content box for main demonstration area
  contentBox = new BoxRenderable(renderer, {
    id: "content-box",
    flexGrow: 1,
    backgroundColor: "#1e1e2e",
    border: true,
    borderColor: "#565f89",
    padding: 1,
  })

  textBox = new ScrollBoxRenderable(renderer, {
    id: "text-box",
    position: "absolute",
    left: 2,
    top: 2,
    width: 80,
    height: 15,
    borderStyle: "rounded",
    borderColor: "#9ece6a",
    backgroundColor: "#11111b",
    onMouse: handleTextBoxMouse,
  })
  contentBox.add(textBox)

  textRenderable = new TextRenderable(renderer, {
    id: "text-renderable",
    fg: "#c0caf5",
    wrapMode: "word",
    wrap: true, // Enable text wrapping
  })
  textRenderable.add(createDemoText())
  textBox.add(textRenderable)

  // Create instructions box with border
  instructionsBox = new BoxRenderable(renderer, {
    id: "instructions-box",
    width: "100%",
    flexDirection: "column",
    backgroundColor: "#1e1e2e",
    border: true,
    borderColor: "#565f89",
    padding: 1,
  })

  // Instructions with styled text
  instructionsText1 = new TextRenderable(renderer, {
    id: "instructions-1",
    content: t`${bold(fg("#7aa2f7")("Text Wrap Demo"))} ${fg("#565f89")("-")} ${bold(fg("#9ece6a")("W"))} ${fg("#c0caf5")("Toggle wrapping")} ${fg("#565f89")("|")} ${bold(fg("#bb9af7")("M"))} ${fg("#c0caf5")("Switch mode (char/word)")} ${fg("#565f89")("|")} ${bold(fg("#f7768e")("D"))} ${fg("#c0caf5")("Download Babylon.js")} ${fg("#565f89")("|")} ${bold(fg("#ff9e64")("Drag"))} ${fg("#c0caf5")("borders/corners to resize")}`,
  })

  instructionsText2 = new TextRenderable(renderer, {
    id: "instructions-2",
    content: t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#c0caf5")("Text (wrap:")} ${fg("#9ece6a")("true")}${fg("#c0caf5")(", mode:")} ${fg("#bb9af7")("word")}${fg("#c0caf5")(")")}`,
  })

  instructionsBox.add(instructionsText1)
  instructionsBox.add(instructionsText2)

  // Add content and instructions to main container
  mainContainer.add(contentBox)
  mainContainer.add(instructionsBox)

  // Handle keyboard input
  renderer.on("key", async (data) => {
    const key = data.toString()

    if (key === "w" || key === "W") {
      // Toggle wrap on the text
      if (textRenderable && instructionsText2) {
        textRenderable.wrap = !textRenderable.wrap
        if (textRenderable.wrap) {
          instructionsText2.content = t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#c0caf5")("Text (wrap:")} ${fg("#9ece6a")("true")}${fg("#c0caf5")(", mode:")} ${fg("#bb9af7")(textRenderable.wrapMode)}${fg("#c0caf5")(")")}`
        } else {
          instructionsText2.content = t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#c0caf5")("Text (wrap:")} ${fg("#f7768e")("false")}${fg("#c0caf5")(")")}`
        }
      }
    } else if (key === "m" || key === "M") {
      if (textRenderable && textRenderable.wrap && instructionsText2) {
        textRenderable.wrapMode = textRenderable.wrapMode === "char" ? "word" : "char"
        instructionsText2.content = t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#c0caf5")("Text (wrap:")} ${fg("#9ece6a")("true")}${fg("#c0caf5")(", mode:")} ${fg("#bb9af7")(textRenderable.wrapMode)}${fg("#c0caf5")(")")}`
      }
    } else if (key === "d" || key === "D") {
      // Download Babylon.js and display it
      if (textRenderable && instructionsText2) {
        try {
          // Update status to show downloading
          instructionsText2.content = t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#f7768e")("Downloading Babylon.js...")}`

          // Download the file
          const response = await fetch("https://cdnjs.cloudflare.com/ajax/libs/babylonjs/8.20.0/babylon.js")
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          const content = await response.text()

          // Store in OS tmp directory
          const tempDir = process.env.TMPDIR || process.env.TEMP || "/tmp"
          const fileName = `babylon-${Date.now()}.js`
          const filePath = `${tempDir}/${fileName}`

          await Bun.write(filePath, content)

          // Load it back using Bun.file().text()
          const loadedContent = await Bun.file(filePath).text()

          // Create a new TextNodeRenderable with the downloaded content
          const babylonTextNode = TextNodeRenderable.fromString(
            `// Downloaded Babylon.js (${loadedContent.length} chars)\n// Stored at: ${filePath}\n\n${loadedContent}`,
            {
              fg: "#c0caf5",
            },
          )

          // Replace the current content
          textRenderable.clear()
          textRenderable.add(babylonTextNode)

          // Update status
          instructionsText2.content = t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#c0caf5")("Babylon.js loaded (")} ${fg("#9ece6a")(loadedContent.length.toString())}${fg("#c0caf5")(" chars, wrap:")} ${textRenderable.wrap ? fg("#9ece6a")("true") : fg("#f7768e")("false")}${fg("#c0caf5")(", mode:")} ${fg("#bb9af7")(textRenderable.wrapMode)}${fg("#c0caf5")(")")}`
        } catch (error) {
          // Show error in status
          instructionsText2.content = t`${bold(fg("#7aa2f7")("Status:"))} ${fg("#f7768e")("Download failed:")} ${fg("#c0caf5")(error instanceof Error ? error.message : "Unknown error")}`
        }
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
