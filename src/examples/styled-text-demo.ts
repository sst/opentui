import {
  CliRenderer,
  createCliRenderer,
  t,
  blue,
  bold,
  underline,
  red,
  green,
  bgYellow,
  fg,
  GroupRenderable,
} from "../index"
import type { StyledTextRenderable } from "../objects"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let renderer: CliRenderer | null = null
let parentContainer: GroupRenderable | null = null
let counter = 0
let frameCallback: ((deltaTime: number) => Promise<void>) | null = null

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.start()
  renderer.setBackgroundColor("#001122")

  parentContainer = new GroupRenderable("styled-text-container", {
    x: 0,
    y: 0,
    zIndex: 15,
    visible: true,
  })
  renderer.add(parentContainer)

  counter = 0

  // Example 1
  const houseText = t`  
There's a ${underline(blue("house"))},
With a ${bold(blue("window"))},
And a ${blue("corvette")}
And everything is blue`

  const houseDisplay = renderer.createStyledText("house-text", {
    fragment: houseText,
    width: 30,
    height: 6,
    x: 2,
    y: 2,
    zIndex: 1,
  })
  parentContainer.add(houseDisplay)

  // Example 2
  const statusText = t`${bold(red("ERROR:"))} Connection failed
${bold(green("SUCCESS:"))} Data loaded
${bold(fg("#FFA500")("WARNING:"))} Low memory
${bgYellow(fg("black")(" NOTICE "))} System update available`

  const statusDisplay = renderer.createStyledText("status-text", {
    fragment: statusText,
    width: 50,
    height: 6,
    x: 2,
    y: 8,
    zIndex: 1,
  })
  parentContainer.add(statusDisplay)

  // Example 3
  frameCallback = async (deltaTime) => {
    counter++

    if (counter % 60 === 0) {
      // Update every second
      const dynamicText = t`${bold("Frame:")} ${counter}
${blue("Time:")} ${(counter / 60).toFixed(1)}s
${underline("Dynamic:")} ${bold(fg("#FF6B6B")(Math.sin(counter * 0.1) > 0 ? "UP" : "DOWN"))}`

      const dynamicDisplay = parentContainer?.getRenderable("dynamic-text") as StyledTextRenderable
      if (dynamicDisplay) {
        dynamicDisplay.fragment = dynamicText
      } else {
        const newDynamicDisplay = renderer!.createStyledText("dynamic-text", {
          fragment: dynamicText,
          width: 40,
          height: 4,
          x: 2,
          y: 15,
          zIndex: 1,
        })
        parentContainer?.add(newDynamicDisplay)
      }
    }
  }

  renderer.setFrameCallback(frameCallback)

  const instructionsText = t`${bold("Styled Text Demo")}
${fg("#888")("ESC to return")}

${underline("Features demonstrated:")}
• Template literals with ${blue("colors")}
• ${bold("Bold")}, ${underline("underlined")}, and other styles
• Background colors like ${bgYellow(fg("black")("this"))}
• Custom hex colors like ${fg("#FF6B6B")("this red")}
• Dynamic updates`

  const instructionsDisplay = renderer.createStyledText("instructions", {
    fragment: instructionsText,
    width: 60,
    height: 12,
    x: 40,
    y: 2,
    zIndex: 1,
    defaultFg: "#CCCCCC",
  })
  parentContainer.add(instructionsDisplay)

  // Examples showing number and boolean support
  const typesText = t`${bold("Type Examples:")}
Number: ${green(42)}
Boolean: ${red(true)}
Float: ${blue((3.14159).toFixed(2))}
Calculated: ${fg("#00FFFF")(Math.floor(Math.random() * 100))}`

  const typesDisplay = renderer.createStyledText("types-text", {
    fragment: typesText,
    width: 30,
    height: 6,
    x: 2,
    y: 20,
    zIndex: 1,
  })
  parentContainer.add(typesDisplay)

  renderer.needsUpdate = true
}

export function destroy(rendererInstance: CliRenderer): void {
  if (frameCallback) {
    rendererInstance.removeFrameCallback(frameCallback)
    frameCallback = null
  }

  if (parentContainer) {
    rendererInstance.remove("styled-text-container")
    parentContainer = null
  }

  counter = 0
  renderer = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
