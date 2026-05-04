import { ANSI } from "../ansi.js"
import { StyledText } from "../lib/styled-text.js"
import { parseColor, RGBA, type ColorInput } from "../lib/RGBA.js"
import { stringWidth } from "../platform/runtime.js"
import type { TextChunk } from "../text-buffer.js"
import { type RenderContext } from "../types.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"

export interface SequenceParticipant {
  id: string
  label: string
}

export interface SequenceMessage {
  from: string
  to: string
  label: string
  style: "solid" | "dashed"
}

export interface SequenceNote {
  over: string[]
  label: string
}

export type SequenceStep = { type: "message"; message: SequenceMessage } | { type: "note"; note: SequenceNote }

export interface SequenceDiagram {
  participants: SequenceParticipant[]
  messages: SequenceMessage[]
  steps: SequenceStep[]
}

export interface SequenceDiagramRenderOptions {
  minParticipantGap?: number
}

export type SequenceDiagramAnsiTheme = Partial<Record<AnsiSequenceCellStyle, string>>

export interface SequenceDiagramAnsiOptions extends SequenceDiagramRenderOptions {
  theme?: SequenceDiagramAnsiTheme
}

export interface SequenceDiagramOptions extends TextBufferOptions {
  content?: string
  minParticipantGap?: number
  participantColor?: ColorInput
  lifelineColor?: ColorInput
  requestColor?: ColorInput
  responseColor?: ColorInput
  noteColor?: ColorInput
  noteBackgroundColor?: ColorInput
}

type MessageStyle = "request" | "response"
type FadeStep = 1 | 2 | 3 | 4 | 5
type FadeStyle = `${MessageStyle}Fade${FadeStep}`
type AnsiSequenceCellStyle = "participant" | "lifeline" | MessageStyle | FadeStyle | "note"
type SequenceCellStyle = AnsiSequenceCellStyle | "noteBadge"
type Rgb = readonly [number, number, number]

interface SequenceCell {
  char: string
  style?: SequenceCellStyle
}

interface SequenceGrid {
  rows: SequenceCell[][]
}

type SequenceStyleColors = Partial<Record<AnsiSequenceCellStyle, RGBA>> & {
  noteBg?: RGBA
}

const DEFAULT_MIN_PARTICIPANT_GAP = 18
const NOTE_HORIZONTAL_PADDING = 1
const FADE_STEPS = [1, 2, 3, 4, 5] as const satisfies readonly FadeStep[]
const DEFAULT_THEME_RGB = {
  participant: [228, 239, 232],
  lifeline: [111, 138, 126],
  request: [134, 225, 200],
  response: [230, 177, 126],
  noteFg: [215, 229, 221],
  noteBg: [36, 56, 47],
} as const
const DEFAULT_ANSI_THEME: Required<Record<AnsiSequenceCellStyle, string>> = {
  participant: ansiFg(DEFAULT_THEME_RGB.participant),
  lifeline: ansiFg(DEFAULT_THEME_RGB.lifeline),
  request: ansiFg(DEFAULT_THEME_RGB.request),
  response: ansiFg(DEFAULT_THEME_RGB.response),
  note: `${ansiFg(DEFAULT_THEME_RGB.noteFg)}${ansiBg(DEFAULT_THEME_RGB.noteBg)}`,
  ...createAnsiFadeTheme("request", DEFAULT_THEME_RGB.lifeline, DEFAULT_THEME_RGB.request),
  ...createAnsiFadeTheme("response", DEFAULT_THEME_RGB.lifeline, DEFAULT_THEME_RGB.response),
}
const MESSAGE_RE = /^(.+?)\s*(-->>|->>|-->|->)\s*(.+?)\s*:\s*(.*)$/
const NOTE_RE = /^note\s+over\s+(.+?)\s*:\s*(.*)$/i
const PARTICIPANT_RE = /^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i

function mixChannel(left: number, right: number, amount: number): number {
  return Math.round(left + (right - left) * amount)
}

function mixRgb(left: Rgb, right: Rgb, amount: number): Rgb {
  return [
    mixChannel(left[0], right[0], amount),
    mixChannel(left[1], right[1], amount),
    mixChannel(left[2], right[2], amount),
  ]
}

function ansiFg(rgb: Rgb): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
}

function ansiBg(rgb: Rgb): string {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
}

function createAnsiFadeTheme(style: MessageStyle, from: Rgb, to: Rgb): Record<FadeStyle, string> {
  return Object.fromEntries(
    FADE_STEPS.map((step) => [`${style}Fade${step}`, ansiFg(mixRgb(from, to, step / (FADE_STEPS.length + 1)))]),
  ) as Record<FadeStyle, string>
}

function visualLength(value: string): number {
  return stringWidth(value)
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function ensureParticipant(
  participants: SequenceParticipant[],
  id: string,
  label: string = id,
  replaceExistingLabel: boolean = false,
): void {
  const existing = participants.find((participant) => participant.id === id)
  if (existing) {
    if (replaceExistingLabel) {
      existing.label = label
    }
    return
  }

  participants.push({ id, label })
}

export function isMermaidSequenceDiagram(content: string): boolean {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("%%")) continue
    return line.toLowerCase() === "sequencediagram"
  }

  return false
}

export function parseMermaidSequenceDiagram(content: string): SequenceDiagram {
  const participants: SequenceParticipant[] = []
  const messages: SequenceMessage[] = []
  const steps: SequenceStep[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("%%") || line.toLowerCase() === "sequencediagram") {
      continue
    }

    const participantMatch = line.match(PARTICIPANT_RE)
    if (participantMatch) {
      const id = stripQuotes(participantMatch[1]!)
      const label = stripQuotes(participantMatch[2] ?? id)
      ensureParticipant(participants, id, label, true)
      continue
    }

    const noteMatch = line.match(NOTE_RE)
    if (noteMatch) {
      const over = noteMatch[1]!
        .split(",")
        .map((participant) => stripQuotes(participant))
        .filter((participant) => participant.length > 0)
      const label = stripQuotes(noteMatch[2]!)

      for (const participant of over) {
        ensureParticipant(participants, participant)
      }

      steps.push({ type: "note", note: { over, label } })
      continue
    }

    const messageMatch = line.match(MESSAGE_RE)
    if (messageMatch) {
      const from = stripQuotes(messageMatch[1]!)
      const arrow = messageMatch[2]!
      const to = stripQuotes(messageMatch[3]!)
      const label = stripQuotes(messageMatch[4]!)

      ensureParticipant(participants, from)
      ensureParticipant(participants, to)
      const message: SequenceMessage = {
        from,
        to,
        label,
        style: arrow.startsWith("--") ? "dashed" : "solid",
      }
      messages.push(message)
      steps.push({ type: "message", message })
    }
  }

  return { participants, messages, steps }
}

function createGrid(width: number, height: number): SequenceGrid {
  return {
    rows: Array.from({ length: height }, () => Array.from({ length: width }, () => ({ char: " " }))),
  }
}

function setCell(grid: SequenceGrid, x: number, y: number, char: string, style?: SequenceCellStyle): void {
  if (!grid.rows[y]) return

  const cell = grid.rows[y]?.[x]
  if (!cell) return

  cell.char = char
  cell.style = style
}

function setText(grid: SequenceGrid, x: number, y: number, text: string, style?: SequenceCellStyle): void {
  if (!grid.rows[y]) return

  let currentX = Math.max(0, x)
  for (const char of text) {
    if (currentX >= grid.rows[y]!.length) break
    setCell(grid, currentX, y, char, style)
    currentX += 1
  }
}

function renderGridText(grid: SequenceGrid): string {
  return grid.rows
    .map((row) =>
      row
        .map((cell) => cell.char)
        .join("")
        .trimEnd(),
    )
    .join("\n")
}

function styleColor(style: SequenceCellStyle | undefined, colors: SequenceStyleColors): RGBA | undefined {
  if (style === "noteBadge") return colors.note
  return style ? colors[style] : undefined
}

function styleBackgroundColor(style: SequenceCellStyle | undefined, colors: SequenceStyleColors): RGBA | undefined {
  return style === "noteBadge" ? colors.noteBg : undefined
}

function blendColor(from: RGBA | undefined, to: RGBA | undefined, amount: number): RGBA | undefined {
  if (!from && !to) return undefined
  if (!from) return to
  if (!to) return from

  const [fromR, fromG, fromB, fromA] = from.toInts()
  const [toR, toG, toB, toA] = to.toInts()
  const mix = (left: number, right: number) => left + (right - left) * amount

  return RGBA.fromInts(mix(fromR, toR), mix(fromG, toG), mix(fromB, toB), mix(fromA, toA))
}

function colorsEqual(left?: RGBA, right?: RGBA): boolean {
  if (!left || !right) return left === right
  return left.equals(right)
}

function resolveSequenceStyleColors(colors: SequenceStyleColors): SequenceStyleColors {
  return {
    ...colors,
    requestFade1: blendColor(colors.lifeline, colors.request, 1 / 6),
    requestFade2: blendColor(colors.lifeline, colors.request, 2 / 6),
    requestFade3: blendColor(colors.lifeline, colors.request, 3 / 6),
    requestFade4: blendColor(colors.lifeline, colors.request, 4 / 6),
    requestFade5: blendColor(colors.lifeline, colors.request, 5 / 6),
    responseFade1: blendColor(colors.lifeline, colors.response, 1 / 6),
    responseFade2: blendColor(colors.lifeline, colors.response, 2 / 6),
    responseFade3: blendColor(colors.lifeline, colors.response, 3 / 6),
    responseFade4: blendColor(colors.lifeline, colors.response, 4 / 6),
    responseFade5: blendColor(colors.lifeline, colors.response, 5 / 6),
  }
}

function setArrowDepartureFade(
  grid: SequenceGrid,
  x: number,
  y: number,
  direction: 1 | -1,
  style: SequenceCellStyle,
): void {
  setCell(grid, x, y, direction === 1 ? "├" : "┤", `${style}Fade1` as SequenceCellStyle)
  for (let step = 2; step <= 5; step++) {
    setCell(grid, x + direction * (step - 1), y, "─", `${style}Fade${step}` as SequenceCellStyle)
  }
}

function styleAnsi(
  style: SequenceCellStyle | undefined,
  theme: Required<SequenceDiagramAnsiTheme>,
): string | undefined {
  if (style === "noteBadge") return theme.note
  return style ? theme[style] : undefined
}

function forEachGridRun(
  grid: SequenceGrid,
  onRun: (text: string, style: SequenceCellStyle | undefined) => void,
  onLineEnd: () => void,
): void {
  for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex++) {
    const row = grid.rows[rowIndex]!
    let rowEnd = row.length
    while (rowEnd > 0 && row[rowEnd - 1]?.char === " ") {
      rowEnd -= 1
    }

    let currentStyle: SequenceCellStyle | undefined
    let currentText = ""
    const flush = () => {
      if (!currentText) return
      onRun(currentText, currentStyle)
      currentText = ""
    }

    for (let x = 0; x < rowEnd; x++) {
      const cell = row[x]!
      if (cell.style !== currentStyle) {
        flush()
        currentStyle = cell.style
      }
      currentText += cell.char
    }

    flush()
    if (rowIndex < grid.rows.length - 1) onLineEnd()
  }
}

function renderGridAnsi(grid: SequenceGrid, theme: SequenceDiagramAnsiTheme = {}): string {
  const resolvedTheme = { ...DEFAULT_ANSI_THEME, ...theme }
  let output = ""

  forEachGridRun(
    grid,
    (text, style) => {
      const ansi = styleAnsi(style, resolvedTheme)
      output += ansi ? `${ansi}${text}${ANSI.reset}` : text
    },
    () => {
      output += "\n"
    },
  )

  return output
}

function renderGridStyledText(grid: SequenceGrid, colors: SequenceStyleColors): StyledText {
  const chunks: TextChunk[] = []

  forEachGridRun(
    grid,
    (text, style) => {
      chunks.push({
        __isChunk: true,
        text,
        fg: styleColor(style, colors),
        bg: styleBackgroundColor(style, colors),
      })
    },
    () => {
      chunks.push({ __isChunk: true, text: "\n" })
    },
  )

  return new StyledText(chunks)
}

function centeredStart(center: number, text: string): number {
  return center - Math.floor(visualLength(text) / 2)
}

function noteLabelText(label: string): string {
  const padding = " ".repeat(NOTE_HORIZONTAL_PADDING)
  return `${padding}${label}${padding}`
}

function messageLabelLines(label: string): string[] {
  const lines = label.split(/(?:<br\s*\/?\s*>|\\n)/i).map((line) => line.trimEnd())
  return lines.length > 0 ? lines : [""]
}

function messageLabelWidth(label: string): number {
  return messageLabelLines(label).reduce((max, line) => Math.max(max, visualLength(line)), 0)
}

function getStepHeight(step: SequenceStep): number {
  if (step.type === "note") return 3
  return messageLabelLines(step.message.label).length + 2
}

function createParticipantIndexMap(diagram: SequenceDiagram): Map<string, number> {
  return new Map(diagram.participants.map((participant, index) => [participant.id, index]))
}

function getParticipantIndexes(participantIndexes: Map<string, number>, participantIds: string[]): number[] {
  return participantIds
    .map((participantId) => participantIndexes.get(participantId) ?? -1)
    .filter((index) => index >= 0)
}

function resolveParticipantCenters(
  diagram: SequenceDiagram,
  participantIndexes: Map<string, number>,
  minParticipantGap: number,
): number[] {
  const gaps = Array.from({ length: Math.max(0, diagram.participants.length - 1) }, (_, index) => {
    const left = diagram.participants[index]!
    const right = diagram.participants[index + 1]!
    return Math.max(
      minParticipantGap,
      Math.ceil(visualLength(left.label) / 2) + Math.ceil(visualLength(right.label) / 2) + 6,
    )
  })

  for (const message of diagram.messages) {
    const fromIndex = participantIndexes.get(message.from) ?? -1
    const toIndex = participantIndexes.get(message.to) ?? -1
    if (fromIndex < 0 || toIndex < 0 || Math.abs(fromIndex - toIndex) !== 1) continue

    const gapIndex = Math.min(fromIndex, toIndex)
    gaps[gapIndex] = Math.max(gaps[gapIndex]!, messageLabelWidth(message.label) + 6)
  }

  for (const step of diagram.steps) {
    if (step.type !== "note") continue

    const indexes = getParticipantIndexes(participantIndexes, step.note.over)
    if (indexes.length !== 2 || Math.abs(indexes[0]! - indexes[1]!) !== 1) continue

    const gapIndex = Math.min(indexes[0]!, indexes[1]!)
    gaps[gapIndex] = Math.max(gaps[gapIndex]!, visualLength(noteLabelText(step.note.label)) + 4)
  }

  const centers: number[] = []
  const firstLabel = diagram.participants[0]?.label ?? ""
  centers[0] = Math.max(1, Math.ceil(visualLength(firstLabel) / 2))

  for (let i = 1; i < diagram.participants.length; i++) {
    centers[i] = centers[i - 1]! + gaps[i - 1]!
  }

  return centers
}

function layoutSequenceDiagram(content: string, options: SequenceDiagramRenderOptions = {}): SequenceGrid {
  const diagram = parseMermaidSequenceDiagram(content)
  if (diagram.participants.length === 0) return createGrid(0, 0)
  const participantIndexes = createParticipantIndexMap(diagram)

  const centers = resolveParticipantCenters(
    diagram,
    participantIndexes,
    options.minParticipantGap ?? DEFAULT_MIN_PARTICIPANT_GAP,
  )
  const lastParticipant = diagram.participants[diagram.participants.length - 1]!
  const width = centers[centers.length - 1]! + Math.ceil(visualLength(lastParticipant.label) / 2) + 1
  const height = Math.max(3, 3 + diagram.steps.reduce((total, step) => total + getStepHeight(step), 0))
  const grid = createGrid(width, height)

  for (let i = 0; i < diagram.participants.length; i++) {
    const participant = diagram.participants[i]!
    const center = centers[i]!
    setText(grid, centeredStart(center, participant.label), 0, participant.label, "participant")
    setText(
      grid,
      centeredStart(center, participant.label),
      1,
      "─".repeat(Math.max(3, visualLength(participant.label))),
      "lifeline",
    )
    setCell(grid, center, 1, "┬", "lifeline")

    for (let y = 2; y < height; y++) {
      setCell(grid, center, y, "│", "lifeline")
    }
  }

  let stepY = 3

  for (const step of diagram.steps) {
    if (step.type === "note") {
      const indexes = getParticipantIndexes(participantIndexes, step.note.over)
      if (indexes.length === 0) continue

      const leftX = centers[Math.min(...indexes)]!
      const rightX = centers[Math.max(...indexes)]!
      const centerX = Math.floor((leftX + rightX) / 2)
      const noteText = noteLabelText(step.note.label)
      const labelRow = stepY + 1
      setText(grid, centeredStart(centerX, noteText), labelRow, noteText, "noteBadge")
      stepY += getStepHeight(step)
      continue
    }

    const labelRow = stepY
    const message = step.message
    const messageStyle: SequenceCellStyle = message.style === "dashed" ? "response" : "request"
    const labelLines = messageLabelLines(message.label)
    const arrowRow = labelRow + labelLines.length
    const fromIndex = participantIndexes.get(message.from) ?? -1
    const toIndex = participantIndexes.get(message.to) ?? -1
    if (fromIndex < 0 || toIndex < 0) continue

    const fromX = centers[fromIndex]!
    const toX = centers[toIndex]!
    const leftX = Math.min(fromX, toX)
    const rightX = Math.max(fromX, toX)
    const labelStart = leftX + 2

    for (let lineIndex = 0; lineIndex < labelLines.length; lineIndex++) {
      setText(grid, labelStart, labelRow + lineIndex, labelLines[lineIndex]!, messageStyle)
    }

    for (let x = leftX + 1; x < rightX; x++) {
      setCell(grid, x, arrowRow, "─", messageStyle)
    }

    if (toX > fromX) {
      setArrowDepartureFade(grid, fromX, arrowRow, 1, messageStyle)
      setCell(grid, toX, arrowRow, "▶", messageStyle)
    } else {
      setArrowDepartureFade(grid, fromX, arrowRow, -1, messageStyle)
      setCell(grid, toX, arrowRow, "◀", messageStyle)
    }

    stepY += getStepHeight(step)
  }

  return grid
}

export function renderSequenceDiagram(content: string, options: SequenceDiagramRenderOptions = {}): string {
  return renderGridText(layoutSequenceDiagram(content, options))
}

export function renderSequenceDiagramAnsi(content: string, options: SequenceDiagramAnsiOptions = {}): string {
  return renderGridAnsi(layoutSequenceDiagram(content, options), options.theme)
}

export class SequenceDiagramRenderable extends TextBufferRenderable {
  private _content: string
  private _minParticipantGap: number
  private _participantColor?: RGBA
  private _lifelineColor?: RGBA
  private _requestColor?: RGBA
  private _responseColor?: RGBA
  private _noteColor?: RGBA
  private _noteBackgroundColor?: RGBA

  constructor(ctx: RenderContext, options: SequenceDiagramOptions = {}) {
    super(ctx, { ...options, wrapMode: options.wrapMode ?? "none" })
    this._content = options.content ?? ""
    this._minParticipantGap = options.minParticipantGap ?? DEFAULT_MIN_PARTICIPANT_GAP
    this._participantColor = options.participantColor ? parseColor(options.participantColor) : undefined
    this._lifelineColor = options.lifelineColor ? parseColor(options.lifelineColor) : undefined
    this._requestColor = options.requestColor ? parseColor(options.requestColor) : undefined
    this._responseColor = options.responseColor ? parseColor(options.responseColor) : undefined
    this._noteColor = options.noteColor ? parseColor(options.noteColor) : undefined
    this._noteBackgroundColor = options.noteBackgroundColor ? parseColor(options.noteBackgroundColor) : undefined
    this.updateDiagram()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content === value) return
    this._content = value
    this.updateDiagram()
  }

  get minParticipantGap(): number {
    return this._minParticipantGap
  }

  set minParticipantGap(value: number) {
    if (this._minParticipantGap === value) return
    this._minParticipantGap = value
    this.updateDiagram()
  }

  get participantColor(): RGBA | undefined {
    return this._participantColor
  }

  set participantColor(value: ColorInput | undefined) {
    this.setColor(this._participantColor, value, (color) => {
      this._participantColor = color
    })
  }

  get lifelineColor(): RGBA | undefined {
    return this._lifelineColor
  }

  set lifelineColor(value: ColorInput | undefined) {
    this.setColor(this._lifelineColor, value, (color) => {
      this._lifelineColor = color
    })
  }

  get requestColor(): RGBA | undefined {
    return this._requestColor
  }

  set requestColor(value: ColorInput | undefined) {
    this.setColor(this._requestColor, value, (color) => {
      this._requestColor = color
    })
  }

  get responseColor(): RGBA | undefined {
    return this._responseColor
  }

  set responseColor(value: ColorInput | undefined) {
    this.setColor(this._responseColor, value, (color) => {
      this._responseColor = color
    })
  }

  get noteColor(): RGBA | undefined {
    return this._noteColor
  }

  set noteColor(value: ColorInput | undefined) {
    this.setColor(this._noteColor, value, (color) => {
      this._noteColor = color
    })
  }

  get noteBackgroundColor(): RGBA | undefined {
    return this._noteBackgroundColor
  }

  set noteBackgroundColor(value: ColorInput | undefined) {
    this.setColor(this._noteBackgroundColor, value, (color) => {
      this._noteBackgroundColor = color
    })
  }

  private setColor(
    current: RGBA | undefined,
    value: ColorInput | undefined,
    assign: (color: RGBA | undefined) => void,
  ): void {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(current, next)) return
    assign(next)
    this.updateDiagram()
  }

  private updateDiagram(): void {
    const grid = layoutSequenceDiagram(this._content, { minParticipantGap: this._minParticipantGap })
    this.textBuffer.setStyledText(
      renderGridStyledText(
        grid,
        resolveSequenceStyleColors({
          participant: this._participantColor,
          lifeline: this._lifelineColor,
          request: this._requestColor,
          response: this._responseColor,
          note: this._noteColor,
          noteBg: this._noteBackgroundColor,
        }),
      ),
    )
    this.updateTextInfo()
    this.requestRender()
  }
}
