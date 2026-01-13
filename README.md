# OpenTUI

<div align="center">
    <a href="https://www.npmjs.com/package/@opentui/core"><img alt="npm" src="https://img.shields.io/npm/v/@opentui/core?style=flat-square" /></a>
    <a href="https://github.com/anomalyco/opentui/actions/workflows/build-core.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opentui/build-core.yml?style=flat-square&branch=main" /></a>
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

## Install

NOTE: You must have [Zig](https://ziglang.org/learn/getting-started/) installed on your system to build the packages.

### TypeScript/JavaScript

```bash
bun install @opentui/core
```

## Try Examples

You can quickly try out OpenTUI examples without cloning the repository:

**For macOS, Linux, WSL, Git Bash:**

```bash
curl -fsSL https://raw.githubusercontent.com/anomalyco/opentui/main/packages/core/src/examples/install.sh | sh
```

**For Windows (PowerShell/CMD):**

Download the latest release directly from [GitHub Releases](https://github.com/anomalyco/opentui/releases/latest)

## Running Examples (from the repo root)

### TypeScript Examples

```bash
bun install
cd packages/core
bun run src/examples/index.ts
```

## Development

See the [Development Guide](packages/core/docs/development.md) for building, testing, debugging, and local development linking.

### Documentation

- [Development Guide](packages/core/docs/development.md) - Building, testing, and local dev linking
- [Getting Started](packages/core/docs/getting-started.md) - API and usage guide
- [Environment Variables](packages/core/docs/env-vars.md) - Configuration options

## Showcase

Consider showcasing your work on the [awesome-opentui](https://github.com/msmps/awesome-opentui) list. A curated list of awesome resources and terminal user interfaces built with OpenTUI.
