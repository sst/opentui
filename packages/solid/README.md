# @opentui/solid

Solid.js support for OpenTUI.

## Installation

```bash
bun install solid-js @opentui/solid
```

## Usage

1. Add jsx config to tsconfig.json:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

2. Add preload script to bunfig.toml:

```toml
preload = ["@opentui/solid/preload"]
```

3. Add render function to index.tsx:

```tsx
import { render } from "@opentui/solid"

render(() => <text>Hello, World!</text>)
```

4. Run with `bun --conditions=browser index.tsx`.
