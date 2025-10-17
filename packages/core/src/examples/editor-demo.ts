import {
  CliRenderer,
  createCliRenderer,
  EditorRenderable,
  BoxRenderable,
  TextRenderable,
  type ParsedKey,
  KeyEvent,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { parseColor } from "../lib/RGBA"

const initialContent = `Welcome to the EditorRenderable Demo!

This is an interactive text editor powered by EditBuffer and EditorView.

Try the following commands:
  • Type any text to insert
  • Arrow keys to move cursor
  • Backspace/Delete to remove text
  • Enter to create new lines
  • Ctrl+D to delete current line
  • Ctrl+K to delete to line end
  • Ctrl+J to join lines
  • Home/End for line navigation
  • Ctrl+A/E for buffer start/end

The editor supports:
  ✓ Grapheme-aware cursor movement
  ✓ Unicode (emoji 🌟 and CJK 世界)
  ✓ Incremental editing
  ✓ Text wrapping
  ✓ Viewport management`

let renderer: CliRenderer | null = null
let parentContainer: BoxRenderable | null = null
let editor: EditorRenderable | null = null
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

  const titleBox = new BoxRenderable(renderer, {
    id: "title-box",
    height: 3,
    borderStyle: "double",
    borderColor: "#4ECDC4",
    backgroundColor: "#0D1117",
    title: "EditorRenderable Interactive Demo",
    titleAlignment: "center",
    border: true,
  })
  parentContainer.add(titleBox)

  const instructionsText = new TextRenderable(renderer, {
    id: "instructions",
    content:
      "ESC to return | Type to edit | Arrows to move | Backspace/Del | Enter for newline | Shift+W toggle wrap | Ctrl+L debug rope",
    fg: "#888888",
  })
  titleBox.add(instructionsText)

  const editorBox = new BoxRenderable(renderer, {
    id: "editor-box",
    borderStyle: "single",
    borderColor: "#6BCF7F",
    backgroundColor: "#0D1117",
    title: "Interactive Editor (EditorRenderable)",
    titleAlignment: "left",
    paddingLeft: 1,
    paddingRight: 1,
    border: true,
  })
  parentContainer.add(editorBox)

  // Create interactive editor
  editor = new EditorRenderable(renderer, {
    id: "editor",
    content: initialContent,
    fg: "#F0F6FC",
    bg: "#0D1117",
    selectionBg: "#264F78",
    selectionFg: "#FFFFFF",
    wrapMode: "word",
    showCursor: true,
    cursorColor: "#4ECDC4",
  })
  editorBox.add(editor)

  statusText = new TextRenderable(renderer, {
    id: "status",
    content: "", // Will be updated after focus
    fg: "#A5D6FF",
    height: 1,
  })
  parentContainer.add(statusText)

  // Focus the editor so cursor shows and keys work
  editor.focus()

  // Update status bar on every frame
  rendererInstance.setFrameCallback(async () => {
    if (statusText && editor && !editor.isDestroyed) {
      try {
        const cursor = editor.cursor
        const viewport = editor.editorView.getViewport()
        const vlines = editor.editorView.getVirtualLineCount()
        const wrap = editor.wrapMode !== "none" ? "ON" : "OFF"

        statusText.content = `Line ${cursor.line + 1}, Col ${cursor.visualColumn + 1} | Virtual Lines: ${vlines} | Viewport: ${viewport.height}x${viewport.width} (offset ${viewport.offsetY}) | Wrap: ${wrap}`
      } catch (error) {
        // Ignore errors during shutdown
      }
    }
  })

  // Add keypress handler for debug logging and wrap mode toggling
  rendererInstance.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "l") {
      // Ctrl+L to debug log rope
      if (editor && !editor.isDestroyed) {
        editor.editBuffer.debugLogRope()
      }
    }
    if (key.shift && key.name === "w") {
      // Shift+W to toggle wrap mode
      if (editor && !editor.isDestroyed) {
        const currentMode = editor.wrapMode
        const nextMode = currentMode === "word" ? "char" : currentMode === "char" ? "none" : "word"
        editor.wrapMode = nextMode
      }
    }
  })
}

export function destroy(rendererInstance: CliRenderer): void {
  // Clear frame callbacks to stop status updates
  rendererInstance.clearFrameCallbacks()

  // Destroy all renderables
  parentContainer?.destroy()

  // Clear references
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
