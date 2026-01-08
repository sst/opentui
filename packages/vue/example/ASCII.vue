<script setup lang="ts">
import { measureText } from "@opentui/core"
import type { SelectOption } from "@opentui/core"
import { ref, computed } from "vue"

const text = "ASCII"
const font = ref<"block" | "shade" | "slick" | "tiny">("tiny")

const dimensions = computed(() => {
  return measureText({
    text,
    font: font.value,
  })
})

const handleFontChange = (_index: number, option: SelectOption | null) => {
  if (!option?.value) return
  font.value = option.value as typeof font.value
}

const selectOptions = [
  {
    name: "Tiny",
    description: "Tiny font",
    value: "tiny",
  },
  {
    name: "Block",
    description: "Block font",
    value: "block",
  },
  {
    name: "Slick",
    description: "Slick font",
    value: "slick",
  },
  {
    name: "Shade",
    description: "Shade font",
    value: "shade",
  },
]

const groupStyles = { paddingLeft: 1, paddingRight: 1 }
const boxStyles = { height: 8, marginBottom: 1 }
const selectStyles = { flexGrow: 1 }
</script>

<template>
  <box :style="groupStyles">
    <box :style="boxStyles">
      <Select
        :focused="true"
        showScrollIndicator
        :onChange="handleFontChange"
        :options="selectOptions"
        :style="selectStyles"
      ></Select>
    </box>
    <ascii-font :style="{ width: dimensions.width, height: dimensions.height }" :text="text" :font="font" />
  </box>
</template>
