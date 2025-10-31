/**
 * This file contains the configuration for the defaulttree-sitter parsers.
 * It is used by ./assets/update.ts to generate the default-parsers.ts file.
 * For changes here to be reflected in the default-parsers.ts file, you need to run `bun run ./assets/update.ts`
 */
export default {
  parsers: [
    {
      filetype: "javascript",
      wasm: "https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.25.0/tree-sitter-javascript.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/tree-sitter/tree-sitter-javascript/refs/heads/master/queries/highlights.scm",
        ],
      },
    },
    {
      filetype: "typescript",
      wasm: "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
      queries: {
        highlights: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/ecma/highlights.scm",
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/typescript/highlights.scm",
        ],
      },
    },
    {
      filetype: "markdown",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-markdown/releases/download/v0.5.1/tree-sitter-markdown.wasm",
      queries: {
        highlights: [
          // Using local file to preserve custom modifications
          "./assets/markdown/highlights.scm",
        ],
        injections: [
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/refs/heads/master/queries/markdown/injections.scm",
        ],
      },
      injectionMapping: {
        nodeTypes: {
          inline: "markdown_inline",
          pipe_table_cell: "markdown_inline",
        },
        infoStringMap: {
          javascript: "javascript",
          js: "javascript",
          typescript: "typescript",
          ts: "typescript",
          markdown: "markdown",
          md: "markdown",
        },
      },
    },
    {
      filetype: "markdown_inline",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-markdown/releases/download/v0.5.1/tree-sitter-markdown_inline.wasm",
      queries: {
        highlights: [
          // NOTE: Pinned to last working version of the query, newer versions are adapted to neovim breaking changes
          "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/99ddf573531c4dbe53f743ecbc1595af5eb1d32f/queries/markdown_inline/highlights.scm",
        ],
      },
    },
  ],
}
