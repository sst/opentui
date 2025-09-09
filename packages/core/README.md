# OpenTUI Core

OpenTUI Core is a TypeScript library for building terminal user interfaces (TUIs). It is currently in
development and is not ready for production use.

[Getting Started](docs/getting-started.md)

## Install

```bash
bun install @opentui/core
```

## Build

```bash
bun run build
```

This creates platform-specific libraries that are automatically loaded by the TypeScript layer.

## Examples

```bash
bun install
bun run src/examples/index.ts
```

## CLI Renderer

### Renderables

Renderables are hierarchical objects that can be positioned, nested, styled and rendered to the terminal:

```typescript
import { createCliRenderer, TextRenderable } from "@opentui/core"

const renderer = await createCliRenderer()

const obj = new TextRenderable(renderer, { id: "my-obj", content: "Hello, world!" })

renderer.root.add(obj)
```
