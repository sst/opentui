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

### Nix

OpenTUI can be installed using Nix flakes on Linux and macOS (x86_64 and aarch64):

```bash
# Run development shell with OpenTUI
nix develop github:sst/opentui

# Install OpenTUI to your profile
nix profile install github:sst/opentui

# Add to your flake.nix
inputs.opentui.url = "github:sst/opentui";

# Use in NixOS configuration
environment.systemPackages = [ opentui.packages.${system}.default ];
```

The Nix package includes the OpenTUI headers, libraries, and pkg-config files for system integration.

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
