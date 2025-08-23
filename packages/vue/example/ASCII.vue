<script setup lang="ts">
import { measureText, SelectRenderable } from "@opentui/core"
import { ref, computed } from "vue"

const text = "ASCII"
const font = ref<"block" | "shade" | "slick" | "tiny">("tiny")

const dimensions = computed(() => {
  return measureText({
    text,
    font: font.value,
  })
})

const handleFontChange = (_: any, option: any) => {
  font.value = option?.value
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

const selectRef = ref<SelectRenderable | null>(null)
</script>

<template>
  <group :style="groupStyles">
    <box :style="boxStyles">
      <select
        ref="selectRef"
        focused="true"
        showScrollIndicator
        :onChange="handleFontChange"
        :options="selectOptions"
        :style="selectStyles"
      ></select>
    </box>
    <ascii-font :style="{ width: dimensions.width, height: dimensions.height }" :text="text" :font="font" />
  </group>
</template>
