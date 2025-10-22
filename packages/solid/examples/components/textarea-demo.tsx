import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, onMount } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"

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

export function TextareaDemo() {
  const renderer = useRenderer()
  const [wrapMode, setWrapMode] = createSignal<"word" | "char" | "none">("word")
  const [statusText, setStatusText] = createSignal("")
  let textareaRef: TextareaRenderable | null = null

  onMount(() => {
    renderer.setBackgroundColor("#0D1117")

    // Set up frame callback for status updates
    renderer.setFrameCallback(async () => {
      if (textareaRef && !textareaRef.isDestroyed) {
        try {
          const cursor = textareaRef.cursor
          const wrap = wrapMode() !== "none" ? "ON" : "OFF"
          setStatusText(`Line ${cursor.line + 1}, Col ${cursor.visualColumn + 1} | Wrap: ${wrap}`)
        } catch (error) {
          // Ignore errors during shutdown
        }
      }
    })
  })

  useKeyboard((key) => {
    if (key.shift && key.name === "w") {
      key.preventDefault()
      if (textareaRef && !textareaRef.isDestroyed) {
        const currentMode = wrapMode()
        const nextMode = currentMode === "word" ? "char" : currentMode === "char" ? "none" : "word"
        setWrapMode(nextMode)
        textareaRef.wrapMode = nextMode
      }
    }
    if (key.ctrl && (key.name === "pageup" || key.name === "pagedown")) {
      key.preventDefault()
      if (textareaRef && !textareaRef.isDestroyed) {
        if (key.name === "pageup") {
          textareaRef.editBuffer.setCursor(0, 0)
        } else {
          textareaRef.gotoBufferEnd()
        }
      }
    }
  })

  return (
    <box style={{ padding: 1 }}>
      <box
        title="Interactive Editor (TextareaRenderable)"
        borderStyle="single"
        borderColor="#6BCF7F"
        backgroundColor="#0D1117"
        titleAlignment="left"
        paddingLeft={1}
        paddingRight={1}
        border
        style={{ flexGrow: 1 }}
      >
        <textarea
          ref={(r: TextareaRenderable) => (textareaRef = r)}
          value={initialContent}
          textColor="#F0F6FC"
          selectionBg="#264F78"
          selectionFg="#FFFFFF"
          wrapMode={wrapMode()}
          showCursor
          cursorColor="#4ECDC4"
          focused
          style={{ flexGrow: 1 }}
        />
      </box>
      <text style={{ fg: "#A5D6FF", height: 1 }}>{statusText()}</text>
    </box>
  )
}
