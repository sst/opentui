<script setup lang="ts">
import { getKeyHandler, RGBA, TextRenderable, type BoxOptions, type ParsedKey } from "@opentui/core"
import { onUnmounted, ref, type VNodeRef } from "vue"

const count = ref(0)

function handleKeyPress(key: ParsedKey): void {
  switch (key.name) {
    case "up":
    case "+":
    case "=":
      count.value++
      break
    case "down":
    case "-":
      count.value--
      break
    case "r":
    case "R":
      count.value = 0
      break
  }
}

getKeyHandler().on("keypress", handleKeyPress)

onUnmounted(() => {
  getKeyHandler().off("keypress", handleKeyPress)
})

const boxStyles: BoxOptions = {
  backgroundColor: RGBA.fromHex("#f0f000"),
  padding: 1,
  borderColor: RGBA.fromHex("#0000ff"),
}
const textStyles = { fg: RGBA.fromHex("#0000ff") }

const textRef = ref<TextRenderable | null>(null)
</script>

<template>
  <box title="Counter" :style="{ backgroundColor: '#00ff00' }">
    <textRenderable :ref="textRef" :style="textStyles">Count: {{ count }}</textRenderable>
    <textRenderable :style="textStyles">Press Up/Down to increment/decrement, R to reset</textRenderable>
    <textRenderable :style="textStyles">Press + or = to increment, - to decrement</textRenderable>
    <textRenderable :style="{ fg: '#ff00ff' }">Press R to reset</textRenderable>
  </box>
</template>
