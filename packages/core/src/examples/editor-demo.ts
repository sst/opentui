import { CliRenderer, createCliRenderer, TextareaRenderable, BoxRenderable, TextRenderable, KeyEvent } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

const initialContent = `Welcome to the TextareaRenderable Demo!

This is an interactive text editor powered by EditBuffer and EditorView.

NAVIGATION:
  • Arrow keys to move cursor
  • Home/End for line navigation
  • Ctrl+PageUp/PageDown for buffer start/end

EDITING:
  • Type any text to insert
  • Backspace/Delete to remove text
  • Enter to create new lines
  • Ctrl+D to delete current line
  • Ctrl+K to delete to line end

VIEW:
  • Shift+W to toggle wrap mode (word/char/none)

FEATURES:
  ✓ Grapheme-aware cursor movement
  ✓ Unicode (emoji 🌟 and CJK 世界)
  ✓ Incremental editing
  ✓ Text wrapping
  ✓ Viewport management

Press ESC to return to main menu`

let renderer: CliRenderer | null = null
let parentContainer: BoxRenderable | null = null
let editor: TextareaRenderable | null = null
let statusText: TextRenderable | null = null

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
    paddingLeft: 1,
    paddingRight: 1,
    border: true,
  })
  parentContainer.add(editorBox)

  // Create interactive editor
  editor = new TextareaRenderable(renderer, {
    id: "editor",
    value: initialContent,
    textColor: "#F0F6FC",
    selectionBg: "#264F78",
    selectionFg: "#FFFFFF",
    wrapMode: "word",
    showCursor: true,
    cursorColor: "#4ECDC4",
  })
  editorBox.add(editor)

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
        const cursor = editor.cursor
        const wrap = editor.wrapMode !== "none" ? "ON" : "OFF"
        statusText.content = `Line ${cursor.line + 1}, Col ${cursor.visualColumn + 1} | Wrap: ${wrap}`
      } catch (error) {
        // Ignore errors during shutdown
      }
    }
  })

  rendererInstance.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.shift && key.name === "w") {
      key.preventDefault()
      if (editor && !editor.isDestroyed) {
        const currentMode = editor.wrapMode
        const nextMode = currentMode === "word" ? "char" : currentMode === "char" ? "none" : "word"
        editor.wrapMode = nextMode
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
