# @opentui/latex

LaTeX math support for OpenTUI.

Markdown rendering is opt-in. Register it before creating `MarkdownRenderable`
instances that should render math:

```ts
import { MarkdownRenderable } from "@opentui/core"
import { registerLatexMarkdown } from "@opentui/latex/markdown"

registerLatexMarkdown()

const md = new MarkdownRenderable(renderer, {
  content: String.raw`Euler: $e^{i\pi} + 1 = 0$`,
  syntaxStyle,
})
```

The Markdown transform supports inline `$...$`, `\(...\)`, and display `$$...$$`
math. Inline code and fenced code blocks are left unchanged.

The package also exposes a standalone renderable:

```ts
import { createCliRenderer } from "@opentui/core"
import { LatexRenderable } from "@opentui/latex"

const renderer = await createCliRenderer()
renderer.root.add(
  new LatexRenderable(renderer, {
    content: String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
    fg: "#f8fafc",
  }),
)
```

The renderer supports a practical terminal subset: fractions, square roots,
superscripts, subscripts, Greek letters, and common math operators. 

React JSX support is registered explicitly:

```tsx
import { registerLatex } from "@opentui/latex/react"

registerLatex()
```

Solid JSX support is registered explicitly:

```tsx
import { registerLatex } from "@opentui/latex/solid"

registerLatex()
```

For terminals that do not render Unicode math well, use ASCII mode:

```ts
new LatexRenderable(renderer, {
  content: String.raw`\alpha_i^2 \le \frac{1}{2}`,
  mode: "ascii",
})
```
