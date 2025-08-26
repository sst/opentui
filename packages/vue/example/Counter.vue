<script setup lang="ts">
import { getKeyHandler, RGBA, type ParsedKey } from "@opentui/core"
import { computed, onUnmounted, ref } from "vue"

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

const textStyles = { fg: RGBA.fromHex("#0000ff") }
</script>

<template>
  <boxRenderable title="Counter" :style="{ backgroundColor: '#00ff00' }">
    <textRenderable :style="textStyles">Count : {{ count }}</textRenderable>
    <textRenderable :style="textStyles">Press Up/Down to increment/decrement, R to reset</textRenderable>
    <textRenderable :style="textStyles">Press + or = to increment, - to decrement</textRenderable>
    <textRenderable :style="{ fg: '#ff00ff' }">Press R to reset</textRenderable>
  </boxRenderable>
</template>
