import { Renderable } from "../Renderable"
import { BoxRenderable } from "./Box"
import type { RenderContext } from "../types"
import { DiffLineRenderable, type DiffLineClickInfo, type DiffLineRenderableOptions } from "./DiffLine"
import { DiffRenderable, type DiffRenderableOptions } from "./Diff"
import { RGBA } from "../lib/RGBA"
import { TextRenderable } from "./Text"

// Re-export for convenience
export { type DiffLineClickInfo }

interface ParsedDiffLine {
  content: string
  lineNumber?: number
  type: "add" | "remove" | "context" | "empty"
  side: "left" | "right" | "unified"
}

export type SlottableDiffOptions = DiffRenderableOptions & {
  gutterWidth?: number
  onLineClick?: (info: DiffLineClickInfo) => void
}

/**
 * A diff component that supports inserting slots (like comment boxes) between lines.
 *
 * Unlike `DiffRenderable` which uses a monolithic `CodeRenderable` internally,
 * this component renders each line as a separate `DiffLineRenderable`, allowing
 * arbitrary content to be inserted between any lines.
 *
 * @example
 * ```tsx
 * <slottable_diff
 *   diff={unifiedDiffString}
 *   view="unified"
 *   onLineClick={(info) => {
 *     // Insert comment box after clicked line
 *     diffRef.insertSlot(info.visualLineIndex, commentBoxRenderable)
 *   }}
 * />
 * ```
 */
export class SlottableDiffRenderable extends DiffRenderable {
  // Additional options specific to SlottableDiff
  private _gutterWidth: number
  private _onLineClick?: (info: DiffLineClickInfo) => void

  // Internal state for slots
  private _lines: DiffLineRenderable[] = []
  private _rowContainers: BoxRenderable[] = []
  private _slots: Map<number, Renderable> = new Map()
  private _parsedLines: ParsedDiffLine[] = []
  private _errorRenderable: TextRenderable | null = null

  constructor(ctx: RenderContext, options: SlottableDiffOptions) {
    super(ctx, {
      ...options,
      flexDirection: "column",
    })

    // Now safe to set these - buildView() already called by parent
    this._gutterWidth = options.gutterWidth ?? 5
    this._onLineClick = options.onLineClick

    this.buildView()
  }

  protected override buildView(): void {
    if (!this._lines) return

    if (this._parseError) {
      this.showErrorView()
      return
    }

    if (!this._parsedDiff || this._parsedDiff.hunks.length === 0) {
      return
    }

    // Always column layout for slottable
    this.flexDirection = "column"
    this.buildParsedLines()
    this.buildLines()
  }

  private buildParsedLines(): void {
    if (!this._parsedDiff) {
      this._parsedLines = []
      return
    }

    if (this._view === "unified") {
      this.buildUnifiedParsedLines()
    } else {
      this.buildSplitParsedLines()
    }
  }

  private buildUnifiedParsedLines(): void {
    if (!this._parsedDiff) return
    this._parsedLines = []

    let oldLineNum = 1
    let newLineNum = 1

    for (const hunk of this._parsedDiff.hunks) {
      oldLineNum = hunk.oldStart
      newLineNum = hunk.newStart

      for (const line of hunk.lines) {
        const prefix = line[0]
        const content = line.slice(1)

        if (prefix === "-") {
          this._parsedLines.push({
            content,
            lineNumber: oldLineNum++,
            type: "remove",
            side: "unified",
          })
        } else if (prefix === "+") {
          this._parsedLines.push({
            content,
            lineNumber: newLineNum++,
            type: "add",
            side: "unified",
          })
        } else {
          this._parsedLines.push({
            content,
            lineNumber: newLineNum,
            type: "context",
            side: "unified",
          })
          oldLineNum++
          newLineNum++
        }
      }
    }
  }

  private buildSplitParsedLines(): void {
    if (!this._parsedDiff) return
    this._parsedLines = []

    let oldLineNum = 1
    let newLineNum = 1

    for (const hunk of this._parsedDiff.hunks) {
      oldLineNum = hunk.oldStart
      newLineNum = hunk.newStart

      const pendingRemoves: ParsedDiffLine[] = []
      const pendingAdds: ParsedDiffLine[] = []

      const flushPending = () => {
        while (pendingRemoves.length > 0 || pendingAdds.length > 0) {
          const leftLine = pendingRemoves.shift()
          const rightLine = pendingAdds.shift()

          if (leftLine) {
            this._parsedLines.push(leftLine)
          } else {
            this._parsedLines.push({
              content: "",
              type: "empty",
              side: "left",
            })
          }

          if (rightLine) {
            this._parsedLines.push(rightLine)
          } else {
            this._parsedLines.push({
              content: "",
              type: "empty",
              side: "right",
            })
          }
        }
      }

      for (const line of hunk.lines) {
        const prefix = line[0]
        const content = line.slice(1)

        if (prefix === "-") {
          pendingRemoves.push({
            content,
            lineNumber: oldLineNum++,
            type: "remove",
            side: "left",
          })
        } else if (prefix === "+") {
          pendingAdds.push({
            content,
            lineNumber: newLineNum++,
            type: "add",
            side: "right",
          })
        } else {
          flushPending()
          // Context line - same on both sides
          this._parsedLines.push({
            content,
            lineNumber: oldLineNum++,
            type: "context",
            side: "left",
          })
          this._parsedLines.push({
            content,
            lineNumber: newLineNum++,
            type: "context",
            side: "right",
          })
        }
      }

      flushPending()
    }
  }

  private buildLines(): void {
    this.clearLines()

    if (!this._parsedDiff) return

    if (this._view === "unified") {
      // Unified view: each line is full width with slot potential
      let visualIndex = 0
      for (const line of this._parsedLines) {
        const lineRenderable = this.createLineRenderable(line, visualIndex)
        this._lines.push(lineRenderable)
        this.add(lineRenderable)

        // Check if there's a slot after this line
        const slot = this._slots.get(visualIndex)
        if (slot) {
          this.add(slot)
        }

        visualIndex++
      }
    } else {
      // Split view: pair left+right lines in rows
      let visualIndex = 0
      for (let i = 0; i < this._parsedLines.length; i += 2) {
        const leftLine = this._parsedLines[i]
        const rightLine = this._parsedLines[i + 1]

        // Create row container
        const rowContainer = new BoxRenderable(this.ctx, {
          id: `${this.id}-row-${visualIndex}`,
          flexDirection: "row",
          width: "100%",
        })
        this._rowContainers.push(rowContainer)

        if (leftLine) {
          const leftRenderable = this.createLineRenderable(leftLine, visualIndex)
          this._lines.push(leftRenderable)
          rowContainer.add(leftRenderable)
        }

        if (rightLine) {
          const rightRenderable = this.createLineRenderable(rightLine, visualIndex)
          this._lines.push(rightRenderable)
          rowContainer.add(rightRenderable)
        }

        this.add(rowContainer)

        // Check if there's a slot after this row
        const slot = this._slots.get(visualIndex)
        if (slot) {
          this.add(slot)
        }

        visualIndex++
      }
    }
  }

  private createLineRenderable(line: ParsedDiffLine, visualIndex: number): DiffLineRenderable {
    const lineOptions: DiffLineRenderableOptions = {
      id: `${this.id}-line-${visualIndex}-${line.side}`,
      content: line.content,
      lineNumber: line.lineNumber,
      type: line.type,
      side: line.side,
      showLineNumber: this._showLineNumbers && line.type !== "empty",
      lineBg: this.getLineBg(line.type),
      lineFg: this._fg,
      signText: this.getSignText(line.type),
      signColor: this.getSignColor(line.type),
      gutterBg: this.getGutterBg(line.type),
      gutterFg: this._lineNumberFg,
      gutterWidth: this._gutterWidth,
      visualLineIndex: visualIndex,
      onClick: this._onLineClick,
      width: this._view === "split" ? "50%" : "100%",
      filetype: this._filetype,
      syntaxStyle: this._syntaxStyle,
    }

    return new DiffLineRenderable(this.ctx, lineOptions)
  }

  private getLineBg(type: ParsedDiffLine["type"]): RGBA {
    switch (type) {
      case "add":
        return this._addedBg
      case "remove":
        return this._removedBg
      case "context":
        return this._contextBg
      case "empty":
        return this._contextBg
    }
  }

  private getGutterBg(type: ParsedDiffLine["type"]): RGBA {
    switch (type) {
      case "add":
        return this._addedLineNumberBg
      case "remove":
        return this._removedLineNumberBg
      default:
        return this._lineNumberBg
    }
  }

  private getSignText(type: ParsedDiffLine["type"]): string | undefined {
    switch (type) {
      case "add":
        return "+"
      case "remove":
        return "-"
      default:
        return " "
    }
  }

  private getSignColor(type: ParsedDiffLine["type"]): RGBA | undefined {
    switch (type) {
      case "add":
        return this._addedSignColor
      case "remove":
        return this._removedSignColor
      default:
        return undefined
    }
  }

  private showErrorView(): void {
    this._errorRenderable = new TextRenderable(this.ctx, {
      id: `${this.id}-error`,
      content: `Error parsing diff: ${this._parseError?.message}`,
      fg: "#ef4444",
    })
    this.add(this._errorRenderable)
  }

  private clearLines(): void {
    // Remove all line renderables
    for (const line of this._lines) {
      this.remove(line.id)
      line.destroy()
    }
    this._lines = []

    // Remove row containers (for split view)
    for (const row of this._rowContainers) {
      this.remove(row.id)
      row.destroy()
    }
    this._rowContainers = []

    // Remove error renderable if present
    if (this._errorRenderable) {
      this.remove(this._errorRenderable.id)
      this._errorRenderable.destroy()
      this._errorRenderable = null
    }
  }

  public insertSlot(afterLineIndex: number, slot: Renderable): void {
    this.removeSlot(afterLineIndex)
    this._slots.set(afterLineIndex, slot)

    this.buildLines()
    this.requestRender()
  }

  public removeSlot(afterLineIndex: number): void {
    const slot = this._slots.get(afterLineIndex)
    if (slot) {
      this.remove(slot.id)
      slot.destroy()
      this._slots.delete(afterLineIndex)
      this.buildLines()
      this.requestRender()
    }
  }

  public hasSlot(afterLineIndex: number): boolean {
    return this._slots.has(afterLineIndex)
  }

  public getSlot(afterLineIndex: number): Renderable | undefined {
    return this._slots.get(afterLineIndex)
  }

  public clearAllSlots(): void {
    for (const [, slot] of this._slots) {
      this.remove(slot.id)
      slot.destroy()
    }
    this._slots.clear()
    this.buildLines()
    this.requestRender()
  }

  public lineCount(): number {
    return this._view === "unified" ? this._parsedLines.length : Math.ceil(this._parsedLines.length / 2)
  }

  get gutterWidth(): number {
    return this._gutterWidth
  }

  set gutterWidth(value: number) {
    if (this._gutterWidth !== value) {
      this._gutterWidth = value
      this.buildLines()
      this.requestRender()
    }
  }

  get onLineClick(): ((info: DiffLineClickInfo) => void) | undefined {
    return this._onLineClick
  }

  set onLineClick(value: ((info: DiffLineClickInfo) => void) | undefined) {
    this._onLineClick = value
    // Update all line renderables
    for (const line of this._lines) {
      line.onClick = value
    }
  }
}
