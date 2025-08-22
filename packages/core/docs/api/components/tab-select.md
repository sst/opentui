# TabSelectRenderable

A horizontal tab-style selection component with optional descriptions, similar to a menu bar or tab navigation.

## Class: `TabSelectRenderable`

```typescript
import { TabSelectRenderable } from '@opentui/core'

const tabSelect = new TabSelectRenderable('tabs', {
  options: [
    { name: 'General', description: 'General settings' },
    { name: 'Advanced', description: 'Advanced configuration' },
    { name: 'Security', description: 'Security options' }
  ],
  tabWidth: 20,
  showDescription: true
})
```

## Constructor

### `new TabSelectRenderable(id: string, options: TabSelectRenderableOptions)`

## Options

### `TabSelectRenderableOptions`

Extends [`RenderableOptions`](../renderable.md#renderableoptions) (excluding `height` which is auto-calculated) with:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `options` | `TabSelectOption[]` | `[]` | Tab options array |
| `tabWidth` | `number` | `20` | Width of each tab |
| `backgroundColor` | `ColorInput` | `'transparent'` | Background color |
| `textColor` | `ColorInput` | `'#FFFFFF'` | Text color |
| `focusedBackgroundColor` | `ColorInput` | `'#1a1a1a'` | Focused background |
| `focusedTextColor` | `ColorInput` | `'#FFFFFF'` | Focused text color |
| `selectedBackgroundColor` | `ColorInput` | `'#334455'` | Selected tab background |
| `selectedTextColor` | `ColorInput` | `'#FFFF00'` | Selected tab text color |
| `selectedDescriptionColor` | `ColorInput` | `'#CCCCCC'` | Selected description color |
| `showScrollArrows` | `boolean` | `true` | Show scroll indicators |
| `showDescription` | `boolean` | `true` | Show description line |
| `showUnderline` | `boolean` | `true` | Show underline separator |
| `wrapSelection` | `boolean` | `false` | Wrap at boundaries |

### `TabSelectOption`

```typescript
interface TabSelectOption {
  name: string        // Tab title
  description: string // Tab description
  value?: any        // Optional associated value
}
```

## Properties

### Selection Properties

| Property | Type | Description |
|----------|------|-------------|
| `options` | `TabSelectOption[]` | Tab options |
| `selectedIndex` | `number` | Currently selected index |
| `selectedOption` | `TabSelectOption \| undefined` | Currently selected option |
| `maxVisibleTabs` | `number` | Maximum visible tabs based on width |

## Methods

All methods from [`Renderable`](../renderable.md) plus:

### `setOptions(options: TabSelectOption[]): void`
Update the tab options.

```typescript
tabSelect.setOptions([
  { name: 'File', description: 'File operations' },
  { name: 'Edit', description: 'Edit operations' }
])
```

### `setSelectedIndex(index: number): void`
Select a tab by index.

```typescript
tabSelect.setSelectedIndex(1)
```

### `getSelectedOption(): TabSelectOption | undefined`
Get the currently selected option.

```typescript
const selected = tabSelect.getSelectedOption()
console.log(selected?.name, selected?.description)
```

### `handleKeyPress(key: ParsedKey): boolean`
Handle keyboard input (called internally).

## Events

TabSelectRenderable emits the following events:

| Event | Data | Description |
|-------|------|-------------|
| `selectionChanged` | `TabSelectOption` | Selection changed |
| `itemSelected` | `TabSelectOption` | Item selected (Enter key) |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Left Arrow` | Select previous tab |
| `Right Arrow` | Select next tab |
| `Home` | Select first tab |
| `End` | Select last tab |
| `Enter` | Confirm selection |

## Display Behavior

The component height is automatically calculated based on options:
- Base height: 1 line for tab names
- +1 line if `showUnderline` is true
- +1 line if `showDescription` is true

The component displays tabs horizontally with:
- Fixed width tabs (controlled by `tabWidth`)
- Automatic scrolling when tabs exceed visible width
- Optional scroll arrows to indicate more tabs
- Selected tab highlighting

## Examples

### Basic Tab Selection

```typescript
const tabSelect = new TabSelectRenderable('tabs', {
  options: [
    { name: 'Home', description: 'Go to home screen' },
    { name: 'Settings', description: 'Configure application' },
    { name: 'About', description: 'About this app' }
  ],
  width: 60,
  tabWidth: 20
})

tabSelect.on('selectionChanged', (option) => {
  console.log(`Selected: ${option.name} - ${option.description}`)
})

tabSelect.on('itemSelected', (option) => {
  console.log(`Confirmed selection: ${option.name}`)
  // Navigate to the selected section
})
```

### Styled Tab Selection

```typescript
const styledTabs = new TabSelectRenderable('styled', {
  options: [
    { name: 'Tab 1', description: 'First tab' },
    { name: 'Tab 2', description: 'Second tab' },
    { name: 'Tab 3', description: 'Third tab' }
  ],
  width: 70,
  tabWidth: 23,
  backgroundColor: '#1a1a1a',
  textColor: '#999999',
  selectedBackgroundColor: '#0066cc',
  selectedTextColor: '#ffffff',
  selectedDescriptionColor: '#aaaaff',
  showDescription: true,
  showUnderline: true
})
```

### Menu Bar Example

```typescript
const menuBar = new TabSelectRenderable('menu', {
  options: [
    { name: 'File', description: 'File operations', value: 'file' },
    { name: 'Edit', description: 'Edit operations', value: 'edit' },
    { name: 'View', description: 'View options', value: 'view' },
    { name: 'Help', description: 'Get help', value: 'help' }
  ],
  width: '100%',
  tabWidth: 15,
  showDescription: false,  // Hide descriptions for menu bar
  showUnderline: true,
  backgroundColor: '#2a2a2a',
  selectedBackgroundColor: '#0066cc'
})

menuBar.on('itemSelected', (option) => {
  switch (option.value) {
    case 'file':
      openFileMenu()
      break
    case 'edit':
      openEditMenu()
      break
    case 'view':
      toggleViewOptions()
      break
    case 'help':
      showHelp()
      break
  }
})
```

### Navigation Tabs

```typescript
const navigationTabs = new TabSelectRenderable('nav', {
  options: [
    { name: 'General', description: 'General settings' },
    { name: 'Appearance', description: 'Theme and colors' },
    { name: 'Keyboard', description: 'Shortcuts' },
    { name: 'Advanced', description: 'Advanced options' }
  ],
  width: 80,
  tabWidth: 20,
  selectedBackgroundColor: '#003366',
  selectedTextColor: '#ffff00'
})

// Use with a content area that changes based on selection
const contentArea = new GroupRenderable('content', {
  flexDirection: 'column',
  padding: 2
})

navigationTabs.on('selectionChanged', (option) => {
  // Clear and update content area
  contentArea.removeAllChildren()
  
  const title = new TextRenderable('title', {
    content: option.name,
    fg: '#00ff00',
    marginBottom: 1
  })
  
  const description = new TextRenderable('desc', {
    content: option.description,
    fg: '#cccccc'
  })
  
  contentArea.appendChild(title)
  contentArea.appendChild(description)
})
```

### Tool Selection

```typescript
const toolSelect = new TabSelectRenderable('tools', {
  options: [
    { name: '🔨 Build', description: 'Build project', value: 'build' },
    { name: '🐛 Debug', description: 'Start debugger', value: 'debug' },
    { name: '✅ Test', description: 'Run tests', value: 'test' },
    { name: '📦 Package', description: 'Create package', value: 'package' }
  ],
  width: 80,
  tabWidth: 20,
  showDescription: true,
  focusedBackgroundColor: '#1a1a1a',
  selectedBackgroundColor: '#00aa00',
  selectedTextColor: '#000000'
})

toolSelect.on('itemSelected', async (option) => {
  const statusText = new TextRenderable('status', {
    content: `Running ${option.name}...`,
    fg: '#ffff00'
  })
  
  switch (option.value) {
    case 'build':
      await runBuild()
      break
    case 'debug':
      await startDebugger()
      break
    case 'test':
      await runTests()
      break
    case 'package':
      await createPackage()
      break
  }
}) {
  private openFiles: Map<string, string> = new Map()

  openFile(filename: string, content: string) {
    // Check if already open
    const existingIndex = this.tabs.indexOf(filename)
    if (existingIndex >= 0) {
      this.selectTab(existingIndex)
      return
    }

    // Create editor for file
    const editor = new InputRenderable(`editor-${filename}`, {
      value: content,
      multiline: true,
      width: '100%',
      height: '100%'
    })

    editor.on('change', (value) => {
      this.openFiles.set(filename, value)
      this.markAsModified(filename)
    })

    this.addTab(filename, editor)
    this.openFiles.set(filename, content)
  }

  markAsModified(filename: string) {
    const index = this.tabs.indexOf(filename)
    if (index >= 0 && !this.tabs[index].endsWith('*')) {
      this.tabs[index] = filename + ' *'
    }
  }

  saveFile(index: number) {
    const filename = this.tabs[index].replace(' *', '')
    const content = this.openFiles.get(filename)
    // Save logic here
    this.tabs[index] = filename // Remove asterisk
  }
}
```

### Compact Navigation

```typescript
const compactNav = new TabSelectRenderable('compact', {
  tabs: [],
  width: '100%',
  height: '100%',
  tabWidth: 20, // Fixed width tabs
  tabBarHeight: 4
})

function createWebView(url: string): Renderable {
  const view = new GroupRenderable('view', {
    flexDirection: 'column',
    padding: 1
  })

  const urlBar = new TextRenderable('url', {
    content: `🌐 ${url}`,
    fg: '#666666',
    marginBottom: 1
  })

  const content = new TextRenderable('content', {
    content: `Loading ${url}...`,
    fg: '#ffffff'
  })

  view.appendChild(urlBar)
  view.appendChild(content)
  
  return view
}

// Add new tab function
function newTab(url: string = 'about:blank') {
  const title = url.length > 15 ? url.substring(0, 12) + '...' : url
  const content = createWebView(url)
  browserTabs.addTab(title, content)
}

// Initial tab
newTab('https://example.com')
```

### Wizard Interface

```typescript
const wizard = new TabSelect('wizard', {
  tabs: ['Step 1: Setup', 'Step 2: Configure', 'Step 3: Confirm'],
  width: 60,
  height: 25,
  selectedIndex: 0
})

// Disable manual tab switching
wizard.handleKeyPress = (key) => {
  // Only allow programmatic navigation
  return false
}

// Navigation buttons
const nextButton = new BoxRenderable('next', {
  content: 'Next →',
  width: 10,
  height: 3
})

const prevButton = new BoxRenderable('prev', {
  content: '← Previous',
  width: 10,
  height: 3
})

nextButton.on('click', () => {
  if (wizard.selectedIndex < wizard.tabs.length - 1) {
    wizard.selectTab(wizard.selectedIndex + 1)
  }
})

prevButton.on('click', () => {
  if (wizard.selectedIndex > 0) {
    wizard.selectTab(wizard.selectedIndex - 1)
  }
})
```

## Styling

### Tab Bar Customization

```typescript
const customTabs = new TabSelect('custom', {
  tabs: ['Tab 1', 'Tab 2'],
  tabBarHeight: 4,
  tabWidth: 15,
  tabBarBg: '#0a0a0a',
  borderStyle: 'double'
})
```

### Content Area Styling

```typescript
// Access content area directly
tabs.contentArea.backgroundColor = '#1a1a1a'
tabs.contentArea.padding = 2
```

## Best Practices

1. **Limit tab count**: Too many tabs can be hard to navigate
2. **Use clear titles**: Keep tab titles short and descriptive
3. **Lazy loading**: Load tab content only when selected for performance
4. **Keyboard shortcuts**: Implement number keys for quick tab access
5. **Visual feedback**: Use distinct colors for active/inactive tabs
6. **Content caching**: Cache expensive content instead of recreating