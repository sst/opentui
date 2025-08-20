# OpenTUI API Reference

OpenTUI is a TypeScript library for building rich terminal user interfaces with support for layouts, animations, 3D graphics, and interactive components.

## Core Modules

### Renderer
- [`CliRenderer`](./renderer.md) - Main terminal renderer class
- [`createCliRenderer`](./renderer.md#createclirenderer) - Factory function to create renderer instances

### Components
- [`Renderable`](./renderable.md) - Base class for all UI components
- [`BoxRenderable`](./components/box.md) - Container with borders and background
- [`TextRenderable`](./components/text.md) - Text display component
- [`GroupRenderable`](./components/group.md) - Layout container for child components
- [`Input`](./components/input.md) - Text input field
- [`Select`](./components/select.md) - Selection list component
- [`TabSelect`](./components/tab-select.md) - Tab-based selection
- [`FrameBuffer`](./components/framebuffer.md) - Offscreen rendering buffer
- [`ASCIIFont`](./components/ascii-font.md) - ASCII art text rendering

### Layout System
- [Yoga Layout Integration](./layout.md) - Flexbox-based layout system
- [Position Types](./layout.md#position-types) - Absolute, relative positioning
- [Flex Properties](./layout.md#flex-properties) - Flexbox configuration

### Styling
- [`StyledText`](./styled-text.md) - Rich text formatting
- [`RGBA`](./colors.md) - Color management
- [Border Styles](./borders.md) - Border configuration

### Input Handling
- [`KeyHandler`](./input/keys.md) - Keyboard input management
- [`MouseEvent`](./input/mouse.md) - Mouse interaction handling
- [`Selection`](./input/selection.md) - Text selection utilities

### Animation
- [`Timeline`](./animation/timeline.md) - Animation sequencing
- [Easing Functions](./animation/easing.md) - Animation curves

### Buffers
- [`OptimizedBuffer`](./buffers.md#optimizedbuffer) - High-performance terminal buffer
- [`TextBuffer`](./buffers.md#textbuffer) - Text rendering buffer

### 3D Graphics (Optional)
- [`WGPURenderer`](./3d/webgpu.md) - WebGPU-based 3D rendering
- [Sprite System](./3d/sprites.md) - 2D sprites in 3D space
- [Physics Integration](./3d/physics.md) - 2D physics engines

### Utilities
- [`parseColor`](./utils.md#parsecolor) - Color parsing utility
- [`ANSI`](./utils.md#ansi) - ANSI escape code helpers
- [Console Capture](./utils.md#console) - Console output management

## Quick Start

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable } from '@opentui/core'

// Create renderer
const renderer = await createCliRenderer({
  stdout: process.stdout,
  stdin: process.stdin,
  useMouse: true,
  useAlternateScreen: true
})

// Create UI components
const container = new BoxRenderable('container', {
  width: '100%',
  height: '100%',
  borderStyle: 'rounded',
  backgroundColor: '#1a1a1a'
})

const title = new TextRenderable('title', {
  content: 'Welcome to OpenTUI',
  fg: '#00ff00',
  marginTop: 1,
  marginLeft: 2
})

// Build UI hierarchy
container.appendChild(title)
renderer.root.appendChild(container)

// Handle input
renderer.on('keypress', (key) => {
  if (key.name === 'q') {
    renderer.cleanup()
    process.exit(0)
  }
})

// Start rendering
renderer.start()
```

## Installation

```bash
bun add @opentui/core
# or
npm install @opentui/core
```

## Requirements

- Bun >= 1.2.0 or Node.js >= 18
- TypeScript >= 5.0
- Terminal with ANSI color support
- Optional: GPU support for 3D features

## Next Steps

- [Getting Started Guide](../guides/getting-started.md)
- [Component Examples](../examples/README.md)
- [Layout Tutorial](../guides/layouts.md)
- [Animation Guide](../guides/animations.md)

api version 0.1.7 2025-08-19 wip
