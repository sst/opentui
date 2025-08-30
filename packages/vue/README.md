# @opentui/vue

Vue.js support for [OpenTUI](https://github.com/sst/opentui).

## Run examples locally

```bash
bun install
bun run start:example
```

## Setup Guide

### 1. Create a project folder and initialize it

```bash
mkdir my-tui-app && cd my-tui-app
bun init -y
```

### 2. Add dependencies

```bash
bun add vue @opentui/core @opentui/vue
```

### 3. Create type definition for vue files

create env.d.ts file at root of project

```typescript
declare module "*.vue" {
  import { DefineComponent } from "vue"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}
```

### 4. Create your main application component App.vue.

```jsx
<!-- App.vue -->
<script setup lang="ts">
</script>

<template>
    <textRenderable :style="{ fg: '#ff0000' }">
        Hello World
    </textRenderable>
</template>
```

### 5. Create the entry point index.ts.

```ts
// index.ts
import { createApp } from "vue"
import { render } from "@opentui/vue"
import App from "./App.vue"

render(createApp(App))
```

### 6. Create a build script build.ts.

```bash
bun add -D bun-plugin-vue3
```

```ts
// build.ts
import { pluginVue3 } from "bun-plugin-vue3"

const result = await Bun.build({
  entrypoints: ["./index.ts"],
  outdir: "./dist",
  target: "bun",
  plugins: [pluginVue3()],
})

if (!result.success) {
  console.error("Build failed")
  for (const message of result.logs) {
    console.error(message)
  }
  process.exit(1)
}
```

### 7. Build and run your application.

#### Build the app

```bash
bun run build.ts
```

#### Run the output

```bash
bun run dist/index.js
```

## Note

Important Note on <textRenderable>

The <textRenderable> component only accepts plain text as a direct child. For styled text or text chunks, you must use the content prop.

Code snippet

<script setup lang="ts">
import { blue, bold, t, underline, type TextChunk } from "@opentui/core"

const styledText = t`This is ${underline(blue("styled"))} text.`
const textChunk: TextChunk = bold(`This is a text chunk.`)
</script>

<template>
  <textRenderable :content="styledText" />
  <textRenderable :content="textChunk" />

<textRenderable>This is plain text.</textRenderable>
</template>

## Composables

@opentui/vue provides a set of composables to interact with the terminal and respond to events.

### useCliRenderer

This composable returns the underlying CliRenderer instance from @opentui/core.

```ts
import { useCliRenderer } from "@opentui/vue"

const renderer = useCliRenderer()
```

### useKeyboard

Listen to keypress events in your components.

```jsx
<script setup lang="ts">
import { ref } from "vue"
import { useKeyboard } from "@opentui/vue"
import type { ParsedKey } from "@opentui/core"

const lastKey = ref("")

useKeyboard((key: ParsedKey) => {
  lastKey.value = key.name
})
</script>

<template>
  <textRenderable>
    Last key pressed: {{ lastKey }}
  </textRenderable>
</template>
```

### useOnResize

Execute a callback function whenever the terminal window is resized.

```vue
<script setup lang="ts">
import { useOnResize } from "@opentui/vue"

useOnResize((width, height) => {
  console.log(`Terminal resized to ${width}x${height}`)
})
</script>
```

### useTerminalDimensions

Get the current terminal dimensions as a reactive object. The dimensions will automatically update when the terminal is resized.

```jsx
<script setup lang="ts">
import { useTerminalDimensions } from "@opentui/vue"

const dimensions = useTerminalDimensions()
</script>

<template>
  <textRenderable>
    Width: {{ dimensions.width }}, Height: {{ dimensions.height }}
  </textRenderable>
</template>
```
