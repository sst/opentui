import { TextAttributes, createCliRenderer, GroupRenderable, TextRenderable, BoxRenderable } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import type { CliRenderer } from "../index"

let globalKeyboardHandler: ((key: Buffer) => void) | null = null
let zIndexPhase = 0
let animationSpeed = 2000

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor("#001122")

  const parentContainer = new GroupRenderable("parent-container", {
    zIndex: 10,
    visible: true,
  })
  renderer.root.add(parentContainer)

  const title = new TextRenderable("main-title", {
    content: "Nested Render Objects & Z-Index Demo",
    positionType: "absolute",
    position: {
      left: 10,
      top: 2,
    },
    fg: "#FFFF00",
    attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
    zIndex: 1000,
  })
  parentContainer.add(title)

  // Parent group with high z-index
  const parentGroupA = new GroupRenderable("parent-group-a", {
    positionType: "absolute",
    zIndex: 100,
    visible: true,
  })
  parentContainer.add(parentGroupA)

  // Parent group with medium z-index
  const parentGroupB = new GroupRenderable("parent-group-b", {
    positionType: "absolute",
    zIndex: 50,
    visible: true,
  })
  parentContainer.add(parentGroupB)

  // Parent group with low z-index
  const parentGroupC = new GroupRenderable("parent-group-c", {
    positionType: "absolute",
    zIndex: 20,
    visible: true,
  })
  parentContainer.add(parentGroupC)

  // Group A - High Z-Index Parent (z=100)
  const boxA1 = new BoxRenderable("box-a1", {
    positionType: "absolute",
    position: {
      left: 15,
      top: 8,
    },
    width: 25,
    height: 6,
    bg: "#220044",
    zIndex: 10,
    borderStyle: "single",
    borderColor: "#FF44FF",
    title: "Parent A (z=100)",
    titleAlignment: "center",
  })
  parentGroupA.add(boxA1)

  const textA1 = new TextRenderable("text-a1", {
    content: "Child A1 (z=10)",
    positionType: "absolute",
    position: {
      left: 17,
      top: 10,
    },
    fg: "#FF44FF",
    attributes: TextAttributes.BOLD,
    zIndex: 10,
  })
  parentGroupA.add(textA1)

  const boxA2 = new BoxRenderable("box-a2", {
    positionType: "absolute",
    position: {
      left: 20,
      top: 11,
    },
    width: 15,
    height: 4,
    bg: "#440044",
    zIndex: 5,
    borderStyle: "single",
    borderColor: "#FF88FF",
  })
  parentGroupA.add(boxA2)

  const textA2 = new TextRenderable("text-a2", {
    content: "Child A2 (z=5)",
    positionType: "absolute",
    position: {
      left: 22,
      top: 12,
    },
    fg: "#FF88FF",
    zIndex: 5,
  })
  parentGroupA.add(textA2)

  // Group B - Medium Z-Index Parent (z=50)
  const boxB1 = new BoxRenderable("box-b1", {
    positionType: "absolute",
    position: {
      left: 30,
      top: 12,
    },
    width: 25,
    height: 6,
    bg: "#004422",
    zIndex: 20,
    borderStyle: "double",
    borderColor: "#44FF44",
    title: "Parent B (z=50)",
    titleAlignment: "center",
  })
  parentGroupB.add(boxB1)

  const textB1 = new TextRenderable("text-b1", {
    content: "Child B1 (z=20)",
    positionType: "absolute",
    position: {
      left: 32,
      top: 14,
    },
    fg: "#44FF44",
    attributes: TextAttributes.BOLD,
    zIndex: 20,
  })
  parentGroupB.add(textB1)

  const boxB2 = new BoxRenderable("box-b2", {
    positionType: "absolute",
    position: {
      left: 35,
      top: 15,
    },
    width: 15,
    height: 4,
    bg: "#004400",
    zIndex: 15,
    borderStyle: "single",
    borderColor: "#88FF88",
  })
  parentGroupB.add(boxB2)

  const textB2 = new TextRenderable("text-b2", {
    content: "Child B2 (z=15)",
    positionType: "absolute",
    position: {
      left: 37,
      top: 16,
    },
    fg: "#88FF88",
    zIndex: 15,
  })
  parentGroupB.add(textB2)

  // Group C - Low Z-Index Parent (z=20)
  const boxC1 = new BoxRenderable("box-c1", {
    positionType: "absolute",
    position: {
      left: 45,
      top: 16,
    },
    width: 25,
    height: 6,
    bg: "#442200",
    zIndex: 30,
    borderStyle: "rounded",
    borderColor: "#FFFF44",
    title: "Parent C (z=20)",
    titleAlignment: "center",
  })
  parentGroupC.add(boxC1)

  const textC1 = new TextRenderable("text-c1", {
    content: "Child C1 (z=30)",
    positionType: "absolute",
    position: {
      left: 47,
      top: 18,
    },
    fg: "#FFFF44",
    attributes: TextAttributes.BOLD,
    zIndex: 30,
  })
  parentGroupC.add(textC1)

  const boxC2 = new BoxRenderable("box-c2", {
    positionType: "absolute",
    position: {
      left: 50,
      top: 19,
    },
    width: 15,
    height: 4,
    bg: "#444400",
    zIndex: 25,
    borderStyle: "single",
    borderColor: "#FFFF88",
  })
  parentGroupC.add(boxC2)

  const textC2 = new TextRenderable("text-c2", {
    content: "Child C2 (z=25)",
    positionType: "absolute",
    position: {
      left: 52,
      top: 20,
    },
    fg: "#FFFF88",
    zIndex: 25,
  })
  parentGroupC.add(textC2)

  const explanation1 = new TextRenderable("explanation1", {
    content: "Key Concept: Parent z-index determines group layering, child z-index determines order within group",
    positionType: "absolute",
    position: {
      left: 10,
      top: 25,
    },
    fg: "#AAAAAA",
    zIndex: 1000,
  })
  parentContainer.add(explanation1)

  const explanation2 = new TextRenderable("explanation2", {
    content: "Even if Child C1 has z=30, it renders behind Parent A & B because Parent C has z=20",
    positionType: "absolute",
    position: {
      left: 10,
      top: 26,
    },
    fg: "#AAAAAA",
    zIndex: 1000,
  })
  parentContainer.add(explanation2)

  const phaseIndicator = new TextRenderable("phase-indicator", {
    content: "Animation Phase: 1/4",
    positionType: "absolute",
    position: {
      left: 10,
      top: 28,
    },
    fg: "#FFFFFF",
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  parentContainer.add(phaseIndicator)

  const zIndexDisplay = new TextRenderable("zindex-display", {
    content: "Current Z-Indices - A:100, B:50, C:20",
    positionType: "absolute",
    position: {
      left: 10,
      top: 29,
    },
    fg: "#FFFFFF",
    zIndex: 1000,
  })
  parentContainer.add(zIndexDisplay)

  renderer.setFrameCallback(async (deltaMs) => {
    const time = Date.now()
    const newPhase = Math.floor((time % (animationSpeed * 4)) / animationSpeed)

    if (newPhase !== zIndexPhase) {
      zIndexPhase = newPhase

      // Reset to original z-indices
      parentGroupA.zIndex = 100
      parentGroupB.zIndex = 50
      parentGroupC.zIndex = 20

      // Update box titles and colors based on phase
      switch (zIndexPhase) {
        case 0: // Original state
          parentGroupA.zIndex = 100
          parentGroupB.zIndex = 50
          parentGroupC.zIndex = 20
          boxA1.title = "Parent A (z=100)"
          boxB1.title = "Parent B (z=50)"
          boxC1.title = "Parent C (z=20)"
          break
        case 1: // C becomes highest
          parentGroupA.zIndex = 50
          parentGroupB.zIndex = 20
          parentGroupC.zIndex = 100
          boxA1.title = "Parent A (z=50)"
          boxB1.title = "Parent B (z=20)"
          boxC1.title = "Parent C (z=100)"
          break
        case 2: // B becomes highest
          parentGroupA.zIndex = 20
          parentGroupB.zIndex = 100
          parentGroupC.zIndex = 50
          boxA1.title = "Parent A (z=20)"
          boxB1.title = "Parent B (z=100)"
          boxC1.title = "Parent C (z=50)"
          break
        case 3: // All equal - shows child z-index importance
          parentGroupA.zIndex = 60
          parentGroupB.zIndex = 60
          parentGroupC.zIndex = 60
          boxA1.title = "Parent A (z=60)"
          boxB1.title = "Parent B (z=60)"
          boxC1.title = "Parent C (z=60)"
          break
      }

      const phases = ["Original Hierarchy", "C Group on Top", "B Group on Top", "Equal Parents (Child z-index matters)"]
      phaseIndicator.content = `Animation Phase: ${zIndexPhase + 1}/4 - ${phases[zIndexPhase]}`

      zIndexDisplay.content = `Current Z-Indices - A:${parentGroupA.zIndex}, B:${parentGroupB.zIndex}, C:${parentGroupC.zIndex}`
    }
  })

  globalKeyboardHandler = (key: Buffer) => {
    const keyStr = key.toString()

    if (keyStr === "+" || keyStr === "=") {
      animationSpeed = Math.max(500, animationSpeed - 200)
    } else if (keyStr === "-" || keyStr === "_") {
      animationSpeed = Math.min(5000, animationSpeed + 200)
    }
  }

  process.stdin.on("data", globalKeyboardHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (globalKeyboardHandler) {
    process.stdin.removeListener("data", globalKeyboardHandler)
    globalKeyboardHandler = null
  }

  renderer.root.remove("main-title")
  renderer.root.remove("parent-container")

  renderer.clearFrameCallbacks()
  renderer.setCursorPosition(0, 0, false)
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
