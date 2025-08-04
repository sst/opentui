import { TextAttributes, createCliRenderer, GroupRenderable, TextRenderable, BoxRenderable } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import type { CliRenderer } from "../index"

let globalKeyboardHandler: ((key: Buffer) => void) | null = null
let animationSpeed = 4000
let animationTime = 0

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor("#001122")

  const rootContainer = new GroupRenderable("root-container", {
    x: 0,
    y: 0,
    zIndex: 10,
    visible: true,
  })
  renderer.add(rootContainer)

  const title = new TextRenderable("main-title", {
    content: "Relative Positioning Demo - Child positions are relative to parent",
    x: 5,
    y: 1,
    fg: "#FFFF00",
    attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
    zIndex: 1000,
  })
  rootContainer.add(title)

  // Moving Parent Container A
  const parentContainerA = new GroupRenderable("parent-container-a", {
    x: 10,
    y: 5,
    zIndex: 50,
    visible: true,
  })
  rootContainer.add(parentContainerA)

  const parentBoxA = new BoxRenderable("parent-box-a", {
    x: 0,
    y: 0,
    width: 30,
    height: 12,
    bg: "#220044",
    zIndex: 1,
    borderStyle: "double",
    borderColor: "#FF44FF",
    title: "Parent A (moves in circle)",
    titleAlignment: "center",
  })
  parentContainerA.add(parentBoxA)

  const parentLabelA = new TextRenderable("parent-label-a", {
    content: "Parent A Position: (10, 5)",
    x: 2,
    y: 1,
    fg: "#FF44FF",
    attributes: TextAttributes.BOLD,
    zIndex: 2,
  })
  parentContainerA.add(parentLabelA)

  // Child objects in Parent A - these positions are relative to parent
  const childA1 = new BoxRenderable("child-a1", {
    x: 2,
    y: 3,
    width: 8,
    height: 3,
    bg: "#440066",
    zIndex: 2,
    borderStyle: "single",
    borderColor: "#FF88FF",
    title: "Child (2,3)",
    titleAlignment: "center",
  })
  parentContainerA.add(childA1)

  const childA2 = new BoxRenderable("child-a2", {
    x: 12,
    y: 3,
    width: 8,
    height: 3,
    bg: "#660044",
    zIndex: 2,
    borderStyle: "single",
    borderColor: "#FF88FF",
    title: "Child (12,3)",
    titleAlignment: "center",
  })
  parentContainerA.add(childA2)

  const childA3 = new BoxRenderable("child-a3", {
    x: 7,
    y: 7,
    width: 8,
    height: 3,
    bg: "#440044",
    zIndex: 2,
    borderStyle: "single",
    borderColor: "#FF88FF",
    title: "Child (7,7)",
    titleAlignment: "center",
  })
  parentContainerA.add(childA3)

  // Moving Parent Container B
  const parentContainerB = new GroupRenderable("parent-container-b", {
    x: 50,
    y: 8,
    zIndex: 50,
    visible: true,
  })
  rootContainer.add(parentContainerB)

  const parentBoxB = new BoxRenderable("parent-box-b", {
    x: 0,
    y: 0,
    width: 40,
    height: 10,
    bg: "#004422",
    zIndex: 1,
    borderStyle: "rounded",
    borderColor: "#44FF44",
    title: "Parent B (moves vertically)",
    titleAlignment: "center",
  })
  parentContainerB.add(parentBoxB)

  const parentLabelB = new TextRenderable("parent-label-b", {
    content: "Parent B Position: (50, 8)",
    x: 2,
    y: 1,
    fg: "#44FF44",
    attributes: TextAttributes.BOLD,
    zIndex: 2,
  })
  parentContainerB.add(parentLabelB)

  // Child objects in Parent B
  const childB1 = new TextRenderable("child-b1", {
    content: "Child at (1,3) - relative to parent",
    x: 1,
    y: 3,
    fg: "#88FF88",
    zIndex: 2,
  })
  parentContainerB.add(childB1)

  const childB2 = new TextRenderable("child-b2", {
    content: "Child at (1,5) - relative to parent",
    x: 1,
    y: 5,
    fg: "#88FF88",
    zIndex: 2,
  })
  parentContainerB.add(childB2)

  const staticContainer = new GroupRenderable("static-container", {
    x: 5,
    y: 20,
    zIndex: 50,
    visible: true,
  })
  rootContainer.add(staticContainer)

  const staticBox = new BoxRenderable("static-box", {
    x: 0,
    y: 0,
    width: 40,
    height: 8,
    bg: "#442200",
    zIndex: 1,
    borderStyle: "single",
    borderColor: "#FFFF44",
    title: "Static Parent (doesn't move)",
    titleAlignment: "center",
  })
  staticContainer.add(staticBox)

  const staticChild1 = new TextRenderable("static-child1", {
    content: "Static child at (2,2) - never moves",
    x: 2,
    y: 2,
    fg: "#FFFF88",
    zIndex: 2,
  })
  staticContainer.add(staticChild1)

  const staticChild2 = new TextRenderable("static-child2", {
    content: "Static child at (2,4) - never moves",
    x: 2,
    y: 4,
    fg: "#FFFF88",
    zIndex: 2,
  })
  staticContainer.add(staticChild2)

  const explanation1 = new TextRenderable("explanation1", {
    content: "Key Concept: Child object coordinates are RELATIVE to their parent's position",
    x: 5,
    y: 30,
    fg: "#AAAAAA",
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  rootContainer.add(explanation1)

  const explanation2 = new TextRenderable("explanation2", {
    content: "When parent moves, children move with it while keeping their relative positions",
    x: 5,
    y: 31,
    fg: "#AAAAAA",
    zIndex: 1000,
  })
  rootContainer.add(explanation2)

  const explanation3 = new TextRenderable("explanation3", {
    content: "Child at (2,3) in a parent at (10,5) appears at screen position (12,8)",
    x: 5,
    y: 32,
    fg: "#AAAAAA",
    zIndex: 1000,
  })
  rootContainer.add(explanation3)

  const controls = new TextRenderable("controls", {
    content: "Controls: +/- to change animation speed",
    x: 5,
    y: 34,
    fg: "#FFFFFF",
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  rootContainer.add(controls)

  const speedDisplay = new TextRenderable("speed-display", {
    content: `Animation Speed: ${animationSpeed}ms (min: 500, max: 8000)`,
    x: 5,
    y: 35,
    fg: "#CCCCCC",
    zIndex: 1000,
  })
  rootContainer.add(speedDisplay)

  renderer.setFrameCallback(async (deltaMs) => {
    animationTime += deltaMs

    const circleRadius = 15
    const circleSpeed = (animationTime / animationSpeed) * Math.PI * 2
    const parentAX = 20 + Math.cos(circleSpeed) * circleRadius
    const parentAY = 8 + (Math.sin(circleSpeed) * circleRadius) / 2

    parentContainerA.x = Math.round(parentAX)
    parentContainerA.y = Math.round(parentAY)

    parentLabelA.content = `Parent A Position: (${parentContainerA.x}, ${parentContainerA.y})`

    const verticalSpeed = (animationTime / (animationSpeed * 1.5)) * Math.PI * 2
    const parentBY = 8 + Math.sin(verticalSpeed) * 8

    parentContainerB.y = Math.round(parentBY)
    parentLabelB.content = `Parent B Position: (${parentContainerB.x}, ${parentContainerB.y})`

    const absoluteChildA1X = parentContainerA.x + 2
    const absoluteChildA1Y = parentContainerA.y + 3
    childA1.title = `Child (2,3) -> Abs(${absoluteChildA1X},${absoluteChildA1Y})`
  })

  globalKeyboardHandler = (key: Buffer) => {
    const keyStr = key.toString()

    if (keyStr === "+" || keyStr === "=") {
      animationSpeed = Math.max(500, animationSpeed - 300)
      speedDisplay.content = `Animation Speed: ${animationSpeed}ms (min: 500, max: 8000)`
    } else if (keyStr === "-" || keyStr === "_") {
      animationSpeed = Math.min(8000, animationSpeed + 300)
      speedDisplay.content = `Animation Speed: ${animationSpeed}ms (min: 500, max: 8000)`
    }
  }

  process.stdin.on("data", globalKeyboardHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (globalKeyboardHandler) {
    process.stdin.removeListener("data", globalKeyboardHandler)
    globalKeyboardHandler = null
  }

  renderer.remove("root-container")

  renderer.clearFrameCallbacks()
  renderer.setCursorPosition(0, 0, false)
  animationTime = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
