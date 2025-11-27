import { CliRenderer, createCliRenderer, DiffRenderable, BoxRenderable, TextRenderable, type ParsedKey } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { parseColor } from "../lib/RGBA"
import { SyntaxStyle } from "../syntax-style"

const exampleDiff = `--- a/calculator.ts
+++ b/calculator.ts
@@ -1,15 +1,20 @@
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
let syntaxStyle: SyntaxStyle | null = null
let currentView: "unified" | "split" = "unified"
let showLineNumbers = true

export async function run(rendererInstance: CliRenderer): Promise<void> {
  renderer = rendererInstance
  renderer.start()
  renderer.setBackgroundColor("#0D1117")

  parentContainer = new BoxRenderable(renderer, {
    id: "parent-container",
    zIndex: 10,
    padding: 1,
  })
  renderer.root.add(parentContainer)

  const titleBox = new BoxRenderable(renderer, {
    id: "title-box",
    height: 3,
    borderStyle: "double",
    borderColor: "#4ECDC4",
    backgroundColor: "#0D1117",
    title: "Diff Demo - Unified & Split View",
    titleAlignment: "center",
    border: true,
  })
  parentContainer.add(titleBox)

  instructionsText = new TextRenderable(renderer, {
    id: "instructions",
    content: "ESC to return | V: Toggle View (Unified/Split) | L: Toggle Line Numbers",
    fg: "#888888",
  })
  titleBox.add(instructionsText)

  // Create syntax style similar to GitHub Dark theme
  syntaxStyle = SyntaxStyle.fromStyles({
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
  })

  // Create diff display
  diffRenderable = new DiffRenderable(renderer, {
    id: "diff-display",
    diff: exampleDiff,
    view: currentView,
    filetype: "typescript",
    syntaxStyle,
    showLineNumbers,
    addedBg: "#1a4d1a",
    removedBg: "#4d1a1a",
    addedSignColor: "#22c55e",
    removedSignColor: "#ef4444",
    lineNumberFg: "#6b7280",
    lineNumberBg: "#161b22",
    flexGrow: 1,
    flexShrink: 1,
  })

  parentContainer.add(diffRenderable)

  const updateInstructions = () => {
    if (instructionsText) {
      instructionsText.content = `ESC to return | V: Toggle View (${currentView.toUpperCase()}) | L: Line Numbers (${showLineNumbers ? "ON" : "OFF"})`
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
