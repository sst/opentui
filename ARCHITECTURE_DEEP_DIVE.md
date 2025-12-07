# OpenTUI Architecture Deep Dive

## Table of Contents
1. [System Overview](#system-overview)
2. [Data Flow](#data-flow)
3. [Component Lifecycle](#component-lifecycle)
4. [Rendering Pipeline](#rendering-pipeline)
5. [Native/TypeScript Boundary](#nativetypescript-boundary)
6. [Input Processing](#input-processing)
7. [Layout Engine](#layout-engine)

## System Overview

### Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (User Code - React/Solid Components or Direct API)         │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                   Framework Reconciler                       │
│  (@opentui/react, @opentui/solid, @opentui/vue)            │
│  - Component tree diffing                                   │
│  - Props updates                                            │
│  - Event binding                                            │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│              Renderables API (TypeScript)                    │
│  - TextRenderable, Box, Input, Select, etc.                │
│  - VNode constructs (functional API)                        │
│  - Yoga layout calculations                                 │
│  - Tree-sitter syntax highlighting                          │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                  Core Renderer (TypeScript)                  │
│  - CliRenderer orchestration                                │
│  - Render loop management                                   │
│  - Console overlay                                          │
│  - Input event handling                                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                  ┌─────────┴─────────┐
                  │    FFI Bridge     │
                  └─────────┬─────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│              Native Layer (Zig)                              │
│  - Buffer management                                        │
│  - UTF-8/Grapheme processing                               │
│  - Rope data structures                                     │
│  - ANSI sequence generation                                 │
│  - Terminal I/O                                             │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                      Terminal                                │
│  (stdout/stdin with ANSI support)                           │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Render Cycle

```
User Update (setState, props change)
        │
        ▼
Reconciler Diff (React/Solid)
        │
        ▼
Renderable Update
        │
        ├─> Layout Calculation (Yoga)
        │        │
        │        ▼
        │   Position/Size Update
        │        │
        └────────┤
                 ▼
        Render Queue
                 │
                 ▼
        CliRenderer.render()
                 │
                 ├─> Traverse Renderable Tree
                 │   (z-index sorted)
                 │        │
                 │        ▼
                 │   For Each Renderable:
                 │   - Check viewport
                 │   - Render to buffer
                 │   - Apply styling
                 │        │
                 ├────────┘
                 ▼
        Diff Buffers (prev vs current)
                 │
                 ▼
        Generate ANSI Escape Sequences
                 │
                 ▼
        Write to stdout
                 │
                 ▼
        Terminal Display Update
```

### Input Flow

```
Terminal stdin
        │
        ▼
Raw bytes buffer
        │
        ▼
Escape sequence parser
        │
        ├─> Keyboard (KeyHandler)
        │   - Parse escape codes
        │   - Handle Kitty protocol
        │   - Emit keypress events
        │        │
        │        ▼
        │   Renderer.keyInput
        │        │
        │        ▼
        │   Active Renderable
        │   (focused input, etc.)
        │
        └─> Mouse (MouseHandler)
            - Parse mouse events
            - Calculate positions
            - Emit mouse events
                 │
                 ▼
            Interactive Renderables
            (buttons, scrollboxes)
```

## Component Lifecycle

### Renderable Lifecycle

```
1. Construction
   new TextRenderable(renderer, options)
   ├─> Create Yoga node
   ├─> Initialize properties
   └─> Register with renderer

2. Mounting
   parent.add(renderable)
   ├─> Add to parent's children
   ├─> Update layout tree
   └─> Mark dirty

3. Update
   renderable.setContent("new text")
   ├─> Update properties
   ├─> Mark dirty
   └─> Queue re-render

4. Layout
   Yoga calculation
   ├─> Calculate position
   ├─> Calculate size
   └─> Update transform

5. Render
   renderable.render()
   ├─> Draw to buffer
   ├─> Apply styles
   └─> Render children

6. Unmounting
   parent.remove(renderable)
   ├─> Remove from parent
   ├─> Free Yoga node
   └─> Cleanup resources
```

## Rendering Pipeline

### Buffer System

```
┌──────────────────────────┐
│   Viewport Buffer        │  ← Root framebuffer (terminal size)
│  (terminal dimensions)   │
└──────┬───────────────────┘
       │
       │ For each Renderable (z-index sorted):
       │
       ├──> ┌─────────────────────┐
       │    │ Renderable Buffer   │  ← Component's local buffer
       │    │ (component size)    │
       │    └──────┬──────────────┘
       │           │
       │           ├─> Render text/graphics
       │           ├─> Apply colors (RGBA)
       │           └─> Handle transparency
       │                   │
       │                   ▼
       │    ┌─────────────────────────┐
       │    │ Alpha Blending          │
       │    │ - Blend with parent     │
       │    │ - Respect opacity       │
       │    └──────┬──────────────────┘
       │           │
       └───────────┤
                   ▼
       ┌─────────────────────────┐
       │ Compose to Viewport     │
       │ - Apply clipping        │
       │ - Transform coords      │
       │ - Respect z-index       │
       └──────┬──────────────────┘
              │
              ▼
       ┌─────────────────────────┐
       │ Diff Detection          │
       │ - Compare cells         │
       │ - Track changes         │
       └──────┬──────────────────┘
              │
              ▼
       ┌─────────────────────────┐
       │ ANSI Generation         │
       │ - Cursor movement       │
       │ - Color codes           │
       │ - Character output      │
       └──────┬──────────────────┘
              │
              ▼
           stdout
```

### Double Buffering

```
Frame N:
┌─────────────┐     ┌─────────────┐
│ Previous    │     │ Current     │
│ Buffer      │ ──> │ Buffer      │
│ (displayed) │     │ (rendering) │
└─────────────┘     └─────────────┘
                          │
                          ▼
                    Diff calculation
                          │
                          ▼
                    Output changes
                          │
                          ▼
Frame N+1:
┌─────────────┐     ┌─────────────┐
│ Current     │     │ Previous    │
│ Buffer      │ <── │ Buffer      │
│ (displayed) │     │ (now prev)  │
└─────────────┘     └─────────────┘
        Swap buffers
```

## Native/TypeScript Boundary

### FFI Communication

```typescript
TypeScript Side:
┌─────────────────────────────────────┐
│ import { opentui } from "./zig"     │
│                                     │
│ opentui.buffer_create(width, height)│
│        │                            │
└────────┼────────────────────────────┘
         │
         │ FFI Call (via dlopen)
         │
         ▼
┌─────────────────────────────────────┐
│ Zig Side (lib.zig)                  │
│                                     │
│ export fn buffer_create(           │
│   width: u32,                       │
│   height: u32                       │
│ ) ?*Buffer {                        │
│   // Native implementation          │
│ }                                   │
└─────────────────────────────────────┘
```

### Data Structure Packing

```
TypeScript (bun-ffi-structs):
┌────────────────────────────┐
│ struct Cell {              │
│   codepoint: u32           │  ← 4 bytes
│   fg: RGBA (4 floats)      │  ← 16 bytes
│   bg: RGBA (4 floats)      │  ← 16 bytes
│   bold: bool               │  ← 1 byte
│   italic: bool             │  ← 1 byte
│   underline: bool          │  ← 1 byte
│   // + padding             │
│ }                          │
└────────────────────────────┘
         │
         │ Memory layout matches
         ▼
Zig:
┌────────────────────────────┐
│ pub const Cell = struct {  │
│   codepoint: u32,          │
│   fg: RGBA,                │
│   bg: RGBA,                │
│   bold: bool,              │
│   italic: bool,            │
│   underline: bool,         │
│ };                         │
└────────────────────────────┘
```

## Input Processing

### Keyboard Event Pipeline

```
Raw stdin bytes: \x1b[A
        │
        ▼
Buffer accumulation
        │
        ▼
Escape sequence detection
        │
        ├─> Simple char: "a" ────────────────┐
        │                                    │
        ├─> ANSI CSI: \x1b[A (up arrow) ────┤
        │                                    │
        ├─> Kitty: \x1b[65;2u (Shift+A) ────┤
        │                                    │
        └─> ModifyOtherKeys: \x1b[27;2;32~ ──┤
                                             │
                                             ▼
                                   ┌──────────────────┐
                                   │ Parse & Normalize│
                                   │ to KeyEvent      │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ KeyEvent Object  │
                                   │ {                │
                                   │   name: "up",    │
                                   │   shift: false,  │
                                   │   ctrl: false,   │
                                   │   meta: false,   │
                                   │   sequence: "..."│
                                   │ }                │
                                   └────────┬─────────┘
                                            │
                                            ▼
                                   EventEmitter.emit("keypress")
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │ Focused          │
                                   │ Renderable       │
                                   │ handleKeyPress() │
                                   └──────────────────┘
```

## Layout Engine

### Yoga Integration

```
Renderable Tree:
┌─────────────────────────────────────┐
│ Root (flex: column)                 │
│  ├─ Header (height: 5)              │
│  ├─ Body (flex: 1)                  │
│  │   ├─ Sidebar (width: 20)         │
│  │   └─ Content (flex: 1)           │
│  └─ Footer (height: 3)              │
└─────────────────────────────────────┘
         │
         │ Layout calculation
         ▼
Yoga Tree:
┌─────────────────────────────────────┐
│ YGNode (root)                       │
│  ├─ YGNode (header)                 │
│  ├─ YGNode (body)                   │
│  │   ├─ YGNode (sidebar)            │
│  │   └─ YGNode (content)            │
│  └─ YGNode (footer)                 │
└─────────────────────────────────────┘
         │
         │ YGNodeCalculateLayout()
         ▼
Layout Results:
┌─────────────────────────────────────┐
│ Root: { x: 0, y: 0, w: 80, h: 24 } │
│  ├─ Header: { x: 0, y: 0, w: 80, h: 5 }
│  ├─ Body: { x: 0, y: 5, w: 80, h: 16 }
│  │   ├─ Sidebar: { x: 0, y: 5, w: 20, h: 16 }
│  │   └─ Content: { x: 20, y: 5, w: 60, h: 16 }
│  └─ Footer: { x: 0, y: 21, w: 80, h: 3 }
└─────────────────────────────────────┘
         │
         ▼
Update Renderable positions
```

### Scroll System

```
ScrollBox with overflow:
┌──────────────────────────┐
│ Viewport (visible area)  │  ← height: 10
│ ┌──────────────────────┐ │
│ │                      │ │
│ │ Content (scrollable) │ │  ← height: 50
│ │                      │ │  ← scrollY: 15 (offset)
│ │  (visible portion)   │ │
│ │                      │ │
│ └──────────────────────┘ │
│                          │
│ [ScrollBar] ████░░░░░░░  │  ← position indicator
└──────────────────────────┘

Rendering:
1. Render content to full buffer (50 rows)
2. Clip to viewport (10 rows, offset by scrollY)
3. Apply clipping rectangle
4. Render scrollbar indicator
```

## Console Overlay System

```
Terminal Display:
┌────────────────────────────────────┐
│ Application Content                │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ Console Overlay (if open)      │ │
│ │ ┌────────────────────────────┐ │ │
│ │ │ [Log] Message 1            │ │ │
│ │ │ [Info] Message 2           │ │ │
│ │ │ [Error] Message 3          │ │ │
│ │ └────────────────────────────┘ │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘

Console Positions:
- TOP: fills top portion
- BOTTOM: fills bottom portion  
- LEFT: fills left portion
- RIGHT: fills right portion

Interaction:
- Toggle: show/hide
- Focus: arrow keys for scrolling
- Resize: +/- keys to adjust size
```

## Performance Optimizations

### Dirty Tracking

```
Component Update:
┌─────────────────┐
│ Text.setContent │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ markDirty()     │  ← Set dirty flag
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Propagate up    │  ← Mark parents dirty
│ to root         │
└────────┬────────┘
         │
         ▼
Render Loop:
┌─────────────────┐
│ Only traverse   │  ← Skip clean subtrees
│ dirty branches  │
└─────────────────┘
```

### Buffer Diffing

```
Previous Frame:        Current Frame:
Cell[0]: 'A' red      Cell[0]: 'A' red     → Skip (same)
Cell[1]: 'B' blue     Cell[1]: 'C' blue    → Update (diff)
Cell[2]: 'C' green    Cell[2]: 'C' green   → Skip (same)

Output: \x1b[1;1H\x1b[34mC  ← Move cursor, change color, write 'C'
```

### Viewport Culling

```
Terminal viewport: { x: 0, y: 0, w: 80, h: 24 }

Renderable at { x: 100, y: 10 }  → Skip (outside viewport)
Renderable at { x: 10, y: 5 }    → Render (in viewport)
Renderable at { x: -50, y: 10 }  → Skip (outside viewport)
```

## Summary

OpenTUI's architecture demonstrates several advanced patterns:

1. **Hybrid execution**: Leverages both TypeScript ergonomics and Zig performance
2. **Efficient rendering**: Double buffering, diffing, and viewport culling minimize output
3. **Flexible layout**: Yoga provides CSS-like flexbox for terminal UIs
4. **Rich input**: Comprehensive keyboard/mouse support with modern terminal protocols
5. **Developer-friendly**: Built-in debugging console and extensive examples

The architecture balances performance, flexibility, and developer experience through careful layer separation and optimization strategies.
