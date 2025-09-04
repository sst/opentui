import { CliRenderer, createCliRenderer, BoxRenderable, InputRenderable, TextRenderable } from ".."
import { setupCommonDemoKeys } from "./lib/standalone-keys"

const MAX_DEPTH = 3
const MIN_INPUTS = 1
const MAX_INPUTS = 2
const MIN_SUBLEVELS = 2
const MAX_SUBLEVELS = 3

let renderer: CliRenderer | null = null
let parentContainer: BoxRenderable | null = null
let footer: TextRenderable | null = null
let footerBox: BoxRenderable | null = null

const PLACEHOLDER_TEMPLATES = [
  "Enter your name",
  "Type your email",
  "Write a comment",
  "Your favorite color",
  "Add a note here",
]

function getLevelColor(depth: number) {
  const LEVEL_COLORS = ["#3b82f6", "#059669", "#f59e0b", "#e11d48"]
  return LEVEL_COLORS[(depth - 1) % LEVEL_COLORS.length]
}

function createNestedBox(depth: number, maxDepth: number): BoxRenderable {
  if (!renderer) throw new Error("No renderer")

  const levelColor = getLevelColor(depth)

  const box = new BoxRenderable(renderer, {
    zIndex: 0,
    width: "auto",
    height: "auto",
    borderStyle: "single",
    borderColor: levelColor,
    focusedBorderColor: levelColor,
    title: `Level ${depth}`,
    titleAlignment: "center",
    flexGrow: 1,
    backgroundColor: "transparent",
    border: true,
  })

  const inputCount = Math.floor(Math.random() * (MAX_INPUTS - MIN_INPUTS + 1)) + MIN_INPUTS
  for (let i = 0; i < inputCount; i++) {
    const placeholder = PLACEHOLDER_TEMPLATES[i % PLACEHOLDER_TEMPLATES.length]
    box.add(
      new InputRenderable(renderer, {
        placeholder: `${placeholder} (level ${depth})`,
        width: "auto",
        height: 1,
        backgroundColor: "#1e293b",
        focusedBackgroundColor: "#334155",
        textColor: levelColor,
        focusedTextColor: "#ffffff",
        placeholderColor: "#64748b",
        cursorColor: levelColor,
        maxLength: 100,
      }),
    )
  }

  if (depth < maxDepth) {
    const sublevelCount = Math.floor(Math.random() * (MAX_SUBLEVELS - MIN_SUBLEVELS + 1)) + MIN_SUBLEVELS
    for (let j = 0; j < sublevelCount; j++) {
      box.add(createNestedBox(depth + 1, maxDepth))
    }
  }

  return box
}

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#001122")

  parentContainer = createNestedBox(1, MAX_DEPTH)

  renderer.root.add(parentContainer)

  footerBox = new BoxRenderable(renderer, {
    width: "auto",
    height: 3,
    backgroundColor: "#1e40af",
    borderStyle: "single",
    borderColor: "#1d4ed8",
    border: true,
  })

  footer = new TextRenderable(renderer, {
    id: "footer",
    content: "TAB: focus next | SHIFT+TAB: focus prev | ESC: quit",
    fg: "#dbeafe",
    bg: "transparent",
    zIndex: 1,
    flexGrow: 1,
    flexShrink: 1,
  })

  footerBox.add(footer)
  renderer.root.add(footerBox)
}

export function destroy(rendererInstance: CliRenderer): void {
  if (parentContainer) {
    rendererInstance.root.remove(parentContainer.id)
    parentContainer.destroyRecursively()
  }

  if (footerBox) rendererInstance.root.remove(footerBox.id)

  parentContainer = null
  footer = null
  footerBox = null
  renderer = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
