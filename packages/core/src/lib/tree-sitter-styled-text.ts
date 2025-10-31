import type { TextChunk } from "../text-buffer"
import { StyledText } from "./styled-text"
import { SyntaxStyle, type StyleDefinition } from "../syntax-style"
import { TreeSitterClient } from "./tree-sitter/client"
import type { SimpleHighlight } from "./tree-sitter/types"
import { createTextAttributes } from "../utils"

interface ConcealOptions {
  enabled: boolean
}

interface Boundary {
  offset: number
  type: "start" | "end"
  highlightIndex: number
}

function getSpecificity(group: string): number {
  return group.split(".").length
}

function shouldSuppressInInjection(group: string, meta: any): boolean {
  if (meta?.isInjection) {
    return false
  }

  // Check if this is a parent block that should be suppressed
  // TODO: This is language/highlight specific,
  // not generic enough. Needs a more generic solution.
  // The styles need to be more like a stack that gets merged
  // and for a container with injections we just don't push that container style
  return group === "markup.raw.block"
}

export function treeSitterToTextChunks(
  content: string,
  highlights: SimpleHighlight[],
  syntaxStyle: SyntaxStyle,
  options?: ConcealOptions,
): TextChunk[] {
  const chunks: TextChunk[] = []
  const defaultStyle = syntaxStyle.getStyle("default")
  const concealEnabled = options?.enabled ?? true

  const injectionContainerRanges: Array<{ start: number; end: number }> = []
  const boundaries: Boundary[] = []

  for (let i = 0; i < highlights.length; i++) {
    const [start, end, , meta] = highlights[i]
    if (start === end) continue // Skip zero-length ranges
    if (meta?.containsInjection) {
      injectionContainerRanges.push({ start, end })
    }
    boundaries.push({ offset: start, type: "start", highlightIndex: i })
    boundaries.push({ offset: end, type: "end", highlightIndex: i })
  }

  // Sort boundaries by offset, with ends before starts at same offset
  // This ensures we close old ranges before opening new ones at the same position
  boundaries.sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset
    if (a.type === "end" && b.type === "start") return -1
    if (a.type === "start" && b.type === "end") return 1
    return 0
  })

  // Track active highlights
  const activeHighlights = new Set<number>()
  let currentOffset = 0

  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i]

    // Process segment before this boundary
    if (currentOffset < boundary.offset && activeHighlights.size > 0) {
      const segmentText = content.slice(currentOffset, boundary.offset)

      // Collect active highlight groups
      const activeGroups: Array<{ group: string; meta: any; index: number }> = []
      for (const idx of activeHighlights) {
        const [, , group, meta] = highlights[idx]
        activeGroups.push({ group, meta, index: idx })
      }

      // Check if any active highlight has a conceal property
      // Priority: 1. Check meta.conceal first 2. Check group === "conceal"
      const concealHighlight = concealEnabled
        ? activeGroups.find((h) => h.meta?.conceal !== undefined || h.group === "conceal")
        : undefined

      if (concealHighlight) {
        // If conceal is set (even to empty string or null), drop the text for now
        // In the future we might support replacement text (non-empty conceal values)
        // Drop this text (conceal with empty replacement)
        // Don't add any chunk
      } else {
        const insideInjectionContainer = injectionContainerRanges.some(
          (range) => currentOffset >= range.start && currentOffset < range.end,
        )

        // Filter out highlights that should be suppressed
        // Suppress highlights when we're inside an injection container
        const validGroups = activeGroups.filter((h) => {
          // If we're inside an injection container, suppress all markup.raw.block highlights
          // This includes both the container itself and any nested markup.raw.block
          if (insideInjectionContainer && shouldSuppressInInjection(h.group, h.meta)) {
            return false
          }
          return true
        })

        // Resolve winning style by specificity and order
        let winningGroup: string | undefined
        let maxSpecificity = -1
        let winningIndex = -1

        for (const { group, index } of validGroups) {
          const specificity = getSpecificity(group)
          if (specificity > maxSpecificity || (specificity === maxSpecificity && index > winningIndex)) {
            maxSpecificity = specificity
            winningGroup = group
            winningIndex = index
          }
        }

        // Get style for winning group
        let styleToUse: StyleDefinition | undefined
        if (winningGroup) {
          styleToUse = syntaxStyle.getStyle(winningGroup)
          if (!styleToUse && winningGroup.includes(".")) {
            // Fallback to base scope
            const baseName = winningGroup.split(".")[0]
            styleToUse = syntaxStyle.getStyle(baseName)
          }
        }

        const finalStyle = styleToUse || defaultStyle

        chunks.push({
          __isChunk: true,
          text: segmentText,
          fg: finalStyle?.fg,
          bg: finalStyle?.bg,
          attributes: finalStyle
            ? createTextAttributes({
                bold: finalStyle.bold,
                italic: finalStyle.italic,
                underline: finalStyle.underline,
                dim: finalStyle.dim,
              })
            : 0,
        })
      }
    } else if (currentOffset < boundary.offset) {
      // Gap with no active highlights - use default style
      const text = content.slice(currentOffset, boundary.offset)
      chunks.push({
        __isChunk: true,
        text,
        fg: defaultStyle?.fg,
        bg: defaultStyle?.bg,
        attributes: defaultStyle
          ? createTextAttributes({
              bold: defaultStyle.bold,
              italic: defaultStyle.italic,
              underline: defaultStyle.underline,
              dim: defaultStyle.dim,
            })
          : 0,
      })
    }

    // Update active highlights
    if (boundary.type === "start") {
      activeHighlights.add(boundary.highlightIndex)
    } else {
      activeHighlights.delete(boundary.highlightIndex)

      if (concealEnabled) {
        const [, , , meta] = highlights[boundary.highlightIndex]
        if (meta?.concealLines !== undefined) {
          if (boundary.offset < content.length && content[boundary.offset] === "\n") {
            currentOffset = boundary.offset + 1
            continue
          }
        }
        if (meta?.conceal !== undefined) {
          if (boundary.offset < content.length && content[boundary.offset] === " ") {
            currentOffset = boundary.offset + 1
            continue
          }
        }
      }
    }

    currentOffset = boundary.offset
  }

  // Process remaining text
  if (currentOffset < content.length) {
    const text = content.slice(currentOffset)
    chunks.push({
      __isChunk: true,
      text,
      fg: defaultStyle?.fg,
      bg: defaultStyle?.bg,
      attributes: defaultStyle
        ? createTextAttributes({
            bold: defaultStyle.bold,
            italic: defaultStyle.italic,
            underline: defaultStyle.underline,
            dim: defaultStyle.dim,
          })
        : 0,
    })
  }

  return chunks
}

export interface TreeSitterToStyledTextOptions {
  conceal?: ConcealOptions
}

export async function treeSitterToStyledText(
  content: string,
  filetype: string,
  syntaxStyle: SyntaxStyle,
  client: TreeSitterClient,
  options?: TreeSitterToStyledTextOptions,
): Promise<StyledText> {
  const result = await client.highlightOnce(content, filetype)

  if (result.highlights && result.highlights.length > 0) {
    const chunks = treeSitterToTextChunks(content, result.highlights, syntaxStyle, options?.conceal)
    return new StyledText(chunks)
  } else {
    // No highlights available, return content with default styling
    const defaultStyle = syntaxStyle.mergeStyles("default")
    const chunks: TextChunk[] = [
      {
        __isChunk: true,
        text: content,
        fg: defaultStyle.fg,
        bg: defaultStyle.bg,
        attributes: defaultStyle.attributes,
      },
    ]
    return new StyledText(chunks)
  }
}
