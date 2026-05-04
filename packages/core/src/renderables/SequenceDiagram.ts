import { ANSI } from "../ansi.js"
import { BorderChars } from "../lib/border.js"
import { StyledText } from "../lib/styled-text.js"
import { isCssColorName, parseColor, RGBA, type ColorInput } from "../lib/RGBA.js"
import { stringWidth } from "../platform/runtime.js"
import type { TextChunk } from "../text-buffer.js"
import { type RenderContext } from "../types.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"

export interface SequenceParticipant {
  id: string
  label: string
}

export interface SequenceParticipantGroup {
  label: string
  participantIds: string[]
}

export interface SequenceMessage {
  from: string
  to: string
  label: string
  style: "solid" | "dashed"
  number?: number
  activate?: string
  deactivate?: string
}

export interface SequenceNote {
  over: string[]
  label: string
}

export interface SequenceActivation {
  participant: string
  active: boolean
}

export interface SequenceFragment {
  kind: "alt" | "else" | "loop" | "end"
  label: string
}

export type SequenceStep =
  | { type: "message"; message: SequenceMessage }
  | { type: "note"; note: SequenceNote }
  | { type: "activation"; activation: SequenceActivation }
  | { type: "fragment"; fragment: SequenceFragment }

export interface SequenceDiagram {
  participants: SequenceParticipant[]
  messages: SequenceMessage[]
  steps: SequenceStep[]
  groups: SequenceParticipantGroup[]
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
  groupColor?: ColorInput
  requestColor?: ColorInput
  responseColor?: ColorInput
  noteColor?: ColorInput
  noteBackgroundColor?: ColorInput
}

type MessageStyle = "request" | "response"
type FadeStep = 1 | 2 | 3 | 4 | 5
type FadeStyle = `${MessageStyle}Fade${FadeStep}`
type AnsiSequenceCellStyle = "participant" | "lifeline" | "group" | MessageStyle | FadeStyle | "fragment" | "note"
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
const GROUP_HORIZONTAL_PADDING = 2
const SEQUENCE_BORDER = BorderChars.rounded
const FADE_STEPS = [1, 2, 3, 4, 5] as const satisfies readonly FadeStep[]
const DEFAULT_THEME_RGB = {
  participant: [228, 239, 232],
  lifeline: [111, 138, 126],
  group: [76, 99, 89],
  request: [134, 225, 200],
  response: [230, 177, 126],
  fragment: [154, 184, 169],
  noteFg: [215, 229, 221],
  noteBg: [36, 56, 47],
} as const
const DEFAULT_ANSI_THEME: Required<Record<AnsiSequenceCellStyle, string>> = {
  participant: ansiFg(DEFAULT_THEME_RGB.participant),
  lifeline: ansiFg(DEFAULT_THEME_RGB.lifeline),
  group: ansiFg(DEFAULT_THEME_RGB.group),
  request: ansiFg(DEFAULT_THEME_RGB.request),
  response: ansiFg(DEFAULT_THEME_RGB.response),
  fragment: ansiFg(DEFAULT_THEME_RGB.fragment),
  note: `${ansiFg(DEFAULT_THEME_RGB.noteFg)}${ansiBg(DEFAULT_THEME_RGB.noteBg)}`,
  ...createAnsiFadeTheme("request", DEFAULT_THEME_RGB.lifeline, DEFAULT_THEME_RGB.request),
  ...createAnsiFadeTheme("response", DEFAULT_THEME_RGB.lifeline, DEFAULT_THEME_RGB.response),
}
const MESSAGE_RE = /^(.+?)\s*(-->>|->>|-->|->)([+-]?)\s*(.+?)\s*:\s*(.*)$/
const NOTE_RE = /^note\s+over\s+(.+?)\s*:\s*(.*)$/i
const PARTICIPANT_RE = /^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i
const ACTIVATION_RE = /^(activate|deactivate)\s+(.+)$/i
const BOX_RE = /^box(?:\s+(.+))?$/i
const ALT_RE = /^alt\s+(.+)$/i
const ELSE_RE = /^else(?:\s+(.+))?$/i
const LOOP_RE = /^loop\s+(.+)$/i
const AUTONUMBER_RE = /^autonumber(?:\s+(\d+)(?:\s+(\d+))?)?$/i
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

function isBoxColorToken(value: string): boolean {
  const lowerValue = value.toLowerCase()
  return (
    lowerValue === "transparent" ||
    isCssColorName(value) ||
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^rgba?\(.+\)$/i.test(value)
  )
}

function splitLeadingBoxToken(value: string): { token: string; rest: string } {
  if (/^rgba?\(/i.test(value)) {
    const closeIndex = value.indexOf(")")
    if (closeIndex >= 0) {
      return { token: value.slice(0, closeIndex + 1), rest: value.slice(closeIndex + 1).trim() }
    }
  }

  const firstSpace = value.search(/\s/)
  return firstSpace < 0
    ? { token: value, rest: "" }
    : { token: value.slice(0, firstSpace), rest: value.slice(firstSpace + 1).trim() }
}

function boxLabelText(value: string | undefined): string {
  const rawLabel = (value ?? "").trim()
  if ((rawLabel.startsWith('"') && rawLabel.endsWith('"')) || (rawLabel.startsWith("'") && rawLabel.endsWith("'"))) {
    return stripQuotes(rawLabel)
  }

  const label = stripQuotes(rawLabel)
  if (!label) return ""

  const { token, rest } = splitLeadingBoxToken(label)

  if (isBoxColorToken(token)) {
    return stripQuotes(rest)
  }

  return label
}

function addParticipantToGroup(group: SequenceParticipantGroup | undefined, participantId: string): void {
  if (!group || group.participantIds.includes(participantId)) return
  group.participantIds.push(participantId)
}

function ensureParticipant(
  participants: SequenceParticipant[],
  id: string,
  label: string = id,
  replaceExistingLabel: boolean = false,
): boolean {
  const existing = participants.find((participant) => participant.id === id)
  if (existing) {
    if (replaceExistingLabel) {
      existing.label = label
    }
    return false
  }

  participants.push({ id, label })
  return true
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
  const groups: SequenceParticipantGroup[] = []
  const blockStack: Array<"box" | "alt" | "loop"> = []
  const groupStack: SequenceParticipantGroup[] = []
  let nextMessageNumber: number | undefined
  let messageNumberIncrement = 1

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("%%") || line.toLowerCase() === "sequencediagram") {
      continue
    }

    const autonumberMatch = line.match(AUTONUMBER_RE)
    if (autonumberMatch) {
      nextMessageNumber = Number.parseInt(autonumberMatch[1] ?? "1", 10)
      messageNumberIncrement = Number.parseInt(autonumberMatch[2] ?? "1", 10)
      continue
    }

    const boxMatch = line.match(BOX_RE)
    if (boxMatch) {
      const group: SequenceParticipantGroup = { label: boxLabelText(boxMatch[1]), participantIds: [] }
      groups.push(group)
      groupStack.push(group)
      blockStack.push("box")
      continue
    }

    const participantMatch = line.match(PARTICIPANT_RE)
    if (participantMatch) {
      const id = stripQuotes(participantMatch[1]!)
      const label = stripQuotes(participantMatch[2] ?? id)
      ensureParticipant(participants, id, label, true)
      addParticipantToGroup(groupStack[groupStack.length - 1], id)
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

    const activationMatch = line.match(ACTIVATION_RE)
    if (activationMatch) {
      const participant = stripQuotes(activationMatch[2]!)
      ensureParticipant(participants, participant)
      steps.push({
        type: "activation",
        activation: { participant, active: activationMatch[1]!.toLowerCase() === "activate" },
      })
      continue
    }

    const altMatch = line.match(ALT_RE)
    if (altMatch) {
      blockStack.push("alt")
      steps.push({ type: "fragment", fragment: { kind: "alt", label: stripQuotes(altMatch[1]!) } })
      continue
    }

    const loopMatch = line.match(LOOP_RE)
    if (loopMatch) {
      blockStack.push("loop")
      steps.push({ type: "fragment", fragment: { kind: "loop", label: stripQuotes(loopMatch[1]!) } })
      continue
    }

    const elseMatch = line.match(ELSE_RE)
    if (elseMatch) {
      steps.push({ type: "fragment", fragment: { kind: "else", label: stripQuotes(elseMatch[1] ?? "") } })
      continue
    }

    if (line.toLowerCase() === "end") {
      const block = blockStack.pop()
      if (block === "box") {
        groupStack.pop()
        continue
      }
      steps.push({ type: "fragment", fragment: { kind: "end", label: block ?? "" } })
      continue
    }

    const messageMatch = line.match(MESSAGE_RE)
    if (messageMatch) {
      const from = stripQuotes(messageMatch[1]!)
      const arrow = messageMatch[2]!
      const activationMarker = messageMatch[3]!
      const to = stripQuotes(messageMatch[4]!)
      const label = stripQuotes(messageMatch[5]!)

      const activeGroup = groupStack[groupStack.length - 1]
      ensureParticipant(participants, from)
      ensureParticipant(participants, to)
      addParticipantToGroup(activeGroup, from)
      addParticipantToGroup(activeGroup, to)
      const message: SequenceMessage = {
        from,
        to,
        label,
        style: arrow.startsWith("--") ? "dashed" : "solid",
      }
      if (nextMessageNumber !== undefined) {
        message.number = nextMessageNumber
        nextMessageNumber += messageNumberIncrement
      }
      if (activationMarker === "+") {
        message.activate = to
      } else if (activationMarker === "-") {
        message.deactivate = from
      }
      messages.push(message)
      steps.push({ type: "message", message })
    }
  }

  return { participants, messages, steps, groups }
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

function brightenColor(color: RGBA | undefined, amount: number = 0.35): RGBA | undefined {
  if (!color) return undefined

  const [r, g, b, a] = color.toInts()
  return RGBA.fromInts(mixChannel(r, 255, amount), mixChannel(g, 255, amount), mixChannel(b, 255, amount), a)
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
  setCell(
    grid,
    x,
    y,
    direction === 1 ? SEQUENCE_BORDER.leftT : SEQUENCE_BORDER.rightT,
    `${style}Fade1` as SequenceCellStyle,
  )
  for (let step = 2; step <= 5; step++) {
    setCell(grid, x + direction * (step - 1), y, SEQUENCE_BORDER.horizontal, `${style}Fade${step}` as SequenceCellStyle)
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

function messageLabelText(message: SequenceMessage): string {
  return message.number === undefined ? message.label : `${message.number}. ${message.label}`
}

function fragmentLabelText(fragment: SequenceFragment): string {
  if (fragment.kind === "end") {
    return fragment.label ? ` end ${fragment.label} ` : " end "
  }

  const prefix = fragment.kind === "loop" ? "↻ loop" : fragment.kind
  return ` ${prefix}: ${fragment.label} `
}

function messageLabelLines(label: string): string[] {
  const lines = label.split(/(?:<br\s*\/?\s*>|\\n)/i).map((line) => line.trimEnd())
  return lines.length > 0 ? lines : [""]
}

function labelLinesWidth(lines: string[]): number {
  return lines.reduce((max, line) => Math.max(max, visualLength(line)), 0)
}

function messageLabelWidth(label: string): number {
  return labelLinesWidth(messageLabelLines(label))
}

function messageWidth(message: SequenceMessage): number {
  return messageLabelWidth(messageLabelText(message))
}

function selfMessageLoopWidth(message: SequenceMessage): number {
  return selfMessageLoopWidthForLines(messageLabelLines(messageLabelText(message)))
}

function selfMessageLoopWidthForLines(labelLines: string[]): number {
  return Math.max(10, labelLinesWidth(labelLines) + 4)
}

function getStepHeight(step: SequenceStep): number {
  if (step.type === "note") return 3
  if (step.type === "activation") return 0
  if (step.type === "fragment") return 2
  return messageLabelLines(messageLabelText(step.message)).length + (step.message.from === step.message.to ? 3 : 2)
}

function createParticipantIndexMap(diagram: SequenceDiagram): Map<string, number> {
  return new Map(diagram.participants.map((participant, index) => [participant.id, index]))
}

function getParticipantIndexes(participantIndexes: Map<string, number>, participantIds: string[]): number[] {
  return participantIds
    .map((participantId) => participantIndexes.get(participantId) ?? -1)
    .filter((index) => index >= 0)
}

interface SequenceGroupRange {
  group: SequenceParticipantGroup
  startIndex: number
  endIndex: number
}

interface SequenceGroupBounds {
  group: SequenceParticipantGroup
  leftX: number
  rightX: number
}

interface SequenceHorizontalBounds {
  leftX: number
  rightX: number
}

function groupLabelText(group: SequenceParticipantGroup): string {
  return group.label ? ` ${group.label} ` : ""
}

function getGroupRanges(diagram: SequenceDiagram, participantIndexes: Map<string, number>): SequenceGroupRange[] {
  return diagram.groups.flatMap((group) => {
    const indexes = getParticipantIndexes(participantIndexes, group.participantIds)
    if (indexes.length === 0) return []

    return [
      {
        group,
        startIndex: Math.min(...indexes),
        endIndex: Math.max(...indexes),
      },
    ]
  })
}

function resolveGroupBounds(
  diagram: SequenceDiagram,
  centers: number[],
  participantIndexes: Map<string, number>,
  groupRanges: SequenceGroupRange[],
): SequenceGroupBounds[] {
  return groupRanges.map((range) => {
    let contentLeftX = centers[range.startIndex]!
    let contentRightX = centers[range.endIndex]!

    for (let i = range.startIndex; i <= range.endIndex; i++) {
      const participant = diagram.participants[i]!
      const labelStartX = centeredStart(centers[i]!, participant.label)
      const headerRuleWidth = Math.max(3, visualLength(participant.label))
      contentLeftX = Math.min(contentLeftX, labelStartX)
      contentRightX = Math.max(contentRightX, labelStartX + headerRuleWidth - 1)
    }

    for (const message of diagram.messages) {
      const participantIndex = participantIndexes.get(message.from)
      if (participantIndex === undefined || participantIndex !== participantIndexes.get(message.to)) continue
      if (participantIndex < range.startIndex || participantIndex > range.endIndex) continue
      contentRightX = Math.max(contentRightX, centers[participantIndex]! + selfMessageLoopWidth(message))
    }

    let leftX = contentLeftX - GROUP_HORIZONTAL_PADDING
    let rightX = contentRightX + GROUP_HORIZONTAL_PADDING
    const minWidth = visualLength(groupLabelText(range.group)) + 4
    const width = rightX - leftX + 1

    if (width < minWidth) {
      const extraWidth = minWidth - width
      leftX -= Math.floor(extraWidth / 2)
      rightX += Math.ceil(extraWidth / 2)
    }

    return { group: range.group, leftX, rightX }
  })
}

function expandHorizontalBounds(bounds: SequenceHorizontalBounds, leftX: number, rightX: number): void {
  bounds.leftX = Math.min(bounds.leftX, leftX)
  bounds.rightX = Math.max(bounds.rightX, rightX)
}

function getDiagramContentBounds(
  diagram: SequenceDiagram,
  centers: number[],
  participantIndexes: Map<string, number>,
): SequenceHorizontalBounds {
  const bounds: SequenceHorizontalBounds = { leftX: 0, rightX: 0 }

  for (let i = 0; i < diagram.participants.length; i++) {
    const participant = diagram.participants[i]!
    const labelStartX = centeredStart(centers[i]!, participant.label)
    const headerWidth = Math.max(3, visualLength(participant.label))
    expandHorizontalBounds(bounds, labelStartX, labelStartX + headerWidth - 1)
  }

  for (const message of diagram.messages) {
    const fromIndex = participantIndexes.get(message.from) ?? -1
    const toIndex = participantIndexes.get(message.to) ?? -1
    if (fromIndex < 0 || toIndex < 0) continue

    const fromX = centers[fromIndex]!
    const toX = centers[toIndex]!
    if (fromIndex === toIndex) {
      expandHorizontalBounds(bounds, fromX, fromX + selfMessageLoopWidth(message))
      continue
    }

    const leftX = Math.min(fromX, toX)
    const rightX = Math.max(fromX, toX)
    const labelStartX = leftX + 2
    expandHorizontalBounds(bounds, leftX, Math.max(rightX, labelStartX + messageWidth(message) - 1))
  }

  for (const step of diagram.steps) {
    if (step.type !== "note") continue

    const indexes = getParticipantIndexes(participantIndexes, step.note.over)
    if (indexes.length === 0) continue

    const leftX = centers[Math.min(...indexes)]!
    const rightX = centers[Math.max(...indexes)]!
    const centerX = Math.floor((leftX + rightX) / 2)
    const noteText = noteLabelText(step.note.label)
    const noteStartX = centeredStart(centerX, noteText)
    expandHorizontalBounds(bounds, noteStartX, noteStartX + visualLength(noteText) - 1)
  }

  return bounds
}

function groupVerticalChar(existing: string | undefined): string | undefined {
  switch (existing) {
    case undefined:
    case " ":
      return SEQUENCE_BORDER.vertical
    case SEQUENCE_BORDER.vertical:
      return SEQUENCE_BORDER.vertical
    default:
      return undefined
  }
}

function setGroupVerticalCell(grid: SequenceGrid, x: number, y: number): void {
  const existing = grid.rows[y]?.[x]?.char
  const char = groupVerticalChar(existing)
  if (char) setCell(grid, x, y, char, "group")
}

function renderParticipantGroups(grid: SequenceGrid, groupBounds: SequenceGroupBounds[], bottomY: number): void {
  for (const bounds of groupBounds) {
    for (let x = bounds.leftX; x <= bounds.rightX; x++) {
      setCell(grid, x, 0, SEQUENCE_BORDER.horizontal, "group")
      setCell(grid, x, bottomY, SEQUENCE_BORDER.horizontal, "group")
    }

    setCell(grid, bounds.leftX, 0, SEQUENCE_BORDER.topLeft, "group")
    setCell(grid, bounds.rightX, 0, SEQUENCE_BORDER.topRight, "group")
    setCell(grid, bounds.leftX, bottomY, SEQUENCE_BORDER.bottomLeft, "group")
    setCell(grid, bounds.rightX, bottomY, SEQUENCE_BORDER.bottomRight, "group")

    for (let y = 1; y < bottomY; y++) {
      setGroupVerticalCell(grid, bounds.leftX, y)
      setGroupVerticalCell(grid, bounds.rightX, y)
    }

    const label = groupLabelText(bounds.group)
    if (label) {
      setText(grid, bounds.leftX + 2, 0, label, "group")
    }
  }
}

function renderFragment(grid: SequenceGrid, centers: number[], fragment: SequenceFragment, y: number): void {
  const leftX = centers[0]
  const participantRightX = centers[centers.length - 1]
  if (leftX === undefined || participantRightX === undefined) return
  const label = fragmentLabelText(fragment)
  const rightX = Math.max(participantRightX, leftX + 2 + visualLength(label) + 1)

  const leftChar =
    fragment.kind === "alt" || fragment.kind === "loop"
      ? SEQUENCE_BORDER.topLeft
      : fragment.kind === "else"
        ? SEQUENCE_BORDER.leftT
        : SEQUENCE_BORDER.bottomLeft
  const rightChar =
    fragment.kind === "alt" || fragment.kind === "loop"
      ? SEQUENCE_BORDER.topRight
      : fragment.kind === "else"
        ? SEQUENCE_BORDER.rightT
        : SEQUENCE_BORDER.bottomRight

  for (let x = leftX; x <= rightX; x++) {
    setCell(grid, x, y, SEQUENCE_BORDER.horizontal, "fragment")
  }

  setCell(grid, leftX, y, leftChar, "fragment")
  setCell(grid, rightX, y, rightChar, "fragment")
  setText(grid, leftX + 2, y, label, "fragment")
}

function renderSelfMessage(
  grid: SequenceGrid,
  centerX: number,
  topRow: number,
  labelLines: string[],
  style: SequenceCellStyle,
): void {
  const rightX = centerX + selfMessageLoopWidthForLines(labelLines)
  const bottomRow = topRow + labelLines.length + 1

  setArrowDepartureFade(grid, centerX, topRow, 1, style)
  for (let x = centerX + FADE_STEPS.length; x < rightX; x++) {
    setCell(grid, x, topRow, SEQUENCE_BORDER.horizontal, style)
  }
  setCell(grid, rightX, topRow, SEQUENCE_BORDER.topRight, style)

  for (let lineIndex = 0; lineIndex < labelLines.length; lineIndex++) {
    const y = topRow + lineIndex + 1
    setCell(grid, centerX, y, SEQUENCE_BORDER.vertical, "lifeline")
    setText(grid, centerX + 2, y, labelLines[lineIndex]!, style)
    setCell(grid, rightX, y, SEQUENCE_BORDER.vertical, style)
  }

  setCell(grid, centerX, bottomRow, "◀", style)
  for (let x = centerX + 1; x < rightX; x++) {
    setCell(grid, x, bottomRow, SEQUENCE_BORDER.horizontal, style)
  }
  setCell(grid, rightX, bottomRow, SEQUENCE_BORDER.bottomRight, style)
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
    if (fromIndex === toIndex && fromIndex >= 0 && fromIndex < diagram.participants.length - 1) {
      const nextParticipant = diagram.participants[fromIndex + 1]!
      gaps[fromIndex] = Math.max(
        gaps[fromIndex]!,
        selfMessageLoopWidth(message) + Math.ceil(visualLength(nextParticipant.label) / 2) + 2,
      )
      continue
    }
    if (fromIndex < 0 || toIndex < 0 || Math.abs(fromIndex - toIndex) !== 1) continue

    const gapIndex = Math.min(fromIndex, toIndex)
    gaps[gapIndex] = Math.max(gaps[gapIndex]!, messageWidth(message) + 6)
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

  let centers = resolveParticipantCenters(
    diagram,
    participantIndexes,
    options.minParticipantGap ?? DEFAULT_MIN_PARTICIPANT_GAP,
  )
  const groupRanges = getGroupRanges(diagram, participantIndexes)
  let groupBounds = resolveGroupBounds(diagram, centers, participantIndexes, groupRanges)
  let contentBounds = getDiagramContentBounds(diagram, centers, participantIndexes)
  const groupLeftOverflow = groupBounds.reduce((leftmostX, bounds) => Math.min(leftmostX, bounds.leftX), 0)
  const leftOverflow = Math.min(groupLeftOverflow, contentBounds.leftX, 0)

  if (leftOverflow < 0) {
    centers = centers.map((center) => center - leftOverflow)
    groupBounds = resolveGroupBounds(diagram, centers, participantIndexes, groupRanges)
    contentBounds = getDiagramContentBounds(diagram, centers, participantIndexes)
  }

  const hasGroups = groupBounds.length > 0
  const groupRowOffset = hasGroups ? 1 : 0
  const participantHeaderY = groupRowOffset
  const participantRuleY = participantHeaderY + 1
  const lifelineStartY = participantRuleY + 1
  const stepStartY = lifelineStartY + 1
  const groupWidth = groupBounds.reduce((width, bounds) => Math.max(width, bounds.rightX + 1), 0)
  const fragmentWidth = diagram.steps.reduce((width, step) => {
    if (step.type !== "fragment") return width
    return Math.max(width, centers[0]! + 2 + visualLength(fragmentLabelText(step.fragment)) + 2)
  }, 0)
  const width = Math.max(contentBounds.rightX + 1, groupWidth, fragmentWidth)
  const baseHeight = stepStartY + diagram.steps.reduce((total, step) => total + getStepHeight(step), 0)
  const height = hasGroups ? Math.max(5, baseHeight + 1) : Math.max(3, baseHeight)
  const grid = createGrid(width, height)

  if (hasGroups) {
    renderParticipantGroups(grid, groupBounds, height - 1)
  }

  for (let i = 0; i < diagram.participants.length; i++) {
    const participant = diagram.participants[i]!
    const center = centers[i]!
    setText(grid, centeredStart(center, participant.label), participantHeaderY, participant.label, "participant")
    setText(
      grid,
      centeredStart(center, participant.label),
      participantRuleY,
      SEQUENCE_BORDER.horizontal.repeat(Math.max(3, visualLength(participant.label))),
      "lifeline",
    )
    setCell(grid, center, participantRuleY, SEQUENCE_BORDER.topT, "lifeline")

    const lifelineEndY = hasGroups ? height - 2 : height - 1
    for (let y = lifelineStartY; y <= lifelineEndY; y++) {
      setCell(grid, center, y, SEQUENCE_BORDER.vertical, "lifeline")
    }
  }

  let stepY = stepStartY

  for (const step of diagram.steps) {
    if (step.type === "activation") {
      continue
    }

    if (step.type === "note") {
      const stepHeight = getStepHeight(step)
      const indexes = getParticipantIndexes(participantIndexes, step.note.over)
      if (indexes.length === 0) continue

      const leftX = centers[Math.min(...indexes)]!
      const rightX = centers[Math.max(...indexes)]!
      const centerX = Math.floor((leftX + rightX) / 2)
      const noteText = noteLabelText(step.note.label)
      const labelRow = stepY + 1
      setText(grid, centeredStart(centerX, noteText), labelRow, noteText, "noteBadge")
      stepY += stepHeight
      continue
    }

    if (step.type === "fragment") {
      const stepHeight = getStepHeight(step)
      renderFragment(grid, centers, step.fragment, stepY)
      stepY += stepHeight
      continue
    }

    const labelRow = stepY
    const message = step.message
    const stepHeight = getStepHeight(step)
    const messageStyle: SequenceCellStyle = message.style === "dashed" ? "response" : "request"
    const labelLines = messageLabelLines(messageLabelText(message))
    const arrowRow = labelRow + labelLines.length
    const fromIndex = participantIndexes.get(message.from) ?? -1
    const toIndex = participantIndexes.get(message.to) ?? -1
    if (fromIndex < 0 || toIndex < 0) continue

    if (fromIndex === toIndex) {
      renderSelfMessage(grid, centers[fromIndex]!, stepY, labelLines, messageStyle)
      stepY += stepHeight
      continue
    }

    const fromX = centers[fromIndex]!
    const toX = centers[toIndex]!
    const leftX = Math.min(fromX, toX)
    const rightX = Math.max(fromX, toX)
    const labelStart = leftX + 2

    for (let lineIndex = 0; lineIndex < labelLines.length; lineIndex++) {
      setText(grid, labelStart, labelRow + lineIndex, labelLines[lineIndex]!, messageStyle)
    }

    for (let x = leftX + 1; x < rightX; x++) {
      setCell(grid, x, arrowRow, SEQUENCE_BORDER.horizontal, messageStyle)
    }

    if (toX > fromX) {
      setArrowDepartureFade(grid, fromX, arrowRow, 1, messageStyle)
      setCell(grid, toX, arrowRow, "▶", messageStyle)
    } else {
      setArrowDepartureFade(grid, fromX, arrowRow, -1, messageStyle)
      setCell(grid, toX, arrowRow, "◀", messageStyle)
    }

    stepY += stepHeight
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
  private _groupColor?: RGBA
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
    this._groupColor = options.groupColor ? parseColor(options.groupColor) : undefined
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

  get groupColor(): RGBA | undefined {
    return this._groupColor
  }

  set groupColor(value: ColorInput | undefined) {
    this.setColor(this._groupColor, value, (color) => {
      this._groupColor = color
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
    const grid = layoutSequenceDiagram(this._content, {
      minParticipantGap: this._minParticipantGap,
    })
    this.textBuffer.setStyledText(
      renderGridStyledText(
        grid,
        resolveSequenceStyleColors({
          participant: this._participantColor,
          lifeline: this._lifelineColor,
          group: this._groupColor ?? brightenColor(this._lifelineColor, 0.08),
          request: this._requestColor,
          response: this._responseColor,
          fragment: brightenColor(this._lifelineColor, 0.18),
          note: this._noteColor,
          noteBg: this._noteBackgroundColor,
        }),
      ),
    )
    this.updateTextInfo()
    this.requestRender()
  }
}
