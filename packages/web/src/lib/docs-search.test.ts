import { describe, expect, test } from "bun:test"

import { buildDocsSearchIndex, searchEntriesForPage } from "./docs-search-index"
import { highlightParts, lookup, preview } from "./docs-search"

const rendererPage = {
  title: "Renderer",
  url: "/docs/core-concepts/renderer" as const,
  description: "Create a CliRenderer, attach its root, and choose a render schedule",
  searchSymbols: ["CliRenderer", "createCliRenderer"],
}

const rendererSource = `
import Foo from "bar"

# Renderer

\`CliRenderer\` owns one terminal session.

## Create a renderer

\`createCliRenderer()\` runs asynchronous terminal setup.

\`\`\`typescript
const renderer = await createCliRenderer()
\`\`\`

### Nested details

The root always tracks the render width.

<ScrollbackRecording
  label="should not be indexed"
/>

## Choose a screen mode

\`screenMode\` controls which terminal area OpenTUI owns. \`split-footer\` uses a footer.
`.trim()

describe("documentation search index", () => {
  test("splits pages on headings and strips markup, imports, and components", () => {
    const entries = searchEntriesForPage(rendererPage, rendererSource)

    expect(entries.map((entry) => ({ title: entry.title, url: entry.url }))).toEqual([
      { title: "Renderer", url: "/docs/core-concepts/renderer" },
      { title: "Create a renderer", url: "/docs/core-concepts/renderer#create-a-renderer" },
      { title: "Nested details", url: "/docs/core-concepts/renderer#nested-details" },
      { title: "Choose a screen mode", url: "/docs/core-concepts/renderer#choose-a-screen-mode" },
    ])

    expect(entries[0].text).toContain("CliRenderer owns one terminal session")
    expect(entries[0].text).toContain("createCliRenderer")
    expect(entries[1].text).toContain("const renderer = await createCliRenderer()")
    expect(entries.some((entry) => entry.text.includes("Foo from"))).toBe(false)
    expect(entries.some((entry) => entry.text.includes("should not be indexed"))).toBe(false)
  })

  test("keeps a page-level entry when the title has no body of its own", () => {
    const entries = searchEntriesForPage(
      {
        title: "Input",
        url: "/docs/components/input",
        description: "One line of text",
        searchSymbols: ["InputRenderable"],
      },
      "# Input\n\n## Availability\n\n`InputRenderable` is built in.\n",
    )

    expect(entries[0]).toEqual({
      chapter: "Input",
      title: "Input",
      url: "/docs/components/input",
      text: "One line of text InputRenderable",
    })
    expect(entries[1]?.url).toBe("/docs/components/input#availability")
  })

  test("indexes published documentation pages", async () => {
    const entries = await buildDocsSearchIndex()
    expect(entries.length).toBeGreaterThan(100)
    expect(entries.some((entry) => entry.url === "/docs" && entry.title === "Getting started")).toBe(true)
    expect(entries.some((entry) => entry.url.startsWith("/docs/core-concepts/renderer#"))).toBe(true)
  })
})

describe("documentation search matching", () => {
  const entries = searchEntriesForPage(rendererPage, rendererSource)

  test("matches from the start of a word and ranks headings above body text", () => {
    const [first] = lookup(entries, "create")

    expect(first?.entry.title).toBe("Create a renderer")
    expect(lookup(entries, "ender")).toEqual([])
  })

  test("treats hyphens in the text as optional", () => {
    expect(lookup(entries, "splitfooter")[0]?.entry.title).toBe("Choose a screen mode")
  })

  test("requires every term and prefers a contiguous phrase", () => {
    const matches = lookup(entries, "create renderer")

    expect(matches[0]?.entry.title).toBe("Create a renderer")
    expect(lookup(entries, "create missing")).toEqual([])
  })

  test("builds a preview around the first match and marks the hit", () => {
    const [match] = lookup(entries, "screenMode")
    if (!match) throw new Error("expected a match")

    const snippet = preview(match.entry.text, match.pattern)
    expect(snippet).toContain("screenMode")
    expect(highlightParts(snippet, match.pattern).some((part) => part.mark && part.text.startsWith("screenMode"))).toBe(
      true,
    )
  })
})
