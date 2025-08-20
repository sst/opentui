# React Reconciler

OpenTUI provides a React reconciler that allows you to build terminal user interfaces using React components and hooks.

## Overview

The React reconciler consists of:

1. **Reconciler**: The core React reconciler that bridges React and OpenTUI
2. **Host Config**: Configuration for the reconciler that defines how React components map to OpenTUI renderables
3. **Components**: Pre-built React components for common UI elements
4. **Hooks**: Custom React hooks for terminal-specific functionality

## Getting Started

To use React with OpenTUI, you need to install the React package:

```bash
npm install @opentui/react
# or
yarn add @opentui/react
# or
bun add @opentui/react
```

Then you can create a React application:

```tsx
import React from 'react';
import { render, Box, Text } from '@opentui/react';

function App() {
  return (
    <Box
      width="100%"
      height="100%"
      borderStyle="single"
      borderColor="#3498db"
      backgroundColor="#222222"
    >
      <Text
        content="Hello, OpenTUI with React!"
        fg="#ffffff"
        alignItems="center"
        justifyContent="center"
        flexGrow={1}
      />
    </Box>
  );
}

// Render the React application
render(<App />);
```

## Components

The React package provides components that map to OpenTUI renderables:

### Box Component

```tsx
import { Box } from '@opentui/react';

function MyComponent() {
  return (
    <Box
      width={40}
      height={10}
      borderStyle="single"
      borderColor="#3498db"
      backgroundColor="#222222"
      padding={1}
    >
      {/* Children go here */}
    </Box>
  );
}
```

### Text Component

```tsx
import { Text } from '@opentui/react';

function MyComponent() {
  return (
    <Text
      content="Hello, world!"
      fg="#ffffff"
      bg="transparent"
      bold={true}
      italic={false}
      underline={false}
    />
  );
}
```

### Input Component

```tsx
import { Input } from '@opentui/react';
import { useState } from 'react';

function MyComponent() {
  const [value, setValue] = useState('');
  
  return (
    <Input
      value={value}
      onChange={setValue}
      placeholder="Enter text..."
      fg="#ffffff"
      bg="#333333"
      width={30}
    />
  );
}
```

### Select Component

```tsx
import { Select } from '@opentui/react';
import { useState } from 'react';

function MyComponent() {
  const [value, setValue] = useState('option1');
  
  return (
    <Select
      value={value}
      onChange={setValue}
      options={[
        { value: 'option1', label: 'Option 1' },
        { value: 'option2', label: 'Option 2' },
        { value: 'option3', label: 'Option 3' }
      ]}
      fg="#ffffff"
      bg="#333333"
      width={30}
    />
  );
}
```

### TabSelect Component

```tsx
import { TabSelect, Box } from '@opentui/react';
import { useState } from 'react';

function MyComponent() {
  const [activeTab, setActiveTab] = useState('tab1');
  
  return (
    <>
      <TabSelect
        activeTab={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: 'tab1', label: 'Tab 1' },
          { id: 'tab2', label: 'Tab 2' },
          { id: 'tab3', label: 'Tab 3' }
        ]}
        fg="#ffffff"
        activeFg="#ffffff"
        activeBg="#3498db"
      />
      
      <Box padding={1}>
        {activeTab === 'tab1' && <Box>Content for Tab 1</Box>}
        {activeTab === 'tab2' && <Box>Content for Tab 2</Box>}
        {activeTab === 'tab3' && <Box>Content for Tab 3</Box>}
      </Box>
    </>
  );
}
```

### FrameBuffer Component

```tsx
import { FrameBuffer } from '@opentui/react';
import { useEffect, useRef } from 'react';

function MyComponent() {
  const fbRef = useRef(null);
  
  useEffect(() => {
    if (fbRef.current) {
      const ctx = fbRef.current.getContext();
      
      // Draw something
      ctx.setChar(0, 0, 'H', { fg: '#ffffff', bg: 'transparent' });
      ctx.setChar(1, 0, 'i', { fg: '#ffffff', bg: 'transparent' });
      
      // Commit the changes
      fbRef.current.commit();
    }
  }, []);
  
  return (
    <FrameBuffer
      ref={fbRef}
      width={40}
      height={10}
    />
  );
}
```

## Hooks

The React package provides custom hooks for terminal-specific functionality:

### useKeyboard

```tsx
import { useKeyboard } from '@opentui/react';

function MyComponent() {
  useKeyboard((key) => {
    console.log('Key pressed:', key);
    
    if (key.ctrl && key.name === 'c') {
      console.log('Ctrl+C pressed');
    }
  });
  
  return <Box>Press any key</Box>;
}
```

### useResize

```tsx
import { useResize } from '@opentui/react';
import { useState } from 'react';

function MyComponent() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  
  useResize((width, height) => {
    setSize({ width, height });
  });
  
  return (
    <Box>
      Terminal size: {size.width}x{size.height}
    </Box>
  );
}
```

### useApp

```tsx
import { useApp } from '@opentui/react';

function MyComponent() {
  const app = useApp();
  
  const handleClick = () => {
    // Access the underlying renderer
    app.renderer.toggleDebug();
  };
  
  return (
    <Box onClick={handleClick}>
      Toggle Debug
    </Box>
  );
}
```

## Creating Custom Components

You can create custom components that use OpenTUI renderables:

```tsx
import React, { forwardRef } from 'react';
import { Box, Text } from '@opentui/react';

interface ButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  width?: number | string;
  height?: number | string;
  fg?: string;
  bg?: string;
}

const Button = forwardRef<any, ButtonProps>(({
  label,
  onClick,
  disabled = false,
  width = 'auto',
  height = 3,
  fg = '#ffffff',
  bg = '#3498db'
}, ref) => {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick();
    }
  };
  
  return (
    <Box
      ref={ref}
      width={width}
      height={height}
      borderStyle="single"
      borderColor={disabled ? '#777777' : '#3498db'}
      backgroundColor={disabled ? '#555555' : bg}
      onClick={handleClick}
      alignItems="center"
      justifyContent="center"
    >
      <Text
        content={label}
        fg={disabled ? '#777777' : fg}
      />
    </Box>
  );
});

// Usage
function MyComponent() {
  return (
    <Button
      label="Click Me"
      onClick={() => console.log('Button clicked')}
      width={20}
    />
  );
}
```

## Event Handling

You can handle events in React components:

```tsx
import { Box } from '@opentui/react';

function MyComponent() {
  const handleClick = (event) => {
    console.log('Clicked at:', event.x, event.y);
  };
  
  const handleMouseOver = () => {
    console.log('Mouse over');
  };
  
  const handleMouseOut = () => {
    console.log('Mouse out');
  };
  
  return (
    <Box
      width={20}
      height={5}
      borderStyle="single"
      borderColor="#3498db"
      backgroundColor="#222222"
      onClick={handleClick}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
    >
      Click me
    </Box>
  );
}
```

## Styling Components

You can style components using props:

```tsx
import { Box, Text } from '@opentui/react';

function MyComponent() {
  return (
    <Box
      width="100%"
      height="100%"
      borderStyle="single"
      borderColor="#3498db"
      backgroundColor="#222222"
      padding={1}
      flexDirection="column"
      gap={1}
    >
      <Text
        content="Title"
        fg="#ffffff"
        bold={true}
        underline={true}
      />
      
      <Box
        width="100%"
        height={1}
        borderStyle="single"
        borderColor="#777777"
      />
      
      <Text
        content="Content goes here"
        fg="#cccccc"
      />
    </Box>
  );
}
```

## Flexbox Layout

OpenTUI supports Flexbox layout, which you can use in React components:

```tsx
import { Box, Text } from '@opentui/react';

function MyComponent() {
  return (
    <Box
      width="100%"
      height="100%"
      borderStyle="single"
      borderColor="#3498db"
      backgroundColor="#222222"
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
    >
      <Box
        width="30%"
        height="100%"
        borderStyle="single"
        borderColor="#e74c3c"
        padding={1}
      >
        <Text content="Left Panel" />
      </Box>
      
      <Box
        width="68%"
        height="100%"
        borderStyle="single"
        borderColor="#2ecc71"
        padding={1}
      >
        <Text content="Right Panel" />
      </Box>
    </Box>
  );
}
```

## Example: Creating a Todo App

```tsx
import React, { useState } from 'react';
import { render, Box, Text, Input } from '@opentui/react';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

function TodoApp() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');
  
  const addTodo = () => {
    if (input.trim()) {
      setTodos([...todos, {
        id: Date.now(),
        text: input.trim(),
        completed: false
      }]);
      setInput('');
    }
  };
  
  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };
  
  const handleKeyPress = (key: any) => {
    if (key.name === 'return') {
      addTodo();
    }
  };
  
  return (
    <Box
      width="100%"
      height="100%"
      borderStyle="single"
      borderColor="#3498db"
      backgroundColor="#222222"
      flexDirection="column"
      padding={1}
    >
      <Text
        content="Todo App"
        fg="#ffffff"
        bold={true}
        underline={true}
        marginBottom={1}
      />
      
      <Box
        width="100%"
        height={3}
        flexDirection="row"
        marginBottom={1}
      >
        <Input
          value={input}
          onChange={setInput}
          onKeyPress={handleKeyPress}
          placeholder="Add a todo..."
          fg="#ffffff"
          bg="#333333"
          width="80%"
          height={1}
        />
        
        <Box
          width="18%"
          height={3}
          marginLeft={1}
          borderStyle="single"
          borderColor="#2ecc71"
          backgroundColor="#27ae60"
          alignItems="center"
          justifyContent="center"
          onClick={addTodo}
        >
          <Text content="Add" fg="#ffffff" />
        </Box>
      </Box>
      
      <Box
        width="100%"
        flexGrow={1}
        borderStyle="single"
        borderColor="#777777"
        backgroundColor="#333333"
        flexDirection="column"
        padding={1}
        overflowY="auto"
      >
        {todos.length === 0 ? (
          <Text content="No todos yet. Add one above!" fg="#777777" />
        ) : (
          todos.map((todo, index) => (
            <Box
              key={todo.id}
              width="100%"
              height={3}
              borderStyle="single"
              borderColor={todo.completed ? '#2ecc71' : '#e74c3c'}
              backgroundColor={todo.completed ? '#27ae60' : 'transparent'}
              marginBottom={index < todos.length - 1 ? 1 : 0}
              flexDirection="row"
              alignItems="center"
              padding={1}
              onClick={() => toggleTodo(todo.id)}
            >
              <Text
                content={`[${todo.completed ? 'x' : ' '}]`}
                fg={todo.completed ? '#ffffff' : '#e74c3c'}
                marginRight={1}
              />
              <Text
                content={todo.text}
                fg="#ffffff"
                strikethrough={todo.completed}
              />
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

// Render the Todo app
render(<TodoApp />);
```
