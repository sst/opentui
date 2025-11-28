import { CliRenderer, createCliRenderer, DiffRenderable, BoxRenderable, TextRenderable, type ParsedKey } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { parseColor, type RGBA } from "../lib/RGBA"
import { SyntaxStyle } from "../syntax-style"

interface DiffTheme {
  name: string
  backgroundColor: string
  borderColor: string
  addedBg: string
  removedBg: string
  contextBg: string
  addedSignColor: string
  removedSignColor: string
  lineNumberFg: string
  lineNumberBg: string
  addedLineNumberBg: string
  removedLineNumberBg: string
  syntaxStyle: {
    keyword: { fg: RGBA; bold?: boolean }
    "keyword.import": { fg: RGBA; bold?: boolean }
    string: { fg: RGBA }
    comment: { fg: RGBA; italic?: boolean }
    number: { fg: RGBA }
    boolean: { fg: RGBA }
    constant: { fg: RGBA }
    function: { fg: RGBA }
    "function.call": { fg: RGBA }
    constructor: { fg: RGBA }
    type: { fg: RGBA }
    operator: { fg: RGBA }
    variable: { fg: RGBA }
    property: { fg: RGBA }
    bracket: { fg: RGBA }
    punctuation: { fg: RGBA }
    default: { fg: RGBA }
  }
}

const themes: DiffTheme[] = [
  {
    name: "GitHub Dark",
    backgroundColor: "#0D1117",
    borderColor: "#4ECDC4",
    addedBg: "#1a4d1a",
    removedBg: "#4d1a1a",
    contextBg: "transparent",
    addedSignColor: "#22c55e",
    removedSignColor: "#ef4444",
    lineNumberFg: "#6b7280",
    lineNumberBg: "#161b22",
    addedLineNumberBg: "#0d3a0d",
    removedLineNumberBg: "#3a0d0d",
    syntaxStyle: {
      keyword: { fg: parseColor("#FF7B72"), bold: true },
      "keyword.import": { fg: parseColor("#FF7B72"), bold: true },
      string: { fg: parseColor("#A5D6FF") },
      comment: { fg: parseColor("#8B949E"), italic: true },
      number: { fg: parseColor("#79C0FF") },
      boolean: { fg: parseColor("#79C0FF") },
      constant: { fg: parseColor("#79C0FF") },
      function: { fg: parseColor("#D2A8FF") },
      "function.call": { fg: parseColor("#D2A8FF") },
      constructor: { fg: parseColor("#FFA657") },
      type: { fg: parseColor("#FFA657") },
      operator: { fg: parseColor("#FF7B72") },
      variable: { fg: parseColor("#E6EDF3") },
      property: { fg: parseColor("#79C0FF") },
      bracket: { fg: parseColor("#F0F6FC") },
      punctuation: { fg: parseColor("#F0F6FC") },
      default: { fg: parseColor("#E6EDF3") },
    },
  },
  {
    name: "Monokai",
    backgroundColor: "#272822",
    borderColor: "#FD971F",
    addedBg: "#2d4a2b",
    removedBg: "#4a2b2b",
    contextBg: "transparent",
    addedSignColor: "#A6E22E",
    removedSignColor: "#F92672",
    lineNumberFg: "#75715E",
    lineNumberBg: "#1e1f1c",
    addedLineNumberBg: "#1e3a1e",
    removedLineNumberBg: "#3a1e1e",
    syntaxStyle: {
      keyword: { fg: parseColor("#F92672"), bold: true },
      "keyword.import": { fg: parseColor("#F92672"), bold: true },
      string: { fg: parseColor("#E6DB74") },
      comment: { fg: parseColor("#75715E"), italic: true },
      number: { fg: parseColor("#AE81FF") },
      boolean: { fg: parseColor("#AE81FF") },
      constant: { fg: parseColor("#AE81FF") },
      function: { fg: parseColor("#A6E22E") },
      "function.call": { fg: parseColor("#A6E22E") },
      constructor: { fg: parseColor("#FD971F") },
      type: { fg: parseColor("#66D9EF") },
      operator: { fg: parseColor("#F92672") },
      variable: { fg: parseColor("#F8F8F2") },
      property: { fg: parseColor("#66D9EF") },
      bracket: { fg: parseColor("#F8F8F2") },
      punctuation: { fg: parseColor("#F8F8F2") },
      default: { fg: parseColor("#F8F8F2") },
    },
  },
  {
    name: "Dracula",
    backgroundColor: "#282A36",
    borderColor: "#BD93F9",
    addedBg: "#2d4737",
    removedBg: "#4d2d37",
    contextBg: "transparent",
    addedSignColor: "#50FA7B",
    removedSignColor: "#FF5555",
    lineNumberFg: "#6272A4",
    lineNumberBg: "#21222C",
    addedLineNumberBg: "#1f3626",
    removedLineNumberBg: "#3a2328",
    syntaxStyle: {
      keyword: { fg: parseColor("#FF79C6"), bold: true },
      "keyword.import": { fg: parseColor("#FF79C6"), bold: true },
      string: { fg: parseColor("#F1FA8C") },
      comment: { fg: parseColor("#6272A4"), italic: true },
      number: { fg: parseColor("#BD93F9") },
      boolean: { fg: parseColor("#BD93F9") },
      constant: { fg: parseColor("#BD93F9") },
      function: { fg: parseColor("#50FA7B") },
      "function.call": { fg: parseColor("#50FA7B") },
      constructor: { fg: parseColor("#FFB86C") },
      type: { fg: parseColor("#8BE9FD") },
      operator: { fg: parseColor("#FF79C6") },
      variable: { fg: parseColor("#F8F8F2") },
      property: { fg: parseColor("#8BE9FD") },
      bracket: { fg: parseColor("#F8F8F2") },
      punctuation: { fg: parseColor("#F8F8F2") },
      default: { fg: parseColor("#F8F8F2") },
    },
  },
  {
    name: "Solarized Dark",
    backgroundColor: "#002B36",
    borderColor: "#2AA198",
    addedBg: "#1a4032",
    removedBg: "#4d2a30",
    contextBg: "transparent",
    addedSignColor: "#859900",
    removedSignColor: "#DC322F",
    lineNumberFg: "#586E75",
    lineNumberBg: "#073642",
    addedLineNumberBg: "#0d3326",
    removedLineNumberBg: "#3a2026",
    syntaxStyle: {
      keyword: { fg: parseColor("#859900"), bold: true },
      "keyword.import": { fg: parseColor("#859900"), bold: true },
      string: { fg: parseColor("#2AA198") },
      comment: { fg: parseColor("#586E75"), italic: true },
      number: { fg: parseColor("#D33682") },
      boolean: { fg: parseColor("#D33682") },
      constant: { fg: parseColor("#B58900") },
      function: { fg: parseColor("#268BD2") },
      "function.call": { fg: parseColor("#268BD2") },
      constructor: { fg: parseColor("#CB4B16") },
      type: { fg: parseColor("#CB4B16") },
      operator: { fg: parseColor("#859900") },
      variable: { fg: parseColor("#93A1A1") },
      property: { fg: parseColor("#268BD2") },
      bracket: { fg: parseColor("#93A1A1") },
      punctuation: { fg: parseColor("#93A1A1") },
      default: { fg: parseColor("#93A1A1") },
    },
  },
]

const exampleDiff = `--- a/calculator.ts
+++ b/calculator.ts
@@ -1,13 +1,20 @@
 class Calculator {
   add(a: number, b: number): number {
     return a + b;
   }
 
-  subtract(a: number, b: number): number {
-    return a - b;
+  subtract(a: number, b: number, c: number = 0): number {
+    return a - b - c;
   }
 
   multiply(a: number, b: number): number {
     return a * b;
   }
+
+  divide(a: number, b: number): number {
+    if (b === 0) {
+      throw new Error("Division by zero");
+    }
+    return a / b;
+  }
 }`

let renderer: CliRenderer | null = null
let keyboardHandler: ((key: ParsedKey) => void) | null = null
let parentContainer: BoxRenderable | null = null
let diffRenderable: DiffRenderable | null = null
let instructionsText: TextRenderable | null = null
let titleBox: BoxRenderable | null = null
let syntaxStyle: SyntaxStyle | null = null
let currentView: "unified" | "split" = "unified"
let showLineNumbers = true
let currentWrapMode: "none" | "word" = "none"
let currentThemeIndex = 0

const applyTheme = (themeIndex: number) => {
  const theme = themes[themeIndex]

  if (renderer) {
    renderer.setBackgroundColor(theme.backgroundColor)
  }

  if (titleBox) {
    titleBox.borderColor = theme.borderColor
    titleBox.backgroundColor = theme.backgroundColor
    titleBox.title = `Diff Demo - ${theme.name}`
  }

  if (syntaxStyle) {
    syntaxStyle.destroy()
  }
  syntaxStyle = SyntaxStyle.fromStyles(theme.syntaxStyle)

  if (diffRenderable) {
    diffRenderable.syntaxStyle = syntaxStyle
    diffRenderable.addedBg = theme.addedBg
    diffRenderable.removedBg = theme.removedBg
    diffRenderable.contextBg = theme.contextBg
    diffRenderable.addedSignColor = theme.addedSignColor
    diffRenderable.removedSignColor = theme.removedSignColor
    diffRenderable.lineNumberFg = theme.lineNumberFg
    diffRenderable.lineNumberBg = theme.lineNumberBg
    diffRenderable.addedLineNumberBg = theme.addedLineNumberBg
    diffRenderable.removedLineNumberBg = theme.removedLineNumberBg
  }
}

export async function run(rendererInstance: CliRenderer): Promise<void> {
  renderer = rendererInstance
  renderer.start()

  const theme = themes[currentThemeIndex]
  renderer.setBackgroundColor(theme.backgroundColor)

  parentContainer = new BoxRenderable(renderer, {
    id: "parent-container",
    zIndex: 10,
    padding: 1,
  })
  renderer.root.add(parentContainer)

  titleBox = new BoxRenderable(renderer, {
    id: "title-box",
    height: 3,
    borderStyle: "double",
    borderColor: theme.borderColor,
    backgroundColor: theme.backgroundColor,
    title: `Diff Demo - ${theme.name}`,
    titleAlignment: "center",
    border: true,
  })
  parentContainer.add(titleBox)

  instructionsText = new TextRenderable(renderer, {
    id: "instructions",
    content:
      "ESC to return | V: Toggle View (Unified/Split) | L: Toggle Line Numbers | W: Toggle Wrap Mode | T: Change Theme",
    fg: "#888888",
  })
  titleBox.add(instructionsText)

  syntaxStyle = SyntaxStyle.fromStyles(theme.syntaxStyle)

  // Create diff display
  diffRenderable = new DiffRenderable(renderer, {
    id: "diff-display",
    diff: exampleDiff,
    view: currentView,
    filetype: "typescript",
    syntaxStyle,
    showLineNumbers,
    wrapMode: currentWrapMode,
    addedBg: theme.addedBg,
    removedBg: theme.removedBg,
    contextBg: theme.contextBg,
    addedSignColor: theme.addedSignColor,
    removedSignColor: theme.removedSignColor,
    lineNumberFg: theme.lineNumberFg,
    lineNumberBg: theme.lineNumberBg,
    addedLineNumberBg: theme.addedLineNumberBg,
    removedLineNumberBg: theme.removedLineNumberBg,
    flexGrow: 1,
    flexShrink: 1,
  })

  parentContainer.add(diffRenderable)

  const updateInstructions = () => {
    if (instructionsText) {
      const themeName = themes[currentThemeIndex].name
      instructionsText.content = `ESC to return | V: Toggle View (${currentView.toUpperCase()}) | L: Line Numbers (${showLineNumbers ? "ON" : "OFF"}) | W: Wrap Mode (${currentWrapMode.toUpperCase()}) | T: Theme (${themeName})`
    }
  }

  updateInstructions()

  keyboardHandler = (key: ParsedKey) => {
    if (key.name === "v" && !key.ctrl && !key.meta) {
      // Toggle view mode
      currentView = currentView === "unified" ? "split" : "unified"
      if (diffRenderable) {
        diffRenderable.view = currentView
      }
      updateInstructions()
    } else if (key.name === "l" && !key.ctrl && !key.meta) {
      // Toggle line numbers
      showLineNumbers = !showLineNumbers
      if (diffRenderable) {
        diffRenderable.showLineNumbers = showLineNumbers
      }
      updateInstructions()
    } else if (key.name === "w" && !key.ctrl && !key.meta) {
      // Toggle wrap mode
      currentWrapMode = currentWrapMode === "none" ? "word" : "none"
      if (diffRenderable) {
        diffRenderable.wrapMode = currentWrapMode
      }
      updateInstructions()
    } else if (key.name === "t" && !key.ctrl && !key.meta) {
      // Change theme
      currentThemeIndex = (currentThemeIndex + 1) % themes.length
      applyTheme(currentThemeIndex)
      updateInstructions()
    }
  }

  rendererInstance.keyInput.on("keypress", keyboardHandler)
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyboardHandler) {
    rendererInstance.keyInput.off("keypress", keyboardHandler)
    keyboardHandler = null
  }

  parentContainer?.destroy()
  parentContainer = null
  diffRenderable = null
  instructionsText = null
  titleBox = null
  syntaxStyle = null

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
