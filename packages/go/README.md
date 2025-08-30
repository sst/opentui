# OpenTUI Go

Go bindings for [OpenTUI](https://github.com/sst/opentui), a high-performance terminal user interface library built with Zig.

## Features

- **High Performance**: Direct bindings to optimized Zig code
- **Memory Safe**: Automatic resource management with Go finalizers
- **Cross-Platform**: Support for Linux, macOS, and Windows
- **Full Feature Set**: Complete API coverage including mouse support
- **Idiomatic Go**: Proper error handling and Go conventions

## Installation

### 1. Install OpenTUI System Dependencies

First, install OpenTUI headers and libraries system-wide:

```bash
curl -L https://github.com/sst/opentui/releases/latest/download/install.sh | sh
```

This downloads the latest compiled libraries and headers for your platform and installs them to standard system locations.

### 2. Install Go Package

Then use in your Go projects:

```bash
go get github.com/sst/opentui/packages/go
```

### Requirements

- Go 1.21 or later
- CGO enabled
- pkg-config (usually pre-installed on most systems)

## Quick Start

```go
package main

import (
    "time"

    "github.com/sst/opentui/packages/go"
)

func main() {
    // Create renderer
    renderer := opentui.NewRenderer(80, 24)
    defer renderer.Close()

    // Get buffer and draw
    buffer, _ := renderer.GetNextBuffer()
    buffer.Clear(opentui.NewRGB(0.1, 0.1, 0.3))
    buffer.DrawText("Hello, OpenTUI!", 10, 5, opentui.White, nil, 0)

    // Render to terminal
    renderer.Render(true)
    time.Sleep(2 * time.Second)
}
```

## API Reference

### Core Types

#### Renderer

The main rendering engine that manages terminal output.

```go
renderer := opentui.NewRenderer(width, height)
defer renderer.Close()

// Basic rendering
buffer, err := renderer.GetNextBuffer()
renderer.Render(false)

// Mouse support
renderer.EnableMouse(true)  // Enable mouse tracking
renderer.DisableMouse()     // Disable mouse tracking

// Terminal control
renderer.ClearTerminal()
renderer.Resize(newWidth, newHeight)
```

#### Buffer

A 2D array of terminal cells for efficient rendering.

```go
buffer := opentui.NewBuffer(80, 24, false, opentui.WidthMethodUnicode)
defer buffer.Close()

// Drawing operations
buffer.Clear(opentui.Black)
buffer.DrawText("Hello", 0, 0, opentui.White, nil, 0)
buffer.FillRect(10, 10, 20, 5, opentui.Blue)

// Box drawing
options := opentui.BoxOptions{
    Sides: opentui.BorderSides{Top: true, Right: true, Bottom: true, Left: true},
    Fill: true,
    Title: "My Box",
    BorderChars: opentui.DefaultBoxChars,
}
buffer.DrawBox(5, 5, 30, 10, options, opentui.White, opentui.Gray)
```

#### TextBuffer

Efficient handling of styled text with line tracking.

```go
textBuffer := opentui.NewTextBuffer(1024, opentui.WidthMethodUnicode)
defer textBuffer.Close()

// Write styled text
chunk := opentui.TextChunk{
    Text: "Hello, World!",
    Foreground: &opentui.Red,
    Background: &opentui.Black,
}
written, err := textBuffer.WriteChunk(chunk)

// Finalize and get line info
textBuffer.FinalizeLineInfo()
lines, err := textBuffer.GetLineInfo()
```

### Colors and Styling

#### RGBA Colors

```go
// Predefined colors
opentui.Black, opentui.White, opentui.Red, opentui.Green, opentui.Blue
opentui.Yellow, opentui.Cyan, opentui.Magenta, opentui.Gray, opentui.Transparent

// Custom colors
color := opentui.NewRGBA(1.0, 0.5, 0.0, 1.0) // Orange
rgb := opentui.NewRGB(0.2, 0.8, 0.4)          // Green (alpha = 1.0)
```

#### Text Attributes

```go
opentui.AttrBold      // Bold text
opentui.AttrItalic    // Italic text
opentui.AttrUnderline // Underlined text
opentui.AttrBlink     // Blinking text
opentui.AttrReverse   // Reverse video
opentui.AttrStrike    // Strikethrough
opentui.AttrDim       // Dimmed text

// Combine attributes
attributes := opentui.AttrBold | opentui.AttrItalic
```

### Global Cursor Control

```go
// Position and visibility
opentui.SetCursorPosition(10, 5, true)

// Cursor style
opentui.SetCursorStyle(opentui.CursorBlock, true)     // Blinking block
opentui.SetCursorStyle(opentui.CursorUnderline, false) // Static underline
opentui.SetCursorStyle(opentui.CursorBar, true)       // Blinking bar

// Cursor color
opentui.SetCursorColor(opentui.Green)
```

### Advanced Features

#### Direct Buffer Access

For performance-critical operations, you can access buffer arrays directly:

```go
directAccess, err := buffer.GetDirectAccess()
if err != nil {
    panic(err)
}

// Direct manipulation of buffer data
cell, err := directAccess.GetCell(x, y)
directAccess.SetCell(x, y, opentui.Cell{
    Char: 'A',
    Foreground: opentui.Red,
    Background: opentui.Black,
    Attributes: opentui.AttrBold,
})
```

#### Hit Testing

For mouse interaction support:

```go
// Add hit areas
renderer.AddToHitGrid(10, 10, 20, 5, 42) // x, y, width, height, id

// Check for mouse hits
hitID, err := renderer.CheckHit(mouseX, mouseY)
if hitID == 42 {
    fmt.Println("Button was clicked!")
}
```

## Examples

See the `examples/` directory for complete working examples:

- `basic/` - Simple "Hello World" example
- `console/` - Interactive console demo with mouse support

To run examples:

```bash
cd examples/basic && go run .
cd examples/console && go run .
```

## Building from Source

To build with a custom OpenTUI library:

```bash
# Build Zig library (requires Zig 0.14+)
cd ../../core/src/zig
zig build -Doptimize=ReleaseFast

# Install locally instead of using releases
sudo cp lib/$(uname -m)-$(uname -s | tr '[:upper:]' '[:lower:]')/libopentui.* /usr/local/lib/
sudo cp ../../go/opentui.h /usr/local/include/

# Test Go bindings
cd ../../go
go test
```

## Platform Support

- ✅ macOS (Intel and Apple Silicon)
- ✅ Linux (x64 and ARM64)
- ✅ Windows (x64 and ARM64)

## License

MIT License - see main repository for details.
