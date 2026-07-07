import { createCliRenderer } from "../renderer.js"

await createCliRenderer()
process.stderr.write("renderer-ready\n")
