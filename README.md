# OpenTUI

<div align="center">
    <a href="https://www.npmjs.com/package/@opentui/core"><img alt="npm" src="https://img.shields.io/npm/v/@opentui/core?style=flat-square" /></a>
    <a href="https://github.com/sst/opentui/actions/workflows/build-core.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/sst/opentui/build-core.yml?style=flat-square&branch=main" /></a>
    <a href="https://github.com/msmps/awesome-opentui"><img alt="awesome opentui list" src="https://awesome.re/badge-flat.svg" /></a>
</div>

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
- [`@opentui/vue`](packages/vue) - The Vue reconciler (unmaintained)
- [`@opentui/go`](packages/go) - Go bindings (unmaintained)

## Install

NOTE: You must have [Zig](https://ziglang.org/learn/getting-started/) installed on your system to build the packages.

### TypeScript/JavaScript

```bash
bun install @opentui/core
```

## Running Examples (from the repo root)

### TypeScript Examples

```bash
bun install
cd packages/core
bun run src/examples/index.ts
```

## Development

### Local Development Linking

When developing OpenTUI, you may want to test your changes in another project without publishing. The `link-opentui-dev.sh` script makes this easy by creating symlinks (or copies) from your OpenTUI workspace to another project's `node_modules`.

**Basic usage:**

```bash
./scripts/link-opentui-dev.sh /path/to/your/project
```

This will link `@opentui/core` to your target project.

**Options:**

- `--react` - Also link `@opentui/react`
- `--solid` - Also link `@opentui/solid` and `solid-js`
- `--dist` - Link the built `dist` directories instead of source packages
- `--copy` - Copy the dist directories instead of symlinking (requires `--dist`)

**Examples:**

```bash
# Link only core (default)
./scripts/link-opentui-dev.sh /path/to/your/project

# Link core and solid
./scripts/link-opentui-dev.sh /path/to/your/project --solid

# Link core and react, using dist directories
./scripts/link-opentui-dev.sh /path/to/your/project --react --dist

# Copy dist directories (useful for environments where symlinks don't work)
./scripts/link-opentui-dev.sh /path/to/your/project --dist --copy
```

**Notes:**

- The target project must have already run `bun install` (or `npm install`) to have a `node_modules` directory
- By default, the script links to the source packages, allowing hot-reloading of changes
- Use `--dist` when you need to test the built artifacts
- Use `--copy` mode when working in environments that don't support symlinks well (e.g., Docker containers, Windows)

## Showcase

Consider showcasing your work on the [awesome-opentui](https://github.com/msmps/awesome-opentui) list. A curated list of awesome resources and terminal user interfaces built with OpenTUI.
