import {
  TextAttributes,
  rgbToHex,
  hsvToRgb,
  createCliRenderer,
  GroupRenderable,
  TextRenderable,
  BoxRenderable,
  parseColor,
  getBorderFromSides,
} from "../index"
import type { BorderCharacters, BorderSidesConfig, CliRenderer } from "../index"
import { TabControllerElement } from "../ui/elements/tab-controller"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let globalTabController: TabControllerElement | null = null
let globalKeyboardHandler: ((key: Buffer) => void) | null = null

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.setBackgroundColor("#000028")

  const tabController = new TabControllerElement("main-tab-controller", renderer, {
    x: 0,
    y: 0,
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
    zIndex: 0,
  })
  globalTabController = tabController
  renderer.add(tabController)

  // Tab: Text & Attributes
  const wheelRadius = 7
  const wheelCenterX = 70
  const wheelCenterY = 15
  let activeWheelPixels = new Set<string>()

  tabController.addTab({
    title: "Text & Attributes",
    init: (tabGroup) => {
      const textTitle = new TextRenderable("text-title", {
        content: "Text Styling & Color Gradients",
        x: 10,
        y: 5,
        fg: "#FFFF00",
        attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(textTitle)

      // Text attributes
      const attrBold = new TextRenderable("attr-bold", {
        content: "Bold Text",
        x: 10,
        y: 8,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(attrBold)

      const attrItalic = new TextRenderable("attr-italic", {
        content: "Italic Text",
        x: 10,
        y: 9,
        fg: "#FFFFFF",
        attributes: TextAttributes.ITALIC,
        zIndex: 10,
      })
      tabGroup.add(attrItalic)

      const attrUnderline = new TextRenderable("attr-underline", {
        content: "Underlined Text",
        x: 10,
        y: 10,
        fg: "#FFFFFF",
        attributes: TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(attrUnderline)

      const attrDim = new TextRenderable("attr-dim", {
        content: "Dim Text",
        x: 10,
        y: 11,
        fg: "#FFFFFF",
        attributes: TextAttributes.DIM,
        zIndex: 10,
      })
      tabGroup.add(attrDim)

      const attrCombined = new TextRenderable("attr-combined", {
        content: "Bold + Italic + Underline",
        x: 10,
        y: 12,
        fg: "#FF6464",
        attributes: TextAttributes.BOLD | TextAttributes.ITALIC | TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(attrCombined)

      // Color gradient
      const gradientTitle = new TextRenderable("gradient-title", {
        content: "Rainbow Gradient:",
        x: 10,
        y: 15,
        fg: "#CCCCCC",
        zIndex: 10,
      })
      tabGroup.add(gradientTitle)

      for (let i = 0; i < 40; i++) {
        const hue = (i / 40) * 360
        const color = hsvToRgb(hue, 1, 1)
        const hexColor = rgbToHex(color)

        const gradientPixel = new TextRenderable(`gradient-${i}`, {
          content: "█",
          x: 10 + i,
          y: 17,
          fg: hexColor,
          zIndex: 10,
        })
        tabGroup.add(gradientPixel)
      }
    },
    update: (deltaMs: number, tabGroup: GroupRenderable) => {
      // Animate the rotating color wheel
      const time = Date.now() / 1000
      const rotationSpeed = 45 // degrees per second
      const rotationAngle = (time * rotationSpeed) % 360
      const rotationRadians = rotationAngle * (Math.PI / 180)

      // Track new wheel pixels for this frame
      const newWheelPixels = new Set<string>()

      for (let y = wheelCenterY - wheelRadius; y <= wheelCenterY + wheelRadius; y++) {
        for (let x = wheelCenterX - wheelRadius * 2; x <= wheelCenterX + wheelRadius * 2; x++) {
          const dx = (x - wheelCenterX) / 2 // Adjust for terminal character aspect ratio
          const dy = y - wheelCenterY
          const distance = Math.sqrt(dx * dx + dy * dy)

          if (distance <= wheelRadius) {
            const angle = Math.atan2(dy, dx)
            const rotatedAngle = angle + rotationRadians
            const hue = ((rotatedAngle / Math.PI) * 180 + 180) % 360
            const saturation = distance / wheelRadius
            const color = hsvToRgb(hue, saturation, 1)

            const pixelId = `wheel-${x}-${y}`
            newWheelPixels.add(pixelId)

            const existingPixel = tabGroup.getRenderable(pixelId) as TextRenderable
            if (existingPixel) {
              existingPixel.content = "█"
              existingPixel.x = x
              existingPixel.y = y
              existingPixel.fg = color
            } else {
              const wheelPixel = new TextRenderable(pixelId, {
                content: "█",
                x: x,
                y: y,
                fg: color,
                zIndex: 10,
              })
              tabGroup.add(wheelPixel)
              activeWheelPixels.add(pixelId)
            }
          }
        }
      }

      // Remove any wheel pixels that are no longer part of the wheel
      for (const pixelId of activeWheelPixels) {
        if (!newWheelPixels.has(pixelId)) {
          tabGroup.remove(pixelId)
          activeWheelPixels.delete(pixelId)
        }
      }

      activeWheelPixels = newWheelPixels
    },
    show: () => {
      activeWheelPixels.clear()
    },
    hide: () => {
      for (const pixelId of activeWheelPixels) {
        renderer.remove(pixelId)
      }
      activeWheelPixels.clear()
    },
  })

  // Tab: Basics
  tabController.addTab({
    title: "Basics",
    init: (tabGroup) => {
      const title = new TextRenderable("opentui-title", {
        content: "Basic CLI Renderer Demo",
        x: 10,
        y: 5,
        fg: "#FFFF00",
        attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(title)

      const box1 = new BoxRenderable("box1", {
        x: 10,
        y: 8,
        width: 20,
        height: 8,
        bg: "#333366",
        zIndex: 0,
        borderStyle: "single",
        borderColor: "#FFFFFF",
      })
      tabGroup.add(box1)

      const box1Title = new TextRenderable("box1-title", {
        content: "Simple Box",
        x: 12,
        y: 10,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(box1Title)

      const box2 = new BoxRenderable("box2", {
        x: 35,
        y: 10,
        width: 25,
        height: 6,
        bg: "#663333",
        zIndex: 1,
        borderStyle: "double",
        borderColor: "#FFFF00",
      })
      tabGroup.add(box2)

      const box2Title = new TextRenderable("box2-title", {
        content: "Double Border Box",
        x: 37,
        y: 12,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(box2Title)

      const description = new TextRenderable("description", {
        content: "This tab demonstrates basic box and text rendering with different border styles.",
        x: 10,
        y: 18,
        fg: "#CCCCCC",
        zIndex: 10,
      })
      tabGroup.add(description)

      const cursorInfo = new TextRenderable("cursor-info", {
        content: "Cursor: (0,0) - Style: block",
        x: 10,
        y: 20,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(cursorInfo)
    },
    update: (deltaMs: number, tabGroup: GroupRenderable) => {
      // Update cursor position (make it move in a small circle)
      const cursorTime = Date.now() / 1000
      const cursorX = 15 + Math.floor(3 * Math.cos(cursorTime))
      const cursorY = 13 + Math.floor(2 * Math.sin(cursorTime))

      // Change cursor style every few seconds
      const cursorStyleIndex = Math.floor(cursorTime / 2) % 6
      let cursorStyle: "block" | "line" | "underline" = "block"
      let cursorBlinking = false

      switch (cursorStyleIndex) {
        case 0:
          cursorStyle = "block"
          cursorBlinking = false
          break
        case 1:
          cursorStyle = "block"
          cursorBlinking = true
          break
        case 2:
          cursorStyle = "line"
          cursorBlinking = false
          break
        case 3:
          cursorStyle = "line"
          cursorBlinking = true
          break
        case 4:
          cursorStyle = "underline"
          cursorBlinking = false
          break
        case 5:
          cursorStyle = "underline"
          cursorBlinking = true
          break
      }

      renderer.setCursorStyle(cursorStyle, cursorBlinking)
      renderer.setCursorPosition(cursorX, cursorY)

      // Display cursor position and style info
      const cursorInfo = tabGroup.getRenderable("cursor-info") as TextRenderable
      if (cursorInfo) {
        cursorInfo.content = `Cursor: (${cursorX},${cursorY}) - Style: ${cursorStyle}${cursorBlinking ? " (blinking)" : ""}`
      }
    },
    show: () => {
      renderer.setCursorPosition(15, 13, true)
    },
    hide: () => {
      renderer.setCursorPosition(0, 0, false)
    },
  })

  // Tab: Borders
  let partialBorderPhase = 0
  tabController.addTab({
    title: "Borders",
    init: (tabGroup) => {
      const borderTitle = new TextRenderable("border-title", {
        content: "Border Styles & Partial Borders",
        x: 10,
        y: 5,
        fg: "#FFFF00",
        attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(borderTitle)

      // Different border styles
      const singleBox = new BoxRenderable("single-box", {
        x: 10,
        y: 8,
        width: 15,
        height: 5,
        bg: "#222244",
        zIndex: 0,
        borderStyle: "single",
        borderColor: "#FFFFFF",
      })
      tabGroup.add(singleBox)
      const singleLabel = new TextRenderable("single-label", {
        content: "Single",
        x: 12,
        y: 10,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(singleLabel)

      const doubleBox = new BoxRenderable("double-box", {
        x: 30,
        y: 8,
        width: 15,
        height: 5,
        bg: "#442222",
        zIndex: 0,
        borderStyle: "double",
        borderColor: "#FFFFFF",
      })
      tabGroup.add(doubleBox)
      const doubleLabel = new TextRenderable("double-label", {
        content: "Double",
        x: 32,
        y: 10,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(doubleLabel)

      const roundedBox = new BoxRenderable("rounded-box", {
        x: 50,
        y: 8,
        width: 15,
        height: 5,
        bg: "#224422",
        zIndex: 0,
        borderStyle: "rounded",
        borderColor: "#FFFFFF",
      })
      tabGroup.add(roundedBox)
      const roundedLabel = new TextRenderable("rounded-label", {
        content: "Rounded",
        x: 52,
        y: 10,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(roundedLabel)

      // Partial borders
      const partialTitle = new TextRenderable("partial-title", {
        content: "Partial Borders:",
        x: 10,
        y: 15,
        fg: "#CCCCCC",
        attributes: TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(partialTitle)

      const partialLeft = new BoxRenderable("partial-left", {
        x: 10,
        y: 17,
        width: 12,
        height: 4,
        bg: "#222244",
        zIndex: 0,
        borderStyle: "single",
        borderColor: "#FFFFFF",
        border: ["left"],
      })
      tabGroup.add(partialLeft)
      const partialLeftLabel = new TextRenderable("partial-left-label", {
        content: "Left Only",
        x: 12,
        y: 18,
        fg: "#FFFFFF",
        zIndex: 10,
      })
      tabGroup.add(partialLeftLabel)

      const partialAnimated = new BoxRenderable("partial-animated", {
        x: 30,
        y: 17,
        width: 20,
        height: 4,
        bg: "#334455",
        zIndex: 0,
        borderStyle: "single",
        borderColor: "#FFFFFF",
      })
      tabGroup.add(partialAnimated)
      const partialAnimatedLabel = new TextRenderable("partial-animated-label", {
        content: "Animated Borders",
        x: 32,
        y: 18,
        fg: "#FFFFFF",
        zIndex: 10,
      })
      tabGroup.add(partialAnimatedLabel)

      const partialPhase = new TextRenderable("partial-phase", {
        content: "Phase: 1/8",
        x: 30,
        y: 22,
        fg: "#AAAAAA",
        zIndex: 10,
      })
      tabGroup.add(partialPhase)

      const customBorderTitle = new TextRenderable("custom-border-title", {
        content: "Custom Border Characters:",
        x: 10,
        y: 25,
        fg: "#CCCCCC",
        attributes: TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(customBorderTitle)

      const asciiBorders: BorderCharacters = {
        topLeft: "+",
        topRight: "+",
        bottomLeft: "+",
        bottomRight: "+",
        horizontal: "-",
        vertical: "|",
        topT: "+",
        bottomT: "+",
        leftT: "+",
        rightT: "+",
        cross: "+",
      }

      const blockBorders: BorderCharacters = {
        topLeft: "█",
        topRight: "█",
        bottomLeft: "█",
        bottomRight: "█",
        horizontal: "█",
        vertical: "█",
        topT: "█",
        bottomT: "█",
        leftT: "█",
        rightT: "█",
        cross: "█",
      }

      const starBorders: BorderCharacters = {
        topLeft: "*",
        topRight: "*",
        bottomLeft: "*",
        bottomRight: "*",
        horizontal: "*",
        vertical: "*",
        topT: "*",
        bottomT: "*",
        leftT: "*",
        rightT: "*",
        cross: "*",
      }

      const asciiBox = new BoxRenderable("ascii-box", {
        x: 10,
        y: 27,
        width: 15,
        height: 5,
        bg: "#222244",
        zIndex: 0,
        borderStyle: "single",
        borderColor: "#FFFFFF",
        customBorderChars: asciiBorders,
      })
      tabGroup.add(asciiBox)
      const asciiLabel = new TextRenderable("ascii-label", {
        content: "ASCII Border",
        x: 12,
        y: 29,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(asciiLabel)

      const blockBox = new BoxRenderable("block-box", {
        x: 30,
        y: 27,
        width: 15,
        height: 5,
        bg: "#442222",
        zIndex: 0,
        borderStyle: "single",
        borderColor: "#FFFFFF",
        customBorderChars: blockBorders,
      })
      tabGroup.add(blockBox)
      const blockLabel = new TextRenderable("block-label", {
        content: "Block Border",
        x: 32,
        y: 29,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(blockLabel)

      const starBox = new BoxRenderable("star-box", {
        x: 50,
        y: 27,
        width: 15,
        height: 5,
        bg: "#224422",
        zIndex: 0,
        borderStyle: "single",
        borderColor: "#FFFFFF",
        customBorderChars: starBorders,
      })
      tabGroup.add(starBox)
      const starLabel = new TextRenderable("star-label", {
        content: "Star Border",
        x: 52,
        y: 29,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(starLabel)
    },
    update: (deltaMs: number, tabGroup: GroupRenderable) => {
      // Animate partial borders
      const time = Date.now() / 1000
      const phase = Math.floor(time % 8)

      if (phase !== partialBorderPhase) {
        partialBorderPhase = phase

        const borderSides: BorderSidesConfig = {
          top: [0, 3, 5, 7].includes(phase),
          right: [1, 3, 6, 7].includes(phase),
          bottom: [2, 3, 5, 7].includes(phase),
          left: [4, 5, 6, 7].includes(phase),
        }

        const partialAnimatedBox = tabGroup.getRenderable("partial-animated") as BoxRenderable
        if (partialAnimatedBox) {
          partialAnimatedBox.border = getBorderFromSides(borderSides)
          partialAnimatedBox.borderStyle = "single"
        }

        const partialPhaseText = tabGroup.getRenderable("partial-phase") as TextRenderable
        if (partialPhaseText) {
          partialPhaseText.content = `Phase: ${phase + 1}/8`
        }
      }
    },
  })

  // Tab: Animation
  let animPosition = 5
  let animDirection = 1
  let animSpeed = 15
  tabController.addTab({
    title: "Animation",
    init: (tabGroup) => {
      const animTitle = new TextRenderable("anim-title", {
        content: "Animation Demonstrations",
        x: 10,
        y: 5,
        fg: "#FFFF00",
        attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(animTitle)

      const movingText = new TextRenderable("moving-text", {
        content: "Moving Text",
        x: animPosition,
        y: 8,
        fg: "#00FF00",
        attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(movingText)

      const animatedBox = new BoxRenderable("animated-box", {
        x: animPosition,
        y: 10,
        width: 10,
        height: 3,
        bg: "#550055",
        zIndex: 0,
        borderStyle: "rounded",
        borderColor: "#FF00FF",
      })
      tabGroup.add(animatedBox)

      const colorBox = new BoxRenderable("color-box", {
        x: 50,
        y: 12,
        width: 18,
        height: 5,
        bg: "#550055",
        zIndex: 0,
        borderStyle: "double",
        borderColor: "#FFFFFF",
      })
      tabGroup.add(colorBox)

      const colorBoxTitle = new TextRenderable("color-box-title", {
        content: "Animated Color",
        x: 52,
        y: 14,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(colorBoxTitle)
    },
    update: (deltaMs: number, tabGroup: GroupRenderable) => {
      // Animate moving elements
      const deltaTime = Math.min(deltaMs / 1000, 0.1)
      animPosition += animSpeed * animDirection * deltaTime

      if (animPosition > 40) {
        animPosition = 40
        animDirection = -1
      } else if (animPosition < 5) {
        animPosition = 5
        animDirection = 1
      }

      const x = Math.round(animPosition)

      const movingText = tabGroup.getRenderable("moving-text") as TextRenderable
      if (movingText) {
        movingText.x = x
      }

      const animatedBox = tabGroup.getRenderable("animated-box") as BoxRenderable
      if (animatedBox) {
        animatedBox.x = x
      }

      // Animate color-changing box
      const time = Date.now() / 1000
      const hue = (time * 30) % 360
      const color = hsvToRgb(hue, 1, 0.7)
      const hexColor = rgbToHex(color)

      const colorBox = tabGroup.getRenderable("color-box") as BoxRenderable
      if (colorBox) {
        colorBox._bg = parseColor(hexColor)
      }
    },
  })

  // Tab: Titles
  tabController.addTab({
    title: "Titles",
    init: (tabGroup) => {
      const layoutTitle = new TextRenderable("layout-title", {
        content: "Box Titles",
        x: 10,
        y: 5,
        fg: "#FFFF00",
        attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(layoutTitle)

      // Boxes with titles and different alignments
      const titledLeft = new BoxRenderable("titled-left", {
        x: 10,
        y: 8,
        width: 20,
        height: 5,
        bg: "#222244",
        zIndex: 0,
        borderStyle: "single",
        borderColor: "#FFFFFF",
        title: "Left Aligned",
        titleAlignment: "left",
      })
      tabGroup.add(titledLeft)

      const titledCenter = new BoxRenderable("titled-center", {
        x: 35,
        y: 8,
        width: 20,
        height: 5,
        bg: "#442222",
        zIndex: 0,
        borderStyle: "double",
        borderColor: "#FFFFFF",
        title: "Centered Title",
        titleAlignment: "center",
      })
      tabGroup.add(titledCenter)

      const titledRight = new BoxRenderable("titled-right", {
        x: 60,
        y: 8,
        width: 20,
        height: 5,
        bg: "#224422",
        zIndex: 0,
        borderStyle: "rounded",
        borderColor: "#FFFFFF",
        title: "Right Aligned",
        titleAlignment: "right",
      })
      tabGroup.add(titledRight)
    },
  })

  // Tab: Interactive
  const interactiveBorderSides = {
    top: true,
    right: true,
    bottom: true,
    left: true,
  }

  tabController.addTab({
    title: "Interactive",
    init: (tabGroup) => {
      const interactiveTitle = new TextRenderable("interactive-title", {
        content: "Interactive Controls",
        x: 10,
        y: 5,
        fg: "#FFFF00",
        attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(interactiveTitle)

      const interactiveBorder = new BoxRenderable("interactive-border", {
        x: 15,
        y: 8,
        width: 40,
        height: 8,
        bg: "#333344",
        zIndex: 0,
        borderStyle: "double",
        borderColor: "#FFFFFF",
      })
      tabGroup.add(interactiveBorder)

      const interactiveLabel = new TextRenderable("interactive-label", {
        content: "Press keys to toggle borders",
        x: 22,
        y: 12,
        fg: "#FFFFFF",
        attributes: TextAttributes.BOLD,
        zIndex: 10,
      })
      tabGroup.add(interactiveLabel)

      const interactiveInstructions = new TextRenderable("interactive-instructions", {
        content: "Keyboard Controls:",
        x: 10,
        y: 18,
        fg: "#FFFFFF",
        attributes: TextAttributes.UNDERLINE,
        zIndex: 10,
      })
      tabGroup.add(interactiveInstructions)

      const keyT = new TextRenderable("key-t", {
        content: "T - Toggle top border",
        x: 10,
        y: 19,
        fg: "#CCCCCC",
        zIndex: 10,
      })
      tabGroup.add(keyT)

      const keyR = new TextRenderable("key-r", {
        content: "R - Toggle right border",
        x: 10,
        y: 20,
        fg: "#CCCCCC",
        zIndex: 10,
      })
      tabGroup.add(keyR)

      const keyB = new TextRenderable("key-b", {
        content: "B - Toggle bottom border",
        x: 10,
        y: 21,
        fg: "#CCCCCC",
        zIndex: 10,
      })
      tabGroup.add(keyB)

      const keyL = new TextRenderable("key-l", {
        content: "L - Toggle left border",
        x: 10,
        y: 22,
        fg: "#CCCCCC",
        zIndex: 10,
      })
      tabGroup.add(keyL)

      const borderState = new TextRenderable("border-state", {
        content: "Active borders: All",
        x: 10,
        y: 24,
        fg: "#AAAAAA",
        zIndex: 10,
      })
      tabGroup.add(borderState)
    },
    update: (deltaMs: number, tabGroup: GroupRenderable) => {
      // Update interactive border state
      const interactiveBorder = tabGroup.getRenderable("interactive-border") as BoxRenderable
      if (interactiveBorder) {
        interactiveBorder.border = getBorderFromSides(interactiveBorderSides)
      }

      let borderDesc = ""
      if (interactiveBorderSides.top) borderDesc += "Top "
      if (interactiveBorderSides.right) borderDesc += "Right "
      if (interactiveBorderSides.bottom) borderDesc += "Bottom "
      if (interactiveBorderSides.left) borderDesc += "Left "
      if (!borderDesc) borderDesc = "None"

      const borderState = tabGroup.getRenderable("border-state") as TextRenderable
      if (borderState) {
        borderState.content = `Active borders: ${borderDesc}`
      }
    },
  })

  tabController.focus()

  globalKeyboardHandler = (key: Buffer) => {
    const keyStr = key.toString()

    // Interactive border controls (only active in Interactive tab)
    if (tabController.getCurrentTab().title === "Interactive") {
      if (keyStr === "t" || keyStr === "T") {
        interactiveBorderSides.top = !interactiveBorderSides.top
      } else if (keyStr === "r" || keyStr === "R") {
        interactiveBorderSides.right = !interactiveBorderSides.right
      } else if (keyStr === "b" || keyStr === "B") {
        interactiveBorderSides.bottom = !interactiveBorderSides.bottom
      } else if (keyStr === "l" || keyStr === "L") {
        interactiveBorderSides.left = !interactiveBorderSides.left
      }
    }
  }

  process.stdin.on("data", globalKeyboardHandler)
}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()

  if (globalKeyboardHandler) {
    process.stdin.removeListener("data", globalKeyboardHandler)
    globalKeyboardHandler = null
  }

  if (globalTabController) {
    renderer.remove(globalTabController.id)
    globalTabController = null
  }

  renderer.setCursorPosition(0, 0, false)
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
