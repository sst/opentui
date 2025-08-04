#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  TextRenderable,
  BoxRenderable,
  StyledTextRenderable,
  GroupRenderable,
  t,
  red,
  green,
  blue,
  bold,
  italic,
  yellow,
  cyan,
  magenta,
} from ".."
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let mainContainer: BoxRenderable | null = null
let leftGroup: GroupRenderable | null = null
let rightGroup: GroupRenderable | null = null
let statusBox: BoxRenderable | null = null
let statusText: TextRenderable | null = null
let selectionStartText: TextRenderable | null = null
let selectionMiddleText: TextRenderable | null = null
let selectionEndText: TextRenderable | null = null
let debugText: TextRenderable | null = null
let allTextRenderables: (TextRenderable | StyledTextRenderable)[] = []

export function run(renderer: CliRenderer): void {
  renderer.setBackgroundColor("#0d1117")

  mainContainer = new BoxRenderable("mainContainer", {
    x: 1,
    y: 1,
    width: 88,
    height: 22,
    bg: "#161b22",
    zIndex: 1,
    borderColor: "#50565d",
    title: "Text Selection Demo",
    titleAlignment: "center",
  })
  renderer.add(mainContainer)

  leftGroup = new GroupRenderable("leftGroup", {
    x: 2,
    y: 2,
    zIndex: 10,
  })
  mainContainer.add(leftGroup)

  const box1 = new BoxRenderable("box1", {
    x: 0,
    y: 0,
    width: 45,
    height: 7,
    bg: "#1e2936",
    zIndex: 20,
    borderColor: "#58a6ff",
    title: "Document Section 1",
  })
  leftGroup.add(box1)

  const text1 = new TextRenderable("text1", {
    content: "This is a paragraph in the first box.",
    x: 2,
    y: 2,
    zIndex: 21,
    fg: "#f0f6fc",
  })
  leftGroup.add(text1)
  allTextRenderables.push(text1)

  const text2 = new TextRenderable("text2", {
    content: "It contains multiple lines of text",
    x: 2,
    y: 3,
    zIndex: 21,
    fg: "#f0f6fc",
  })
  leftGroup.add(text2)
  allTextRenderables.push(text2)

  const text3 = new TextRenderable("text3", {
    content: "that can be selected independently.",
    x: 2,
    y: 4,
    zIndex: 21,
    fg: "#f0f6fc",
  })
  leftGroup.add(text3)
  allTextRenderables.push(text3)

  const nestedBox = new BoxRenderable("nestedBox", {
    x: 2,
    y: 8,
    width: 31,
    height: 4,
    bg: "#2d1b69",
    zIndex: 25,
    borderColor: "#a371f7",
    borderStyle: "double",
  })
  leftGroup.add(nestedBox)

  const nestedText = renderer.createStyledText("nestedText", {
    fragment: t`${yellow("Important:")} ${bold(cyan("Nested content"))} ${italic(green("with styles"))}`,
    x: 4,
    y: 10,
    width: 27,
    height: 1,
    zIndex: 26,
    selectionBg: "#4a5568",
    selectionFg: "#ffffff",
  })
  leftGroup.add(nestedText)
  allTextRenderables.push(nestedText)

  rightGroup = new GroupRenderable("rightGroup", {
    x: 48,
    y: 2,
    zIndex: 10,
  })
  mainContainer.add(rightGroup)

  const box2 = new BoxRenderable("box2", {
    x: 0,
    y: 0,
    width: 35,
    height: 12,
    bg: "#1c2128",
    zIndex: 20,
    borderColor: "#f85149",
    title: "Code Example",
    borderStyle: "rounded",
  })
  rightGroup.add(box2)

  const codeText1 = renderer.createStyledText("codeText1", {
    fragment: t`${magenta("function")} ${cyan("handleSelection")}() {`,
    x: 2,
    y: 2,
    width: 31,
    height: 1,
    zIndex: 21,
    selectionBg: "#4a5568",
    // selectionFg: "#ffffff",
  })
  rightGroup.add(codeText1)
  allTextRenderables.push(codeText1)

  const codeText2 = renderer.createStyledText("codeText2", {
    fragment: t`  ${magenta("const")} selected = ${cyan("getSelectedText")}()`,
    x: 2,
    y: 3,
    width: 31,
    height: 1,
    zIndex: 21,
    selectionBg: "#4a5568",
    // selectionFg: "#ffffff",
  })
  rightGroup.add(codeText2)
  allTextRenderables.push(codeText2)

  const codeText3 = renderer.createStyledText("codeText3", {
    fragment: t`  ${yellow("console")}.${green("log")}(selected)`,
    x: 2,
    y: 4,
    width: 31,
    height: 1,
    zIndex: 21,
    selectionBg: "#4a5568",
    // selectionFg: "#ffffff",
  })
  rightGroup.add(codeText3)
  allTextRenderables.push(codeText3)

  const codeText4 = new TextRenderable("codeText4", {
    content: "}",
    x: 2,
    y: 5,
    zIndex: 21,
    fg: "#e6edf3",
  })
  rightGroup.add(codeText4)
  allTextRenderables.push(codeText4)

  const floatingBox = new BoxRenderable("floatingBox", {
    x: 90,
    y: 11,
    width: 31,
    height: 6,
    bg: "#1b2f23",
    zIndex: 30,
    borderColor: "#2ea043",
    title: "README",
    borderStyle: "single",
  })
  renderer.add(floatingBox)

  const multilineText = renderer.createStyledText("multilineText", {
    fragment: t`${bold(cyan("Selection Demo"))}
${green("✓")} Cross-renderable selection
${green("✓")} Nested groups and boxes
${green("✓")} Styled text support`,
    x: 2,
    y: 1,
    width: 27,
    height: 4,
    zIndex: 31,
    selectionBg: "#4a5568",
    selectionFg: "#ffffff",
  })
  floatingBox.add(multilineText)
  allTextRenderables.push(multilineText)

  const instructions = new TextRenderable("instructions", {
    content: "Click and drag to select text across any elements. Press 'C' to clear selection.",
    x: 2,
    y: 17,
    zIndex: 2,
    fg: "#f0f6fc",
  })
  mainContainer.add(instructions)
  allTextRenderables.push(instructions)

  statusBox = new BoxRenderable("statusBox", {
    x: 1,
    y: 24,
    width: 88,
    height: 9,
    bg: "#0d1117",
    zIndex: 1,
    borderColor: "#50565d",
    title: "Selection Status",
    titleAlignment: "left",
  })
  renderer.add(statusBox)

  statusText = new TextRenderable("statusText", {
    content: "No selection - try selecting across different nested elements",
    x: 3,
    y: 26,
    zIndex: 2,
    fg: "#f0f6fc",
  })
  renderer.add(statusText)

  selectionStartText = new TextRenderable("selectionStartText", {
    content: "",
    x: 3,
    y: 27,
    zIndex: 2,
    fg: "#7dd3fc",
  })
  renderer.add(selectionStartText)

  selectionMiddleText = new TextRenderable("selectionMiddleText", {
    content: "",
    x: 3,
    y: 28,
    zIndex: 2,
    fg: "#94a3b8",
  })
  renderer.add(selectionMiddleText)

  selectionEndText = new TextRenderable("selectionEndText", {
    content: "",
    x: 3,
    y: 29,
    zIndex: 2,
    fg: "#7dd3fc",
  })
  renderer.add(selectionEndText)

  debugText = new TextRenderable("debugText", {
    content: "",
    x: 3,
    y: 31,
    zIndex: 2,
    fg: "#e6edf3",
  })
  renderer.add(debugText)

  // Listen for selection events
  renderer.on("selection", (selection) => {
    if (selection && statusText && debugText && selectionStartText && selectionMiddleText && selectionEndText) {
      const selectedText = selection.getSelectedText()

      // Count how many renderables have selection
      const selectedCount = allTextRenderables.filter((r) => r.hasSelection()).length
      const container = renderer.getSelectionContainer()
      const containerInfo = container ? `Container: ${container.id}` : "Container: none"
      debugText.content = `Selected renderables: ${selectedCount}/${allTextRenderables.length} | ${containerInfo}`

      if (selectedText) {
        const lines = selectedText.split("\n")
        const totalLength = selectedText.length

        if (lines.length > 1) {
          statusText.content = `Selected ${lines.length} lines (${totalLength} chars):`
          selectionStartText.content = lines[0]
          selectionMiddleText.content = "..."
          selectionEndText.content = lines[lines.length - 1]
        } else if (selectedText.length > 60) {
          statusText.content = `Selected ${totalLength} chars:`
          selectionStartText.content = selectedText.substring(0, 30)
          selectionMiddleText.content = "..."
          selectionEndText.content = selectedText.substring(selectedText.length - 30)
        } else {
          statusText.content = `Selected ${totalLength} chars:`
          selectionStartText.content = `"${selectedText}"`
          selectionMiddleText.content = ""
          selectionEndText.content = ""
        }
      } else {
        statusText.content = "Empty selection"
        selectionStartText.content = ""
        selectionMiddleText.content = ""
        selectionEndText.content = ""
      }
    }
  })

  renderer.on("key", (data) => {
    const key = data.toString()
    if (key === "c" || key === "C") {
      renderer.clearSelection()
      if (statusText && debugText && selectionStartText && selectionMiddleText && selectionEndText) {
        statusText.content = "Selection cleared"
        selectionStartText.content = ""
        selectionMiddleText.content = ""
        selectionEndText.content = ""
        debugText.content = ""
      }
    }
  })
}

export function destroy(renderer: CliRenderer): void {
  allTextRenderables = []

  renderer.remove("nestedText")
  renderer.remove("codeText1")
  renderer.remove("codeText2")
  renderer.remove("codeText3")
  renderer.remove("multilineText")

  if (leftGroup) {
    renderer.remove("leftGroup")
    leftGroup = null
  }
  if (rightGroup) {
    renderer.remove("rightGroup")
    rightGroup = null
  }

  renderer.remove("floatingBox")

  if (mainContainer) {
    renderer.remove("mainContainer")
    mainContainer = null
  }
  if (statusBox) {
    renderer.remove("statusBox")
    statusBox = null
  }
  if (statusText) {
    renderer.remove("statusText")
    statusText = null
  }
  if (selectionStartText) {
    renderer.remove("selectionStartText")
    selectionStartText = null
  }
  if (selectionMiddleText) {
    renderer.remove("selectionMiddleText")
    selectionMiddleText = null
  }
  if (selectionEndText) {
    renderer.remove("selectionEndText")
    selectionEndText = null
  }
  if (debugText) {
    renderer.remove("debugText")
    debugText = null
  }

  renderer.remove("instructions")

  renderer.clearSelection()
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    targetFps: 30,
    enableMouseMovement: true,
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
