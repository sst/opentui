import type { CliRenderer, ParsedKey } from "../.."
import { getKeyHandler } from "../../ui/lib/KeyHandler"

export function setupCommonDemoKeys(renderer: CliRenderer) {
  getKeyHandler().on("keypress", (key: ParsedKey) => {
    if (key.name === "`") {
      renderer.console.toggle()
    } else if (key.name === "t") {
      renderer.toggleDebugOverlay()
    } else if (key.name === "h") {
      console.log("dumping hit grid")
      renderer.dumpHitGrid()
    }
  })
}
