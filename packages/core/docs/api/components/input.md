# InputRenderable

Text input component with support for placeholders, validation, and keyboard navigation.

## Class: `InputRenderable`

```typescript
import { InputRenderable } from '@opentui/core'

const input = new InputRenderable('my-input', {
  placeholder: 'Enter your name...',
  width: 30,
  value: ''
})
```

## Constructor

### `new InputRenderable(id: string, options: InputRenderableOptions)`

## Options

### `InputRenderableOptions`

Extends [`RenderableOptions`](../renderable.md#renderableoptions) with:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `value` | `string` | `''` | Initial input value |
| `placeholder` | `string` | `''` | Placeholder text when empty |
| `textColor` | `string \| RGBA` | `'#FFFFFF'` | Text color |
| `backgroundColor` | `string \| RGBA` | `'transparent'` | Background color |
| `placeholderColor` | `string \| RGBA` | `'#666666'` | Placeholder text color |
| `cursorColor` | `string \| RGBA` | `'#FFFFFF'` | Cursor color |
| `focusedBackgroundColor` | `string \| RGBA` | `'#1a1a1a'` | Background when focused |
| `focusedTextColor` | `string \| RGBA` | `'#FFFFFF'` | Text color when focused |
| `maxLength` | `number` | `1000` | Maximum character length |

## Properties

### Value Properties

| Property | Type | Description |
|----------|------|-------------|
| `value` | `string` | Get/set input value |
| `placeholder` | `string` | Set placeholder text |
| `cursorPosition` | `number` | Set cursor position |
| `maxLength` | `number` | Set maximum character limit |

### Style Properties

| Property | Type | Description |
|----------|------|-------------|
| `textColor` | `ColorInput` | Set text color |
| `backgroundColor` | `ColorInput` | Set background color |
| `placeholderColor` | `ColorInput` | Set placeholder color |
| `cursorColor` | `ColorInput` | Set cursor color |
| `focusedBackgroundColor` | `ColorInput` | Set focused background color |
| `focusedTextColor` | `ColorInput` | Set focused text color |

## Methods

All methods from [`Renderable`](../renderable.md) plus:

### `handleKeyPress(key: ParsedKey | string): boolean`
Handle keyboard input (called internally by the renderer).

### `focus(): void`
Focus the input and show cursor.

```typescript
input.focus()
```

### `blur(): void`
Remove focus and hide cursor. Emits `change` event if value changed.

```typescript
input.blur()
```

## Events

InputRenderable emits the following events:

| Event | Data | Description |
|-------|------|-------------|
| `input` | `value: string` | Value changed during typing |
| `change` | `value: string` | Value committed (on blur or enter) |
| `enter` | `value: string` | Enter key pressed |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Left Arrow` | Move cursor left |
| `Right Arrow` | Move cursor right |
| `Home` | Move to start |
| `End` | Move to end |
| `Backspace` | Delete before cursor |
| `Delete` | Delete at cursor |
| `Enter` | Submit value and emit events |
| Any printable character | Insert at cursor position |

## Examples

### Basic Input

```typescript
const nameInput = new InputRenderable('name', {
  placeholder: 'Enter name...',
  width: 30
})

nameInput.on('submit', (value) => {
  console.log('Name entered:', value)
})
```

### Password Input

```typescript
const passwordInput = new Input('password', {
  placeholder: 'Enter password...',
  password: true,
  width: 30
})

passwordInput.on('submit', (value) => {
  console.log('Password length:', value.length)
})
```

### Input with Validation

```typescript
const emailInput = new Input('email', {
  placeholder: 'user@example.com',
  width: 40
})

emailInput.on('change', (value) => {
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  emailInput.fg = isValid ? '#00ff00' : '#ff0000'
})
```

### Multi-line Input

```typescript
const textArea = new Input('textarea', {
  multiline: true,
  width: 50,
  height: 10,
  placeholder: 'Enter your message...'
})

textArea.on('change', (value) => {
  const lines = value.split('\n').length
  console.log(`Lines: ${lines}`)
})
```

### Input with Max Length

```typescript
const limitedInput = new Input('limited', {
  placeholder: 'Max 10 characters',
  maxLength: 10,
  width: 30
})

limitedInput.on('change', (value) => {
  const remaining = 10 - value.length
  console.log(`${remaining} characters remaining`)
})
```

### Styled Input

```typescript
const styledInput = new Input('styled', {
  placeholder: 'Styled input',
  width: 30,
  fg: '#00ff00',
  bg: '#1a1a1a',
  placeholderFg: '#666666',
  cursorBg: '#00ff00',
  focusedBg: '#2a2a2a'
})
```

### Form with Multiple Inputs

```typescript
const form = new GroupRenderable('form', {
  flexDirection: 'column',
  padding: 2
})

const usernameInput = new Input('username', {
  placeholder: 'Username',
  width: '100%',
  marginBottom: 1
})

const passwordInput = new Input('password', {
  placeholder: 'Password',
  password: true,
  width: '100%',
  marginBottom: 1
})

const submitButton = new BoxRenderable('submit', {
  width: '100%',
  height: 3,
  borderStyle: 'rounded',
  backgroundColor: '#0066cc'
})

form.appendChild(usernameInput)
form.appendChild(passwordInput)
form.appendChild(submitButton)

// Handle form submission
passwordInput.on('submit', () => {
  const username = usernameInput.value
  const password = passwordInput.value
  console.log('Login:', { username, password })
})
```

### Read-only Input

```typescript
const readOnlyInput = new Input('readonly', {
  value: 'This cannot be edited',
  editable: false,
  width: 30,
  fg: '#999999'
})
```

### Dynamic Placeholder

```typescript
const searchInput = new Input('search', {
  placeholder: 'Search...',
  width: 40
})

// Update placeholder based on context
function setSearchContext(context: string) {
  searchInput.placeholder = `Search ${context}...`
}

setSearchContext('users')  // "Search users..."
setSearchContext('files')  // "Search files..."
```

## Focus Management

Input components can receive keyboard focus:

```typescript
const input = new Input('input', {
  width: 30
})

// Request focus
input.focus()

// Check if focused
if (input.focused) {
  console.log('Input has focus')
}

// Remove focus
input.blur()

// Focus events
input.on('focus', () => {
  console.log('Input focused')
})

input.on('blur', () => {
  console.log('Input blurred')
})
```