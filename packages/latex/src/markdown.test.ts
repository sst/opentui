import { describe, expect, it } from "bun:test"
import { parseMarkdownIncremental } from "../../core/src/renderables/markdown-parser.js"
import { registerLatexMarkdown, renderMarkdownMath } from "./markdown.js"

describe("@opentui/latex/markdown", () => {
  it("renders inline dollar math", () => {
    expect(renderMarkdownMath("Power: $x^2$")).toBe("Power: x²")
  })

  it("renders bracketed inline math", () => {
    expect(renderMarkdownMath("Value: \\(\\alpha_i^2\\)")).toBe("Value: αᵢ²")
  })

  it("renders display math blocks", () => {
    expect(renderMarkdownMath("Before\n$$\n\\frac{1}{2}\n$$\nAfter")).toMatchInlineSnapshot(`
      "Before
      1
      ─
      2
      After"
    `)
  })

  it("skips inline code and fenced code", () => {
    const markdown = [
      "Inline `$x^2$` and $x^2$",
      "",
      "```",
      "$y^2$",
      "```",
    ].join("\n")

    expect(renderMarkdownMath(markdown)).toBe(["Inline `$x^2$` and x²", "", "```", "$y^2$", "```"].join("\n"))
  })

  it("registers the markdown transform explicitly", () => {
    const before = parseMarkdownIncremental("Math: $\\frac{a}{b}$", null, 0)
    const beforeParagraph = before.tokens.find((token) => token.type === "paragraph") as any

    expect(beforeParagraph?.text).toBe("Math: $\\frac{a}{b}$")

    const unregister = registerLatexMarkdown()

    try {
      const after = parseMarkdownIncremental("Math: $\\frac{a}{b}$", null, 0)
      const afterParagraph = after.tokens.find((token) => token.type === "paragraph") as any

      expect(afterParagraph?.text).toContain("a")
      expect(afterParagraph?.text).toContain("─")
      expect(afterParagraph?.text).toContain("b")
    } finally {
      unregister()
    }
  })
})
