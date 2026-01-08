<script setup lang="ts">
import { blue, bold, italic, red, t, underline, type TextChunk } from "@opentui/core"

const styledText = t`  
There's a ${underline(blue("house"))},
With a ${bold(red("window"))},
And a ${italic(blue("corvette"))}
And everything is blue`

const textChunks: TextChunk = underline(bold(`Chunk also works!`))

const plainText = "There's a house,\nWith a window,\nAnd a corvette\nAnd everything is blue"

const style = { margin: 1 }
</script>

<template>
  <Text :content="styledText" :style="style" />
  <Text :content="textChunks" :style="style" />
  <Text>{{ plainText }}</Text>
</template>
