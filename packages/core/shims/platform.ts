import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

export default join(__dirname, "..", "node_modules", "@opentui", "core-darwin-arm64", "libopentui.dylib")
