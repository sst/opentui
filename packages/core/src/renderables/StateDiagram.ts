import { ANSI } from "../ansi.js"
import { BorderChars, type BorderStyle } from "../lib/border.js"
import { StyledText } from "../lib/styled-text.js"
import { RGBA, parseColor, type ColorInput } from "../lib/RGBA.js"
import { stringWidth } from "../platform/runtime.js"
import type { TextChunk } from "../text-buffer.js"
import { type RenderContext } from "../types.js"
import { TextBufferRenderable, type TextBufferOptions } from "./TextBufferRenderable.js"

export type StateDiagramDirection = "TB" | "TD" | "LR" | "RL"
export type StateDiagramArrowHeadStyle = "filled" | "line"

export interface StateDiagramState {
  id: string
  label: string
  kind: "state" | "start" | "end" | "choice"
}

export interface StateDiagramTransition {
  from: string
  to: string
  label: string
}

export interface StateDiagramActiveTransition {
  from: string
  to: string
  label?: string
}

export type StateDiagramActiveTransitionSelection =
  | StateDiagramActiveTransition
  | readonly StateDiagramActiveTransition[]

export interface StateDiagram {
  direction: StateDiagramDirection
  states: StateDiagramState[]
  transitions: StateDiagramTransition[]
}

export interface StateDiagramRenderOptions {
  direction?: StateDiagramDirection
  borderStyle?: BorderStyle
  arrowHeadStyle?: StateDiagramArrowHeadStyle
  minStateGap?: number
  activeState?: string
  activeTransition?: StateDiagramActiveTransitionSelection
}

export interface StateDiagramAnsiOptions extends StateDiagramRenderOptions {
  theme?: StateDiagramAnsiTheme
}

export interface StateDiagramOptions extends TextBufferOptions, StateDiagramRenderOptions {
  content?: string
  stateColor?: ColorInput
  activeStateColor?: ColorInput
  transitionColor?: ColorInput
  labelColor?: ColorInput
  startColor?: ColorInput
  endColor?: ColorInput
  choiceColor?: ColorInput
  activeTransitionColor?: ColorInput
}

export type StateDiagramAnsiTheme = Partial<Record<StateCellStyle, string>>

type FadeStep = 1 | 2 | 3 | 4 | 5
type FadeSourceStyle = "state" | "activeState" | "start" | "end" | "choice"
type TransitionFadeStyle = `${FadeSourceStyle}TransitionFade${FadeStep}`
type ActiveTransitionFadeStyle = `${FadeSourceStyle}ActiveTransitionFade${FadeStep}`
type BaseStateCellStyle =
  | "state"
  | "activeState"
  | "transition"
  | "activeTransition"
  | "label"
  | "start"
  | "end"
  | "choice"
type StateCellStyle = BaseStateCellStyle | TransitionFadeStyle | ActiveTransitionFadeStyle
type Rgb = readonly [number, number, number]

type StateStyleColors = Required<Record<BaseStateCellStyle, RGBA>> &
  Required<Record<TransitionFadeStyle, RGBA>> &
  Required<Record<ActiveTransitionFadeStyle, RGBA>>

interface StateCell {
  char: string
  style?: StateCellStyle
}

interface StateGrid {
  rows: StateCell[][]
}

interface BoxBounds {
  id: string
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
}

interface StateLayout {
  bounds: Map<string, BoxBounds>
  sizes: Map<string, { width: number; height: number; lines: string[] }>
}

const DEFAULT_DIRECTION = "LR" satisfies StateDiagramDirection
const DEFAULT_MIN_STATE_GAP = 5
const DEFAULT_BORDER_STYLE = "rounded" satisfies BorderStyle
const DEFAULT_ARROW_HEAD_STYLE = "filled" satisfies StateDiagramArrowHeadStyle
const STATE_RE = /^state\s+"([^"]+)"\s+as\s+(\S+)$/i
const CHOICE_STATE_RE = /^state\s+(\S+)\s+<<choice>>$/i
const TRANSITION_RE = /^(\[\*\]|[^\s:]+)\s*-->\s*(\[\*\]|[^\s:]+)(?:\s*:\s*(.*))?$/
const DIRECTION_RE = /^direction\s+(TB|TD|LR|RL)$/i
const DEFAULT_THEME_RGB = {
  state: [228, 239, 232],
  activeState: [221, 255, 246],
  transition: [134, 225, 200],
  activeTransition: [221, 255, 246],
  label: [134, 225, 200],
  start: [134, 225, 200],
  end: [230, 177, 126],
  choice: [134, 225, 200],
} as const satisfies Record<BaseStateCellStyle, Rgb>
const FADE_STEPS = [1, 2, 3, 4, 5] as const satisfies readonly FadeStep[]
const DEFAULT_ANSI_THEME: Required<Record<StateCellStyle, string>> = {
  state: ansiFg(DEFAULT_THEME_RGB.state),
  activeState: ansiFg(DEFAULT_THEME_RGB.activeState),
  transition: ansiFg(DEFAULT_THEME_RGB.transition),
  activeTransition: ansiFg(DEFAULT_THEME_RGB.activeTransition),
  label: ansiFg(DEFAULT_THEME_RGB.label),
  start: ansiFg(DEFAULT_THEME_RGB.start),
  end: ansiFg(DEFAULT_THEME_RGB.end),
  choice: ansiFg(DEFAULT_THEME_RGB.choice),
  ...createAnsiFadeTheme("state", DEFAULT_THEME_RGB.state, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("activeState", DEFAULT_THEME_RGB.activeState, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("start", DEFAULT_THEME_RGB.start, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("end", DEFAULT_THEME_RGB.end, DEFAULT_THEME_RGB.transition),
  ...createAnsiFadeTheme("choice", DEFAULT_THEME_RGB.choice, DEFAULT_THEME_RGB.transition),
  ...createAnsiActiveTransitionFadeTheme("state", DEFAULT_THEME_RGB.state, DEFAULT_THEME_RGB.activeTransition),
  ...createAnsiActiveTransitionFadeTheme(
    "activeState",
    DEFAULT_THEME_RGB.activeState,
    DEFAULT_THEME_RGB.activeTransition,
  ),
  ...createAnsiActiveTransitionFadeTheme("start", DEFAULT_THEME_RGB.start, DEFAULT_THEME_RGB.activeTransition),
  ...createAnsiActiveTransitionFadeTheme("end", DEFAULT_THEME_RGB.end, DEFAULT_THEME_RGB.activeTransition),
  ...createAnsiActiveTransitionFadeTheme("choice", DEFAULT_THEME_RGB.choice, DEFAULT_THEME_RGB.activeTransition),
}

function ansiFg(rgb: Rgb): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
}

function rgba(rgb: Rgb): RGBA {
  return RGBA.fromInts(rgb[0], rgb[1], rgb[2], 255)
}

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

function createAnsiFadeTheme(source: FadeSourceStyle, from: Rgb, to: Rgb): Record<TransitionFadeStyle, string> {
  return Object.fromEntries(
    FADE_STEPS.map((step) => [
      `${source}TransitionFade${step}`,
      ansiFg(mixRgb(from, to, step / (FADE_STEPS.length + 1))),
    ]),
  ) as Record<TransitionFadeStyle, string>
}

function createAnsiActiveTransitionFadeTheme(
  source: FadeSourceStyle,
  from: Rgb,
  to: Rgb,
): Record<ActiveTransitionFadeStyle, string> {
  return Object.fromEntries(
    FADE_STEPS.map((step) => [
      `${source}ActiveTransitionFade${step}`,
      ansiFg(mixRgb(from, to, step / (FADE_STEPS.length + 1))),
    ]),
  ) as Record<ActiveTransitionFadeStyle, string>
}

function blendColor(from: RGBA, to: RGBA, amount: number): RGBA {
  const [fromR, fromG, fromB, fromA] = from.toInts()
  const [toR, toG, toB, toA] = to.toInts()
  return RGBA.fromInts(
    mixChannel(fromR, toR, amount),
    mixChannel(fromG, toG, amount),
    mixChannel(fromB, toB, amount),
    mixChannel(fromA, toA, amount),
  )
}

function styleColor(style: StateCellStyle | undefined, colors: StateStyleColors): RGBA | undefined {
  return style ? colors[style] : undefined
}

function resolveStateStyleColors(colors: Partial<Record<StateCellStyle, RGBA | undefined>> = {}): StateStyleColors {
  const state = colors.state ?? rgba(DEFAULT_THEME_RGB.state)
  const transition = colors.transition ?? rgba(DEFAULT_THEME_RGB.transition)
  const activeTransition = colors.activeTransition ?? rgba(DEFAULT_THEME_RGB.activeTransition)
  const activeState = colors.activeState ?? rgba(DEFAULT_THEME_RGB.activeState)
  const start = colors.start ?? rgba(DEFAULT_THEME_RGB.start)
  const end = colors.end ?? rgba(DEFAULT_THEME_RGB.end)
  const choice = colors.choice ?? transition

  return {
    state,
    activeState,
    transition,
    activeTransition,
    label: colors.label ?? transition,
    start,
    end,
    choice,
    stateTransitionFade1: blendColor(state, transition, 1 / 6),
    stateTransitionFade2: blendColor(state, transition, 2 / 6),
    stateTransitionFade3: blendColor(state, transition, 3 / 6),
    stateTransitionFade4: blendColor(state, transition, 4 / 6),
    stateTransitionFade5: blendColor(state, transition, 5 / 6),
    activeStateTransitionFade1: blendColor(activeState, transition, 1 / 6),
    activeStateTransitionFade2: blendColor(activeState, transition, 2 / 6),
    activeStateTransitionFade3: blendColor(activeState, transition, 3 / 6),
    activeStateTransitionFade4: blendColor(activeState, transition, 4 / 6),
    activeStateTransitionFade5: blendColor(activeState, transition, 5 / 6),
    startTransitionFade1: blendColor(start, transition, 1 / 6),
    startTransitionFade2: blendColor(start, transition, 2 / 6),
    startTransitionFade3: blendColor(start, transition, 3 / 6),
    startTransitionFade4: blendColor(start, transition, 4 / 6),
    startTransitionFade5: blendColor(start, transition, 5 / 6),
    endTransitionFade1: blendColor(end, transition, 1 / 6),
    endTransitionFade2: blendColor(end, transition, 2 / 6),
    endTransitionFade3: blendColor(end, transition, 3 / 6),
    endTransitionFade4: blendColor(end, transition, 4 / 6),
    endTransitionFade5: blendColor(end, transition, 5 / 6),
    choiceTransitionFade1: blendColor(choice, transition, 1 / 6),
    choiceTransitionFade2: blendColor(choice, transition, 2 / 6),
    choiceTransitionFade3: blendColor(choice, transition, 3 / 6),
    choiceTransitionFade4: blendColor(choice, transition, 4 / 6),
    choiceTransitionFade5: blendColor(choice, transition, 5 / 6),
    stateActiveTransitionFade1: blendColor(state, activeTransition, 1 / 6),
    stateActiveTransitionFade2: blendColor(state, activeTransition, 2 / 6),
    stateActiveTransitionFade3: blendColor(state, activeTransition, 3 / 6),
    stateActiveTransitionFade4: blendColor(state, activeTransition, 4 / 6),
    stateActiveTransitionFade5: blendColor(state, activeTransition, 5 / 6),
    activeStateActiveTransitionFade1: blendColor(activeState, activeTransition, 1 / 6),
    activeStateActiveTransitionFade2: blendColor(activeState, activeTransition, 2 / 6),
    activeStateActiveTransitionFade3: blendColor(activeState, activeTransition, 3 / 6),
    activeStateActiveTransitionFade4: blendColor(activeState, activeTransition, 4 / 6),
    activeStateActiveTransitionFade5: blendColor(activeState, activeTransition, 5 / 6),
    startActiveTransitionFade1: blendColor(start, activeTransition, 1 / 6),
    startActiveTransitionFade2: blendColor(start, activeTransition, 2 / 6),
    startActiveTransitionFade3: blendColor(start, activeTransition, 3 / 6),
    startActiveTransitionFade4: blendColor(start, activeTransition, 4 / 6),
    startActiveTransitionFade5: blendColor(start, activeTransition, 5 / 6),
    endActiveTransitionFade1: blendColor(end, activeTransition, 1 / 6),
    endActiveTransitionFade2: blendColor(end, activeTransition, 2 / 6),
    endActiveTransitionFade3: blendColor(end, activeTransition, 3 / 6),
    endActiveTransitionFade4: blendColor(end, activeTransition, 4 / 6),
    endActiveTransitionFade5: blendColor(end, activeTransition, 5 / 6),
    choiceActiveTransitionFade1: blendColor(choice, activeTransition, 1 / 6),
    choiceActiveTransitionFade2: blendColor(choice, activeTransition, 2 / 6),
    choiceActiveTransitionFade3: blendColor(choice, activeTransition, 3 / 6),
    choiceActiveTransitionFade4: blendColor(choice, activeTransition, 4 / 6),
    choiceActiveTransitionFade5: blendColor(choice, activeTransition, 5 / 6),
  }
}

function visualLength(value: string): number {
  return stringWidth(value)
}

function normalizeDirection(value?: string): StateDiagramDirection {
  const upper = value?.toUpperCase()
  if (upper === "TB" || upper === "TD" || upper === "LR" || upper === "RL") return upper
  return DEFAULT_DIRECTION
}

function splitLines(value: string): string[] {
  return value.split(/<br\s*\/?>/i).map((line) => line.trim())
}

function isMermaidHeader(line: string): boolean {
  return line.toLowerCase() === "statediagram-v2" || line.toLowerCase() === "statediagram"
}

function markerId(position: "from" | "to"): string {
  return position === "from" ? "__start" : "__end"
}

function normalizeEndpoint(value: string, position: "from" | "to"): string {
  return value === "[*]" ? markerId(position) : value
}

function normalizeActiveTransition(activeTransition: StateDiagramActiveTransition): StateDiagramActiveTransition {
  return {
    from: normalizeEndpoint(activeTransition.from, "from"),
    to: normalizeEndpoint(activeTransition.to, "to"),
    label: activeTransition.label,
  }
}

function normalizeActiveTransitions(
  activeTransition: StateDiagramActiveTransitionSelection | undefined,
): StateDiagramActiveTransition[] {
  if (!activeTransition) return []
  const transitions = Array.isArray(activeTransition) ? activeTransition : [activeTransition]
  return transitions.map(normalizeActiveTransition)
}

function activeTransitionEqual(left: StateDiagramActiveTransition, right: StateDiagramActiveTransition): boolean {
  return left.from === right.from && left.to === right.to && left.label === right.label
}

function activeTransitionListsEqual(
  left: readonly StateDiagramActiveTransition[],
  right: readonly StateDiagramActiveTransition[],
): boolean {
  return (
    left.length === right.length && left.every((transition, index) => activeTransitionEqual(transition, right[index]!))
  )
}

function isActiveTransition(
  transition: StateDiagramTransition,
  activeTransitions: readonly StateDiagramActiveTransition[],
): boolean {
  return activeTransitionIndex(transition, activeTransitions) !== -1
}

function activeTransitionIndex(
  transition: StateDiagramTransition,
  activeTransitions: readonly StateDiagramActiveTransition[],
): number {
  return activeTransitions.findIndex(
    (activeTransition) =>
      activeTransition.from === transition.from &&
      activeTransition.to === transition.to &&
      (activeTransition.label === undefined || activeTransition.label === transition.label),
  )
}

function ensureState(
  states: Map<string, StateDiagramState>,
  id: string,
  label = id,
  kind: StateDiagramState["kind"] = "state",
) {
  const existing = states.get(id)
  if (existing) {
    if (existing.label === existing.id && label !== id) existing.label = label
    if (kind !== "state") {
      existing.kind = kind
      existing.label = label
    }
    return
  }
  states.set(id, { id, label, kind })
}

export function isMermaidStateDiagram(content: string): boolean {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("%%")) continue
    return isMermaidHeader(line)
  }
  return false
}

export function parseMermaidStateDiagram(content: string): StateDiagram {
  const states = new Map<string, StateDiagramState>()
  const transitions: StateDiagramTransition[] = []
  let direction: StateDiagramDirection = DEFAULT_DIRECTION

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("%%") || isMermaidHeader(line)) continue

    const directionMatch = line.match(DIRECTION_RE)
    if (directionMatch) {
      direction = normalizeDirection(directionMatch[1])
      continue
    }

    const stateMatch = line.match(STATE_RE)
    if (stateMatch) {
      ensureState(states, stateMatch[2]!, stateMatch[1]!)
      continue
    }

    const choiceMatch = line.match(CHOICE_STATE_RE)
    if (choiceMatch) {
      ensureState(states, choiceMatch[1]!, "┼", "choice")
      continue
    }

    const transitionMatch = line.match(TRANSITION_RE)
    if (transitionMatch) {
      const rawFrom = transitionMatch[1]!
      const rawTo = transitionMatch[2]!
      const from = normalizeEndpoint(rawFrom, "from")
      const to = normalizeEndpoint(rawTo, "to")
      ensureState(states, from, rawFrom === "[*]" ? "●" : from, rawFrom === "[*]" ? "start" : "state")
      ensureState(states, to, rawTo === "[*]" ? "◎" : to, rawTo === "[*]" ? "end" : "state")
      transitions.push({ from, to, label: transitionMatch[3]?.trim() ?? "" })
    }
  }

  return { direction, states: [...states.values()], transitions }
}

function makeGrid(width: number, height: number): StateGrid {
  return { rows: Array.from({ length: height }, () => Array.from({ length: width }, () => ({ char: " " }))) }
}

function setCell(grid: StateGrid, x: number, y: number, char: string, style?: StateCellStyle): void {
  if (y < 0 || y >= grid.rows.length || x < 0 || x >= grid.rows[y]!.length) return
  grid.rows[y]![x] = { char, style }
}

function setText(grid: StateGrid, x: number, y: number, text: string, style?: StateCellStyle): void {
  let offset = 0
  for (const char of text) {
    setCell(grid, x + offset, y, char, style)
    offset += visualLength(char)
  }
}

function computeRanks(diagram: StateDiagram): Map<string, number> {
  const ranks = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const transition of diagram.transitions) {
    const list = outgoing.get(transition.from) ?? []
    list.push(transition.to)
    outgoing.set(transition.from, list)
  }

  const first = diagram.states.find((state) => state.kind === "start")?.id ?? diagram.states[0]?.id
  if (!first) return ranks
  ranks.set(first, 0)
  const queue = [first]
  while (queue.length > 0) {
    const id = queue.shift()!
    const rank = ranks.get(id) ?? 0
    for (const to of outgoing.get(id) ?? []) {
      const nextRank = rank + 1
      if ((ranks.get(to) ?? Number.POSITIVE_INFINITY) <= nextRank) continue
      ranks.set(to, nextRank)
      queue.push(to)
    }
  }

  for (const state of diagram.states) {
    if (!ranks.has(state.id)) ranks.set(state.id, ranks.size)
  }
  return ranks
}

function outgoingTransitions(diagram: StateDiagram): Map<string, StateDiagramTransition[]> {
  const outgoing = new Map<string, StateDiagramTransition[]>()
  for (const transition of diagram.transitions) {
    const list = outgoing.get(transition.from) ?? []
    list.push(transition)
    outgoing.set(transition.from, list)
  }
  return outgoing
}

function reaches(diagram: StateDiagram, from: string, target: string): boolean {
  const outgoing = outgoingTransitions(diagram)
  const visited = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === target) return true
    if (visited.has(id)) continue
    visited.add(id)
    for (const transition of outgoing.get(id) ?? []) stack.push(transition.to)
  }
  return false
}

function hasReverseTransition(diagram: StateDiagram, transition: StateDiagramTransition): boolean {
  return diagram.transitions.some((other) => other.from === transition.to && other.to === transition.from)
}

function computeMainPath(diagram: StateDiagram): string[] {
  const outgoing = outgoingTransitions(diagram)
  const start = diagram.states.find((state) => state.kind === "start")?.id ?? diagram.states[0]?.id
  if (!start) return []

  const path = [start]
  const visited = new Set(path)
  let current = start
  while (true) {
    const candidates = (outgoing.get(current) ?? []).filter((transition) => !visited.has(transition.to))
    if (candidates.length === 0) break
    const next =
      candidates.find((transition) => diagram.states.find((state) => state.id === transition.to)?.kind === "end") ??
      candidates.find((transition) => !reaches(diagram, transition.to, current)) ??
      candidates.find((transition) => !hasReverseTransition(diagram, transition))
    if (!next) break
    path.push(next.to)
    visited.add(next.to)
    current = next.to
    if (diagram.states.find((state) => state.id === current)?.kind === "end") break
  }

  return path
}

function stateSize(state: StateDiagramState): { width: number; height: number; lines: string[] } {
  if (state.kind !== "state") return { width: 1, height: 1, lines: [state.label] }
  const lines = splitLines(state.label)
  const innerWidth = Math.max(...lines.map(visualLength), 1)
  return { width: innerWidth + 4, height: lines.length + 2, lines }
}

function createLayout(
  diagram: StateDiagram,
  options: Required<Pick<StateDiagramRenderOptions, "borderStyle" | "minStateGap">>,
): StateLayout {
  if (diagram.direction === "LR" || diagram.direction === "RL") {
    return createHorizontalLayout(diagram, options)
  }

  const ranks = computeRanks(diagram)
  const byRank = new Map<number, StateDiagramState[]>()
  for (const state of diagram.states) {
    const rank = ranks.get(state.id) ?? 0
    const list = byRank.get(rank) ?? []
    list.push(state)
    byRank.set(rank, list)
  }

  const rankKeys = [...byRank.keys()].sort((a, b) => a - b)
  const sizes = new Map(diagram.states.map((state) => [state.id, stateSize(state)]))
  const bounds = new Map<string, BoxBounds>()

  const singleColumnCenter = Math.max(
    0,
    ...rankKeys.flatMap((rank) => {
      const states = byRank.get(rank)!
      return states.length === 1 ? [Math.floor(sizes.get(states[0]!.id)!.width / 2)] : []
    }),
  )
  let y = 0
  for (const rank of rankKeys) {
    const states = byRank.get(rank)!
    const rowHeight = Math.max(...states.map((state) => sizes.get(state.id)!.height))
    let x = 0
    for (const state of states) {
      const size = sizes.get(state.id)!
      const top = y + Math.floor((rowHeight - size.height) / 2)
      const left = states.length === 1 ? singleColumnCenter - Math.floor(size.width / 2) : x
      bounds.set(state.id, {
        id: state.id,
        left,
        top,
        width: size.width,
        height: size.height,
        centerX: left + Math.floor(size.width / 2),
        centerY: top + Math.floor(size.height / 2),
      })
      x += size.width + options.minStateGap + 8
    }
    y += rowHeight + 4
  }

  return { bounds, sizes }
}

function createHorizontalLayout(
  diagram: StateDiagram,
  options: Required<Pick<StateDiagramRenderOptions, "borderStyle" | "minStateGap">>,
): StateLayout {
  const sizes = new Map(diagram.states.map((state) => [state.id, stateSize(state)]))
  const bounds = new Map<string, BoxBounds>()
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const mainPath = computeMainPath(diagram)
  const mainIds = new Set(mainPath)
  const baselineY = 1
  let x = 0

  for (const id of mainPath) {
    const state = statesById.get(id)
    const size = sizes.get(id)
    if (!state || !size) continue
    const top = state.kind === "state" ? baselineY - Math.floor(size.height / 2) : baselineY
    bounds.set(id, {
      id,
      left: x,
      top,
      width: size.width,
      height: size.height,
      centerX: x + Math.floor(size.width / 2),
      centerY: top + Math.floor(size.height / 2),
    })
    x += size.width + options.minStateGap + 8
  }

  const branchesByParent = new Map<string, string[]>()
  for (const transition of diagram.transitions) {
    if (!mainIds.has(transition.from) || mainIds.has(transition.to)) continue
    const list = branchesByParent.get(transition.from) ?? []
    if (!list.includes(transition.to)) list.push(transition.to)
    branchesByParent.set(transition.from, list)
  }

  for (const [parentId, branchIds] of branchesByParent) {
    const parent = bounds.get(parentId)
    if (!parent) continue
    const branchGap = 4
    const branchSizes = branchIds.map((id) => sizes.get(id)!).filter(Boolean)
    const totalWidth =
      branchSizes.reduce((sum, size) => sum + size.width, 0) + Math.max(0, branchSizes.length - 1) * branchGap
    let left = parent.centerX - Math.floor(totalWidth / 2)
    for (const branchId of branchIds) {
      if (bounds.has(branchId)) continue
      const size = sizes.get(branchId)
      if (!size) continue
      const top = baselineY + 5
      bounds.set(branchId, {
        id: branchId,
        left,
        top,
        width: size.width,
        height: size.height,
        centerX: left + Math.floor(size.width / 2),
        centerY: top + Math.floor(size.height / 2),
      })
      left += size.width + branchGap
    }
  }

  const ranks = computeRanks(diagram)
  const fallbackStates = diagram.states.filter((state) => !bounds.has(state.id))
  for (const state of fallbackStates) {
    const size = sizes.get(state.id)!
    const rank = ranks.get(state.id) ?? bounds.size
    const top = baselineY + 5
    const left = rank * (size.width + options.minStateGap + 8)
    bounds.set(state.id, {
      id: state.id,
      left,
      top,
      width: size.width,
      height: size.height,
      centerX: left + Math.floor(size.width / 2),
      centerY: top + Math.floor(size.height / 2),
    })
  }

  const minX = Math.min(0, ...[...bounds.values()].map((bound) => bound.left))
  if (minX < 0) {
    for (const bound of bounds.values()) {
      bound.left -= minX
      bound.centerX -= minX
    }
  }

  return { bounds, sizes }
}

function drawBox(
  grid: StateGrid,
  state: StateDiagramState,
  bounds: BoxBounds,
  lines: string[],
  active: boolean,
  borderStyle: BorderStyle,
): void {
  if (state.kind !== "state") {
    setCell(grid, bounds.left, bounds.top, state.label, active ? "activeState" : state.kind)
    return
  }
  const chars = BorderChars[borderStyle]
  const style: StateCellStyle = active ? "activeState" : "state"
  setCell(grid, bounds.left, bounds.top, chars.topLeft, style)
  setCell(grid, bounds.left + bounds.width - 1, bounds.top, chars.topRight, style)
  setCell(grid, bounds.left, bounds.top + bounds.height - 1, chars.bottomLeft, style)
  setCell(grid, bounds.left + bounds.width - 1, bounds.top + bounds.height - 1, chars.bottomRight, style)
  for (let x = bounds.left + 1; x < bounds.left + bounds.width - 1; x++) {
    setCell(grid, x, bounds.top, chars.horizontal, style)
    setCell(grid, x, bounds.top + bounds.height - 1, chars.horizontal, style)
  }
  for (let y = bounds.top + 1; y < bounds.top + bounds.height - 1; y++) {
    setCell(grid, bounds.left, y, chars.vertical, style)
    setCell(grid, bounds.left + bounds.width - 1, y, chars.vertical, style)
  }
  lines.forEach((line, index) => {
    setText(grid, bounds.left + 2, bounds.top + 1 + index, line, style)
  })
}

function transitionLineStyle(active: boolean): StateCellStyle {
  return active ? "activeTransition" : "transition"
}

function transitionLabelStyle(active: boolean): StateCellStyle {
  return active ? "activeTransition" : "label"
}

function transitionFadeStyle(
  source: FadeSourceStyle,
  distance: number,
  active: boolean,
  fadeFromSource: boolean,
): StateCellStyle {
  if (active) {
    if (!fadeFromSource) return "activeTransition"
    if (distance <= 0) return `${source}ActiveTransitionFade1` as ActiveTransitionFadeStyle
    if (distance >= FADE_STEPS.length) return "activeTransition"
    return `${source}ActiveTransitionFade${distance + 1}` as ActiveTransitionFadeStyle
  }
  if (distance <= 0) return `${source}TransitionFade1` as TransitionFadeStyle
  if (distance >= FADE_STEPS.length) return transitionLineStyle(active)
  return `${source}TransitionFade${distance + 1}` as TransitionFadeStyle
}

function drawHorizontalRamp(
  grid: StateGrid,
  fromX: number,
  toX: number,
  y: number,
  direction: 1 | -1,
  startDistance: number,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
): void {
  let distance = startDistance
  for (let x = fromX; direction === 1 ? x <= toX : x >= toX; x += direction) {
    setCell(grid, x, y, "─", transitionFadeStyle(fadeSource, distance, active, fadeFromSource))
    distance += 1
  }
}

function drawVerticalRamp(
  grid: StateGrid,
  x: number,
  fromY: number,
  toY: number,
  direction: 1 | -1,
  startDistance: number,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
): void {
  let distance = startDistance
  for (let y = fromY; direction === 1 ? y <= toY : y >= toY; y += direction) {
    setCell(grid, x, y, "│", transitionFadeStyle(fadeSource, distance, active, fadeFromSource))
    distance += 1
  }
}

function drawRightDeparture(
  grid: StateGrid,
  bounds: BoxBounds,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setCell(
    grid,
    bounds.left + bounds.width - 1,
    bounds.centerY,
    BorderChars.rounded.leftT,
    transitionFadeStyle(fadeSource, 0, active, fadeFromSource),
  )
}

function drawBottomDeparture(
  grid: StateGrid,
  bounds: BoxBounds,
  x: number,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setCell(
    grid,
    x,
    bounds.top + bounds.height - 1,
    BorderChars.rounded.topT,
    transitionFadeStyle(fadeSource, 0, active, fadeFromSource),
  )
}

function drawTopDeparture(
  grid: StateGrid,
  bounds: BoxBounds,
  x: number,
  fadeSource: FadeSourceStyle,
  active: boolean,
  fadeFromSource: boolean,
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return
  setCell(grid, x, bounds.top, BorderChars.rounded.bottomT, transitionFadeStyle(fadeSource, 0, active, fadeFromSource))
}

function arrowHeadChar(style: StateDiagramArrowHeadStyle, direction: "right" | "left" | "up" | "down"): string {
  if (style === "line") {
    if (direction === "right") return "→"
    if (direction === "left") return "←"
    if (direction === "up") return "↑"
    return "↓"
  }

  if (direction === "right") return "▶"
  if (direction === "left") return "◀"
  if (direction === "up") return "▲"
  return "▼"
}

function drawHorizontal(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  transition: StateDiagramTransition,
  diagram: StateDiagram,
  fadeSource: FadeSourceStyle,
  feedbackLaneY: number,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  active: boolean,
  fadeFromSource: boolean,
): void {
  if (transition.from === transition.to) {
    drawSelfTransition(grid, from, label, fadeSource, arrowHeadStyle, active, fadeFromSource)
    return
  }

  const leftToRight = from.centerX <= to.centerX
  const targetIsChoice = diagram.states.find((state) => state.id === transition.to)?.kind === "choice"
  if (!leftToRight) {
    drawBottomFeedback(
      grid,
      from,
      to,
      label,
      fadeSource,
      feedbackLaneY,
      arrowHeadStyle,
      targetIsChoice,
      active,
      fadeFromSource,
    )
    return
  }

  if (from.centerY !== to.centerY) {
    drawVerticalElbowTransition(
      grid,
      from,
      to,
      label,
      hasReverseTransition(diagram, transition),
      fadeSource,
      arrowHeadStyle,
      targetIsChoice,
      active,
      fadeFromSource,
    )
    return
  }

  const y = from.centerY
  const lineStyle = transitionLineStyle(active)
  drawRightDeparture(grid, from, fadeSource, active, fadeFromSource)
  const startX = from.left + from.width
  const endX = to.left - 1
  drawHorizontalRamp(grid, startX, targetIsChoice ? endX : endX - 1, y, 1, 1, fadeSource, active, fadeFromSource)
  if (!targetIsChoice) setCell(grid, endX, y, arrowHeadChar(arrowHeadStyle, "right"), lineStyle)
  if (label) {
    const text = splitLines(label)[0] ?? ""
    const labelX = Math.min(startX, endX) + Math.max(1, Math.floor(Math.abs(endX - startX - visualLength(text)) / 2))
    setText(grid, labelX, Math.max(0, y - 1), text, transitionLabelStyle(active))
  }
}

function drawSelfTransition(
  grid: StateGrid,
  bounds: BoxBounds,
  label: string,
  fadeSource: FadeSourceStyle,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  active: boolean,
  fadeFromSource: boolean,
): void {
  if (bounds.width <= 1 || bounds.height <= 1) return

  const lineStyle = transitionLineStyle(active)
  const sourceX = bounds.left + Math.max(2, Math.floor(bounds.width / 3))
  const bottomY = bounds.top + bounds.height - 1
  const railY = bottomY + 2
  const targetX = Math.max(sourceX + 3, bounds.left + Math.min(bounds.width - 3, Math.ceil((bounds.width * 2) / 3)))

  drawBottomDeparture(grid, bounds, sourceX, fadeSource, active, fadeFromSource)
  setCell(grid, sourceX, bottomY + 1, "│", transitionFadeStyle(fadeSource, 1, active, fadeFromSource))
  setCell(grid, sourceX, railY, "╰", lineStyle)
  for (let x = sourceX + 1; x < targetX; x++) setCell(grid, x, railY, "─", lineStyle)
  setCell(grid, targetX, railY, "╯", lineStyle)
  setCell(grid, targetX, bottomY + 1, arrowHeadChar(arrowHeadStyle, "up"), lineStyle)

  if (label) setText(grid, targetX + 2, bottomY + 1, splitLines(label)[0] ?? "", transitionLabelStyle(active))
}

function outsideBottomY(bounds: BoxBounds): number {
  return bounds.top + bounds.height
}

function drawBottomFeedback(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  fadeSource: FadeSourceStyle,
  railY: number,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  active: boolean,
  fadeFromSource: boolean,
): void {
  const lineStyle = transitionLineStyle(active)
  const sourceX = from.centerX
  const targetX = to.width > 1 ? (sourceX > to.centerX ? to.left + 1 : to.left + to.width - 2) : to.centerX
  const sourceBottomY = outsideBottomY(from)
  const targetBottomY = outsideBottomY(to)

  drawBottomDeparture(grid, from, sourceX, fadeSource, active, fadeFromSource)
  drawVerticalRamp(grid, sourceX, sourceBottomY, railY - 1, 1, 1, fadeSource, active, fadeFromSource)
  setCell(grid, sourceX, railY, sourceX > targetX ? "╯" : "╰", lineStyle)
  if (sourceX !== targetX) {
    const horizontalStep = sourceX < targetX ? 1 : -1
    for (let x = sourceX + horizontalStep; sourceX < targetX ? x !== targetX : x !== targetX; x += horizontalStep) {
      setCell(grid, x, railY, "─", lineStyle)
    }
  }
  setCell(grid, targetX, railY, sourceX > targetX ? "╰" : "╯", lineStyle)
  for (let y = railY - 1; y > targetBottomY; y--) setCell(grid, targetX, y, "│", lineStyle)
  setCell(grid, targetX, targetBottomY, targetIsChoice ? "│" : arrowHeadChar(arrowHeadStyle, "up"), lineStyle)

  if (label) {
    const text = splitLines(label)[0] ?? ""
    const labelX =
      Math.min(sourceX, targetX) + Math.max(1, Math.floor((Math.abs(sourceX - targetX) - visualLength(text)) / 2))
    setText(grid, labelX, Math.max(0, railY - 1), text, transitionLabelStyle(active))
  }
}

function drawVerticalElbowTransition(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  hasReverse: boolean,
  fadeSource: FadeSourceStyle,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  active: boolean,
  fadeFromSource: boolean,
): void {
  const lineStyle = transitionLineStyle(active)
  const topToBottom = from.centerY < to.centerY
  const offset = hasReverse ? (topToBottom ? -2 : 2) : 0
  const startX = from.centerX + offset
  const endX = to.centerX + offset
  const startY = topToBottom ? from.top + from.height : from.top - 1
  const endY = topToBottom ? to.top - 1 : to.top + to.height
  const verticalStep = topToBottom ? 1 : -1

  if (topToBottom) {
    drawBottomDeparture(grid, from, startX, fadeSource, active, fadeFromSource)
  } else {
    drawTopDeparture(grid, from, startX, fadeSource, active, fadeFromSource)
  }

  if (startY !== endY)
    drawVerticalRamp(grid, startX, startY, endY - verticalStep, verticalStep, 1, fadeSource, active, fadeFromSource)

  if (startX !== endX) {
    const horizontalStep = startX < endX ? 1 : -1
    setCell(grid, startX, endY, topToBottom ? (startX < endX ? "╰" : "╯") : startX < endX ? "╭" : "╮", lineStyle)
    for (let x = startX + horizontalStep; startX < endX ? x !== endX : x !== endX; x += horizontalStep) {
      setCell(grid, x, endY, "─", lineStyle)
    }
  }

  const targetChar = targetIsChoice
    ? startX === endX
      ? "│"
      : topToBottom
        ? "┬"
        : "┴"
    : arrowHeadChar(arrowHeadStyle, topToBottom ? "down" : "up")
  setCell(grid, endX, endY, targetChar, lineStyle)
  if (label) {
    const text = splitLines(label)[0] ?? ""
    if (topToBottom) {
      const labelX = hasReverse || endX < startX ? startX - visualLength(text) - 2 : startX + 2
      setText(grid, labelX, Math.min(startY + 1, endY), text, transitionLabelStyle(active))
    } else {
      const labelX =
        Math.min(startX, endX) + Math.max(1, Math.floor((Math.abs(endX - startX) - visualLength(text)) / 2))
      setText(grid, startX === endX ? startX + 3 : labelX, Math.max(0, startY), text, transitionLabelStyle(active))
    }
  }
}

function drawVertical(
  grid: StateGrid,
  from: BoxBounds,
  to: BoxBounds,
  label: string,
  fadeSource: FadeSourceStyle,
  arrowHeadStyle: StateDiagramArrowHeadStyle,
  targetIsChoice: boolean,
  active: boolean,
  fadeFromSource: boolean,
): void {
  const lineStyle = transitionLineStyle(active)
  const topToBottom = from.centerY <= to.centerY
  const x = from.centerX
  const startY = topToBottom ? from.top + from.height : from.top - 1
  const endY = topToBottom ? to.top - 1 : to.top + to.height
  const step = topToBottom ? 1 : -1

  if (topToBottom) {
    drawBottomDeparture(grid, from, x, fadeSource, active, fadeFromSource)
  } else {
    drawTopDeparture(grid, from, x, fadeSource, active, fadeFromSource)
  }

  if (startY !== endY) drawVerticalRamp(grid, x, startY, endY - step, step, 1, fadeSource, active, fadeFromSource)
  setCell(grid, x, endY, targetIsChoice ? "│" : arrowHeadChar(arrowHeadStyle, topToBottom ? "down" : "up"), lineStyle)
  if (label) setText(grid, x + 2, Math.min(startY, endY) + 1, splitLines(label)[0] ?? "", transitionLabelStyle(active))
}

type JunctionDirection = "left" | "right" | "up" | "down"

function connectionDirection(from: BoxBounds, to: BoxBounds): JunctionDirection {
  const deltaX = to.centerX - from.centerX
  const deltaY = to.centerY - from.centerY
  if (Math.abs(deltaX) >= Math.abs(deltaY) && deltaX !== 0) return deltaX > 0 ? "right" : "left"
  if (deltaY !== 0) return deltaY > 0 ? "down" : "up"
  return "right"
}

function junctionGlyph(connections: Set<JunctionDirection>): string {
  const left = connections.has("left")
  const right = connections.has("right")
  const up = connections.has("up")
  const down = connections.has("down")

  if (left && right && up && down) return "┼"
  if (left && right && down) return "┬"
  if (left && right && up) return "┴"
  if (up && down && right) return "├"
  if (up && down && left) return "┤"
  if (left && right) return "─"
  if (up && down) return "│"
  if (right && down) return "╭"
  if (left && down) return "╮"
  if (right && up) return "╰"
  if (left && up) return "╯"
  if (left || right) return "─"
  if (up || down) return "│"
  return "┼"
}

function drawChoiceJunctions(
  grid: StateGrid,
  diagram: StateDiagram,
  bounds: Map<string, BoxBounds>,
  activeState: string | undefined,
  activeTransitions: readonly StateDiagramActiveTransition[],
): void {
  for (const state of diagram.states) {
    if (state.kind !== "choice") continue
    const choiceBounds = bounds.get(state.id)
    if (!choiceBounds) continue

    const connections = new Set<JunctionDirection>()
    let active = false
    for (const transition of diagram.transitions) {
      if (transition.to === state.id) {
        const sourceBounds = bounds.get(transition.from)
        if (sourceBounds) connections.add(connectionDirection(choiceBounds, sourceBounds))
        active = active || isActiveTransition(transition, activeTransitions)
      }
      if (transition.from === state.id) {
        const targetBounds = bounds.get(transition.to)
        if (targetBounds) connections.add(connectionDirection(choiceBounds, targetBounds))
        active = active || isActiveTransition(transition, activeTransitions)
      }
    }

    setCell(
      grid,
      choiceBounds.left,
      choiceBounds.top,
      junctionGlyph(connections),
      state.id === activeState ? "activeState" : active ? "activeTransition" : "choice",
    )
  }
}

function transitionFadeSource(
  statesById: Map<string, StateDiagramState>,
  transition: StateDiagramTransition,
  activeState: string | undefined,
): FadeSourceStyle {
  const source = statesById.get(transition.from)
  if (source?.kind === "start") return "start"
  if (source?.kind === "end") return "end"
  if (source?.kind === "choice") return "choice"
  return transition.from === activeState ? "activeState" : "state"
}

function layoutStateDiagram(content: string, options: StateDiagramRenderOptions = {}): StateGrid {
  const diagram = parseMermaidStateDiagram(content)
  diagram.direction = options.direction ?? diagram.direction
  const borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
  const arrowHeadStyle = options.arrowHeadStyle ?? DEFAULT_ARROW_HEAD_STYLE
  const minStateGap = Math.max(1, Math.floor(options.minStateGap ?? DEFAULT_MIN_STATE_GAP))
  const activeTransitions = normalizeActiveTransitions(options.activeTransition)
  const { bounds, sizes } = createLayout(diagram, { borderStyle, minStateGap })
  const statesById = new Map(diagram.states.map((state) => [state.id, state]))
  const maxX = Math.max(0, ...[...bounds.values()].map((bound) => bound.left + bound.width))
  const maxY = Math.max(0, ...[...bounds.values()].map((bound) => bound.top + bound.height))
  const feedbackLaneY = maxY + 3
  const grid = makeGrid(maxX + 24, maxY + 8)

  for (const state of diagram.states) {
    const bound = bounds.get(state.id)
    const size = sizes.get(state.id)
    if (!bound || !size) continue
    drawBox(grid, state, bound, size.lines, options.activeState === state.id, borderStyle)
  }

  for (const transition of diagram.transitions) {
    const from = bounds.get(transition.from)
    const to = bounds.get(transition.to)
    if (!from || !to) continue
    const fadeSource = transitionFadeSource(statesById, transition, options.activeState)
    const activeIndex = activeTransitionIndex(transition, activeTransitions)
    const active = activeIndex !== -1
    const fadeFromSource = activeIndex <= 0
    const targetIsChoice = statesById.get(transition.to)?.kind === "choice"
    if (diagram.direction === "LR" || diagram.direction === "RL")
      drawHorizontal(
        grid,
        from,
        to,
        transition.label,
        transition,
        diagram,
        fadeSource,
        feedbackLaneY,
        arrowHeadStyle,
        active,
        fadeFromSource,
      )
    else
      drawVertical(grid, from, to, transition.label, fadeSource, arrowHeadStyle, targetIsChoice, active, fadeFromSource)
  }

  drawChoiceJunctions(grid, diagram, bounds, options.activeState, activeTransitions)

  return grid
}

function renderGridText(grid: StateGrid): string {
  return grid.rows
    .map((row) =>
      row
        .map((cell) => cell.char)
        .join("")
        .trimEnd(),
    )
    .join("\n")
    .trimEnd()
}

function forEachGridRun(
  grid: StateGrid,
  onRun: (text: string, style: StateCellStyle | undefined) => void,
  onLineEnd: () => void,
): void {
  for (let rowIndex = 0; rowIndex < grid.rows.length; rowIndex++) {
    const row = grid.rows[rowIndex]!
    let rowEnd = row.length
    while (rowEnd > 0 && row[rowEnd - 1]?.char === " ") rowEnd -= 1

    let currentStyle: StateCellStyle | undefined
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

function renderGridStyledText(grid: StateGrid, colors: StateStyleColors): StyledText {
  const chunks: TextChunk[] = []

  forEachGridRun(
    grid,
    (text, style) => {
      chunks.push({
        __isChunk: true,
        text,
        fg: styleColor(style, colors),
      })
    },
    () => {
      chunks.push({ __isChunk: true, text: "\n" })
    },
  )

  return new StyledText(chunks)
}

function renderGridAnsi(grid: StateGrid, theme: StateDiagramAnsiTheme = {}): string {
  const resolved = { ...DEFAULT_ANSI_THEME, ...theme }
  let output = ""

  forEachGridRun(
    grid,
    (text, style) => {
      const ansi = style ? resolved[style] : undefined
      output += ansi ? `${ansi}${text}${ANSI.reset}` : text
    },
    () => {
      output += "\n"
    },
  )

  return output.trimEnd()
}

export function renderStateDiagram(content: string, options: StateDiagramRenderOptions = {}): string {
  return renderGridText(layoutStateDiagram(content, options))
}

export function renderStateDiagramAnsi(content: string, options: StateDiagramAnsiOptions = {}): string {
  return renderGridAnsi(layoutStateDiagram(content, options), options.theme)
}

function colorsEqual(left?: RGBA, right?: RGBA): boolean {
  if (!left || !right) return left === right
  return left.equals(right)
}

export class StateDiagramRenderable extends TextBufferRenderable {
  private _content: string
  private _direction?: StateDiagramDirection
  private _borderStyle: BorderStyle
  private _arrowHeadStyle: StateDiagramArrowHeadStyle
  private _minStateGap: number
  private _activeState?: string
  private _activeTransitions: StateDiagramActiveTransition[]
  private _stateColor?: RGBA
  private _activeStateColor?: RGBA
  private _transitionColor?: RGBA
  private _activeTransitionColor?: RGBA
  private _labelColor?: RGBA
  private _startColor?: RGBA
  private _endColor?: RGBA
  private _choiceColor?: RGBA

  constructor(ctx: RenderContext, options: StateDiagramOptions = {}) {
    super(ctx, { ...options, wrapMode: options.wrapMode ?? "none" })
    this._content = options.content ?? ""
    this._direction = options.direction
    this._borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
    this._arrowHeadStyle = options.arrowHeadStyle ?? DEFAULT_ARROW_HEAD_STYLE
    this._minStateGap = options.minStateGap ?? DEFAULT_MIN_STATE_GAP
    this._activeState = options.activeState
    this._activeTransitions = normalizeActiveTransitions(options.activeTransition)
    this._stateColor = options.stateColor ? parseColor(options.stateColor) : undefined
    this._activeStateColor = options.activeStateColor ? parseColor(options.activeStateColor) : undefined
    this._transitionColor = options.transitionColor ? parseColor(options.transitionColor) : undefined
    this._activeTransitionColor = options.activeTransitionColor ? parseColor(options.activeTransitionColor) : undefined
    this._labelColor = options.labelColor ? parseColor(options.labelColor) : undefined
    this._startColor = options.startColor ? parseColor(options.startColor) : undefined
    this._endColor = options.endColor ? parseColor(options.endColor) : undefined
    this._choiceColor = options.choiceColor ? parseColor(options.choiceColor) : undefined
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

  get activeState(): string | undefined {
    return this._activeState
  }

  set activeState(value: string | undefined) {
    if (this._activeState === value) return
    this._activeState = value
    this.updateDiagram()
  }

  get direction(): StateDiagramDirection | undefined {
    return this._direction
  }

  set direction(value: StateDiagramDirection | undefined) {
    if (this._direction === value) return
    this._direction = value
    this.updateDiagram()
  }

  get borderStyle(): BorderStyle {
    return this._borderStyle
  }

  set borderStyle(value: BorderStyle | undefined) {
    const next = value ?? DEFAULT_BORDER_STYLE
    if (this._borderStyle === next) return
    this._borderStyle = next
    this.updateDiagram()
  }

  get minStateGap(): number {
    return this._minStateGap
  }

  set minStateGap(value: number | undefined) {
    const next = value ?? DEFAULT_MIN_STATE_GAP
    if (this._minStateGap === next) return
    this._minStateGap = next
    this.updateDiagram()
  }

  get activeTransition(): StateDiagramActiveTransitionSelection | undefined {
    if (this._activeTransitions.length === 0) return undefined
    if (this._activeTransitions.length === 1) return this._activeTransitions[0]
    return [...this._activeTransitions]
  }

  set activeTransition(value: StateDiagramActiveTransitionSelection | undefined) {
    const next = normalizeActiveTransitions(value)
    if (activeTransitionListsEqual(this._activeTransitions, next)) return
    this._activeTransitions = next
    this.updateDiagram()
  }

  get arrowHeadStyle(): StateDiagramArrowHeadStyle {
    return this._arrowHeadStyle
  }

  set arrowHeadStyle(value: StateDiagramArrowHeadStyle | undefined) {
    const next = value ?? DEFAULT_ARROW_HEAD_STYLE
    if (this._arrowHeadStyle === next) return
    this._arrowHeadStyle = next
    this.updateDiagram()
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

  set stateColor(value: ColorInput | undefined) {
    this.setColor(this._stateColor, value, (color) => (this._stateColor = color))
  }

  set activeStateColor(value: ColorInput | undefined) {
    this.setColor(this._activeStateColor, value, (color) => (this._activeStateColor = color))
  }

  set transitionColor(value: ColorInput | undefined) {
    this.setColor(this._transitionColor, value, (color) => (this._transitionColor = color))
  }

  set activeTransitionColor(value: ColorInput | undefined) {
    this.setColor(this._activeTransitionColor, value, (color) => (this._activeTransitionColor = color))
  }

  set labelColor(value: ColorInput | undefined) {
    this.setColor(this._labelColor, value, (color) => (this._labelColor = color))
  }

  set startColor(value: ColorInput | undefined) {
    this.setColor(this._startColor, value, (color) => (this._startColor = color))
  }

  set endColor(value: ColorInput | undefined) {
    this.setColor(this._endColor, value, (color) => (this._endColor = color))
  }

  set choiceColor(value: ColorInput | undefined) {
    this.setColor(this._choiceColor, value, (color) => (this._choiceColor = color))
  }

  private updateDiagram(): void {
    const grid = layoutStateDiagram(this._content, {
      direction: this._direction,
      borderStyle: this._borderStyle,
      arrowHeadStyle: this._arrowHeadStyle,
      minStateGap: this._minStateGap,
      activeState: this._activeState,
      activeTransition: this._activeTransitions,
    })
    this.textBuffer.setStyledText(
      renderGridStyledText(
        grid,
        resolveStateStyleColors({
          state: this._stateColor,
          activeState: this._activeStateColor,
          transition: this._transitionColor,
          activeTransition: this._activeTransitionColor,
          label: this._labelColor,
          start: this._startColor,
          end: this._endColor,
          choice: this._choiceColor,
        }),
      ),
    )
    this.updateTextInfo()
    this.requestRender()
  }
}
