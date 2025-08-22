# TrackedNode System

The TrackedNode system is a core part of OpenTUI's layout engine, providing a TypeScript wrapper around Yoga layout nodes with additional tracking and relationship management.

## Overview

The `TrackedNode` class wraps Yoga layout nodes and maintains parent-child relationships, handles percentage-based dimensions, and provides a metadata system for storing additional information.

## TrackedNode API

```typescript
import { TrackedNode, createTrackedNode } from '@opentui/core';

// Create a new tracked node
const node = createTrackedNode({
  id: 'my-node',
  type: 'box'
});

// Set dimensions
node.setWidth(100);
node.setHeight(50);

// Set percentage-based dimensions
node.setWidth('50%');
node.setHeight('25%');

// Set dimensions to auto
node.setWidth('auto');
node.setHeight('auto');
```

### Creating Nodes

The `createTrackedNode` function creates a new `TrackedNode` instance with an underlying Yoga node:

```typescript
import { createTrackedNode } from '@opentui/core';
import Yoga from 'yoga-layout';

// Create a node with metadata
const node = createTrackedNode({
  id: 'my-node',
  type: 'box'
});

// Create a node with metadata and custom Yoga config
const config = Yoga.Config.create();
const nodeWithConfig = createTrackedNode({
  id: 'custom-node',
  type: 'box'
}, config);
```

### Node Dimensions

The `TrackedNode` class provides methods for setting and parsing dimensions, including support for percentage-based dimensions:

```typescript
// Set fixed dimensions
node.setWidth(100);
node.setHeight(50);

// Set percentage-based dimensions (relative to parent)
node.setWidth('50%');
node.setHeight('25%');

// Set dimensions to auto (let Yoga determine the size)
node.setWidth('auto');
node.setHeight('auto');

// Parse dimensions (converts percentages to absolute values)
const parsedWidth = node.parseWidth('50%');
const parsedHeight = node.parseHeight('25%');
```

### Node Hierarchy

The `TrackedNode` class provides methods for managing the node hierarchy:

```typescript
// Add a child node
const childIndex = parentNode.addChild(childNode);

// Insert a child node at a specific index
const insertedIndex = parentNode.insertChild(childNode, 2);

// Remove a child node
const removed = parentNode.removeChild(childNode);

// Remove a child node at a specific index
const removedNode = parentNode.removeChildAtIndex(2);

// Move a child node to a new index
const newIndex = parentNode.moveChild(childNode, 3);

// Get the index of a child node
const index = parentNode.getChildIndex(childNode);

// Check if a node is a child of this node
const isChild = parentNode.hasChild(childNode);

// Get the number of children
const childCount = parentNode.getChildCount();

// Get a child node at a specific index
const child = parentNode.getChildAtIndex(2);
```

### Metadata

The `TrackedNode` class provides methods for managing metadata:

```typescript
// Set metadata
node.setMetadata('visible', true);

// Get metadata
const isVisible = node.getMetadata('visible');

// Remove metadata
node.removeMetadata('visible');
```

### Cleanup

The `TrackedNode` class provides a method for cleaning up resources:

```typescript
// Destroy the node and free resources
node.destroy();
```

## Example: Building a Layout Tree

```typescript
import { createTrackedNode } from '@opentui/core';

// Create a root node
const root = createTrackedNode({
  id: 'root',
  type: 'container'
});

// Set root dimensions
root.setWidth(800);
root.setHeight(600);

// Create a header node
const header = createTrackedNode({
  id: 'header',
  type: 'box'
});

// Set header dimensions
header.setWidth('100%');
header.setHeight(50);

// Create a content node
const content = createTrackedNode({
  id: 'content',
  type: 'box'
});

// Set content dimensions
content.setWidth('100%');
content.setHeight('auto');

// Create a footer node
const footer = createTrackedNode({
  id: 'footer',
  type: 'box'
});

// Set footer dimensions
footer.setWidth('100%');
footer.setHeight(50);

// Build the layout tree
root.addChild(header);
root.addChild(content);
root.addChild(footer);

// Add some content items
for (let i = 0; i < 3; i++) {
  const item = createTrackedNode({
    id: `item-${i}`,
    type: 'box'
  });
  
  item.setWidth('33%');
  item.setHeight(100);
  
  content.addChild(item);
}

// Later, clean up resources
root.destroy(); // This will also destroy all child nodes
```

## Integration with Yoga Layout

The `TrackedNode` system is built on top of the Yoga layout engine, which provides a flexible and powerful layout system based on Flexbox. The `TrackedNode` class wraps Yoga nodes and provides additional functionality for managing the node hierarchy and metadata.

When you set dimensions or add/remove children, the `TrackedNode` class updates the underlying Yoga node accordingly. When the layout is calculated, the Yoga engine determines the final positions and dimensions of all nodes based on the layout constraints.

```typescript
import { createTrackedNode } from '@opentui/core';

// Create a container with flexbox layout
const container = createTrackedNode({
  id: 'container',
  type: 'box'
});

container.setWidth(500);
container.setHeight(300);

// Configure flexbox properties on the Yoga node
container.yogaNode.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
container.yogaNode.setJustifyContent(Yoga.JUSTIFY_SPACE_BETWEEN);
container.yogaNode.setAlignItems(Yoga.ALIGN_CENTER);

// Add some flex items
for (let i = 0; i < 3; i++) {
  const item = createTrackedNode({
    id: `item-${i}`,
    type: 'box'
  });
  
  item.setWidth(100);
  item.setHeight(100);
  item.yogaNode.setMargin(Yoga.EDGE_ALL, 10);
  
  container.addChild(item);
}

// Calculate the layout
container.yogaNode.calculateLayout();

// Get the computed layout values
const width = container.yogaNode.getComputedWidth();
const height = container.yogaNode.getComputedHeight();
const x = container.yogaNode.getComputedLeft();
const y = container.yogaNode.getComputedTop();
```
