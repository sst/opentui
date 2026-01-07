<script setup lang="ts">
import { ref } from "vue"
import { RGBA, SyntaxStyle } from "@opentui/core"
import { useKeyboard } from "@opentui/vue"

const currentView = ref<"unified" | "split">("unified")
const showLineNumbers = ref(true)

const exampleDiff = `--- a/calculator.ts
+++ b/calculator.ts
@@ -1,15 +1,20 @@
 class Calculator {
   add(a: number, b: number): number {
     return a + b;
   }
 
-  subtract(a: number, b: number): number {
-    return a - b;
+  subtract(a: number, b: number, c: number = 0): number {
+    return a - b - c;
   }
 
   multiply(a: number, b: number): number {
     return a * b;
   }
+
+  divide(a: number, b: number): number {
+    if (b === 0) {
+      throw new Error("Division by zero");
+    }
+    return a / b;
+  }
 }`

const syntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#C792EA") },
  string: { fg: RGBA.fromHex("#C3E88D") },
  comment: { fg: RGBA.fromHex("#546E7A") },
  number: { fg: RGBA.fromHex("#F78C6C") },
  function: { fg: RGBA.fromHex("#82AAFF") },
  type: { fg: RGBA.fromHex("#FFCB6B") },
  operator: { fg: RGBA.fromHex("#89DDFF") },
  default: { fg: RGBA.fromHex("#A6ACCD") },
})

useKeyboard((key) => {
  if (key.name === "v" && !key.ctrl && !key.meta) {
    currentView.value = currentView.value === "unified" ? "split" : "unified"
  } else if (key.name === "l" && !key.ctrl && !key.meta) {
    showLineNumbers.value = !showLineNumbers.value
  }
})
</script>

<template>
  <boxRenderable
    :style="{
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      gap: 1,
    }"
  >
    <boxRenderable
      :style="{
        flexDirection: 'column',
        backgroundColor: '#0D1117',
        padding: 1,
        border: true,
        borderColor: '#30363D',
      }"
    >
      <textRenderable :style="{ fg: '#4ECDC4' }"> Diff Demo - Unified & Split View </textRenderable>
      <textRenderable :style="{ fg: '#888888' }">Keybindings:</textRenderable>
      <textRenderable :style="{ fg: '#AAAAAA' }"> V - Toggle view ({{ currentView.toUpperCase() }}) </textRenderable>
      <textRenderable :style="{ fg: '#AAAAAA' }">
        L - Toggle line numbers ({{ showLineNumbers ? "ON" : "OFF" }})
      </textRenderable>
    </boxRenderable>

    <boxRenderable
      :style="{
        flexGrow: 1,
        border: true,
        borderStyle: 'single',
        borderColor: '#4ECDC4',
        backgroundColor: '#0D1117',
      }"
    >
      <diffRenderable
        :diff="exampleDiff"
        :view="currentView"
        filetype="typescript"
        :syntaxStyle="syntaxStyle"
        :showLineNumbers="showLineNumbers"
        addedBg="#1a4d1a"
        removedBg="#4d1a1a"
        addedSignColor="#22c55e"
        removedSignColor="#ef4444"
        lineNumberFg="#6b7280"
        lineNumberBg="#161b22"
        width="100%"
        height="100%"
      />
    </boxRenderable>
  </boxRenderable>
</template>
