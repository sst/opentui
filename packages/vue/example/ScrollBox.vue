<template>
  <scrollBoxRenderable
    ref="scrollBoxRef"
    width="100%"
    height="100%"
    :border="true"
    :style="{
      //does not works
      wrapperOptions: {
        backgroundColor: '#ff0000',
      },
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

<script setup lang="ts">
import { type ScrollBoxRenderable } from "@opentui/core"
import { onMounted, shallowRef } from "vue"
import { useCliRenderer } from "@opentui/vue"

const scrollBoxRef = shallowRef<ScrollBoxRenderable | null>(null)
const items = Array.from({ length: 1000 }, (_, i) => i + 1)

const renderer = useCliRenderer()

onMounted(() => {
  if (scrollBoxRef.value) {
    scrollBoxRef.value.focus()
    // works
    scrollBoxRef.value.wrapper.backgroundColor = "#25f788"
    renderer.requestRender()
  }
})
</script>
