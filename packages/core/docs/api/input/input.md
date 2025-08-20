# Input Handling API

OpenTUI provides a comprehensive input handling system for keyboard and mouse events, allowing you to create interactive terminal applications.

## Keyboard Input

### Key Events

The renderer emits key events that you can listen for:

```typescript
import { createCliRenderer } from '@opentui/core';

const renderer = await createCliRenderer();

// Listen for raw key events
renderer.on('key', (data) => {
  console.log('Key data:', data.toString());
});
```

### ParsedKey

The `ParsedKey` interface provides a structured representation of keyboard input:

```typescript
interface ParsedKey {
  sequence: string;      // Raw key sequence
  name: string;          // Key name (e.g., 'a', 'return', 'escape')
  ctrl: boolean;         // Whether Ctrl was pressed
  meta: boolean;         // Whether Meta/Alt was pressed
  shift: boolean;        // Whether Shift was pressed
  code?: string;         // Key code for special keys
}
```

### KeyHandler

The `KeyHandler` class provides a higher-level API for handling keyboard input:

```typescript
import { getKeyHandler, parseKeypress } from '@opentui/core';

// Get the global key handler
const keyHandler = getKeyHandler();

// Listen for keypress events
keyHandler.on('keypress', (key) => {
  console.log('Key pressed:', key.name);
  
  if (key.ctrl && key.name === 'c') {
    console.log('Ctrl+C pressed');
  }
});

// Parse a key sequence manually
const key = parseKeypress('\x1b[A'); // Up arrow key
console.log(key); // { name: 'up', sequence: '\x1b[A', ... }
```

### Key Names

Common key names you can check for:

| Category | Key Names |
|----------|-----------|
| Letters | `'a'` through `'z'` |
| Numbers | `'0'` through `'9'` |
| Special | `'space'`, `'backspace'`, `'tab'`, `'return'`, `'escape'` |
| Function | `'f1'` through `'f12'` |
| Navigation | `'up'`, `'down'`, `'left'`, `'right'`, `'home'`, `'end'`, `'pageup'`, `'pagedown'` |
| Editing | `'delete'`, `'insert'` |

### Example: Handling Keyboard Shortcuts

```typescript
import { getKeyHandler, Renderable } from '@opentui/core';

class KeyboardShortcutsComponent extends Renderable {
  constructor(id: string, options = {}) {
    super(id, options);
    this.focusable = true; // Enable focus to receive key events
  }
  
  handleKeyPress(key: ParsedKey): boolean {
    // Check for specific keys
    if (key.name === 'return') {
      console.log('Enter key pressed');
      return true;
    }
    
    // Check for key combinations
    if (key.ctrl && key.name === 's') {
      console.log('Ctrl+S pressed - Save action');
      return true;
    }
    
    if (key.ctrl && key.shift && key.name === 'p') {
      console.log('Ctrl+Shift+P pressed - Print action');
      return true;
    }
    
    // Check for arrow keys
    if (key.name === 'up' || key.name === 'down' || 
        key.name === 'left' || key.name === 'right') {
      console.log(`Arrow key pressed: ${key.name}`);
      return true;
    }
    
    return false; // Key not handled
  }
}
```

### Creating a Global Keyboard Shortcut Handler

```typescript
import { getKeyHandler } from '@opentui/core';

// Define a keyboard shortcut handler
function setupGlobalShortcuts() {
  const keyHandler = getKeyHandler();
  
  const shortcuts = {
    'ctrl+q': () => {
      console.log('Quit application');
      process.exit(0);
    },
    'ctrl+s': () => {
      console.log('Save action');
    },
    'ctrl+o': () => {
      console.log('Open action');
    },
    'f1': () => {
      console.log('Show help');
    }
  };
  
  keyHandler.on('keypress', (key) => {
    // Build a key identifier string
    let keyId = '';
    if (key.ctrl) keyId += 'ctrl+';
    if (key.meta) keyId += 'alt+';
    if (key.shift) keyId += 'shift+';
    keyId += key.name;
    
    // Check if we have a handler for this shortcut
    if (shortcuts[keyId]) {
      shortcuts[keyId]();
    }
  });
}

// Call this function to set up global shortcuts
setupGlobalShortcuts();
```

## Mouse Input

OpenTUI provides comprehensive mouse event handling for creating interactive interfaces.

### Mouse Event Types

| Event Type | Description |
|------------|-------------|
| `'down'` | Mouse button pressed |
| `'up'` | Mouse button released |
| `'click'` | Mouse click (down followed by up) |
| `'drag'` | Mouse moved while button pressed |
| `'drag-end'` | Mouse button released after dragging |
| `'move'` | Mouse moved without button pressed |
| `'over'` | Mouse entered a component |
| `'out'` | Mouse left a component |
| `'drop'` | Item dropped on a component |
| `'scroll'` | Mouse wheel scrolled |

### MouseEvent Class

The `MouseEvent` class provides information about mouse events:

```typescript
class MouseEvent {
  public readonly type: MouseEventType;    // Event type
  public readonly button: number;          // Button number
  public readonly x: number;               // X coordinate
  public readonly y: number;               // Y coordinate
  public readonly source?: Renderable;     // Source component (for drag operations)
  public readonly modifiers: {             // Modifier keys
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
  };
  public readonly scroll?: ScrollInfo;     // Scroll information
  public readonly target: Renderable | null; // Target component
  
  // Prevent event bubbling
  public preventDefault(): void;
}
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

### Handling Mouse Events

Components can handle mouse events by overriding the `onMouseEvent` method:

```typescript
import { BoxRenderable, MouseEvent, MouseButton } from '@opentui/core';

class ClickableBox extends BoxRenderable {
  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case 'over':
        this.borderColor = '#00ff00';
        break;
      case 'out':
        this.borderColor = '#ffffff';
        break;
      case 'down':
        if (event.button === MouseButton.LEFT) {
          this.backgroundColor = '#555555';
        }
        break;
      case 'up':
        this.backgroundColor = 'transparent';
        break;
      case 'click':
        console.log('Box clicked at', event.x, event.y);
        // Emit a custom event
        this.emit('activated');
        break;
    }
  }
}

// Usage
const clickable = new ClickableBox('clickable', {
  width: 20,
  height: 5,
  borderStyle: 'single'
});

// Listen for custom events
clickable.on('activated', () => {
  console.log('Box was activated!');
});
```

### Drag and Drop

OpenTUI supports drag and drop operations:

```typescript
import { BoxRenderable, TextRenderable, MouseEvent, MouseButton } from '@opentui/core';

// Draggable item
class DraggableItem extends BoxRenderable {
  private isDragging = false;
  private startX = 0;
  private startY = 0;
  
  constructor(id: string, options = {}) {
    super(id, {
      width: 10,
      height: 3,
      borderStyle: 'single',
      borderColor: '#3498db',
      backgroundColor: '#222222',
      position: 'absolute',
      ...options
    });
    
    // Add a label
    const label = new TextRenderable(`${id}-label`, {
      content: 'Drag me',
      fg: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
      flexGrow: 1
    });
    
    this.add(label);
  }
  
  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case 'down':
        if (event.button === MouseButton.LEFT) {
          this.isDragging = true;
          this.startX = event.x - this.x;
          this.startY = event.y - this.y;
          this.borderColor = '#e74c3c';
          event.preventDefault(); // Capture the mouse
        }
        break;
        
      case 'drag':
        if (this.isDragging) {
          this.x = event.x - this.startX;
          this.y = event.y - this.startY;
          event.preventDefault();
        }
        break;
        
      case 'drag-end':
        this.isDragging = false;
        this.borderColor = '#3498db';
        break;
        
      case 'over':
        if (!this.isDragging) {
          this.borderColor = '#2ecc71';
        }
        break;
        
      case 'out':
        if (!this.isDragging) {
          this.borderColor = '#3498db';
        }
        break;
    }
  }
}

// Drop target
class DropTarget extends BoxRenderable {
  constructor(id: string, options = {}) {
    super(id, {
      width: 20,
      height: 10,
      borderStyle: 'dashed',
      borderColor: '#3498db',
      backgroundColor: 'transparent',
      ...options
    });
    
    // Add a label
    const label = new TextRenderable(`${id}-label`, {
      content: 'Drop here',
      fg: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
      flexGrow: 1
    });
    
    this.add(label);
  }
  
  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case 'over':
        if (event.source) {
          this.borderColor = '#2ecc71';
          this.borderStyle = 'double';
        }
        break;
        
      case 'out':
        this.borderColor = '#3498db';
        this.borderStyle = 'dashed';
        break;
        
      case 'drop':
        if (event.source) {
          this.borderColor = '#e74c3c';
          this.borderStyle = 'single';
          
          console.log(`Item ${event.source.id} dropped on ${this.id}`);
          this.emit('item-dropped', event.source);
          
          // Reset after a delay
          setTimeout(() => {
            this.borderColor = '#3498db';
            this.borderStyle = 'dashed';
          }, 1000);
        }
        break;
    }
  }
}

// Usage
const draggable = new DraggableItem('draggable', {
  x: 5,
  y: 5
});

const dropTarget = new DropTarget('dropTarget', {
  x: 30,
  y: 10
});

dropTarget.on('item-dropped', (item) => {
  console.log(`Handling drop of ${item.id}`);
});

// Add to the renderer
renderer.root.add(draggable);
renderer.root.add(dropTarget);
```

### Scroll Events

Handle scroll events for scrollable components:

```typescript
import { BoxRenderable, TextRenderable, MouseEvent } from '@opentui/core';

class ScrollableContent extends BoxRenderable {
  private scrollOffset = 0;
  private content: TextRenderable;
  private maxScroll = 0;
  
  constructor(id: string, options = {}) {
    super(id, {
      width: 40,
      height: 10,
      borderStyle: 'single',
      borderColor: '#3498db',
      ...options
    });
    
    // Create long content
    const longText = Array(30).fill(0).map((_, i) => `Line ${i + 1}`).join('\n');
    
    this.content = new TextRenderable(`${id}-content`, {
      content: longText,
      fg: '#ffffff'
    });
    
    this.add(this.content);
    this.maxScroll = 30 - this.height + 2; // Account for borders
  }
  
  protected onMouseEvent(event: MouseEvent): void {
    if (event.type === 'scroll' && event.scroll) {
      // Handle scroll up/down
      if (event.scroll.direction === 'up') {
        this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      } else if (event.scroll.direction === 'down') {
        this.scrollOffset = Math.min(this.maxScroll, this.scrollOffset + 1);
      }
      
      // Update content position
      this.content.top = -this.scrollOffset;
      
      event.preventDefault();
    }
  }
}

// Usage
const scrollable = new ScrollableContent('scrollable', {
  x: 5,
  y: 5
});

renderer.root.add(scrollable);
```

## Focus Management

OpenTUI provides a focus system for keyboard navigation between components.

### Making Components Focusable

```typescript
import { BoxRenderable } from '@opentui/core';

class FocusableBox extends BoxRenderable {
  constructor(id: string, options = {}) {
    super(id, options);
    this.focusable = true; // Enable focus
  }
  
  // Optional: Handle focus events
  public focus(): void {
    super.focus();
    this.borderColor = '#2ecc71';
    console.log(`${this.id} gained focus`);
  }
  
  public blur(): void {
    super.blur();
    this.borderColor = '#3498db';
    console.log(`${this.id} lost focus`);
  }
}
```

### Focus Navigation

Create a focus manager for keyboard navigation:

```typescript
import { getKeyHandler, Renderable } from '@opentui/core';

class FocusManager {
  private focusableElements: Renderable[] = [];
  private currentFocusIndex: number = -1;
  
  constructor() {
    const keyHandler = getKeyHandler();
    
    keyHandler.on('keypress', (key) => {
      if (key.name === 'tab') {
        if (key.shift) {
          this.focusPrevious();
        } else {
          this.focusNext();
        }
      }
    });
  }
  
  public register(element: Renderable): void {
    if (element.focusable) {
      this.focusableElements.push(element);
    }
  }
  
  public unregister(element: Renderable): void {
    const index = this.focusableElements.indexOf(element);
    if (index !== -1) {
      this.focusableElements.splice(index, 1);
      if (this.currentFocusIndex >= this.focusableElements.length) {
        this.currentFocusIndex = this.focusableElements.length - 1;
      }
    }
  }
  
  public focusNext(): void {
    if (this.focusableElements.length === 0) return;
    
    // Blur current element
    if (this.currentFocusIndex !== -1) {
      this.focusableElements[this.currentFocusIndex].blur();
    }
    
    // Move to next element
    this.currentFocusIndex = (this.currentFocusIndex + 1) % this.focusableElements.length;
    
    // Focus new element
    this.focusableElements[this.currentFocusIndex].focus();
  }
  
  public focusPrevious(): void {
    if (this.focusableElements.length === 0) return;
    
    // Blur current element
    if (this.currentFocusIndex !== -1) {
      this.focusableElements[this.currentFocusIndex].blur();
    }
    
    // Move to previous element
    this.currentFocusIndex = (this.currentFocusIndex - 1 + this.focusableElements.length) % this.focusableElements.length;
    
    // Focus new element
    this.focusableElements[this.currentFocusIndex].focus();
  }
  
  public focusFirst(): void {
    if (this.focusableElements.length === 0) return;
    
    // Blur current element
    if (this.currentFocusIndex !== -1) {
      this.focusableElements[this.currentFocusIndex].blur();
    }
    
    // Focus first element
    this.currentFocusIndex = 0;
    this.focusableElements[this.currentFocusIndex].focus();
  }
}

// Usage
const focusManager = new FocusManager();

// Register focusable elements
focusManager.register(input1);
focusManager.register(input2);
focusManager.register(button);

// Focus the first element
focusManager.focusFirst();
```

### Example: Creating a Form with Focus Navigation

```typescript
import { BoxRenderable, TextRenderable, InputRenderable, createCliRenderer, getKeyHandler } from '@opentui/core';

async function createForm() {
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a form container
  const form = new BoxRenderable('form', {
    width: 40,
    height: 15,
    borderStyle: 'rounded',
    borderColor: '#3498db',
    backgroundColor: '#222222',
    title: 'Login Form',
    titleAlignment: 'center',
    padding: 1,
    flexDirection: 'column'
  });
  
  // Username field
  const usernameLabel = new TextRenderable('usernameLabel', {
    content: 'Username:',
    fg: '#ffffff',
    marginBottom: 1
  });
  
  const usernameInput = new InputRenderable('usernameInput', {
    width: '100%',
    placeholder: 'Enter username',
    borderStyle: 'single',
    borderColor: '#3498db',
    focusedBorderColor: '#2ecc71',
    marginBottom: 2
  });
  
  // Password field
  const passwordLabel = new TextRenderable('passwordLabel', {
    content: 'Password:',
    fg: '#ffffff',
    marginBottom: 1
  });
  
  const passwordInput = new InputRenderable('passwordInput', {
    width: '100%',
    placeholder: 'Enter password',
    borderStyle: 'single',
    borderColor: '#3498db',
    focusedBorderColor: '#2ecc71',
    marginBottom: 2
  });
  
  // Login button
  const loginButton = new BoxRenderable('loginButton', {
    width: 10,
    height: 3,
    borderStyle: 'single',
    borderColor: '#3498db',
    focusedBorderColor: '#2ecc71',
    alignSelf: 'center',
    marginTop: 1
  });
  
  loginButton.focusable = true;
  
  const buttonLabel = new TextRenderable('buttonLabel', {
    content: 'Login',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  loginButton.add(buttonLabel);
  
  // Handle button click
  loginButton.on('mouseEvent', (event) => {
    if (event.type === 'click') {
      console.log('Login clicked');
      console.log(`Username: ${usernameInput.value}`);
      console.log(`Password: ${passwordInput.value}`);
    }
  });
  
  // Handle button keyboard activation
  loginButton.handleKeyPress = (key) => {
    if (key.name === 'return' || key.name === 'space') {
      console.log('Login activated via keyboard');
      console.log(`Username: ${usernameInput.value}`);
      console.log(`Password: ${passwordInput.value}`);
      return true;
    }
    return false;
  };
  
  // Assemble the form
  form.add(usernameLabel);
  form.add(usernameInput);
  form.add(passwordLabel);
  form.add(passwordInput);
  form.add(loginButton);
  
  // Add the form to the root
  root.add(form);
  
  // Set up focus navigation
  const keyHandler = getKeyHandler();
  const focusableElements = [usernameInput, passwordInput, loginButton];
  let currentFocusIndex = -1;
  
  keyHandler.on('keypress', (key) => {
    if (key.name === 'tab') {
      // Blur current element
      if (currentFocusIndex !== -1) {
        focusableElements[currentFocusIndex].blur();
      }
      
      // Move to next/previous element
      if (key.shift) {
        currentFocusIndex = (currentFocusIndex - 1 + focusableElements.length) % focusableElements.length;
      } else {
        currentFocusIndex = (currentFocusIndex + 1) % focusableElements.length;
      }
      
      // Focus new element
      focusableElements[currentFocusIndex].focus();
    }
  });
  
  // Focus the first input
  currentFocusIndex = 0;
  focusableElements[currentFocusIndex].focus();
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and show the form
createForm().catch(console.error);
```
