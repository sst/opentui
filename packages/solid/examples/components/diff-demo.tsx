import { createSignal } from "solid-js"
import { SyntaxStyle } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"

export default function DiffDemo() {
  const [currentView, setCurrentView] = createSignal<"unified" | "split">("unified")
  const [showLineNumbers, setShowLineNumbers] = createSignal(true)

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

  const syntaxStyle = SyntaxStyle.fromStyles({
    keyword: { fg: "#C792EA" } as any,
    "keyword.import": { fg: "#C792EA" } as any,
    string: { fg: "#C3E88D" } as any,
    comment: { fg: "#546E7A" } as any,
    number: { fg: "#F78C6C" } as any,
    boolean: { fg: "#F78C6C" } as any,
    constant: { fg: "#F78C6C" } as any,
    function: { fg: "#82AAFF" } as any,
    "function.call": { fg: "#82AAFF" } as any,
    constructor: { fg: "#FFCB6B" } as any,
    type: { fg: "#FFCB6B" } as any,
    operator: { fg: "#89DDFF" } as any,
    variable: { fg: "#EEFFFF" } as any,
    property: { fg: "#89DDFF" } as any,
    bracket: { fg: "#FFFFFF" } as any,
    punctuation: { fg: "#FFFFFF" } as any,
    default: { fg: "#A6ACCD" } as any,
  })

  useKeyboard((key) => {
    if (key.name === "v" && !key.ctrl && !key.meta) {
      toggleView()
    } else if (key.name === "l" && !key.ctrl && !key.meta) {
      toggleLineNumbers()
    }
  })

  const toggleView = () => {
    setCurrentView(currentView() === "unified" ? "split" : "unified")
  }

  const toggleLineNumbers = () => {
    setShowLineNumbers(!showLineNumbers())
  }

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      <box flexDirection="column" backgroundColor="#0D1117" padding={1} border borderColor="#30363D">
        <text fg="#4ECDC4">Diff Demo - Unified & Split View</text>
        <text fg="#888888">Keybindings:</text>
        <text fg="#AAAAAA"> V - Toggle view ({currentView().toUpperCase()})</text>
        <text fg="#AAAAAA"> L - Toggle line numbers ({showLineNumbers() ? "ON" : "OFF"})</text>
      </box>

      <box flexGrow={1} border borderStyle="single" borderColor="#4ECDC4" backgroundColor="#0D1117">
        <diff
          diff={exampleDiff}
          view={currentView()}
          filetype="typescript"
          syntaxStyle={syntaxStyle}
          showLineNumbers={showLineNumbers()}
          addedBg="#1a4d1a"
          removedBg="#4d1a1a"
          addedSignColor="#22c55e"
          removedSignColor="#ef4444"
          lineNumberFg="#6b7280"
          lineNumberBg="#161b22"
          width="100%"
          height="100%"
        />
      </box>
    </box>
  )
}
