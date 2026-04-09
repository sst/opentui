# Node.js Compatibility Plan

## Summary

Goal: make the main OpenTUI packages usable from Node.js with no user-facing preload flags such as `-r` or `--import`, and without introducing import maps.

The core approach is:

1. Replace Bun-specific runtime imports in portable code with project-owned compat modules.
2. Keep Bun-only features isolated behind explicit Bun-only entrypoints.
3. Publish Node-consumable build artifacts instead of relying on loader hooks at runtime.
4. Add a real Node test lane for every package that is meant to work in Node.

This plan intentionally moves compatibility out of process bootstrapping and into normal module code.

## Principles

- No import maps.
- No required `-r` / `--import` flags for consumers.
- No production dependence on `packages/core/src/nodejs/compat.ts`.
- Prefer standard platform APIs over Bun shims where possible.
- Use a stable compat import surface inside the repo.
- Keep the Bun-only API surface explicit instead of partially emulated.

## Target End State

Node users can install and import these entrypoints directly:

- `@opentui/core`
- `@opentui/core/testing`
- `@opentui/react`
- `@opentui/react/test-utils`
- `@opentui/solid`

These entrypoints remain Bun-only in the first pass:

- `@opentui/core/runtime-plugin`
- `@opentui/core/runtime-plugin-support`
- `@opentui/core/3d`
- `@opentui/react/runtime-plugin-support`
- `@opentui/solid/runtime-plugin-support`
- `@opentui/solid/preload`
- `@opentui/solid/bun-plugin`

If a Node user imports a Bun-only entrypoint, they should get a clean, deterministic error from a stub module, not a random Bun symbol failure.

## Current Problems

- Portable runtime code still imports `bun:ffi`.
- Portable runtime code still calls `Bun.*`.
- Tree-sitter assets use Bun import attributes such as `with { type: "file" }`.
- The current Node path relies on `packages/core/src/nodejs/compat.ts`, which must be preloaded before any Bun-specific import is evaluated.
- Published `dist` artifacts are still Bun-oriented, so a consumer import is not the same thing as a Vitest import.

## Main Design

### 1. Introduce a compat surface in `packages/core/src/compat`

Planned modules:

- `packages/core/src/compat/ffi.ts`
- `packages/core/src/compat/Worker.ts`
- `packages/core/src/compat/runtime.ts`
- `packages/core/src/compat/resolvers.ts`
- `packages/core/src/compat/test.ts`

Portable code will only import from these modules instead of `bun:ffi`, `bun:test`, `Bun.*`, or Bun import attributes.

### 2. Stable facade, flexible implementation

The import surface should be stable even if implementation differs by runtime.

That means call sites should always import:

```ts
import { dlopen, ptr, toArrayBuffer } from "./compat/ffi.js"
import { Worker } from "./compat/Worker.js"
import { resolveFile, readTextFile } from "./compat/resolvers.js"
import { sleep, stringWidth, stripANSI, writeFile } from "./compat/runtime.js"
```

The implementation behind those modules can be either:

- a single portable file when that is straightforward, or
- a thin facade with runtime-specific internals when a single file would force Bun-only syntax back into the source.

Important constraint: the stable import surface is required, but the implementation does not need to be a single literal file if that becomes awkward.

## Compat Module Plan

### `compat/ffi.ts`

Purpose:

- Replace every `bun:ffi` import in portable runtime code.
- Ensure generated `.d.ts` files stop referencing `bun:ffi`.

Exports should cover the exact subset the project uses today:

- `dlopen`
- `JSCallback`
- `ptr`
- `toArrayBuffer`
- `Pointer`
- `FFIType`
- any other Bun FFI types currently exposed in public types

Implementation plan:

- Reuse the logic already developed in `packages/core/src/nodejs/bunModules/ffi.ts` for Node.
- In Bun, delegate to Bun FFI.
- Own the exported types under the compat module so declaration output references `./compat/ffi` instead of `bun:ffi`.

Files to migrate first:

- `packages/core/src/buffer.ts`
- `packages/core/src/edit-buffer.ts`
- `packages/core/src/editor-view.ts`
- `packages/core/src/NativeSpanFeed.ts`
- `packages/core/src/renderer.ts`
- `packages/core/src/syntax-style.ts`
- `packages/core/src/text-buffer.ts`
- `packages/core/src/text-buffer-view.ts`
- `packages/core/src/zig-structs.ts`
- `packages/core/src/zig.ts`
- `packages/core/src/lib/clipboard.ts`
- `packages/core/src/3d/canvas.ts`

### `compat/Worker.ts`

Purpose:

- Replace implicit reliance on global `Worker`.
- Make worker creation explicit and runtime-neutral.

Required surface:

- `new Worker(string | URL)`
- `onmessage`
- `onerror`
- `postMessage`
- `terminate`

Implementation plan:

- Bun path: use the native worker implementation.
- Node path: wrap `node:worker_threads` and preserve the web-worker style API already used by `TreeSitterClient`.

First consumer:

- `packages/core/src/lib/tree-sitter/client.ts`

### `compat/runtime.ts`

Purpose:

- Remove remaining `Bun.*` calls from portable runtime code.

Initial surface:

- `sleep(ms)`
- `stringWidth(text)`
- `stripANSI(text)`
- `writeFile(path, data, options?)`
- possibly `readTextFile(path)` if useful outside resolvers

Rules:

- Prefer direct standard-library replacements when possible.
- Keep the compat API narrow and project-owned.
- Do not preserve a fake global `Bun` object in the long-term design.

Expected migrations:

- `packages/core/src/lib/paste.ts`
- `packages/core/src/lib/extmarks.ts`
- `packages/core/src/renderables/LineNumberRenderable.ts`
- `packages/core/src/renderables/ScrollBar.ts`
- `packages/core/src/renderer.ts`
- `packages/core/src/zig.ts`

### `compat/resolvers.ts`

Purpose:

- Replace Bun import attributes in portable code.

Planned API:

```ts
const javascriptHighlights = resolveFile(import.meta.url, "./assets/javascript/highlights.scm")
const shaderTemplate = readTextFile(import.meta.url, "./shaders/supersampling.wgsl")
```

Suggested helpers:

- `resolveFile(fromImportMetaUrl, relativePath): string`
- `readTextFile(fromImportMetaUrl, relativePath): string`
- optionally `resolveUrl(fromImportMetaUrl, relativePath): URL`

Usage plan:

- Tree-sitter asset paths should use `resolveFile(...)`.
- Shader source should use `readTextFile(...)`.
- Generated native package stubs should use direct `new URL(..., import.meta.url)` plus `fileURLToPath(...)`; they do not need Bun import attributes at all.

Files to migrate:

- `packages/core/src/lib/tree-sitter/default-parsers.ts`
- `packages/core/src/3d/canvas.ts`
- `packages/core/scripts/build.ts` for native package index generation
- `packages/core/src/lib/tree-sitter/assets/update.ts` so future generated files use the resolver helpers

### `compat/test.ts`

Purpose:

- Provide one shared test import surface for Bun and Vitest.

Scope:

- Repo tests only.
- Not part of the supported runtime API.

Exports:

- `describe`
- `it`
- `test`
- `expect`
- `beforeEach`
- `afterEach`
- `beforeAll`
- `afterAll`
- `mock`
- `spyOn`
- shared matcher setup such as `toInclude`

This should replace direct `bun:test` imports in packages that need a Node test lane.

## Source Migration Plan

### Phase 1: Core portable runtime

1. Add `packages/core/src/compat/{ffi,Worker,runtime,resolvers}.ts`.
2. Replace all `bun:ffi` imports in portable code with `./compat/ffi.js`.
3. Replace global `Worker` usage with `./compat/Worker.js`.
4. Replace `with { type: "file" }` and `with { type: "text" }` with resolver helpers.
5. Replace remaining `Bun.*` calls in portable runtime code.
6. Regenerate any generated files that currently emit Bun-specific asset imports.
7. Ensure the main `@opentui/core` runtime path no longer depends on `packages/core/src/nodejs/compat.ts`.

Deliverable:

- A Node import of the portable `core` source no longer requires preload hooks to resolve Bun-specific runtime APIs.

### Phase 2: Explicit Bun-only isolation

Keep these entrypoints Bun-only in the first pass:

- `packages/core/src/runtime-plugin.ts`
- `packages/core/src/runtime-plugin-support.ts`
- `packages/react/scripts/runtime-plugin-support.ts`
- `packages/solid/scripts/runtime-plugin-support.ts`
- `packages/solid/scripts/solid-plugin.ts`
- `packages/solid/scripts/preload.ts`
- `packages/core/src/3d.ts` and `packages/core/src/3d/**` unless a separate 3D Node plan is approved

Tasks:

- Move any Bun-only imports out of otherwise portable modules.
- Add explicit Node stubs for Bun-only published subpaths.
- Keep Bun tests for these entrypoints in the Bun lane only.

Deliverable:

- The portable API surface is cleanly separated from the Bun-only API surface.

### Phase 3: Packaging and publish output

Portable source is not enough; published `dist` must also be Node-safe.

Tasks for `@opentui/core`:

1. Stop publishing Bun-targeted output as the only artifact.
2. Build a Node-safe ESM artifact with no `bun:ffi`, no `Bun.*`, and no Bun import attributes.
3. Keep a Bun build only where it provides real value.
4. Use package `exports` conditions to select Node vs default artifacts where needed.
5. For native optional packages such as `@opentui/core-darwin-arm64`, generate a portable `index.js` that resolves the adjacent library path with `fileURLToPath(new URL(...))`.
6. Ensure generated declarations reference compat modules instead of `bun:ffi`.

Tasks for `@opentui/react` and `@opentui/solid`:

1. Rebuild against the portable `@opentui/core` output.
2. Publish Node-safe main entrypoints.
3. Publish explicit Node stubs for Bun-only subpaths.
4. Stop copying raw `.ts` Bun-only entrypoints into published `dist` when a stub or transpiled JS file is more appropriate.

Export map policy:

- Use package `exports`.
- Do not introduce import maps.
- Prefer `"node"` and `"default"` conditions when runtimes need different files.
- Use a single file for both runtimes when the artifact is genuinely portable.

Deliverable:

- `node -e 'import("@opentui/core")'` works against published output with no preload flags.

### Phase 4: Test migration

#### Shared test policy

- Bun remains the primary lane for Bun-only features.
- Node gets a first-class lane for every package intended to work in Node.
- Portable tests should not import `bun:test` directly.
- Node snapshots should be separate from Bun snapshots.

#### `@opentui/core`

Add and maintain:

- `test:js` for Bun source tests
- `test:nodejs` for Node source tests
- `test:nodejs:dist` for plain Node imports against built output

Node source lane:

- Use Vitest while the migration is in progress.
- Prefer direct source imports once portable compat modules exist.
- Keep current hook-based Node test setup only as a temporary bridge.

Node dist lane:

- Use plain `node` to import built entrypoints.
- No `--import`.
- No custom loader hooks.
- This lane is the release gate for Node compatibility.

Tests that remain Bun-only:

- runtime plugin tests requiring `import { plugin } from "bun"`
- any tests for Bun-only entrypoints
- any tests that intentionally validate Bun plugin behavior

#### `@opentui/react`

Tasks:

1. Add `packages/react/vitest.config.ts`.
2. Replace `bun:test` imports with a shared test compat import.
3. Add Node snapshots with a `.nodejs.snap` suffix.
4. Add `test:nodejs`.
5. Add `test:nodejs:dist` smoke coverage for the published package.

Expected Bun-only exclusions:

- `packages/react/tests/runtime-plugin-support.test.ts`

#### `@opentui/solid`

Tasks:

1. Add `packages/solid/vitest.config.ts`.
2. Replace `bun:test` imports with a shared test compat import.
3. Add Node snapshots with a `.nodejs.snap` suffix.
4. Add `test:nodejs`.
5. Add `test:nodejs:dist` smoke coverage for the published package.

Important requirement:

- The Solid Node test lane must use a transform equivalent to the current Solid Bun plugin behavior.
- Reuse the current Babel-based logic where possible so Node and Bun produce the same JSX transform semantics.

Expected Bun-only exclusions:

- `packages/solid/tests/runtime-plugin-support*.test.ts`
- `packages/solid/tests/solid-plugin.test.ts`
- any tests whose fixtures import `plugin` from `bun`

#### Root scripts

Planned root-level scripts:

- `test:bun`
- `test:nodejs`
- `test:nodejs:dist`
- `test`

Recommended policy:

- `test` should run the Bun lane plus the Node source lane.
- CI release jobs should also run `test:nodejs:dist`.

### Phase 5: Cleanup

Once the portable runtime no longer depends on loader hooks:

1. Remove or retire `packages/core/src/nodejs/compat.ts`.
2. Remove or retire `packages/core/src/nodejs/bunModules/test.ts`.
3. Remove any Vitest config that exists only to inject the Node preload hook.
4. Remove build or test comments that describe the old preload-based path as the supported solution.

## Package-by-Package Scope

### `packages/core`

Required in first pass:

- portable main entrypoint
- portable `testing` entrypoint
- portable native library path resolution
- Node-safe declarations
- Node source tests
- Node dist smoke tests

Deferred:

- `runtime-plugin`
- `runtime-plugin-support`
- `3d`

### `packages/react`

Required in first pass:

- portable main entrypoint
- portable `test-utils`
- Node tests
- Node dist smoke tests

Deferred:

- `runtime-plugin-support`

### `packages/solid`

Required in first pass:

- portable main entrypoint
- Node tests
- Node dist smoke tests

Deferred:

- `runtime-plugin-support`
- `bun-plugin`
- `preload`

### `packages/web`

No dedicated runtime compatibility work is required for the initial port beyond consuming the portable `core` package correctly.

## Build Strategy

Recommended build policy:

1. Make the runtime code portable first.
2. Then simplify builds where portability makes a separate Bun build unnecessary.
3. Only keep separate Bun and Node output trees where the implementation truly differs.

Suggested artifact layout if split output is still needed:

- `dist/node/**`
- `dist/bun/**`

Suggested artifact layout if most code becomes portable:

- one shared portable output tree
- separate stubs only for Bun-only subpaths

The exact output layout is less important than this invariant:

- published Node entrypoints must work when imported by plain `node`

## Acceptance Criteria

The Node port is complete when all of the following are true:

1. `@opentui/core`, `@opentui/core/testing`, `@opentui/react`, and `@opentui/solid` import cleanly in plain Node with no preload flags.
2. Portable source files no longer import `bun:ffi`, `bun:test`, or use Bun import attributes.
3. Portable runtime code no longer depends on a global `Bun` object.
4. Published declaration files for portable entrypoints no longer reference `bun:ffi`.
5. Bun-only subpaths fail cleanly in Node with an explicit message.
6. Each supported package has a working Node test lane.
7. Each supported package has a Node dist smoke test.

## Implementation Order

Recommended order:

1. Add compat modules in `packages/core/src/compat`.
2. Migrate `@opentui/core` portable runtime code.
3. Regenerate tree-sitter asset resolver output.
4. Fix native package stubs.
5. Make `@opentui/core` dist Node-safe.
6. Add `@opentui/core` Node dist smoke tests.
7. Add `@opentui/react` Node test lane.
8. Add `@opentui/solid` Node test lane.
9. Make `react` and `solid` dist Node-safe.
10. Add root Node test scripts and CI lanes.
11. Remove the old preload-hook path.

## Notes

- This plan does not require import maps.
- This plan does not require users to change docs to mention `-r` or `--import`.
- This plan assumes the stable compat import surface lives in `packages/core/src/compat`.
- `packages/core/src/compat/test.ts` is useful for repo tests, but it should not be treated as part of the supported runtime API unless that becomes an explicit product decision.
