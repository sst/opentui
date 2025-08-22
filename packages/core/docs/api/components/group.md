# GroupRenderable

A container component for organizing child components with flexbox layout support.

## Class: `GroupRenderable`

```typescript
import { GroupRenderable } from '@opentui/core'

const group = new GroupRenderable('my-group', {
  flexDirection: 'row',
  gap: 2,
  padding: 1
})
```

## Constructor

### `new GroupRenderable(id: string, options: RenderableOptions)`

## Options

### `GroupRenderable Options`

Uses standard [`RenderableOptions`](../renderable.md#renderableoptions). GroupRenderable is specifically designed for layout management.

## Key Features

GroupRenderable is a pure layout container that:
- Renders no visual content itself
- Manages child component positioning using Yoga flexbox
- Provides layout control through flexbox properties
- Supports nested layouts for complex UIs

## Layout Properties

All flexbox properties from [`Renderable`](../renderable.md) are particularly useful:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `flexDirection` | `'row' \| 'column' \| 'row-reverse' \| 'column-reverse'` | `'column'` | Main axis direction |
| `justifyContent` | `'flex-start' \| 'flex-end' \| 'center' \| 'space-between' \| 'space-around' \| 'space-evenly'` | `'flex-start'` | Main axis alignment |
| `alignItems` | `'flex-start' \| 'flex-end' \| 'center' \| 'baseline' \| 'stretch'` | `'stretch'` | Cross axis alignment |
| `flexWrap` | `'nowrap' \| 'wrap' \| 'wrap-reverse'` | `'nowrap'` | Wrap behavior |
| `gap` | `number` | `0` | Space between items |
| `padding` | `number \| string` | `0` | Inner spacing |
| `margin` | `number \| string` | `0` | Outer spacing |

## Examples

### Horizontal Layout

```typescript
const row = new GroupRenderable('row', {
  flexDirection: 'row',
  justifyContent: 'space-between',
  width: '100%',
  height: 3
})

const left = new TextRenderable('left', { content: 'Left' })
const center = new TextRenderable('center', { content: 'Center' })
const right = new TextRenderable('right', { content: 'Right' })

row.appendChild(left)
row.appendChild(center)
row.appendChild(right)
```

### Vertical Layout

```typescript
const column = new GroupRenderable('column', {
  flexDirection: 'column',
  alignItems: 'center',
  width: '100%',
  height: '100%',
  padding: 2
})

const header = new TextRenderable('header', {
  content: 'Header',
  marginBottom: 1
})

const content = new BoxRenderable('content', {
  width: '80%',
  flexGrow: 1,
  borderStyle: 'single'
})

const footer = new TextRenderable('footer', {
  content: 'Footer',
  marginTop: 1
})

column.appendChild(header)
column.appendChild(content)
column.appendChild(footer)
```

### Grid Layout

```typescript
const grid = new GroupRenderable('grid', {
  flexDirection: 'row',
  flexWrap: 'wrap',
  width: '100%',
  gap: 1
})

for (let i = 0; i < 9; i++) {
  const cell = new BoxRenderable(`cell-${i}`, {
    width: '33%',
    height: 5,
    borderStyle: 'single',
    backgroundColor: '#333333'
  })
  grid.appendChild(cell)
}
```

### Nested Groups

```typescript
const app = new GroupRenderable('app', {
  flexDirection: 'column',
  width: '100%',
  height: '100%'
})

const header = new GroupRenderable('header', {
  flexDirection: 'row',
  justifyContent: 'space-between',
  padding: 1,
  height: 3
})

const body = new GroupRenderable('body', {
  flexDirection: 'row',
  flexGrow: 1
})

const sidebar = new GroupRenderable('sidebar', {
  flexDirection: 'column',
  width: 20,
  padding: 1
})

const main = new GroupRenderable('main', {
  flexDirection: 'column',
  flexGrow: 1,
  padding: 2
})

body.appendChild(sidebar)
body.appendChild(main)
app.appendChild(header)
app.appendChild(body)
```

### Centered Content

```typescript
const centerContainer = new GroupRenderable('center', {
  width: '100%',
  height: '100%',
  justifyContent: 'center',
  alignItems: 'center'
})

const dialog = new BoxRenderable('dialog', {
  width: 40,
  height: 10,
  borderStyle: 'double',
  padding: 2
})

centerContainer.appendChild(dialog)
```

### List Layout

```typescript
const list = new GroupRenderable('list', {
  flexDirection: 'column',
  width: '100%',
  gap: 1,
  padding: 1
})

const items = ['Item 1', 'Item 2', 'Item 3', 'Item 4']

items.forEach((text, index) => {
  const item = new GroupRenderable(`item-${index}`, {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 1
  })
  
  const bullet = new TextRenderable(`bullet-${index}`, {
    content: '• ',
    marginRight: 1
  })
  
  const label = new TextRenderable(`label-${index}`, {
    content: text
  })
  
  item.appendChild(bullet)
  item.appendChild(label)
  list.appendChild(item)
})
```

### Responsive Layout

```typescript
const responsive = new GroupRenderable('responsive', {
  flexDirection: 'row',
  width: '100%',
  height: '100%'
})

const leftPanel = new BoxRenderable('left', {
  minWidth: 20,
  maxWidth: 40,
  width: '25%',
  height: '100%',
  borderStyle: 'single'
})

const mainPanel = new BoxRenderable('main', {
  flexGrow: 1,
  height: '100%',
  borderStyle: 'single'
})

const rightPanel = new BoxRenderable('right', {
  width: '20%',
  minWidth: 15,
  height: '100%',
  borderStyle: 'single'
})

responsive.appendChild(leftPanel)
responsive.appendChild(mainPanel)
responsive.appendChild(rightPanel)
```

### Form Layout

```typescript
const form = new GroupRenderable('form', {
  flexDirection: 'column',
  width: 50,
  padding: 2,
  gap: 2
})

// Form fields
const fields = [
  { label: 'Name:', id: 'name' },
  { label: 'Email:', id: 'email' },
  { label: 'Message:', id: 'message' }
]

fields.forEach(field => {
  const row = new GroupRenderable(`${field.id}-row`, {
    flexDirection: 'row',
    alignItems: 'center'
  })
  
  const label = new TextRenderable(`${field.id}-label`, {
    content: field.label,
    width: 10
  })
  
  const input = new InputRenderable(`${field.id}-input`, {
    flexGrow: 1,
    placeholder: `Enter ${field.id}...`
  })
  
  row.appendChild(label)
  row.appendChild(input)
  form.appendChild(row)
})

// Submit button
const buttonRow = new GroupRenderable('button-row', {
  flexDirection: 'row',
  justifyContent: 'flex-end',
  marginTop: 1
})

const submitBtn = new BoxRenderable('submit', {
  width: 15,
  height: 3,
  borderStyle: 'rounded',
  backgroundColor: '#0066cc'
})

buttonRow.appendChild(submitBtn)
form.appendChild(buttonRow)
```

## Best Practices

1. **Use for Layout Only**: GroupRenderable should be used purely for layout organization, not for visual styling.

2. **Combine with BoxRenderable**: For containers that need borders or backgrounds, use BoxRenderable instead.

3. **Leverage Flexbox**: Take advantage of flexbox properties for responsive layouts.

4. **Nest Groups**: Create complex layouts by nesting multiple GroupRenderables.

5. **Performance**: Groups have minimal overhead as they don't render any visual content themselves.

## Common Patterns

### Toolbar
```typescript
const toolbar = new GroupRenderable('toolbar', {
  flexDirection: 'row',
  justifyContent: 'space-between',
  padding: 1,
  height: 3
})
```

### Sidebar Layout
```typescript
const layout = new GroupRenderable('layout', {
  flexDirection: 'row',
  width: '100%',
  height: '100%'
})

const sidebar = new GroupRenderable('sidebar', {
  width: 25,
  flexDirection: 'column'
})

const content = new GroupRenderable('content', {
  flexGrow: 1,
  flexDirection: 'column'
})
```

### Card Grid
```typescript
const cardGrid = new GroupRenderable('cards', {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 2,
  padding: 2
})
```