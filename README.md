# OpenTUI

OpenTUI is a TypeScript library for building terminal user interfaces (TUIs). It is currently in
development and is not ready for production use. It will be the foundational TUI framework for both
[opencode](https://opencode.ai) and [terminaldotshop](https://terminal.shop).

Quick start with [bun](https://bun.sh) and [create-tui](https://github.com/msmps/create-tui):

```bash
bun create tui
```

This monorepo contains the following packages:

- [`@opentui/core`](packages/core) - The core library works completely standalone, providing an imperative API and all the primitives.
- [`@opentui/solid`](packages/solid) - The SolidJS reconciler for OpenTUI.
- [`@opentui/react`](packages/react) - The React reconciler for OpenTUI.
- [`@opentui/vue`](packages/vue) - The Vue reconciler for OpenTUI.
- [`@opentui/go`](packages/go) - Go bindings for OpenTUI

## Install

### TypeScript/JavaScript

```bash
bun install @opentui/core
```

### Go

First install OpenTUI system-wide:

```bash
curl -L https://github.com/sst/opentui/releases/latest/download/install.sh | sh
```

Then use in your Go projects:

```bash
go get github.com/sst/opentui/packages/go
```

## Running Examples (from the repo root)

### TypeScript Examples

```bash
bun install
cd packages/core
bun run src/examples/index.ts
```

### Go Examples

```bash
# Basic example
cd packages/go/examples/basic
go run .
```
