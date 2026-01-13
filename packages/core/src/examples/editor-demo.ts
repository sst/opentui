import {
  CliRenderer,
  createCliRenderer,
  TextareaRenderable,
  BoxRenderable,
  TextRenderable,
  LineNumberRenderable,
  KeyEvent,
  t,
  bold,
  cyan,
  fg,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

const initialContent = `1
2
3
"คำว่า"
4
5
6
67

7
78
8
8
65
7
567
567
567

57
567
56
7
567
5
67
567
56
756
7
567
567
`

let renderer: CliRenderer | null = null
let parentContainer: BoxRenderable | null = null
let editor: TextareaRenderable | null = null
let editorWithLines: LineNumberRenderable | null = null
let statusText: TextRenderable | null = null
let highlightsEnabled: boolean = false
let diagnosticsEnabled: boolean = false

export async function run(rendererInstance: CliRenderer): Promise<void> {
  renderer = rendererInstance
  renderer.setBackgroundColor("#0D1117")

  parentContainer = new BoxRenderable(renderer, {
    id: "parent-container",
    zIndex: 10,
    padding: 1,
  })
  renderer.root.add(parentContainer)

  const editorBox = new BoxRenderable(renderer, {
    id: "editor-box",
    borderStyle: "single",
    borderColor: "#6BCF7F",
    backgroundColor: "#0D1117",
    title: "Interactive Editor (TextareaRenderable)",
    titleAlignment: "left",
    border: true,
  })
  parentContainer.add(editorBox)

  // Create interactive editor
  editor = new TextareaRenderable(renderer, {
    id: "editor",
    initialValue: initialContent,
    textColor: "#F0F6FC",
    selectionBg: "#264F78",
    selectionFg: "#FFFFFF",
    wrapMode: "word",
    showCursor: true,
    cursorColor: "#4ECDC4",
    placeholder: t`${fg("#333333")("Enter")} ${cyan(bold("text"))} ${fg("#333333")("here...")}`,
    tabIndicator: "→",
    tabIndicatorColor: "#30363D",
  })

  editorWithLines = new LineNumberRenderable(renderer, {
    id: "editor-lines",
    target: editor,
    minWidth: 3,
    paddingRight: 1,
    fg: "#6b7280", // Dimmed gray for line numbers
    bg: "#161b22", // Slightly darker than editor background for distinction
    width: "100%",
    height: "100%",
  })

  editorBox.add(editorWithLines)

  statusText = new TextRenderable(renderer, {
    id: "status",
    content: "",
    fg: "#A5D6FF",
    height: 1,
  })
  parentContainer.add(statusText)

  editor.focus()

  rendererInstance.setFrameCallback(async () => {
    if (statusText && editor && !editor.isDestroyed) {
      try {
        const cursor = editor.logicalCursor
        const wrap = editor.wrapMode !== "none" ? "ON" : "OFF"
        const highlights = highlightsEnabled ? "ON" : "OFF"
        const diagnostics = diagnosticsEnabled ? "ON" : "OFF"
        const scrollSpeed = editor.scrollSpeed
        statusText.content = `Line ${cursor.row + 1}, Col ${cursor.col + 1} | Wrap: ${wrap} | Diff: ${highlights} | Diag: ${diagnostics} | Scroll: ${scrollSpeed} lines/s`
      } catch (error) {
        // Ignore errors during shutdown
      }
    }
  })

  rendererInstance.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.shift && key.name === "l") {
      key.preventDefault()
      if (editorWithLines && !editorWithLines.isDestroyed) {
        editorWithLines.showLineNumbers = !editorWithLines.showLineNumbers
      }
    }
    if (key.shift && key.name === "w") {
      key.preventDefault()
      if (editor && !editor.isDestroyed) {
        const currentMode = editor.wrapMode
        const nextMode = currentMode === "word" ? "char" : currentMode === "char" ? "none" : "word"
        editor.wrapMode = nextMode
      }
    }
    if (key.shift && key.name === "h") {
      key.preventDefault()
      if (editorWithLines && !editorWithLines.isDestroyed) {
        highlightsEnabled = !highlightsEnabled
        if (highlightsEnabled) {
          // Add modern diff-style line colors and +/- signs throughout the document
          editorWithLines.setLineColor(2, "#1a4d1a") // Line 3: Added (fresh green)
          editorWithLines.setLineSign(2, { after: " +", afterColor: "#22c55e" })

          editorWithLines.setLineColor(5, "#4d1a1a") // Line 6: Removed (vibrant red)
          editorWithLines.setLineSign(5, { after: " -", afterColor: "#ef4444" })

          editorWithLines.setLineColor(8, "#1a4d1a") // Line 9: Added (fresh green)
          editorWithLines.setLineSign(8, { after: " +", afterColor: "#22c55e" })

          editorWithLines.setLineColor(11, "#4d1a1a") // Line 12: Removed (vibrant red)
          editorWithLines.setLineSign(11, { after: " -", afterColor: "#ef4444" })

          editorWithLines.setLineColor(14, "#1a4d1a") // Line 15: Added (fresh green)
          editorWithLines.setLineSign(14, { after: " +", afterColor: "#22c55e" })

          editorWithLines.setLineColor(17, "#4d1a1a") // Line 18: Removed (vibrant red)
          editorWithLines.setLineSign(17, { after: " -", afterColor: "#ef4444" })

          editorWithLines.setLineColor(20, "#1a4d1a") // Line 21: Added (fresh green)
          editorWithLines.setLineSign(20, { after: " +", afterColor: "#22c55e" })

          editorWithLines.setLineColor(23, "#4d1a1a") // Line 24: Removed (vibrant red)
          editorWithLines.setLineSign(23, { after: " -", afterColor: "#ef4444" })

          editorWithLines.setLineColor(27, "#1a4d1a") // Line 28: Added (fresh green)
          editorWithLines.setLineSign(27, { after: " +", afterColor: "#22c55e" })

          editorWithLines.setLineColor(30, "#4d1a1a") // Line 31: Removed (vibrant red)
          editorWithLines.setLineSign(30, { after: " -", afterColor: "#ef4444" })

          editorWithLines.setLineColor(34, "#1a4d1a") // Line 35: Added (fresh green)
          editorWithLines.setLineSign(34, { after: " +", afterColor: "#22c55e" })

          editorWithLines.setLineColor(38, "#4d1a1a") // Line 39: Removed (vibrant red)
          editorWithLines.setLineSign(38, { after: " -", afterColor: "#ef4444" })

          editorWithLines.setLineColor(42, "#1a4d1a") // Line 43: Added (fresh green)
          editorWithLines.setLineSign(42, { after: " +", afterColor: "#22c55e" })

          editorWithLines.setLineColor(46, "#4d1a1a") // Line 47: Removed (vibrant red)
          editorWithLines.setLineSign(46, { after: " -", afterColor: "#ef4444" })

          editorWithLines.setLineColor(50, "#1a4d1a") // Line 51: Added (fresh green)
          editorWithLines.setLineSign(50, { after: " +", afterColor: "#22c55e" })

          editorWithLines.setLineColor(54, "#4d1a1a") // Line 55: Removed (vibrant red)
          editorWithLines.setLineSign(54, { after: " -", afterColor: "#ef4444" })

          editorWithLines.setLineColor(58, "#1a4d1a") // Line 59: Added (fresh green)
          editorWithLines.setLineSign(58, { after: " +", afterColor: "#22c55e" })
        } else {
          editorWithLines.clearAllLineColors()
          // Clear only the after signs (keep diagnostics if enabled)
          const currentSigns = editorWithLines.getLineSigns()
          for (const [line, sign] of currentSigns) {
            if (sign.after) {
              if (sign.before) {
                // Keep the before sign, remove only after
                editorWithLines.setLineSign(line, { before: sign.before, beforeColor: sign.beforeColor })
              } else {
                // No before sign, remove entirely
                editorWithLines.clearLineSign(line)
              }
            }
          }
        }
      }
    }
    if (key.shift && key.name === "d") {
      key.preventDefault()
      if (editorWithLines && !editorWithLines.isDestroyed) {
        diagnosticsEnabled = !diagnosticsEnabled
        if (diagnosticsEnabled) {
          // Add diagnostic signs (errors, warnings, info) on some lines
          editorWithLines.setLineSign(0, { before: "❌", beforeColor: "#ef4444" }) // Line 1: Error
          editorWithLines.setLineSign(4, { before: "⚠️", beforeColor: "#f59e0b" }) // Line 5: Warning
          editorWithLines.setLineSign(10, { before: "💡", beforeColor: "#3b82f6" }) // Line 11: Info
          editorWithLines.setLineSign(25, { before: "❌", beforeColor: "#ef4444" }) // Line 26: Error
          editorWithLines.setLineSign(40, { before: "⚠️", beforeColor: "#f59e0b" }) // Line 41: Warning
          editorWithLines.setLineSign(52, { before: "💡", beforeColor: "#3b82f6" }) // Line 53: Info
        } else {
          // Clear only the before signs (keep diff signs if enabled)
          const currentSigns = editorWithLines.getLineSigns()
          for (const [line, sign] of currentSigns) {
            if (sign.before) {
              if (sign.after) {
                // Keep the after sign, remove only before
                editorWithLines.setLineSign(line, { after: sign.after, afterColor: sign.afterColor })
              } else {
                // No after sign, remove entirely
                editorWithLines.clearLineSign(line)
              }
            }
          }
        }
      }
    }
    if (key.ctrl && (key.name === "pageup" || key.name === "pagedown")) {
      key.preventDefault()
      if (editor && !editor.isDestroyed) {
        if (key.name === "pageup") {
          editor.editBuffer.setCursor(0, 0)
        } else {
          editor.gotoBufferEnd()
        }
      }
    }
    if (key.ctrl && key.name === "]") {
      key.preventDefault()
      if (editor && !editor.isDestroyed) {
        editor.scrollSpeed = Math.min(100, editor.scrollSpeed + 4)
      }
    }
    if (key.ctrl && key.name === "[") {
      key.preventDefault()
      if (editor && !editor.isDestroyed) {
        editor.scrollSpeed = Math.max(4, editor.scrollSpeed - 4)
      }
    }
  })
}

export function destroy(rendererInstance: CliRenderer): void {
  rendererInstance.clearFrameCallbacks()
  parentContainer?.destroy()
  parentContainer = null
  editorWithLines = null
  editor = null
  statusText = null
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
