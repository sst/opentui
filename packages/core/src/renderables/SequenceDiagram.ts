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
  noteStyle?: SequenceNoteStyle
}

export interface SequenceDiagramAnsiTheme {
  participant?: string
  lifeline?: string
  requestFade1?: string
  requestFade2?: string
  requestFade3?: string
  requestFade4?: string
  requestFade5?: string
  request?: string
  responseFade1?: string
  responseFade2?: string
  responseFade3?: string
  responseFade4?: string
  responseFade5?: string
  response?: string
  note?: string
}

export interface SequenceDiagramAnsiOptions extends SequenceDiagramRenderOptions {
  theme?: SequenceDiagramAnsiTheme
}

export interface SequenceDiagramOptions extends TextBufferOptions {
  content?: string
  minParticipantGap?: number
  noteStyle?: SequenceNoteStyle
  participantColor?: ColorInput
  lifelineColor?: ColorInput
  requestColor?: ColorInput
  responseColor?: ColorInput
  noteColor?: ColorInput
  noteBackgroundColor?: ColorInput
}

type SequenceCellStyle =
  | "participant"
  | "lifeline"
  | "requestFade1"
  | "requestFade2"
  | "requestFade3"
  | "requestFade4"
  | "requestFade5"
  | "request"
  | "responseFade1"
  | "responseFade2"
  | "responseFade3"
  | "responseFade4"
  | "responseFade5"
  | "response"
  | "note"
  | "noteBadge"

export type SequenceNoteStyle = "badge" | "plain" | "rule"

interface SequenceCell {
  char: string
  style?: SequenceCellStyle
}

interface SequenceGrid {
  rows: SequenceCell[][]
}

interface SequenceStyleColors {
  participant?: RGBA
  lifeline?: RGBA
  requestFade1?: RGBA
  requestFade2?: RGBA
  requestFade3?: RGBA
  requestFade4?: RGBA
  requestFade5?: RGBA
  request?: RGBA
  responseFade1?: RGBA
  responseFade2?: RGBA
  responseFade3?: RGBA
  responseFade4?: RGBA
  responseFade5?: RGBA
  response?: RGBA
  note?: RGBA
  noteBg?: RGBA
}

const DEFAULT_MIN_PARTICIPANT_GAP = 18
const DEFAULT_NOTE_STYLE: SequenceNoteStyle = "badge"
const NOTE_HORIZONTAL_PADDING = 1
const DEFAULT_ANSI_THEME: Required<SequenceDiagramAnsiTheme> = {
  participant: "\x1b[38;2;228;239;232m",
  lifeline: "\x1b[38;2;111;138;126m",
  requestFade1: "\x1b[38;2;115;153;138m",
  requestFade2: "\x1b[38;2;119;167;151m",
  requestFade3: "\x1b[38;2;123;182;163m",
  requestFade4: "\x1b[38;2;126;196;175m",
  requestFade5: "\x1b[38;2;130;211;188m",
  request: "\x1b[38;2;134;225;200m",
  responseFade1: "\x1b[38;2;131;145;126m",
  responseFade2: "\x1b[38;2;151;151;126m",
  responseFade3: "\x1b[38;2;171;158;126m",
  responseFade4: "\x1b[38;2;190;164;126m",
  responseFade5: "\x1b[38;2;210;171;126m",
  response: "\x1b[38;2;230;177;126m",
  note: "\x1b[38;2;215;229;221m\x1b[48;2;36;56;47m",
}
const MESSAGE_RE = /^(.+?)\s*(-->>|->>|-->|->)\s*(.+?)\s*:\s*(.*)$/
const NOTE_RE = /^note\s+over\s+(.+?)\s*:\s*(.*)$/i
const PARTICIPANT_RE = /^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i

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

function renderGridAnsi(grid: SequenceGrid, theme: SequenceDiagramAnsiTheme = {}): string {
  const resolvedTheme = { ...DEFAULT_ANSI_THEME, ...theme }
  let output = ""

  for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex++) {
    const row = grid.rows[rowIndex]!
    let rowEnd = row.length
    while (rowEnd > 0 && row[rowEnd - 1]?.char === " ") {
      rowEnd -= 1
    }

    let activeAnsi: string | undefined

    for (let x = 0; x < rowEnd; x++) {
      const cell = row[x]!
      const nextAnsi = styleAnsi(cell.style, resolvedTheme)
      if (nextAnsi !== activeAnsi) {
        if (activeAnsi) output += ANSI.reset
        if (nextAnsi) output += nextAnsi
        activeAnsi = nextAnsi
      }
      output += cell.char
    }

    if (activeAnsi) output += ANSI.reset
    if (rowIndex < grid.rows.length - 1) output += "\n"
  }

  return output
}

function renderGridStyledText(grid: SequenceGrid, colors: SequenceStyleColors): StyledText {
  const chunks: TextChunk[] = []

  for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex++) {
    const row = grid.rows[rowIndex]!
    let rowEnd = row.length
    while (rowEnd > 0 && row[rowEnd - 1]?.char === " ") {
      rowEnd -= 1
    }

    let currentStyle: SequenceCellStyle | undefined
    let currentText = ""
    const pushCurrent = () => {
      if (!currentText) return
      chunks.push({
        __isChunk: true,
        text: currentText,
        fg: styleColor(currentStyle, colors),
        bg: styleBackgroundColor(currentStyle, colors),
      })
      currentText = ""
    }

    for (let x = 0; x < rowEnd; x++) {
      const cell = row[x]!
      if (cell.style !== currentStyle) {
        pushCurrent()
        currentStyle = cell.style
      }
      currentText += cell.char
    }

    pushCurrent()

    if (rowIndex < grid.rows.length - 1) {
      chunks.push({ __isChunk: true, text: "\n" })
    }
  }

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

function resolveParticipantCenters(diagram: SequenceDiagram, minParticipantGap: number): number[] {
  const gaps = Array.from({ length: Math.max(0, diagram.participants.length - 1) }, (_, index) => {
    const left = diagram.participants[index]!
    const right = diagram.participants[index + 1]!
    return Math.max(
      minParticipantGap,
      Math.ceil(visualLength(left.label) / 2) + Math.ceil(visualLength(right.label) / 2) + 6,
    )
  })

  for (const message of diagram.messages) {
    const fromIndex = diagram.participants.findIndex((participant) => participant.id === message.from)
    const toIndex = diagram.participants.findIndex((participant) => participant.id === message.to)
    if (fromIndex < 0 || toIndex < 0 || Math.abs(fromIndex - toIndex) !== 1) continue

    const gapIndex = Math.min(fromIndex, toIndex)
    gaps[gapIndex] = Math.max(gaps[gapIndex]!, messageLabelWidth(message.label) + 6)
  }

  for (const step of diagram.steps) {
    if (step.type !== "note") continue

    const indexes = step.note.over
      .map((participant) => getParticipantIndex(diagram, participant))
      .filter((index) => index >= 0)
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

function getParticipantIndex(diagram: SequenceDiagram, participantId: string): number {
  return diagram.participants.findIndex((participant) => participant.id === participantId)
}

function layoutSequenceDiagram(content: string, options: SequenceDiagramRenderOptions = {}): SequenceGrid {
  const diagram = parseMermaidSequenceDiagram(content)
  if (diagram.participants.length === 0) return createGrid(0, 0)
  const noteStyle = options.noteStyle ?? DEFAULT_NOTE_STYLE

  const centers = resolveParticipantCenters(diagram, options.minParticipantGap ?? DEFAULT_MIN_PARTICIPANT_GAP)
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
      const indexes = step.note.over
        .map((participant) => getParticipantIndex(diagram, participant))
        .filter((index) => index >= 0)
      if (indexes.length === 0) continue

      const leftX = centers[Math.min(...indexes)]!
      const rightX = centers[Math.max(...indexes)]!
      const centerX = Math.floor((leftX + rightX) / 2)
      const noteText = noteLabelText(step.note.label)
      const labelRow = stepY + 1
      if (noteStyle === "rule") {
        for (let x = leftX; x <= rightX; x++) {
          setCell(grid, x, labelRow, "─", "lifeline")
        }
        setCell(grid, leftX, labelRow, "├", "lifeline")
        setCell(grid, rightX, labelRow, "┤", "lifeline")
        setText(grid, centeredStart(centerX, noteText), labelRow, noteText, "note")
      } else {
        setText(
          grid,
          centeredStart(centerX, noteText),
          labelRow,
          noteText,
          noteStyle === "badge" ? "noteBadge" : "note",
        )
      }
      stepY += getStepHeight(step)
      continue
    }

    const labelRow = stepY
    const message = step.message
    const messageStyle: SequenceCellStyle = message.style === "dashed" ? "response" : "request"
    const labelLines = messageLabelLines(message.label)
    const arrowRow = labelRow + labelLines.length
    const fromIndex = getParticipantIndex(diagram, message.from)
    const toIndex = getParticipantIndex(diagram, message.to)
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
  private _noteStyle: SequenceNoteStyle
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
    this._noteStyle = options.noteStyle ?? DEFAULT_NOTE_STYLE
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

  get noteStyle(): SequenceNoteStyle {
    return this._noteStyle
  }

  set noteStyle(value: SequenceNoteStyle) {
    if (this._noteStyle === value) return
    this._noteStyle = value
    this.updateDiagram()
  }

  get participantColor(): RGBA | undefined {
    return this._participantColor
  }

  set participantColor(value: ColorInput | undefined) {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(this._participantColor, next)) return
    this._participantColor = next
    this.updateDiagram()
  }

  get lifelineColor(): RGBA | undefined {
    return this._lifelineColor
  }

  set lifelineColor(value: ColorInput | undefined) {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(this._lifelineColor, next)) return
    this._lifelineColor = next
    this.updateDiagram()
  }

  get requestColor(): RGBA | undefined {
    return this._requestColor
  }

  set requestColor(value: ColorInput | undefined) {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(this._requestColor, next)) return
    this._requestColor = next
    this.updateDiagram()
  }

  get responseColor(): RGBA | undefined {
    return this._responseColor
  }

  set responseColor(value: ColorInput | undefined) {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(this._responseColor, next)) return
    this._responseColor = next
    this.updateDiagram()
  }

  get noteColor(): RGBA | undefined {
    return this._noteColor
  }

  set noteColor(value: ColorInput | undefined) {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(this._noteColor, next)) return
    this._noteColor = next
    this.updateDiagram()
  }

  get noteBackgroundColor(): RGBA | undefined {
    return this._noteBackgroundColor
  }

  set noteBackgroundColor(value: ColorInput | undefined) {
    const next = value ? parseColor(value) : undefined
    if (colorsEqual(this._noteBackgroundColor, next)) return
    this._noteBackgroundColor = next
    this.updateDiagram()
  }

  private updateDiagram(): void {
    const grid = layoutSequenceDiagram(this._content, {
      minParticipantGap: this._minParticipantGap,
      noteStyle: this._noteStyle,
    })
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
