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
import { render } from "@opentui/vue"
import App from "./App.vue"

render(App)
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

```jsx
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
```

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
import type { KeyEvent } from "@opentui/core"

const lastKey = ref("")

useKeyboard((key: KeyEvent) => {
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

## Extending with Custom Components

`@opentui/vue` allows you to create and use your own custom components in your TUI applications. This is useful for creating reusable UI elements with specific styles and behaviors.

The `extend` function is used to register your custom components with the Vue renderer.

### How to create and use a custom component

Here's a step-by-step guide to creating a custom button component.

#### 1. Create the custom renderable

First, create a class that extends one of the base renderables from `@opentui/core`. For our custom button, we'll extend `BoxRenderable`.

`CustomButtonRenderable.ts`:

```typescript
import { BoxRenderable, OptimizedBuffer, RGBA, type BoxOptions, type RenderContext } from "@opentui/core"

export class ConsoleButtonRenderable extends BoxRenderable {
  private _label: string = "Button"

  constructor(ctx: RenderContext, options: BoxOptions & { label?: string }) {
    super(ctx, options)

    if (options.label) {
      this._label = options.label
    }

    // Set some default styling for buttons
    this.borderStyle = "single"
    this.padding = 2
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    const centerX = this.x + Math.floor(this.width / 2 - this._label.length / 2)
    const centerY = this.y + Math.floor(this.height / 2)

    buffer.drawText(this._label, centerX, centerY, RGBA.fromInts(255, 255, 255, 255))
  }

  get label(): string {
    return this._label
  }

  set label(value: string) {
    this._label = value
    this.requestRender()
  }
}
```

#### 2. Register the new component

In your application's entry point (e.g., `main.ts`), import the `extend` function and your custom component. Then, call `extend` with an object where the key is the component's tag name (in camelCase) and the value is the component class.

`main.ts`:

```typescript
import { render, extend } from "@opentui/vue"
import { ConsoleButtonRenderable } from "./CustomButtonRenderable"
import App from "./App.vue"

// Register the custom component
extend({ consoleButtonRenderable: ConsoleButtonRenderable })

// Render the app
render(App)
```

> **Important:** The `extend` function should be called in your main application entry file (e.g., `main.ts` or `index.js`). Calling it inside the `<script>` section of a `.vue` file can cause issues with the Vue compiler. It may incorrectly try to instantiate the renderable classes you import from `@opentui/core`, leading to a runtime error.

#### 3. Add TypeScript definitions

To get proper type-checking and autocompletion for your custom component in Vue templates, you need to augment the `@opentui/vue` types. Create a declaration file (e.g., `opentui.d.ts`) in your project and add the following:

`opentui.d.ts`:

```typescript
import { ConsoleButtonRenderable } from "./CustomButtonRenderable"

declare module "@opentui/vue" {
  export interface OpenTUIComponents {
    consoleButtonRenderable: typeof ConsoleButtonRenderable
  }
}
```

_Note: Make sure this file is included in your `tsconfig.json`._

#### 4. Use your custom component

Now you can use `<consoleButtonRenderable>` in your Vue components just like any other OpenTUI component.

`ExtendExample.vue`:

```vue
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
```
