import { createCliRenderer, RGBA, SyntaxStyle } from "@opentui/core"
import { createRoot, useKeyboard, useRenderer } from "@opentui/react"
import { useState, useCallback } from "react"
import { $ } from "bun"

const markdownWithTable = `# Markdown Table Formatting Demo

This example demonstrates automatic table alignment in markdown.

## Unformatted Table (Input)

The raw markdown below has unaligned columns:

\`\`\`
| Name | Age | City |
|---|---|---|
| Alice | 30 | New York |
| Bob | 25 | Los Angeles |
| Charlie | 35 | Chicago |
\`\`\`

## Formatted Table (Auto-aligned)

| Name | Age | City |
|---|---|---|
| Alice | 30 | New York |
| Bob | 25 | Los Angeles |
| Charlie | 35 | Chicago |

## Another Example with Varying Widths

| Framework | Language | Stars | Description |
|-----------|----------|-------|-------------|
| React | JavaScript | 200k | UI Library |
| Vue | JavaScript | 180k | Progressive Framework |
| Angular | TypeScript | 85k | Full Framework |
| Svelte | JavaScript | 65k | Compiler |

## Mixed Content

Here's some regular text between tables.

| Command | Description |
|---------|-------------|
| \`npm install\` | Install dependencies |
| \`npm run build\` | Build the project |
| \`npm test\` | Run tests |

And more text after the table.

## Table with Bold and Italic

| Feature | Status | Notes |
|---------|--------|-------|
| **Authentication** | Done | *Secure* |
| **Authorization** | In Progress | Uses *RBAC* |
| \`API\` | **Stable** | Version *2.0* |

## Code Block (for comparison)

\`\`\`typescript
interface User {
  name: string
  age: number
  city: string
}

const users: User[] = [
  { name: "Alice", age: 30, city: "New York" },
  { name: "Bob", age: 25, city: "Los Angeles" },
]
\`\`\`
`

export default function App() {
  const [conceal, setConceal] = useState(true)
  const [copied, setCopied] = useState(false)
  const renderer = useRenderer()

  const handleMouseUp = useCallback(async () => {
    const selection = renderer.getSelection()
    if (selection) {
      const selectedText = selection.getSelectedText()
      if (selectedText) {
        // Copy to clipboard using pbcopy (macOS) or xclip (Linux)
        try {
          await $`echo -n ${selectedText} | pbcopy`.quiet()
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // Fallback for non-macOS systems
          try {
            await $`echo -n ${selectedText} | xclip -selection clipboard`.quiet()
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            // Silently fail if no clipboard tool available
          }
        }
      }
    }
  }, [renderer])

  const syntaxStyle = SyntaxStyle.fromStyles({
    // Headings
    "markup.heading.1": { fg: RGBA.fromHex("#FF79C6"), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex("#BD93F9"), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex("#8BE9FD"), bold: true },
    "markup.heading": { fg: RGBA.fromHex("#50FA7B"), bold: true },

    // Tables
    "punctuation.special": { fg: RGBA.fromHex("#6272A4") },

    // Code
    "markup.raw.block": { fg: RGBA.fromHex("#F1FA8C") },
    label: { fg: RGBA.fromHex("#FFB86C") },

    // Inline code
    "markup.raw": { fg: RGBA.fromHex("#F1FA8C") },

    // Bold and italic
    "markup.strong": { fg: RGBA.fromHex("#FFB86C"), bold: true },
    "markup.italic": { fg: RGBA.fromHex("#8BE9FD"), italic: true },

    // Links
    "markup.link.url": { fg: RGBA.fromHex("#8BE9FD"), underline: true },
    "markup.link.label": { fg: RGBA.fromHex("#FF79C6") },

    // Lists
    "markup.list": { fg: RGBA.fromHex("#FF79C6") },

    // Syntax highlighting for code blocks
    keyword: { fg: RGBA.fromHex("#FF79C6"), bold: true },
    type: { fg: RGBA.fromHex("#8BE9FD") },
    string: { fg: RGBA.fromHex("#F1FA8C") },
    number: { fg: RGBA.fromHex("#BD93F9") },
    property: { fg: RGBA.fromHex("#50FA7B") },
    punctuation: { fg: RGBA.fromHex("#F8F8F2") },
    variable: { fg: RGBA.fromHex("#F8F8F2") },

    default: { fg: RGBA.fromHex("#F8F8F2") },
  })

  useKeyboard((key) => {
    if (key.name === "c" && !key.ctrl && !key.meta) {
      setConceal((prev) => !prev)
    }
  })

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      <box flexDirection="column" backgroundColor="#282A36" padding={1} flexShrink={0} border borderColor="#BD93F9">
        <text fg="#BD93F9">Markdown Table Auto-Alignment Demo</text>
        <text fg="#888888">Tables are automatically formatted with aligned columns</text>
        <text fg="#AAAAAA">C - Toggle concealment ({conceal ? "ON" : "OFF"})</text>
        <text fg="#AAAAAA">Select text to copy to clipboard {copied ? <span fg="#50FA7B">(Copied!)</span> : null}</text>
        <text fg="#AAAAAA">Ctrl+C - Exit</text>
      </box>

      <scrollbox
        flexGrow={1}
        border
        borderStyle="single"
        borderColor="#BD93F9"
        backgroundColor="#282A36"
        onMouseUp={handleMouseUp}
      >
        <code
          content={markdownWithTable}
          filetype="markdown"
          syntaxStyle={syntaxStyle}
          conceal={conceal}
          selectable
          selectionBg="#44475A"
          selectionFg="#F8F8F2"
          width="100%"
        />
      </scrollbox>
    </box>
  )
}

const renderer = await createCliRenderer({ exitOnCtrlC: true })
renderer.setBackgroundColor("#282A36")
createRoot(renderer).render(<App />)
