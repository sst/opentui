# @opentui/keymap

Keymap package for OpenTUI and browser-based UIs.

It provides a shared keymap core, adapter-specific entrypoints for HTML and OpenTUI, and framework providers/hooks for React and Solid.

The core `Keymap` is intentionally bare. Create a keymap, install the addons you want, then pass that configured instance to your app.

Use the HTML entrypoint for DOM-based hosts and the OpenTUI entrypoint for terminal renderers. The React and Solid entrypoints consume a pre-created OpenTUI keymap through context.

Entry points:

- `@opentui/keymap`: core keymap API
- `@opentui/keymap/addons`: universal addons
- `@opentui/keymap/addons/opentui`: universal addons plus OpenTUI-specific addons
- `@opentui/keymap/html`: core API plus the HTML adapter
- `@opentui/keymap/opentui`: core API plus the OpenTUI adapter
- `@opentui/keymap/react`: React provider and hooks for a pre-created OpenTUI keymap
- `@opentui/keymap/solid`: Solid provider and hooks for a pre-created OpenTUI keymap

## Usage

```tsx
import { registerDefaultKeys } from "@opentui/keymap/addons"
import { createOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KeymapProvider } from "@opentui/keymap/react"

const keymap = createOpenTuiKeymap(renderer)
registerDefaultKeys(keymap)

createRoot(renderer).render(
  <KeymapProvider keymap={keymap}>
    <App />
  </KeymapProvider>,
)
```

## Field Model

Layer fields are for activation requirements and binding-compilation inputs.
They do not compile into public attrs.

Binding and command fields can compile metadata into attrs that later appear on
active bindings, active keys, and command query results.

## Re-entry

Runtime/data-style re-entry is supported during dispatch. For example, command
handlers, intercepts, and pending-sequence listeners may read or write runtime
data and manage pending-sequence state.

Structural re-entry is currently unsupported. Do not register or unregister
layers, tokens, parsers, resolvers, or other environment-shaping state while a
dispatch is in flight.

## Installation

```bash
bun install @opentui/keymap
```

## Development

```bash
bun run build
bun run test
bun src/keymap-benchmark.ts
```

- `bun src/keymap-benchmark.ts` runs the benchmark suite from `src/keymap-benchmark.ts`.
- The HTML demo now lives in the docs app at `/demos/keymap-html/` under `packages/web`.
