<template>
  <boxRenderable :style="{ flexDirection: 'column' }">
    <textRenderable>Custom Button Example</textRenderable>
    <consoleButtonRenderable
      label="Another Button"
      :style="{
        backgroundColor: 'green',
      }"
    />
  </boxRenderable>
</template>

<script setup lang="ts"></script>
