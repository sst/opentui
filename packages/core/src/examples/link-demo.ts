import { CliRenderer, createCliRenderer, t, blue, underline, link, BoxRenderable, type KeyEvent } from "../index"
import { TextRenderable } from "../renderables/Text"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let parentContainer: BoxRenderable | null = null
let keyboardHandler: ((key: KeyEvent) => void) | null = null

export function run(rendererInstance: CliRenderer): void {
  const renderer = rendererInstance
  renderer.start()
  renderer.setBackgroundColor("#001122")

  parentContainer = new BoxRenderable(renderer, {
    id: "link-container",
    zIndex: 15,
  })
  renderer.root.add(parentContainer)

  // Example with hyperlinks
  const linkText = t`${underline(blue(link("https://github.com/sst/opentui")("OpenTUI on GitHub")))}

Visit our ${link("https://opentui.org")("website")} for more info.

Check out the ${underline(link("https://github.com/sst/opentui/blob/main/README.md")("README"))}`

  const linkDisplay = new TextRenderable(renderer, {
    id: "link-text",
    content: linkText,
    width: 60,
    height: 8,
    position: "absolute",
    left: 2,
    top: 2,
    zIndex: 1,
  })
  parentContainer.add(linkDisplay)

  const instructionsText = t`${underline("Hyperlink Demo")}

The text above contains clickable hyperlinks (if your terminal supports OSC 8).
Try clicking on the blue underlined text!

Press ESC to return to the menu.`

  const instructionsDisplay = new TextRenderable(renderer, {
    id: "instructions",
    content: instructionsText,
    width: 70,
    height: 8,
    position: "absolute",
    left: 2,
    top: 12,
    zIndex: 1,
  })
  parentContainer.add(instructionsDisplay)

  renderer.requestRender()
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyboardHandler) {
    rendererInstance.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  if (parentContainer) {
    rendererInstance.root.remove("link-container")
    parentContainer = null
  }
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
