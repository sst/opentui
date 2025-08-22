# Utilities API

OpenTUI provides a variety of utility functions and classes to help with common tasks when building terminal user interfaces.

## Color Utilities

### RGBA Class

The `RGBA` class represents a color with red, green, blue, and alpha components.

```typescript
import { RGBA } from '@opentui/core';

// Create a color from RGBA values (0-1 range)
const red = RGBA.fromValues(1, 0, 0, 1);

// Create a color from hex string
const blue = RGBA.fromHex('#0000ff');

// Create a color from RGB values (0-255 range)
const green = RGBA.fromRGB(0, 255, 0);

// Create a color from RGBA values (0-255 range)
const purple = RGBA.fromRGBA(128, 0, 128, 255);

// Get color components
const r = red.r;  // 1
const g = red.g;  // 0
const b = red.b;  // 0
const a = red.a;  // 1

// Convert to integer components (0-255)
const ints = red.toInts();  // [255, 0, 0, 255]

// Convert to hex string
const hex = red.toHex();  // '#ff0000'

// Check if two colors are equal
const isEqual = red.equals(RGBA.fromHex('#ff0000'));  // true

// Create a new color with modified alpha
const transparentRed = red.withAlpha(0.5);
```

### parseColor Function

The `parseColor` function converts various color formats to an `RGBA` object.

```typescript
import { parseColor, RGBA } from '@opentui/core';

// Parse a hex string
const red = parseColor('#ff0000');

// Parse an RGB string
const green = parseColor('rgb(0, 255, 0)');

// Parse an RGBA string
const blue = parseColor('rgba(0, 0, 255, 0.5)');

// Pass through an existing RGBA object
const existing = parseColor(RGBA.fromHex('#ff00ff'));

// Parse a named color
const black = parseColor('black');

// Parse 'transparent'
const transparent = parseColor('transparent');  // RGBA with 0 alpha
```

### Example: Creating a Color Palette

```typescript
import { BoxRenderable, TextRenderable, RGBA } from '@opentui/core';

// Create a color palette component
class ColorPalette extends BoxRenderable {
  constructor(id: string, options = {}) {
    super(id, {
      width: 40,
      height: 20,
      borderStyle: 'single',
      borderColor: '#ffffff',
      padding: 1,
      ...options
    });
    
    // Define colors
    const colors = [
      { name: 'Red', hex: '#e74c3c' },
      { name: 'Orange', hex: '#e67e22' },
      { name: 'Yellow', hex: '#f1c40f' },
      { name: 'Green', hex: '#2ecc71' },
      { name: 'Blue', hex: '#3498db' },
      { name: 'Purple', hex: '#9b59b6' },
      { name: 'Gray', hex: '#95a5a6' },
      { name: 'Black', hex: '#000000' },
      { name: 'White', hex: '#ffffff' }
    ];
    
    // Create color swatches
    for (let i = 0; i < colors.length; i++) {
      const color = colors[i];
      
      // Create a swatch container
      const swatch = new BoxRenderable(`swatch-${i}`, {
        width: '100%',
        height: 2,
        marginBottom: 1,
        flexDirection: 'row',
        border: false
      });
      
      // Create a color box
      const colorBox = new BoxRenderable(`color-${i}`, {
        width: 4,
        height: 2,
        marginRight: 1,
        borderStyle: 'single',
        borderColor: '#ffffff',
        backgroundColor: color.hex
      });
      
      // Create a label
      const label = new TextRenderable(`label-${i}`, {
        content: `${color.name} (${color.hex})`,
        fg: '#ffffff'
      });
      
      // Add to swatch
      swatch.add(colorBox);
      swatch.add(label);
      
      // Add to palette
      this.add(swatch);
    }
  }
}

// Usage
const palette = new ColorPalette('palette');
root.add(palette);
```

## ANSI Terminal Utilities

The `ANSI` class provides utilities for working with ANSI escape sequences.

```typescript
import { ANSI } from '@opentui/core';

// Cursor movement
const moveCursor = ANSI.moveCursor(10, 5);  // Move to row 10, column 5
const moveUp = ANSI.moveUp(2);              // Move up 2 lines
const moveDown = ANSI.moveDown(3);          // Move down 3 lines
const moveLeft = ANSI.moveLeft(4);          // Move left 4 columns
const moveRight = ANSI.moveRight(5);        // Move right 5 columns

// Cursor visibility
const showCursor = ANSI.showCursor;
const hideCursor = ANSI.hideCursor;

// Screen control
const clearScreen = ANSI.clearScreen;
const clearLine = ANSI.clearLine;
const clearToEndOfLine = ANSI.clearToEndOfLine;
const clearToStartOfLine = ANSI.clearToStartOfLine;

// Terminal modes
const alternateScreen = ANSI.switchToAlternateScreen;
const mainScreen = ANSI.switchToMainScreen;

// Colors
const setForeground = ANSI.setRgbForeground(255, 0, 0);  // Red text
const setBackground = ANSI.setRgbBackground(0, 0, 255);  // Blue background
const resetColors = ANSI.resetColors;

// Text styles
const bold = ANSI.bold;
const dim = ANSI.dim;
const italic = ANSI.italic;
const underline = ANSI.underline;
const blink = ANSI.blink;
const inverse = ANSI.inverse;
const hidden = ANSI.hidden;
const strikethrough = ANSI.strikethrough;
const resetStyles = ANSI.resetStyles;

// Mouse support
const enableMouse = ANSI.enableMouseTracking;
const disableMouse = ANSI.disableMouseTracking;
```

## Buffer Utilities

### OptimizedBuffer

The `OptimizedBuffer` class provides a high-performance buffer for terminal rendering. The public API uses these primary operations (many are FFI-backed for performance).

```typescript
import { OptimizedBuffer, RGBA } from '@opentui/core';

// Create a buffer
const buffer = OptimizedBuffer.create(80, 24);

// Set a cell (x, y, char, fg, bg, attributes)
buffer.setCell(10, 5, 'A', RGBA.fromHex('#ffffff'), RGBA.fromHex('#000000'), 0);

// Read a cell (returns { char, fg, bg, attributes } or null)
const cell = buffer.get(10, 5);
if (cell) {
  const charCode = cell.char;
  const fg = cell.fg;
  const bg = cell.bg;
  const attrs = cell.attributes;
}

// Alpha-aware single-cell write
buffer.setCellWithAlphaBlending(5, 5, 'A', RGBA.fromHex('#ffffff'), RGBA.fromValues(0,0,0,0.5), 0);

// Draw text
// Signature: drawText(text, x, y, fg, bg?, attributes?, selection?)
buffer.drawText('Hello, world!', 0, 0, RGBA.fromHex('#ffffff'));

// If you have a TextBuffer (styled/rich text), render it with drawTextBuffer
buffer.drawTextBuffer(textBuffer, 2, 2, /*clipRect?*/ undefined);

// Fill a rectangle area (alpha-aware)
buffer.fillRect(0, 0, 10, 3, RGBA.fromHex('#222222'));

// Draw a bordered box (uses border chars + title)
buffer.drawBox({
  x: 5,
  y: 5,
  width: 20,
  height: 10,
  border: true,
  borderStyle: 'single',
  borderColor: RGBA.fromHex('#ffffff'),
  backgroundColor: RGBA.fromHex('#000000'),
  title: 'My Box',
  titleAlignment: 'center'
});

// Compose / copy another buffer (FFI-preferred)
buffer.drawFrameBuffer(10, 5, otherBuffer);

// Packed / supersample helpers (for advanced use)
buffer.drawPackedBuffer(dataPtr, dataLen, posX, posY, terminalWidthCells, terminalHeightCells);
buffer.drawSuperSampleBuffer(x, y, pixelDataPtr, pixelDataLength, 'rgba8unorm', alignedBytesPerRow);

// Clear, resize, destroy
buffer.clear(RGBA.fromHex('#000000'));
buffer.resize(100, 30);
buffer.destroy();
```

- Many drawing operations are implemented in native code and invoked via FFI (the public methods call into FFI where available). Use the high-level public methods above rather than relying on non-existent convenience shims.
- If you need line/rectangle helpers, implement them using `drawText`/`setCell`/`fillRect` or add a helper in your application code.

### TextBuffer

The `TextBuffer` class provides specialized buffer for text rendering.

```typescript
import { TextBuffer, RGBA } from '@opentui/core';

// Create a text buffer
const buffer = TextBuffer.create(100);  // Initial capacity

// Set default styles
buffer.setDefaultFg(RGBA.fromHex('#ffffff'));
buffer.setDefaultBg(RGBA.fromHex('#000000'));
buffer.setDefaultAttributes(0x01);  // Bold

// Add text
buffer.addText(0, 0, 'Hello, world!');

// Add styled text
buffer.addText(0, 1, 'Colored text', RGBA.fromHex('#ff0000'));

// Set styled text
buffer.setStyledText(styledTextObject);

// Get line information
const lineInfo = buffer.lineInfo;
console.log(`Line starts: ${lineInfo.lineStarts}`);
console.log(`Line widths: ${lineInfo.lineWidths}`);

// Handle selection
buffer.setSelection(5, 10, RGBA.fromHex('#3498db'), RGBA.fromHex('#ffffff'));
buffer.resetSelection();

// Clear the buffer
buffer.clear();

// Clean up
buffer.destroy();
```

## Layout Utilities

### TrackedNode

The `TrackedNode` class provides a wrapper around Yoga layout nodes with additional tracking.

```typescript
import { TrackedNode, createTrackedNode } from '@opentui/core';
import Yoga from 'yoga-layout';

// Create a tracked node
const node = createTrackedNode();

// Create a tracked node with custom data
const nodeWithData = createTrackedNode({ myData: 'value' });

// Create a tracked node with custom Yoga config
const config = Yoga.Config.create();
const nodeWithConfig = createTrackedNode({}, config);

// Access the Yoga node
const yogaNode = node.yogaNode;

// Set width and height
node.setWidth(100);
node.setHeight(50);

// Set width and height with percentage
node.setWidth('50%');
node.setHeight('25%');

// Add a child node
const child = createTrackedNode();
const childIndex = node.addChild(child);

// Insert a child at a specific index
const anotherChild = createTrackedNode();
const insertedIndex = node.insertChild(anotherChild, 0);

// Remove a child
node.removeChild(child);

// Clean up
node.destroy();
```

### Yoga Options Utilities

OpenTUI provides utilities for working with Yoga layout options.

```typescript
import {
  parseFlexDirection,
  parseAlign,
  parseJustify,
  parsePositionType
} from '@opentui/core';
import { FlexDirection, Align, Justify, PositionType } from 'yoga-layout';

// Parse flex direction
const flexDirection = parseFlexDirection('row');  // FlexDirection.Row
const flexDirectionReverse = parseFlexDirection('row-reverse');  // FlexDirection.RowReverse

// Parse align
const align = parseAlign('center');  // Align.Center
const alignStart = parseAlign('flex-start');  // Align.FlexStart

// Parse justify
const justify = parseJustify('space-between');  // Justify.SpaceBetween
const justifyCenter = parseJustify('center');  // Justify.Center

// Parse position type
const position = parsePositionType('absolute');  // PositionType.Absolute
const positionRelative = parsePositionType('relative');  // PositionType.Relative
```

## Border Utilities

OpenTUI provides utilities for working with borders.

```typescript
import { getBorderSides, borderCharsToArray } from '@opentui/core';

// Get border sides configuration
const allSides = getBorderSides(true);  // All sides
const topBottom = getBorderSides(['top', 'bottom']);  // Only top and bottom
const none = getBorderSides(false);  // No sides

// Convert border characters to array
const borderChars = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  left: '├',
  right: '┤',
  top: '┬',
  bottom: '┴',
  middle: '┼'
};

const borderArray = borderCharsToArray(borderChars);
```

## Console Utilities

OpenTUI provides a terminal console for debugging and logging.

```typescript
import { createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer({
  useConsole: true,  // Enable console
  consoleOptions: {
    maxLines: 100,
    showTimestamps: true
  }
});

// Access the console
const console = renderer.console;

// Log messages
console.log('Info message');
console.warn('Warning message');
console.error('Error message');
console.debug('Debug message');

// Clear the console
console.clear();

// Get cached logs
const logs = console.getCachedLogs();

// Enable/disable the console
renderer.useConsole = false;  // Disable
renderer.useConsole = true;   // Enable

// Activate/deactivate the console
console.activate();
console.deactivate();
```

## Output Capture

OpenTUI provides utilities for capturing stdout and stderr output.

```typescript
import { capture } from '@opentui/core';

// Start capturing output
capture.start();

// Write to the capture buffer
capture.write('stdout', 'This is captured stdout');
capture.write('stderr', 'This is captured stderr');

// Get the captured output
const output = capture.getOutput();
console.log(output);  // All captured output

// Claim the output (get and clear)
const claimed = capture.claimOutput();
console.log(claimed);  // All captured output, buffer now empty

// Check if there's any captured output
const size = capture.size;
console.log(`Captured ${size} bytes`);

// Listen for write events
capture.on('write', () => {
  console.log('New output captured');
});

// Stop capturing
capture.stop();
```

## Miscellaneous Utilities

### Parsing Keypresses

```typescript
import { parseKeypress } from '@opentui/core';

// Parse a keypress
const key = parseKeypress('\x1b[A');  // Up arrow key
console.log(key);
// {
//   name: 'up',
//   sequence: '\x1b[A',
//   ctrl: false,
//   meta: false,
//   shift: false
// }

// Parse a control key
const ctrlC = parseKeypress('\u0003');  // Ctrl+C
console.log(ctrlC);
// {
//   name: 'c',
//   sequence: '\u0003',
//   ctrl: true,
//   meta: false,
//   shift: false
// }
```

### Parsing Mouse Events

```typescript
import { MouseParser } from '@opentui/core';

// Create a mouse parser
const mouseParser = new MouseParser();

// Parse a mouse event
const event = mouseParser.parseMouseEvent(Buffer.from('\x1b[M !"'));
console.log(event);
// {
//   type: 'down',
//   button: 0,  // Left button
//   x: 33,
//   y: 32,
//   modifiers: { shift: false, alt: false, ctrl: false }
// }

// Reset the parser
mouseParser.reset();
```

### Example: Creating a Debug Overlay

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, RGBA } from '@opentui/core';

async function createDebugOverlay() {
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a main content area
  const content = new BoxRenderable('content', {
    width: '100%',
    height: '100%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222'
  });
  
  root.add(content);
  
  // Create a debug overlay
  class DebugOverlay extends BoxRenderable {
    private fpsText: TextRenderable;
    private memoryText: TextRenderable;
    private positionText: TextRenderable;
    private mouseX: number = 0;
    private mouseY: number = 0;
    
    constructor(id: string, options = {}) {
      super(id, {
        width: 30,
        height: 10,
        position: 'absolute',
        x: 2,
        y: 2,
        borderStyle: 'single',
        borderColor: '#e74c3c',
        backgroundColor: RGBA.fromValues(0, 0, 0, 0.8),
        padding: 1,
        flexDirection: 'column',
        ...options
      });
      
      // Create text elements
      this.fpsText = new TextRenderable(`${id}-fps`, {
        content: 'FPS: 0',
        fg: '#ffffff',
        marginBottom: 1
      });
      
      this.memoryText = new TextRenderable(`${id}-memory`, {
        content: 'Memory: 0 MB',
        fg: '#ffffff',
        marginBottom: 1
      });
      
      this.positionText = new TextRenderable(`${id}-position`, {
        content: 'Mouse: 0,0',
        fg: '#ffffff'
      });
      
      // Add text elements
      this.add(this.fpsText);
      this.add(this.memoryText);
      this.add(this.positionText);
      
      // Listen for mouse events
      renderer.on('key', (data) => {
        // Toggle overlay with F12
        if (data.toString() === '\x1b[24~') {
          this.visible = !this.visible;
        }
      });
    }
    
    public updateStats(fps: number, memory: number): void {
      this.fpsText.content = `FPS: ${fps}`;
      this.memoryText.content = `Memory: ${(memory / (1024 * 1024)).toFixed(2)} MB`;
    }
    
    public updateMousePosition(x: number, y: number): void {
      this.mouseX = x;
      this.mouseY = y;
      this.positionText.content = `Mouse: ${x},${y}`;
    }
  }
  
  // Create the debug overlay
  const debug = new DebugOverlay('debug');
  root.add(debug);
  
  // Update stats periodically
  setInterval(() => {
    const stats = renderer.getStats();
    const memory = process.memoryUsage().heapUsed;
    debug.updateStats(stats.fps, memory);
  }, 1000);
  
  // Track mouse position
  renderer.on('mouseEvent', (event) => {
    debug.updateMousePosition(event.x, event.y);
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the debug overlay
createDebugOverlay().catch(console.error);
```

## Performance Utilities

### Benchmarking

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable } from '@opentui/core';

async function runBenchmark() {
  const renderer = await createCliRenderer({
    gatherStats: true,  // Enable stats gathering
    maxStatSamples: 1000
  });
  
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222',
    padding: 1,
    flexDirection: 'column'
  });
  
  // Create a stats display
  const statsText = new TextRenderable('stats', {
    content: 'Running benchmark...',
    fg: '#ffffff'
  });
  
  container.add(statsText);
  root.add(container);
  
  // Start the renderer
  renderer.start();
  
  // Create test components
  const testComponents = [];
  for (let i = 0; i < 100; i++) {
    const box = new BoxRenderable(`box-${i}`, {
      width: 10,
      height: 3,
      position: 'absolute',
      x: Math.floor(Math.random() * (renderer.width - 10)),
      y: Math.floor(Math.random() * (renderer.height - 3)),
      borderStyle: 'single',
      borderColor: '#ffffff',
      backgroundColor: '#333333'
    });
    
    testComponents.push(box);
    container.add(box);
  }
  
  // Run the benchmark for 5 seconds
  setTimeout(() => {
    // Get the stats
    const stats = renderer.getStats();
    
    // Update the display
    statsText.content = `
Benchmark Results:
FPS: ${stats.fps}
Average Frame Time: ${stats.averageFrameTime.toFixed(2)}ms
Min Frame Time: ${stats.minFrameTime.toFixed(2)}ms
Max Frame Time: ${stats.maxFrameTime.toFixed(2)}ms
Total Frames: ${stats.frameCount}
    `;
    
    // Remove test components
    for (const component of testComponents) {
      container.remove(component.id);
    }
    
    // Reset stats
    renderer.resetStats();
  }, 5000);
  
  return renderer;
}

// Run the benchmark
runBenchmark().catch(console.error);
```
