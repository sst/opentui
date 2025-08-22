# Select

A selection list component for choosing from multiple options with keyboard navigation.

## Class: `Select`

```typescript
import { Select } from '@opentui/core'

const select = new Select('my-select', {
  options: ['Option 1', 'Option 2', 'Option 3'],
  width: 30,
  height: 10
})
```

## Constructor

### `new Select(id: string, options: SelectOptions)`

## Options

### `SelectOptions`

Extends [`RenderableOptions`](../renderable.md#renderableoptions) with:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `options` | `string[]` | `[]` | List of selectable options |
| `selectedIndex` | `number` | `0` | Initially selected index |
| `fg` | `ColorInput` | `'#ffffff'` | Text color |
| `bg` | `ColorInput` | `'transparent'` | Background color |
| `selectedFg` | `ColorInput` | `'#000000'` | Selected item text color |
| `selectedBg` | `ColorInput` | `'#00aaff'` | Selected item background |
| `focusedSelectedFg` | `ColorInput` | - | Focused selected text color |
| `focusedSelectedBg` | `ColorInput` | - | Focused selected background |
| `scrollbar` | `boolean` | `true` | Show scrollbar indicator |
| `wrap` | `boolean` | `false` | Wrap selection at boundaries |

## Properties

### Selection Properties

| Property | Type | Description |
|----------|------|-------------|
| `options` | `string[]` | Get/set option list |
| `selectedIndex` | `number` | Get/set selected index |
| `selectedOption` | `string \| undefined` | Get selected option text |
| `length` | `number` | Number of options |

### Display Properties

| Property | Type | Description |
|----------|------|-------------|
| `scrollOffset` | `number` | Current scroll position |
| `visibleItems` | `number` | Number of visible items |

## Methods

All methods from [`Renderable`](../renderable.md) plus:

### `setOptions(options: string[]): void`
Update the option list.

```typescript
select.setOptions(['New 1', 'New 2', 'New 3'])
```

### `selectNext(): void`
Select the next option.

```typescript
select.selectNext()
```

### `selectPrevious(): void`
Select the previous option.

```typescript
select.selectPrevious()
```

### `selectFirst(): void`
Select the first option.

```typescript
select.selectFirst()
```

### `selectLast(): void`
Select the last option.

```typescript
select.selectLast()
```

### `selectIndex(index: number): void`
Select option by index.

```typescript
select.selectIndex(2)
```

### `getSelectedOption(): string | undefined`
Get the currently selected option text.

```typescript
const selected = select.getSelectedOption()
```

### `scrollToSelected(): void`
Scroll to make selected item visible.

```typescript
select.scrollToSelected()
```

## Events

Select emits the following events:

| Event | Data | Description |
|-------|------|-------------|
| `change` | `{index: number, value: string}` | Selection changed |
| `select` | `{index: number, value: string}` | Item selected (Enter key) |
| `scroll` | `offset: number` | List scrolled |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Up Arrow` / `k` | Select previous item |
| `Down Arrow` / `j` | Select next item |
| `Home` / `g` | Select first item |
| `End` / `G` | Select last item |
| `Page Up` | Scroll up one page |
| `Page Down` | Scroll down one page |
| `Enter` / `Space` | Confirm selection |

## Examples

### Basic Select

```typescript
const select = new Select('select', {
  options: ['Apple', 'Banana', 'Cherry', 'Date'],
  width: 20,
  height: 5
})

select.on('select', ({ value }) => {
  console.log('Selected:', value)
})
```

### Styled Select

```typescript
const styledSelect = new Select('styled', {
  options: ['Red', 'Green', 'Blue', 'Yellow'],
  width: 25,
  height: 6,
  fg: '#cccccc',
  bg: '#1a1a1a',
  selectedFg: '#ffffff',
  selectedBg: '#0066cc',
  focusedSelectedBg: '#0088ff'
})
```

### Dynamic Options

```typescript
const dynamicSelect = new Select('dynamic', {
  options: [],
  width: 30,
  height: 10
})

// Load options asynchronously
async function loadOptions() {
  const response = await fetch('/api/options')
  const options = await response.json()
  dynamicSelect.setOptions(options)
}

loadOptions()
```

### Menu System

```typescript
const menu = new Select('menu', {
  options: [
    'New File',
    'Open File',
    'Save',
    'Save As...',
    '---',
    'Settings',
    'Exit'
  ],
  width: 20,
  height: 8
})

menu.on('select', ({ value }) => {
  switch (value) {
    case 'New File':
      createNewFile()
      break
    case 'Open File':
      openFileDialog()
      break
    case 'Exit':
      process.exit(0)
      break
  }
})
```

### File Browser

```typescript
const fileBrowser = new Select('files', {
  options: [],
  width: 40,
  height: 20,
  selectedBg: '#003366'
})

// Load directory contents
import { readdirSync } from 'fs'

function loadDirectory(path: string) {
  const entries = readdirSync(path, { withFileTypes: true })
  const options = entries.map(entry => {
    const prefix = entry.isDirectory() ? '📁 ' : '📄 '
    return prefix + entry.name
  })
  fileBrowser.setOptions(options)
}

loadDirectory('./')

fileBrowser.on('select', ({ value }) => {
  const name = value.substring(2) // Remove icon
  if (value.startsWith('📁')) {
    loadDirectory(`./${name}`)
  } else {
    openFile(name)
  }
})
```

### Multi-Column Select

```typescript
const table = new Select('table', {
  options: [
    'Name          Age   City',
    '─────────────────────────',
    'Alice         28    NYC',
    'Bob           32    LA',
    'Charlie       25    SF',
    'Diana         30    CHI'
  ],
  width: 30,
  height: 8,
  selectedBg: '#334455'
})

// Skip header rows when selecting
table.on('change', ({ index }) => {
  if (index <= 1) {
    table.selectIndex(2) // Skip to first data row
  }
})
```

### Filtered Select

```typescript
class FilteredSelect extends GroupRenderable {
  private input: InputRenderable
  private select: Select
  private allOptions: string[]

  constructor(id: string, options: string[]) {
    super(id, {
      flexDirection: 'column',
      width: 30,
      height: 15
    })

    this.allOptions = options

    this.input = new InputRenderable('filter', {
      placeholder: 'Filter...',
      width: '100%',
      marginBottom: 1
    })

    this.select = new Select('list', {
      options: options,
      width: '100%',
      flexGrow: 1
    })

    this.appendChild(this.input)
    this.appendChild(this.select)

    this.input.on('input', (value) => {
      this.filterOptions(value)
    })
  }

  private filterOptions(filter: string) {
    const filtered = this.allOptions.filter(opt =>
      opt.toLowerCase().includes(filter.toLowerCase())
    )
    this.select.setOptions(filtered)
  }
}
```

### Command Palette

```typescript
const commands = new Select('commands', {
  options: [
    '> Open File',
    '> Save File',
    '> Find in Files',
    '> Replace in Files',
    '> Toggle Terminal',
    '> Settings',
    '> Keyboard Shortcuts'
  ],
  width: 50,
  height: 10,
  selectedFg: '#000000',
  selectedBg: '#ffff00'
})

commands.on('select', ({ value }) => {
  const command = value.substring(2) // Remove "> "
  executeCommand(command)
})
```

### Paginated Select

```typescript
class PaginatedSelect extends Select {
  private pageSize = 10
  private currentPage = 0
  private allItems: string[] = []

  setItems(items: string[]) {
    this.allItems = items
    this.showPage(0)
  }

  showPage(page: number) {
    const start = page * this.pageSize
    const end = start + this.pageSize
    const pageItems = this.allItems.slice(start, end)
    
    if (pageItems.length > 0) {
      this.currentPage = page
      this.setOptions([
        `Page ${page + 1} of ${Math.ceil(this.allItems.length / this.pageSize)}`,
        '─────────────',
        ...pageItems
      ])
    }
  }

  nextPage() {
    const maxPage = Math.ceil(this.allItems.length / this.pageSize) - 1
    if (this.currentPage < maxPage) {
      this.showPage(this.currentPage + 1)
    }
  }

  previousPage() {
    if (this.currentPage > 0) {
      this.showPage(this.currentPage - 1)
    }
  }
}
```

## Styling

The Select component supports various styling options:

```typescript
const customSelect = new Select('custom', {
  options: ['Option 1', 'Option 2', 'Option 3'],
  width: 30,
  height: 10,
  
  // Normal state
  fg: '#aaaaaa',
  bg: '#111111',
  
  // Selected state
  selectedFg: '#ffffff',
  selectedBg: '#003366',
  
  // Focused + selected state
  focusedSelectedFg: '#ffff00',
  focusedSelectedBg: '#0066cc'
})
```

## Performance

For large lists:
- The component automatically handles scrolling and viewport rendering
- Only visible items are rendered for performance
- Consider implementing virtual scrolling for lists with thousands of items
- Use pagination or filtering for better UX with large datasets