<script setup lang="ts">
import { SyntaxStyle, RGBA } from "@opentui/core"

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#ff6b6b"), bold: true },
  string: { fg: RGBA.fromHex("#51cf66") },
  comment: { fg: RGBA.fromHex("#868e96"), italic: true },
  number: { fg: RGBA.fromHex("#ffd43b") },
  function: { fg: RGBA.fromHex("#74c0fc") },
  type: { fg: RGBA.fromHex("#da77f2") },
  operator: { fg: RGBA.fromHex("#ff922b") },
  default: { fg: RGBA.fromHex("#f8f9fa") },
})

const codeExample = `// A simple TypeScript example
interface User {
  name: string
  age: number
  email?: string
}

function greet(user: User): string {
  const greeting = "Hello, " + user.name
  console.log(greeting)
  return greeting
}

const alice: User = {
  name: "Alice",
  age: 30,
  email: "alice@example.com"
}

greet(alice) // Output: Hello, Alice`
</script>

<template>
  <box
    :style="{
      flexDirection: 'column',
      padding: 1,
      gap: 1,
    }"
  >
    <box
      :style="{
        backgroundColor: '#1a1b26',
        padding: 1,
        border: true,
        borderStyle: 'single',
        borderColor: '#7aa2f7',
      }"
    >
      <Text :style="{ fg: '#7aa2f7' }"> Code Syntax Highlighting Demo </Text>
    </box>

    <box
      title="typescript"
      titleAlignment="left"
      :style="{
        flexGrow: 1,
        border: true,
        borderStyle: 'rounded',
        borderColor: '#565f89',
        backgroundColor: '#1a1b26',
        padding: 1,
      }"
    >
      <Code :content="codeExample" filetype="typescript" :syntaxStyle="syntaxStyle" />
    </box>

    <Text :style="{ fg: '#565f89', height: 1 }"> Press ESC to return to menu </Text>
  </box>
</template>
