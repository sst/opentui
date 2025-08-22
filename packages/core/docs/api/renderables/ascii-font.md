# ASCII Font Renderer

OpenTUI provides an ASCII font renderer for creating stylized text using ASCII art fonts.

## Overview

The `ASCIIFontRenderable` component allows you to render text using ASCII art fonts, which are defined as JSON files. This is useful for creating headers, logos, and other stylized text elements in your terminal applications.

## ASCII Font API

### Creating an ASCII Font Renderable

```typescript
import { ASCIIFontRenderable } from '@opentui/core';

// Create an ASCII font renderable with the default font
const asciiText = new ASCIIFontRenderable('ascii-text', {
  content: 'Hello',
  fg: '#3498db',
  alignItems: 'center',
  justifyContent: 'center'
});

// Create an ASCII font renderable with a specific font
const customFont = new ASCIIFontRenderable('custom-font', {
  content: 'OpenTUI',
  font: 'block',  // Use the 'block' font
  fg: '#e74c3c',
  alignItems: 'center',
  justifyContent: 'center'
});
```

### ASCII Font Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `content` | `string` | `''` | The text to render |
| `font` | `string` | `'slick'` | The font to use (e.g., 'slick', 'block', 'tiny', 'shade') |
| `fg` | `string` | `'#ffffff'` | The foreground color |
| `bg` | `string` | `'transparent'` | The background color |
| `alignItems` | `string` | `'flex-start'` | Vertical alignment |
| `justifyContent` | `string` | `'flex-start'` | Horizontal alignment |
| `width` | `number \| string` | `'auto'` | Width of the component |
| `height` | `number \| string` | `'auto'` | Height of the component |

### Available Fonts

OpenTUI includes several built-in ASCII art fonts:

1. **Slick**: A sleek, minimalist font
2. **Block**: A bold, blocky font
3. **Tiny**: A small, compact font
4. **Shade**: A font with shading effects

```typescript
// Examples of different fonts
const slickFont = new ASCIIFontRenderable('slick-font', {
  content: 'Slick',
  font: 'slick',
  fg: '#3498db'
});

const blockFont = new ASCIIFontRenderable('block-font', {
  content: 'Block',
  font: 'block',
  fg: '#e74c3c'
});

const tinyFont = new ASCIIFontRenderable('tiny-font', {
  content: 'Tiny',
  font: 'tiny',
  fg: '#2ecc71'
});

const shadeFont = new ASCIIFontRenderable('shade-font', {
  content: 'Shade',
  font: 'shade',
  fg: '#f39c12'
});
```

### Changing the Content

```typescript
// Create an ASCII font renderable
const asciiText = new ASCIIFontRenderable('ascii-text', {
  content: 'Hello',
  font: 'block',
  fg: '#3498db'
});

// Change the content
asciiText.content = 'World';

// Change the font
asciiText.font = 'slick';

// Change the color
asciiText.fg = '#e74c3c';
```

### Creating Custom Fonts

You can create custom ASCII art fonts by defining them in JSON files:

```json
{
  "name": "MyCustomFont",
  "height": 5,
  "chars": {
    "A": [
      "  #  ",
      " # # ",
      "#####",
      "#   #",
      "#   #"
    ],
    "B": [
      "#### ",
      "#   #",
      "#### ",
      "#   #",
      "#### "
    ],
    // Define other characters...
  }
}
```

Then load and use the custom font:

```typescript
import { ASCIIFontRenderable, loadASCIIFont } from '@opentui/core';
import * as fs from 'fs';

// Load a custom font
const customFontData = JSON.parse(fs.readFileSync('path/to/custom-font.json', 'utf8'));
loadASCIIFont('custom-font', customFontData);

// Use the custom font
const customFont = new ASCIIFontRenderable('custom-font', {
  content: 'Custom',
  font: 'custom-font',
  fg: '#9b59b6'
});
```

## Example: Creating a Title Screen

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, ASCIIFontRenderable } from '@opentui/core';

async function createTitleScreenDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'double',
    borderColor: '#3498db',
    backgroundColor: '#222222',
    padding: 2
  });
  
  root.add(container);
  
  // Create a title using ASCII font
  const title = new ASCIIFontRenderable('title', {
    content: 'OpenTUI',
    font: 'block',
    fg: '#e74c3c',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '30%'
  });
  
  container.add(title);
  
  // Create a subtitle
  const subtitle = new TextRenderable('subtitle', {
    content: 'Terminal User Interface Framework',
    fg: '#3498db',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '10%'
  });
  
  container.add(subtitle);
  
  // Create menu options
  const menuContainer = new BoxRenderable('menu-container', {
    width: '50%',
    height: '40%',
    x: '25%',
    y: '50%',
    borderStyle: 'single',
    borderColor: '#2ecc71',
    backgroundColor: 'transparent',
    padding: 1
  });
  
  container.add(menuContainer);
  
  // Add menu items
  const menuItems = [
    'New Game',
    'Load Game',
    'Options',
    'Credits',
    'Exit'
  ];
  
  let selectedIndex = 0;
  
  const menuItemRenderables = menuItems.map((item, index) => {
    const menuItem = new TextRenderable(`menu-item-${index}`, {
      content: `${index === selectedIndex ? '> ' : '  '}${item}`,
      fg: index === selectedIndex ? '#ffffff' : '#bbbbbb',
      y: index * 2,
      width: '100%',
      height: 1
    });
    
    menuContainer.add(menuItem);
    
    return menuItem;
  });
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'up' || keyStr === 'k') {
      // Update the previously selected item
      menuItemRenderables[selectedIndex].content = `  ${menuItems[selectedIndex]}`;
      menuItemRenderables[selectedIndex].fg = '#bbbbbb';
      
      // Move selection up
      selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
      
      // Update the newly selected item
      menuItemRenderables[selectedIndex].content = `> ${menuItems[selectedIndex]}`;
      menuItemRenderables[selectedIndex].fg = '#ffffff';
    } else if (keyStr === 'down' || keyStr === 'j') {
      // Update the previously selected item
      menuItemRenderables[selectedIndex].content = `  ${menuItems[selectedIndex]}`;
      menuItemRenderables[selectedIndex].fg = '#bbbbbb';
      
      // Move selection down
      selectedIndex = (selectedIndex + 1) % menuItems.length;
      
      // Update the newly selected item
      menuItemRenderables[selectedIndex].content = `> ${menuItems[selectedIndex]}`;
      menuItemRenderables[selectedIndex].fg = '#ffffff';
    } else if (keyStr === 'return') {
      // Handle menu selection
      if (selectedIndex === menuItems.length - 1) {
        // Exit option
        renderer.destroy();
        process.exit(0);
      } else {
        // Show a message for other options
        title.content = menuItems[selectedIndex];
      }
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the title screen demo
createTitleScreenDemo().catch(console.error);
```

## Example: Creating a Banner

```typescript
import { createCliRenderer, BoxRenderable, ASCIIFontRenderable } from '@opentui/core';

async function createBannerDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'none',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Create a banner using ASCII font
  const banner = new ASCIIFontRenderable('banner', {
    content: 'WELCOME',
    font: 'block',
    fg: '#e74c3c',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '30%',
    y: '10%'
  });
  
  container.add(banner);
  
  // Create a second line
  const secondLine = new ASCIIFontRenderable('second-line', {
    content: 'TO',
    font: 'slick',
    fg: '#f39c12',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '20%',
    y: '40%'
  });
  
  container.add(secondLine);
  
  // Create a third line
  const thirdLine = new ASCIIFontRenderable('third-line', {
    content: 'OPENTUI',
    font: 'shade',
    fg: '#2ecc71',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '30%',
    y: '60%'
  });
  
  container.add(thirdLine);
  
  // Start the renderer
  renderer.start();
  
  // Animate the banner
  let frame = 0;
  const colors = [
    '#e74c3c', // Red
    '#e67e22', // Orange
    '#f1c40f', // Yellow
    '#2ecc71', // Green
    '#3498db', // Blue
    '#9b59b6'  // Purple
  ];
  
  const interval = setInterval(() => {
    frame = (frame + 1) % colors.length;
    
    banner.fg = colors[frame];
    secondLine.fg = colors[(frame + 2) % colors.length];
    thirdLine.fg = colors[(frame + 4) % colors.length];
  }, 500);
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      clearInterval(interval);
      renderer.destroy();
      process.exit(0);
    }
  });
  
  return renderer;
}

// Create and run the banner demo
createBannerDemo().catch(console.error);
```

## Example: Creating a Loading Screen

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, ASCIIFontRenderable } from '@opentui/core';

async function createLoadingScreenDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '100%',
    borderStyle: 'none',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Create a title using ASCII font
  const title = new ASCIIFontRenderable('title', {
    content: 'LOADING',
    font: 'block',
    fg: '#3498db',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '30%',
    y: '20%'
  });
  
  container.add(title);
  
  // Create a loading bar container
  const loadingBarContainer = new BoxRenderable('loading-bar-container', {
    width: '80%',
    height: 3,
    x: '10%',
    y: '60%',
    borderStyle: 'single',
    borderColor: '#ffffff',
    backgroundColor: 'transparent'
  });
  
  container.add(loadingBarContainer);
  
  // Create a loading bar
  const loadingBar = new BoxRenderable('loading-bar', {
    width: '0%',
    height: 1,
    x: 0,
    y: 1,
    borderStyle: 'none',
    backgroundColor: '#2ecc71'
  });
  
  loadingBarContainer.add(loadingBar);
  
  // Create a loading text
  const loadingText = new TextRenderable('loading-text', {
    content: 'Loading... 0%',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 1,
    y: '70%'
  });
  
  container.add(loadingText);
  
  // Start the renderer
  renderer.start();
  
  // Simulate loading
  let progress = 0;
  
  const interval = setInterval(() => {
    progress += 1;
    
    if (progress > 100) {
      clearInterval(interval);
      
      // Change the title
      title.content = 'COMPLETE';
      title.fg = '#2ecc71';
      
      // Update the loading text
      loadingText.content = 'Press any key to continue';
      
      return;
    }
    
    // Update the loading bar
    loadingBar.width = `${progress}%`;
    
    // Update the loading text
    loadingText.content = `Loading... ${progress}%`;
    
    // Change the title color based on progress
    if (progress < 30) {
      title.fg = '#3498db';
    } else if (progress < 60) {
      title.fg = '#f39c12';
    } else {
      title.fg = '#2ecc71';
    }
  }, 50);
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (progress >= 100 || keyStr === 'q' || keyStr === '\u0003') { // Any key after loading or q or Ctrl+C
      clearInterval(interval);
      renderer.destroy();
      process.exit(0);
    }
  });
  
  return renderer;
}

// Create and run the loading screen demo
createLoadingScreenDemo().catch(console.error);
```
