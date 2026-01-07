<script setup lang="ts">
import { RGBA, type KeyEvent } from "@opentui/core"
import { ref } from "vue"
import { useKeyboard } from "@opentui/vue"

const count = ref(0)

useKeyboard((key: KeyEvent) => {
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
