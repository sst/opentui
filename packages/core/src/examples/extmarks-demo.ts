import {
  CliRenderer,
  createCliRenderer,
  TextareaRenderable,
  BoxRenderable,
  TextRenderable,
  KeyEvent,
  type ExtmarksController,
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { SyntaxStyle } from "../syntax-style"
import { RGBA } from "../lib/RGBA"

const initialContent = `Welcome to the Extmarks Demo!

This demo showcases virtual extmarks with "select then act" interaction.

Try moving your cursor through the markers below:
- Arrow into a marker to SELECT it (cursor stops, actions shown)
- Arrow again to SKIP past the selected marker
- Press Enter to EXPAND a selected marker (e.g. link -> url)
- Press Backspace to DELETE a selected marker entirely
- Move away to auto-deselect

Example text with [LINK:https://example.com] embedded links.
You can also have [TAG:important] tags that act like atoms.
Here is a [VIRTUAL] marker that expands to nothing.

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

const hookState = { message: "" }
const selectionState: { id: number | null; label: string | null } = {
  id: null,
  label: null,
}

function clearSelection(): void {
  selectionState.id = null
  selectionState.label = null
  editor?.editorView.resetSelection()
}

function createOnEncounter(label: string) {
  return (encounter: {
    extmark: { id: number; start: number; end: number }
    direction: string
    skip: () => void
    setCursor: (offset: number) => void
  }) => {
    if (selectionState.id === encounter.extmark.id) {
      clearSelection()
      hookState.message = `Skipped past ${label}`
      encounter.skip()
    } else {
      selectionState.id = encounter.extmark.id
      selectionState.label = label
      hookState.message = `Selected ${label} — Enter:expand  Backspace:delete  Arrow:skip`
      encounter.setCursor(encounter.extmark.start)
      editor?.editorView.setSelection(encounter.extmark.start, encounter.extmark.end)
    }
  }
}

function createOnDeletion(label: string) {
  return (encounter: { direction: string; deleteExtmark: () => void }) => {
    hookState.message = `Deleted ${label} (${encounter.direction})`
    clearSelection()
    encounter.deleteExtmark()
  }
}

function getExpansion(label: string): string | null {
  const linkMatch = label.match(/^\[LINK:(.+)\]$/)
  if (linkMatch) return linkMatch[1]
  const tagMatch = label.match(/^\[TAG:(.+)\]$/)
  if (tagMatch) return `#${tagMatch[1]}`
  return null
}

function expandSelectedExtmark(): void {
  if (!editor || !extmarksController || selectionState.id === null || selectionState.label === null) return
  const extmark = extmarksController.get(selectionState.id)
  if (!extmark) return

  const replacement = getExpansion(selectionState.label)
  const id = selectionState.id
  const label = selectionState.label
  const start = extmark.start

  extmarksController.delete(id)

  const startPos = editor.editBuffer.offsetToPosition(start)
  const endPos = editor.editBuffer.offsetToPosition(extmark.end)
  if (!startPos || !endPos) return

  editor.editBuffer.deleteRange(startPos.row, startPos.col, endPos.row, endPos.col)
  editor.editBuffer.setCursorByOffset(start)

  if (replacement) {
    editor.insertText(replacement)
    hookState.message = `Expanded ${label} → ${replacement}`
  } else {
    hookState.message = `Removed ${label}`
  }

  clearSelection()
}

function deleteSelectedExtmark(): void {
  if (!editor || !extmarksController || selectionState.id === null || selectionState.label === null) return
  const extmark = extmarksController.get(selectionState.id)
  if (!extmark) return

  const label = selectionState.label
  const start = extmark.start

  extmarksController.delete(selectionState.id)

  const startPos = editor.editBuffer.offsetToPosition(start)
  const endPos = editor.editBuffer.offsetToPosition(extmark.end)
  if (!startPos || !endPos) return

  editor.editBuffer.deleteRange(startPos.row, startPos.col, endPos.row, endPos.col)
  editor.editBuffer.setCursorByOffset(start)
  hookState.message = `Deleted ${label}`

  clearSelection()
}

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

  helpText = new TextRenderable(renderer, {
    id: "help",
    content: "Arrow into a marker to select it, then act on it",
    fg: "#FFA657",
    height: 1,
  })
  parentContainer.add(helpText)

  hookState.message = ""
  selectionState.id = null
  selectionState.label = null
  findAndMarkVirtualRanges()

  editor.focus()

  let lastCombined = ""
  rendererInstance.setFrameCallback(async () => {
    if (helpText && editor && !editor.isDestroyed && extmarksController) {
      try {
        if (selectionState.id !== null) {
          const extmark = extmarksController.get(selectionState.id)
          if (extmark) {
            const cursorOff = editor.cursorOffset
            if (cursorOff < extmark.start || cursorOff >= extmark.end) {
              clearSelection()
              hookState.message = ""
            }
          } else {
            clearSelection()
            hookState.message = ""
          }
        }
        const cursor = editor.logicalCursor
        const hook = hookState.message || "Arrow into a marker to select it"
        const combined = `${hook} | Line ${cursor.row + 1}, Col ${cursor.col + 1}`
        if (combined !== lastCombined) {
          lastCombined = combined
          helpText.content = combined
        }
      } catch {}
    }
  })

  rendererInstance.keyInput.on("keypress", (key: KeyEvent) => {
    if (selectionState.id !== null) {
      if (key.name === "return") {
        key.preventDefault()
        expandSelectedExtmark()
        return
      }
      if (key.name === "backspace" || key.name === "delete") {
        key.preventDefault()
        deleteSelectedExtmark()
        return
      }
      if (key.name === "right" || key.name === "down") {
        key.preventDefault()
        const extmark = extmarksController?.get(selectionState.id)
        const label = selectionState.label
        clearSelection()
        hookState.message = `Skipped past ${label}`
        if (extmark && editor) {
          editor.cursorOffset = extmark.end
        }
        return
      }
      if (key.name === "left" || key.name === "up") {
        key.preventDefault()
        const extmark = extmarksController?.get(selectionState.id)
        const label = selectionState.label
        clearSelection()
        hookState.message = `Skipped past ${label}`
        if (extmark && editor && extmark.start > 0) {
          editor.cursorOffset = extmark.start - 1
        }
        return
      }
    }

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
          onEncounter: createOnEncounter(markerText),
          onDeletion: createOnDeletion(markerText),
        })

        hookState.message = `Added marker at offset ${offset}`
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
    const label = match[0]

    extmarksController.create({
      start,
      end,
      virtual: true,
      styleId: virtualStyleId,
      data: { type: "auto-detected", content: label },
      onEncounter: createOnEncounter(label),
      onDeletion: createOnDeletion(label),
    })
  }
}

export function destroy(rendererInstance: CliRenderer): void {
  rendererInstance.clearFrameCallbacks()
  clearSelection()
  hookState.message = ""
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
