# Getting Started with OpenTUI

OpenTUI is a TypeScript library for building terminal user interfaces (TUIs). It provides a component-based architecture with flexible layout capabilities, allowing you to create complex console applications.

## Core Concepts

### Renderer

The `CliRenderer` is the heart of OpenTUI. It manages the terminal output, handles input events, and orchestrates the rendering loop. Think of it as the canvas that draws your interface to the terminal. It can run in a "live" mode, when calling `renderer.start()`, which runs a loop capped at the specified target FPS. It also just works without calling `renderer.start()`, which will only re-render when the renderable tree or layout changes.

By default, left-clicking auto-focuses the closest focusable renderable. Disable this with `createCliRenderer({ autoFocus: false })` if you need manual focus control.

### Theme Mode

OpenTUI can detect the terminal's preferred color scheme (dark or light) when the terminal supports DEC mode 2031 color scheme updates. Read the current mode via `renderer.themeMode` and subscribe to `theme_mode` to react to changes. Possible values are `"dark"`, `"light"`, or `null` when unsupported, and no events fire in the unsupported case.

```typescript
import { type ThemeMode } from "@opentui/core"

const mode = renderer.themeMode

renderer.on("theme_mode", (nextMode: ThemeMode) => {
  console.log("Theme mode changed:", nextMode)
})
```

### FrameBuffer (OptimizedBuffer)

The `FrameBuffer` is a low-level rendering surface for custom graphics and complex visual effects. It is a 2D array of cells that can be drawn to using the `setCell`, `setCellWithAlphaBlending`, `drawText`, `fillRect`, and `drawFrameBuffer` methods. It is optimized for performance and memory usage. It allows for transparent cells and alpha blending, down to the viewport framebuffer.

### Renderables

Renderables are the building blocks of your UI - hierarchical objects that can be positioned, styled, and nested within each other. Each Renderable represents a visual element (like text, boxes, or input fields) and uses the Yoga layout engine for flexible positioning and sizing.

### Constructs (Components)

Constructs look just like React or Solid components, but are not render functions. You can think of them as constructors, a way to create new renderables by composing existing ones. They provide a more declarative way to build your UI. See a comparison on [this page](./renderables-vs-constructs.md).

### Console

OpenTUI includes a built-in console overlay that captures all `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug` calls. The console appears as a visual overlay that can be positioned at any edge of the terminal, with scrolling and focus management. It's particularly useful for debugging TUI applications without disrupting the main interface.

## Basic Setup

```typescript
import { createCliRenderer, TextRenderable, Text } from "@opentui/core"

const renderer = await createCliRenderer()

// Raw Renderable
const greeting = new TextRenderable(renderer, {
  id: "greeting",
  content: "Hello, OpenTUI!",
  fg: "#00FF00",
  position: "absolute",
  left: 10,
  top: 5,
})

renderer.root.add(greeting)

// Construct/Component (VNode)
const greeting2 = Text({
  content: "Hello, OpenTUI!",
  fg: "#00FF00",
  position: "absolute",
  left: 10,
  top: 5,
})

renderer.root.add(greeting)
```

## Console

When focused, you can use your arrow keys to scroll through the console. `renderer.console.toggle()` will toggle the console overlay, when open but not focused, it will focus the console. `+` and `-` will increase and decrease the size of the console.

```typescript
import { createCliRenderer, ConsolePosition } from "@opentui/core"

const renderer = await createCliRenderer({
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    sizePercent: 30,
    colorInfo: "#00FFFF",
    colorWarn: "#FFFF00",
    colorError: "#FF0000",
    startInDebugMode: false,
  },
})

console.log("This appears in the overlay")
console.error("Errors are color-coded red")
console.warn("Warnings appear in yellow")

renderer.console.toggle()
```

## Colors: RGBA

OpenTUI uses the `RGBA` class for consistent color representation throughout the library. Colors are internally stored as normalized float values (0.0-1.0) for efficient processing, but the class provides convenient methods for working with different color formats.

```typescript
import { RGBA } from "@opentui/core"

const redFromInts = RGBA.fromInts(255, 0, 0, 255) // RGB integers (0-255)
const blueFromValues = RGBA.fromValues(0.0, 0.0, 1.0, 1.0) // Float values (0.0-1.0)
const greenFromHex = RGBA.fromHex("#00FF00") // Hex strings
const transparent = RGBA.fromValues(1.0, 1.0, 1.0, 0.5) // Semi-transparent white
```

The `parseColor()` utility function accepts both RGBA objects and color strings (hex, CSS color names, "transparent") for flexible color input throughout the API.

## Keyboard

OpenTUI provides a keyboard handler that parses terminal input and provides structured key events. Get the handler via `renderer.keyInput`, an EventEmitter that emits `keypress` and `paste` events with detailed key information.

```typescript
import { type KeyEvent } from "@opentui/core"

const keyHandler = renderer.keyInput

keyHandler.on("keypress", (key: KeyEvent) => {
  console.log("Key name:", key.name)
  console.log("Sequence:", key.sequence)
  console.log("Ctrl pressed:", key.ctrl)
  console.log("Shift pressed:", key.shift)
  console.log("Alt pressed:", key.meta)
  console.log("Option pressed:", key.option)

  if (key.name === "escape") {
    console.log("Escape pressed!")
  } else if (key.ctrl && key.name === "c") {
    console.log("Ctrl+C pressed!")
  } else if (key.shift && key.name === "f1") {
    console.log("Shift+F1 pressed!")
  }
})
```

## Available Renderables

OpenTUI provides several primitive components that you can use to build your interfaces:

### Text

Display styled text content with support for colors, attributes, and text selection.

```typescript
import { TextRenderable, TextAttributes, t, bold, underline, fg } from "@opentui/core"

const plainText = new TextRenderable(renderer, {
  id: "plain-text",
  content: "Important Message",
  fg: "#FFFF00",
  attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE, // bitwise OR to combine attributes
  position: "absolute",
  left: 5,
  top: 2,
})

// You can also use the `t` template literal to create more complex styled text:
const styledTextRenderable = new TextRenderable(renderer, {
  id: "styled-text",
  content: t`${bold("Important Message")} ${fg("#FF0000")(underline("Important Message"))}`,
  position: "absolute",
  left: 5,
  top: 3,
})
```

### Box

A container component with borders, background colors, and layout capabilities. Perfect for creating panels, frames, and organized sections.

```typescript
import { BoxRenderable } from "@opentui/core"

const panel = new BoxRenderable(renderer, {
  id: "panel",
  width: 30,
  height: 10,
  backgroundColor: "#333366",
  borderStyle: "double",
  borderColor: "#FFFFFF",
  title: "Settings Panel",
  titleAlignment: "center",
  position: "absolute",
  left: 10,
  top: 5,
})
```

### Input

Text input field with cursor support, placeholder text, and focus states for user interaction.
Has to be focused to receive input.

```typescript
import { InputRenderable, InputRenderableEvents } from "@opentui/core"

const nameInput = new InputRenderable(renderer, {
  id: "name-input",
  width: 25,
  placeholder: "Enter your name...",
  focusedBackgroundColor: "#1a1a1a",
  position: "absolute",
  left: 10,
  top: 8,
})

// The change event is currently emitted when pressing return or enter. (this will be fixed in the future)
nameInput.on(InputRenderableEvents.CHANGE, (value) => {
  console.log("Input changed:", value)
})
nameInput.focus()
```

### Select

A list selection component for choosing from multiple options.
Has to be focused to receive input. Default keybindings are `up/k` and `down/j` to navigate the list, `enter` to select.

```typescript
import { SelectRenderable, SelectRenderableEvents } from "@opentui/core"

const menu = new SelectRenderable(renderer, {
  id: "menu",
  width: 30,
  height: 8,
  options: [
    { name: "New File", description: "Create a new file" },
    { name: "Open File", description: "Open an existing file" },
    { name: "Save", description: "Save current file" },
    { name: "Exit", description: "Exit the application" },
  ],
  position: "absolute",
  left: 5,
  top: 3,
})

menu.on(SelectRenderableEvents.ITEM_SELECTED, (index, option) => {
  console.log("Selected:", option.name)
})
menu.focus()
```

### TabSelect

Horizontal tab-based selection component with descriptions and scroll support.
Has to be focused to receive input. Default keybindings are `left/[` and `right/]` to navigate the tabs, `enter` to select.

```typescript
import { TabSelectRenderable, TabSelectRenderableEvents } from "@opentui/core"

const tabs = new TabSelectRenderable(renderer, {
  id: "tabs",
  width: 60,
  options: [
    { name: "Home", description: "Dashboard and overview" },
    { name: "Files", description: "File management" },
    { name: "Settings", description: "Application settings" },
  ],
  tabWidth: 20,
  position: "absolute",
  left: 2,
  top: 1,
})

tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (index, option) => {
  console.log("Selected:", option.name)
})

tabs.focus()
```

### ASCIIFont

Display text using ASCII art fonts with multiple font styles available.

```typescript
import { ASCIIFontRenderable, RGBA } from "@opentui/core"

const title = new ASCIIFontRenderable(renderer, {
  id: "title",
  text: "OPENTUI",
  font: "tiny",
  color: RGBA.fromInts(255, 255, 255, 255),
  position: "absolute",
  left: 10,
  top: 2,
})
```

### FrameBuffer

A low-level rendering surface for custom graphics and complex visual effects.

```typescript
import { FrameBufferRenderable, RGBA } from "@opentui/core"

const canvas = new FrameBufferRenderable(renderer, {
  id: "canvas",
  width: 50,
  height: 20,
  position: "absolute",
  left: 5,
  top: 5,
})

// Custom rendering in the frame buffer
canvas.frameBuffer.fillRect(10, 5, 20, 8, RGBA.fromHex("#FF0000"))
canvas.frameBuffer.drawText("Custom Graphics", 12, 7, RGBA.fromHex("#FFFFFF"))
```

## Layout System

OpenTUI uses the Yoga layout engine, providing CSS Flexbox-like capabilities for responsive layouts:

```typescript
import { GroupRenderable, BoxRenderable } from "@opentui/core"

const container = new GroupRenderable(renderer, {
  id: "container",
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  height: 10,
})

const leftPanel = new BoxRenderable(renderer, {
  id: "left",
  flexGrow: 1,
  height: 10,
  backgroundColor: "#444",
})

const rightPanel = new BoxRenderable(renderer, {
  id: "right",
  width: 20,
  height: 10,
  backgroundColor: "#666",
})

container.add(leftPanel)
container.add(rightPanel)
```

## Next Steps

- Explore the [examples](../src/examples) directory for more complex use cases
- Check out the React and Solid integrations for declarative UI development
