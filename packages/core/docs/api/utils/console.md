# Console Utility

OpenTUI provides a console utility for debugging and logging in terminal applications.

## Overview

The console utility allows you to create a console window within your terminal application for displaying logs, errors, and debug information without interfering with your main UI.

## Console API

### Creating a Console

```typescript
import { TerminalConsole, ConsolePosition } from '@opentui/core';
import { createCliRenderer } from '@opentui/core';

// Create a renderer
const renderer = await createCliRenderer();

// Create a console with default options
const console = new TerminalConsole(renderer);

// Create a console with custom options
const customConsole = new TerminalConsole(renderer, {
  position: ConsolePosition.BOTTOM,
  sizePercent: 30,
  zIndex: 100,
  colorInfo: '#00FFFF',
  colorWarn: '#FFFF00',
  colorError: '#FF0000',
  colorDebug: '#808080',
  colorDefault: '#FFFFFF',
  backgroundColor: 'rgba(0.1, 0.1, 0.1, 0.7)',
  startInDebugMode: false,
  title: 'Debug Console',
  titleBarColor: 'rgba(0.05, 0.05, 0.05, 0.7)',
  titleBarTextColor: '#FFFFFF',
  cursorColor: '#00A0FF',
  maxStoredLogs: 2000,
  maxDisplayLines: 3000
});
```

### Console Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `position` | `ConsolePosition` | `ConsolePosition.BOTTOM` | Position of the console window |
| `sizePercent` | `number` | `30` | Size percentage of the console relative to terminal |
| `zIndex` | `number` | `Infinity` | Z-index of the console |
| `colorInfo` | `ColorInput` | `'#00FFFF'` | Color for info messages |
| `colorWarn` | `ColorInput` | `'#FFFF00'` | Color for warning messages |
| `colorError` | `ColorInput` | `'#FF0000'` | Color for error messages |
| `colorDebug` | `ColorInput` | `'#808080'` | Color for debug messages |
| `colorDefault` | `ColorInput` | `'#FFFFFF'` | Default text color |
| `backgroundColor` | `ColorInput` | `RGBA.fromValues(0.1, 0.1, 0.1, 0.7)` | Background color |
| `startInDebugMode` | `boolean` | `false` | Whether to start in debug mode |
| `title` | `string` | `'Console'` | Title of the console window |
| `titleBarColor` | `ColorInput` | `RGBA.fromValues(0.05, 0.05, 0.05, 0.7)` | Title bar color |
| `titleBarTextColor` | `ColorInput` | `'#FFFFFF'` | Title bar text color |
| `cursorColor` | `ColorInput` | `'#00A0FF'` | Cursor color |
| `maxStoredLogs` | `number` | `2000` | Maximum number of logs to store |
| `maxDisplayLines` | `number` | `3000` | Maximum number of lines to display |

### Logging Messages

```typescript
// The TerminalConsole captures standard console methods
// These will be displayed in the terminal console
console.log('Hello, world!');
console.error('Something went wrong');
console.warn('This is a warning');
console.info('This is an informational message');
console.debug('This is a debug message');

// Log an object
console.log({ name: 'John', age: 30 });

// Log with formatting
console.log('User %s logged in at %s', 'John', new Date().toISOString());

// Activate console capture
terminalConsole.activate();

// Deactivate console capture
terminalConsole.deactivate();
```

### Clearing the Console

```typescript
// Clear the console
terminalConsoleCache.clearConsole();
```

### Showing and Hiding the Console

```typescript
// Show the console
terminalConsole.show();

// Hide the console
terminalConsole.hide();

// Toggle the console visibility
// Not directly available, but can be implemented:
if (terminalConsole.isVisible) {
  terminalConsole.hide();
} else {
  terminalConsole.show();
}

// Check if the console is visible
const isVisible = terminalConsole.isVisible;
```

### Resizing the Console

```typescript
// Resize the console
console.resize(100, 30);

// Get the console dimensions
const { width, height } = console.getDimensions();
```

### Scrolling the Console

```typescript
// Scroll to the top
console.scrollToTop();

// Scroll to the bottom
console.scrollToBottom();

// Scroll up by a number of lines
console.scrollUp(5);

// Scroll down by a number of lines
console.scrollDown(5);

// Scroll to a specific line
console.scrollToLine(42);
```

### Filtering Console Output

```typescript
// Set a filter function
console.setFilter((message) => {
  // Only show messages containing 'error'
  return message.text.includes('error');
});

// Clear the filter
console.clearFilter();
```

### Capturing Standard Output

```typescript
// Capture stdout and stderr
console.captureStdout();
console.captureStderr();

// Stop capturing
console.releaseStdout();
console.releaseStderr();
```

## Example: Creating a Debug Console

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, Console } from '@opentui/core';

async function createDebugConsoleDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container for the main UI
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '70%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Add some content to the main UI
  const text = new TextRenderable('text', {
    content: 'Press F12 to toggle the debug console\nPress L to log a message\nPress E to log an error\nPress W to log a warning\nPress C to clear the console',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  container.add(text);
  
  // Create a debug console
  const debugConsole = new Console({
    width: renderer.width,
    height: Math.floor(renderer.height * 0.3),
    title: 'Debug Console',
    position: 'bottom',
    borderStyle: 'double',
    borderColor: '#e74c3c',
    backgroundColor: '#222222',
    fg: '#ffffff'
  });
  
  // Add the console to the renderer
  root.add(debugConsole);
  
  // Hide the console initially
  debugConsole.hide();
  
  // Log some initial messages
  debugConsole.log('Debug console initialized');
  debugConsole.info('Press F12 to toggle the console');
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'f12') {
      debugConsole.toggle();
    } else if (keyStr === 'l') {
      debugConsole.log(`Log message at ${new Date().toISOString()}`);
    } else if (keyStr === 'e') {
      debugConsole.error(`Error message at ${new Date().toISOString()}`);
    } else if (keyStr === 'w') {
      debugConsole.warn(`Warning message at ${new Date().toISOString()}`);
    } else if (keyStr === 'c') {
      debugConsole.clear();
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the debug console demo
createDebugConsoleDemo().catch(console.error);
```

## Example: Capturing Standard Output

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, Console } from '@opentui/core';

async function createStdoutCaptureDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container for the main UI
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '70%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Add some content to the main UI
  const text = new TextRenderable('text', {
    content: 'Press F12 to toggle the console\nPress L to log to stdout\nPress E to log to stderr\nPress C to clear the console',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  container.add(text);
  
  // Create a debug console
  const debugConsole = new Console({
    width: renderer.width,
    height: Math.floor(renderer.height * 0.3),
    title: 'Stdout/Stderr Capture',
    position: 'bottom',
    borderStyle: 'double',
    borderColor: '#e74c3c',
    backgroundColor: '#222222',
    fg: '#ffffff'
  });
  
  // Add the console to the renderer
  root.add(debugConsole);
  
  // Hide the console initially
  debugConsole.hide();
  
  // Capture stdout and stderr
  debugConsole.captureStdout();
  debugConsole.captureStderr();
  
  // Log some initial messages
  debugConsole.log('Stdout/stderr capture initialized');
  debugConsole.info('Press F12 to toggle the console');
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'f12') {
      debugConsole.toggle();
    } else if (keyStr === 'l') {
      // This will be captured by the console
      console.log(`Stdout message at ${new Date().toISOString()}`);
    } else if (keyStr === 'e') {
      // This will be captured by the console
      console.error(`Stderr message at ${new Date().toISOString()}`);
    } else if (keyStr === 'c') {
      debugConsole.clear();
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      // Release stdout and stderr before exiting
      debugConsole.releaseStdout();
      debugConsole.releaseStderr();
      
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the stdout capture demo
createStdoutCaptureDemo().catch(console.error);
```

## Example: Creating a Network Monitor

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, Console } from '@opentui/core';
import * as http from 'http';

async function createNetworkMonitorDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container for the main UI
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '70%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Add some content to the main UI
  const text = new TextRenderable('text', {
    content: 'Network Monitor\n\nPress F12 to toggle the console\nPress R to make a request\nPress C to clear the console',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  container.add(text);
  
  // Create a network monitor console
  const networkConsole = new Console({
    width: renderer.width,
    height: Math.floor(renderer.height * 0.3),
    title: 'Network Monitor',
    position: 'bottom',
    borderStyle: 'double',
    borderColor: '#9b59b6',
    backgroundColor: '#222222',
    fg: '#ffffff'
  });
  
  // Add the console to the renderer
  root.add(networkConsole);
  
  // Hide the console initially
  networkConsole.hide();
  
  // Log some initial messages
  networkConsole.log('Network monitor initialized');
  networkConsole.info('Press F12 to toggle the console');
  
  // Function to make a request
  function makeRequest() {
    const startTime = Date.now();
    networkConsole.log(`Making request to example.com...`, '#3498db');
    
    http.get('http://example.com', (res) => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      networkConsole.log(`Response received in ${duration}ms`, '#2ecc71');
      networkConsole.log(`Status: ${res.statusCode} ${res.statusMessage}`, '#2ecc71');
      
      // Log headers
      networkConsole.log('Headers:', '#f39c12');
      for (const [key, value] of Object.entries(res.headers)) {
        networkConsole.log(`  ${key}: ${value}`, '#f39c12');
      }
      
      // Collect response body
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        networkConsole.log(`Body length: ${body.length} bytes`, '#2ecc71');
        
        // Show a preview of the body
        if (body.length > 0) {
          networkConsole.log('Body preview:', '#f39c12');
          networkConsole.log(body.substring(0, 200) + (body.length > 200 ? '...' : ''), '#f39c12');
        }
      });
    }).on('error', (err) => {
      networkConsole.error(`Request failed: ${err.message}`);
    });
  }
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'f12') {
      networkConsole.toggle();
    } else if (keyStr === 'r') {
      makeRequest();
    } else if (keyStr === 'c') {
      networkConsole.clear();
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the network monitor demo
createNetworkMonitorDemo().catch(console.error);
```
