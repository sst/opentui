# OpenTUI Codebase Exploration

**Date**: 2025-12-07  
**Purpose**: Comprehensive analysis of the OpenTUI repository structure, architecture, and capabilities

## Executive Summary

OpenTUI is a TypeScript library for building terminal user interfaces (TUIs) currently in active development. It features a hybrid architecture combining high-performance Zig native code with a TypeScript API layer, supporting multiple frontend frameworks including React, SolidJS, and Vue (unmaintained).

## Repository Structure

### Monorepo Organization

The repository is organized as a Bun workspace with 5 main packages:

```
packages/
├── core/      - Core library with native Zig implementation
├── solid/     - SolidJS reconciler
├── react/     - React reconciler  
├── vue/       - Vue reconciler (unmaintained)
└── go/        - Go bindings (unmaintained)
```

### Core Package Architecture

**Total TypeScript Files**: ~220  
**Total Zig Native Files**: 58  
**Example Demos**: 46  
**Renderable Components**: 27

#### Key Directories in `packages/core/src/`:

- `zig/` - Native Zig implementation (performance-critical code)
- `renderables/` - UI component library (Text, Input, Select, ScrollBox, etc.)
- `examples/` - Extensive demo applications
- `lib/` - Utility libraries (keyboard, colors, terminal detection, tree-sitter)
- `animation/` - Timeline and animation system
- `post/` - Post-processing filters
- `3d/` - 3D rendering capabilities

## Technology Stack

### Runtime & Build
- **Runtime**: Bun (>=1.2.0)
- **Language**: TypeScript 5+ with strict types
- **Native**: Zig (performance-critical operations)
- **Package Manager**: Bun workspaces

### Core Dependencies
- **yoga-layout** (3.2.1) - Flexbox layout engine
- **diff** (8.0.2) - Diff calculations
- **jimp** (1.6.0) - Image processing
- **web-tree-sitter** (0.25.10) - Syntax highlighting
- **bun-ffi-structs** (0.1.2) - FFI bindings

### Optional Dependencies
- **@dimforge/rapier2d-simd-compat** - 2D physics
- **planck** - Alternative 2D physics
- **three** - 3D graphics
- **bun-webgpu** - GPU acceleration

## Architecture Patterns

### Hybrid Native/TypeScript Design

The architecture splits responsibilities between:
1. **Zig Native Layer** (`src/zig/`):
   - Buffer management and rendering
   - UTF-8 text processing
   - Grapheme cluster handling
   - High-performance rope data structures
   - Terminal ANSI sequence handling

2. **TypeScript Layer** (`src/`):
   - Component API (Renderables)
   - Framework reconcilers
   - Layout engine (Yoga)
   - Syntax highlighting (Tree-sitter)
   - User input handling

### Component Model

Two approaches for building UIs:

1. **Renderables** (Imperative):
   ```typescript
   const obj = new TextRenderable(renderer, {
     id: "my-obj",
     content: "Hello, world!"
   })
   renderer.root.add(obj)
   ```

2. **Constructs/VNodes** (Declarative):
   ```typescript
   const greeting = Text({
     content: "Hello, OpenTUI!",
     fg: "#00FF00"
   })
   ```

### Key Renderables

Available UI components:
- `TextRenderable` / `Text` - Text display with styling
- `Box` - Container with borders
- `Input` - Single-line text input
- `Textarea` - Multi-line text input
- `Select` - Dropdown selection
- `TabSelect` - Tab navigation
- `Slider` - Numeric slider
- `ScrollBox` - Scrollable container
- `Code` - Syntax-highlighted code display
- `Diff` - Side-by-side diff viewer
- `FrameBuffer` - Low-level pixel buffer
- `ASCIIFont` - ASCII art text

## Feature Highlights

### 1. Advanced Rendering

- **Double-buffering** with optimized diffing
- **Alpha blending** and transparency support
- **Z-index** layering
- **Viewport clipping** and culling
- **Shader support** (fractal, 3D lighting)
- **Sprite rendering** with animation

### 2. Text Handling

- **Full Unicode support** including emojis
- **CJK character support** (with known issues - see #255)
- **Grapheme cluster** aware
- **Rope data structure** for efficient editing
- **Syntax highlighting** via Tree-sitter
- **Styled text** with ANSI/RGB colors

### 3. Layout System

- **Yoga flexbox** layout engine
- **Absolute/relative** positioning
- **Auto-sizing** and constraints
- **Scroll containers** with acceleration
- **Sticky positioning**

### 4. Input System

- **Keyboard** event handling
- **Mouse** interaction support
- **Kitty protocol** support
- **ModifyOtherKeys** sequences
- **Paste** event handling

### 5. Developer Experience

- **Built-in console** overlay for debugging
- **Hot reload** support
- **Testing utilities** (snapshot testing)
- **46 example demos** covering all features
- **Benchmarking** infrastructure

### 6. Advanced Features

- **3D rendering** (Three.js integration)
- **2D physics** (Rapier/Planck)
- **WebGPU** support
- **Particle systems**
- **Animation timelines**

## Open Issues Analysis

### Critical Issues (Affecting Core Functionality)

1. **#391** - Flex layout bug with state changes
2. **#388** - Nested ScrollBox clipping issues
3. **#255** - CJK character corruption in reconcilers
4. **#380** - shift+space not working in wezterm
5. **#334** - Kitty Graphics Protocol query leaking to tmux

### Enhancement Requests

1. **#387** - Kitty/iTerm2 image support
2. **#355** - Remove top-level await for bytecode compilation
3. **#316** - Deployment/production guidelines
4. **#306** - Publish to JSR
5. **#254** - Website for opentui.com

### Platform-Specific

1. **#336** - Emoji width calculation artifacts
2. **#330** - Mac Silicon build issues
3. **#230** - Windows build problems

## Code Quality Observations

### Strengths

1. **Comprehensive testing**: Native tests (Zig), JS tests (Bun), snapshot tests
2. **Rich examples**: 46 demos covering features
3. **Documentation**: Getting started, development, architecture docs
4. **Performance focus**: Native Zig for hot paths
5. **Type safety**: Strict TypeScript configuration

### Areas for Improvement (from TODO comments)

1. **Native migration**: Several TODOs about moving logic to Zig
2. **Flaky tests**: Some tests marked flaky in CI
3. **Layout updates**: ScrollBox layout refresh issues
4. **Async I/O**: Waiting for Zig async support
5. **Cache optimization**: Multiple caching opportunities identified

## Build & Development

### Build Process
```bash
bun run build              # Build all packages
bun run build:native       # Build Zig native code
bun run build:lib          # Build TypeScript
```

### Testing
```bash
bun test                   # Run all tests
bun run test:native        # Run Zig tests (in packages/core)
bun run test:js            # Run TypeScript tests
```

### Running Examples
```bash
cd packages/core
bun run src/examples/index.ts
```

## Performance Characteristics

### Native Benchmarks Available
- Buffer operations
- Text rendering
- Grapheme handling
- Rope operations

Run via: `bun run bench:native -Doptimize=ReleaseFast`

## Security Considerations

1. **No security scanning** currently configured
2. **FFI boundaries** between TypeScript and Zig
3. **Terminal escape sequences** - potential injection risks
4. **File I/O** for configuration and fonts

## Publishing Strategy

Currently published to npm as:
- `@opentui/core`
- `@opentui/solid`
- `@opentui/react`
- `@opentui/vue`

Platform-specific native packages:
- `@opentui/core-darwin-x64`
- `@opentui/core-darwin-arm64`
- `@opentui/core-linux-x64`
- `@opentui/core-linux-arm64`
- `@opentui/core-win32-x64`
- `@opentui/core-win32-arm64`

## Recommended Next Steps

### High Priority
1. Fix CJK character rendering issues (#255)
2. Resolve nested ScrollBox clipping (#388)
3. Fix flex layout state change bug (#391)
4. Add deployment/production documentation (#316)

### Medium Priority
1. Remove top-level await for bytecode compilation (#355)
2. Fix terminal-specific issues (wezterm, tmux, kitty)
3. Add image protocol support (#387)
4. Create opentui.com website (#254)

### Low Priority
1. Stabilize flaky tests
2. Migrate more logic to native Zig
3. Improve Windows support
4. Consider JSR publishing (#306)

## Conclusion

OpenTUI is a sophisticated TUI library with a unique hybrid architecture. The combination of Zig for performance-critical operations and TypeScript for API ergonomics creates a powerful foundation. The extensive example collection and active development indicate a healthy project trajectory.

Key differentiators:
- **Performance**: Native Zig implementation
- **Features**: Advanced rendering (3D, shaders, physics)
- **Flexibility**: Multiple framework support (React, Solid, Vue)
- **Developer UX**: Built-in debugging console, hot reload

Main challenges:
- Platform compatibility (Windows, terminal emulators)
- Text rendering edge cases (CJK, emojis)
- Layout system refinement
- Production deployment guidance

The project shows significant potential for building complex terminal applications with modern development practices.
