# Tree-Sitter

## Adding Custom Parsers

There are two ways to add custom parsers to your application:

### 1. Global Default Parsers (Recommended)

Use `addDefaultParsers()` to add parsers globally before initializing any clients. This is useful when you want all Tree-Sitter clients in your application to support the same languages.

```typescript
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core"

// Add Python parser globally
addDefaultParsers([
  {
    filetype: "python",
    wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/highlights.scm"],
    },
  },
])

// Now all clients will have Python support
const client = getTreeSitterClient()
await client.initialize()

// Highlight Python code
const pythonCode = 'def hello():\n    print("world")'
const result = await client.highlightOnce(pythonCode, "python")
```

### 2. Per-Client Parsers

Use `client.addFiletypeParser()` to add parsers to a specific client instance. This is useful when different parts of your application need different language support.

```typescript
import { TreeSitterClient } from "@opentui/core"

const client = new TreeSitterClient({ dataPath: "./cache" })
await client.initialize()

// Add Rust parser to this specific client
client.addFiletypeParser({
  filetype: "rust",
  wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm",
  queries: {
    highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/queries/highlights.scm"],
  },
})

// Highlight Rust code
const rustCode = 'fn main() {\n    println!("Hello, world!");\n}'
const result = await client.highlightOnce(rustCode, "rust")
```

## Parser Configuration Structure

The `FiletypeParserOptions` interface defines how to configure a parser:

```typescript
interface FiletypeParserOptions {
  filetype: string // The filetype identifier (e.g., "python", "rust")
  wasm: string // URL or local file path to the .wasm parser file
  queries: {
    highlights: string[] // Array of URLs or local file paths to .scm query files
  }
}
```

## Finding Parsers and Queries

### Official Tree-Sitter Parsers

Most popular languages have official parsers:

```typescript
// Official parsers follow this pattern:
const parserUrl =
  "https://github.com/tree-sitter/tree-sitter-{language}/releases/download/v{version}/tree-sitter-{language}.wasm"

// Examples:
// Python: https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm
// Rust: https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm
// Go: https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm
```

### Finding Highlight Queries

Highlight queries are usually found in the parser repository's `queries/` directory:

```typescript
// Official queries:
const queryUrl = "https://raw.githubusercontent.com/tree-sitter/tree-sitter-{language}/master/queries/highlights.scm"

// Or from nvim-treesitter (often more comprehensive):
const nvimQueryUrl =
  "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/{language}/highlights.scm"
```

### Combining Multiple Queries

Some languages require multiple query files. For example, TypeScript uses JavaScript queries plus TypeScript-specific queries:

```typescript
addDefaultParsers([
  {
    filetype: "typescript",
    wasm: "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
    queries: {
      highlights: [
        // Base ECMAScript/JavaScript queries
        "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/ecma/highlights.scm",
        // TypeScript-specific queries
        "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/typescript/highlights.scm",
      ],
    },
  },
])
```

## Using Local Files

For better performance and offline support, you can bundle parsers and queries with your application:

```typescript
// Using Bun's file import
import pythonWasm from "./parsers/tree-sitter-python.wasm" with { type: "file" }
import pythonHighlights from "./queries/python/highlights.scm" with { type: "file" }

addDefaultParsers([
  {
    filetype: "python",
    wasm: pythonWasm,
    queries: {
      highlights: [pythonHighlights],
    },
  },
])
```

## Automated Parser Management

You can automate parser downloads and import generation using the `updateAssets` utility. This is especially useful when supporting multiple languages or integrating parser management into your build pipeline.

### Creating a Parser Configuration

Create a `parsers-config.json` file in your project:

```json
{
  "parsers": [
    {
      "filetype": "python",
      "wasm": "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
      "queries": {
        "highlights": ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/highlights.scm"]
      }
    },
    {
      "filetype": "rust",
      "wasm": "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm",
      "queries": {
        "highlights": ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/queries/highlights.scm"]
      }
    }
  ]
}
```

### Integrating into Build Pipeline

#### CLI Usage

Add the update script to your `package.json`:

```json
{
  "scripts": {
    "prebuild": "bun node_modules/@opentui/core/lib/tree-sitter/assets/update.ts --config ./parsers-config.json --assets ./src/parsers --output ./src/parsers.ts",
    "build": "bun build ./src/index.ts"
  }
}
```

#### Programmatic Usage

Or call it programmatically in your build script:

```typescript
import { updateAssets } from "@opentui/core"

await updateAssets({
  configPath: "./parsers-config.json",
  assetsDir: "./src/parsers",
  outputPath: "./src/parsers.ts",
})
```

### Using Generated Parsers

The script generates a TypeScript file with all parsers pre-configured:

```typescript
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core"
import { getParsers } from "./parsers" // Generated file

addDefaultParsers(getParsers())

const client = getTreeSitterClient()
await client.initialize()

const result = await client.highlightOnce('def hello():\n    print("world")', "python")
```

## Complete Example: Adding Multiple Languages

```typescript
import { addDefaultParsers, getTreeSitterClient, SyntaxStyle } from "@opentui/core"

// Add support for multiple languages before initializing
addDefaultParsers([
  {
    filetype: "python",
    wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/highlights.scm"],
    },
  },
  {
    filetype: "rust",
    wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/queries/highlights.scm"],
    },
  },
  {
    filetype: "go",
    wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-go/master/queries/highlights.scm"],
    },
  },
])

// Initialize the client
const client = getTreeSitterClient()
await client.initialize()

// Use with different languages
const syntaxStyle = new SyntaxStyle()

const pythonResult = await client.highlightOnce('def hello():\n    print("world")', "python")

const rustResult = await client.highlightOnce('fn main() {\n    println!("Hello");\n}', "rust")

const goResult = await client.highlightOnce('func main() {\n    fmt.Println("Hello")\n}', "go")
```

## Using with CodeRenderable

The `CodeRenderable` component automatically uses the Tree-Sitter client for syntax highlighting:

```typescript
import { CodeRenderable, getTreeSitterClient } from "@opentui/core"

// Initialize the client with custom parsers
const client = getTreeSitterClient()
await client.initialize()

// Create a code renderable
const codeBlock = new CodeRenderable("code-1", {
  content: 'def hello():\n    print("world")',
  filetype: "python",
  width: 40,
  height: 10,
})

// The CodeRenderable will automatically use the Tree-Sitter client
// to highlight the code
```

## Caching

Parser and query files are automatically cached in the `dataPath` directory to avoid re-downloading them.
You can customize the cache location when creating a client:

```typescript
const client = new TreeSitterClient({
  dataPath: "./my-custom-cache",
})
```

## File Type Resolution

OpenTUI provides utilities to automatically determine filetypes from file paths:

```typescript
import { pathToFiletype, extToFiletype } from "@opentui/core"

// Get filetype from file path
const ft1 = pathToFiletype("src/main.rs") // "rust"
const ft2 = pathToFiletype("app.py") // "python"

// Get filetype from extension
const ft3 = extToFiletype("ts") // "typescript"
const ft4 = extToFiletype("js") // "javascript"
```

Built-in mappings include: `js`, `jsx`, `ts`, `tsx`, `py`, `rb`, `go`, `rs`, `c`, `cpp`, `html`, `css`, and more.
