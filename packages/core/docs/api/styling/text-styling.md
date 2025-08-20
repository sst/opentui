# Text Styling API

OpenTUI provides a rich text styling system that allows you to create formatted text with colors, attributes, and complex layouts.

## StyledText

The `StyledText` class is the core of the text styling system, allowing you to create rich text with different styles.

### Creating Styled Text

```typescript
import { StyledText, stringToStyledText } from '@opentui/core';

// Create an empty styled text
const text = new StyledText();

// Create from a string
const fromString = stringToStyledText('Hello, world!');

// Create from a string with ANSI escape codes
const withAnsi = stringToStyledText('\x1b[31mRed text\x1b[0m and \x1b[1mBold text\x1b[0m');
```

### Adding Content

```typescript
// Add plain text
text.pushText('Hello, ');
text.pushText('world!');

// Add styled text
text.pushFg('#ff0000'); // Start red text
text.pushText('This is red');
text.popFg(); // End red text

text.pushBg('#0000ff'); // Start blue background
text.pushText('This has a blue background');
text.popBg(); // End blue background

text.pushAttributes(0x01); // Start bold text (0x01 is bold)
text.pushText('This is bold');
text.popAttributes(); // End bold text

// Combine styles
text.pushFg('#ff0000');
text.pushBg('#ffffff');
text.pushAttributes(0x01 | 0x04); // Bold and underline
text.pushText('Bold red text on white background with underline');
text.popAttributes();
text.popBg();
text.popFg();
```

### Text Attributes

Text attributes can be combined using bitwise OR (`|`).

| Attribute | Value | Description |
|-----------|-------|-------------|
| `BOLD` | `0x01` | Bold text |
| `DIM` | `0x02` | Dimmed text |
| `ITALIC` | `0x04` | Italic text |
| `UNDERLINE` | `0x08` | Underlined text |
| `BLINK` | `0x10` | Blinking text |
| `INVERSE` | `0x20` | Inverted colors |
| `HIDDEN` | `0x40` | Hidden text |
| `STRIKETHROUGH` | `0x80` | Strikethrough text |

```typescript
// Example of combining attributes
text.pushAttributes(0x01 | 0x08); // Bold and underlined
text.pushText('Bold and underlined text');
text.popAttributes();
```

### Converting to String

```typescript
// Convert to plain text (strips all formatting)
const plainText = text.toString();

// Convert to ANSI-encoded string (preserves formatting)
const ansiText = text.toAnsiString();
```

### Example: Creating a Rich Text Message

```typescript
import { StyledText, TextRenderable } from '@opentui/core';

// Create a styled text message
const message = new StyledText();

// Add a timestamp
message.pushFg('#888888');
message.pushText('[12:34:56] ');
message.popFg();

// Add a status indicator
message.pushFg('#ff0000');
message.pushAttributes(0x01); // Bold
message.pushText('ERROR');
message.popAttributes();
message.popFg();

// Add a separator
message.pushText(': ');

// Add the message
message.pushText('Failed to connect to server ');

// Add details
message.pushFg('#3498db');
message.pushText('example.com');
message.popFg();

// Create a text component with the styled message
const textComponent = new TextRenderable('errorMessage', {
  content: message
});
```

## HAST Styled Text

OpenTUI supports HAST (Hypertext Abstract Syntax Tree) for more complex text styling.

### Creating HAST Styled Text

```typescript
import { hastToStyledText } from '@opentui/core';

// Create styled text from HAST
const hast = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: {
        style: 'color: red; font-weight: bold;'
      },
      children: [
        {
          type: 'text',
          value: 'Important'
        }
      ]
    },
    {
      type: 'text',
      value: ' message'
    }
  ]
};

const styledText = hastToStyledText(hast);
```

### Supported HAST Properties

| Property | Description |
|----------|-------------|
| `style` | CSS-like style string |
| `color`, `backgroundColor` | Text colors |
| `bold`, `italic`, `underline` | Text formatting |

### Example: Syntax Highlighting with HAST

```typescript
import { hastToStyledText, TextRenderable } from '@opentui/core';

// HAST representation of syntax-highlighted code
const codeHast = {
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: { style: 'color: #569cd6;' },
      children: [{ type: 'text', value: 'function' }]
    },
    { type: 'text', value: ' ' },
    {
      type: 'element',
      tagName: 'span',
      properties: { style: 'color: #dcdcaa;' },
      children: [{ type: 'text', value: 'greet' }]
    },
    { type: 'text', value: '(' },
    {
      type: 'element',
      tagName: 'span',
      properties: { style: 'color: #9cdcfe;' },
      children: [{ type: 'text', value: 'name' }]
    },
    { type: 'text', value: ') {\n  ' },
    {
      type: 'element',
      tagName: 'span',
      properties: { style: 'color: #c586c0;' },
      children: [{ type: 'text', value: 'return' }]
    },
    { type: 'text', value: ' ' },
    {
      type: 'element',
      tagName: 'span',
      properties: { style: 'color: #ce9178;' },
      children: [{ type: 'text', value: '`Hello, ${name}!`' }]
    },
    { type: 'text', value: ';\n}' }
  ]
};

// Convert to styled text
const codeStyledText = hastToStyledText(codeHast);

// Create a text component with the syntax-highlighted code
const codeBlock = new TextRenderable('codeBlock', {
  content: codeStyledText,
  bg: '#1e1e1e'
});
```

## Text Buffer

The `TextBuffer` class provides low-level text rendering capabilities.

### Creating a Text Buffer

```typescript
import { TextBuffer, RGBA } from '@opentui/core';

// Create a text buffer with initial capacity
const buffer = TextBuffer.create(100);

// Set default styles
buffer.setDefaultFg(RGBA.fromHex('#ffffff'));
buffer.setDefaultBg(RGBA.fromHex('#000000'));
buffer.setDefaultAttributes(0); // No attributes
```

### Adding Text

```typescript
// Add text at a specific position
buffer.addText(0, 0, 'Hello, world!');

// Add text with specific styles
buffer.addText(0, 1, 'Colored text', RGBA.fromHex('#ff0000'), RGBA.fromHex('#000000'), 0x01);

// Add styled text
buffer.setStyledText(styledTextObject);
```

### Selection

```typescript
// Set selection range
buffer.setSelection(5, 10, RGBA.fromHex('#3498db'), RGBA.fromHex('#ffffff'));

// Reset selection
buffer.resetSelection();
```

### Example: Creating a Custom Text Component

```typescript
import { Renderable, TextBuffer, OptimizedBuffer, RGBA } from '@opentui/core';

class HighlightedTextRenderable extends Renderable {
  private textBuffer: TextBuffer;
  private _text: string = '';
  private _highlightRanges: Array<{ start: number; end: number; color: RGBA }> = [];
  
  constructor(id: string, options: any = {}) {
    super(id, options);
    
    this._text = options.text || '';
    this._highlightRanges = options.highlightRanges || [];
    
    this.textBuffer = TextBuffer.create(this._text.length + 100);
    this.textBuffer.setDefaultFg(RGBA.fromHex('#ffffff'));
    this.textBuffer.setDefaultBg(RGBA.fromHex('#000000'));
    
    this.updateTextBuffer();
  }
  
  get text(): string {
    return this._text;
  }
  
  set text(value: string) {
    this._text = value;
    this.updateTextBuffer();
  }
  
  get highlightRanges(): Array<{ start: number; end: number; color: RGBA }> {
    return [...this._highlightRanges];
  }
  
  set highlightRanges(value: Array<{ start: number; end: number; color: RGBA | string }>) {
    this._highlightRanges = value.map(range => ({
      start: range.start,
      end: range.end,
      color: typeof range.color === 'string' ? RGBA.fromHex(range.color) : range.color
    }));
    this.updateTextBuffer();
  }
  
  private updateTextBuffer(): void {
    this.textBuffer.clear();
    this.textBuffer.addText(0, 0, this._text);
    
    // Apply highlights
    for (const range of this._highlightRanges) {
      this.textBuffer.setSelection(range.start, range.end, range.color);
    }
    
    this.needsUpdate();
  }
  
  protected renderSelf(buffer: OptimizedBuffer): void {
    const clipRect = {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height
    };
    
    buffer.drawTextBuffer(this.textBuffer, this.x, this.y, clipRect);
  }
  
  destroy(): void {
    this.textBuffer.destroy();
    super.destroy();
  }
}

// Usage
const highlightedText = new HighlightedTextRenderable('highlightedText', {
  width: 40,
  height: 1,
  text: 'This is a text with highlighted parts',
  highlightRanges: [
    { start: 10, end: 14, color: '#ff0000' }, // "text" in red
    { start: 20, end: 31, color: '#00ff00' }  // "highlighted" in green
  ]
});

// Update text
highlightedText.text = 'New text with different highlights';

// Update highlights
highlightedText.highlightRanges = [
  { start: 0, end: 3, color: '#3498db' },  // "New" in blue
  { start: 9, end: 18, color: '#e74c3c' }  // "different" in red
];
```

## Border Styling

OpenTUI provides various border styles for boxes and other components.

### Border Styles

| Style | Description |
|-------|-------------|
| `'single'` | Single line border |
| `'double'` | Double line border |
| `'rounded'` | Rounded corners with single lines |
| `'bold'` | Bold single line border |
| `'dashed'` | Dashed border |
| `'dotted'` | Dotted border |
| `'ascii'` | ASCII characters (`+`, `-`, `|`) |

### Border Sides

You can specify which sides of a component should have borders:

```typescript
import { BoxRenderable } from '@opentui/core';

// All sides (default)
const box1 = new BoxRenderable('box1', {
  border: true
});

// Specific sides
const box2 = new BoxRenderable('box2', {
  border: ['top', 'bottom']
});

const box3 = new BoxRenderable('box3', {
  border: ['left', 'right']
});

// No borders
const box4 = new BoxRenderable('box4', {
  border: false
});
```

### Custom Border Characters

You can define custom border characters for unique styling:

```typescript
import { BoxRenderable } from '@opentui/core';

const customBox = new BoxRenderable('customBox', {
  customBorderChars: {
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
  }
});
```

### Example: Creating a Custom Panel

```typescript
import { BoxRenderable, TextRenderable } from '@opentui/core';

// Create a panel with custom styling
const panel = new BoxRenderable('panel', {
  width: 40,
  height: 10,
  borderStyle: 'rounded',
  borderColor: '#3498db',
  backgroundColor: '#222222',
  title: 'Custom Panel',
  titleAlignment: 'center'
});

// Add content
const content = new TextRenderable('content', {
  content: 'This panel has rounded corners and a centered title.',
  fg: '#ffffff',
  padding: 1
});

panel.add(content);
```
