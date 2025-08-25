# OpenTUI Complete Guide

A comprehensive guide to building terminal user interfaces with OpenTUI.

## Table of Contents

- [Introduction](#introduction)
- [Installation & Setup](#installation--setup)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Renderable Components](#renderable-components)
- [React Integration](#react-integration)
- [Solid.js Integration](#solidjs-integration)
- [API Reference](#api-reference)
- [Examples & Patterns](#examples--patterns)
- [Best Practices](#best-practices)

## Introduction

OpenTUI is a TypeScript library for building sophisticated terminal user interfaces. It provides modern web-like development patterns with flexbox layout, rich styling, event handling, and framework integrations for React and Solid.js.

### Package Ecosystem

- **`@opentui/core`** - Core imperative API with all primitives
- **`@opentui/react`** - React reconciler for declarative UIs
- **`@opentui/solid`** - Solid.js reconciler for reactive UIs

### Key Features

- **Modern Layout**: Yoga-based flexbox layout engine
- **Rich Styling**: Colors, borders, text attributes, animations
- **Interactive**: Mouse and keyboard event handling
- **3D Graphics**: WebGPU and Three.js integration
- **Framework Agnostic**: Works standalone or with React/Solid
- **Performance**: 60fps rendering with efficient updates

## Installation & Setup

### System Requirements

- **Bun**: `>=1.2.0` (recommended runtime)
- **TypeScript**: `^5.0.0`
- **Terminal**: Modern terminal with ANSI support

### Package Installation

#### Core Library

```bash
bun install @opentui/core
```

#### React Integration

```bash
bun install @opentui/react @opentui/core react
```

#### Solid.js Integration

```bash
bun install @opentui/solid @opentui/core solid-js
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "@opentui/react",
    "strict": true,
    "skipLibCheck": true
  }
}
```

For Solid.js, modify jsx settings:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

## Quick Start

### Core Library Hello World

```typescript
import { createCliRenderer, TextRenderable } from "@opentui/core"

const renderer = await createCliRenderer()

const greeting = new TextRenderable("greeting", {
  content: "Hello, OpenTUI!",
  fg: "#00FF00",
  position: "absolute",
  left: 10,
  top: 5,
})

renderer.root.add(greeting)
renderer.start()
```

### React Hello World

```tsx
import { render } from "@opentui/react"

function App() {
  return (
    <group>
      <text fg="#00FF00">Hello, OpenTUI!</text>
      <box title="Welcome" padding={2}>
        <text>Welcome to terminal UIs with React!</text>
      </box>
    </group>
  )
}

render(<App />)
```

### Solid.js Hello World

```tsx
import { render } from "@opentui/solid"

function App() {
  return (
    <group>
      <text style={{ fg: "#00FF00" }}>Hello, OpenTUI!</text>
      <box title="Welcome" style={{ padding: 2 }}>
        <text>Welcome to terminal UIs with Solid!</text>
      </box>
    </group>
  )
}

render(App)
```

## Core Concepts

### Renderer

The `CliRenderer` manages terminal output and orchestrates rendering:

```typescript
import { createCliRenderer } from "@opentui/core"

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: true,
  useAlternateScreen: true,
})

// Start the render loop
renderer.start()

// Manual rendering (alternative to start())
renderer.render()
```

### Renderable Hierarchy

All UI elements extend `Renderable` and form a tree structure:

```typescript
const root = renderer.root
const container = new GroupRenderable("container")
const text = new TextRenderable("text", { content: "Hello" })

container.add(text)
root.add(container)
```

### Layout System

OpenTUI uses Yoga for CSS Flexbox-like layouts:

```typescript
const container = new GroupRenderable("container", {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  height: 20,
})

const leftPanel = new BoxRenderable("left", {
  flexGrow: 1,
  backgroundColor: "#333",
})

const rightPanel = new BoxRenderable("right", {
  width: 30,
  backgroundColor: "#666",
})

container.add(leftPanel)
container.add(rightPanel)
```

### Color System

OpenTUI uses the `RGBA` class for consistent color handling:

```typescript
import { RGBA, parseColor } from "@opentui/core"

const red = RGBA.fromInts(255, 0, 0, 255)
const blue = RGBA.fromHex("#0000FF")
const green = parseColor("green")
const transparent = RGBA.fromValues(1, 1, 1, 0.5)
```

### Events

Handle keyboard and mouse events:

```typescript
import { getKeyHandler } from "@opentui/core"

// Global keyboard handling
getKeyHandler().on("keypress", (key) => {
  if (key.name === "escape") process.exit()
  if (key.ctrl && key.name === "c") process.exit()
})

// Component-specific mouse events
class InteractiveBox extends BoxRenderable {
  protected onMouseEvent(event) {
    if (event.type === "down") {
      console.log("Clicked!")
    }
  }
}
```

## Renderable Components

### TextRenderable

Display styled text with selection support:

```typescript
import { TextRenderable, TextAttributes, t, bold, fg } from "@opentui/core"

// Basic text
const text = new TextRenderable("text", {
  content: "Hello World",
  fg: "#FFFF00",
  attributes: TextAttributes.BOLD,
})

// Rich styled text
const richText = new TextRenderable("rich", {
  content: t`${bold("Bold")} and ${fg("red")("colored")} text`,
})

// Selectable text
const selectableText = new TextRenderable("selectable", {
  content: "Select this text",
  selectable: true,
})
```

**Key Properties:**

- `content`: Text content or StyledText
- `fg/bg`: Foreground/background colors
- `attributes`: TextAttributes flags
- `selectable`: Enable text selection

### BoxRenderable

Container with borders, backgrounds, and layout:

```typescript
import { BoxRenderable } from "@opentui/core"

const box = new BoxRenderable("box", {
  width: 40,
  height: 10,
  backgroundColor: "#333366",
  borderStyle: "double",
  borderColor: "#FFFFFF",
  title: "Settings Panel",
  titleAlignment: "center",
  padding: 2,
  position: "absolute",
  left: 10,
  top: 5,
})
```

**Key Properties:**

- `borderStyle`: "single", "double", "rounded", "heavy"
- `backgroundColor/borderColor`: Color values
- `title/titleAlignment`: Optional title with alignment
- `padding/margin`: Spacing values

### InputRenderable

Text input field with validation:

```typescript
import { InputRenderable, InputRenderableEvents } from "@opentui/core"

const input = new InputRenderable("input", {
  width: 30,
  placeholder: "Enter your name...",
  focusedBackgroundColor: "#1a1a1a",
  maxLength: 50,
})

input.on(InputRenderableEvents.INPUT, (value) => {
  console.log("Input changed:", value)
})

input.on(InputRenderableEvents.CHANGE, (value) => {
  console.log("Input submitted:", value)
})

input.focus()
```

### SelectRenderable

List selection with keyboard navigation:

```typescript
import { SelectRenderable, SelectRenderableEvents } from "@opentui/core"

const select = new SelectRenderable("select", {
  width: 40,
  height: 10,
  options: [
    { name: "Option 1", description: "First option", value: "opt1" },
    { name: "Option 2", description: "Second option", value: "opt2" },
    { name: "Option 3", description: "Third option", value: "opt3" },
  ],
  showScrollIndicator: true,
})

select.on(SelectRenderableEvents.ITEM_SELECTED, (index, option) => {
  console.log("Selected:", option.name)
})

select.focus()
```

### TabSelectRenderable

Horizontal tab navigation:

```typescript
import { TabSelectRenderable, TabSelectRenderableEvents } from "@opentui/core"

const tabs = new TabSelectRenderable("tabs", {
  width: 60,
  options: [
    { name: "Home", description: "Dashboard" },
    { name: "Files", description: "File manager" },
    { name: "Settings", description: "Configuration" },
  ],
  tabWidth: 20,
})

tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (index, option) => {
  console.log("Selected tab:", option.name)
})
```

### ASCIIFontRenderable

ASCII art text rendering:

```typescript
import { ASCIIFontRenderable } from "@opentui/core"

const title = new ASCIIFontRenderable("title", {
  text: "OPENTUI",
  font: "block", // "tiny", "block", "slick", "shade"
  fg: RGBA.fromHex("#FFFFFF"),
})
```

### FrameBufferRenderable

Low-level pixel drawing:

```typescript
import { FrameBufferRenderable, RGBA } from "@opentui/core"

const canvas = new FrameBufferRenderable("canvas", {
  width: 50,
  height: 20,
})

// Draw directly to framebuffer
canvas.frameBuffer.fillRect(10, 5, 20, 8, RGBA.fromHex("#FF0000"))
canvas.frameBuffer.drawText("Custom", 12, 8, RGBA.fromHex("#FFFFFF"))
```

## React Integration

### Setup and Rendering

```tsx
import { render, useRenderer, useKeyboard } from "@opentui/react"

function App() {
  const renderer = useRenderer()

  useKeyboard((key) => {
    if (key.name === "escape") process.exit()
  })

  return (
    <group style={{ padding: 2 }}>
      <text>React OpenTUI App</text>
    </group>
  )
}

render(<App />, {
  targetFps: 30,
  exitOnCtrlC: true,
})
```

### Component Mapping

React JSX elements map to OpenTUI renderables:

```tsx
// JSX -> Renderable
<text>Hello</text>           // TextRenderable
<box>Content</box>          // BoxRenderable
<group>Items</group>        // GroupRenderable
<input />                   // InputRenderable
<select options={opts} />   // SelectRenderable
<ascii-font text="TITLE" /> // ASCIIFontRenderable
```

### Event Handling

```tsx
function InteractiveForm() {
  const [value, setValue] = useState("")
  const [selected, setSelected] = useState(0)

  return (
    <group flexDirection="column">
      <input placeholder="Type here..." onInput={setValue} onSubmit={(v) => console.log("Submitted:", v)} />

      <select
        options={[
          { name: "Option 1", value: "opt1" },
          { name: "Option 2", value: "opt2" },
        ]}
        onChange={(index, option) => setSelected(index)}
      />
    </group>
  )
}
```

### Hooks

**`useRenderer()`** - Access renderer instance:

```tsx
function DebugComponent() {
  const renderer = useRenderer()

  useEffect(() => {
    renderer.toggleDebugOverlay()
  }, [])

  return <text>Debug mode enabled</text>
}
```

**`useKeyboard(handler)`** - Handle keyboard events:

```tsx
function Navigation() {
  useKeyboard((key) => {
    if (key.name === "f1") {
      console.log("Help requested")
    }
  })

  return <text>Press F1 for help</text>
}
```

**`useTerminalDimensions()`** - Get terminal size:

```tsx
function ResponsiveLayout() {
  const { width, height } = useTerminalDimensions()

  return (
    <box style={{ width: width - 4, height: height - 4 }}>
      <text>
        Terminal: {width}x{height}
      </text>
    </box>
  )
}
```

### Custom Components

Extend OpenTUI with custom renderables:

```tsx
import { BoxRenderable, extend } from "@opentui/react"

class ButtonRenderable extends BoxRenderable {
  private _label = "Button"

  constructor(id: string, options: any) {
    super(id, options)
    this.borderStyle = "single"
    this.padding = 1
  }

  set label(value: string) {
    this._label = value
    this.needsUpdate()
  }
}

// Register component
extend({ button: ButtonRenderable })

// Use in JSX
function App() {
  return <button label="Click me!" />
}
```

## Solid.js Integration

### Setup

Add to `bunfig.toml`:

```toml
preload = ["@opentui/solid/preload"]
```

### Basic Usage

```tsx
import { render } from "@opentui/solid"
import { createSignal } from "solid-js"

function App() {
  const [count, setCount] = createSignal(0)

  setInterval(() => setCount((c) => c + 1), 1000)

  return (
    <box title="Counter">
      <text>Count: {count()}</text>
    </box>
  )
}

render(App, { targetFps: 30 })
```

### Reactive Patterns

```tsx
function ReactiveDemo() {
  const [items, setItems] = createSignal([
    { name: "Item 1", selected: false },
    { name: "Item 2", selected: false },
  ])

  const selectedCount = () => items().filter((item) => item.selected).length

  return (
    <group>
      <text>Selected: {selectedCount()}</text>
      <For each={items()}>{(item, index) => <text fg={item.selected ? "green" : "white"}>{item.name}</text>}</For>
    </group>
  )
}
```

## API Reference

### Core Classes

| Class              | Purpose                | Key Methods                                   |
| ------------------ | ---------------------- | --------------------------------------------- |
| `CliRenderer`      | Main renderer          | `start()`, `render()`, `toggleDebugOverlay()` |
| `TextRenderable`   | Text display           | `setContent()`, `setStyle()`                  |
| `BoxRenderable`    | Container with borders | `setTitle()`, `setBorderStyle()`              |
| `InputRenderable`  | Text input             | `focus()`, `setValue()`, `getValue()`         |
| `SelectRenderable` | Selection list         | `setOptions()`, `setSelectedIndex()`          |
| `RGBA`             | Color representation   | `fromHex()`, `fromInts()`, `fromValues()`     |

### Layout Properties

| Property                | Type                                                        | Description                 |
| ----------------------- | ----------------------------------------------------------- | --------------------------- |
| `flexDirection`         | `"row" \| "column"`                                         | Layout direction            |
| `justifyContent`        | `"flex-start" \| "center" \| "flex-end" \| "space-between"` | Main axis alignment         |
| `alignItems`            | `"flex-start" \| "center" \| "flex-end" \| "stretch"`       | Cross axis alignment        |
| `width/height`          | `number \| string`                                          | Size (pixels or percentage) |
| `padding/margin`        | `number \| object`                                          | Spacing                     |
| `position`              | `"relative" \| "absolute"`                                  | Positioning type            |
| `left/top/right/bottom` | `number`                                                    | Position values             |

### Event Types

| Event           | Target           | Data                             |
| --------------- | ---------------- | -------------------------------- |
| `keypress`      | Global           | `ParsedKey` with name, modifiers |
| `INPUT`         | InputRenderable  | Current input value              |
| `CHANGE`        | InputRenderable  | Final input value                |
| `ITEM_SELECTED` | SelectRenderable | Index and option                 |
| `mouse`         | Any Renderable   | MouseEvent with coordinates      |

### Color Utilities

| Function                 | Purpose            | Example                      |
| ------------------------ | ------------------ | ---------------------------- |
| `parseColor(input)`      | Parse color string | `parseColor("#FF0000")`      |
| `RGBA.fromHex(hex)`      | Create from hex    | `RGBA.fromHex("#00FF00")`    |
| `RGBA.fromInts(r,g,b,a)` | Create from ints   | `RGBA.fromInts(255,0,0,255)` |
| `fg(color)`              | Foreground color   | `fg("red")("text")`          |
| `bg(color)`              | Background color   | `bg("#333")("text")`         |
| `bold()`, `italic()`     | Text styling       | `bold("important")`          |

## Examples & Patterns

### File Manager Interface

```tsx
import { render, useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useState } from "react"

function FileManager() {
  const [currentPath, setCurrentPath] = useState("/home/user")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { width, height } = useTerminalDimensions()

  const files = [
    { name: "documents", type: "folder" },
    { name: "images", type: "folder" },
    { name: "readme.txt", type: "file" },
  ]

  useKeyboard((key) => {
    if (key.name === "return") {
      const selected = files[selectedIndex]
      if (selected?.type === "folder") {
        setCurrentPath((prev) => `${prev}/${selected.name}`)
      }
    }
  })

  return (
    <group style={{ width, height }}>
      <box title={`File Manager - ${currentPath}`} style={{ width, height: height - 2 }}>
        <select
          options={files.map((f) => ({
            name: f.name,
            description: f.type,
            value: f.name,
          }))}
          focused
          onChange={(index) => setSelectedIndex(index)}
          style={{ width: width - 4, height: height - 6 }}
        />
      </box>
      <text style={{ position: "absolute", bottom: 0 }}>Use arrow keys to navigate, Enter to open</text>
    </group>
  )
}

render(<FileManager />)
```

### Login Form with Validation

```tsx
function LoginForm() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [focused, setFocused] = useState<"username" | "password">("username")
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle")

  useKeyboard((key) => {
    if (key.name === "tab") {
      setFocused((prev) => (prev === "username" ? "password" : "username"))
    }
  })

  const handleLogin = () => {
    if (username === "admin" && password === "secret") {
      setStatus("success")
    } else {
      setStatus("error")
    }
  }

  return (
    <group style={{ padding: 4, flexDirection: "column", alignItems: "center" }}>
      <ascii-font text="LOGIN" font="block" style={{ marginBottom: 2 }} />

      <box title="Username" style={{ width: 40, height: 3, marginBottom: 1 }}>
        <input
          placeholder="Enter username..."
          onInput={setUsername}
          onSubmit={handleLogin}
          focused={focused === "username"}
        />
      </box>

      <box title="Password" style={{ width: 40, height: 3, marginBottom: 2 }}>
        <input
          placeholder="Enter password..."
          onInput={setPassword}
          onSubmit={handleLogin}
          focused={focused === "password"}
        />
      </box>

      <text
        style={{
          fg: status === "success" ? "green" : status === "error" ? "red" : "#999",
        }}
      >
        {status === "success"
          ? "✓ Login successful"
          : status === "error"
            ? "✗ Invalid credentials"
            : "Enter your credentials"}
      </text>

      <text style={{ fg: "#666", marginTop: 1 }}>Tab: switch fields • Enter: login</text>
    </group>
  )
}
```

### Data Dashboard

```tsx
import { useEffect, useState } from "react"

function Dashboard() {
  const [metrics, setMetrics] = useState({
    cpu: 45,
    memory: 67,
    network: 23,
    storage: 89,
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics((prev) => ({
        cpu: Math.max(0, Math.min(100, prev.cpu + (Math.random() - 0.5) * 10)),
        memory: Math.max(0, Math.min(100, prev.memory + (Math.random() - 0.5) * 5)),
        network: Math.max(0, Math.min(100, prev.network + (Math.random() - 0.5) * 15)),
        storage: Math.max(0, Math.min(100, prev.storage + (Math.random() - 0.5) * 2)),
      }))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const renderBar = (value: number, width: number = 20) => {
    const filled = Math.round((value / 100) * width)
    const empty = width - filled
    return "█".repeat(filled) + "░".repeat(empty)
  }

  return (
    <box title="System Dashboard" style={{ padding: 2 }}>
      <group style={{ flexDirection: "column" }}>
        <group style={{ marginBottom: 1 }}>
          <text style={{ width: 12 }}>CPU:</text>
          <text style={{ fg: metrics.cpu > 80 ? "red" : metrics.cpu > 60 ? "yellow" : "green" }}>
            {renderBar(metrics.cpu)} {metrics.cpu.toFixed(1)}%
          </text>
        </group>

        <group style={{ marginBottom: 1 }}>
          <text style={{ width: 12 }}>Memory:</text>
          <text style={{ fg: metrics.memory > 80 ? "red" : metrics.memory > 60 ? "yellow" : "green" }}>
            {renderBar(metrics.memory)} {metrics.memory.toFixed(1)}%
          </text>
        </group>

        <group style={{ marginBottom: 1 }}>
          <text style={{ width: 12 }}>Network:</text>
          <text style={{ fg: "cyan" }}>
            {renderBar(metrics.network)} {metrics.network.toFixed(1)}%
          </text>
        </group>

        <group>
          <text style={{ width: 12 }}>Storage:</text>
          <text style={{ fg: metrics.storage > 90 ? "red" : "blue" }}>
            {renderBar(metrics.storage)} {metrics.storage.toFixed(1)}%
          </text>
        </group>
      </group>
    </box>
  )
}
```

## Best Practices

### Performance

**Frame Rate Management:**

```typescript
// Lower FPS for less intensive apps
const renderer = await createCliRenderer({ targetFps: 30 })

// Use manual rendering for static content
renderer.render() // Single frame
// instead of renderer.start() // Continuous loop
```

**Memory Management:**

```typescript
// Always cleanup resources
class MyComponent extends BoxRenderable {
  destroy() {
    // Clean up timers, listeners, etc.
    super.destroy()
  }
}
```

**Efficient Updates:**

```typescript
// Batch updates when possible
group.suspendLayout()
group.add(child1)
group.add(child2)
group.add(child3)
group.resumeLayout()
```

### Error Handling

```typescript
// Wrap renderer creation
try {
  const renderer = await createCliRenderer()
  // App code
} catch (error) {
  console.error("Failed to initialize renderer:", error)
  process.exit(1)
}

// Handle component errors
input.on(InputRenderableEvents.INPUT, (value) => {
  try {
    validateInput(value)
  } catch (error) {
    showError(error.message)
  }
})
```

### Responsive Design

```typescript
// Adapt to terminal size
const { width, height } = useTerminalDimensions()

const layout = (
  <group style={{ width, height }}>
    <box style={{
      width: Math.min(80, width - 4),
      height: Math.min(24, height - 4)
    }}>
      Content
    </box>
  </group>
)
```

### Testing

```typescript
// Test without rendering
const renderer = await createCliRenderer({ targetFps: 0 })
const component = new TextRenderable("test", { content: "Hello" })
renderer.root.add(component)

// Test single frame
renderer.render()

// Verify state
expect(component.content).toBe("Hello")
```

### Architecture

**Separate Logic from UI:**

```typescript
// Good: Business logic separate
class FileManagerState {
  constructor() {
    this.currentPath = "/home"
    this.files = []
  }

  navigate(path: string) {
    this.currentPath = path
    this.loadFiles()
  }
}

// UI consumes state
function FileManagerUI({ state }: { state: FileManagerState }) {
  return (
    <box title={state.currentPath}>
      {state.files.map(file => <text key={file.name}>{file.name}</text>)}
    </box>
  )
}
```

**Use TypeScript:**

```typescript
// Define interfaces for your data
interface FileItem {
  name: string
  type: "file" | "folder"
  size?: number
  modified: Date
}

// Type your event handlers
const handleFileSelect = (index: number, file: FileItem | null) => {
  if (file?.type === "folder") {
    navigateToFolder(file.name)
  }
}
```

This completes the comprehensive OpenTUI guide covering installation, core concepts, all major components, framework integrations, extensive examples, and best practices for building professional terminal applications.
