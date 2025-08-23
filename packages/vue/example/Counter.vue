<script setup lang="ts">
import { getKeyHandler, RGBA, type BoxOptions, type ParsedKey } from "@opentui/core"
import { onUnmounted, ref } from "vue"

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
</script>

<template>
  <box title="Counter" :style="boxStyles">
    <text :style="textStyles">Count: {{ count }}</text>
    <text :style="textStyles">Press Up/Down to increment/decrement, R to reset</text>
    <text :style="textStyles">Press + or = to increment, - to decrement</text>
    <text :style="textStyles">Press R to reset</text>
  </box>
</template>
