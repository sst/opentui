import { Renderable, type RenderableOptions } from "../Renderable"
import type { RenderContext } from "../types"
import { CodeRenderable } from "./Code"
import { LineNumberRenderable, type LineSign } from "./LineNumberRenderable"
import { RGBA, parseColor } from "../lib/RGBA"
import type { SyntaxStyle } from "../syntax-style"

export interface DiffLine {
  type: "context" | "add" | "remove"
  content: string
  oldLineNum?: number
  newLineNum?: number
}

export interface ParsedDiff {
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

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
  private _parsedDiff: ParsedDiff | null = null

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

  // Child renderables
  private leftSide: LineNumberRenderable | null = null
  private rightSide: LineNumberRenderable | null = null
  private unifiedView: LineNumberRenderable | null = null

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
    const lines = this._diff.split("\n")
    const diffLines: DiffLine[] = []
    let oldLineNum = 1
    let newLineNum = 1
    let inHunk = false

    for (const line of lines) {
      // Skip file headers (--- and +++)
      if (line.startsWith("---") || line.startsWith("+++")) {
        continue
      }

      // Parse hunk header (@@ -oldStart,oldCount +newStart,newCount @@)
      if (line.startsWith("@@")) {
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (match) {
          oldLineNum = parseInt(match[1], 10)
          newLineNum = parseInt(match[2], 10)
          inHunk = true
        }
        continue
      }

      if (!inHunk) continue

      if (line.startsWith("+")) {
        // Added line
        diffLines.push({
          type: "add",
          content: line.slice(1),
          newLineNum: newLineNum++,
        })
      } else if (line.startsWith("-")) {
        // Removed line
        diffLines.push({
          type: "remove",
          content: line.slice(1),
          oldLineNum: oldLineNum++,
        })
      } else if (line.startsWith(" ") || line === "") {
        // Context line
        diffLines.push({
          type: "context",
          content: line.slice(1),
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++,
        })
      }
    }

    // Determine the starting line numbers from the first line
    const firstLine = diffLines[0]
    const oldStart = firstLine?.oldLineNum ?? 1
    const newStart = firstLine?.newLineNum ?? 1

    this._parsedDiff = {
      oldStart: oldStart,
      newStart: newStart,
      lines: diffLines,
    }
  }

  private buildView(): void {
    // Clear existing children
    if (this.unifiedView) {
      this.unifiedView.destroyRecursively()
      this.unifiedView = null
    }
    if (this.leftSide) {
      this.leftSide.destroyRecursively()
      this.leftSide = null
    }
    if (this.rightSide) {
      this.rightSide.destroyRecursively()
      this.rightSide = null
    }

    if (!this._parsedDiff || this._parsedDiff.lines.length === 0) {
      return
    }

    if (this._view === "unified") {
      this.buildUnifiedView()
    } else {
      this.buildSplitView()
    }
  }

  private buildUnifiedView(): void {
    if (!this._parsedDiff) return

    const lines = this._parsedDiff.lines
    const content = lines.map((line) => line.content).join("\n")

    // Build line colors, signs, and custom line numbers
    const lineColors = new Map<number, string | RGBA>()
    const lineSigns = new Map<number, LineSign>()
    const hideLineNumbers = new Set<number>()
    const lineNumbers = new Map<number, number>()

    lines.forEach((line, index) => {
      if (line.type === "add") {
        lineColors.set(index, this._addedBg)
        lineSigns.set(index, {
          after: " +",
          afterColor: this._addedSignColor,
        })
        // Added lines show new line number
        if (line.newLineNum !== undefined) {
          lineNumbers.set(index, line.newLineNum)
        }
      } else if (line.type === "remove") {
        lineColors.set(index, this._removedBg)
        lineSigns.set(index, {
          after: " -",
          afterColor: this._removedSignColor,
        })
        // Removed lines show old line number
        if (line.oldLineNum !== undefined) {
          lineNumbers.set(index, line.oldLineNum)
        }
      } else {
        // Context lines can use either (they're the same)
        if (line.oldLineNum !== undefined) {
          lineNumbers.set(index, line.oldLineNum)
        }
      }
    })

    // Create CodeRenderable
    const codeOptions: any = {
      id: this.id ? `${this.id}-unified-code` : undefined,
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

    const codeRenderable = new CodeRenderable(this.ctx, codeOptions)

    // Wrap in LineNumberRenderable
    this.unifiedView = new LineNumberRenderable(this.ctx, {
      id: this.id ? `${this.id}-unified` : undefined,
      target: codeRenderable,
      fg: this._lineNumberFg,
      bg: this._lineNumberBg,
      lineColors,
      lineSigns,
      lineNumbers,
      lineNumberOffset: 0, // Not needed when using custom line numbers
      hideLineNumbers,
      width: "100%",
      height: "100%",
    })

    this.unifiedView.showLineNumbers = this._showLineNumbers
    super.add(this.unifiedView)
  }

  private buildSplitView(): void {
    if (!this._parsedDiff) return

    const lines = this._parsedDiff.lines

    // Build left side (old/removed) and right side (new/added)
    const leftLines: string[] = []
    const rightLines: string[] = []
    const leftLineColors = new Map<number, string | RGBA>()
    const rightLineColors = new Map<number, string | RGBA>()
    const leftLineSigns = new Map<number, LineSign>()
    const rightLineSigns = new Map<number, LineSign>()
    const leftHideLineNumbers = new Set<number>()
    const rightHideLineNumbers = new Set<number>()
    const leftLineNumbers = new Map<number, number>()
    const rightLineNumbers = new Map<number, number>()

    let leftIndex = 0
    let rightIndex = 0

    for (const line of lines) {
      if (line.type === "remove") {
        // Add to left only, add empty line to right
        leftLines.push(line.content)
        leftLineColors.set(leftIndex, this._removedBg)
        leftLineSigns.set(leftIndex, {
          after: " -",
          afterColor: this._removedSignColor,
        })
        if (line.oldLineNum !== undefined) {
          leftLineNumbers.set(leftIndex, line.oldLineNum)
        }
        leftIndex++

        rightLines.push("")
        rightHideLineNumbers.add(rightIndex)
        rightIndex++
      } else if (line.type === "add") {
        // Add to right only, add empty line to left
        rightLines.push(line.content)
        rightLineColors.set(rightIndex, this._addedBg)
        rightLineSigns.set(rightIndex, {
          after: " +",
          afterColor: this._addedSignColor,
        })
        if (line.newLineNum !== undefined) {
          rightLineNumbers.set(rightIndex, line.newLineNum)
        }
        rightIndex++

        leftLines.push("")
        leftHideLineNumbers.add(leftIndex)
        leftIndex++
      } else {
        // Context line - add to both
        leftLines.push(line.content)
        if (line.oldLineNum !== undefined) {
          leftLineNumbers.set(leftIndex, line.oldLineNum)
        }
        leftIndex++

        rightLines.push(line.content)
        if (line.newLineNum !== undefined) {
          rightLineNumbers.set(rightIndex, line.newLineNum)
        }
        rightIndex++
      }
    }

    const leftContent = leftLines.join("\n")
    const rightContent = rightLines.join("\n")

    // Create left side (old)
    const leftCodeOptions: any = {
      id: this.id ? `${this.id}-left-code` : undefined,
      content: leftContent,
      filetype: this._filetype,
      wrapMode: this._wrapMode,
      conceal: this._conceal,
      width: "100%",
      height: "100%",
    }

    if (this._syntaxStyle) {
      leftCodeOptions.syntaxStyle = this._syntaxStyle
    }

    const leftCodeRenderable = new CodeRenderable(this.ctx, leftCodeOptions)

    this.leftSide = new LineNumberRenderable(this.ctx, {
      id: this.id ? `${this.id}-left` : undefined,
      target: leftCodeRenderable,
      fg: this._lineNumberFg,
      bg: this._lineNumberBg,
      lineColors: leftLineColors,
      lineSigns: leftLineSigns,
      lineNumbers: leftLineNumbers,
      lineNumberOffset: 0, // Not needed when using custom line numbers
      hideLineNumbers: leftHideLineNumbers,
      width: "50%",
      height: "100%",
    })

    this.leftSide.showLineNumbers = this._showLineNumbers

    // Create right side (new)
    const rightCodeOptions: any = {
      id: this.id ? `${this.id}-right-code` : undefined,
      content: rightContent,
      filetype: this._filetype,
      wrapMode: this._wrapMode,
      conceal: this._conceal,
      width: "100%",
      height: "100%",
    }

    if (this._syntaxStyle) {
      rightCodeOptions.syntaxStyle = this._syntaxStyle
    }

    const rightCodeRenderable = new CodeRenderable(this.ctx, rightCodeOptions)

    this.rightSide = new LineNumberRenderable(this.ctx, {
      id: this.id ? `${this.id}-right` : undefined,
      target: rightCodeRenderable,
      fg: this._lineNumberFg,
      bg: this._lineNumberBg,
      lineColors: rightLineColors,
      lineSigns: rightLineSigns,
      lineNumbers: rightLineNumbers,
      lineNumberOffset: 0, // Not needed when using custom line numbers
      hideLineNumbers: rightHideLineNumbers,
      width: "50%",
      height: "100%",
    })

    this.rightSide.showLineNumbers = this._showLineNumbers

    super.add(this.leftSide)
    super.add(this.rightSide)
  }

  // Getters and setters
  public get diff(): string {
    return this._diff
  }

  public set diff(value: string) {
    if (this._diff !== value) {
      this._diff = value
      this.parseDiff()
      this.buildView()
    }
  }

  public get view(): "unified" | "split" {
    return this._view
  }

  public set view(value: "unified" | "split") {
    if (this._view !== value) {
      this._view = value
      this.flexDirection = value === "split" ? "row" : "column"
      this.buildView()
    }
  }

  public get filetype(): string | undefined {
    return this._filetype
  }

  public set filetype(value: string | undefined) {
    if (this._filetype !== value) {
      this._filetype = value
      this.buildView()
    }
  }

  public get syntaxStyle(): SyntaxStyle | undefined {
    return this._syntaxStyle
  }

  public set syntaxStyle(value: SyntaxStyle | undefined) {
    if (this._syntaxStyle !== value) {
      this._syntaxStyle = value
      this.buildView()
    }
  }

  public get wrapMode(): "word" | "char" | "none" | undefined {
    return this._wrapMode
  }

  public set wrapMode(value: "word" | "char" | "none" | undefined) {
    if (this._wrapMode !== value) {
      this._wrapMode = value
      this.buildView()
    }
  }

  public get showLineNumbers(): boolean {
    return this._showLineNumbers
  }

  public set showLineNumbers(value: boolean) {
    if (this._showLineNumbers !== value) {
      this._showLineNumbers = value
      if (this.unifiedView) {
        this.unifiedView.showLineNumbers = value
      }
      if (this.leftSide) {
        this.leftSide.showLineNumbers = value
      }
      if (this.rightSide) {
        this.rightSide.showLineNumbers = value
      }
    }
  }
}
