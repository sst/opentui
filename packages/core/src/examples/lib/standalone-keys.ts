import type { CliRenderer, ParsedKey } from "../.."
import { getKeyHandler } from "../../lib/KeyHandler"

export function setupCommonDemoKeys(renderer: CliRenderer) {
  getKeyHandler().on("keypress", (key: ParsedKey) => {
    if (key.name === "`" || key.name === '"') {
      renderer.console.toggle()
    } else if (key.name === "t") {
      renderer.toggleDebugOverlay()
    } else if (key.name === "g" && key.ctrl) {
      console.log("dumping hit grid")
      renderer.dumpHitGrid()
    }
  })
}
