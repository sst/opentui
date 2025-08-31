<script setup lang="ts">
import { ref, computed } from "vue"

const tabs = [
  { name: "Text & Attributes", value: 0, description: "" },
  { name: "Basics", value: 1, description: "" },
  { name: "Borders", value: 2, description: "" },
  { name: "Animation", value: 3, description: "" },
  { name: "Titles", value: 4, description: "" },
  { name: "Interactive", value: 5, description: "" },
]

const activeTab = ref(0)

const onTabChange = (index: number) => {
  activeTab.value = index
}

const description = computed(
  () => `Tab ${activeTab.value + 1}/6 - Use Left/Right arrows to navigate | Press Ctrl+C to exit`,
)
</script>

<template>
  <boxRenderable :style="{ flexDirection: 'column', flexGrow: 1 }">
    <tabSelectRenderable
      :height="2"
      width="100%"
      :options="tabs"
      :showDescription="false"
      :onChange="onTabChange"
      :focused="true"
    />
    <boxRenderable :style="{ paddingTop: 1 }">
      <textRenderable :content="description" />
    </boxRenderable>
  </boxRenderable>
</template>
