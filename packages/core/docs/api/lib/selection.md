# Text Selection System

OpenTUI provides a comprehensive text selection system that allows users to select and copy text from the terminal interface.

## Overview

The text selection system consists of three main classes:

1. **Selection**: Manages the global selection state with anchor and focus points
2. **TextSelectionHelper**: Handles text selection for standard text components
3. **ASCIIFontSelectionHelper**: Handles text selection for ASCII font components

## Selection API

The `Selection` class represents a selection area in the terminal with anchor and focus points.

```typescript
import { Selection } from '@opentui/core';

// Create a selection with anchor and focus points
const selection = new Selection(
  { x: 10, y: 5 },  // anchor point
  { x: 20, y: 5 }   // focus point
);

// Get the anchor point
const anchor = selection.anchor;

// Get the focus point
const focus = selection.focus;

// Get the selection bounds
const bounds = selection.bounds;
// bounds = { startX: 10, startY: 5, endX: 20, endY: 5 }

// Update the selected renderables
selection.updateSelectedRenderables(selectedComponents);

// Get the selected text
const text = selection.getSelectedText();
```

## TextSelectionHelper API

The `TextSelectionHelper` class helps text components handle selection.

```typescript
import { TextSelectionHelper, SelectionState } from '@opentui/core';

class MyTextComponent extends Renderable {
  private selectionHelper: TextSelectionHelper;
  
  constructor(id: string, options = {}) {
    super(id, options);
    
    // Create a selection helper
    this.selectionHelper = new TextSelectionHelper(
      () => this.x,                // Get component X position
      () => this.y,                // Get component Y position
      () => this.content.length,   // Get text length
      () => ({                     // Get line information for multi-line text
        lineStarts: this.lineStarts,
        lineWidths: this.lineWidths
      })
    );
  }
  
  // Check if the component should start a selection
  shouldStartSelection(x: number, y: number): boolean {
    return this.selectionHelper.shouldStartSelection(x, y, this.width, this.height);
  }
  
  // Handle selection changes
  onSelectionChanged(selection: SelectionState | null): void {
    if (this.selectionHelper.onSelectionChanged(selection, this.width, this.height)) {
      this.needsRedraw = true;
    }
  }
  
  // Check if the component has a selection
  hasSelection(): boolean {
    return this.selectionHelper.hasSelection();
  }
  
  // Get the current selection
  getSelection(): { start: number; end: number } | null {
    return this.selectionHelper.getSelection();
  }
  
  // Get the selected text
  getSelectedText(): string {
    const selection = this.selectionHelper.getSelection();
    if (!selection) return '';
    return this.content.substring(selection.start, selection.end);
  }
  
  // Reevaluate selection after component changes
  reevaluateSelection(): void {
    if (this.selectionHelper.reevaluateSelection(this.width, this.height)) {
      this.needsRedraw = true;
    }
  }
}
```

## ASCIIFontSelectionHelper API

The `ASCIIFontSelectionHelper` class helps ASCII font components handle selection.

```typescript
import { ASCIIFontSelectionHelper, SelectionState } from '@opentui/core';

class MyASCIIFontComponent extends Renderable {
  private selectionHelper: ASCIIFontSelectionHelper;
  
  constructor(id: string, options = {}) {
    super(id, options);
    
    // Create a selection helper
    this.selectionHelper = new ASCIIFontSelectionHelper(
      () => this.x,                // Get component X position
      () => this.y,                // Get component Y position
      () => this.content,          // Get text content
      () => this.font              // Get font name
    );
  }
  
  // Check if the component should start a selection
  shouldStartSelection(x: number, y: number): boolean {
    return this.selectionHelper.shouldStartSelection(x, y, this.width, this.height);
  }
  
  // Handle selection changes
  onSelectionChanged(selection: SelectionState | null): void {
    if (this.selectionHelper.onSelectionChanged(selection, this.width, this.height)) {
      this.needsRedraw = true;
    }
  }
  
  // Check if the component has a selection
  hasSelection(): boolean {
    return this.selectionHelper.hasSelection();
  }
  
  // Get the current selection
  getSelection(): { start: number; end: number } | null {
    return this.selectionHelper.getSelection();
  }
  
  // Get the selected text
  getSelectedText(): string {
    const selection = this.selectionHelper.getSelection();
    if (!selection) return '';
    return this.content.substring(selection.start, selection.end);
  }
  
  // Reevaluate selection after component changes
  reevaluateSelection(): void {
    if (this.selectionHelper.reevaluateSelection(this.width, this.height)) {
      this.needsRedraw = true;
    }
  }
}
```

## Example: Implementing Text Selection

Here's a complete example of implementing text selection in a custom component:

```typescript
import { Renderable, TextSelectionHelper, SelectionState } from '@opentui/core';

class SelectableText extends Renderable {
  private content: string;
  private selectionHelper: TextSelectionHelper;
  private lineStarts: number[] = [];
  private lineWidths: number[] = [];
  
  constructor(id: string, options: { content: string, width: number, height: number }) {
    super(id, options);
    this.content = options.content;
    
    // Calculate line information
    this.calculateLineInfo();
    
    // Create selection helper
    this.selectionHelper = new TextSelectionHelper(
      () => this.x,
      () => this.y,
      () => this.content.length,
      () => ({ lineStarts: this.lineStarts, lineWidths: this.lineWidths })
    );
  }
  
  private calculateLineInfo(): void {
    this.lineStarts = [0];
    this.lineWidths = [];
    
    let currentLine = 0;
    let currentLineWidth = 0;
    
    for (let i = 0; i < this.content.length; i++) {
      if (this.content[i] === '\n') {
        this.lineWidths.push(currentLineWidth);
        this.lineStarts.push(i + 1);
        currentLine++;
        currentLineWidth = 0;
      } else {
        currentLineWidth++;
      }
    }
    
    // Add the last line
    this.lineWidths.push(currentLineWidth);
  }
  
  public render(context: RenderContext): void {
    // Render the text
    const selection = this.selectionHelper.getSelection();
    
    for (let i = 0; i < this.lineStarts.length; i++) {
      const lineStart = this.lineStarts[i];
      const lineEnd = i < this.lineStarts.length - 1 ? this.lineStarts[i + 1] - 1 : this.content.length;
      const line = this.content.substring(lineStart, lineEnd);
      
      for (let j = 0; j < line.length; j++) {
        const charIndex = lineStart + j;
        const isSelected = selection && charIndex >= selection.start && charIndex < selection.end;
        
        // Render character with selection highlighting if needed
        context.setChar(this.x + j, this.y + i, line[j], {
          fg: isSelected ? '#000000' : '#ffffff',
          bg: isSelected ? '#3498db' : 'transparent'
        });
      }
    }
  }
  
  public onMouseEvent(event: MouseEvent): void {
    if (event.type === 'down') {
      if (this.selectionHelper.shouldStartSelection(event.x, event.y, this.width, this.height)) {
        // Start selection
        this.renderer.startSelection(event.x, event.y);
        event.preventDefault();
      }
    }
  }
  
  public onSelectionChanged(selection: SelectionState | null): void {
    if (this.selectionHelper.onSelectionChanged(selection, this.width, this.height)) {
      this.needsRedraw = true;
    }
  }
  
  public getSelectedText(): string {
    const selection = this.selectionHelper.getSelection();
    if (!selection) return '';
    return this.content.substring(selection.start, selection.end);
  }
}
```

## Example: Copying Selected Text

```typescript
import { getKeyHandler } from '@opentui/core';
import * as clipboard from 'clipboard-polyfill';

// Set up keyboard shortcut for copying
const keyHandler = getKeyHandler();

keyHandler.on('keypress', (key) => {
  if (key.ctrl && key.name === 'c') {
    const selection = renderer.getSelection();
    if (selection) {
      const text = selection.getSelectedText();
      if (text) {
        clipboard.writeText(text);
        console.log('Copied to clipboard:', text);
      }
    }
  }
});
```
