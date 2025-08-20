# Rendering API

The OpenTUI rendering system provides a powerful and flexible way to create terminal user interfaces. It handles the low-level details of terminal rendering, layout management, and input handling.

## CliRenderer

The `CliRenderer` is the core rendering engine that manages the terminal output, input handling, and rendering loop.

### Creating a Renderer

```typescript
import { createCliRenderer } from '@opentui/core';

// Create a renderer with default options
const renderer = await createCliRenderer();

// Create a renderer with custom options
const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 60,
  useMouse: true,
  useAlternateScreen: true,
  useConsole: false,
  gatherStats: false
});
```

### Renderer Configuration Options

```typescript
interface CliRendererConfig {
  stdin?: NodeJS.ReadStream;           // Input stream (default: process.stdin)
  stdout?: NodeJS.WriteStream;         // Output stream (default: process.stdout)
  exitOnCtrlC?: boolean;               // Exit on Ctrl+C (default: true)
  debounceDelay?: number;              // Debounce delay for rendering in ms (default: 0)
  targetFps?: number;                  // Target frames per second (default: 60)
  memorySnapshotInterval?: number;     // Memory snapshot interval in ms
  useThread?: boolean;                 // Use worker thread (default: false)
  gatherStats?: boolean;               // Collect performance stats (default: false)
  maxStatSamples?: number;             // Max stat samples (default: 100)
  consoleOptions?: ConsoleOptions;     // Console capture options
  postProcessFns?: Function[];         // Post-processing functions
  enableMouseMovement?: boolean;       // Track mouse movement (default: false)
  useMouse?: boolean;                  // Enable mouse support (default: false)
  useAlternateScreen?: boolean;        // Use alternate screen buffer (default: true)
  useConsole?: boolean;                // Capture console output (default: false)
  experimental_splitHeight?: number;   // Split screen height (experimental)
}
```

## Renderer Properties

### `root: RootRenderable`
The root component container. All UI components should be added as children of root.

```typescript
const { root } = renderer;
root.add(myComponent);
```

### `width: number`
Current terminal width in columns.

### `height: number`
Current terminal height in rows.

### `console: TerminalConsole | null`
Console instance for captured output (when `useConsole` is true).

### `selection: Selection`
Global text selection manager.

## Renderer Methods

### Lifecycle Methods

#### `start(): void`
Start the rendering loop.

```typescript
renderer.start();
```

#### `pause(): void`
Pause the rendering loop.

```typescript
renderer.pause();
```

#### `stop(): void`
Stop the rendering loop.

```typescript
renderer.stop();
```

#### `destroy(): void`
Clean up resources and restore terminal state.

```typescript
renderer.destroy();
```

### Display Control

#### `setBackgroundColor(color: ColorInput): void`
Set the terminal background color.

```typescript
renderer.setBackgroundColor('#1a1a1a');
renderer.setBackgroundColor(RGBA.fromHex('#000000'));
```

#### `setCursorPosition(x: number, y: number, visible?: boolean): void`
Set the cursor position and visibility.

```typescript
renderer.setCursorPosition(10, 5, true);
```

#### `setCursorStyle(style: CursorStyle, blinking?: boolean, color?: RGBA): void`
Set the cursor appearance.

```typescript
renderer.setCursorStyle('block', true);
renderer.setCursorStyle('underline', false, RGBA.fromHex('#00ff00'));
// Styles: 'block', 'underline', 'bar', 'block-blinking', 'underline-blinking', 'bar-blinking'
```

#### `setCursorColor(color: RGBA): void`
Set the cursor color.

```typescript
renderer.setCursorColor(RGBA.fromHex('#ffffff'));
```

### Debug and Performance

#### `toggleDebugOverlay(): void`
Toggle the debug overlay display.

```typescript
renderer.toggleDebugOverlay();
```

#### `configureDebugOverlay(config: DebugOverlayConfig): void`
Configure debug overlay settings.

```typescript
renderer.configureDebugOverlay({
  enabled: true,
  corner: DebugOverlayCorner.bottomRight
});
```

#### `getStats(): RendererStats`
Get performance statistics.

```typescript
const stats = renderer.getStats();
console.log(`FPS: ${stats.fps}`);
console.log(`Frame time: ${stats.averageFrameTime}ms`);
console.log(`Max frame time: ${stats.maxFrameTime}ms`);
```

#### `resetStats(): void`
Reset performance statistics.

```typescript
renderer.resetStats();
```

#### `setGatherStats(enabled: boolean): void`
Enable or disable statistics gathering.

```typescript
renderer.setGatherStats(true);
```

### Post-Processing

#### `addPostProcessFn(fn: PostProcessFunction): void`
Add a post-processing function applied to each frame.

```typescript
renderer.addPostProcessFn((buffer: OptimizedBuffer, deltaTime: number) => {
  // Apply effects to the buffer
  for (let y = 0; y < buffer.height; y += 2) {
    for (let x = 0; x < buffer.width; x++) {
      const cell = buffer.getCell(x, y);
      // Modify cell attributes for scanline effect
      buffer.setCell(x, y, cell.char, cell.fg, cell.bg, cell.attributes | 0x08);
    }
  }
});
```

#### `removePostProcessFn(fn: PostProcessFunction): void`
Remove a post-processing function.

```typescript
renderer.removePostProcessFn(myPostProcessFn);
```

#### `clearPostProcessFns(): void`
Clear all post-processing functions.

```typescript
renderer.clearPostProcessFns();
```

### Frame Callbacks

#### `setFrameCallback(callback: FrameCallback): void`
Set a callback executed each frame.

```typescript
renderer.setFrameCallback(async (deltaTime: number) => {
  // Update animations or perform frame-based logic
  await updateAnimations(deltaTime);
});
```

### Animation Frame API

OpenTUI provides browser-compatible animation frame methods:

```typescript
// Request an animation frame
const frameId = renderer.requestAnimationFrame((deltaTime: number) => {
  // Animation logic
});

// Cancel an animation frame
renderer.cancelAnimationFrame(frameId);
```

### Selection Management

#### `hasSelection(): boolean`
Check if there's an active text selection.

```typescript
if (renderer.hasSelection()) {
  const text = renderer.getSelection();
}
```

#### `getSelection(): string`
Get the currently selected text.

```typescript
const selectedText = renderer.getSelection();
```

#### `clearSelection(): void`
Clear the current selection.

```typescript
renderer.clearSelection();
```

#### `getSelectionContainer(): Renderable | null`
Get the container of the current selection.

```typescript
const container = renderer.getSelectionContainer();
```

## Events

The renderer extends `EventEmitter` and emits the following events:

### `'key'`
Fired when a key is pressed.

```typescript
renderer.on('key', (key: ParsedKey) => {
  console.log('Key pressed:', key.name);
  if (key.ctrl && key.name === 'c') {
    // Handle Ctrl+C
  }
});
```

**ParsedKey Structure:**
```typescript
interface ParsedKey {
  name: string;        // Key name (e.g., 'a', 'enter', 'up')
  ctrl: boolean;       // Ctrl modifier
  meta: boolean;       // Meta/Alt modifier
  shift: boolean;      // Shift modifier
  sequence: string;    // Raw key sequence
}
```

### `'mouse'`
Fired for mouse events.

```typescript
renderer.on('mouse', (event: MouseEvent) => {
  console.log('Mouse event:', event.type, 'at', event.x, event.y);
});
```

### `'resize'`
Fired when the terminal is resized.

```typescript
renderer.on('resize', (width: number, height: number) => {
  console.log('Terminal resized to:', width, 'x', height);
});
```

## RenderContext

The `RenderContext` provides information and utilities for rendering components.

```typescript
interface RenderContext {
  // Add component to hit testing grid
  addToHitGrid(x: number, y: number, width: number, height: number, id: number): void;
  
  // Get current viewport dimensions
  width(): number;
  height(): number;
  
  // Request a re-render
  needsUpdate(): void;
}
```

## Mouse Events

OpenTUI provides comprehensive mouse event handling.

### MouseEvent Class

```typescript
class MouseEvent {
  readonly type: MouseEventType;    // Event type
  readonly button: number;           // Mouse button (MouseButton enum)
  readonly x: number;                // X coordinate
  readonly y: number;                // Y coordinate
  readonly source?: Renderable;      // Source component (for drag)
  readonly modifiers: {
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
  };
  readonly scroll?: ScrollInfo;      // Scroll information
  readonly target: Renderable | null; // Target component
  
  preventDefault(): void;            // Prevent default handling
}
```

### MouseEventType

```typescript
type MouseEventType = 
  | 'click'      // Mouse click
  | 'dblclick'   // Double click
  | 'down'       // Mouse button down
  | 'up'         // Mouse button up
  | 'move'       // Mouse movement
  | 'over'       // Mouse over component
  | 'out'        // Mouse out of component
  | 'drag'       // Dragging
  | 'dragstart'  // Drag started
  | 'dragend'    // Drag ended
  | 'scroll';    // Mouse wheel scroll
```

### MouseButton Enum

```typescript
enum MouseButton {
  LEFT = 0,
  MIDDLE = 1,
  RIGHT = 2,
  WHEEL_UP = 4,
  WHEEL_DOWN = 5,
}
```

### Example: Handling Mouse Events

```typescript
class InteractiveBox extends BoxRenderable {
  protected handleMouse(event: MouseEvent): boolean {
    switch (event.type) {
      case 'over':
        this.borderColor = '#00ff00';
        break;
      case 'out':
        this.borderColor = '#ffffff';
        break;
      case 'click':
        if (event.button === MouseButton.LEFT) {
          console.log('Left clicked at', event.x, event.y);
          event.preventDefault();
          return true;
        }
        break;
      case 'scroll':
        if (event.scroll) {
          console.log('Scrolled:', event.scroll.direction);
        }
        break;
    }
    return false;
  }
}
```

## Complete Example Application

```typescript
import { 
  createCliRenderer, 
  BoxRenderable, 
  TextRenderable,
  Input,
  RGBA
} from '@opentui/core';

async function main() {
  // Create renderer with options
  const renderer = await createCliRenderer({
    useMouse: true,
    useAlternateScreen: true,
    targetFps: 60,
    exitOnCtrlC: true
  });

  // Get root container
  const { root } = renderer;

  // Create main container
  const app = new BoxRenderable('app', {
    width: '100%',
    height: '100%',
    borderStyle: 'double',
    borderColor: '#3498db',
    backgroundColor: '#1a1a1a',
    padding: 1
  });

  // Add title
  const title = new TextRenderable('title', {
    content: 'OpenTUI Application',
    fg: '#ffffff',
    alignItems: 'center',
    marginBottom: 2
  });

  // Add input field
  const input = new Input('input', {
    width: '80%',
    placeholder: 'Type a command...',
    marginLeft: '10%'
  });

  // Build component tree
  app.add(title);
  app.add(input);
  root.add(app);

  // Handle input submission
  input.on('submit', (value: string) => {
    console.log('Command:', value);
    input.value = '';
  });

  // Handle global keys
  renderer.on('key', (key) => {
    if (key.name === 'escape') {
      renderer.destroy();
      process.exit(0);
    }
  });

  // Handle resize
  renderer.on('resize', (width, height) => {
    console.log(`Resized to ${width}x${height}`);
  });

  // Add post-processing effect
  renderer.addPostProcessFn((buffer, deltaTime) => {
    // Add a subtle vignette effect
    const centerX = Math.floor(buffer.width / 2);
    const centerY = Math.floor(buffer.height / 2);
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
    
    for (let y = 0; y < buffer.height; y++) {
      for (let x = 0; x < buffer.width; x++) {
        const dist = Math.sqrt(
          Math.pow(x - centerX, 2) + 
          Math.pow(y - centerY, 2)
        );
        const factor = 1 - (dist / maxDist) * 0.3;
        
        const cell = buffer.getCell(x, y);
        if (cell) {
          const dimmedFg = cell.fg.multiply(factor);
          buffer.setCell(x, y, cell.char, dimmedFg, cell.bg);
        }
      }
    }
  });

  // Start rendering
  renderer.start();
  
  // Focus the input
  input.focus();

  // Cleanup on exit
  process.on('SIGINT', () => {
    renderer.destroy();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Advanced Features

### Split Screen Mode (Experimental)

Split the terminal between the renderer and regular console output:

```typescript
const renderer = await createCliRenderer({
  experimental_splitHeight: 10  // Reserve 10 lines for renderer
});

// The renderer will only use the top 10 lines
// Console output will appear below
```

### Console Capture

Capture and display console output within the TUI:

```typescript
const renderer = await createCliRenderer({
  useConsole: true,
  consoleOptions: {
    maxLines: 100,
    autoscroll: true
  }
});

// Console output is now captured
console.log('This appears in the TUI console');

// Access the console component
const consoleComponent = renderer.console;
```

### Performance Optimization

For high-performance applications:

```typescript
const renderer = await createCliRenderer({
  targetFps: 120,              // Higher frame rate
  debounceDelay: 0,           // No debouncing
  useThread: true,            // Use worker thread
  gatherStats: true,          // Monitor performance
  maxStatSamples: 1000        // More samples for analysis
});

// Monitor performance
setInterval(() => {
  const stats = renderer.getStats();
  if (stats.averageFrameTime > 16.67) {
    console.warn('Frame rate below 60 FPS');
  }
}, 1000);
```