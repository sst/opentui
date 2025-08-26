#!/usr/bin/env bun
import { createCliRenderer, ASCIIFontRenderable, BoxRenderable, fonts, type FontDefinition } from ".."

// Import external font - demonstrating how users can add custom fonts
import gridFont from "./grid-font.json"

async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    useAlternateScreen: true,
  })

  const container = new BoxRenderable("container", {
    width: "100%",
    height: "100%",
    borderStyle: "rounded",
    borderColor: "#3498db",
    padding: 2,
    flexDirection: "column",
    gap: 2,
  })

  // Using built-in font
  const title1 = new ASCIIFontRenderable("title1", {
    text: "BUILT-IN",
    font: fonts.block,
    fg: "#00ff00",
  })

  // Using external font loaded from JSON file
  const title2 = new ASCIIFontRenderable("title2", {
    text: "CUSTOM",
    font: gridFont as FontDefinition,
    fg: "#ff00ff",
  })

  container.add(title1)
  container.add(title2)

  renderer.root.add(container)
  renderer.start()

  // Exit on escape
  renderer.on("key", (key) => {
    if (key.name === "escape") {
      renderer.destroy()
      process.exit(0)
    }
  })
}

main().catch(console.error)