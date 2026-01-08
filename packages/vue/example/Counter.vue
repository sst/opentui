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
  <box title="Counter" :style="{ backgroundColor: '#00ff00' }">
    <Text :style="textStyles">Count : {{ count }}</Text>
    <Text :style="textStyles">Press Up/Down to increment/decrement, R to reset</Text>
    <Text :style="textStyles">Press + or = to increment, - to decrement</Text>
    <Text :style="{ fg: '#ff00ff' }">Press R to reset</Text>
  </box>
</template>
