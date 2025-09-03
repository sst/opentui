<template>
  <scrollBoxRenderable
    ref="scrollBoxRef"
    width="100%"
    height="100%"
    :border="true"
    :style="{
      scrollbarOptions: {
        showArrows: true,
        thumbOptions: {
          backgroundColor: '#7aa2f7',
        },
        trackOptions: {
          backgroundColor: '#414868',
        },
      },
    }"
  >
    <boxRenderable flexDirection="column" :gap="2">
      <textRenderable v-for="item in items" :key="item"> Item {{ item }} </textRenderable>
    </boxRenderable>
  </scrollBoxRenderable>
</template>

<!-- rootOptions: {
  backgroundColor: "#24283b",
  border: true,
},
wrapperOptions: {
  backgroundColor: "#1f2335",
},
viewportOptions: {
  backgroundColor: "#1a1b26",
}, -->

<script setup lang="ts">
import { ScrollBarRenderable } from "@opentui/core"
import { onMounted, shallowRef } from "vue"

const scrollBoxRef = shallowRef<ScrollBarRenderable | null>(null)
const items = Array.from({ length: 1000 }, (_, i) => i + 1)

onMounted(() => {
  if (scrollBoxRef.value) {
    scrollBoxRef.value.focus()
    scrollBoxRef.value.showArrows = true
  }
})
</script>
