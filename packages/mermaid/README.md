# `@opentui/mermaid`

Render Mermaid-flavored flowchart, sequence, and state diagrams in OpenTUI Markdown or as plain terminal text.

## Install

```sh
bun add @opentui/core @opentui/mermaid
```

## Markdown

````ts
import { createCliRenderer, MarkdownRenderable, RGBA, SyntaxStyle } from "@opentui/core"
import { createMermaidMarkdownRenderer } from "@opentui/mermaid"

const renderer = await createCliRenderer()
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: RGBA.fromHex("#e6edf3") } })
const markdown = new MarkdownRenderable(renderer, {
  content: "```mermaid\nflowchart LR\n  Parse --> Layout --> Render\n```",
  syntaxStyle,
  renderNode: createMermaidMarkdownRenderer(renderer),
})

renderer.root.add(markdown)
````

Use `createMermaidCodeBlockRenderer` when integrating with an existing Markdown code-block renderer registry.

## Plain Text

```ts
import { renderFlowchartDiagram } from "@opentui/mermaid"

console.log(renderFlowchartDiagram("flowchart LR\n  Parse --> Layout --> Render"))
```

The package also exports parsers and plain renderers for sequence and state diagrams.

## Support

This package implements a practical Mermaid syntax subset for terminal rendering. Unsupported otherwise-valid syntax throws `MermaidSyntaxError` with the diagram kind, source line, and line number.

This project is not affiliated with the Mermaid project.
