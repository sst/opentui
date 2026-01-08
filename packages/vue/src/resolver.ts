export interface ComponentResolverResult {
  name: string
  from: string
}

export interface ComponentResolver {
  type: "component"
  resolve: (name: string) => ComponentResolverResult | undefined
}

export function OpenTUIResolver(): ComponentResolver {
  const componentNames = new Set([
    "box",
    "Text",
    "Input",
    "Select",
    "Textarea",
    "scrollbox",
    "Code",
    "diff",
    "ascii-font",
    "tab-select",
    "line-number",
    "Span",
    "B",
    "Strong",
    "I",
    "Em",
    "U",
    "Br",
    "A",
  ])

  return {
    type: "component",
    resolve: (name: string): ComponentResolverResult | undefined => {
      if (componentNames.has(name)) {
        return {
          name,
          from: "@opentui/vue",
        }
      }

      return undefined
    },
  }
}

export default OpenTUIResolver
