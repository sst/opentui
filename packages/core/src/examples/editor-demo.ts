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

const initialContent = `Welcome to the TextareaRenderable Demo!

This is an interactive text editor powered by EditBuffer and EditorView.

\tThis is a tab
\t\t\tMultiple tabs

Emojis:
👩🏽‍💻  👨‍👩‍👧‍👦  🏳️‍🌈  🇺🇸  🇩🇪  🇯🇵  🇮🇳

NAVIGATION:
  • Arrow keys to move cursor
  • Home/End for line navigation
  • Ctrl+A/Ctrl+E for buffer start/end
  • Alt+F/Alt+B for word forward/backward
  • Alt+Left/Alt+Right for word forward/backward

SELECTION:
  • Shift+Arrow keys to select
  • Shift+Home/End to select to line start/end
  • Alt+Shift+F/B to select word forward/backward
  • Alt+Shift+Left/Right to select word forward/backward

EDITING:
  • Type any text to insert
  • Backspace/Delete to remove text
  • Enter to create new lines
  • Ctrl+D to delete current line
  • Ctrl+K to delete to line end
  • Alt+D to delete word forward
  • Alt+Backspace or Ctrl+W to delete word backward

UNDO/REDO:
  • Ctrl+Z to undo
  • Ctrl+Shift+Z or Ctrl+Y to redo

VIEW:
  • Shift+W to toggle wrap mode (word/char/none)
  • Shift+L to toggle line numbers
  • Shift+H to toggle line highlights (diff colors)

FEATURES:
  ✓ Grapheme-aware cursor movement
  ✓ Unicode (emoji 🌟 and CJK 世界, 你好世界, 中文, 한글)
  ✓ Incremental editing
  ✓ Text wrapping and viewport management
  ✓ Undo/redo support
  ✓ Word-based navigation and deletion
  ✓ Text selection with shift keys

Press ESC to return to main menu`

let renderer: CliRenderer | null = null
let parentContainer: BoxRenderable | null = null
let editor: TextareaRenderable | null = null
let editorWithLines: LineNumberRenderable | null = null
let statusText: TextRenderable | null = null
let highlightsEnabled: boolean = false

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
        statusText.content = `Line ${cursor.row + 1}, Col ${cursor.col + 1} | Wrap: ${wrap} | Highlights: ${highlights}`
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
          // Add modern diff-style line colors throughout the document
          editorWithLines.setLineColor(2, "#1a4d1a") // Line 3: Added (fresh green)
          editorWithLines.setLineColor(5, "#4d1a1a") // Line 6: Removed (vibrant red)
          editorWithLines.setLineColor(8, "#1a4d1a") // Line 9: Added (fresh green)
          editorWithLines.setLineColor(11, "#4d1a1a") // Line 12: Removed (vibrant red)
          editorWithLines.setLineColor(14, "#1a4d1a") // Line 15: Added (fresh green)
          editorWithLines.setLineColor(17, "#4d1a1a") // Line 18: Removed (vibrant red)
          editorWithLines.setLineColor(20, "#1a4d1a") // Line 21: Added (fresh green)
          editorWithLines.setLineColor(23, "#4d1a1a") // Line 24: Removed (vibrant red)
          editorWithLines.setLineColor(27, "#1a4d1a") // Line 28: Added (fresh green)
          editorWithLines.setLineColor(30, "#4d1a1a") // Line 31: Removed (vibrant red)
          editorWithLines.setLineColor(34, "#1a4d1a") // Line 35: Added (fresh green)
          editorWithLines.setLineColor(38, "#4d1a1a") // Line 39: Removed (vibrant red)
          editorWithLines.setLineColor(42, "#1a4d1a") // Line 43: Added (fresh green)
          editorWithLines.setLineColor(46, "#4d1a1a") // Line 47: Removed (vibrant red)
          editorWithLines.setLineColor(50, "#1a4d1a") // Line 51: Added (fresh green)
          editorWithLines.setLineColor(54, "#4d1a1a") // Line 55: Removed (vibrant red)
          editorWithLines.setLineColor(58, "#1a4d1a") // Line 59: Added (fresh green)
        } else {
          editorWithLines.clearAllLineColors()
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
