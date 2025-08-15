# OpenTUI

OpenTUI is a TypeScript library for building terminal user interfaces (TUIs). It is currently in
development and is not ready for production use. It will be the foundational TUI framework for both
[opencode](https://opencode.ai) and [terminaldotshop](https://terminal.shop).

This monorepo contains the following packages:
- [`@opentui/core`](packages/core) - The core library also works completely standalone, providing an imperative API and all the primitives.

## Install

```bash
bun install @opentui/core
```

## Running Examples

```bash
bun install
cd packages/core
bun run src/examples/index.ts
```
