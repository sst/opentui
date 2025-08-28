# @opentui/vue

## How to run examples locally

```bash
bun install
```

```bash
bun run start:example
```

## Setup Guide

# @opentui/vue

Vue.js support for OpenTUI.

# 1. Create a project folder and initialize it

```bash
mkdir my-tui-app && cd my-tui-app
bun init -y
```

# 2. Add dependencies

```bash
bun add vue @opentui/core @opentui/vue
```

# 3. Create type defincation for vue files

create env.d.ts file at root of project

```typescript
declare module "*.vue" {
  import { DefineComponent } from "vue"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}
```

# 3. Create your main application component App.vue.

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

# 4 Create the entry point index.ts.

```ts
// index.ts
import { createApp } from "vue"
import { render } from "@opentui/vue"
import App from "./App.vue"

render(createApp(App))
```

# 5 Create a build script build.ts.

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

# 6 Build and run your application.

## Build the app

```bash
bun run build.ts
```

## Run the output

```bash
bun run dist/index.js
```

# Note

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
