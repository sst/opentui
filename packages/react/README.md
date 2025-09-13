# @opentui/react

A React renderer for building terminal user interfaces using [OpenTUI core](https://github.com/sst/opentui). Create rich, interactive console applications with familiar React patterns and components.

## Installation

Quick start with [bun](https://bun.sh) and [create-tui](https://github.com/msmps/create-tui):

```bash
bun create tui --template react
```

Manual installation:

```bash
bun install @opentui/react @opentui/core react
```

## Quick Start

```tsx
import { render } from "@opentui/react"

function App() {
  return <text>Hello, world!</text>
}

render(<App />)
```

## TypeScript Configuration

For optimal TypeScript support, configure your `tsconfig.json`:

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

## Core Concepts

### Components

OpenTUI React provides several built-in components that map to OpenTUI core renderables:

- **`<text>`** - Display text with styling
- **`<box>`** - Container with borders and layout
- **`<input>`** - Text input field
- **`<select>`** - Selection dropdown
- **`<scrollbox>`** - A scrollable box
- **`<tab-select>`** - Tab-based selection
- **`<ascii-font>`** - Display ASCII art text with different font styles

Helpers:

- **`<span>`, `<strong>`, `<em>`, `<u>`, `<b>`, `<i>`, `<br>`** - Text modifiers (_must be used inside of the text component_)

### Styling

Components can be styled using props or the `style` prop:

```tsx
// Direct props
<box backgroundColor="blue" padding={2}>
  <text>Hello, world!</text>
</box>

// Style prop
<box style={{ backgroundColor: "blue", padding: 2 }}>
  <text>Hello, world!</text>
</box>
```

## API Reference

### `render(element, config?)`

Renders a React element to the terminal.

```tsx
import { render } from "@opentui/react"

await render(<App />, {
  // Optional renderer configuration
  exitOnCtrlC: false,
})
```

**Parameters:**

- `element`: React element to render
- `config?`: Optional `CliRendererConfig` object

### Hooks

#### `useRenderer()`

Access the OpenTUI renderer instance.

```tsx
import { useRenderer } from "@opentui/react"

function App() {
  const renderer = useRenderer()

  useEffect(() => {
    renderer.console.show()
    console.log("Hello, from the console!")
  }, [])

  return <box />
}
```

#### `useKeyboard(handler)`

Handle keyboard events.

```tsx
import { useKeyboard } from "@opentui/react"

function App() {
  useKeyboard((key) => {
    if (key.name === "escape") {
      process.exit(0)
    }
  })

  return <text>Press ESC to exit</text>
}
```

#### `useOnResize(callback)`

Handle terminal resize events.

```tsx
import { useOnResize, useRenderer } from "@opentui/react"
import { useEffect } from "react"

function App() {
  const renderer = useRenderer()

  useEffect(() => {
    renderer.console.show()
  }, [renderer])

  useOnResize((width, height) => {
    console.log(`Terminal resized to ${width}x${height}`)
  })

  return <text>Resize-aware component</text>
}
```

#### `useTerminalDimensions()`

Get current terminal dimensions and automatically update when the terminal is resized.

```tsx
import { useTerminalDimensions } from "@opentui/react"

function App() {
  const { width, height } = useTerminalDimensions()

  return (
    <box>
      <text>
        Terminal dimensions: {width}x{height}
      </text>
      <box style={{ width: Math.floor(width / 2), height: Math.floor(height / 3) }}>
        <text>Half-width, third-height box</text>
      </box>
    </box>
  )
}
```

**Returns:** An object with `width` and `height` properties representing the current terminal dimensions.

## Components

### Text Component

Display text with rich formatting.

```tsx
function App() {
  return (
    <box>
      {/* Simple text */}
      <text>Hello World</text>

      {/* Rich text with children */}
      <text>
        <span fg="red">Red Text</span>
      </text>

      {/* Text modifiers */}
      <text>
        <strong>Bold</strong>, <em>Italic</em>, and <u>Underlined</u>
      </text>
    </box>
  )
}
```

### Box Component

Container with borders and layout capabilities.

```tsx
function App() {
  return (
    <box flexDirection="column">
      {/* Basic box */}
      <box border>
        <text>Simple box</text>
      </box>

      {/* Box with title and styling */}
      <box title="Settings" border borderStyle="double" padding={2} backgroundColor="blue">
        <text>Box content</text>
      </box>

      {/* Styled box */}
      <box
        style={{
          border: true,
          width: 40,
          height: 10,
          margin: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <text>Centered content</text>
      </box>
    </box>
  )
}
```

### Input Component

Text input field with event handling.

```tsx
import { useState } from "react"

function App() {
  const [value, setValue] = useState("")

  return (
    <box title="Enter your name" style={{ border: true, height: 3 }}>
      <input
        placeholder="Type here..."
        focused
        onInput={setValue}
        onSubmit={(value) => console.log("Submitted:", value)}
      />
    </box>
  )
}
```

### Select Component

Dropdown selection component.

```tsx
import type { SelectOption } from "@opentui/core"
import { useState } from "react"

function App() {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const options: SelectOption[] = [
    { name: "Option 1", description: "Option 1 description", value: "opt1" },
    { name: "Option 2", description: "Option 2 description", value: "opt2" },
    { name: "Option 3", description: "Option 3 description", value: "opt3" },
  ]

  return (
    <box style={{ border: true, height: 24 }}>
      <select
        style={{ height: 22 }}
        options={options}
        focused={true}
        onChange={(index, option) => {
          setSelectedIndex(index)
          console.log("Selected:", option)
        }}
      />
    </box>
  )
}
```

### Scrollbox Component

A scrollable box.

```tsx
function App() {
  return (
    <scrollbox
      style={{
        rootOptions: {
          backgroundColor: "#24283b",
        },
        wrapperOptions: {
          backgroundColor: "#1f2335",
        },
        viewportOptions: {
          backgroundColor: "#1a1b26",
        },
        contentOptions: {
          backgroundColor: "#16161e",
        },
        scrollbarOptions: {
          showArrows: true,
          trackOptions: {
            foregroundColor: "#7aa2f7",
            backgroundColor: "#414868",
          },
        },
      }}
      focused
    >
      {Array.from({ length: 1000 }).map((_, i) => (
        <box
          key={i}
          style={{ width: "100%", padding: 1, marginBottom: 1, backgroundColor: i % 2 === 0 ? "#292e42" : "#2f3449" }}
        >
          <text content={`Box ${i}`} />
        </box>
      ))}
    </scrollbox>
  )
}
```

### ASCII Font Component

Display ASCII art text with different font styles.

```tsx
import { measureText } from "@opentui/core"
import { useState } from "react"

function App() {
  const text = "ASCII"
  const [font, setFont] = useState<"block" | "shade" | "slick" | "tiny">("tiny")

  const { width, height } = measureText({
    text,
    font,
  })

  return (
    <box style={{ border: true, paddingLeft: 1, paddingRight: 1 }}>
      <box
        style={{
          height: 8,
          border: true,
          marginBottom: 1,
        }}
      >
        <select
          focused
          onChange={(_, option) => setFont(option?.value)}
          showScrollIndicator
          options={[
            {
              name: "Tiny",
              description: "Tiny font",
              value: "tiny",
            },
            {
              name: "Block",
              description: "Block font",
              value: "block",
            },
            {
              name: "Slick",
              description: "Slick font",
              value: "slick",
            },
            {
              name: "Shade",
              description: "Shade font",
              value: "shade",
            },
          ]}
          style={{ flexGrow: 1 }}
        />
      </box>

      <ascii-font style={{ width, height }} text={text} font={font} />
    </box>
  )
}
```

## Examples

### Login Form

```tsx
import { render, useKeyboard } from "@opentui/react"
import { useCallback, useState } from "react"

function App() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [focused, setFocused] = useState<"username" | "password">("username")
  const [status, setStatus] = useState("idle")

  useKeyboard((key) => {
    if (key.name === "tab") {
      setFocused((prev) => (prev === "username" ? "password" : "username"))
    }
  })

  const handleSubmit = useCallback(() => {
    if (username === "admin" && password === "secret") {
      setStatus("success")
    } else {
      setStatus("error")
    }
  }, [username, password])

  return (
    <box style={{ border: true, padding: 2, flexDirection: "column", gap: 1 }}>
      <text fg="#FFFF00">Login Form</text>

      <box title="Username" style={{ border: true, width: 40, height: 3 }}>
        <input
          placeholder="Enter username..."
          onInput={setUsername}
          onSubmit={handleSubmit}
          focused={focused === "username"}
        />
      </box>

      <box title="Password" style={{ border: true, width: 40, height: 3 }}>
        <input
          placeholder="Enter password..."
          onInput={setPassword}
          onSubmit={handleSubmit}
          focused={focused === "password"}
        />
      </box>

      <text
        style={{
          fg: status === "success" ? "green" : status === "error" ? "red" : "#999",
        }}
      >
        {status.toUpperCase()}
      </text>
    </box>
  )
}

render(<App />)
```

### Counter with Timer

```tsx
import { render } from "@opentui/react"
import { useEffect, useState } from "react"

function App() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCount((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  return (
    <box title="Counter" style={{ padding: 2 }}>
      <text fg="#00FF00">{`Count: ${count}`}</text>
    </box>
  )
}

render(<App />)
```

### Styled Text Showcase

```tsx
import { render } from "@opentui/react"

function App() {
  return (
    <>
      <text>Simple text</text>
      <text>
        <strong>Bold text</strong>
      </text>
      <text>
        <u>Underlined text</u>
      </text>
      <text>
        <span fg="red">Red text</span>
      </text>
      <text>
        <span fg="blue">Blue text</span>
      </text>
      <text>
        <strong fg="red">Bold red text</strong>
      </text>
      <text>
        <strong>Bold</strong> and <span fg="blue">blue</span> combined
      </text>
    </>
  )
}

render(<App />)
```

## Component Extension

You can create custom components by extending OpenTUIs base renderables:

```tsx
import { BoxRenderable, OptimizedBuffer, RGBA, type BoxOptions, type RenderContext } from "@opentui/core"
import { extend, render } from "@opentui/react"

// Create custom component class
class ButtonRenderable extends BoxRenderable {
  private _label: string = "Button"

  constructor(ctx: RenderContext, options: BoxOptions & { label?: string }) {
    super(ctx, {
      border: true,
      borderStyle: "single",
      minHeight: 3,
      ...options,
    })

    if (options.label) {
      this._label = options.label
    }
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    const centerX = this.x + Math.floor(this.width / 2 - this._label.length / 2)
    const centerY = this.y + Math.floor(this.height / 2)

    buffer.drawText(this._label, centerX, centerY, RGBA.fromInts(255, 255, 255, 255))
  }

  set label(value: string) {
    this._label = value
    this.requestRender()
  }
}

// Add TypeScript support
declare module "@opentui/react" {
  interface OpenTUIComponents {
    consoleButton: typeof ButtonRenderable
  }
}

// Register the component
extend({ consoleButton: ButtonRenderable })

// Use in JSX
function App() {
  return (
    <box>
      <consoleButton label="Click me!" style={{ backgroundColor: "blue" }} />
      <consoleButton label="Another button" style={{ backgroundColor: "green" }} />
    </box>
  )
}

render(<App />)
```
