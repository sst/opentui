<script setup lang="ts">
import { ref, watch } from "vue"
import type { LineNumberRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/vue"
import type { RenderableComponentExpose } from "@opentui/vue"

const showLineNumbers = ref(true)
const currentLine = ref(0)
const wrapMode = ref<"word" | "char" | "none">("word")
const lineNumberRef = ref<RenderableComponentExpose<LineNumberRenderable> | null>(null)

const content = `Welcome to the Line Number Demo!

This example demonstrates the LineNumberRenderable component.
It's perfect for displaying code, logs, or any text where
line numbers are helpful.

Features:
  • Toggle line numbers with 'L'
  • Navigate lines with 'J' (down) and 'K' (up)
  • Toggle wrap mode with 'W'

Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

This is a longer line that will demonstrate how text wrapping works when the content exceeds the available width of the container. Notice how it handles the overflow based on the wrap mode setting.

The quick brown fox jumps over the lazy dog.
Pack my box with five dozen liquor jugs.
How vexingly quick daft zebras jump!

More sample content here...
And another line for good measure.
One more line to make it interesting.`

const lines = content.split("\n")
const lineCount = lines.length

let lastHighlightedLine: number | null = null
watch(
  [currentLine, () => lineNumberRef.value?.element],
  ([line, lineNumber]) => {
    if (!lineNumber) return

    if (lastHighlightedLine !== null) {
      lineNumber.clearLineColor(lastHighlightedLine)
    }

    lineNumber.setLineColor(line, { gutter: "transparent", content: "#1e3a5f" })
    lastHighlightedLine = line
  },
  { immediate: true },
)

useKeyboard((key) => {
  if (key.name === "l" && !key.ctrl && !key.meta) {
    showLineNumbers.value = !showLineNumbers.value
  } else if (key.name === "j" && !key.ctrl && !key.meta) {
    currentLine.value = Math.min(currentLine.value + 1, lineCount - 1)
  } else if (key.name === "k" && !key.ctrl && !key.meta) {
    currentLine.value = Math.max(currentLine.value - 1, 0)
  } else if (key.name === "w" && !key.ctrl && !key.meta) {
    const modes: Array<"word" | "char" | "none"> = ["word", "char", "none"]
    const currentIndex = modes.indexOf(wrapMode.value)
    wrapMode.value = modes[(currentIndex + 1) % modes.length]!
  }
})
</script>

<template>
  <boxRenderable
    :style="{
      flexDirection: 'column',
      padding: 1,
      gap: 1,
    }"
  >
    <!-- Header -->
    <boxRenderable
      :style="{
        backgroundColor: '#1e293b',
        padding: 1,
        border: true,
        borderStyle: 'single',
        borderColor: '#3b82f6',
      }"
    >
      <textRenderable :style="{ fg: '#3b82f6' }"> Line Number Demo </textRenderable>
    </boxRenderable>

    <!-- Controls -->
    <boxRenderable
      :style="{
        flexDirection: 'row',
        gap: 2,
        height: 1,
      }"
    >
      <textRenderable :style="{ fg: '#94a3b8' }">
        L: line numbers ({{ showLineNumbers ? "ON" : "OFF" }})
      </textRenderable>
      <textRenderable :style="{ fg: '#94a3b8' }"> J/K: navigate </textRenderable>
      <textRenderable :style="{ fg: '#94a3b8' }"> W: wrap ({{ wrapMode }}) </textRenderable>
      <textRenderable :style="{ fg: '#64748b' }"> Line {{ currentLine + 1 }}/{{ lineCount }} </textRenderable>
    </boxRenderable>

    <!-- Content Area -->
    <boxRenderable
      :style="{
        flexGrow: 1,
        border: true,
        borderStyle: 'rounded',
        borderColor: '#475569',
        backgroundColor: '#0f172a',
      }"
    >
      <lineNumberRenderable
        ref="lineNumberRef"
        :showLineNumbers="showLineNumbers"
        fg="#64748b"
        bg="#1e293b"
        :minWidth="3"
        :paddingRight="1"
        width="100%"
        height="100%"
      >
        <textareaRenderable
          :initialValue="content"
          :wrapMode="wrapMode"
          textColor="#e2e8f0"
          backgroundColor="transparent"
          selectionBg="#264F78"
          selectionFg="#FFFFFF"
          width="100%"
          height="100%"
        />
      </lineNumberRenderable>
    </boxRenderable>

    <!-- Footer -->
    <textRenderable :style="{ fg: '#565f89', height: 1 }"> Press ESC to return to menu </textRenderable>
  </boxRenderable>
</template>
