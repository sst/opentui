<script setup lang="ts">
import ASCII from "./ASCII.vue"
import LoginForm from "./LoginForm.vue"
import Counter from "./Counter.vue"
import StyledText from "./Styled-Text.vue"
import TabSelect from "./TabSelect.vue"
import ScrollBox from "./ScrollBox.vue"
import Code from "./Code.vue"
import Diff from "./Diff.vue"
import Textarea from "./Textarea.vue"
import Animation from "./Animation.vue"
import LineNumber from "./LineNumber.vue"
import { ref } from "vue"
import ExtendExample from "./ExtendExample.vue"
import { useKeyboard } from "@opentui/vue"

const exampleOptions = [
  { name: "ASCII", description: "ASCII text example", value: "ascii" },
  { name: "Counter", description: "Counter example", value: "counter" },
  { name: "Login Form", description: "A simple login form example", value: "login" },
  { name: "Styled Text", description: "Text with various styles applied", value: "styledText" },
  { name: "Tab Select", description: "Tabs", value: "tabSelect" },
  { name: "Extend", description: "Extend example", value: "extend" },
  { name: "ScrollBox", description: "ScrollBox example", value: "scrollBox" },
  { name: "Code", description: "Syntax highlighting demo", value: "code" },
  { name: "Diff", description: "Diff view demo", value: "diff" },
  { name: "Textarea", description: "Interactive editor demo", value: "textarea" },
  { name: "Animation", description: "Timeline animation demo", value: "animation" },
  { name: "Line Number", description: "Line numbers demo", value: "lineNumber" },
]

type ExampleOption = (typeof exampleOptions)[number]

const selectedExample = ref<null | ExampleOption>(null)

const onSelectExample = (i: number) => {
  const selectedOption = exampleOptions[i]
  if (!selectedOption) return
  selectedExample.value = selectedOption
}

useKeyboard((key) => {
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
  <TabSelect v-else-if="selectedExample?.value === 'tabSelect'" />
  <ExtendExample v-else-if="selectedExample?.value === 'extend'" />
  <ScrollBox v-else-if="selectedExample?.value === 'scrollBox'" />
  <Code v-else-if="selectedExample?.value === 'code'" />
  <Diff v-else-if="selectedExample?.value === 'diff'" />
  <Textarea v-else-if="selectedExample?.value === 'textarea'" />
  <Animation v-else-if="selectedExample?.value === 'animation'" />
  <LineNumber v-else-if="selectedExample?.value === 'lineNumber'" />
  <boxRenderable v-else :style="boxStyles">
    <selectRenderable
      :style="selectStyles"
      :focused="true"
      showScrollIndicator
      :options="exampleOptions"
      :onSelect="onSelectExample"
      :value="selectedExample"
    ></selectRenderable>
  </boxRenderable>
</template>
