# @opentui/svelte

OpenTUI integration for Svelte 5 using DOM shims (DOM-Only approach).

## Status

✅ **Working** - Implementation complete (571 lines)

- DOM API shimming: 60 operations
- Real Svelte 5 runtime + OpenTUI rendering layer
- Reactive state, effects, and component composition

## Quick Start

**Run a Svelte component:**

```bash
cd packages/svelte
bun --conditions=browser examples/hello-svelte.svelte
```

**⚠️ Critical**: Must use `--conditions=browser` flag (Svelte 5 requirement)

## How It Works

1. **Bun Plugin**: Automatically compiles `.svelte` files (via bunfig.toml preload)
2. **Svelte Compiler**: Generates standard Svelte 5 runtime code
3. **DOM Shims**: `installDOMShims()` replaces global DOM APIs with OpenTUI wrappers
4. **Runtime**: Svelte calls DOM → Our shims → OpenTUI Renderables

## Example

**hello-svelte.svelte:**

```svelte
<script>
  let name = 'World';
  let count = $state(0);

  setInterval(() => {
    count += 1;
  }, 1000);
</script>

<div>
  <div>Hello {name}!</div>
  <div>Count: {count}</div>
</div>
```

**Run:**

```bash
bun --conditions=browser examples/hello-svelte.svelte
```

## Implementation

- **src/dom.ts** (489 lines): TUINode, TUIElement, TUIDocument classes
- **index.ts** (82 lines): render(), testRender(), installDOMShims()
- **scripts/svelte-plugin.ts**: Bun plugin for .svelte compilation
- **scripts/preload.ts**: Plugin registration (loaded via bunfig.toml)

## Programmatic API

```typescript
import { render } from "@opentui/svelte"
import MyComponent from "./MyComponent.svelte"

await render(MyComponent, {
  exitOnCtrlC: true,
  targetFps: 30,
})
```

## Files

- `examples/` - Working examples (hello-svelte.svelte, child.svelte, counter.svelte)
- `src/dom.ts` - DOM API implementations
- `index.ts` - Public API
- `scripts/` - Build and compilation tooling
- `analysis/` - Implementation analysis (DOM-Only approach chosen)
