<template>
  <box :style="{ flexDirection: 'column' }">
    <Text>Custom Button Example</Text>
    <ConsoleButton
      label="Another Button"
      :style="{
        backgroundColor: 'green',
      }"
    />
  </box>
</template>

<script setup lang="ts"></script>
