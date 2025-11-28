import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"
import { CodeRenderable } from "./Code"
import { LineNumberRenderable, type LineSign } from "./LineNumberRenderable"
import { RGBA, parseColor } from "../lib/RGBA"
import type { SyntaxStyle } from "../syntax-style"
import { parsePatch, type StructuredPatch } from "diff"

export interface DiffRenderableOptions extends RenderableOptions<DiffRenderable> {
  diff?: string
  view?: "unified" | "split"

  // CodeRenderable options
  filetype?: string
  syntaxStyle?: SyntaxStyle
  wrapMode?: "word" | "char" | "none"
  conceal?: boolean

  // LineNumberRenderable options
  showLineNumbers?: boolean
  lineNumberFg?: string | RGBA
  lineNumberBg?: string | RGBA

  // Diff styling
  addedBg?: string | RGBA
  removedBg?: string | RGBA
  addedSignColor?: string | RGBA
  removedSignColor?: string | RGBA
}

export class DiffRenderable extends Renderable {
  private _diff: string
  private _view: "unified" | "split"
  private _parsedDiff: StructuredPatch | null = null

  // CodeRenderable options
  private _filetype?: string
  private _syntaxStyle?: SyntaxStyle
  private _wrapMode?: "word" | "char" | "none"
  private _conceal: boolean

  // LineNumberRenderable options
  private _showLineNumbers: boolean
  private _lineNumberFg: RGBA
  private _lineNumberBg: RGBA

  // Diff styling
  private _addedBg: RGBA
  private _removedBg: RGBA
  private _addedSignColor: RGBA
  private _removedSignColor: RGBA

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

    // LineNumberRenderable options
    this._showLineNumbers = options.showLineNumbers ?? true
    this._lineNumberFg = parseColor(options.lineNumberFg ?? "#888888")
    this._lineNumberBg = parseColor(options.lineNumberBg ?? "transparent")

    // Diff styling
    this._addedBg = parseColor(options.addedBg ?? "#1a4d1a")
    this._removedBg = parseColor(options.removedBg ?? "#4d1a1a")
    this._addedSignColor = parseColor(options.addedSignColor ?? "#22c55e")
    this._removedSignColor = parseColor(options.removedSignColor ?? "#ef4444")

    // Only parse and build if diff is provided
    if (this._diff) {
      this.parseDiff()
      this.buildView()
    }
  }

  private parseDiff(): void {
    if (!this._diff) {
      this._parsedDiff = null
      return
    }

    // Use jsdiff's parsePatch to parse the diff string
    const patches = parsePatch(this._diff)

    if (patches.length === 0) {
      this._parsedDiff = null
      return
    }

    // Use the first patch (most diffs have only one file)
    this._parsedDiff = patches[0]
  }

  private buildView(): void {
    // Never destroy anything - just update existing renderables or create new ones
    // Unified view uses leftSide only, split view uses both leftSide and rightSide

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

  public override destroyRecursively(): void {
    this.pendingRebuild = false
    this.leftSideAdded = false
    this.rightSideAdded = false
    super.destroyRecursively()
  }

  private buildUnifiedView(): void {
    if (!this._parsedDiff) return

    const contentLines: string[] = []
    const lineColors = new Map<number, string | RGBA>()
    const lineSigns = new Map<number, LineSign>()
    const lineNumbers = new Map<number, number>()

    let lineIndex = 0

    // Process each hunk
    for (const hunk of this._parsedDiff.hunks) {
      let oldLineNum = hunk.oldStart
      let newLineNum = hunk.newStart

      for (const line of hunk.lines) {
        const firstChar = line[0]
        const content = line.slice(1)

        if (firstChar === "+") {
          // Added line
          contentLines.push(content)
          lineColors.set(lineIndex, this._addedBg)
          lineSigns.set(lineIndex, {
            after: " +",
            afterColor: this._addedSignColor,
          })
          lineNumbers.set(lineIndex, newLineNum)
          newLineNum++
          lineIndex++
        } else if (firstChar === "-") {
          // Removed line
          contentLines.push(content)
          lineColors.set(lineIndex, this._removedBg)
          lineSigns.set(lineIndex, {
            after: " -",
            afterColor: this._removedSignColor,
          })
          lineNumbers.set(lineIndex, oldLineNum)
          oldLineNum++
          lineIndex++
        } else if (firstChar === " ") {
          // Context line
          contentLines.push(content)
          lineNumbers.set(lineIndex, newLineNum)
          oldLineNum++
          newLineNum++
          lineIndex++
        }
        // Skip "\ No newline at end of file" lines
      }
    }

    const content = contentLines.join("\n")

    // Create or reuse CodeRenderable for left side (used for unified view)
    if (!this.leftCodeRenderable) {
      const codeOptions: any = {
        id: this.id ? `${this.id}-left-code` : undefined,
        content,
        filetype: this._filetype,
        wrapMode: this._wrapMode,
        conceal: this._conceal,
        width: "100%",
        height: "100%",
      }
      if (this._syntaxStyle) {
        codeOptions.syntaxStyle = this._syntaxStyle
      }
      this.leftCodeRenderable = new CodeRenderable(this.ctx, codeOptions)
    } else {
      // Update existing CodeRenderable with unified view content
      this.leftCodeRenderable.content = content
      if (this._filetype !== undefined) {
        this.leftCodeRenderable.filetype = this._filetype
      }
      if (this._syntaxStyle !== undefined) {
        this.leftCodeRenderable.syntaxStyle = this._syntaxStyle
      }
      // Always update wrapMode for unified view (user's preference)
      this.leftCodeRenderable.wrapMode = this._wrapMode ?? "none"
    }

    // Create or update LineNumberRenderable (leftSide used for unified view)
    if (!this.leftSide) {
      this.leftSide = new LineNumberRenderable(this.ctx, {
        id: this.id ? `${this.id}-left` : undefined,
        target: this.leftCodeRenderable,
        fg: this._lineNumberFg,
        bg: this._lineNumberBg,
        lineColors,
        lineSigns,
        lineNumbers,
        lineNumberOffset: 0,
        hideLineNumbers: new Set<number>(),
        width: "100%",
        height: "100%",
      })
      this.leftSide.showLineNumbers = this._showLineNumbers
      super.add(this.leftSide)
      this.leftSideAdded = true
    } else {
      // Update LineNumberRenderable metadata
      this.leftSide.setLineColors(lineColors)
      this.leftSide.setLineSigns(lineSigns)
      this.leftSide.setLineNumbers(lineNumbers)
      this.leftSide.setHideLineNumbers(new Set<number>())
      // Update width for unified view
      this.leftSide.width = "100%"

      // Ensure leftSide is added if not already
      if (!this.leftSideAdded) {
        super.add(this.leftSide)
        this.leftSideAdded = true
      }
    }

    // Remove rightSide from render tree for unified view
    if (this.rightSide && this.rightSideAdded) {
      super.remove(this.rightSide.id)
      this.rightSideAdded = false
    }
  }

  private buildSplitView(): void {
    if (!this._parsedDiff) return

    // Step 1: Build initial content without wrapping alignment
    interface LogicalLine {
      content: string
      lineNum?: number
      hideLineNumber?: boolean
      color?: string | RGBA
      sign?: LineSign
      type: "context" | "add" | "remove" | "empty"
    }

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
            type: "context",
          })
          rightLogicalLines.push({
            content,
            lineNum: newLineNum,
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

          // Align the block: pair up removes and adds, padding as needed
          const maxLength = Math.max(removes.length, adds.length)

          for (let j = 0; j < maxLength; j++) {
            if (j < removes.length) {
              leftLogicalLines.push({
                content: removes[j].content,
                lineNum: removes[j].lineNum,
                color: this._removedBg,
                sign: {
                  after: " -",
                  afterColor: this._removedSignColor,
                },
                type: "remove",
              })
            } else {
              leftLogicalLines.push({
                content: "",
                hideLineNumber: true,
                type: "empty",
              })
            }

            if (j < adds.length) {
              rightLogicalLines.push({
                content: adds[j].content,
                lineNum: adds[j].lineNum,
                color: this._addedBg,
                sign: {
                  after: " +",
                  afterColor: this._addedSignColor,
                },
                type: "add",
              })
            } else {
              rightLogicalLines.push({
                content: "",
                hideLineNumber: true,
                type: "empty",
              })
            }
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

    if (!this.leftCodeRenderable) {
      const leftCodeOptions: any = {
        id: this.id ? `${this.id}-left-code` : undefined,
        content: preLeftContent,
        filetype: this._filetype,
        wrapMode: effectiveWrapMode,
        conceal: this._conceal,
        drawUnstyledText: true, // Force immediate lineInfo update
        width: "100%",
        height: "100%",
      }
      if (this._syntaxStyle) {
        leftCodeOptions.syntaxStyle = this._syntaxStyle
      }
      this.leftCodeRenderable = new CodeRenderable(this.ctx, leftCodeOptions)
    } else {
      this.leftCodeRenderable.content = preLeftContent
      this.leftCodeRenderable.wrapMode = effectiveWrapMode
      this.leftCodeRenderable.drawUnstyledText = true
      if (this._filetype !== undefined) {
        this.leftCodeRenderable.filetype = this._filetype
      }
      if (this._syntaxStyle !== undefined) {
        this.leftCodeRenderable.syntaxStyle = this._syntaxStyle
      }
    }

    if (!this.rightCodeRenderable) {
      const rightCodeOptions: any = {
        id: this.id ? `${this.id}-right-code` : undefined,
        content: preRightContent,
        filetype: this._filetype,
        wrapMode: effectiveWrapMode,
        conceal: this._conceal,
        drawUnstyledText: true, // Force immediate lineInfo update
        width: "100%",
        height: "100%",
      }
      if (this._syntaxStyle) {
        rightCodeOptions.syntaxStyle = this._syntaxStyle
      }
      this.rightCodeRenderable = new CodeRenderable(this.ctx, rightCodeOptions)
    } else {
      this.rightCodeRenderable.content = preRightContent
      this.rightCodeRenderable.wrapMode = effectiveWrapMode
      this.rightCodeRenderable.drawUnstyledText = true
      if (this._filetype !== undefined) {
        this.rightCodeRenderable.filetype = this._filetype
      }
      if (this._syntaxStyle !== undefined) {
        this.rightCodeRenderable.syntaxStyle = this._syntaxStyle
      }
    }

    // Step 3: Align lines using lineInfo (if we can)
    let finalLeftLines: LogicalLine[]
    let finalRightLines: LogicalLine[]

    if (canDoWrapAlignment) {
      const leftLineInfo = this.leftCodeRenderable.lineInfo
      const rightLineInfo = this.rightCodeRenderable.lineInfo

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
    const leftLineColors = new Map<number, string | RGBA>()
    const rightLineColors = new Map<number, string | RGBA>()
    const leftLineSigns = new Map<number, LineSign>()
    const rightLineSigns = new Map<number, LineSign>()
    const leftHideLineNumbers = new Set<number>()
    const rightHideLineNumbers = new Set<number>()
    const leftLineNumbers = new Map<number, number>()
    const rightLineNumbers = new Map<number, number>()

    finalLeftLines.forEach((line, index) => {
      if (line.lineNum !== undefined) {
        leftLineNumbers.set(index, line.lineNum)
      }
      if (line.hideLineNumber) {
        leftHideLineNumbers.add(index)
      }
      if (line.color) {
        leftLineColors.set(index, line.color)
      }
      if (line.sign) {
        leftLineSigns.set(index, line.sign)
      }
    })

    finalRightLines.forEach((line, index) => {
      if (line.lineNum !== undefined) {
        rightLineNumbers.set(index, line.lineNum)
      }
      if (line.hideLineNumber) {
        rightHideLineNumbers.add(index)
      }
      if (line.color) {
        rightLineColors.set(index, line.color)
      }
      if (line.sign) {
        rightLineSigns.set(index, line.sign)
      }
    })

    const leftContentFinal = finalLeftLines.map((l) => l.content).join("\n")
    const rightContentFinal = finalRightLines.map((l) => l.content).join("\n")

    // Step 5: Update CodeRenderables with final content
    this.leftCodeRenderable.content = leftContentFinal
    this.rightCodeRenderable.content = rightContentFinal

    // Create or update LineNumberRenderables (they wrap the CodeRenderables)
    // leftSide might already exist from unified view, so we reuse it
    if (!this.leftSide) {
      this.leftSide = new LineNumberRenderable(this.ctx, {
        id: this.id ? `${this.id}-left` : undefined,
        target: this.leftCodeRenderable,
        fg: this._lineNumberFg,
        bg: this._lineNumberBg,
        lineColors: leftLineColors,
        lineSigns: leftLineSigns,
        lineNumbers: leftLineNumbers,
        lineNumberOffset: 0,
        hideLineNumbers: leftHideLineNumbers,
        width: "50%",
        height: "100%",
      })
      this.leftSide.showLineNumbers = this._showLineNumbers
      super.add(this.leftSide)
      this.leftSideAdded = true
    } else {
      // Update existing leftSide for split view
      this.leftSide.width = "50%"
      this.leftSide.setLineColors(leftLineColors)
      this.leftSide.setLineSigns(leftLineSigns)
      this.leftSide.setLineNumbers(leftLineNumbers)
      this.leftSide.setHideLineNumbers(leftHideLineNumbers)

      // Ensure leftSide is added if not already
      if (!this.leftSideAdded) {
        super.add(this.leftSide)
        this.leftSideAdded = true
      }
    }

    if (!this.rightSide) {
      this.rightSide = new LineNumberRenderable(this.ctx, {
        id: this.id ? `${this.id}-right` : undefined,
        target: this.rightCodeRenderable,
        fg: this._lineNumberFg,
        bg: this._lineNumberBg,
        lineColors: rightLineColors,
        lineSigns: rightLineSigns,
        lineNumbers: rightLineNumbers,
        lineNumberOffset: 0,
        hideLineNumbers: rightHideLineNumbers,
        width: "50%",
        height: "100%",
      })
      this.rightSide.showLineNumbers = this._showLineNumbers
      super.add(this.rightSide)
      this.rightSideAdded = true
    } else {
      // Update existing rightSide
      this.rightSide.setLineColors(rightLineColors)
      this.rightSide.setLineSigns(rightLineSigns)
      this.rightSide.setLineNumbers(rightLineNumbers)
      this.rightSide.setHideLineNumbers(rightHideLineNumbers)

      // Re-add rightSide if it was removed (when switching from unified to split)
      if (!this.rightSideAdded) {
        super.add(this.rightSide)
        this.rightSideAdded = true
      }
    }
  }

  // Getters and setters
  public get diff(): string {
    return this._diff
  }

  public set diff(value: string) {
    if (this._diff !== value) {
      this._diff = value
      this.parseDiff()
      // Use microtask rebuild for split view, immediate for unified
      if (this._view === "split") {
        this.requestRebuild()
      } else {
        this.buildView()
      }
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
      // Use microtask rebuild for split view, immediate for unified
      if (this._view === "split") {
        this.requestRebuild()
      } else {
        this.buildView()
      }
    }
  }

  public get syntaxStyle(): SyntaxStyle | undefined {
    return this._syntaxStyle
  }

  public set syntaxStyle(value: SyntaxStyle | undefined) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      // Use microtask rebuild for split view, immediate for unified
      if (this._view === "split") {
        this.requestRebuild()
      } else {
        this.buildView()
      }
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
}
