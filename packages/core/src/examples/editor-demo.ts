import {
  CliRenderer,
  createCliRenderer,
  EditorRenderable,
  BoxRenderable,
  TextRenderable,
  type ParsedKey,
  KeyEvent,
  t,
  bold,
  fg,
  green,
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
let helpOverlay: BoxRenderable | null = null

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
    content: "Press ? for help",
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
    if (key.name === "?") {
      key.preventDefault()
      if (helpOverlay) {
        helpOverlay.destroy()
        helpOverlay = null
        editor?.focus()
      } else {
        showHelpOverlay(rendererInstance)
      }
    }
    if (key.ctrl && key.name === "l") {
      key.preventDefault()
      if (editor && !editor.isDestroyed) {
        editor.editBuffer.debugLogRope()
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
  })
}

function showHelpOverlay(rendererInstance: CliRenderer): void {
  const overlay = new BoxRenderable(rendererInstance, {
    id: "help-overlay",
    zIndex: 100,
    width: 70,
    height: 30,
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -35,
    marginTop: -15,
    border: true,
    borderStyle: "double",
    borderColor: "#4ECDC4",
    backgroundColor: "#161B22",
    padding: 2,
    title: "Editor Help",
    titleAlignment: "center",
  })
  rendererInstance.root.add(overlay)

  const helpContent = t`${bold(fg("#4ECDC4")("Navigation:"))}
  ${green("Arrow Keys")}      Move cursor
  ${green("Home / End")}      Start/end of line
  ${green("Ctrl+A / Ctrl+E")} Start/end of buffer

${bold(fg("#4ECDC4")("Editing:"))}
  ${green("Type")}            Insert text
  ${green("Enter")}           New line
  ${green("Backspace / Del")} Delete text
  ${green("Ctrl+D")}          Delete current line
  ${green("Ctrl+K")}          Delete to line end
  ${green("Ctrl+J")}          Join lines

${bold(fg("#4ECDC4")("View:"))}
  ${green("Shift+W")}         Toggle wrap mode (word/char/none)

${bold(fg("#4ECDC4")("Demo:"))}
  ${green("?")}               Toggle this help
  ${green("ESC")}             Return to main menu
  ${green("Ctrl+L")}          Debug log rope structure

${fg("#888888")("Press ? to close")}`

  const helpText = new TextRenderable(rendererInstance, {
    id: "help-text",
    content: helpContent,
    fg: "#F0F6FC",
  })
  overlay.add(helpText)

  helpOverlay = overlay
}

export function destroy(rendererInstance: CliRenderer): void {
  rendererInstance.clearFrameCallbacks()
  parentContainer?.destroy()
  helpOverlay?.destroy()
  parentContainer = null
  editor = null
  statusText = null
  helpOverlay = null
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
