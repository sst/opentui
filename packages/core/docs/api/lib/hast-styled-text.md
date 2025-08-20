# HAST Styled Text

OpenTUI provides support for Hypertext Abstract Syntax Tree (HAST) for complex text styling, allowing you to create rich text with different styles using a tree-based structure.

## Overview

The HAST Styled Text system consists of:

1. **HASTNode**: A tree structure representing styled text
2. **SyntaxStyle**: A class for defining and merging text styles
3. **hastToStyledText**: A function for converting HAST to StyledText

## HAST Structure

HAST (Hypertext Abstract Syntax Tree) is a tree structure that represents HTML-like markup. In OpenTUI, it's used to represent styled text with nested elements and classes.

```typescript
import { HASTNode, HASTElement, HASTText } from '@opentui/core';

// A text node
const textNode: HASTText = {
  type: 'text',
  value: 'Hello, world!'
};

// An element node with a class
const elementNode: HASTElement = {
  type: 'element',
  tagName: 'span',
  properties: {
    className: 'keyword'
  },
  children: [
    {
      type: 'text',
      value: 'function'
    }
  ]
};

// A complex HAST tree
const hastTree: HASTNode = {
  type: 'element',
  tagName: 'div',
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'keyword'
      },
      children: [
        {
          type: 'text',
          value: 'function'
        }
      ]
    },
    {
      type: 'text',
      value: ' '
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'function-name'
      },
      children: [
        {
          type: 'text',
          value: 'example'
        }
      ]
    },
    {
      type: 'text',
      value: '() {'
    }
  ]
};
```

## SyntaxStyle API

The `SyntaxStyle` class defines styles for different class names and provides methods for merging styles:

```typescript
import { SyntaxStyle, StyleDefinition, RGBA } from '@opentui/core';

// Define styles for different classes
const styles: Record<string, StyleDefinition> = {
  default: {
    fg: RGBA.fromHex('#ffffff')
  },
  keyword: {
    fg: RGBA.fromHex('#569cd6'),
    bold: true
  },
  'function-name': {
    fg: RGBA.fromHex('#dcdcaa')
  },
  string: {
    fg: RGBA.fromHex('#ce9178')
  },
  comment: {
    fg: RGBA.fromHex('#6a9955'),
    italic: true
  }
};

// Create a syntax style
const syntaxStyle = new SyntaxStyle(styles);

// Merge styles
const mergedStyle = syntaxStyle.mergeStyles('keyword', 'bold');

// Clear the style cache
syntaxStyle.clearCache();

// Get the cache size
const cacheSize = syntaxStyle.getCacheSize();
```

## Converting HAST to StyledText

The `hastToStyledText` function converts a HAST tree to a `StyledText` instance:

```typescript
import { hastToStyledText, SyntaxStyle, HASTNode } from '@opentui/core';

// Define a syntax style
const syntaxStyle = new SyntaxStyle({
  default: {
    fg: RGBA.fromHex('#ffffff')
  },
  keyword: {
    fg: RGBA.fromHex('#569cd6'),
    bold: true
  },
  'function-name': {
    fg: RGBA.fromHex('#dcdcaa')
  }
});

// Define a HAST tree
const hast: HASTNode = {
  type: 'element',
  tagName: 'div',
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'keyword'
      },
      children: [
        {
          type: 'text',
          value: 'function'
        }
      ]
    },
    {
      type: 'text',
      value: ' '
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'function-name'
      },
      children: [
        {
          type: 'text',
          value: 'example'
        }
      ]
    }
  ]
};

// Convert HAST to StyledText
const styledText = hastToStyledText(hast, syntaxStyle);

// Use the styled text
console.log(styledText.toString());
```

## Example: Syntax Highlighting

Here's an example of using HAST Styled Text for syntax highlighting:

```typescript
import { 
  SyntaxStyle, 
  HASTNode, 
  hastToStyledText, 
  RGBA, 
  TextRenderable 
} from '@opentui/core';

// Define a syntax style for JavaScript
const jsStyle = new SyntaxStyle({
  default: {
    fg: RGBA.fromHex('#d4d4d4')
  },
  keyword: {
    fg: RGBA.fromHex('#569cd6'),
    bold: true
  },
  'function-name': {
    fg: RGBA.fromHex('#dcdcaa')
  },
  string: {
    fg: RGBA.fromHex('#ce9178')
  },
  number: {
    fg: RGBA.fromHex('#b5cea8')
  },
  comment: {
    fg: RGBA.fromHex('#6a9955'),
    italic: true
  },
  punctuation: {
    fg: RGBA.fromHex('#d4d4d4')
  }
});

// Create a HAST tree for JavaScript code
const jsCode: HASTNode = {
  type: 'element',
  tagName: 'div',
  children: [
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'comment'
      },
      children: [
        {
          type: 'text',
          value: '// Example function\n'
        }
      ]
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'keyword'
      },
      children: [
        {
          type: 'text',
          value: 'function'
        }
      ]
    },
    {
      type: 'text',
      value: ' '
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'function-name'
      },
      children: [
        {
          type: 'text',
          value: 'calculateSum'
        }
      ]
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'punctuation'
      },
      children: [
        {
          type: 'text',
          value: '('
        }
      ]
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'parameter'
      },
      children: [
        {
          type: 'text',
          value: 'a, b'
        }
      ]
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'punctuation'
      },
      children: [
        {
          type: 'text',
          value: ') {\n  '
        }
      ]
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'keyword'
      },
      children: [
        {
          type: 'text',
          value: 'return'
        }
      ]
    },
    {
      type: 'text',
      value: ' a + b;\n'
    },
    {
      type: 'element',
      tagName: 'span',
      properties: {
        className: 'punctuation'
      },
      children: [
        {
          type: 'text',
          value: '}'
        }
      ]
    }
  ]
};

// Convert HAST to StyledText
const styledCode = hastToStyledText(jsCode, jsStyle);

// Create a text renderable with the styled text
const codeBlock = new TextRenderable('code-block', {
  styledContent: styledCode,
  borderStyle: 'single',
  borderColor: '#3498db',
  padding: 1
});

// Add to the renderer
renderer.root.add(codeBlock);
```

## Example: Creating a Syntax Highlighter

Here's an example of creating a simple syntax highlighter that generates HAST from code:

```typescript
import { 
  SyntaxStyle, 
  HASTNode, 
  HASTElement, 
  HASTText, 
  hastToStyledText, 
  RGBA 
} from '@opentui/core';

// Define a simple JavaScript syntax highlighter
function highlightJS(code: string): HASTNode {
  const root: HASTElement = {
    type: 'element',
    tagName: 'div',
    children: []
  };
  
  // Simple regex-based tokenization
  const tokens = code.match(/\/\/.*|\/\*[\s\S]*?\*\/|\b(function|return|const|let|var|if|else|for|while)\b|"[^"]*"|'[^']*'|\d+|\w+|[^\s\w]+/g) || [];
  
  for (const token of tokens) {
    let element: HASTNode;
    
    if (/^(function|return|const|let|var|if|else|for|while)$/.test(token)) {
      // Keywords
      element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'keyword' },
        children: [{ type: 'text', value: token }]
      };
    } else if (/^\/\/.*/.test(token) || /^\/\*[\s\S]*?\*\/$/.test(token)) {
      // Comments
      element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'comment' },
        children: [{ type: 'text', value: token }]
      };
    } else if (/^"[^"]*"$/.test(token) || /^'[^']*'$/.test(token)) {
      // Strings
      element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'string' },
        children: [{ type: 'text', value: token }]
      };
    } else if (/^\d+$/.test(token)) {
      // Numbers
      element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'number' },
        children: [{ type: 'text', value: token }]
      };
    } else if (/^[^\s\w]+$/.test(token)) {
      // Punctuation
      element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'punctuation' },
        children: [{ type: 'text', value: token }]
      };
    } else if (/^\w+$/.test(token)) {
      // Identifiers
      element = {
        type: 'element',
        tagName: 'span',
        properties: { className: 'identifier' },
        children: [{ type: 'text', value: token }]
      };
    } else {
      // Plain text
      element = { type: 'text', value: token };
    }
    
    root.children.push(element);
  }
  
  return root;
}

// Usage
const code = `
// Example function
function calculateSum(a, b) {
  return a + b;
}
`;

const jsStyle = new SyntaxStyle({
  default: { fg: RGBA.fromHex('#d4d4d4') },
  keyword: { fg: RGBA.fromHex('#569cd6'), bold: true },
  comment: { fg: RGBA.fromHex('#6a9955'), italic: true },
  string: { fg: RGBA.fromHex('#ce9178') },
  number: { fg: RGBA.fromHex('#b5cea8') },
  punctuation: { fg: RGBA.fromHex('#d4d4d4') },
  identifier: { fg: RGBA.fromHex('#9cdcfe') }
});

const hastTree = highlightJS(code);
const styledText = hastToStyledText(hastTree, jsStyle);

// Create a text renderable with the styled text
const codeBlock = new TextRenderable('code-block', {
  styledContent: styledText,
  borderStyle: 'single',
  borderColor: '#3498db',
  padding: 1
});
```
