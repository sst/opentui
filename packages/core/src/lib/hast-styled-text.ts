import type { TextChunk } from "../text-buffer"
import { StyledText } from "./styled-text"
import { SyntaxStyle } from "./syntax-style"

export interface HASTText {
  type: "text"
  value: string
}

export interface HASTElement {
  type: "element"
  tagName: string
  properties?: {
    className?: string
  }
  children: HASTNode[]
}

export type HASTNode = HASTText | HASTElement

// Re-export for backward compatibility
export { SyntaxStyle } from "./syntax-style"
export type { StyleDefinition } from "./syntax-style"

function hastToTextChunks(node: HASTNode, syntaxStyle: SyntaxStyle, parentStyles: string[] = []): TextChunk[] {
  const chunks: TextChunk[] = []

  if (node.type === "text") {
    const stylesToMerge = parentStyles.length > 0 ? parentStyles : ["default"]
    const mergedStyle = syntaxStyle.mergeStyles(...stylesToMerge)

    chunks.push({
      __isChunk: true,
      text: node.value,
      fg: mergedStyle.fg,
      bg: mergedStyle.bg,
      attributes: mergedStyle.attributes,
    })
  } else if (node.type === "element") {
    let currentStyles = [...parentStyles]

    if (node.properties?.className) {
      const classes = node.properties.className.split(" ")

      for (const cls of classes) {
        currentStyles.push(cls)
      }
    }

    for (const child of node.children) {
      chunks.push(...hastToTextChunks(child, syntaxStyle, currentStyles))
    }
  }

  return chunks
}

export function hastToStyledText(hast: HASTNode, syntaxStyle: SyntaxStyle): StyledText {
  const chunks = hastToTextChunks(hast, syntaxStyle)
  return new StyledText(chunks)
}
