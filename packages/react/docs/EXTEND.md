# OpenTUI React Component Extension

The `extend` function allows you to add custom renderable components to the OpenTUI React reconciler, similar to how `@react-three/fiber` allows extending Three.js objects.

## Basic Usage

### Extending Components

```tsx
import { BoxRenderable, OptimizedBuffer, RGBA, type BoxOptions, type RenderContext } from "@opentui/core"
import { extend, render } from "@opentui/react"

class ConsoleButton extends BoxRenderable {
  public label: string = "Button"

  constructor(ctx: RenderContext, options: BoxOptions & { label: string }) {
    super(ctx, options)
    // Custom initialization

    this.height = 3
    this.width = 24
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer)

    const centerX = this.x + Math.floor(this.width / 2 - this.label.length / 2)
    const centerY = this.y + Math.floor(this.height / 2)

    buffer.drawText(this.label, centerX, centerY, RGBA.fromInts(255, 255, 255, 255))
  }
}

declare module "@opentui/react" {
  interface OpenTUIComponents {
    consoleButton: typeof ConsoleButton
  }
}

// Extend components
extend({
  consoleButton: ConsoleButton,
})

// Now you can use them in JSX
function App() {
  return <consoleButton label="Click me!" />
}
```

## TypeScript Support

For full TypeScript support, declare your extended components using module augmentation:

```tsx
// In your component file or declaration file
declare module "@opentui/react" {
  interface OpenTUIComponents {
    consoleButton: typeof ConsoleButton
  }
}

// Then extend and use with full type safety
extend({
  consoleButton: ConsoleButton,
})

// TypeScript will now know about these components
<consoleButton label="Typed!" />
```

## API Reference

### `extend(components)`

Extends the component catalogue with new renderable components.

**Parameters:**

- `components`: Object mapping component names to renderable constructors

**Returns:**

- `void` when passing an object of components

### `getComponentCatalogue()`

Returns the current extended component catalogue (used internally by reconciler).

## Best Practices

1. **Declare types with module augmentation**: This provides full IntelliSense and type checking

2. **Call `requestRender()`**: Don't forget to call `requestRender()` when properties change to trigger re-rendering

3. **Extend from appropriate base classes**: Use `BoxRenderable` for containers, `TextRenderable` for text, etc.

## Limitations

- Extended components must extend from OpenTUI's core renderable classes
- Component names should be unique to avoid conflicts
- TypeScript support requires manual module augmentation declarations
