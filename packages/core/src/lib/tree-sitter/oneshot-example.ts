import { TreeSitterClient } from "./client"
import type { HighlightResponse } from "./types"
import { tmpdir } from "os"
import { join } from "path"

// Example showing how to use one-shot highlighting for syntax highlighting

async function highlightCodeExample() {
  const client = new TreeSitterClient({
    dataPath: join(tmpdir(), "tree-sitter-oneshot-demo"),
  })

  try {
    await client.initialize()

    const jsCode = `const greeting = "Hello, world!";
function calculate(a, b) {
  return a + b * 2;
}

const result = calculate(5, 10);
console.log(greeting, result);`

    console.log("Highlighting JavaScript code...")
    const result = await client.highlightOnce(jsCode, "javascript")

    if (result.highlights) {
      console.log(`Found ${result.highlights.length} highlighted lines`)

      // Process highlights to create styled text
      for (const lineHighlight of result.highlights) {
        console.log(`Line ${lineHighlight.line}:`)
        for (const highlight of lineHighlight.highlights) {
          console.log(`  ${highlight.startCol}-${highlight.endCol}: ${highlight.group}`)
        }
      }

      // Example of how you might convert to styled chunks
      const styledChunks = convertHighlightsToChunks(jsCode, result.highlights)
      console.log("Styled chunks:", styledChunks.length)
    } else {
      console.log("Highlighting failed:", result.warning || result.error)
    }
  } finally {
    await client.destroy()
  }
}

// Helper function to convert tree-sitter highlights to styled text chunks
function convertHighlightsToChunks(content: string, highlights: HighlightResponse[]) {
  const lines = content.split("\n")
  const chunks = []

  for (const lineHighlight of highlights) {
    const lineContent = lines[lineHighlight.line] || ""
    let lastCol = 0

    // Sort highlights by start column
    const sortedHighlights = lineHighlight.highlights.sort((a, b) => a.startCol - b.startCol)

    for (const highlight of sortedHighlights) {
      // Add unhighlighted text before this highlight
      if (highlight.startCol > lastCol) {
        chunks.push({
          text: lineContent.slice(lastCol, highlight.startCol),
          group: "default",
        })
      }

      // Add highlighted text
      chunks.push({
        text: lineContent.slice(highlight.startCol, highlight.endCol),
        group: highlight.group,
      })

      lastCol = highlight.endCol
    }

    // Add remaining unhighlighted text
    if (lastCol < lineContent.length) {
      chunks.push({
        text: lineContent.slice(lastCol),
        group: "default",
      })
    }

    // Add newline except for last line
    if (lineHighlight.line < lines.length - 1) {
      chunks.push({
        text: "\n",
        group: "default",
      })
    }
  }

  return chunks
}

// Example using the new treeSitterToStyledText function
async function styledTextExample() {
  const { TreeSitterClient, SyntaxStyle, treeSitterToStyledText } = await import("./index")
  const { RGBA } = await import("../RGBA")
  const { tmpdir } = await import("os")
  const { join } = await import("path")

  const client = new TreeSitterClient({
    dataPath: join(tmpdir(), "tree-sitter-styled-demo"),
  })

  const syntaxStyle = new SyntaxStyle({
    default: { fg: RGBA.fromInts(255, 255, 255, 255) }, // white
    keyword: { fg: RGBA.fromInts(255, 100, 100, 255), bold: true }, // red bold
    string: { fg: RGBA.fromInts(100, 255, 100, 255) }, // green
    number: { fg: RGBA.fromInts(100, 100, 255, 255) }, // blue
    function: { fg: RGBA.fromInts(255, 255, 100, 255), italic: true }, // yellow italic
    comment: { fg: RGBA.fromInts(128, 128, 128, 255), italic: true }, // gray italic
  })

  try {
    const jsCode = `const greeting = "Hello, world!";
function calculate(a, b) {
  return a + b * 2;
}

const result = calculate(5, 10);
console.log(greeting, result);`

    console.log("Converting JavaScript to styled text...")
    const styledText = await treeSitterToStyledText(jsCode, "javascript", syntaxStyle, client)

    console.log(`Created ${styledText.chunks.length} styled chunks`)

    // Show some of the chunks
    for (let i = 0; i < Math.min(5, styledText.chunks.length); i++) {
      const chunk = styledText.chunks[i]
      console.log(`Chunk ${i}: "${chunk.text}" (fg: ${chunk.fg}, attrs: ${chunk.attributes})`)
    }
  } finally {
    await client.destroy()
  }
}

// Uncomment to run the examples
// highlightCodeExample().catch(console.error)
styledTextExample().catch(console.error)
