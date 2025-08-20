# BoxRenderable

A container component with borders, background color, and optional title.

## Class: `BoxRenderable`

```typescript
import { BoxRenderable } from '@opentui/core'

const box = new BoxRenderable('my-box', {
  width: 40,
  height: 10,
  borderStyle: 'rounded',
  backgroundColor: '#1a1a1a',
  borderColor: '#00ff00'
})
```

## Constructor

### `new BoxRenderable(id: string, options: BoxOptions)`

## Options

### `BoxOptions`

Extends [`RenderableOptions`](../renderable.md#renderableoptions) with:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `backgroundColor` | `string \| RGBA` | `'transparent'` | Background color |
| `borderStyle` | `BorderStyle` | `'single'` | Border style preset |
| `border` | `boolean \| BorderSides[]` | `true` | Which borders to show |
| `borderColor` | `string \| RGBA` | `'#FFFFFF'` | Border color |
| `focusedBorderColor` | `string \| RGBA` | `'#00AAFF'` | Border color when focused |
| `customBorderChars` | `BorderCharacters` | - | Custom border characters |
| `shouldFill` | `boolean` | `true` | Fill background |
| `title` | `string` | - | Optional title text |
| `titleAlignment` | `'left' \| 'center' \| 'right'` | `'left'` | Title alignment |

### Border Styles

Available border style presets:

- `'single'` - Single line borders `┌─┐│└┘`
- `'double'` - Double line borders `╔═╗║╚╝`
- `'rounded'` - Rounded corners `╭─╮│╰╯`
- `'bold'` - Bold lines `┏━┓┃┗┛`
- `'dotted'` - Dotted lines (custom chars)
- `'dashed'` - Dashed lines (custom chars)

### Border Sides

Control which borders to display:

```typescript
type BorderSides = 'top' | 'right' | 'bottom' | 'left'

// Examples:
border: true                    // All borders
border: false                   // No borders
border: ['top', 'bottom']      // Only top and bottom
border: ['left']               // Only left border
```

### Custom Border Characters

Define custom border characters:

```typescript
interface BorderCharacters {
  topLeft: string
  top: string
  topRight: string
  right: string
  bottomRight: string
  bottom: string
  bottomLeft: string
  left: string
}

// Example:
customBorderChars: {
  topLeft: '╭',
  top: '─',
  topRight: '╮',
  right: '│',
  bottomRight: '╯',
  bottom: '─',
  bottomLeft: '╰',
  left: '│'
}
```

## Properties

### Styling Properties

| Property | Type | Description |
|----------|------|-------------|
| `backgroundColor` | `RGBA` | Get/set background color |
| `border` | `boolean \| BorderSides[]` | Get/set border configuration |
| `borderStyle` | `BorderStyle` | Get/set border style |
| `borderColor` | `RGBA` | Get/set border color |
| `focusedBorderColor` | `RGBA` | Get/set focused border color |
| `title` | `string \| undefined` | Get/set title text |
| `titleAlignment` | `'left' \| 'center' \| 'right'` | Get/set title alignment |
| `shouldFill` | `boolean` | Whether to fill background |

## Methods

BoxRenderable inherits all methods from [`Renderable`](../renderable.md). It doesn't add any additional public methods.

Properties like `borderStyle`, `title`, and `titleAlignment` can be set directly:

```typescript
box.borderStyle = 'double'
box.title = 'Settings'
box.titleAlignment = 'center'
```

## Examples

### Basic Box

```typescript
const box = new BoxRenderable('box', {
  width: 30,
  height: 10,
  borderStyle: 'single',
  backgroundColor: '#222222'
})
```

### Box with Title

```typescript
const dialog = new BoxRenderable('dialog', {
  width: 50,
  height: 15,
  borderStyle: 'double',
  title: 'Confirm Action',
  titleAlignment: 'center',
  backgroundColor: '#1a1a1a',
  borderColor: '#ffff00'
})
```

### Focused Box

```typescript
const input = new BoxRenderable('input-box', {
  width: 40,
  height: 3,
  borderStyle: 'rounded',
  borderColor: '#666666',
  focusedBorderColor: '#00ff00'
})

// Border color changes when focused
input.on('focused', () => {
  console.log('Box focused')
})
```

### Custom Borders

```typescript
const custom = new BoxRenderable('custom', {
  width: 25,
  height: 8,
  customBorderChars: {
    topLeft: '╔',
    top: '═',
    topRight: '╗',
    right: '║',
    bottomRight: '╝',
    bottom: '═',
    bottomLeft: '╚',
    left: '║'
  },
  borderColor: '#00ffff'
})
```

### Partial Borders

```typescript
const partial = new BoxRenderable('partial', {
  width: 30,
  height: 10,
  border: ['top', 'bottom'],
  borderStyle: 'bold',
  backgroundColor: '#333333'
})
```

### Nested Boxes

```typescript
const outer = new BoxRenderable('outer', {
  width: 60,
  height: 20,
  borderStyle: 'double',
  backgroundColor: '#111111',
  padding: 1
})

const inner = new BoxRenderable('inner', {
  width: '100%',
  height: '100%',
  borderStyle: 'single',
  backgroundColor: '#222222',
  margin: 2
})

outer.appendChild(inner)
```

### Dynamic Styling

```typescript
const status = new BoxRenderable('status', {
  width: 40,
  height: 5,
  borderStyle: 'rounded'
})

// Change appearance based on state
function setStatus(type: 'success' | 'warning' | 'error') {
  switch (type) {
    case 'success':
      status.backgroundColor = '#004400'
      status.borderColor = '#00ff00'
      break
    case 'warning':
      status.backgroundColor = '#444400'
      status.borderColor = '#ffff00'
      break
    case 'error':
      status.backgroundColor = '#440000'
      status.borderColor = '#ff0000'
      break
  }
}
```

## Layout Considerations

BoxRenderable automatically applies padding for borders:

- Single-line borders: 1 character padding on each side
- The padding is internal and doesn't affect the specified width/height
- Child components are positioned inside the border area

```typescript
const box = new BoxRenderable('box', {
  width: 20,
  height: 10,
  border: true
})

// Actual content area is 18x8 (20-2 for borders, 10-2 for borders)
const text = new TextRenderable('text', {
  content: 'Content inside'
})

box.appendChild(text)
// Text will be positioned inside the borders
```