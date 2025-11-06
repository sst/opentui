#!/usr/bin/env -S bun run
import { createCliRenderer } from "../src/renderer"

async function main() {
  const renderer = await createCliRenderer({
    useConsole: false,
    useAlternateScreen: false,
  })

  console.log("Detecting terminal palette...")
  const palette = await renderer.getPalette()

  console.log("\nDetected palette:")
  palette.forEach((color, index) => {
    if (color) {
      console.log(`Color ${index}: ${color}`)
    } else {
      console.log(`Color ${index}: (not detected)`)
    }
  })

  console.log(`\nTotal colors detected: ${palette.filter((c) => c !== null).length}`)

  renderer.destroy()
  process.exit(0)
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
