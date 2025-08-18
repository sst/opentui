# @opentui/solid

Solid.js support for OpenTUI.

## Installation

```bash
bun install solid-js @opentui/solid
```

## Usage

tsconfig.json:
```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@opentui/solid"
  }
}
```

bunfig.toml:
```toml
preload = ["@opentui/solid/preload"]
```

index.tsx:
```tsx
import { render } from "@opentui/solid";

render(() => <text>Hello, World!</text>);
```


Run with `bun --conditions=browser index.tsx`.
