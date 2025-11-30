import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"
import { CodeRenderable, type CodeOptions } from "./Code"
import {
  LineNumberRenderable,
  type LineSign,
  type LineColorConfig,
  type LineInlineHighlight,
} from "./LineNumberRenderable"
import { RGBA, parseColor } from "../lib/RGBA"
import { SyntaxStyle } from "../syntax-style"
import { parsePatch, diffChars, diffWordsWithSpace, type StructuredPatch } from "diff"
import { TextRenderable } from "./Text"

/** Represents a highlighted span within a line for word-level diff */
interface InlineHighlight {
  startCol: number
  endCol: number
  type: "added-word" | "removed-word"
}

/** Computes similarity between two strings (0.0 to 1.0) using character-level diff */
function computeLineSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.length === 0 && b.length === 0) return 1.0
  if (a.length === 0 || b.length === 0) return 0.0

  const changes = diffChars(a, b)
  let unchangedLength = 0
  for (const change of changes) {
    if (!change.added && !change.removed) {
      unchangedLength += change.value.length
    }
  }
  return unchangedLength / Math.max(a.length, b.length)
}

/** Computes word-level inline highlights for two strings */
function computeInlineHighlights(
  oldContent: string,
  newContent: string,
): { oldHighlights: InlineHighlight[]; newHighlights: InlineHighlight[] } {
  const changes = diffWordsWithSpace(oldContent, newContent)

  const oldHighlights: InlineHighlight[] = []
  const newHighlights: InlineHighlight[] = []
  let oldCol = 0
  let newCol = 0

  for (const change of changes) {
    const len = change.value.length
    if (change.added) {
      newHighlights.push({ startCol: newCol, endCol: newCol + len, type: "added-word" })
      newCol += len
    } else if (change.removed) {
      oldHighlights.push({ startCol: oldCol, endCol: oldCol + len, type: "removed-word" })
      oldCol += len
    } else {
      oldCol += len
      newCol += len
    }
  }

  return { oldHighlights, newHighlights }
}

interface LogicalLine {
  content: string
  lineNum?: number
  hideLineNumber?: boolean
  color?: string | RGBA
  sign?: LineSign
  type: "context" | "add" | "remove" | "empty"
  /** Inline highlights for word-level diff */
  inlineHighlights?: InlineHighlight[]
}

export interface DiffRenderableOptions extends RenderableOptions<DiffRenderable> {
  diff?: string
  view?: "unified" | "split"

  // CodeRenderable options
  filetype?: string
  syntaxStyle?: SyntaxStyle
  wrapMode?: "word" | "char" | "none"
  conceal?: boolean
  selectionBg?: string | RGBA
  selectionFg?: string | RGBA

  // LineNumberRenderable options
  showLineNumbers?: boolean
  lineNumberFg?: string | RGBA
  lineNumberBg?: string | RGBA

  // Diff styling
  addedBg?: string | RGBA
  removedBg?: string | RGBA
  contextBg?: string | RGBA
  addedContentBg?: string | RGBA
  removedContentBg?: string | RGBA
  contextContentBg?: string | RGBA
  addedSignColor?: string | RGBA
  removedSignColor?: string | RGBA
  addedLineNumberBg?: string | RGBA
  removedLineNumberBg?: string | RGBA

  // Word-level highlighting options
  /**
   * Enable word-level highlighting within modified lines.
   * When enabled, individual words/characters that changed are highlighted.
   * @default true
   */
  showWordHighlights?: boolean
  /**
   * Background color for added words within modified lines.
   * @default A brighter version of addedBg
   */
  addedWordBg?: string | RGBA
  /**
   * Background color for removed words within modified lines.
   * @default A brighter version of removedBg
   */
  removedWordBg?: string | RGBA
  /**
   * Minimum similarity threshold (0.0 to 1.0) for pairing lines.
   * Lines with similarity below this threshold are treated as separate add/remove.
   * @default 0.4
   */
  lineSimilarityThreshold?: number
}

export class DiffRenderable extends Renderable {
  private _diff: string
  private _view: "unified" | "split"
  private _parsedDiff: StructuredPatch | null = null
  private _parseError: Error | null = null

  // CodeRenderable options
  private _filetype?: string
  private _syntaxStyle?: SyntaxStyle
  private _wrapMode?: "word" | "char" | "none"
  private _conceal: boolean
  private _selectionBg?: RGBA
  private _selectionFg?: RGBA

  // LineNumberRenderable options
  private _showLineNumbers: boolean
  private _lineNumberFg: RGBA
  private _lineNumberBg: RGBA

  // Diff styling
  private _addedBg: RGBA
  private _removedBg: RGBA
  private _contextBg: RGBA
  private _addedContentBg: RGBA | null
  private _removedContentBg: RGBA | null
  private _contextContentBg: RGBA | null
  private _addedSignColor: RGBA
  private _removedSignColor: RGBA
  private _addedLineNumberBg: RGBA
  private _removedLineNumberBg: RGBA

  // Word-level highlighting
  private _showWordHighlights: boolean
  private _addedWordBg: RGBA
  private _removedWordBg: RGBA
  private _lineSimilarityThreshold: number

  // Child renderables - reused for both unified and split views
  // Unified view uses only leftSide, split view uses both leftSide and rightSide
  private leftSide: LineNumberRenderable | null = null
  private rightSide: LineNumberRenderable | null = null

  // Track whether renderables are currently in the render tree
  private leftSideAdded: boolean = false
  private rightSideAdded: boolean = false

  // Reusable CodeRenderables (not recreated on rebuild)
  // These are created once and updated with new content to avoid expensive recreation
  private leftCodeRenderable: CodeRenderable | null = null
  private rightCodeRenderable: CodeRenderable | null = null

  // Lazy rebuild strategy: For split view, use microtask to coalesce rebuilds.
  // This avoids expensive re-parsing and re-rendering on rapid changes (e.g., width changes).
  // CodeRenderables are reused and only their content is updated.
  private pendingRebuild: boolean = false

  // Error renderables for displaying parse errors
  private errorTextRenderable: TextRenderable | null = null
  private errorCodeRenderable: CodeRenderable | null = null

  constructor(ctx: RenderContext, options: DiffRenderableOptions) {
    super(ctx, {
      ...options,
      flexDirection: options.view === "split" ? "row" : "column",
    })

    this._diff = options.diff ?? ""
    this._view = options.view ?? "unified"

    // CodeRenderable options
    this._filetype = options.filetype
    this._syntaxStyle = options.syntaxStyle
    this._wrapMode = options.wrapMode
    this._conceal = options.conceal ?? true
    this._selectionBg = options.selectionBg ? parseColor(options.selectionBg) : undefined
    this._selectionFg = options.selectionFg ? parseColor(options.selectionFg) : undefined

    // LineNumberRenderable options
    this._showLineNumbers = options.showLineNumbers ?? true
    this._lineNumberFg = parseColor(options.lineNumberFg ?? "#888888")
    this._lineNumberBg = parseColor(options.lineNumberBg ?? "transparent")

    // Diff styling
    this._addedBg = parseColor(options.addedBg ?? "#1a4d1a")
    this._removedBg = parseColor(options.removedBg ?? "#4d1a1a")
    this._contextBg = parseColor(options.contextBg ?? "transparent")
    this._addedContentBg = options.addedContentBg ? parseColor(options.addedContentBg) : null
    this._removedContentBg = options.removedContentBg ? parseColor(options.removedContentBg) : null
    this._contextContentBg = options.contextContentBg ? parseColor(options.contextContentBg) : null
    this._addedSignColor = parseColor(options.addedSignColor ?? "#22c55e")
    this._removedSignColor = parseColor(options.removedSignColor ?? "#ef4444")
    this._addedLineNumberBg = parseColor(options.addedLineNumberBg ?? "transparent")
    this._removedLineNumberBg = parseColor(options.removedLineNumberBg ?? "transparent")

    // Word-level highlighting
    this._showWordHighlights = options.showWordHighlights ?? true
    this._lineSimilarityThreshold = options.lineSimilarityThreshold ?? 0.4
    // Default word highlight colors: brighter versions of the line colors
    this._addedWordBg = options.addedWordBg
      ? parseColor(options.addedWordBg)
      : this.brightenColor(this._addedBg, 1.5)
    this._removedWordBg = options.removedWordBg
      ? parseColor(options.removedWordBg)
      : this.brightenColor(this._removedBg, 1.5)

    // Only parse and build if diff is provided
    if (this._diff) {
      this.parseDiff()
      this.buildView()
    }
  }

  /**
   * Brightens a color by a given factor.
   * Used to create word highlight colors from line colors.
   */
  private brightenColor(color: RGBA, factor: number): RGBA {
    return RGBA.fromValues(
      Math.min(1, color.r * factor),
      Math.min(1, color.g * factor),
      Math.min(1, color.b * factor),
      color.a,
    )
  }

  /**
   * Processes a change block (consecutive removes and adds) with word-level highlighting.
   *
   * This method preserves the original positional pairing behavior for alignment
   * (first remove with first add, etc.) while adding word-level highlights for
   * lines that are similar enough to be considered modifications.
   *
   * The approach:
   * 1. Use positional pairing for alignment (as the original code did)
   * 2. Compute word highlights only when lines are similar enough
   */
  // Maximum lines in a change block before skipping word highlights.
  // Large blocks likely indicate bulk changes where word-level diffs aren't useful,
  // and computing them would cause unnecessary CPU usage.
  private static readonly MAX_WORD_HIGHLIGHT_BLOCK_SIZE = 50

  private processChangeBlockWithHighlights(
    removes: { content: string; lineNum: number }[],
    adds: { content: string; lineNum: number }[],
  ): { leftLines: LogicalLine[]; rightLines: LogicalLine[] } {
    const leftLines: LogicalLine[] = []
    const rightLines: LogicalLine[] = []

    // Use positional pairing (original behavior) for alignment
    const maxLength = Math.max(removes.length, adds.length)

    // Skip word highlights for large blocks to prevent CPU spikes
    const blockSize = removes.length + adds.length
    const shouldComputeWordHighlights =
      this._showWordHighlights && blockSize <= DiffRenderable.MAX_WORD_HIGHLIGHT_BLOCK_SIZE

    for (let j = 0; j < maxLength; j++) {
      const remove = j < removes.length ? removes[j] : null
      const add = j < adds.length ? adds[j] : null

      let leftHighlights: InlineHighlight[] = []
      let rightHighlights: InlineHighlight[] = []

      // Compute word highlights only when:
      // 1. Word highlights are enabled and block is small enough
      // 2. Both lines exist (positional pair)
      // 3. Lines are similar enough (above threshold)
      if (shouldComputeWordHighlights && remove && add) {
        const similarity = computeLineSimilarity(remove.content, add.content)
        if (similarity >= this._lineSimilarityThreshold) {
          const highlights = computeInlineHighlights(remove.content, add.content)
          leftHighlights = highlights.oldHighlights
          rightHighlights = highlights.newHighlights
        }
      }

      // Build left (old/remove) line
      if (remove) {
        leftLines.push({
          content: remove.content,
          lineNum: remove.lineNum,
          color: this._removedBg,
          sign: {
            after: " -",
            afterColor: this._removedSignColor,
          },
          type: "remove",
          inlineHighlights: leftHighlights,
        })
      } else {
        // Empty placeholder for alignment
        leftLines.push({
          content: "",
          hideLineNumber: true,
          type: "empty",
        })
      }

      // Build right (new/add) line
      if (add) {
        rightLines.push({
          content: add.content,
          lineNum: add.lineNum,
          color: this._addedBg,
          sign: {
            after: " +",
            afterColor: this._addedSignColor,
          },
          type: "add",
          inlineHighlights: rightHighlights,
        })
      } else {
        // Empty placeholder for alignment
        rightLines.push({
          content: "",
          hideLineNumber: true,
          type: "empty",
        })
      }
    }

    return { leftLines, rightLines }
  }

  private parseDiff(): void {
    if (!this._diff) {
      this._parsedDiff = null
      this._parseError = null
      return
    }

    try {
      // Use jsdiff's parsePatch to parse the diff string
      const patches = parsePatch(this._diff)

      if (patches.length === 0) {
        this._parsedDiff = null
        this._parseError = null
        return
      }

      // Use the first patch (most diffs have only one file)
      this._parsedDiff = patches[0]
      this._parseError = null
    } catch (error) {
      // Catch parsing errors from invalid diff format
      this._parsedDiff = null
      this._parseError = error instanceof Error ? error : new Error(String(error))
    }
  }

  private buildView(): void {
    // Never destroy anything - just update existing renderables or create new ones
    // Unified view uses leftSide only, split view uses both leftSide and rightSide

    // If there's a parse error, show error message instead
    if (this._parseError) {
      this.buildErrorView()
      return
    }

    if (!this._parsedDiff || this._parsedDiff.hunks.length === 0) {
      return
    }

    if (this._view === "unified") {
      this.buildUnifiedView()
    } else {
      this.buildSplitView()
    }
  }

  protected override onResize(width: number, height: number): void {
    super.onResize(width, height)

    // For split view with wrapping, rebuild on width changes to realign wrapped lines
    if (this._view === "split" && this._wrapMode !== "none" && this._wrapMode !== undefined) {
      this.requestRebuild()
    }
  }

  private requestRebuild(): void {
    if (this.pendingRebuild) {
      return
    }

    this.pendingRebuild = true
    queueMicrotask(() => {
      if (!this.isDestroyed && this.pendingRebuild) {
        this.pendingRebuild = false
        this.buildView()
        this.requestRender()
      }
    })
  }

  private rebuildView(): void {
    // Use microtask rebuild for split view, immediate for unified
    if (this._view === "split") {
      this.requestRebuild()
    } else {
      this.buildView()
    }
  }

  public override destroyRecursively(): void {
    this.pendingRebuild = false
    this.leftSideAdded = false
    this.rightSideAdded = false
    super.destroyRecursively()
  }

  /**
   * Create or update a CodeRenderable with the given content and options.
   * Reuses existing instances to avoid expensive recreation.
   */
  private buildErrorView(): void {
    // Ensure column layout for error view
    this.flexDirection = "column"

    // Remove any existing diff view renderables
    if (this.leftSide && this.leftSideAdded) {
      super.remove(this.leftSide.id)
      this.leftSideAdded = false
    }
    if (this.rightSide && this.rightSideAdded) {
      super.remove(this.rightSide.id)
      this.rightSideAdded = false
    }

    // Create or update error text renderable
    const errorMessage = `Error parsing diff: ${this._parseError?.message || "Unknown error"}\n`
    if (!this.errorTextRenderable) {
      this.errorTextRenderable = new TextRenderable(this.ctx, {
        id: this.id ? `${this.id}-error-text` : undefined,
        content: errorMessage,
        fg: "#ef4444",
        width: "100%",
        flexShrink: 0,
      })
      super.add(this.errorTextRenderable)
    } else {
      this.errorTextRenderable.content = errorMessage
      // Ensure it's in the render tree
      const errorTextIndex = this.getChildren().indexOf(this.errorTextRenderable)
      if (errorTextIndex === -1) {
        super.add(this.errorTextRenderable)
      }
    }

    // Create or update error code renderable to show the raw diff
    if (!this.errorCodeRenderable) {
      this.errorCodeRenderable = new CodeRenderable(this.ctx, {
        id: this.id ? `${this.id}-error-code` : undefined,
        content: this._diff,
        filetype: "diff",
        syntaxStyle: this._syntaxStyle ?? SyntaxStyle.create(),
        wrapMode: this._wrapMode,
        conceal: this._conceal,
        width: "100%",
        flexGrow: 1,
        flexShrink: 1,
      })
      super.add(this.errorCodeRenderable)
    } else {
      this.errorCodeRenderable.content = this._diff
      this.errorCodeRenderable.wrapMode = this._wrapMode ?? "none"
      if (this._syntaxStyle) {
        this.errorCodeRenderable.syntaxStyle = this._syntaxStyle
      }
      // Ensure it's in the render tree
      const errorCodeIndex = this.getChildren().indexOf(this.errorCodeRenderable)
      if (errorCodeIndex === -1) {
        super.add(this.errorCodeRenderable)
      }
    }
  }

  private createOrUpdateCodeRenderable(
    side: "left" | "right",
    content: string,
    wrapMode: "word" | "char" | "none" | undefined,
    drawUnstyledText?: boolean,
  ): CodeRenderable {
    const existingRenderable = side === "left" ? this.leftCodeRenderable : this.rightCodeRenderable

    if (!existingRenderable) {
      // Create new CodeRenderable
      const codeOptions: CodeOptions = {
        id: this.id ? `${this.id}-${side}-code` : undefined,
        content,
        filetype: this._filetype,
        wrapMode,
        conceal: this._conceal,
        syntaxStyle: this._syntaxStyle ?? SyntaxStyle.create(),
        width: "100%",
        height: "100%",
        ...(drawUnstyledText !== undefined && { drawUnstyledText }),
        ...(this._selectionBg !== undefined && { selectionBg: this._selectionBg }),
        ...(this._selectionFg !== undefined && { selectionFg: this._selectionFg }),
      }
      const newRenderable = new CodeRenderable(this.ctx, codeOptions)

      if (side === "left") {
        this.leftCodeRenderable = newRenderable
      } else {
        this.rightCodeRenderable = newRenderable
      }

      return newRenderable
    } else {
      // Update existing CodeRenderable
      existingRenderable.content = content
      existingRenderable.wrapMode = wrapMode ?? "none"
      if (drawUnstyledText !== undefined) {
        existingRenderable.drawUnstyledText = drawUnstyledText
      }
      if (this._filetype !== undefined) {
        existingRenderable.filetype = this._filetype
      }
      if (this._syntaxStyle !== undefined) {
        existingRenderable.syntaxStyle = this._syntaxStyle
      }
      if (this._selectionBg !== undefined) {
        existingRenderable.selectionBg = this._selectionBg
      }
      if (this._selectionFg !== undefined) {
        existingRenderable.selectionFg = this._selectionFg
      }

      return existingRenderable
    }
  }

  /**
   * Create or update a LineNumberRenderable side panel.
   * Handles both creation and updates, ensuring the side is properly added to the render tree.
   */
  private createOrUpdateSide(
    side: "left" | "right",
    target: CodeRenderable,
    lineColors: Map<number, string | RGBA | LineColorConfig>,
    lineSigns: Map<number, LineSign>,
    lineNumbers: Map<number, number>,
    hideLineNumbers: Set<number>,
    width: "50%" | "100%",
    inlineHighlights?: Map<number, LineInlineHighlight[]>,
  ): void {
    const sideRef = side === "left" ? this.leftSide : this.rightSide
    const addedFlag = side === "left" ? this.leftSideAdded : this.rightSideAdded

    if (!sideRef) {
      // Create new LineNumberRenderable
      const newSide = new LineNumberRenderable(this.ctx, {
        id: this.id ? `${this.id}-${side}` : undefined,
        target,
        fg: this._lineNumberFg,
        bg: this._lineNumberBg,
        lineColors,
        lineSigns,
        lineNumbers,
        lineNumberOffset: 0,
        hideLineNumbers,
        inlineHighlights,
        width,
        height: "100%",
      })
      newSide.showLineNumbers = this._showLineNumbers
      super.add(newSide)

      if (side === "left") {
        this.leftSide = newSide
        this.leftSideAdded = true
      } else {
        this.rightSide = newSide
        this.rightSideAdded = true
      }
    } else {
      // Update existing LineNumberRenderable
      sideRef.width = width
      sideRef.setLineColors(lineColors)
      sideRef.setLineSigns(lineSigns)
      sideRef.setLineNumbers(lineNumbers)
      sideRef.setHideLineNumbers(hideLineNumbers)
      if (inlineHighlights) {
        sideRef.setInlineHighlights(inlineHighlights)
      } else {
        sideRef.clearInlineHighlights()
      }

      // Ensure side is added if not already
      if (!addedFlag) {
        super.add(sideRef)
        if (side === "left") {
          this.leftSideAdded = true
        } else {
          this.rightSideAdded = true
        }
      }
    }
  }

  private buildUnifiedView(): void {
    if (!this._parsedDiff) return

    // Ensure column layout for unified view
    this.flexDirection = "column"

    // Remove error renderables if they exist
    if (this.errorTextRenderable) {
      const errorTextIndex = this.getChildren().indexOf(this.errorTextRenderable)
      if (errorTextIndex !== -1) {
        super.remove(this.errorTextRenderable.id)
      }
    }
    if (this.errorCodeRenderable) {
      const errorCodeIndex = this.getChildren().indexOf(this.errorCodeRenderable)
      if (errorCodeIndex !== -1) {
        super.remove(this.errorCodeRenderable.id)
      }
    }

    const contentLines: string[] = []
    const lineColors = new Map<number, string | RGBA | LineColorConfig>()
    const lineSigns = new Map<number, LineSign>()
    const lineNumbers = new Map<number, number>()
    const inlineHighlights = new Map<number, LineInlineHighlight[]>()

    let lineIndex = 0

    // Process each hunk
    for (const hunk of this._parsedDiff.hunks) {
      let oldLineNum = hunk.oldStart
      let newLineNum = hunk.newStart

      let i = 0
      while (i < hunk.lines.length) {
        const line = hunk.lines[i]
        const firstChar = line[0]
        const content = line.slice(1)

        if (firstChar === " ") {
          // Context line
          contentLines.push(content)
          const config: LineColorConfig = {
            gutter: this._lineNumberBg,
          }
          if (this._contextContentBg) {
            config.content = this._contextContentBg
          } else {
            config.content = this._contextBg
          }
          lineColors.set(lineIndex, config)
          lineNumbers.set(lineIndex, newLineNum)
          oldLineNum++
          newLineNum++
          lineIndex++
          i++
        } else if (firstChar === "\\") {
          // Skip "\ No newline at end of file"
          i++
        } else {
          // Collect consecutive removes and adds as a block
          const removes: { content: string; lineNum: number }[] = []
          const adds: { content: string; lineNum: number }[] = []

          while (i < hunk.lines.length) {
            const currentLine = hunk.lines[i]
            const currentChar = currentLine[0]

            if (currentChar === " " || currentChar === "\\") {
              break
            }

            const currentContent = currentLine.slice(1)

            if (currentChar === "-") {
              removes.push({ content: currentContent, lineNum: oldLineNum })
              oldLineNum++
            } else if (currentChar === "+") {
              adds.push({ content: currentContent, lineNum: newLineNum })
              newLineNum++
            }
            i++
          }

          // Process the block with word-level highlighting
          const processedBlock = this.processChangeBlockWithHighlights(removes, adds)

          // In unified view, output removes first, then adds
          // Collect lines from the processed block, preserving their highlights
          for (const leftLine of processedBlock.leftLines) {
            if (leftLine.type !== "empty") {
              contentLines.push(leftLine.content)
              const config: LineColorConfig = {
                gutter: this._removedLineNumberBg,
              }
              if (this._removedContentBg) {
                config.content = this._removedContentBg
              } else {
                config.content = this._removedBg
              }
              lineColors.set(lineIndex, config)
              lineSigns.set(lineIndex, {
                after: " -",
                afterColor: this._removedSignColor,
              })
              if (leftLine.lineNum !== undefined) {
                lineNumbers.set(lineIndex, leftLine.lineNum)
              }
              // Add word highlights for this line
              if (leftLine.inlineHighlights && leftLine.inlineHighlights.length > 0) {
                inlineHighlights.set(
                  lineIndex,
                  leftLine.inlineHighlights.map((h) => ({
                    startCol: h.startCol,
                    endCol: h.endCol,
                    bg: this._removedWordBg,
                  })),
                )
              }
              lineIndex++
            }
          }

          for (const rightLine of processedBlock.rightLines) {
            if (rightLine.type !== "empty") {
              contentLines.push(rightLine.content)
              const config: LineColorConfig = {
                gutter: this._addedLineNumberBg,
              }
              if (this._addedContentBg) {
                config.content = this._addedContentBg
              } else {
                config.content = this._addedBg
              }
              lineColors.set(lineIndex, config)
              lineSigns.set(lineIndex, {
                after: " +",
                afterColor: this._addedSignColor,
              })
              if (rightLine.lineNum !== undefined) {
                lineNumbers.set(lineIndex, rightLine.lineNum)
              }
              // Add word highlights for this line
              if (rightLine.inlineHighlights && rightLine.inlineHighlights.length > 0) {
                inlineHighlights.set(
                  lineIndex,
                  rightLine.inlineHighlights.map((h) => ({
                    startCol: h.startCol,
                    endCol: h.endCol,
                    bg: this._addedWordBg,
                  })),
                )
              }
              lineIndex++
            }
          }
        }
      }
    }

    const content = contentLines.join("\n")

    // Create or update CodeRenderable for left side (used for unified view)
    const codeRenderable = this.createOrUpdateCodeRenderable("left", content, this._wrapMode)

    // Create or update LineNumberRenderable (leftSide used for unified view)
    this.createOrUpdateSide(
      "left",
      codeRenderable,
      lineColors,
      lineSigns,
      lineNumbers,
      new Set<number>(),
      "100%",
      inlineHighlights.size > 0 ? inlineHighlights : undefined,
    )

    // Remove rightSide from render tree for unified view
    if (this.rightSide && this.rightSideAdded) {
      super.remove(this.rightSide.id)
      this.rightSideAdded = false
    }
  }

  private buildSplitView(): void {
    if (!this._parsedDiff) return

    // Ensure row layout for split view
    this.flexDirection = "row"

    // Remove error renderables if they exist
    if (this.errorTextRenderable) {
      const errorTextIndex = this.getChildren().indexOf(this.errorTextRenderable)
      if (errorTextIndex !== -1) {
        super.remove(this.errorTextRenderable.id)
      }
    }
    if (this.errorCodeRenderable) {
      const errorCodeIndex = this.getChildren().indexOf(this.errorCodeRenderable)
      if (errorCodeIndex !== -1) {
        super.remove(this.errorCodeRenderable.id)
      }
    }

    // Step 1: Build initial content without wrapping alignment
    const leftLogicalLines: LogicalLine[] = []
    const rightLogicalLines: LogicalLine[] = []

    // Process each hunk to build logical lines
    for (const hunk of this._parsedDiff.hunks) {
      let oldLineNum = hunk.oldStart
      let newLineNum = hunk.newStart

      let i = 0
      while (i < hunk.lines.length) {
        const line = hunk.lines[i]
        const firstChar = line[0]

        if (firstChar === " ") {
          // Context line - add to both sides
          const content = line.slice(1)
          leftLogicalLines.push({
            content,
            lineNum: oldLineNum,
            color: this._contextBg,
            type: "context",
          })
          rightLogicalLines.push({
            content,
            lineNum: newLineNum,
            color: this._contextBg,
            type: "context",
          })
          oldLineNum++
          newLineNum++
          i++
        } else if (firstChar === "\\") {
          // Skip "\ No newline at end of file"
          i++
        } else {
          // Collect consecutive removes and adds as a block
          const removes: { content: string; lineNum: number }[] = []
          const adds: { content: string; lineNum: number }[] = []

          while (i < hunk.lines.length) {
            const currentLine = hunk.lines[i]
            const currentChar = currentLine[0]

            if (currentChar === " " || currentChar === "\\") {
              break
            }

            const content = currentLine.slice(1)

            if (currentChar === "-") {
              removes.push({ content, lineNum: oldLineNum })
              oldLineNum++
            } else if (currentChar === "+") {
              adds.push({ content, lineNum: newLineNum })
              newLineNum++
            }
            i++
          }

          // Process the change block with word-level highlighting
          const processedBlock = this.processChangeBlockWithHighlights(removes, adds)

          // Add processed lines to output
          for (const leftLine of processedBlock.leftLines) {
            leftLogicalLines.push(leftLine)
          }
          for (const rightLine of processedBlock.rightLines) {
            rightLogicalLines.push(rightLine)
          }
        }
      }
    }

    // Step 2: Determine if we can do wrap-aware alignment
    // We need valid widths for wrap calculation, which requires a layout pass
    // On first build (from constructor), widths are 0, so we skip wrap alignment
    // and schedule a rebuild after layout
    const canDoWrapAlignment = this.width > 0 && (this._wrapMode === "word" || this._wrapMode === "char")

    const preLeftContent = leftLogicalLines.map((l) => l.content).join("\n")
    const preRightContent = rightLogicalLines.map((l) => l.content).join("\n")

    const effectiveWrapMode = canDoWrapAlignment ? this._wrapMode! : "none"

    // Create or update CodeRenderables with initial content
    const leftCodeRenderable = this.createOrUpdateCodeRenderable("left", preLeftContent, effectiveWrapMode, true)
    const rightCodeRenderable = this.createOrUpdateCodeRenderable("right", preRightContent, effectiveWrapMode, true)

    // Step 3: Align lines using lineInfo (if we can)
    let finalLeftLines: LogicalLine[]
    let finalRightLines: LogicalLine[]

    if (canDoWrapAlignment) {
      const leftLineInfo = leftCodeRenderable.lineInfo
      const rightLineInfo = rightCodeRenderable.lineInfo

      const leftSources = leftLineInfo.lineSources || []
      const rightSources = rightLineInfo.lineSources || []

      // Build visual count per logical line
      const leftVisualCounts = new Map<number, number>()
      const rightVisualCounts = new Map<number, number>()

      for (const logicalLine of leftSources) {
        leftVisualCounts.set(logicalLine, (leftVisualCounts.get(logicalLine) || 0) + 1)
      }
      for (const logicalLine of rightSources) {
        rightVisualCounts.set(logicalLine, (rightVisualCounts.get(logicalLine) || 0) + 1)
      }

      // Align by inserting padding to ensure both sides stay synchronized
      // Each logical line should start at the same visual position on both sides
      finalLeftLines = []
      finalRightLines = []

      let leftVisualPos = 0
      let rightVisualPos = 0

      for (let i = 0; i < leftLogicalLines.length; i++) {
        const leftLine = leftLogicalLines[i]
        const rightLine = rightLogicalLines[i]

        const leftVisualCount = leftVisualCounts.get(i) || 1
        const rightVisualCount = rightVisualCounts.get(i) || 1

        // Both logical lines should start at the same visual position
        // If they don't, add padding to whichever side is behind
        if (leftVisualPos < rightVisualPos) {
          const pad = rightVisualPos - leftVisualPos
          for (let p = 0; p < pad; p++) {
            finalLeftLines.push({ content: "", hideLineNumber: true, type: "empty" })
          }
          leftVisualPos += pad
        } else if (rightVisualPos < leftVisualPos) {
          const pad = leftVisualPos - rightVisualPos
          for (let p = 0; p < pad; p++) {
            finalRightLines.push({ content: "", hideLineNumber: true, type: "empty" })
          }
          rightVisualPos += pad
        }

        // Now add the actual content line
        finalLeftLines.push(leftLine)
        finalRightLines.push(rightLine)

        // Update visual positions
        leftVisualPos += leftVisualCount
        rightVisualPos += rightVisualCount
      }

      // Final padding to make totals equal
      if (leftVisualPos < rightVisualPos) {
        const pad = rightVisualPos - leftVisualPos
        for (let p = 0; p < pad; p++) {
          finalLeftLines.push({ content: "", hideLineNumber: true, type: "empty" })
        }
      } else if (rightVisualPos < leftVisualPos) {
        const pad = leftVisualPos - rightVisualPos
        for (let p = 0; p < pad; p++) {
          finalRightLines.push({ content: "", hideLineNumber: true, type: "empty" })
        }
      }
    } else {
      // Can't do wrap alignment yet (no width), use logical lines as-is
      finalLeftLines = leftLogicalLines
      finalRightLines = rightLogicalLines

      // If wrapMode is set but we can't align yet, onResize will trigger a rebuild
      // once widths are available (no manual scheduling needed here)
    }

    // Step 4: Build final content and metadata
    const leftLineColors = new Map<number, string | RGBA | LineColorConfig>()
    const rightLineColors = new Map<number, string | RGBA | LineColorConfig>()
    const leftLineSigns = new Map<number, LineSign>()
    const rightLineSigns = new Map<number, LineSign>()
    const leftHideLineNumbers = new Set<number>()
    const rightHideLineNumbers = new Set<number>()
    const leftLineNumbers = new Map<number, number>()
    const rightLineNumbers = new Map<number, number>()
    const leftInlineHighlights = new Map<number, LineInlineHighlight[]>()
    const rightInlineHighlights = new Map<number, LineInlineHighlight[]>()

    finalLeftLines.forEach((line, index) => {
      if (line.lineNum !== undefined) {
        leftLineNumbers.set(index, line.lineNum)
      }
      if (line.hideLineNumber) {
        leftHideLineNumbers.add(index)
      }
      if (line.type === "remove") {
        const config: LineColorConfig = {
          gutter: this._removedLineNumberBg,
        }
        if (this._removedContentBg) {
          config.content = this._removedContentBg
        } else {
          config.content = this._removedBg
        }
        leftLineColors.set(index, config)
      } else if (line.type === "context") {
        const config: LineColorConfig = {
          gutter: this._lineNumberBg,
        }
        if (this._contextContentBg) {
          config.content = this._contextContentBg
        } else {
          config.content = this._contextBg
        }
        leftLineColors.set(index, config)
      }
      if (line.sign) {
        leftLineSigns.set(index, line.sign)
      }
      // Add inline highlights for word-level diff
      if (line.inlineHighlights && line.inlineHighlights.length > 0) {
        leftInlineHighlights.set(
          index,
          line.inlineHighlights.map((h) => ({
            startCol: h.startCol,
            endCol: h.endCol,
            bg: this._removedWordBg,
          })),
        )
      }
    })

    finalRightLines.forEach((line, index) => {
      if (line.lineNum !== undefined) {
        rightLineNumbers.set(index, line.lineNum)
      }
      if (line.hideLineNumber) {
        rightHideLineNumbers.add(index)
      }
      if (line.type === "add") {
        const config: LineColorConfig = {
          gutter: this._addedLineNumberBg,
        }
        if (this._addedContentBg) {
          config.content = this._addedContentBg
        } else {
          config.content = this._addedBg
        }
        rightLineColors.set(index, config)
      } else if (line.type === "context") {
        const config: LineColorConfig = {
          gutter: this._lineNumberBg,
        }
        if (this._contextContentBg) {
          config.content = this._contextContentBg
        } else {
          config.content = this._contextBg
        }
        rightLineColors.set(index, config)
      }
      if (line.sign) {
        rightLineSigns.set(index, line.sign)
      }
      // Add inline highlights for word-level diff
      if (line.inlineHighlights && line.inlineHighlights.length > 0) {
        rightInlineHighlights.set(
          index,
          line.inlineHighlights.map((h) => ({
            startCol: h.startCol,
            endCol: h.endCol,
            bg: this._addedWordBg,
          })),
        )
      }
    })

    const leftContentFinal = finalLeftLines.map((l) => l.content).join("\n")
    const rightContentFinal = finalRightLines.map((l) => l.content).join("\n")

    // Step 5: Update CodeRenderables with final content
    leftCodeRenderable.content = leftContentFinal
    rightCodeRenderable.content = rightContentFinal

    // Create or update LineNumberRenderables (they wrap the CodeRenderables)
    // leftSide might already exist from unified view, so we reuse it
    this.createOrUpdateSide(
      "left",
      leftCodeRenderable,
      leftLineColors,
      leftLineSigns,
      leftLineNumbers,
      leftHideLineNumbers,
      "50%",
      leftInlineHighlights.size > 0 ? leftInlineHighlights : undefined,
    )
    this.createOrUpdateSide(
      "right",
      rightCodeRenderable,
      rightLineColors,
      rightLineSigns,
      rightLineNumbers,
      rightHideLineNumbers,
      "50%",
      rightInlineHighlights.size > 0 ? rightInlineHighlights : undefined,
    )
  }

  // Getters and setters
  public get diff(): string {
    return this._diff
  }

  public set diff(value: string) {
    if (this._diff !== value) {
      this._diff = value
      this.parseDiff()
      this.rebuildView()
    }
  }

  public get view(): "unified" | "split" {
    return this._view
  }

  public set view(value: "unified" | "split") {
    if (this._view !== value) {
      this._view = value
      this.flexDirection = value === "split" ? "row" : "column"
      // Always rebuild immediately when changing view mode
      this.buildView()
    }
  }

  public get filetype(): string | undefined {
    return this._filetype
  }

  public set filetype(value: string | undefined) {
    if (this._filetype !== value) {
      this._filetype = value
      this.rebuildView()
    }
  }

  public get syntaxStyle(): SyntaxStyle | undefined {
    return this._syntaxStyle
  }

  public set syntaxStyle(value: SyntaxStyle | undefined) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      this.rebuildView()
    }
  }

  public get wrapMode(): "word" | "char" | "none" | undefined {
    return this._wrapMode
  }

  public set wrapMode(value: "word" | "char" | "none" | undefined) {
    if (this._wrapMode !== value) {
      this._wrapMode = value

      // For unified view, directly update wrapMode on the CodeRenderable
      if (this._view === "unified" && this.leftCodeRenderable) {
        this.leftCodeRenderable.wrapMode = value ?? "none"
      } else if (this._view === "split") {
        // For split view, wrapMode affects alignment, so rebuild
        this.requestRebuild()
      }
    }
  }

  public get showLineNumbers(): boolean {
    return this._showLineNumbers
  }

  public set showLineNumbers(value: boolean) {
    if (this._showLineNumbers !== value) {
      this._showLineNumbers = value
      if (this.leftSide) {
        this.leftSide.showLineNumbers = value
      }
      if (this.rightSide) {
        this.rightSide.showLineNumbers = value
      }
    }
  }

  public get addedBg(): RGBA {
    return this._addedBg
  }

  public set addedBg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._addedBg !== parsed) {
      this._addedBg = parsed
      this.rebuildView()
    }
  }

  public get removedBg(): RGBA {
    return this._removedBg
  }

  public set removedBg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._removedBg !== parsed) {
      this._removedBg = parsed
      this.rebuildView()
    }
  }

  public get contextBg(): RGBA {
    return this._contextBg
  }

  public set contextBg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._contextBg !== parsed) {
      this._contextBg = parsed
      this.rebuildView()
    }
  }

  public get addedSignColor(): RGBA {
    return this._addedSignColor
  }

  public set addedSignColor(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._addedSignColor !== parsed) {
      this._addedSignColor = parsed
      this.rebuildView()
    }
  }

  public get removedSignColor(): RGBA {
    return this._removedSignColor
  }

  public set removedSignColor(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._removedSignColor !== parsed) {
      this._removedSignColor = parsed
      this.rebuildView()
    }
  }

  public get addedLineNumberBg(): RGBA {
    return this._addedLineNumberBg
  }

  public set addedLineNumberBg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._addedLineNumberBg !== parsed) {
      this._addedLineNumberBg = parsed
      this.rebuildView()
    }
  }

  public get removedLineNumberBg(): RGBA {
    return this._removedLineNumberBg
  }

  public set removedLineNumberBg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._removedLineNumberBg !== parsed) {
      this._removedLineNumberBg = parsed
      this.rebuildView()
    }
  }

  public get lineNumberFg(): RGBA {
    return this._lineNumberFg
  }

  public set lineNumberFg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._lineNumberFg !== parsed) {
      this._lineNumberFg = parsed
      this.rebuildView()
    }
  }

  public get lineNumberBg(): RGBA {
    return this._lineNumberBg
  }

  public set lineNumberBg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._lineNumberBg !== parsed) {
      this._lineNumberBg = parsed
      this.rebuildView()
    }
  }

  public get addedContentBg(): RGBA | null {
    return this._addedContentBg
  }

  public set addedContentBg(value: string | RGBA | null) {
    const parsed = value ? parseColor(value) : null
    if (this._addedContentBg !== parsed) {
      this._addedContentBg = parsed
      this.rebuildView()
    }
  }

  public get removedContentBg(): RGBA | null {
    return this._removedContentBg
  }

  public set removedContentBg(value: string | RGBA | null) {
    const parsed = value ? parseColor(value) : null
    if (this._removedContentBg !== parsed) {
      this._removedContentBg = parsed
      this.rebuildView()
    }
  }

  public get contextContentBg(): RGBA | null {
    return this._contextContentBg
  }

  public set contextContentBg(value: string | RGBA | null) {
    const parsed = value ? parseColor(value) : null
    if (this._contextContentBg !== parsed) {
      this._contextContentBg = parsed
      this.rebuildView()
    }
  }

  public get selectionBg(): RGBA | undefined {
    return this._selectionBg
  }

  public set selectionBg(value: string | RGBA | undefined) {
    const parsed = value ? parseColor(value) : undefined
    if (this._selectionBg !== parsed) {
      this._selectionBg = parsed
      if (this.leftCodeRenderable) {
        this.leftCodeRenderable.selectionBg = parsed
      }
      if (this.rightCodeRenderable) {
        this.rightCodeRenderable.selectionBg = parsed
      }
    }
  }

  public get selectionFg(): RGBA | undefined {
    return this._selectionFg
  }

  public set selectionFg(value: string | RGBA | undefined) {
    const parsed = value ? parseColor(value) : undefined
    if (this._selectionFg !== parsed) {
      this._selectionFg = parsed
      if (this.leftCodeRenderable) {
        this.leftCodeRenderable.selectionFg = parsed
      }
      if (this.rightCodeRenderable) {
        this.rightCodeRenderable.selectionFg = parsed
      }
    }
  }

  // Word-level highlighting getters and setters

  public get showWordHighlights(): boolean {
    return this._showWordHighlights
  }

  public set showWordHighlights(value: boolean) {
    if (this._showWordHighlights !== value) {
      this._showWordHighlights = value
      this.rebuildView()
    }
  }

  public get addedWordBg(): RGBA {
    return this._addedWordBg
  }

  public set addedWordBg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._addedWordBg !== parsed) {
      this._addedWordBg = parsed
      this.rebuildView()
    }
  }

  public get removedWordBg(): RGBA {
    return this._removedWordBg
  }

  public set removedWordBg(value: string | RGBA) {
    const parsed = parseColor(value)
    if (this._removedWordBg !== parsed) {
      this._removedWordBg = parsed
      this.rebuildView()
    }
  }

  public get lineSimilarityThreshold(): number {
    return this._lineSimilarityThreshold
  }

  public set lineSimilarityThreshold(value: number) {
    if (this._lineSimilarityThreshold !== value) {
      this._lineSimilarityThreshold = Math.max(0, Math.min(1, value))
      this.rebuildView()
    }
  }
}
