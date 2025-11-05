import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, onMount } from "solid-js"
import { bold, cyan, fg, t, type TextareaRenderable, type CursorStyleOptions } from "@opentui/core"

const initialContent = `Welcome to the TextareaRenderable Demo!

This is an interactive text editor powered by EditBuffer and EditorView.

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
  • Tab to toggle cursor style

FEATURES:
  ✓ Grapheme-aware cursor movement
  ✓ Unicode (emoji 🌟 and CJK 世界)
  ✓ Incremental editing
  ✓ Text wrapping and viewport management
  ✓ Undo/redo support
  ✓ Word-based navigation and deletion
  ✓ Text selection with shift keys

Press ESC to return to main menu`

export function TextareaDemo() {
  const renderer = useRenderer()
  const [cursorStyle, setCursorStyle] = createSignal<CursorStyleOptions>({ style: "block", blinking: true })
  const [wrapMode, setWrapMode] = createSignal<"word" | "char" | "none">("word")
  const [statusText, setStatusText] = createSignal("")
  let textareaRef: TextareaRenderable | null = null

  onMount(() => {
    renderer.setBackgroundColor("#0D1117")

    // Set up frame callback for status updates
    renderer.setFrameCallback(async () => {
      if (textareaRef && !textareaRef.isDestroyed) {
        try {
          const cursor = textareaRef.logicalCursor
          const wrap = wrapMode().toUpperCase()
          const cursorOptions = cursorStyle()
          const styleLabel = cursorOptions.style.toUpperCase()
          const blinkLabel = cursorOptions.blinking ? "Blinking" : "Steady"
          setStatusText(
            `Line ${cursor.row + 1}, Col ${cursor.col + 1} | Wrap: ${wrap} | Cursor: ${styleLabel} (${blinkLabel})`,
          )
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
    if (key.name === "tab") {
      key.preventDefault()
      if (textareaRef && !textareaRef.isDestroyed) {
        const currentStyle = cursorStyle()
        const nextStyle: CursorStyleOptions =
          currentStyle.style === "block" ? { style: "line", blinking: false } : { style: "block", blinking: true }
        setCursorStyle(nextStyle)
        textareaRef.cursorStyle = nextStyle
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
          initialValue={initialContent}
          placeholder={t`${fg("#333333")("Enter")} ${cyan(bold("text"))} ${fg("#333333")("here...")}`}
          textColor="#F0F6FC"
          selectionBg="#264F78"
          selectionFg="#FFFFFF"
          wrapMode={wrapMode()}
          showCursor
          cursorColor="#4ECDC4"
          cursorStyle={cursorStyle()}
          focused
          style={{ flexGrow: 1 }}
        />
      </box>
      <text style={{ fg: "#A5D6FF", height: 1 }}>{statusText()}</text>
    </box>
  )
}
