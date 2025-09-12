import { resolveRenderLib, type CliRenderer, type ParsedKey } from "../.."
import { getKeyHandler } from "../../lib/KeyHandler"

export function setupCommonDemoKeys(renderer: CliRenderer) {
  getKeyHandler().on("keypress", (key: ParsedKey) => {
    if (key.name === "`" || key.name === '"') {
      renderer.console.toggle()
    } else if (key.name === ".") {
      renderer.toggleDebugOverlay()
    } else if (key.name === "g" && key.ctrl) {
      console.log("dumping hit grid")
      renderer.dumpHitGrid()
    } else if (key.name === "l" && key.shift) {
      renderer.start()
    } else if (key.name === "s" && key.shift) {
      renderer.stop()
    } else if (key.name === "a" && key.shift) {
      renderer.auto()
    } else if (key.name === "a" && key.ctrl) {
      const lib = resolveRenderLib()
      const rawBytes = lib.getArenaAllocatedBytes()
      const formattedBytes = `${(rawBytes / 1024 / 1024).toFixed(2)} MB`
      console.log("arena allocated bytes:", formattedBytes)
    }
  })
}
