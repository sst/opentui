# Renderables API

Renderables are the building blocks of OpenTUI interfaces. They represent visual elements that can be rendered to the terminal screen.

## Renderable Base Class

All visual components in OpenTUI extend the `Renderable` base class, which provides core functionality for layout, rendering, and event handling.

### Creating a Renderable

```typescript
import { Renderable, OptimizedBuffer, RenderContext } from '@opentui/core';

class MyComponent extends Renderable {
  constructor(id: string, options: RenderableOptions = {}) {
    super(id, options);
  }
  
  // Override to provide custom rendering
  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    // Custom rendering logic
    buffer.drawText('My Component', this.x, this.y, RGBA.fromHex('#ffffff'));
  }
}
```

### RenderableOptions

```typescript
interface RenderableOptions {
  // Size
  width?: number | 'auto' | `${number}%`
  height?: number | 'auto' | `${number}%`
  
  // Visibility
  visible?: boolean
  zIndex?: number
  buffered?: boolean
  
  // Layout (Flexbox)
  flexGrow?: number
  flexShrink?: number
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexBasis?: number | 'auto'
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch'
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly'
  
  // Position
  position?: 'relative' | 'absolute'
  top?: number | 'auto' | `${number}%`
  right?: number | 'auto' | `${number}%`
  bottom?: number | 'auto' | `${number}%`
  left?: number | 'auto' | `${number}%`
  
  // Size constraints
  minWidth?: number | `${number}%`
  minHeight?: number | `${number}%`
  maxWidth?: number | `${number}%`
  maxHeight?: number | `${number}%`
  
  // Spacing
  margin?: number | 'auto' | `${number}%`
  marginTop?: number | 'auto' | `${number}%`
  marginRight?: number | 'auto' | `${number}%`
  marginBottom?: number | 'auto' | `${number}%`
  marginLeft?: number | 'auto' | `${number}%`
  
  padding?: number | `${number}%`
  paddingTop?: number | `${number}%`
  paddingRight?: number | `${number}%`
  paddingBottom?: number | `${number}%`
  paddingLeft?: number | `${number}%`
  
  // Layout control
  enableLayout?: boolean
}
```

## Properties

### Layout Properties

| Property | Type | Description |
|----------|------|-------------|
| `x` | `number` | Computed X position (read-only) |
| `y` | `number` | Computed Y position (read-only) |
| `width` | `number` | Computed width in characters |
| `height` | `number` | Computed height in lines |
| `visible` | `boolean` | Visibility state |
| `zIndex` | `number` | Stacking order |

### Position Properties

| Property | Type | Description |
|----------|------|-------------|
| `position` | `'relative' \| 'absolute'` | Position type |
| `top` | `number \| 'auto' \| \`${number}%\`` | Top offset |
| `right` | `number \| 'auto' \| \`${number}%\`` | Right offset |
| `bottom` | `number \| 'auto' \| \`${number}%\`` | Bottom offset |
| `left` | `number \| 'auto' \| \`${number}%\`` | Left offset |

### Flexbox Properties

| Property | Type | Description |
|----------|------|-------------|
| `flexGrow` | `number` | Flex grow factor |
| `flexShrink` | `number` | Flex shrink factor |
| `flexDirection` | `string` | Flex container direction |
| `flexBasis` | `number \| 'auto'` | Initial main size |
| `alignItems` | `string` | Cross-axis alignment |
| `justifyContent` | `string` | Main-axis alignment |

### Size Constraint Properties

| Property | Type | Description |
|----------|------|-------------|
| `minWidth` | `number \| \`${number}%\`` | Minimum width |
| `minHeight` | `number \| \`${number}%\`` | Minimum height |
| `maxWidth` | `number \| \`${number}%\`` | Maximum width |
| `maxHeight` | `number \| \`${number}%\`` | Maximum height |

### Spacing Properties

| Property | Type | Description |
|----------|------|-------------|
| `margin` | `number \| 'auto' \| \`${number}%\`` | All margins |
| `marginTop` | `number \| 'auto' \| \`${number}%\`` | Top margin |
| `marginRight` | `number \| 'auto' \| \`${number}%\`` | Right margin |
| `marginBottom` | `number \| 'auto' \| \`${number}%\`` | Bottom margin |
| `marginLeft` | `number \| 'auto' \| \`${number}%\`` | Left margin |
| `padding` | `number \| \`${number}%\`` | All padding |
| `paddingTop` | `number \| \`${number}%\`` | Top padding |
| `paddingRight` | `number \| \`${number}%\`` | Right padding |
| `paddingBottom` | `number \| \`${number}%\`` | Bottom padding |
| `paddingLeft` | `number \| \`${number}%\`` | Left padding |

### State Properties

| Property | Type | Description |
|----------|------|-------------|
| `focused` | `boolean` | Focus state (read-only) |
| `selectable` | `boolean` | Whether text can be selected |
| `focusable` | `boolean` | Whether component can receive focus |

## Methods

### Hierarchy Management

#### `add(child: Renderable, index?: number): number`
Add a child component at optional index.

```typescript
container.add(childComponent);
container.add(childComponent, 0); // Insert at beginning
```

#### `insertBefore(child: Renderable, anchor?: Renderable): number`
Insert a child before another child.

```typescript
container.insertBefore(newChild, existingChild);
```

#### `remove(id: string): void`
Remove a child component by ID.

```typescript
container.remove('child-id');
```

#### `getRenderable(id: string): Renderable | undefined`
Find a child by ID.

```typescript
const child = container.getRenderable('my-child');
```

#### `getChildren(): Renderable[]`
Get all child components.

```typescript
const children = container.getChildren();
```

### Focus Management

#### `focus(): void`
Request focus for this component.

```typescript
input.focus();
```

#### `blur(): void`
Remove focus from this component.

```typescript
input.blur();
```

### Layout Control

#### `needsUpdate(): void`
Mark the component as needing a render update.

```typescript
component.needsUpdate();
```

#### `requestMeasure(): void`
Request a layout measurement pass.

```typescript
component.requestMeasure();
```

#### `getLayoutNode(): TrackedNode`
Get the Yoga layout node.

```typescript
const node = component.getLayoutNode();
```

### Selection

#### `getSelectedText(): string`
Get the currently selected text.

```typescript
const selected = component.getSelectedText();
```

### Rendering (Protected Methods)

#### `renderSelf(buffer: OptimizedBuffer, deltaTime: number): void`
Main rendering method (override in subclasses).

```typescript
protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
  // Custom rendering logic
  buffer.drawText('Hello', this.x, this.y, RGBA.fromHex('#ffffff'));
}
```

#### `render(buffer: OptimizedBuffer, deltaTime: number): void`
Full render method (usually not overridden).

### Event Handling (Protected Methods)

#### `handleMouse(event: MouseEvent): boolean`
Handle mouse events (override for custom behavior).

```typescript
protected handleMouse(event: MouseEvent): boolean {
  if (event.type === 'click') {
    // Handle click
    return true; // Event handled
  }
  return false;
}
```

#### `handleKeyPress(key: ParsedKey): boolean`
Handle keyboard events (override for custom behavior).

```typescript
protected handleKeyPress(key: ParsedKey): boolean {
  if (key.name === 'enter') {
    // Handle enter key
    return true;
  }
  return false;
}
```

#### `handleSelection(state: SelectionState): void`
Handle text selection (override for custom behavior).

```typescript
protected handleSelection(state: SelectionState): void {
  // Custom selection logic
}
```

### Lifecycle Methods

#### `onResize(width: number, height: number): void`
Called when the component is resized.

```typescript
protected onResize(width: number, height: number): void {
  super.onResize(width, height);
  // Custom resize logic
}
```

#### `destroy(): void`
Clean up resources.

```typescript
component.destroy();
```

## Events

Renderable extends `EventEmitter` and emits the following events:

| Event | Data | Description |
|-------|------|-------------|
| `layout-changed` | - | Layout was recalculated |
| `added` | `parent: Renderable` | Added to parent |
| `removed` | `parent: Renderable` | Removed from parent |
| `resized` | `{width, height}` | Size changed |
| `focused` | - | Component gained focus |
| `blurred` | - | Component lost focus |

## Built-in Components

### BoxRenderable

Container with optional borders and background.

```typescript
import { BoxRenderable } from '@opentui/core';

const box = new BoxRenderable('myBox', {
  width: 30,
  height: 15,
  backgroundColor: '#222222',
  borderStyle: 'double',
  borderColor: '#3498db',
  title: 'My Box',
  titleAlignment: 'center'
});
```

**BoxRenderable Options:**
- `backgroundColor`: Background color
- `borderStyle`: Border style ('single', 'double', 'rounded', 'bold', 'ascii')
- `border`: Show borders (boolean or array of sides)
- `borderColor`: Border color
- `title`: Title text
- `titleAlignment`: Title alignment ('left', 'center', 'right')
- `focusedBorderColor`: Border color when focused

### TextRenderable

Displays text with styling.

```typescript
import { TextRenderable } from '@opentui/core';

const text = new TextRenderable('myText', {
  content: 'Hello, world!',
  fg: '#ffffff',
  bg: '#000000',
  selectable: true
});
```

**TextRenderable Options:**
- `content`: Text content (string or StyledText)
- `fg`: Foreground color
- `bg`: Background color
- `selectable`: Enable text selection
- `attributes`: Text attributes (bold, underline, etc.)

### FrameBufferRenderable

Provides an offscreen buffer for custom drawing.

```typescript
import { FrameBufferRenderable, RGBA } from '@opentui/core';

const canvas = new FrameBufferRenderable('myCanvas', {
  width: 40,
  height: 20,
  respectAlpha: true
});

// Draw on the internal buffer
canvas.frameBuffer.fillRect(0, 0, 40, 20, RGBA.fromHex('#000000'));
canvas.frameBuffer.drawText('Hello', 2, 2, RGBA.fromHex('#ffffff'));
```

**FrameBufferRenderable Properties:**
- `frameBuffer`: Internal OptimizedBuffer for drawing
- `respectAlpha`: Enable alpha blending

### ASCIIFontRenderable

Renders text using ASCII art fonts. Supports both built-in fonts and custom fonts loaded from JSON files.

```typescript
import { ASCIIFontRenderable, fonts, type FontDefinition } from '@opentui/core';

// Using built-in font
const asciiText = new ASCIIFontRenderable('myAsciiText', {
  text: 'HELLO',
  font: fonts.block,
  fg: '#ffffff'
});

// Using custom font from JSON file
import customFont from './my-custom-font.json';

const customText = new ASCIIFontRenderable('customText', {
  text: 'CUSTOM',
  font: customFont as FontDefinition,
  fg: '#00ff00'
});
```

**ASCIIFontRenderable Options:**
- `text`: Text to render
- `font`: FontDefinition object (use `fonts.tiny`, `fonts.block`, `fonts.slick`, `fonts.shade` for built-in, or import custom JSON)
- `fg`: Foreground color (string or RGBA or array for multi-color support)
- `bg`: Background color (string or RGBA)
- `selectable`: Enable text selection (boolean)
- `selectionBg`: Selection background color
- `selectionFg`: Selection foreground color

**Built-in Fonts:**
- `fonts.tiny`: Small 2-line font
- `fonts.block`: Bold block letters
- `fonts.shade`: Shaded 3D effect
- `fonts.slick`: Slick stylized font

**Custom Fonts:**
Custom fonts must be cfont-compatible JSON files with the following structure:
```json
{
  "name": "myfont",
  "lines": 3,
  "letterspace_size": 1,
  "letterspace": [" ", " ", " "],
  "chars": {
    "A": ["▄▀█", "█▀█", "█ █"],
    "B": ["█▄▄", "█▄█", "█▄█"],
    // ... more characters
  }
}
```

### Input

Text input field component.

```typescript
import { Input } from '@opentui/core';

const input = new Input('myInput', {
  width: 30,
  placeholder: 'Enter text...',
  value: '',
  password: false
});

input.on('submit', (value: string) => {
  console.log('Submitted:', value);
});
```

**Input Options:**
- `value`: Initial value
- `placeholder`: Placeholder text
- `password`: Hide input (password mode)
- `multiline`: Enable multiline input

### Select

Dropdown selection component.

```typescript
import { Select } from '@opentui/core';

const select = new Select('mySelect', {
  options: ['Option 1', 'Option 2', 'Option 3'],
  selected: 0,
  width: 20
});

select.on('change', (index: number, value: string) => {
  console.log('Selected:', value);
});
```

**Select Options:**
- `options`: Array of options
- `selected`: Initially selected index
- `maxHeight`: Maximum dropdown height

### TabSelect

Tab selection component.

```typescript
import { TabSelect } from '@opentui/core';

const tabs = new TabSelect('myTabs', {
  tabs: ['Tab 1', 'Tab 2', 'Tab 3'],
  selected: 0
});

tabs.on('change', (index: number) => {
  console.log('Selected tab:', index);
});
```

**TabSelect Options:**
- `tabs`: Array of tab labels
- `selected`: Initially selected tab index

### Group

Container for grouping components without visual representation.

```typescript
import { Group } from '@opentui/core';

const group = new Group('myGroup', {
  flexDirection: 'row',
  gap: 2
});
```

## Creating Custom Components

Extend the `Renderable` class to create custom components:

```typescript
import { Renderable, OptimizedBuffer, RGBA, RenderableOptions } from '@opentui/core';

interface ProgressBarOptions extends RenderableOptions {
  progress?: number;
  barColor?: string;
  backgroundColor?: string;
}

class ProgressBar extends Renderable {
  private _progress: number = 0;
  private _barColor: RGBA;
  private _backgroundColor: RGBA;
  
  constructor(id: string, options: ProgressBarOptions = {}) {
    super(id, {
      height: 1,
      ...options
    });
    
    this._progress = options.progress || 0;
    this._barColor = RGBA.fromHex(options.barColor || '#3498db');
    this._backgroundColor = RGBA.fromHex(options.backgroundColor || '#222222');
  }
  
  get progress(): number {
    return this._progress;
  }
  
  set progress(value: number) {
    this._progress = Math.max(0, Math.min(100, value));
    this.needsUpdate();
  }
  
  protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
    const width = this.width;
    const filledWidth = Math.floor((width * this._progress) / 100);
    
    // Draw background
    buffer.fillRect(this.x, this.y, width, 1, this._backgroundColor);
    
    // Draw progress
    if (filledWidth > 0) {
      buffer.fillRect(this.x, this.y, filledWidth, 1, this._barColor);
    }
    
    // Draw percentage text
    const text = `${this._progress}%`;
    const textX = this.x + Math.floor((width - text.length) / 2);
    buffer.drawText(text, textX, this.y, RGBA.fromHex('#ffffff'));
  }
}

// Usage
const progressBar = new ProgressBar('progress', {
  width: 30,
  progress: 75
});

// Update progress
progressBar.progress = 80;
```