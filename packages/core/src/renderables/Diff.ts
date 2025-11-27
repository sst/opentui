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

    if (!this._parsedDiff || this._parsedDiff.hunks.length === 0) {
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
      lineNumberOffset: 0,
      hideLineNumbers: new Set<number>(),
      width: "100%",
      height: "100%",
    })

    this.unifiedView.showLineNumbers = this._showLineNumbers
    super.add(this.unifiedView)
  }

  private buildSplitView(): void {
    if (!this._parsedDiff) return

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

    // Process each hunk
    for (const hunk of this._parsedDiff.hunks) {
      let oldLineNum = hunk.oldStart
      let newLineNum = hunk.newStart

      // Process lines in the hunk and group consecutive changes for better alignment
      let i = 0
      while (i < hunk.lines.length) {
        const line = hunk.lines[i]
        const firstChar = line[0]

        if (firstChar === " ") {
          // Context line - add to both sides
          const content = line.slice(1)
          leftLines.push(content)
          leftLineNumbers.set(leftIndex, oldLineNum)
          leftIndex++
          oldLineNum++

          rightLines.push(content)
          rightLineNumbers.set(rightIndex, newLineNum)
          rightIndex++
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
            // Add remove line to left (or empty if no more removes)
            if (j < removes.length) {
              leftLines.push(removes[j].content)
              leftLineColors.set(leftIndex, this._removedBg)
              leftLineSigns.set(leftIndex, {
                after: " -",
                afterColor: this._removedSignColor,
              })
              leftLineNumbers.set(leftIndex, removes[j].lineNum)
            } else {
              leftLines.push("")
              leftHideLineNumbers.add(leftIndex)
            }
            leftIndex++

            // Add add line to right (or empty if no more adds)
            if (j < adds.length) {
              rightLines.push(adds[j].content)
              rightLineColors.set(rightIndex, this._addedBg)
              rightLineSigns.set(rightIndex, {
                after: " +",
                afterColor: this._addedSignColor,
              })
              rightLineNumbers.set(rightIndex, adds[j].lineNum)
            } else {
              rightLines.push("")
              rightHideLineNumbers.add(rightIndex)
            }
            rightIndex++
          }
        }
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
