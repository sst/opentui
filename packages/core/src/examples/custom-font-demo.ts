#!/usr/bin/env bun
import { createCliRenderer, ASCIIFontRenderable, BoxRenderable, fonts, type FontDefinition } from ".."

// Example of importing an external font
// Users would do: import hugeFont from "./fonts/huge.json"
// For demo, we'll use the built-in fonts and show how to use custom ones

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

  // Using built-in font (default)
  const title1 = new ASCIIFontRenderable("title1", {
    text: "TINY FONT",
    font: fonts.tiny, // Explicitly passing FontDefinition
    fg: "#ffffff",
  })

  // Using different built-in font
  const title2 = new ASCIIFontRenderable("title2", {
    text: "BLOCK",
    font: fonts.block,
    fg: "#00ff00",
  })

  // Using another built-in font
  const title3 = new ASCIIFontRenderable("title3", {
    text: "SHADE",
    font: fonts.shade,
    fg: "#ff00ff",
  })

  // Using slick font
  const title4 = new ASCIIFontRenderable("title4", {
    text: "SLICK",
    font: fonts.slick,
    fg: "#ffff00",
  })

  // Example of how users would use custom fonts:
  // import customFont from "./my-custom-font.json"
  // const customTitle = new ASCIIFontRenderable("custom", {
  //   text: "CUSTOM",
  //   font: customFont as FontDefinition,
  //   fg: "#00ffff",
  // })

  container.add(title1)
  container.add(title2)
  container.add(title3)
  container.add(title4)

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