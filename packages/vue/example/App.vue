<script setup lang="ts">
import ASCII from "./ASCII.vue"
import LoginForm from "./LoginForm.vue"
import Counter from "./Counter.vue"
import StyledText from "./dist/Styled-Text.vue"
import { onMounted, onUnmounted, ref } from "vue"
import { getKeyHandler } from "@opentui/core"

const exampleOptions = [
  { name: "ASCII", description: "Assci text example", value: "ascii" },
  { name: "Counter", description: "Counter example", value: "counter" },
  { name: "Login Form", description: "A simple login form example", value: "login" },
  { name: "Styled Text", description: "Text with various styles applied", value: "styledText" },
] as const

type ExampleOption = (typeof exampleOptions)[number]

const selectedExample = ref<null | ExampleOption>(null)

const onSelectExample = (_, option: ExampleOption | null) => {
  selectedExample.value = option
}

getKeyHandler().on("keypress", (key) => {
  if (key.name === "escape") {
    selectedExample.value = null
  }
})

const boxStyles = { height: 8, marginBottom: 1 }
const selectStyles = { flexGrow: 1 }
</script>

<template>
  <ASCII v-if="selectedExample?.value === 'ascii'" />
  <Counter v-else-if="selectedExample?.value === 'counter'" />
  <LoginForm v-else-if="selectedExample?.value === 'login'" />
  <StyledText v-else-if="selectedExample?.value === 'styledText'" />
  <box v-else :style="boxStyles">
    <select
      :style="selectStyles"
      focused="true"
      showScrollIndicator
      :options="exampleOptions"
      :onSelect="onSelectExample"
      :value="selectedExample"
    ></select>
  </box>
</template>
