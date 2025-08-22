# Border Styles

OpenTUI provides a variety of border styles for creating visually appealing terminal user interfaces.

## Overview

Borders are an important visual element in terminal user interfaces, helping to define and separate different areas of the screen. OpenTUI provides several built-in border styles and allows you to create custom border styles.

## Border Style API

### Border Style Types

OpenTUI supports the following border style types:

| Style | Description |
|-------|-------------|
| `'none'` | No border |
| `'single'` | Single-line border |
| `'double'` | Double-line border |
| `'rounded'` | Rounded corners with single lines |
| `'dashed'` | Dashed border |
| `'thick'` | Thick border |
| `'block'` | Block border |
| `'custom'` | Custom border defined by the user |

### Using Border Styles

```typescript
import { BoxRenderable } from '@opentui/core';

// Create a box with a single-line border
const singleBox = new BoxRenderable('single-box', {
  width: 20,
  height: 5,
  borderStyle: 'single',
  borderColor: '#ffffff'
});

// Create a box with a double-line border
const doubleBox = new BoxRenderable('double-box', {
  width: 20,
  height: 5,
  borderStyle: 'double',
  borderColor: '#3498db'
});

// Create a box with a rounded border
const roundedBox = new BoxRenderable('rounded-box', {
  width: 20,
  height: 5,
  borderStyle: 'rounded',
  borderColor: '#2ecc71'
});

// Create a box with a dashed border
const dashedBox = new BoxRenderable('dashed-box', {
  width: 20,
  height: 5,
  borderStyle: 'dashed',
  borderColor: '#e74c3c'
});

// Create a box with a thick border
const thickBox = new BoxRenderable('thick-box', {
  width: 20,
  height: 5,
  borderStyle: 'thick',
  borderColor: '#f39c12'
});

// Create a box with a block border
const blockBox = new BoxRenderable('block-box', {
  width: 20,
  height: 5,
  borderStyle: 'block',
  borderColor: '#9b59b6'
});
```

### Border Characters

Each border style defines a set of characters for different parts of the border:

```typescript
interface BorderChars {
  topLeft: string;      // Top-left corner
  topRight: string;     // Top-right corner
  bottomLeft: string;   // Bottom-left corner
  bottomRight: string;  // Bottom-right corner
  horizontal: string;   // Horizontal line
  vertical: string;     // Vertical line
  left: string;         // Left T-junction
  right: string;        // Right T-junction
  top: string;          // Top T-junction
  bottom: string;       // Bottom T-junction
  cross: string;        // Cross junction
}
```

### Creating Custom Border Styles

You can create custom border styles by defining your own border characters:

```typescript
import { BoxRenderable, registerBorderStyle } from '@opentui/core';

// Register a custom border style
registerBorderStyle('stars', {
  topLeft: '*',
  topRight: '*',
  bottomLeft: '*',
  bottomRight: '*',
  horizontal: '*',
  vertical: '*',
  left: '*',
  right: '*',
  top: '*',
  bottom: '*',
  cross: '*'
});

// Use the custom border style
const starsBox = new BoxRenderable('stars-box', {
  width: 20,
  height: 5,
  borderStyle: 'stars',
  borderColor: '#f1c40f'
});
```

### Getting Border Characters

You can get the border characters for a specific style:

```typescript
import { getBorderChars } from '@opentui/core';

// Get the border characters for the 'single' style
const singleBorderChars = getBorderChars('single');
console.log(singleBorderChars);
```

## Example: Creating a Panel with a Title

```typescript
import { BoxRenderable, TextRenderable } from '@opentui/core';

// Create a panel with a title
function createPanel(id: string, title: string, options = {}) {
  const panel = new BoxRenderable(id, {
    width: 40,
    height: 10,
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222',
    ...options
  });
  
  // Create a title bar
  const titleBar = new BoxRenderable(`${id}-title-bar`, {
    width: '100%',
    height: 3,
    borderStyle: 'none',
    backgroundColor: '#3498db'
  });
  
  // Create a title text
  const titleText = new TextRenderable(`${id}-title-text`, {
    content: title,
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  // Create a content area
  const contentArea = new BoxRenderable(`${id}-content-area`, {
    width: '100%',
    height: 'calc(100% - 3)',
    y: 3,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    padding: 1
  });
  
  // Build the component tree
  titleBar.add(titleText);
  panel.add(titleBar);
  panel.add(contentArea);
  
  return {
    panel,
    contentArea
  };
}

// Usage
const { panel, contentArea } = createPanel('my-panel', 'My Panel');

// Add content to the panel
const content = new TextRenderable('content', {
  content: 'This is the panel content.',
  fg: '#ffffff',
  flexGrow: 1
});

contentArea.add(content);
```

## Example: Creating a Dialog Box

```typescript
import { BoxRenderable, TextRenderable } from '@opentui/core';

// Create a dialog box
function createDialog(id: string, title: string, message: string, options = {}) {
  const dialog = new BoxRenderable(id, {
    width: 50,
    height: 15,
    borderStyle: 'double',
    borderColor: '#3498db',
    backgroundColor: '#222222',
    position: 'absolute',
    x: 'center',
    y: 'center',
    ...options
  });
  
  // Create a title bar
  const titleBar = new BoxRenderable(`${id}-title-bar`, {
    width: '100%',
    height: 3,
    borderStyle: 'none',
    backgroundColor: '#3498db'
  });
  
  // Create a title text
  const titleText = new TextRenderable(`${id}-title-text`, {
    content: title,
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  // Create a message area
  const messageArea = new BoxRenderable(`${id}-message-area`, {
    width: '100%',
    height: 'calc(100% - 6)',
    y: 3,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    padding: 1
  });
  
  // Create a message text
  const messageText = new TextRenderable(`${id}-message-text`, {
    content: message,
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  // Create a button area
  const buttonArea = new BoxRenderable(`${id}-button-area`, {
    width: '100%',
    height: 3,
    y: 'calc(100% - 3)',
    borderStyle: 'none',
    backgroundColor: 'transparent',
    padding: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center'
  });
  
  // Create an OK button
  const okButton = new BoxRenderable(`${id}-ok-button`, {
    width: 10,
    height: 1,
    borderStyle: 'single',
    borderColor: '#2ecc71',
    backgroundColor: 'transparent',
    marginRight: 1
  });
  
  // Create an OK button text
  const okButtonText = new TextRenderable(`${id}-ok-button-text`, {
    content: 'OK',
    fg: '#2ecc71',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  // Create a Cancel button
  const cancelButton = new BoxRenderable(`${id}-cancel-button`, {
    width: 10,
    height: 1,
    borderStyle: 'single',
    borderColor: '#e74c3c',
    backgroundColor: 'transparent'
  });
  
  // Create a Cancel button text
  const cancelButtonText = new TextRenderable(`${id}-cancel-button-text`, {
    content: 'Cancel',
    fg: '#e74c3c',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  // Build the component tree
  titleBar.add(titleText);
  messageArea.add(messageText);
  okButton.add(okButtonText);
  cancelButton.add(cancelButtonText);
  buttonArea.add(okButton);
  buttonArea.add(cancelButton);
  dialog.add(titleBar);
  dialog.add(messageArea);
  dialog.add(buttonArea);
  
  // Make the buttons focusable
  okButton.focusable = true;
  cancelButton.focusable = true;
  
  // Focus the OK button by default
  okButton.focus();
  
  // Handle button clicks
  okButton.on('click', () => {
    dialog.emit('ok');
  });
  
  cancelButton.on('click', () => {
    dialog.emit('cancel');
  });
  
  return dialog;
}

// Usage
const dialog = createDialog('my-dialog', 'Confirmation', 'Are you sure you want to proceed?');

// Handle dialog events
dialog.on('ok', () => {
  console.log('OK button clicked');
  dialog.remove();
});

dialog.on('cancel', () => {
  console.log('Cancel button clicked');
  dialog.remove();
});
```

## Example: Creating a Tabbed Interface

```typescript
import { BoxRenderable, TextRenderable } from '@opentui/core';

// Create a tabbed interface
function createTabbedInterface(id: string, tabs: string[], options = {}) {
  const container = new BoxRenderable(id, {
    width: 60,
    height: 20,
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222',
    ...options
  });
  
  // Create a tab bar
  const tabBar = new BoxRenderable(`${id}-tab-bar`, {
    width: '100%',
    height: 3,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    flexDirection: 'row'
  });
  
  // Create a content area
  const contentArea = new BoxRenderable(`${id}-content-area`, {
    width: '100%',
    height: 'calc(100% - 3)',
    y: 3,
    borderStyle: 'none',
    backgroundColor: 'transparent',
    padding: 1
  });
  
  // Create tab buttons and content panels
  const tabButtons: BoxRenderable[] = [];
  const contentPanels: BoxRenderable[] = [];
  
  tabs.forEach((tab, index) => {
    // Create a tab button
    const tabButton = new BoxRenderable(`${id}-tab-${index}`, {
      width: Math.floor(100 / tabs.length) + '%',
      height: '100%',
      borderStyle: index === 0 ? 'bottom-none' : 'single',
      borderColor: index === 0 ? '#3498db' : '#bbbbbb',
      backgroundColor: index === 0 ? '#222222' : 'transparent'
    });
    
    // Create a tab button text
    const tabButtonText = new TextRenderable(`${id}-tab-${index}-text`, {
      content: tab,
      fg: index === 0 ? '#ffffff' : '#bbbbbb',
      alignItems: 'center',
      justifyContent: 'center',
      flexGrow: 1
    });
    
    // Create a content panel
    const contentPanel = new BoxRenderable(`${id}-content-${index}`, {
      width: '100%',
      height: '100%',
      borderStyle: 'none',
      backgroundColor: 'transparent',
      visible: index === 0
    });
    
    // Create a content panel text
    const contentPanelText = new TextRenderable(`${id}-content-${index}-text`, {
      content: `Content for ${tab}`,
      fg: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
      flexGrow: 1
    });
    
    // Build the component tree
    tabButton.add(tabButtonText);
    contentPanel.add(contentPanelText);
    
    tabBar.add(tabButton);
    contentArea.add(contentPanel);
    
    tabButtons.push(tabButton);
    contentPanels.push(contentPanel);
    
    // Handle tab button clicks
    tabButton.on('click', () => {
      // Update tab buttons
      tabButtons.forEach((button, i) => {
        button.borderStyle = i === index ? 'bottom-none' : 'single';
        button.borderColor = i === index ? '#3498db' : '#bbbbbb';
        button.backgroundColor = i === index ? '#222222' : 'transparent';
        button.children[0].fg = i === index ? '#ffffff' : '#bbbbbb';
      });
      
      // Update content panels
      contentPanels.forEach((panel, i) => {
        panel.visible = i === index;
      });
    });
  });
  
  // Build the main component tree
  container.add(tabBar);
  container.add(contentArea);
  
  return {
    container,
    tabButtons,
    contentPanels
  };
}

// Usage
const { container, tabButtons, contentPanels } = createTabbedInterface('my-tabs', ['Tab 1', 'Tab 2', 'Tab 3']);

// Add custom content to a tab
const customContent = new TextRenderable('custom-content', {
  content: 'This is custom content for Tab 2',
  fg: '#2ecc71',
  alignItems: 'center',
  justifyContent: 'center',
  flexGrow: 1
});

// Replace the default content
contentPanels[1].children = [];
contentPanels[1].add(customContent);
```
