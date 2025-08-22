# OpenTUI API Reference

Welcome to the OpenTUI API reference documentation. This comprehensive guide provides detailed information about all the components, functions, and classes available in the OpenTUI Core package.

## Core Rendering System

The core rendering system is the foundation of OpenTUI, providing the main renderer, layout management, and lifecycle handling.

### [Rendering Engine](./core/rendering.md)
- **CliRenderer**: The main rendering engine that manages terminal output and input
- **RenderContext**: Context information for rendering components
- **Lifecycle Methods**: Methods for controlling the rendering lifecycle
- **Performance Monitoring**: Tools for monitoring and optimizing performance

### [Buffer System](./buffer.md)
- **OptimizedBuffer**: High-performance buffer for terminal rendering
- **Drawing Operations**: Methods for drawing text, boxes, and other elements
- **Color Blending**: Functions for blending colors with alpha transparency
- **Buffer Composition**: Techniques for composing multiple buffers

### [Native Integration](./native-integration.md)
- **Zig Code**: Performance-critical code written in Zig
- **FFI Bindings**: JavaScript bindings to the native code
- **Platform Support**: Pre-built binaries for different platforms

## Components

OpenTUI provides a variety of components for building terminal user interfaces.

### [Renderables](./components/renderables.md)
- **BoxRenderable**: Container component with optional borders and background
- **TextRenderable**: Component for displaying text with styling
- **InputRenderable**: Text input field component
- **SelectRenderable**: Dropdown selection component
- **TabSelectRenderable**: Tabbed interface component
- **FrameBufferRenderable**: Canvas for custom drawing

### [ASCII Font](./renderables/ascii-font.md)
- **ASCIIFontRenderable**: Component for rendering ASCII art fonts
- **Built-in Fonts**: Several built-in ASCII art fonts
- **Custom Fonts**: Create and use custom ASCII art fonts

## Styling

OpenTUI provides rich styling capabilities for text, borders, and other visual elements.

### [Text Styling](./styling/text-styling.md)
- **Text Formatting**: Format text with colors and attributes
- **Color Management**: Foreground and background color handling

### [Border Styles](./lib/border.md)
- **Built-in Borders**: Various border styles for boxes and containers
- **Custom Borders**: Create your own border styles
- **Border Characters**: Control individual border characters

### [Styled Text](./lib/styled-text.md)
- **StyledText Class**: Create rich text with different styles
- **Text Attributes**: Bold, italic, underline, and other text attributes
- **Syntax Highlighting**: Create syntax highlighters for code

### [HAST Styled Text](./lib/hast-styled-text.md)
- **HAST Structure**: Hypertext Abstract Syntax Tree for complex text styling
- **SyntaxStyle**: Define and merge text styles
- **Syntax Highlighting**: Create syntax highlighters with HAST

### [Text Selection](./lib/selection.md)
- **Selection System**: Select and copy text from the terminal
- **TextSelectionHelper**: Handle text selection for standard text components
- **ASCIIFontSelectionHelper**: Handle text selection for ASCII font components

### [TrackedNode](./lib/tracked-node.md)
- **Layout Tree**: Build and manage layout trees with Yoga
- **Node Hierarchy**: Parent-child relationships between nodes
- **Percentage Dimensions**: Support for percentage-based dimensions

## Input Handling

OpenTUI provides comprehensive input handling for keyboard and mouse events.

### [Input System](./input/input.md)
- **Keyboard Input**: Handling key presses and keyboard shortcuts
- **Mouse Input**: Handling mouse clicks, movement, and scroll events
- **Focus Management**: Managing focus between components
- **Drag and Drop**: Support for drag and drop operations

### [Key Handler](./lib/keyhandler.md)
- **Key Events**: Processing and handling keyboard events
- **Key Combinations**: Support for key combinations like Ctrl+C
- **Navigation**: Keyboard-based navigation between components

## Animation

OpenTUI provides powerful animation capabilities for creating dynamic interfaces.

### [Animation System](./animation/animation.md)
- **Animation Basics**: Core animation concepts and techniques
- **Easing Functions**: Various easing functions for smooth animations
- **Sprite Animation**: Frame-based animations from sprite sheets
- **Particle Effects**: Visual effects with particle systems
- **Physics-Based Animation**: Integration with physics engines

### [Timeline](./animation/timeline.md)
- **Animation Sequencing**: Create complex animation sequences
- **Precise Timing**: Control animation timing with millisecond precision
- **Easing Functions**: Apply easing functions to animations
- **Nested Timelines**: Create hierarchical animation structures

## Advanced Features

OpenTUI includes advanced rendering capabilities for creating rich visual experiences.

### [3D Rendering](./advanced/3d.md)
- **Three.js Integration**: Create 3D scenes in the terminal
- **WebGPU Integration**: High-performance graphics rendering
- **Sprite Rendering**: Display images in the terminal
- **Texture Loading**: Load and manage textures
- **Lighting and Materials**: Advanced lighting and materials

### [WebGPU Shaders](./3d/shaders.md)
- **WGSL Shaders**: Write custom shaders in WebGPU Shading Language
- **Shader Effects**: Create visual effects with shaders
- **Supersampling**: Improve rendering quality with supersampling

### [Post-Processing Filters](./post/filters.md)
- **Basic Filters**: Scanlines, grayscale, sepia, invert, noise, and more
- **Advanced Effects**: Distortion, vignette, brightness, blur, and bloom
- **Combining Effects**: Create complex visual styles

### [Sprite Animation](./3d/sprite-animation.md)
- **Sprite Animator**: Animate sprites with frame-based animations
- **Sprite Resource Manager**: Load and manage sprite resources
- **Particle Effects**: Create particle effects with sprites

### [Physics Integration](./3d/physics.md)
- **Physics Adapters**: Integrate with Planck.js and Rapier physics engines
- **Rigid Bodies**: Create static, dynamic, and kinematic bodies
- **Joints and Constraints**: Connect bodies with joints and constraints
- **Collision Detection**: Detect and respond to collisions

## Utilities

OpenTUI provides various utility functions and classes for common tasks.

### [Utility Functions](./utils/utilities.md)
- **Color Utilities**: Tools for working with colors
- **ANSI Terminal Utilities**: Working with ANSI escape sequences
- **Buffer Utilities**: High-performance buffers for terminal rendering
- **Layout Utilities**: Tools for working with the layout system
- **Border Utilities**: Utilities for working with borders

### [Console](./utils/console.md)
- **Debug Console**: Terminal console for debugging and logging
- **Logging**: Log messages with different levels and colors
- **Console Window**: Create a console window within your application

### [Output Capture](./utils/output-capture.md)
- **Stdout Capture**: Capture and redirect standard output
- **Stderr Capture**: Capture and redirect standard error
- **Child Process Capture**: Capture output from child processes

## Quick Start Example

Here's a simple example to get you started with OpenTUI:

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable } from '@opentui/core';

async function main() {
  // Create the renderer
  const renderer = await createCliRenderer({
    targetFps: 30,
    useAlternateScreen: true
  });

  // Access the root element
  const { root } = renderer;

  // Create a container box
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'double',
    borderColor: '#3498db'
  });

  // Add a text element
  const text = new TextRenderable('title', {
    content: 'Hello, OpenTUI!',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });

  // Build the component tree
  container.add(text);
  root.add(container);

  // Start the rendering loop
  renderer.start();

  // Handle cleanup on exit
  process.on('SIGINT', () => {
    renderer.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Framework Integration

OpenTUI provides integration with popular JavaScript frameworks.

### [React Integration](./react/reconciler.md)
- **React Reconciler**: Build terminal UIs using React components and hooks
- **React Components**: Pre-built React components for common UI elements
- **React Hooks**: Custom React hooks for terminal-specific functionality
- **Event Handling**: React-style event handling for terminal events

## Additional Resources

- [Getting Started Guide](../getting-started.md): A beginner's guide to OpenTUI
- [Guides](../guides/index.md): In-depth guides on specific topics
- [Examples](../examples/index.md): Example applications built with OpenTUI
- [Source Code Examples](https://github.com/yourusername/opentui/tree/main/packages/core/src/examples): Examples in the source code repository
