#!/usr/bin/env bun
/**
 * Text wrapping example
 * Demonstrates automatic text wrapping when the wrap option is enabled
 */
import { CliRenderer, createCliRenderer, TextRenderable, BoxRenderable } from ".."
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let mainContainer: BoxRenderable | null = null
let wrappedBox: BoxRenderable | null = null
let nonWrappedBox: BoxRenderable | null = null
let wrappedText: TextRenderable | null = null
let nonWrappedText: TextRenderable | null = null
let wrappedLabel: TextRenderable | null = null
let nonWrappedLabel: TextRenderable | null = null
let instructions: TextRenderable | null = null

const longText =
  "This is a very long text that should wrap when the text wrapping is enabled. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. The text will automatically break into multiple lines based on the width of the container."

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#0d1117")

  // Create main container
  mainContainer = new BoxRenderable(renderer, {
    id: "mainContainer",
    width: 90,
    height: 20,
    backgroundColor: "#161b22",
    zIndex: 1,
    borderColor: "#50565d",
    title: "Text Wrapping Demo",
    titleAlignment: "center",
    border: true,
  })
  renderer.root.add(mainContainer)

  const wrapGroup = new BoxRenderable(renderer, {
    id: "wrap-group",
    flexDirection: "row",
  })
  mainContainer.add(wrapGroup)

  // Create a box with wrapped text
  wrappedBox = new BoxRenderable(renderer, {
    id: "wrapped-box",
    width: 40,
    height: 12,
    borderStyle: "rounded",
    borderColor: "green",
  })
  wrapGroup.add(wrappedBox)

  wrappedText = new TextRenderable(renderer, {
    id: "wrapped-text",
    content: longText,
    fg: "white",
    wrap: true, // Enable text wrapping
  })
  wrappedBox.add(wrappedText)

  // Create a box with non-wrapped text for comparison
  nonWrappedBox = new BoxRenderable(renderer, {
    id: "non-wrapped-box",
    width: 40,
    height: 12,
    borderStyle: "rounded",
    borderColor: "red",
  })
  wrapGroup.add(nonWrappedBox)

  nonWrappedText = new TextRenderable(renderer, {
    id: "non-wrapped-text",
    content: longText,
    fg: "white",
    wrap: false, // Text wrapping disabled (default)
  })
  nonWrappedBox.add(nonWrappedText)

  // Add labels
  wrappedLabel = new TextRenderable(renderer, {
    id: "wrapped-label",
    content: "Wrapped Text (wrap: true):",
    fg: "green",
  })
  mainContainer.add(wrappedLabel)

  nonWrappedLabel = new TextRenderable(renderer, {
    id: "non-wrapped-label",
    content: "Non-Wrapped Text (wrap: false):",
    fg: "red",
  })
  mainContainer.add(nonWrappedLabel)

  // Instructions
  instructions = new TextRenderable(renderer, {
    id: "instructions",
    content: "Press 'w' to toggle wrap on left box | Press 'ESC' to exit",
    fg: "yellow",
  })
  mainContainer.add(instructions)

  // Handle keyboard input
  renderer.on("key", (data) => {
    const key = data.toString()

    if (key === "w" || key === "W") {
      // Toggle wrap on the left box
      if (wrappedText) {
        wrappedText.wrap = !wrappedText.wrap
        if (wrappedLabel) {
          wrappedLabel.content = wrappedText.wrap ? "Wrapped Text (wrap: true):" : "Wrapped Text (wrap: false):"
        }
      }
    }
  })
}

export function destroy(renderer: CliRenderer): void {
  mainContainer?.destroyRecursively()
  mainContainer = null
  wrappedBox = null
  nonWrappedBox = null
  wrappedText = null
  nonWrappedText = null
  wrappedLabel = null
  nonWrappedLabel = null
  instructions = null
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
