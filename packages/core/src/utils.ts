import { TextAttributes } from "./types"
import { Renderable } from "./Renderable"

export function createTextAttributes({
  bold = false,
  italic = false,
  underline = false,
  dim = false,
  blink = false,
  inverse = false,
  hidden = false,
  strikethrough = false,
}: {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
  blink?: boolean
  inverse?: boolean
  hidden?: boolean
  strikethrough?: boolean
} = {}): number {
  let attributes = TextAttributes.NONE

  if (bold) attributes |= TextAttributes.BOLD
  if (italic) attributes |= TextAttributes.ITALIC
  if (underline) attributes |= TextAttributes.UNDERLINE
  if (dim) attributes |= TextAttributes.DIM
  if (blink) attributes |= TextAttributes.BLINK
  if (inverse) attributes |= TextAttributes.INVERSE
  if (hidden) attributes |= TextAttributes.HIDDEN
  if (strikethrough) attributes |= TextAttributes.STRIKETHROUGH

  return attributes
}

// For debugging purposes
export function visualizeRenderableTree(renderable: Renderable, maxDepth: number = 10): void {
  function buildTreeLines(
    node: Renderable,
    prefix: string = "",
    parentPrefix: string = "",
    isLastChild: boolean = true,
    depth: number = 0,
  ): string[] {
    if (depth >= maxDepth) {
      return [`${prefix}${node.id} ... (max depth reached)`]
    }

    const lines: string[] = []
    const children = node.getChildren()

    // Add current node
    lines.push(`${prefix}${node.id}`)

    if (children.length > 0) {
      const lastChildIndex = children.length - 1

      children.forEach((child, index) => {
        const childIsLast = index === lastChildIndex
        const connector = childIsLast ? "└── " : "├── "
        const childPrefix = parentPrefix + (isLastChild ? "    " : "│   ")
        const childLines = buildTreeLines(child, childPrefix + connector, childPrefix, childIsLast, depth + 1)
        lines.push(...childLines)
      })
    }

    return lines
  }

  const treeLines = buildTreeLines(renderable)
  console.log("Renderable Tree:\n" + treeLines.join("\n"))
}
