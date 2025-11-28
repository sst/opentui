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

  // Reusable CodeRenderables (not recreated on rebuild)
  // These are created once and updated with new content to avoid expensive recreation
  private leftCodeRenderable: CodeRenderable | null = null
  private rightCodeRenderable: CodeRenderable | null = null

  // Lazy rebuild strategy: For split view, debounce diff rebuilds to avoid
  // expensive re-parsing and re-rendering on rapid changes (e.g., width changes).
  // CodeRenderables are reused and only their content is updated.
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null
  private readonly REBUILD_DEBOUNCE_MS = 150
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

  private scheduleRebuild(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer)
    }

    this.pendingRebuild = true
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null
      this.pendingRebuild = false
      this.buildView()
      this.requestRender()
    }, this.REBUILD_DEBOUNCE_MS)
  }

  public override destroyRecursively(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer)
      this.rebuildTimer = null
    }
    this.pendingRebuild = false
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
          lineNumbers.set(lineIndex, oldLineNum)
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
      // Update existing CodeRenderable
      this.leftCodeRenderable.content = content
      if (this._filetype !== undefined) {
        this.leftCodeRenderable.filetype = this._filetype
      }
      if (this._syntaxStyle !== undefined) {
        this.leftCodeRenderable.syntaxStyle = this._syntaxStyle
      }
      if (this._wrapMode !== undefined) {
        this.leftCodeRenderable.wrapMode = this._wrapMode
      }
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
    } else {
      // Update LineNumberRenderable metadata
      this.leftSide.setLineColors(lineColors)
      this.leftSide.setLineSigns(lineSigns)
      // Update width for unified view
      this.leftSide.width = "100%"
      // If rightSide exists and is added, remove it for unified view
      if (this.rightSide) {
        try {
          super.remove(this.rightSide.id)
        } catch (e) {
          // Already removed, ignore
        }
      }
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

    // Step 2: Build final content
    // Note: Wrapping is disabled in split view to maintain alignment
    const leftLineColors = new Map<number, string | RGBA>()
    const rightLineColors = new Map<number, string | RGBA>()
    const leftLineSigns = new Map<number, LineSign>()
    const rightLineSigns = new Map<number, LineSign>()
    const leftHideLineNumbers = new Set<number>()
    const rightHideLineNumbers = new Set<number>()
    const leftLineNumbers = new Map<number, number>()
    const rightLineNumbers = new Map<number, number>()

    leftLogicalLines.forEach((line, index) => {
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

    rightLogicalLines.forEach((line, index) => {
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

    const leftContentFinal = leftLogicalLines.map((l) => l.content).join("\n")
    const rightContentFinal = rightLogicalLines.map((l) => l.content).join("\n")

    console.log("\nFinal left lines:", leftContentFinal.split("\n").length)
    console.log("Final right lines:", rightContentFinal.split("\n").length)

    // Step 3: Create or reuse CodeRenderables
    // For split view, we create CodeRenderables once and reuse them on subsequent rebuilds.
    // This avoids expensive syntax highlighting re-initialization and maintains performance.
    if (!this.leftCodeRenderable) {
      const leftCodeOptions: any = {
        id: this.id ? `${this.id}-left-code` : undefined,
        content: leftContentFinal,
        filetype: this._filetype,
        wrapMode: "none", // Disable wrapping in split view to maintain alignment
        conceal: this._conceal,
        width: "100%",
        height: "100%",
      }

      if (this._syntaxStyle) {
        leftCodeOptions.syntaxStyle = this._syntaxStyle
      }

      this.leftCodeRenderable = new CodeRenderable(this.ctx, leftCodeOptions)
    } else {
      // Update existing CodeRenderable
      this.leftCodeRenderable.content = leftContentFinal
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
        content: rightContentFinal,
        filetype: this._filetype,
        wrapMode: "none", // Disable wrapping in split view to maintain alignment
        conceal: this._conceal,
        width: "100%",
        height: "100%",
      }

      if (this._syntaxStyle) {
        rightCodeOptions.syntaxStyle = this._syntaxStyle
      }

      this.rightCodeRenderable = new CodeRenderable(this.ctx, rightCodeOptions)
    } else {
      // Update existing CodeRenderable
      this.rightCodeRenderable.content = rightContentFinal
      if (this._filetype !== undefined) {
        this.rightCodeRenderable.filetype = this._filetype
      }
      if (this._syntaxStyle !== undefined) {
        this.rightCodeRenderable.syntaxStyle = this._syntaxStyle
      }
    }

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
    } else {
      // Update existing leftSide for split view
      this.leftSide.width = "50%"
      this.leftSide.setLineColors(leftLineColors)
      this.leftSide.setLineSigns(leftLineSigns)
      this.leftSide.setHideLineNumbers(leftHideLineNumbers)
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
    } else {
      // Update existing rightSide
      this.rightSide.setLineColors(rightLineColors)
      this.rightSide.setLineSigns(rightLineSigns)
      this.rightSide.setHideLineNumbers(rightHideLineNumbers)
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
      // Use debounced rebuild for split view, immediate for unified
      if (this._view === "split") {
        this.scheduleRebuild()
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
      // Use debounced rebuild for split view, immediate for unified
      if (this._view === "split") {
        this.scheduleRebuild()
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
      // Use debounced rebuild for split view, immediate for unified
      if (this._view === "split") {
        this.scheduleRebuild()
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
      // Use debounced rebuild for split view, immediate for unified
      if (this._view === "split") {
        this.scheduleRebuild()
      } else {
        this.buildView()
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
