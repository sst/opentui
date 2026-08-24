<!-- Keep the project introduction aligned with the repository README and opentui.com. -->

<p align="center">
  <a href="https://opentui.com">
    <img alt="OpenTUI logo" src="https://opentui.com/opentui-logo-auto.svg" width="270" />
  </a>
</p>

<div align="center">
    <a href="https://www.npmjs.com/package/@opentui/core"><img alt="npm version" src="https://img.shields.io/npm/v/@opentui/core?style=flat-square" /></a>
    <a href="https://github.com/anomalyco/opentui/actions/workflows/build-core.yml"><img alt="Core build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opentui/build-core.yml?style=flat-square&branch=main" /></a>
</div>

OpenTUI is a library to build terminal user interfaces.

- It is written in Zig.
- You write TypeScript directly or through React and Solid.
- You arrange boxes and text with flexbox.
- You add selects, inputs, and scroll boxes with keyboard and mouse controls.
- You can play sounds, show images, and render 3D graphics.

OpenCode uses OpenTUI in production for millions of users.

[Website](https://opentui.com) | [Documentation](https://opentui.com/docs) | [Packages](https://opentui.com/packages)

## OpenTUI Core

`@opentui/core` supplies the renderer and TypeScript API. It uses imperative renderables and events directly. The
TypeScript packages call native Zig through an internal foreign function interface (FFI) boundary.

The native ABI and generated platform packages are internal distribution surfaces, not application APIs.

```bash
bun add @opentui/core
```

Read the [quickstart](https://opentui.com/docs/getting-started/quickstart) for a simple example of how to use OpenTUI
Core in your project.

## AI agent skill

Install the OpenTUI documentation as a skill for your AI coding assistant with [`npx skills`](https://skills.sh):

```bash
npx skills add anomalyco/opentui --skill opentui
```

Add `-g` to install the skill globally.

## License

OpenTUI is licensed under the [MIT License](https://github.com/anomalyco/opentui/blob/main/LICENSE).
