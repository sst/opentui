# OpenTui

OpenTUI is a TypeScript library for building terminal user interfaces (TUIs) in the browser. It is currently in
development and is not ready for production use. It will be the foundational TUI framework for both
[opencode](https://opencode.ai) and [terminaldotshop](https://terminal.shop).

## Build

```bash
bun build:prod
```

This creates platform-specific libraries in `src/zig/lib/` that are automatically loaded by the TypeScript layer.

## Examples

Requires running a build script first. (`build`, `build:dev`, `build:prod`)

```bash
bun run src/examples/index.ts
```

## CLI Renderer

### Renderables

Renderables are hierarchical objects that can be positioned and rendered to buffers:

```typescript
import { Renderable } from "@opentui/core"

class MyRenderable extends Renderable {
  protected renderSelf(buffer: OptimizedBuffer): void {
    buffer.drawText("Custom content", this.x, this.y, RGBA.fromValues(1, 1, 1, 1))
  }
}

const obj = new MyRenderable("my-obj", { x: 10, y: 5, zIndex: 1 })

renderer.add(obj)
```
