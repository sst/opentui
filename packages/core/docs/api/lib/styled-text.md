# Styled Text

OpenTUI provides a powerful styled text system for creating rich text with different styles, colors, and attributes.

## StyledText Class

The `StyledText` class is the core of OpenTUI's text styling system. It allows you to create rich text with different styles, colors, and attributes.

```typescript
import { StyledText, RGBA } from '@opentui/core';

// Create a styled text
const text = new StyledText();

// Add text with different styles
text.pushFg('#ff0000');  // Set foreground color to red
text.pushText('This text is red. ');
text.popFg();  // Restore previous foreground color

text.pushBg('#0000ff');  // Set background color to blue
text.pushText('This text has a blue background. ');
text.popBg();  // Restore previous background color

text.pushAttributes(0x01);  // Set text to bold (0x01 = bold)
text.pushText('This text is bold. ');
text.popAttributes();  // Restore previous attributes

// Combine styles
text.pushFg('#00ff00');  // Green
text.pushBg('#000000');  // Black background
text.pushAttributes(0x01 | 0x02);  // Bold and italic
text.pushText('This text is bold, italic, green on black. ');
text.popAttributes();
text.popBg();
text.popFg();

// Get the styled text as a string
const plainText = text.toString();

// Get the styled text with ANSI escape sequences
const ansiText = text.toANSI();
```

## Text Attributes

OpenTUI supports the following text attributes:

| Attribute | Value | Description |
|-----------|-------|-------------|
| Bold | `0x01` | Bold text |
| Italic | `0x02` | Italic text |
| Underline | `0x04` | Underlined text |
| Strikethrough | `0x08` | Strikethrough text |
| Blink | `0x10` | Blinking text |
| Inverse | `0x20` | Inverted colors |
| Hidden | `0x40` | Hidden text |

You can combine attributes using the bitwise OR operator (`|`):

```typescript
// Bold and underlined text
text.pushAttributes(0x01 | 0x04);
text.pushText('Bold and underlined text');
text.popAttributes();
```

## Colors

OpenTUI supports various color formats:

```typescript
// Hex colors
text.pushFg('#ff0000');  // Red
text.pushBg('#00ff00');  // Green

// RGB colors
text.pushFg(RGBA.fromValues(1.0, 0.0, 0.0, 1.0));  // Red
text.pushBg(RGBA.fromValues(0.0, 1.0, 0.0, 1.0));  // Green

// Named colors
text.pushFg('red');
text.pushBg('green');

// ANSI colors (0-15)
text.pushFg(RGBA.fromANSI(1));  // ANSI red
text.pushBg(RGBA.fromANSI(2));  // ANSI green
```

## HAST Support

OpenTUI supports the Hypertext Abstract Syntax Tree (HAST) format for complex text styling:

```typescript
import { StyledText } from '@opentui/core';

// Create a styled text from HAST
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
          value: 'This text is red and bold. '
        }
      ]
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        style: 'color: blue; text-decoration: underline;'
      },
      children: [
        {
          type: 'text',
          value: 'This text is blue and underlined.'
        }
      ]
    }
  ]
};

const text = StyledText.fromHAST(hast);
```

## Example: Creating a Syntax Highlighter

```typescript
import { StyledText } from '@opentui/core';

function highlightJavaScript(code: string): StyledText {
  const result = new StyledText();
  
  // Simple tokenizer for demonstration
  const tokens = tokenizeJavaScript(code);
  
  for (const token of tokens) {
    switch (token.type) {
      case 'keyword':
        result.pushFg('#569cd6');  // Blue
        result.pushText(token.value);
        result.popFg();
        break;
      case 'string':
        result.pushFg('#ce9178');  // Orange
        result.pushText(token.value);
        result.popFg();
        break;
      case 'number':
        result.pushFg('#b5cea8');  // Light green
        result.pushText(token.value);
        result.popFg();
        break;
      case 'comment':
        result.pushFg('#6a9955');  // Green
        result.pushText(token.value);
        result.popFg();
        break;
      case 'function':
        result.pushFg('#dcdcaa');  // Yellow
        result.pushText(token.value);
        result.popFg();
        break;
      default:
        result.pushText(token.value);
        break;
    }
  }
  
  return result;
}

// Simple tokenizer for demonstration
function tokenizeJavaScript(code: string): Array<{ type: string, value: string }> {
  // This is a simplified tokenizer for demonstration purposes
  // In a real implementation, you would use a proper parser
  
  const keywords = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while'];
  const tokens = [];
  
  // Split the code into lines
  const lines = code.split('\n');
  
  for (const line of lines) {
    let i = 0;
    
    while (i < line.length) {
      // Skip whitespace
      if (/\s/.test(line[i])) {
        const start = i;
        while (i < line.length && /\s/.test(line[i])) {
          i++;
        }
        tokens.push({ type: 'whitespace', value: line.substring(start, i) });
        continue;
      }
      
      // Comments
      if (line[i] === '/' && line[i + 1] === '/') {
        tokens.push({ type: 'comment', value: line.substring(i) });
        break;
      }
      
      // Strings
      if (line[i] === '"' || line[i] === "'") {
        const quote = line[i];
        const start = i;
        i++;
        while (i < line.length && line[i] !== quote) {
          if (line[i] === '\\') {
            i += 2;
          } else {
            i++;
          }
        }
        if (i < line.length) {
          i++;
        }
        tokens.push({ type: 'string', value: line.substring(start, i) });
        continue;
      }
      
      // Numbers
      if (/\d/.test(line[i])) {
        const start = i;
        while (i < line.length && /[\d.]/.test(line[i])) {
          i++;
        }
        tokens.push({ type: 'number', value: line.substring(start, i) });
        continue;
      }
      
      // Identifiers and keywords
      if (/[a-zA-Z_$]/.test(line[i])) {
        const start = i;
        while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) {
          i++;
        }
        const word = line.substring(start, i);
        
        if (keywords.includes(word)) {
          tokens.push({ type: 'keyword', value: word });
        } else if (i < line.length && line[i] === '(') {
          tokens.push({ type: 'function', value: word });
        } else {
          tokens.push({ type: 'identifier', value: word });
        }
        continue;
      }
      
      // Punctuation
      tokens.push({ type: 'punctuation', value: line[i] });
      i++;
    }
    
    tokens.push({ type: 'whitespace', value: '\n' });
  }
  
  return tokens;
}

// Usage
const code = `
function factorial(n) {
  // Calculate factorial
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}

const result = factorial(5);
console.log("The factorial of 5 is: " + result);
`;

const highlightedCode = highlightJavaScript(code);
```

## Example: Creating a Logger with Styled Output

```typescript
import { StyledText } from '@opentui/core';

class Logger {
  private static instance: Logger;
  
  private constructor() {}
  
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }
  
  public info(message: string): StyledText {
    const text = new StyledText();
    
    // Add timestamp
    text.pushFg('#888888');
    text.pushText(`[${new Date().toISOString()}] `);
    text.popFg();
    
    // Add level
    text.pushFg('#3498db');
    text.pushAttributes(0x01);  // Bold
    text.pushText('INFO');
    text.popAttributes();
    text.popFg();
    
    // Add separator
    text.pushText(': ');
    
    // Add message
    text.pushText(message);
    
    return text;
  }
  
  public warn(message: string): StyledText {
    const text = new StyledText();
    
    // Add timestamp
    text.pushFg('#888888');
    text.pushText(`[${new Date().toISOString()}] `);
    text.popFg();
    
    // Add level
    text.pushFg('#f39c12');
    text.pushAttributes(0x01);  // Bold
    text.pushText('WARN');
    text.popAttributes();
    text.popFg();
    
    // Add separator
    text.pushText(': ');
    
    // Add message
    text.pushFg('#f39c12');
    text.pushText(message);
    text.popFg();
    
    return text;
  }
  
  public error(message: string, error?: Error): StyledText {
    const text = new StyledText();
    
    // Add timestamp
    text.pushFg('#888888');
    text.pushText(`[${new Date().toISOString()}] `);
    text.popFg();
    
    // Add level
    text.pushFg('#e74c3c');
    text.pushAttributes(0x01);  // Bold
    text.pushText('ERROR');
    text.popAttributes();
    text.popFg();
    
    // Add separator
    text.pushText(': ');
    
    // Add message
    text.pushFg('#e74c3c');
    text.pushText(message);
    text.popFg();
    
    // Add error details if provided
    if (error) {
      text.pushText('\n');
      text.pushFg('#888888');
      text.pushText(error.stack || error.message);
      text.popFg();
    }
    
    return text;
  }
}

// Usage
const logger = Logger.getInstance();

console.log(logger.info('Application started').toANSI());
console.log(logger.warn('Disk space is low').toANSI());
console.log(logger.error('Failed to connect to database', new Error('Connection timeout')).toANSI());
```
