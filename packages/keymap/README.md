# @opentui/keymap

A keymap engine for terminal and DOM hosts. Same core, two adapters.

It models keybindings as priority-ordered, focus-scoped layers attached to targets (terminal renderables or DOM elements). The core is intentionally bare; everything beyond raw key dispatch is opt-in via addons, parsers, and field compilers.

## Highlights

- **Layered bindings** with `focus` / `focus-within` scoping, priority ordering, `fallthrough`, and `preventDefault` control.
- **Multi-key sequences** with a public pending-sequence API and synchronous `pendingSequence` events. Focus changes invalidate sequences automatically.
- **Asynchronous disambiguation** for exact-vs-prefix conflicts (e.g. `g` vs `gg`), with `AbortSignal` + `sleep` deferred resolvers. Ships a Neovim-style timeout resolver.
- **Pluggable parsing pipeline**: stackable binding parsers, expanders, transformers, command resolvers, command transformers, and event-match resolvers.
- **Extensible schema**: register custom fields on layers, bindings, and commands. Field compilers emit `attrs` and can gate activation via `require(...)` and `activeWhen(matcher)`.
- **Reactive matchers** with cached invalidation, plus React store and Solid signal helpers.
- **Intercepts** for raw input and pre-binding key handling, with `consume({ preventDefault, stopPropagation })`.
- **Command catalog** with namespaces, search, visibility tiers (`registered` / `reachable` / `active`), and binding queries.
- **Diagnostics** with stable codes (`unknown-token`, `dead-binding`, `unresolved-command`, ...) and lint-style layer analyzers.

## Addons

`@opentui/keymap/addons` ships ready-made building blocks:

- `registerDefaultKeys` — `ctrl+shift+s` style parser and event matching.
- `registerLeader`, `registerTimedLeader` — leader tokens with optional timeout.
- `registerEmacsBindings` — `ctrl+x ctrl+s` chords.
- `registerExCommands` — `:write`-style commands with `aliases` and `nargs`.
- `registerCommaBindings`, `registerModBindings`, `registerAliasesField`, `registerBindingOverrides`.
- `registerEnabledFields`, `registerMetadataFields` (`desc`, `group`, `title`, `category`).
- `registerNeovimDisambiguation`, `registerEscapeClearsPendingSequence`, `registerBackspacePopsPendingSequence`.
- `registerDeadBindingWarnings`, `registerUnresolvedCommandWarnings`.

`@opentui/keymap/addons/opentui` adds OpenTUI-specific pieces: layout-independent matching via `event.baseCode`, and pre-wired textarea / edit-buffer commands.

## Entry Points

- `@opentui/keymap` — core API
- `@opentui/keymap/addons` — universal addons
- `@opentui/keymap/addons/opentui` — universal + OpenTUI addons
- `@opentui/keymap/html` — core + HTML adapter
- `@opentui/keymap/opentui` — core + OpenTUI adapter
- `@opentui/keymap/react` — `KeymapProvider`, `useKeymap`, `useBindings`, `useActiveKeys`, `usePendingSequence`, `reactiveMatcherFromStore`
- `@opentui/keymap/solid` — `KeymapProvider`, `useKeymap`, `useKeymapSelector`, `useBindings`, `reactiveMatcherFromSignal`
- `@opentui/keymap/extras` — helpers for cheat-sheet UIs (`resolveBindingSections`, `commandBindings`, `formatCommandBindings`)

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

Create a keymap, install the addons you want, then pass the configured instance to your app. The React and Solid entrypoints consume a pre-created OpenTUI keymap through context.

## Adapters

Adapters implement a small `KeymapHost` interface (`rootTarget`, `getFocusedTarget`, `getParentTarget`, `onKeyPress`, `onFocusChange`, ...). The HTML adapter normalizes DOM key names (`Escape` → `escape`, `ArrowUp` → `up`, `Meta` → `super`, `Alt` → `meta`) and tracks targets via `MutationObserver`. The OpenTUI adapter hooks `CliRenderer` `keypress`, `keyrelease`, focus, and destroy events.

## Formatting Keys

Use `keymap.formatKey` when displaying raw binding strings. It runs them through the keymap's parsers and tokens before stringifying.

```ts
keymap.formatKey("<leader>s", { separator: " " }) // "space s"
keymap.formatKey("<leader>s", { preferDisplay: true }) // "<leader>s"
```

## Re-entry

Runtime/data re-entry is supported during dispatch: command handlers, intercepts, and pending-sequence listeners may read or write runtime data and pending-sequence state.

Structural re-entry is **not** supported. Do not register or unregister layers, tokens, parsers, or resolvers while a dispatch is in flight.

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

The HTML demo lives in the docs app at `/demos/keymap-html/` under `packages/web`.
