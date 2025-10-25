import {
  CliRenderer,
  createCliRenderer,
  TextareaRenderable,
  BoxRenderable,
  TextRenderable,
  KeyEvent,
  type ExtmarksController,
  type ExtmarkDeletedEvent,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { SyntaxStyle } from "../syntax-style"
import { RGBA } from "../lib/RGBA"

const initialContent = `Welcome to the Extmarks Demo!

This demo showcases virtual extmarks - text ranges that the cursor jumps over.

Try moving your cursor through the [VIRTUAL] markers below:
- Use arrow keys to navigate
- Notice how the cursor skips over [VIRTUAL] ranges
- Try backspacing at the end of a [VIRTUAL] marker
- It will delete the entire marker!

Example text with [LINK:https://example.com] embedded links.
You can also have [TAG:important] tags that act like atoms.

Regular text here can be edited normally.

Press Ctrl+L to add a new [MARKER] at cursor position.
Press ESC to return to main menu.`

let renderer: CliRenderer | null = null
let parentContainer: BoxRenderable | null = null
let editor: TextareaRenderable | null = null
let statusText: TextRenderable | null = null
let helpText: TextRenderable | null = null
let extmarksController: ExtmarksController | null = null
let syntaxStyle: SyntaxStyle | null = null
let virtualStyleId: number = 0

export async function run(rendererInstance: CliRenderer): Promise<void> {
  renderer = rendererInstance
  renderer.start()
  renderer.setBackgroundColor("#0D1117")

  syntaxStyle = SyntaxStyle.create()
  virtualStyleId = syntaxStyle.registerStyle("virtual", {
    fg: RGBA.fromValues(0.3, 0.7, 1.0, 1.0),
    bg: RGBA.fromValues(0.1, 0.2, 0.3, 1.0),
  })

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
    title: "Extmarks Demo - Virtual Text Ranges",
    titleAlignment: "left",
    paddingLeft: 1,
    paddingRight: 1,
    border: true,
  })
  parentContainer.add(editorBox)

  editor = new TextareaRenderable(renderer, {
    id: "editor",
    initialValue: initialContent,
    textColor: "#F0F6FC",
    selectionBg: "#264F78",
    selectionFg: "#FFFFFF",
    wrapMode: "word",
    showCursor: true,
    cursorColor: "#4ECDC4",
    syntaxStyle,
  })
  editorBox.add(editor)

  extmarksController = editor.extmarks
  if (!extmarksController) {
    throw new Error("Failed to create extmarks controller")
  }

  findAndMarkVirtualRanges()

  extmarksController.on("extmark-deleted", (event: ExtmarkDeletedEvent) => {
    if (helpText) {
      const extmark = event.extmark
      helpText.content = `Deleted extmark at ${extmark.start}-${extmark.end} via ${event.trigger}`
    }
  })

  helpText = new TextRenderable(renderer, {
    id: "help",
    content: "Move cursor with arrows. Try backspacing at end of [VIRTUAL] markers!",
    fg: "#FFA657",
    height: 1,
  })
  parentContainer.add(helpText)

  statusText = new TextRenderable(renderer, {
    id: "status",
    content: "",
    fg: "#A5D6FF",
    height: 1,
  })
  parentContainer.add(statusText)

  editor.focus()

  rendererInstance.setFrameCallback(async () => {
    if (statusText && editor && !editor.isDestroyed && extmarksController) {
      try {
        const cursor = editor.logicalCursor
        const offset = editor.cursorOffset
        const extmarksAtCursor = extmarksController.getAtOffset(offset)
        const virtualCount = extmarksController.getVirtual().length

        let extmarkInfo = ""
        if (extmarksAtCursor.length > 0) {
          extmarkInfo = ` | Inside extmark(s): ${extmarksAtCursor.length}`
        }

        statusText.content = `Line ${cursor.row + 1}, Col ${cursor.col + 1}, Offset ${offset} | Virtual extmarks: ${virtualCount}${extmarkInfo}`
      } catch (error) {
        // Ignore errors during shutdown
      }
    }
  })

  rendererInstance.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "l") {
      key.preventDefault()
      if (editor && !editor.isDestroyed && extmarksController) {
        const offset = editor.cursorOffset
        const markerText = "[MARKER]"
        editor.insertText(markerText)

        extmarksController.create({
          start: offset,
          end: offset + markerText.length,
          virtual: true,
          styleId: virtualStyleId,
          data: { type: "marker", added: "manual" },
        })

        if (helpText) {
          helpText.content = `Added virtual marker at offset ${offset}!`
        }
      }
    }
  })
}

function findAndMarkVirtualRanges(): void {
  if (!editor || !extmarksController) return

  const text = editor.plainText
  const pattern = /\[(VIRTUAL|LINK:[^\]]+|TAG:[^\]]+|MARKER)\]/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const start = match.index
    const end = match.index + match[0].length

    extmarksController.create({
      start,
      end,
      virtual: true,
      styleId: virtualStyleId,
      data: { type: "auto-detected", content: match[0] },
    })
  }
}

export function destroy(rendererInstance: CliRenderer): void {
  rendererInstance.clearFrameCallbacks()
  extmarksController?.destroy()
  extmarksController = null
  syntaxStyle?.destroy()
  syntaxStyle = null
  parentContainer?.destroy()
  parentContainer = null
  editor = null
  statusText = null
  helpText = null
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
