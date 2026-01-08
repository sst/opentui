<template>
  <scrollbox
    width="100%"
    height="100%"
    :border="true"
    :style="{
      wrapperOptions: {
        backgroundColor: '#f04426',
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
    <box flexDirection="column" :gap="2">
      <Text v-for="item in items" :key="item"> Item {{ item }} </Text>
    </box>
  </scrollbox>
</template>

<script setup lang="ts">
import { type ScrollBoxRenderable } from "@opentui/core"

const items = Array.from({ length: 1000 }, (_, i) => i + 1)
</script>
