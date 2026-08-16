# `@opentui/mermaid`

Render Mermaid-flavored flowchart, sequence, state, and timeline diagrams in OpenTUI Markdown or as plain terminal text.

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

The package also exports parsers and plain renderers for sequence, state, and timeline diagrams.

## Support

This package implements a practical Mermaid syntax subset for terminal rendering. Unsupported otherwise-valid syntax throws `MermaidSyntaxError` with the diagram kind, source line, and line number.

- **Flowchart:** five directions, chained solid/dashed/thick/undirected edges, labels, nested subgraphs, local subgraph directions, and box/rounded/database/decision/subroutine nodes.
- **Sequence:** participants and actors, message arrow variants, self messages, notes, `alt`/`else`, `loop`, participant boxes, autonumbering, and activations.
- **State:** four directions, aliases, start/end/choice states, labeled/parallel/self transitions, composites, and left/right notes.
- **Timeline:** titles, sections, periods, multiple events, and continuation events. Bare, `TD`, and `LR` timelines all use a vertical spine suited to terminal reading.

All visible text supports quotes, Mermaid `<br>` line breaks, Unicode, and named or numeric HTML entities. Presentation-only flowchart directives are ignored because terminal colors come from the OpenTUI theme.

Common Mermaid features outside this subset include additional flowchart shapes and `&` fan-out syntax; sequence `opt`, `par`, `critical`, `break`, `rect`, create/destroy, and bidirectional messages; state fork/join, concurrent regions, descriptions, and composite-local directions; and timeline styling directives.

This project is not affiliated with the Mermaid project.
