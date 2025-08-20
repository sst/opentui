# Key Handler

The `KeyHandler` class provides a high-level API for handling keyboard input in OpenTUI applications.

## Overview

The key handler processes raw key events from the terminal and provides a structured representation of keyboard input, including support for key combinations and special keys.

## Key Handler API

### Getting the Key Handler

```typescript
import { getKeyHandler } from '@opentui/core';

// Get the global key handler
const keyHandler = getKeyHandler();
```

### Listening for Key Events

```typescript
// Listen for keypress events
keyHandler.on('keypress', (key) => {
  console.log('Key pressed:', key.name);
  
  if (key.ctrl && key.name === 'c') {
    console.log('Ctrl+C pressed');
  }
});
```

### ParsedKey Interface

The `ParsedKey` interface provides a structured representation of keyboard input:

```typescript
interface ParsedKey {
  sequence: string;      // Raw key sequence
  name: string;          // Key name (e.g., 'a', 'return', 'escape')
  ctrl: boolean;         // Whether Ctrl was pressed
  meta: boolean;         // Whether Meta/Alt was pressed
  shift: boolean;        // Whether Shift was pressed
  option: boolean;       // Whether Option/Alt was pressed
  number: boolean;       // Whether this is a number key
  raw: string;           // Raw key data
  code?: string;         // Key code for special keys
}
```

### Parsing Key Sequences

You can manually parse key sequences using the `parseKeypress` function:

```typescript
import { parseKeypress } from '@opentui/core';

// Parse a key sequence
const key = parseKeypress('\x1b[A'); // Up arrow key
console.log(key); // { name: 'up', sequence: '\x1b[A', ... }
```

## Common Key Names

Here are some common key names you can check for:

| Category | Key Names |
|----------|-----------|
| Letters | `'a'` through `'z'` |
| Numbers | `'0'` through `'9'` |
| Special | `'space'`, `'backspace'`, `'tab'`, `'return'`, `'escape'` |
| Function | `'f1'` through `'f12'` |
| Navigation | `'up'`, `'down'`, `'left'`, `'right'`, `'home'`, `'end'`, `'pageup'`, `'pagedown'` |
| Editing | `'delete'`, `'insert'` |

## Example: Handling Keyboard Shortcuts

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

## Example: Creating a Key-Based Navigation System

```typescript
import { getKeyHandler, BoxRenderable } from '@opentui/core';

class KeyboardNavigationManager {
  private focusableElements: BoxRenderable[] = [];
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
      } else if (key.name === 'up') {
        this.focusUp();
      } else if (key.name === 'down') {
        this.focusDown();
      } else if (key.name === 'left') {
        this.focusLeft();
      } else if (key.name === 'right') {
        this.focusRight();
      }
    });
  }
  
  public addFocusableElement(element: BoxRenderable): void {
    this.focusableElements.push(element);
    element.focusable = true;
    
    if (this.currentFocusIndex === -1) {
      this.currentFocusIndex = 0;
      element.focus();
    }
  }
  
  public removeFocusableElement(element: BoxRenderable): void {
    const index = this.focusableElements.indexOf(element);
    if (index !== -1) {
      this.focusableElements.splice(index, 1);
      
      if (this.currentFocusIndex >= this.focusableElements.length) {
        this.currentFocusIndex = this.focusableElements.length - 1;
      }
      
      if (this.currentFocusIndex !== -1) {
        this.focusableElements[this.currentFocusIndex].focus();
      }
    }
  }
  
  public focusNext(): void {
    if (this.focusableElements.length === 0) return;
    
    if (this.currentFocusIndex !== -1) {
      this.focusableElements[this.currentFocusIndex].blur();
    }
    
    this.currentFocusIndex = (this.currentFocusIndex + 1) % this.focusableElements.length;
    this.focusableElements[this.currentFocusIndex].focus();
  }
  
  public focusPrevious(): void {
    if (this.focusableElements.length === 0) return;
    
    if (this.currentFocusIndex !== -1) {
      this.focusableElements[this.currentFocusIndex].blur();
    }
    
    this.currentFocusIndex = (this.currentFocusIndex - 1 + this.focusableElements.length) % this.focusableElements.length;
    this.focusableElements[this.currentFocusIndex].focus();
  }
  
  public focusUp(): void {
    if (this.focusableElements.length === 0 || this.currentFocusIndex === -1) return;
    
    const currentElement = this.focusableElements[this.currentFocusIndex];
    let closestElement: BoxRenderable | null = null;
    let closestDistance = Infinity;
    
    for (const element of this.focusableElements) {
      if (element === currentElement) continue;
      
      // Check if the element is above the current element
      if (element.y + element.height <= currentElement.y) {
        const horizontalDistance = Math.abs((element.x + element.width / 2) - (currentElement.x + currentElement.width / 2));
        const verticalDistance = currentElement.y - (element.y + element.height);
        const distance = Math.sqrt(horizontalDistance * horizontalDistance + verticalDistance * verticalDistance);
        
        if (distance < closestDistance) {
          closestDistance = distance;
          closestElement = element;
        }
      }
    }
    
    if (closestElement) {
      currentElement.blur();
      this.currentFocusIndex = this.focusableElements.indexOf(closestElement);
      closestElement.focus();
    }
  }
  
  public focusDown(): void {
    // Similar to focusUp but for elements below
    // ...
  }
  
  public focusLeft(): void {
    // Similar to focusUp but for elements to the left
    // ...
  }
  
  public focusRight(): void {
    // Similar to focusUp but for elements to the right
    // ...
  }
}

// Usage
const navigationManager = new KeyboardNavigationManager();

// Add focusable elements
navigationManager.addFocusableElement(button1);
navigationManager.addFocusableElement(button2);
navigationManager.addFocusableElement(inputField);
```

## Example: Creating a Text Editor with Keyboard Shortcuts

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, getKeyHandler } from '@opentui/core';

class TextEditor extends BoxRenderable {
  private content: string = '';
  private cursor: { row: number, col: number } = { row: 0, col: 0 };
  private lines: string[] = [''];
  private textDisplay: TextRenderable;
  
  constructor(id: string, options = {}) {
    super(id, {
      width: 60,
      height: 20,
      borderStyle: 'single',
      borderColor: '#3498db',
      backgroundColor: '#222222',
      padding: 1,
      ...options
    });
    
    this.focusable = true;
    
    this.textDisplay = new TextRenderable(`${id}-text`, {
      content: '',
      fg: '#ffffff',
      flexGrow: 1
    });
    
    this.add(this.textDisplay);
    
    // Set up key handler
    const keyHandler = getKeyHandler();
    
    keyHandler.on('keypress', (key) => {
      if (!this.isFocused) return;
      
      if (key.name === 'return') {
        this.insertNewline();
      } else if (key.name === 'backspace') {
        this.deleteCharacter();
      } else if (key.name === 'delete') {
        this.deleteCharacterForward();
      } else if (key.name === 'left') {
        this.moveCursorLeft();
      } else if (key.name === 'right') {
        this.moveCursorRight();
      } else if (key.name === 'up') {
        this.moveCursorUp();
      } else if (key.name === 'down') {
        this.moveCursorDown();
      } else if (key.name === 'home') {
        this.moveCursorToLineStart();
      } else if (key.name === 'end') {
        this.moveCursorToLineEnd();
      } else if (key.ctrl && key.name === 'a') {
        this.moveCursorToLineStart();
      } else if (key.ctrl && key.name === 'e') {
        this.moveCursorToLineEnd();
      } else if (key.ctrl && key.name === 'k') {
        this.deleteToEndOfLine();
      } else if (key.ctrl && key.name === 'u') {
        this.deleteToStartOfLine();
      } else if (key.name.length === 1) {
        this.insertCharacter(key.name);
      }
      
      this.updateDisplay();
    });
  }
  
  private updateDisplay(): void {
    // Create a copy of the lines with the cursor
    const displayLines = [...this.lines];
    const cursorLine = displayLines[this.cursor.row];
    
    // Insert cursor character
    displayLines[this.cursor.row] = 
      cursorLine.substring(0, this.cursor.col) + 
      '█' + 
      cursorLine.substring(this.cursor.col);
    
    // Update the text display
    this.textDisplay.content = displayLines.join('\n');
  }
  
  private insertCharacter(char: string): void {
    const line = this.lines[this.cursor.row];
    this.lines[this.cursor.row] = 
      line.substring(0, this.cursor.col) + 
      char + 
      line.substring(this.cursor.col);
    
    this.cursor.col++;
  }
  
  private insertNewline(): void {
    const line = this.lines[this.cursor.row];
    const newLine = line.substring(this.cursor.col);
    this.lines[this.cursor.row] = line.substring(0, this.cursor.col);
    this.lines.splice(this.cursor.row + 1, 0, newLine);
    
    this.cursor.row++;
    this.cursor.col = 0;
  }
  
  private deleteCharacter(): void {
    if (this.cursor.col > 0) {
      // Delete character before cursor
      const line = this.lines[this.cursor.row];
      this.lines[this.cursor.row] = 
        line.substring(0, this.cursor.col - 1) + 
        line.substring(this.cursor.col);
      
      this.cursor.col--;
    } else if (this.cursor.row > 0) {
      // Join with previous line
      const previousLine = this.lines[this.cursor.row - 1];
      const currentLine = this.lines[this.cursor.row];
      
      this.cursor.col = previousLine.length;
      this.lines[this.cursor.row - 1] = previousLine + currentLine;
      this.lines.splice(this.cursor.row, 1);
      
      this.cursor.row--;
    }
  }
  
  // ... other editing methods ...
  
  public focus(): void {
    super.focus();
    this.borderColor = '#2ecc71';
    this.updateDisplay();
  }
  
  public blur(): void {
    super.blur();
    this.borderColor = '#3498db';
    this.updateDisplay();
  }
  
  public getText(): string {
    return this.lines.join('\n');
  }
  
  public setText(text: string): void {
    this.lines = text.split('\n');
    if (this.lines.length === 0) {
      this.lines = [''];
    }
    
    this.cursor = { row: 0, col: 0 };
    this.updateDisplay();
  }
}

// Usage
async function createTextEditorDemo() {
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  const editor = new TextEditor('editor', {
    x: 10,
    y: 5,
    width: 60,
    height: 20
  });
  
  root.add(editor);
  editor.focus();
  
  renderer.start();
  
  return renderer;
}

createTextEditorDemo().catch(console.error);
```
