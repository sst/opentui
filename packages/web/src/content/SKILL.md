---
name: opentui
description: Build terminal UIs with OpenTUI. Covers core, components, audio, keymaps, React, Solid, plugins, testing, standalone executables, QR encoding, SSH, and Three.js WebGPU.
---

# OpenTUI Skill

Canonical reference docs are authored once in sibling `docs/**/*.mdx` files.

Inside the OpenTUI repo, this skill root lives at `packages/web/src/content/`, so the same files are also visible at `packages/web/src/content/docs/**/*.mdx`.

## Path invariant

- `/docs/<slug>` maps to `docs/<slug>.mdx` relative to this skill root
- in the repo, that same slug maps to `packages/web/src/content/docs/<slug>.mdx`

## Reading order by area

- Getting started: `/docs/getting-started`
- Core: `/docs/core-concepts/renderer`
- Testing: `/docs/core-concepts/testing`
- Audio: `/docs/core-concepts/audio`
- Keymap: `/docs/keymap/overview`
- React: `/docs/bindings/react`
- Solid: `/docs/bindings/solid`
- Components: `/docs/components/text`, `/docs/components/input`
- Layout: `/docs/core-concepts/layout`
- Keyboard: `/docs/core-concepts/keyboard`
- Plugins: `/docs/plugins/slots`
- Runtime and packaging: `/docs/reference/env-vars`, `/docs/reference/standalone-executables`
- Package entrypoints: `/docs/reference/package-entrypoints`
- QR encoding: `/docs/reference/qr-encoder`
- SSH: `/docs/reference/ssh`
- Three.js WebGPU: `/docs/reference/three`

## Quick routing by intent

| Intent(s)                                                                                          | Start here                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `getting-started`, `installation`, `quickstart`, `intro`                                           | `docs/getting-started.mdx`                  |
| `core`, `renderer`, `terminal`, `scrollback`, `lifecycle`                                          | `docs/core-concepts/renderer.mdx`           |
| `audio`, `native-audio`, `sound`, `playback`, `streaming`, `radio`, `mp3`, `flac`, `pcm`, `fft`    | `docs/core-concepts/audio.mdx`              |
| `keymap`, `keybindings`, `shortcuts`, `commands`, `leader`, `ex-commands`                          | `docs/keymap/overview.mdx`                  |
| `layout`, `flexbox`, `yoga`, `positioning`                                                         | `docs/core-concepts/layout.mdx`             |
| `keyboard`, `input`, `keybindings`, `paste`, `focus`                                               | `docs/core-concepts/keyboard.mdx`           |
| `testing`, `test-renderer`, `snapshots`, `frames`                                                  | `docs/core-concepts/testing.mdx`            |
| `react`, `jsx`, `hooks`, `keyboard`, `paste`, `focus`, `blur`, `selection`, `animation`, `testing` | `docs/bindings/react.mdx`                   |
| `solid`, `jsx`, `signals`, `hooks`, `keyboard`, `animation`, `testing`                             | `docs/bindings/solid.mdx`                   |
| `plugins`, `plugin`, `slots`, `registry`, `extensions`                                             | `docs/plugins/slots.mdx`                    |
| `text`, `styling`, `content`, `selection`                                                          | `docs/components/text.mdx`                  |
| `input`, `form`, `editing`, `focus`                                                                | `docs/components/input.mdx`                 |
| `env`, `environment`, `configuration`, `flags`                                                     | `docs/reference/env-vars.mdx`               |
| `standalone`, `executable`, `bun-compile`, `node-sea`, `node-assets`                               | `docs/reference/standalone-executables.mdx` |
| `package-exports`, `entrypoints`, `subpath-exports`, `imports`                                     | `docs/reference/package-entrypoints.mdx`    |
| `qr`, `qrcode`, `qr-encoder`, `svg-qr`, `gs1`, `eci`, `structured-append`                          | `docs/reference/qr-encoder.mdx`             |
| `ssh`, `remote-tui`, `ssh-server`, `authentication`, `middleware`                                  | `docs/reference/ssh.mdx`                    |
| `three`, `threejs`, `webgpu`, `3d`, `sprites`, `physics`                                           | `docs/reference/three.mdx`                  |

For concrete component requests, jump straight to `docs/components/<name>.mdx` after the relevant entry page. For plugin implementation details, narrow from `docs/plugins/slots.mdx` into `docs/plugins/core.mdx`, `docs/plugins/react.mdx`, or `docs/plugins/solid.mdx`.

## Current skill entry pages

- `docs/getting-started.mdx`
- `docs/core-concepts/renderer.mdx`
- `docs/core-concepts/audio.mdx`
- `docs/core-concepts/testing.mdx`
- `docs/keymap/overview.mdx`
- `docs/core-concepts/layout.mdx`
- `docs/core-concepts/keyboard.mdx`
- `docs/bindings/react.mdx`
- `docs/bindings/solid.mdx`
- `docs/plugins/slots.mdx`
- `docs/components/text.mdx`
- `docs/components/input.mdx`
- `docs/reference/env-vars.mdx`
- `docs/reference/standalone-executables.mdx`
- `docs/reference/package-entrypoints.mdx`
- `docs/reference/qr-encoder.mdx`
- `docs/reference/ssh.mdx`
- `docs/reference/three.mdx`

## Working rules

- Prefer the current entry pages first, then read narrower docs in the same section.
- Read the sibling `docs/**/*.mdx` files directly instead of copying prose into this file.
- Use stable `/docs/...` URLs when cross-referencing docs.
