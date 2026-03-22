import { createTestRenderer } from "@opentui/core/testing"

const code = parseInt(process.argv[2] ?? "0", 10)

const { renderer } = await createTestRenderer({ width: 20, height: 10 })
renderer.on("destroy", () => {
  console.log("renderer destroyed")
})

process.exit(code) // manually exit. renderer should call destroy
