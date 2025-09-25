# Tree-sitter Assets

This directory contains downloaded tree-sitter language parsers and highlight queries for the default parsers used by OpenTUI.
They are included in the repository to avoid downloading them every time the project is built or tests are run.

## Asset Management

Parser definitions are configured in `../parsers-config.json`:

### Update Script

The `update.ts` script downloads parsers and queries from the configured URLs and generates the `../default-parsers.ts` file.

#### Usage

```bash
# Run from this directory
bun update.ts

# Or from the project root
bun packages/core/src/lib/tree-sitter/assets/update.ts
```

#### What it does

1. **Downloads Language Parsers**: Downloads `.wasm` files from GitHub releases
2. **Downloads Query Files**: Downloads `.scm` highlight query files from repositories
3. **Combines Queries**: For languages like TypeScript, combines multiple query files (JS base + TS extensions)
4. **Generates Imports**: Creates `../default-parsers.ts` with proper file imports using Bun's `with { type: "file" }` syntax

## Adding New Parsers

To add support for a new language:

1. **Update Configuration**: Add the new parser to `../parsers-config.json`
2. **Run Update Script**: Execute `bun update.ts` to download assets and regenerate imports
