<script setup lang="ts">
import { ref } from "vue"
import { useTimeline, useTerminalDimensions } from "@opentui/vue"
import type { JSAnimation } from "@opentui/core"

const dimensions = useTerminalDimensions()

const animatedSystem = ref({
  cpu: 0,
  memory: 0,
  network: 0,
  disk: 0,
})

const systems = [
  { name: "CPU", color: "#6a5acd", animKey: "cpu" as const },
  { name: "MEM", color: "#4682b4", animKey: "memory" as const },
  { name: "NET", color: "#20b2aa", animKey: "network" as const },
  { name: "DSK", color: "#daa520", animKey: "disk" as const },
]

const stats = ["PACKETS", "CONNECTIONS", "PROCESSES", "UPTIME"]
const topColors = ["#ff6b9d", "#4ecdc4", "#ffe66d"]
const rightColors = ["#ff8a80", "#80cbc4", "#fff176"]

const timeline = useTimeline({
  duration: 8000,
  loop: false,
})

timeline.add(
  animatedSystem.value,
  {
    cpu: 85,
    memory: 70,
    network: 95,
    disk: 60,
    duration: 3000,
    ease: "inOutQuad",
    onUpdate(animation: JSAnimation) {
      animatedSystem.value = { ...(animation.targets[0] as typeof animatedSystem.value) }
    },
  },
  0,
)
</script>

<template>
  <boxRenderable :style="{ zIndex: 5 }">
    <!-- System Monitor Panel -->
    <boxRenderable
      title="SYSTEM MONITOR"
      titleAlignment="center"
      :style="{
        position: 'absolute',
        left: 2,
        top: 5,
        width: dimensions.width - 6,
        height: 8,
        backgroundColor: '#1a1a2e',
        zIndex: 1,
        border: true,
        borderStyle: 'double',
        borderColor: '#4a4a4a',
      }"
    >
      <boxRenderable
        v-for="system in systems"
        :key="system.name"
        :style="{
          flexDirection: 'row',
          height: 1,
          width: '100%',
          paddingLeft: 1,
          paddingRight: 2,
        }"
      >
        <textRenderable
          :style="{
            fg: system.color,
            zIndex: 2,
            marginRight: 1,
          }"
        >
          {{ system.name }}
        </textRenderable>
        <boxRenderable
          :style="{
            height: 1,
            backgroundColor: '#333333',
            zIndex: 1,
            flexGrow: 1,
          }"
        >
          <boxRenderable
            :style="{
              width: `${animatedSystem[system.animKey]}%`,
              height: 1,
              backgroundColor: system.color,
              zIndex: 2,
            }"
          />
        </boxRenderable>
      </boxRenderable>
    </boxRenderable>

    <!-- Real-time Stats Panel -->
    <boxRenderable
      title="◇ REAL-TIME STATS ◇"
      titleAlignment="center"
      :style="{
        position: 'absolute',
        left: 2,
        top: 14,
        width: dimensions.width - 6,
        height: 4,
        backgroundColor: '#2d1b2e',
        zIndex: 1,
        border: true,
        borderStyle: 'single',
        borderColor: '#8a4a8a',
      }"
    />

    <!-- Stats Labels -->
    <textRenderable
      v-for="(label, index) in stats"
      :key="label"
      :style="{
        position: 'absolute',
        left: 4 + index * 15,
        top: 15,
        fg: '#9a9acd',
        zIndex: 2,
      }"
    >
      {{ label }}: 0
    </textRenderable>

    <!-- Top Left Indicators -->
    <boxRenderable
      v-for="(color, index) in topColors"
      :key="`top-${index}`"
      :style="{
        position: 'absolute',
        left: 2 + index * 4,
        top: 2,
        width: 3,
        height: 1,
        backgroundColor: color,
        zIndex: 3,
      }"
    />

    <!-- Top Right Indicators -->
    <boxRenderable
      v-for="(color, index) in rightColors"
      :key="`right-${index}`"
      :style="{
        position: 'absolute',
        left: dimensions.width - 8 + index * 2,
        top: 1,
        width: 1,
        height: 1,
        backgroundColor: color,
        zIndex: 3,
      }"
    />

    <!-- Instructions -->
    <textRenderable
      :style="{
        position: 'absolute',
        left: 2,
        top: dimensions.height - 2,
        fg: '#565f89',
      }"
    >
      Press ESC to return to menu
    </textRenderable>
  </boxRenderable>
</template>
