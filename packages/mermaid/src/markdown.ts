import {
  TextRenderable,
  createMarkdownCodeBlockRenderer,
  parseColor,
  type ColorInput,
  type MarkdownOptions,
  type MarkdownCodeBlockRenderer,
  type MouseEvent,
  type RenderContext,
  type RenderNodeContext,
  type RGBA,
  type StyledText,
} from "@opentui/core"
import { MermaidSyntaxError } from "./diagnostics.js"
import { DiagramCanvasSizeError } from "./core/canvas.js"
import { detectMermaidDiagram } from "./detect.js"
import { drawFlowchartDiagramGrid } from "./flowchart/drawing.js"
import { parseMermaidFlowchartDiagram } from "./flowchart/parser.js"
import { renderGridStyledText, resolveFlowchartStyleColors } from "./flowchart/style.js"
import { drawSequenceDiagramGrid } from "./sequence/drawing.js"
import { parseMermaidSequenceDiagram } from "./sequence/parser.js"
import { renderSequenceGridStyledText } from "./sequence/render-grid.js"
import { resolveSequenceStyleColors } from "./sequence/style.js"
import { drawStateDiagramGrid } from "./state/drawing.js"
import { parseMermaidStateDiagram } from "./state/parser.js"
import { renderStateGridStyledText } from "./state/render-grid.js"
import { resolveStateStyleColors } from "./state/style.js"

type DiagramKind = NonNullable<ReturnType<typeof detectMermaidDiagram>>

interface PreparedDiagram {
  readonly kind: DiagramKind
  readonly source: string
  readonly optionsKey: string
  readonly text: StyledText
  readonly height: number
}

interface ResolvedMermaidOptions {
  compact: boolean
  layoutMaxWidth: number
  key: string
  colors: Record<keyof NonNullable<MermaidMarkdownRendererOptions["colors"]>, RGBA | undefined>
}

export interface MermaidMarkdownRendererOptions {
  compact?: boolean
  /** Fold horizontal flowcharts that exceed this width. Defaults to 120 columns. */
  layoutMaxWidth?: number
  colors?: {
    text?: ColorInput
    primary?: ColorInput
    secondary?: ColorInput
    muted?: ColorInput
    warning?: ColorInput
    background?: ColorInput
  }
}

function resolveOptions(options: MermaidMarkdownRendererOptions): ResolvedMermaidOptions {
  const input = options.colors ?? {}
  const colors = {
    text: input.text === undefined ? undefined : parseColor(input.text),
    primary: input.primary === undefined ? undefined : parseColor(input.primary),
    secondary: input.secondary === undefined ? undefined : parseColor(input.secondary),
    muted: input.muted === undefined ? undefined : parseColor(input.muted),
    warning: input.warning === undefined ? undefined : parseColor(input.warning),
    background: input.background === undefined ? undefined : parseColor(input.background),
  }
  const layoutMaxWidth =
    options.layoutMaxWidth === undefined ? 120 : Math.max(1, Math.trunc(options.layoutMaxWidth))
  const key = `${options.compact === true ? 1 : 0}:${layoutMaxWidth}:${Object.values(colors)
    .map((value) => value?.toInts().join(",") ?? "")
    .join(":")}`
  return { compact: options.compact === true, layoutMaxWidth, key, colors }
}

class StaticDiagramRenderable extends TextRenderable {
  prepared: PreparedDiagram

  constructor(ctx: RenderContext, prepared: PreparedDiagram) {
    super(ctx, {
      content: prepared.text,
      width: "100%",
      height: prepared.height,
      wrapMode: "none",
      selectable: false,
      marginTop: 1,
      marginBottom: 1,
    })
    this.marginBottom = 1
    this.prepared = prepared
    let dragX: number | undefined
    this.onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      ctx.clearSelection()
      dragX = event.x
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseDrag = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (dragX === undefined) return
      const dx = event.x - dragX
      dragX = event.x
      if (dx) this.scrollX -= dx
    }
    this.onMouseDragEnd = (event: MouseEvent) => {
      dragX = undefined
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return
      dragX = undefined
      event.preventDefault()
      event.stopPropagation()
    }
    this.onMouseScroll = (event: MouseEvent) => {
      const scroll = event.scroll
      if (!scroll || (scroll.direction !== "left" && scroll.direction !== "right")) return
      event.preventDefault()
      event.stopPropagation()
    }
  }

  update(prepared: PreparedDiagram): void {
    this.prepared = prepared
    this.content = prepared.text
    this.height = prepared.height
    this.scrollX = this.scrollX
  }
}

function prepareDiagram(
  kind: DiagramKind,
  source: string,
  options: ResolvedMermaidOptions,
  layoutMaxWidth: number,
): PreparedDiagram {
  const colors = options.colors
  switch (kind) {
    case "flowchart": {
      const grid = drawFlowchartDiagramGrid(parseMermaidFlowchartDiagram(source), {
        compact: options.compact,
        layoutMaxWidth,
      })
      return preparedDiagram(
        kind,
        source,
        options.key,
        renderGridStyledText(
          grid,
          resolveFlowchartStyleColors({
            node: colors.primary,
            database: colors.primary,
            edge: colors.secondary,
            label: colors.text,
            group: colors.muted,
          }),
        ),
        grid.getTextHeight({ trimTop: true, trimBottom: true }),
      )
    }
    case "sequence": {
      const grid = drawSequenceDiagramGrid(parseMermaidSequenceDiagram(source), { compact: options.compact })
      return preparedDiagram(
        kind,
        source,
        options.key,
        renderSequenceGridStyledText(
          grid,
          resolveSequenceStyleColors({
            participant: colors.primary,
            lifeline: colors.muted,
            group: colors.secondary,
            request: colors.primary,
            response: colors.primary,
            fragment: colors.secondary,
            fragmentLabelBg: colors.background,
            note: colors.warning,
            noteBg: colors.background,
          }),
        ),
        grid.height,
      )
    }
    case "state": {
      const grid = drawStateDiagramGrid(parseMermaidStateDiagram(source))
      return preparedDiagram(
        kind,
        source,
        options.key,
        renderStateGridStyledText(
          grid,
          resolveStateStyleColors({
            state: colors.primary,
            composite: colors.muted,
            transition: colors.secondary,
            label: colors.text,
            noteBorder: colors.warning,
            noteText: colors.warning,
            noteConnector: colors.muted,
            start: colors.muted,
            end: colors.muted,
            choice: colors.secondary,
          }),
        ),
        grid.getTextHeight({ trimBottom: true }),
      )
    }
  }
}

function preparedDiagram(
  kind: DiagramKind,
  source: string,
  optionsKey: string,
  text: StyledText,
  height: number,
): PreparedDiagram {
  return { kind, source, optionsKey, text, height }
}

/** Create an OpenTUI Markdown node renderer for fenced Mermaid diagrams. */
export function createMermaidMarkdownRenderer(
  ctx: RenderContext,
  input: MermaidMarkdownRendererOptions | (() => MermaidMarkdownRendererOptions) = {},
): NonNullable<MarkdownOptions["renderNode"]> {
  return createMarkdownCodeBlockRenderer({ mermaid: createMermaidCodeBlockRenderer(ctx, input) })!
}

export function createMermaidCodeBlockRenderer(
  ctx: RenderContext,
  input: MermaidMarkdownRendererOptions | (() => MermaidMarkdownRendererOptions) = {},
): MarkdownCodeBlockRenderer {
  const staticOptions = typeof input === "function" ? undefined : resolveOptions(input)
  const dynamicInput = typeof input === "function" ? input : undefined
  return (token, context) => {
    const kind = detectMermaidDiagram(token.text)
    if (!kind) return undefined
    const options = staticOptions ?? resolveOptions(dynamicInput!())
    const layoutMaxWidth = Math.min(options.layoutMaxWidth, Math.max(1, Math.trunc(ctx.width)))
    const optionsKey = `${options.key}:${layoutMaxWidth}`
    const previous = context.previous instanceof StaticDiagramRenderable ? context.previous.prepared : undefined
    if (previous?.source === token.text && previous.optionsKey === optionsKey) return context.previous

    try {
      const prepared = prepareDiagram(kind, token.text, { ...options, key: optionsKey }, layoutMaxWidth)
      const diagram = reuseDiagram(ctx, prepared, context.previous)
      return diagram
    } catch (error) {
      if (error instanceof MermaidSyntaxError) {
        if (!context.streaming) return undefined
        if (!previous || previous.kind !== kind || !isStreamingRevision(previous.source, token.text)) return undefined
        return context.previous
      }
      if (error instanceof DiagramCanvasSizeError) return undefined
      throw error
    }
  }
}

function reuseDiagram(
  ctx: RenderContext,
  prepared: PreparedDiagram,
  previous: RenderNodeContext["previous"],
): StaticDiagramRenderable {
  if (!(previous instanceof StaticDiagramRenderable)) return new StaticDiagramRenderable(ctx, prepared)
  previous.update(prepared)
  return previous
}

function isStreamingRevision(previous: string, current: string): boolean {
  const leftLength = trailingContentLength(previous)
  const rightLength = trailingContentLength(current)
  const length = Math.min(leftLength, rightLength)
  for (let index = 0; index < length; index++) {
    if (previous.charCodeAt(index) !== current.charCodeAt(index)) return false
  }
  return true
}

function trailingContentLength(value: string): number {
  let end = value.length
  while (end > 0) {
    const code = value.charCodeAt(end - 1)
    if (code !== 9 && code !== 10 && code !== 11 && code !== 12 && code !== 13 && code !== 32) break
    end -= 1
  }
  return end
}
