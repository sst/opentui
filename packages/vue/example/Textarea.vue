<script setup lang="ts">
import { ref, onMounted } from "vue"
import { bold, cyan, fg, t, type TextareaRenderable, type CursorStyleOptions } from "@opentui/core"
import { useKeyboard, useCliRenderer, type RenderableComponentExpose } from "@opentui/vue"

const initialContent = `Welcome to the Vue Textarea Demo!

This is an interactive text editor powered by EditBuffer and EditorView.

NAVIGATION:
  • Arrow keys to move cursor
  • Home/End for line navigation
  • Ctrl+A/Ctrl+E for buffer start/end

SELECTION:
  • Shift+Arrow keys to select
  • Shift+Home/End to select to line start/end

EDITING:
  • Type any text to insert
  • Backspace/Delete to remove text
  • Enter to create new lines
  • Ctrl+D to delete current line

UNDO/REDO:
  • Ctrl+Z to undo
  • Ctrl+Shift+Z or Ctrl+Y to redo

FEATURES:
  ✓ Grapheme-aware cursor movement
  ✓ Unicode support (emoji 🎉 and CJK 你好)
  ✓ Text wrapping and viewport management
  ✓ Undo/redo support

Press ESC to return to main menu`

const cursorStyle = ref<CursorStyleOptions>({ style: "block", blinking: true })
const wrapMode = ref<"word" | "char" | "none">("word")
const statusText = ref("")
let textareaRef: TextareaRenderable | null = null

onMounted(() => {
  const renderer = useCliRenderer()
  renderer.setBackgroundColor("#0D1117")

  renderer.setFrameCallback(async () => {
    if (textareaRef && !textareaRef.isDestroyed) {
      try {
        const cursor = textareaRef.logicalCursor
        const wrap = wrapMode.value.toUpperCase()
        const styleLabel = cursorStyle.value.style.toUpperCase()
        const blinkLabel = cursorStyle.value.blinking ? "Blinking" : "Steady"
        statusText.value = `Line ${cursor.row + 1}, Col ${cursor.col + 1} | Wrap: ${wrap} | Cursor: ${styleLabel} (${blinkLabel})`
      } catch {
        // Ignore errors during shutdown
      }
    }
  })
})

useKeyboard((key) => {
  if (key.shift && key.name === "w") {
    key.preventDefault()
    if (textareaRef && !textareaRef.isDestroyed) {
      const modes: Array<"word" | "char" | "none"> = ["word", "char", "none"]
      const currentIndex = modes.indexOf(wrapMode.value)
      wrapMode.value = modes[(currentIndex + 1) % modes.length]!
      textareaRef.wrapMode = wrapMode.value
    }
  }
  if (key.name === "tab") {
    key.preventDefault()
    if (textareaRef && !textareaRef.isDestroyed) {
      const nextStyle: CursorStyleOptions =
        cursorStyle.value.style === "block" ? { style: "line", blinking: false } : { style: "block", blinking: true }
      cursorStyle.value = nextStyle
      textareaRef.cursorStyle = nextStyle
    }
  }
})

const setTextareaRef = (r: RenderableComponentExpose<TextareaRenderable> | null) => {
  textareaRef = r?.element ?? null
}

const placeholder = t`${fg("#333333")("Enter")} ${cyan(bold("text"))} ${fg("#333333")("here...")}`
</script>

<template>
  <boxRenderable :style="{ padding: 1, flexDirection: 'column' }">
    <boxRenderable
      title="Interactive Editor (TextareaRenderable)"
      titleAlignment="left"
      :style="{
        border: true,
        borderStyle: 'single',
        borderColor: '#6BCF7F',
        backgroundColor: '#0D1117',
        paddingLeft: 1,
        paddingRight: 1,
        flexGrow: 1,
      }"
    >
      <textareaRenderable
        :ref="setTextareaRef"
        :initialValue="initialContent"
        :placeholder="placeholder"
        textColor="#F0F6FC"
        selectionBg="#264F78"
        selectionFg="#FFFFFF"
        :wrapMode="wrapMode"
        :showCursor="true"
        cursorColor="#4ECDC4"
        :cursorStyle="cursorStyle"
        :focused="true"
        :style="{ flexGrow: 1 }"
      />
    </boxRenderable>
    <textRenderable :style="{ fg: '#A5D6FF', height: 1 }">
      {{ statusText }}
    </textRenderable>
    <textRenderable :style="{ fg: '#565f89', height: 1 }">
      Shift+W: wrap mode | Tab: cursor style | ESC: menu
    </textRenderable>
  </boxRenderable>
</template>
