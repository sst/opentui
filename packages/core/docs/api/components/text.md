# TextRenderable

Component for displaying styled text with support for colors, attributes, and text selection.

## Class: `TextRenderable`

```typescript
import { TextRenderable } from '@opentui/core'

const text = new TextRenderable('my-text', {
  content: 'Hello, World!',
  fg: '#00ff00',
  bg: '#1a1a1a'
})
```

## Constructor

### `new TextRenderable(id: string, options: TextOptions)`

## Options

### `TextOptions`

Extends [`RenderableOptions`](../renderable.md#renderableoptions) with:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `content` | `StyledText \| string` | `''` | Text content to display |
| `fg` | `string \| RGBA` | `'#ffffff'` | Default foreground color |
| `bg` | `string \| RGBA` | `'transparent'` | Default background color |
| `selectionBg` | `string \| RGBA` | - | Selection background color |
| `selectionFg` | `string \| RGBA` | - | Selection foreground color |
| `selectable` | `boolean` | `true` | Enable text selection |
| `attributes` | `number` | `0` | Text attributes (bold, italic, etc.) |

## Properties

### Content Properties

| Property | Type | Description |
|----------|------|-------------|
| `content` | `StyledText \| string` | Get/set text content |
| `fg` | `RGBA` | Get/set foreground color |
| `bg` | `RGBA` | Get/set background color |
| `selectable` | `boolean` | Enable/disable selection |
| `plainText` | `string` | Plain text without styling (read-only) |

## StyledText Format

StyledText allows rich text formatting with colors and attributes:

```typescript
import { stringToStyledText, StyledText } from '@opentui/core'

// Simple string
const simple = stringToStyledText('Plain text')

// With inline styles
const styled: StyledText = {
  type: 'styled',
  children: [
    { text: 'Normal ' },
    { text: 'Bold', bold: true },
    { text: ' and ', italic: true },
    { text: 'Colored', fg: '#00ff00', bg: '#0000ff' }
  ]
}
```

### Text Attributes

Available text attributes (can be combined):

```typescript
interface TextStyle {
  text: string
  fg?: string | RGBA        // Foreground color
  bg?: string | RGBA        // Background color
  bold?: boolean            // Bold text
  italic?: boolean          // Italic text
  underline?: boolean       // Underlined text
  strikethrough?: boolean   // Strikethrough text
  dim?: boolean            // Dimmed text
  inverse?: boolean        // Inverted colors
  blink?: boolean          // Blinking text (terminal support varies)
}
```

## Methods

All methods from [`Renderable`](../renderable.md) plus:

### `getSelectedText(): string`
Get currently selected text.

```typescript
const selected = text.getSelectedText()
```

### `hasSelection(): boolean`
Check if any text is currently selected.

```typescript
if (text.hasSelection()) {
  const selected = text.getSelectedText()
}
```

### `shouldStartSelection(x: number, y: number): boolean`
Check if selection should start at given coordinates (used internally).

### `onSelectionChanged(selection: SelectionState | null): boolean`
Handle selection state changes (used internally by the selection system).

## Text Selection

TextRenderable supports text selection when `selectable` is true:

```typescript
const text = new TextRenderable('text', {
  content: 'Selectable text content',
  selectable: true,
  selectionBg: '#0066cc',
  selectionFg: '#ffffff'
})

// Selection is handled automatically with mouse
// The renderer manages selection state globally
renderer.on('mouse', (event) => {
  // Selection is handled internally by the renderer
})

// Check if text has selection
if (text.hasSelection()) {
  const selected = text.getSelectedText()
  console.log('Selected text:', selected)
}
```

## Examples

### Basic Text

```typescript
const label = new TextRenderable('label', {
  content: 'Username:',
  fg: '#ffffff'
})
```

### Styled Text

```typescript
const styled = new TextRenderable('styled', {
  content: {
    type: 'styled',
    children: [
      { text: 'Status: ' },
      { text: 'Online', fg: '#00ff00', bold: true }
    ]
  }
})
```

### Multi-line Text

```typescript
const paragraph = new TextRenderable('paragraph', {
  content: `This is a paragraph of text
that spans multiple lines
and wraps automatically`,
  width: 40,
  fg: '#cccccc'
})
```

### Dynamic Updates

```typescript
const counter = new TextRenderable('counter', {
  content: 'Count: 0',
  fg: '#ffff00'
})

let count = 0
setInterval(() => {
  count++
  counter.content = `Count: ${count}`
}, 1000)
```

### Error Messages

```typescript
const error = new TextRenderable('error', {
  content: {
    type: 'styled',
    children: [
      { text: '✗ ', fg: '#ff0000', bold: true },
      { text: 'Error: ', fg: '#ff6666', bold: true },
      { text: 'File not found', fg: '#ffcccc' }
    ]
  },
  bg: '#330000'
})
```

### Code Display

```typescript
const code = new TextRenderable('code', {
  content: {
    type: 'styled',
    children: [
      { text: 'function ', fg: '#ff79c6' },
      { text: 'hello', fg: '#50fa7b' },
      { text: '() {\n' },
      { text: '  return ', fg: '#ff79c6' },
      { text: '"Hello, World!"', fg: '#f1fa8c' },
      { text: '\n}' }
    ]
  },
  bg: '#282a36',
  padding: 1
})
```

### Status Indicators

```typescript
function createStatusText(status: 'idle' | 'loading' | 'success' | 'error') {
  const indicators = {
    idle: { symbol: '○', color: '#666666' },
    loading: { symbol: '◔', color: '#ffff00' },
    success: { symbol: '●', color: '#00ff00' },
    error: { symbol: '✗', color: '#ff0000' }
  }
  
  const { symbol, color } = indicators[status]
  
  return new TextRenderable('status', {
    content: {
      type: 'styled',
      children: [
        { text: symbol + ' ', fg: color },
        { text: status.toUpperCase(), fg: color, bold: true }
      ]
    }
  })
}
```

### Selectable List

```typescript
const items = ['Option 1', 'Option 2', 'Option 3']
const list = new GroupRenderable('list', {
  flexDirection: 'column'
})

items.forEach((item, index) => {
  const text = new TextRenderable(`item-${index}`, {
    content: item,
    selectable: true,
    selectionBg: '#0066cc',
    padding: 1
  })
  
  text.on('click', () => {
    console.log(`Selected: ${item}`)
  })
  
  list.appendChild(text)
})
```

## Text Wrapping

Text automatically wraps based on the component width:

```typescript
const wrapped = new TextRenderable('wrapped', {
  content: 'This is a long line of text that will automatically wrap when it exceeds the width of the component',
  width: 30,
  fg: '#ffffff'
})
```

## Performance Considerations

- Text rendering is optimized with internal text buffers
- Styled text segments are cached for efficient rendering
- Large text content is handled efficiently with viewport clipping
- Updates only trigger re-renders when content actually changes