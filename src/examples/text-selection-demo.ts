#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  TextRenderable,
  BoxRenderable,
  StyledTextRenderable,
  GroupRenderable,
  t,
  green,
  bold,
  italic,
  yellow,
  cyan,
  magenta,
  FlexDirection,
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
    positionType: "absolute",
    position: {
      left: 1,
      top: 1,
    },
    width: 88,
    height: 22,
    bg: "#161b22",
    zIndex: 1,
    borderColor: "#50565d",
    title: "Text Selection Demo",
    titleAlignment: "center",
  })
  renderer.root.add(mainContainer)

  leftGroup = new GroupRenderable("leftGroup", {
    positionType: "absolute",
    position: {
      left: 2,
      top: 2,
    },
    zIndex: 10,
  })
  mainContainer.add(leftGroup)

  const box1 = new BoxRenderable("box1", {
    width: 45,
    height: 7,
    bg: "#1e2936",
    zIndex: 20,
    borderColor: "#58a6ff",
    title: "Document Section 1",
    flexDirection: FlexDirection.Column,
    padding: 1,
  })
  leftGroup.add(box1)

  const text1 = new TextRenderable("text1", {
    content: "This is a paragraph in the first box.",
    zIndex: 21,
    fg: "#f0f6fc",
  })
  box1.add(text1)
  allTextRenderables.push(text1)

  const text2 = new TextRenderable("text2", {
    content: "It contains multiple lines of text",
    zIndex: 21,
    fg: "#f0f6fc",
  })
  box1.add(text2)
  allTextRenderables.push(text2)

  const text3 = new TextRenderable("text3", {
    content: "that can be selected independently.",
    zIndex: 21,
    fg: "#f0f6fc",
  })
  box1.add(text3)
  allTextRenderables.push(text3)

  const nestedBox = new BoxRenderable("nestedBox", {
    position: {
      left: 2,
      top: 1,
    },
    width: 31,
    height: 4,
    bg: "#2d1b69",
    zIndex: 25,
    borderColor: "#a371f7",
    borderStyle: "double",
  })
  leftGroup.add(nestedBox)

  const nestedText = new StyledTextRenderable("nestedText", {
    fragment: t`${yellow("Important:")} ${bold(cyan("Nested content"))} ${italic(green("with styles"))}`,
    width: 27,
    height: 1,
    zIndex: 26,
    selectionBg: "#4a5568",
    selectionFg: "#ffffff",
  })
  nestedBox.add(nestedText)
  allTextRenderables.push(nestedText)

  rightGroup = new GroupRenderable("rightGroup", {
    positionType: "absolute",
    position: {
      left: 48,
      top: 2,
    },
    zIndex: 10,
  })
  mainContainer.add(rightGroup)

  const box2 = new BoxRenderable("box2", {
    position: {
      left: 2,
      top: 0,
    },
    width: 35,
    height: 12,
    bg: "#1c2128",
    zIndex: 20,
    borderColor: "#f85149",
    title: "Code Example",
    borderStyle: "rounded",
    padding: 1,
  })
  rightGroup.add(box2)

  const codeText1 = new StyledTextRenderable("codeText1", {
    fragment: t`${magenta("function")} ${cyan("handleSelection")}() {`,
    width: 31,
    height: 1,
    zIndex: 21,
    selectionBg: "#4a5568",
    // selectionFg: "#ffffff",
  })
  box2.add(codeText1)
  allTextRenderables.push(codeText1)

  const codeText2 = new StyledTextRenderable("codeText2", {
    fragment: t`  ${magenta("const")} selected = ${cyan("getSelectedText")}()`,
    width: 31,
    height: 1,
    zIndex: 21,
    selectionBg: "#4a5568",
    // selectionFg: "#ffffff",
  })
  box2.add(codeText2)
  allTextRenderables.push(codeText2)

  const codeText3 = new StyledTextRenderable("codeText3", {
    fragment: t`  ${yellow("console")}.${green("log")}(selected)`,
    width: 31,
    height: 1,
    zIndex: 21,
    selectionBg: "#4a5568",
    // selectionFg: "#ffffff",
  })
  box2.add(codeText3)
  allTextRenderables.push(codeText3)

  const codeText4 = new TextRenderable("codeText4", {
    content: "}",
    zIndex: 21,
    fg: "#e6edf3",
  })
  box2.add(codeText4)
  allTextRenderables.push(codeText4)

  const floatingBox = new BoxRenderable("floatingBox", {
    positionType: "absolute",
    position: {
      left: 90,
      top: 11,
    },
    width: 31,
    height: 6,
    bg: "#1b2f23",
    zIndex: 30,
    borderColor: "#2ea043",
    title: "README",
    borderStyle: "single",
  })
  renderer.root.add(floatingBox)

  const multilineText = new StyledTextRenderable("multilineText", {
    fragment: t`${bold(cyan("Selection Demo"))}
${green("✓")} Cross-renderable selection
${green("✓")} Nested groups and boxes
${green("✓")} Styled text support`,
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
    position: {
      left: 2,
      top: 17,
    },
    zIndex: 2,
    fg: "#f0f6fc",
  })
  mainContainer.add(instructions)
  allTextRenderables.push(instructions)

  statusBox = new BoxRenderable("statusBox", {
    positionType: "absolute",
    position: {
      left: 1,
      top: 24,
    },
    width: 88,
    height: 9,
    bg: "#0d1117",
    zIndex: 1,
    borderColor: "#50565d",
    title: "Selection Status",
    titleAlignment: "left",
    padding: 1,
  })
  renderer.root.add(statusBox)

  statusText = new TextRenderable("statusText", {
    content: "No selection - try selecting across different nested elements",
    zIndex: 2,
    fg: "#f0f6fc",
  })
  statusBox.add(statusText)

  selectionStartText = new TextRenderable("selectionStartText", {
    content: "",
    zIndex: 2,
    fg: "#7dd3fc",
  })
  statusBox.add(selectionStartText)

  selectionMiddleText = new TextRenderable("selectionMiddleText", {
    content: "",
    zIndex: 2,
    fg: "#94a3b8",
  })
  statusBox.add(selectionMiddleText)

  selectionEndText = new TextRenderable("selectionEndText", {
    content: "",
    zIndex: 2,
    fg: "#7dd3fc",
  })
  statusBox.add(selectionEndText)

  debugText = new TextRenderable("debugText", {
    content: "",
    zIndex: 2,
    fg: "#e6edf3",
  })
  statusBox.add(debugText)

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

  renderer.root.remove("nestedText")
  renderer.root.remove("codeText1")
  renderer.root.remove("codeText2")
  renderer.root.remove("codeText3")
  renderer.root.remove("multilineText")

  if (leftGroup) {
    renderer.root.remove("leftGroup")
    leftGroup = null
  }
  if (rightGroup) {
    renderer.root.remove("rightGroup")
    rightGroup = null
  }

  renderer.root.remove("floatingBox")

  if (mainContainer) {
    renderer.root.remove("mainContainer")
    mainContainer = null
  }
  if (statusBox) {
    renderer.root.remove("statusBox")
    statusBox = null
  }
  if (statusText) {
    renderer.root.remove("statusText")
    statusText = null
  }
  if (selectionStartText) {
    renderer.root.remove("selectionStartText")
    selectionStartText = null
  }
  if (selectionMiddleText) {
    renderer.root.remove("selectionMiddleText")
    selectionMiddleText = null
  }
  if (selectionEndText) {
    renderer.root.remove("selectionEndText")
    selectionEndText = null
  }
  if (debugText) {
    renderer.root.remove("debugText")
    debugText = null
  }

  renderer.root.remove("instructions")

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
