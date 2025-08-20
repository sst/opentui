# Output Capture

OpenTUI provides utilities for capturing stdout and stderr output, allowing you to redirect console output to your terminal UI.

## Overview

The output capture utilities allow you to intercept standard output and error streams and redirect them to your OpenTUI application. This is useful for creating debug consoles, log viewers, and other tools that need to display output from other parts of your application.

## Output Capture API

### Capturing Stdout and Stderr

```typescript
import { capture, CapturedWritableStream } from '@opentui/core';

// Create captured writable streams
const mockStdout = new CapturedWritableStream("stdout", capture);
const mockStderr = new CapturedWritableStream("stderr", capture);

// Listen for captured output
capture.on('write', (stream, data) => {
  console.log(`Captured ${stream}:`, data);
});

// Write to the streams
mockStdout.write('Hello from stdout');
mockStderr.write('Error from stderr');

// Get all captured output
const allOutput = capture.claimOutput();
```

### Capture API

The `Capture` class provides methods for capturing and managing output:

```typescript
import { Capture } from '@opentui/core';

// Create a capture instance
const capture = new Capture();

// Listen for write events
capture.on('write', (stream, data) => {
  console.log(`Captured ${stream}:`, data);
});

// Write data to the capture
capture.write('stdout', 'Hello world');

// Get the size of captured data
const size = capture.size;

// Get all captured output and clear the buffer
const output = capture.claimOutput();
```

### CapturedWritableStream API

The `CapturedWritableStream` class implements Node's Writable stream interface:

```typescript
import { Capture, CapturedWritableStream } from '@opentui/core';

// Create a capture instance
const capture = new Capture();

// Create writable streams
const stdout = new CapturedWritableStream('stdout', capture);
const stderr = new CapturedWritableStream('stderr', capture);

// Write to the streams
stdout.write('Standard output');
stderr.write('Standard error');
```

## Example: Creating a Log Viewer

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, captureStdout, captureStderr } from '@opentui/core';

async function createLogViewerDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container for the main UI
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '40%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Add some content to the main UI
  const text = new TextRenderable('text', {
    content: 'Log Viewer\n\nPress L to log to stdout\nPress E to log to stderr\nPress Q to quit',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  container.add(text);
  
  // Create a log viewer for stdout
  const stdoutViewer = new BoxRenderable('stdout-viewer', {
    width: '100%',
    height: '30%',
    borderStyle: 'single',
    borderColor: '#2ecc71',
    backgroundColor: '#222222',
    title: 'Stdout',
    padding: 1,
    y: '40%'
  });
  
  const stdoutText = new TextRenderable('stdout-text', {
    content: '',
    fg: '#ffffff',
    flexGrow: 1
  });
  
  stdoutViewer.add(stdoutText);
  root.add(stdoutViewer);
  
  // Create a log viewer for stderr
  const stderrViewer = new BoxRenderable('stderr-viewer', {
    width: '100%',
    height: '30%',
    borderStyle: 'single',
    borderColor: '#e74c3c',
    backgroundColor: '#222222',
    title: 'Stderr',
    padding: 1,
    y: '70%'
  });
  
  const stderrText = new TextRenderable('stderr-text', {
    content: '',
    fg: '#ffffff',
    flexGrow: 1
  });
  
  stderrViewer.add(stderrText);
  root.add(stderrViewer);
  
  // Capture stdout
  const stdoutRelease = captureStdout((data) => {
    // Append the data to the stdout text
    stdoutText.content += data;
    
    // Trim the content if it gets too long
    if (stdoutText.content.length > 1000) {
      stdoutText.content = stdoutText.content.substring(stdoutText.content.length - 1000);
    }
  }, {
    passthrough: true
  });
  
  // Capture stderr
  const stderrRelease = captureStderr((data) => {
    // Append the data to the stderr text
    stderrText.content += data;
    
    // Trim the content if it gets too long
    if (stderrText.content.length > 1000) {
      stderrText.content = stderrText.content.substring(stderrText.content.length - 1000);
    }
  }, {
    passthrough: true
  });
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'l') {
      // Log to stdout
      console.log(`Stdout message at ${new Date().toISOString()}`);
    } else if (keyStr === 'e') {
      // Log to stderr
      console.error(`Stderr message at ${new Date().toISOString()}`);
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      // Release stdout and stderr before exiting
      stdoutRelease();
      stderrRelease();
      
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the log viewer demo
createLogViewerDemo().catch(console.error);
```

## Example: Capturing Child Process Output

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, captureStdout, captureStderr } from '@opentui/core';
import { spawn } from 'child_process';

async function createProcessMonitorDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container for the main UI
  const container = new BoxRenderable('container', {
    width: '100%',
    height: '40%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222'
  });
  
  root.add(container);
  
  // Add some content to the main UI
  const text = new TextRenderable('text', {
    content: 'Process Monitor\n\nPress R to run a process\nPress C to clear the output\nPress Q to quit',
    fg: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1
  });
  
  container.add(text);
  
  // Create a process output viewer
  const outputViewer = new BoxRenderable('output-viewer', {
    width: '100%',
    height: '60%',
    borderStyle: 'single',
    borderColor: '#9b59b6',
    backgroundColor: '#222222',
    title: 'Process Output',
    padding: 1,
    y: '40%'
  });
  
  const outputText = new TextRenderable('output-text', {
    content: '',
    fg: '#ffffff',
    flexGrow: 1
  });
  
  outputViewer.add(outputText);
  root.add(outputViewer);
  
  // Function to run a process
  function runProcess() {
    // Clear the output
    outputText.content = '';
    
    // Add a header
    outputText.content = `Running 'ls -la' at ${new Date().toISOString()}\n\n`;
    
    // Spawn a process
    const process = spawn('ls', ['-la']);
    
    // Capture stdout
    process.stdout.on('data', (data) => {
      outputText.content += `[stdout] ${data}`;
    });
    
    // Capture stderr
    process.stderr.on('data', (data) => {
      outputText.content += `[stderr] ${data}`;
    });
    
    // Handle process exit
    process.on('close', (code) => {
      outputText.content += `\nProcess exited with code ${code}\n`;
    });
  }
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === 'r') {
      runProcess();
    } else if (keyStr === 'c') {
      outputText.content = '';
    } else if (keyStr === 'q' || keyStr === '\u0003') { // q or Ctrl+C
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the process monitor demo
createProcessMonitorDemo().catch(console.error);
```

## Example: Creating a REPL

```typescript
import { createCliRenderer, BoxRenderable, TextRenderable, InputRenderable, captureStdout, captureStderr } from '@opentui/core';
import { runInNewContext } from 'vm';

async function createReplDemo() {
  // Create the renderer
  const renderer = await createCliRenderer();
  const { root } = renderer;
  
  // Create a container for the output
  const outputContainer = new BoxRenderable('output-container', {
    width: '100%',
    height: '90%',
    borderStyle: 'single',
    borderColor: '#3498db',
    backgroundColor: '#222222',
    title: 'Output',
    padding: 1
  });
  
  const outputText = new TextRenderable('output-text', {
    content: 'JavaScript REPL\nType JavaScript code and press Enter to execute\n\n',
    fg: '#ffffff',
    flexGrow: 1
  });
  
  outputContainer.add(outputText);
  root.add(outputContainer);
  
  // Create an input field
  const inputContainer = new BoxRenderable('input-container', {
    width: '100%',
    height: '10%',
    borderStyle: 'single',
    borderColor: '#2ecc71',
    backgroundColor: '#222222',
    title: 'Input',
    padding: 1,
    y: '90%'
  });
  
  const inputField = new InputRenderable('input-field', {
    placeholder: 'Enter JavaScript code...',
    fg: '#ffffff',
    flexGrow: 1
  });
  
  inputContainer.add(inputField);
  root.add(inputContainer);
  
  // Focus the input field
  inputField.focus();
  
  // Create a context for the REPL
  const context = {
    console: {
      log: (...args) => {
        outputText.content += args.map(arg => String(arg)).join(' ') + '\n';
      },
      error: (...args) => {
        outputText.content += '\x1b[31m' + args.map(arg => String(arg)).join(' ') + '\x1b[0m\n';
      },
      warn: (...args) => {
        outputText.content += '\x1b[33m' + args.map(arg => String(arg)).join(' ') + '\x1b[0m\n';
      },
      info: (...args) => {
        outputText.content += '\x1b[36m' + args.map(arg => String(arg)).join(' ') + '\x1b[0m\n';
      }
    }
  };
  
  // Handle input submission
  inputField.on('submit', (value) => {
    // Add the input to the output
    outputText.content += `> ${value}\n`;
    
    // Clear the input field
    inputField.setValue('');
    
    // Execute the code
    try {
      const result = runInNewContext(value, context);
      
      // Display the result
      if (result !== undefined) {
        outputText.content += `${result}\n`;
      }
    } catch (error) {
      // Display the error
      outputText.content += `\x1b[31mError: ${error.message}\x1b[0m\n`;
    }
    
    // Add a blank line
    outputText.content += '\n';
  });
  
  // Handle keyboard input
  renderer.on('key', (key) => {
    const keyStr = key.toString();
    
    if (keyStr === '\u0003') { // Ctrl+C
      renderer.destroy();
      process.exit(0);
    }
  });
  
  // Start the renderer
  renderer.start();
  
  return renderer;
}

// Create and run the REPL demo
createReplDemo().catch(console.error);
```
