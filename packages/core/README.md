# OpenTUI Core

OpenTUI is a native terminal UI core written in Zig with TypeScript bindings. The native core exposes a C ABI and can be used from any language. OpenTUI powers OpenCode in production today and will also power terminal.shop. It is an extensible core with a focus on correctness, stability, and high performance. It provides a component-based architecture with flexible layout capabilities, allowing you to create complex terminal applications.

## Documentation

- [Getting Started](../../packages/web/src/content/docs/getting-started.mdx) - API and usage guide
- [Development Guide](docs/development.md) - Building, testing, and contributing
- [Tree-Sitter](../../packages/web/src/content/docs/reference/tree-sitter.mdx) - Syntax highlighting integration
- [Renderables vs Constructs](../../packages/web/src/content/docs/core-concepts/renderables-vs-constructs.mdx) - Understanding the component model
- [Environment Variables](../../packages/web/src/content/docs/reference/env-vars.mdx) - Configuration options

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
cd ../examples
bun run dev
```

## Benchmarks

Run native performance benchmarks:

```bash
bun run bench:native
```

See [src/zig/bench.zig](src/zig/bench.zig) for available options like `--filter` and `--mem`.

NativeSpanFeed TypeScript benchmarks:

- [src/benchmark/native-span-feed-benchmark.md](src/benchmark/native-span-feed-benchmark.md)

## CLI Renderer

### Renderables

Renderables are hierarchical objects that can be positioned, nested, styled and rendered to the terminal:

```typescript
import { createCliRenderer, TextRenderable } from "@opentui/core"

const renderer = await createCliRenderer()

const obj = new TextRenderable(renderer, { id: "my-obj", content: "Hello, world!" })

renderer.root.add(obj)
```
