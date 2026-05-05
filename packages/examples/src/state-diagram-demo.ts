import {
  type CliRenderer,
  createCliRenderer,
  type KeyEvent,
  parseMermaidStateDiagram,
  renderStateDiagram,
  renderStateDiagramAnsi,
  type StateDiagram,
  type StateDiagramActiveTransition,
  StateDiagramRenderable,
  TextRenderable,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

export const REQUEST_STATE_DIAGRAM = `stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: 200 OK
  Loading --> Error: timeout
  Error --> Loading: retry
  Success --> [*]`

export const CHECKOUT_STATE_DIAGRAM = `stateDiagram-v2
  direction TB
  [*] --> Cart
  Cart --> Payment: checkout
  Payment --> Authorized: approved
  Payment --> Failed: declined
  Failed --> Payment: retry
  Authorized --> Fulfillment
  Fulfillment --> Complete
  Complete --> [*]`

export const EDITOR_STATE_DIAGRAM = `stateDiagram-v2
  direction LR
  state Decision <<choice>>
  [*] --> Editing
  Editing --> Editing: type
  Editing --> Validating: submit
  Validating --> Decision
  Decision --> Submitted: valid
  Decision --> Invalid: errors
  Invalid --> Editing: fix`

export const SOCKET_STATE_DIAGRAM = `stateDiagram-v2
  direction LR
  state "Backoff<br/>Timer" as Backoff
  [*] --> Disconnected
  Disconnected --> Connecting: connect
  Connecting --> Connected: open
  Connecting --> Backoff: fail
  Connected --> Disconnected: close
  Backoff --> Connecting: timer`

interface StateDiagramExample {
  title: string
  content: string
}

interface SelectableTransition {
  label: string
  to: string
  path: StateDiagramActiveTransition[]
}

const EXAMPLES: StateDiagramExample[] = [
  { title: "Request Lifecycle", content: REQUEST_STATE_DIAGRAM },
  { title: "Checkout", content: CHECKOUT_STATE_DIAGRAM },
  { title: "Form Submit", content: EDITOR_STATE_DIAGRAM },
  { title: "WebSocket", content: SOCKET_STATE_DIAGRAM },
]

interface StateDiagramTheme {
  name: string
  background: string
  foreground: string
  footer: string
  state: string
  activeState: string
  transition: string
  activeTransition: string
  end: string
}

const THEMES: StateDiagramTheme[] = [
  {
    name: "Moss Copper",
    background: "#101815",
    foreground: "#D7E5DD",
    footer: "#8DA99B",
    state: "#E4EFE8",
    activeState: "#FFD3A0",
    transition: "#86E1C8",
    activeTransition: "#E6B17E",
    end: "#E6B17E",
  },
  {
    name: "Glacier",
    background: "#111827",
    foreground: "#D6DEE9",
    footer: "#94A3B8",
    state: "#E7EDF5",
    activeState: "#FFE38A",
    transition: "#7DD3FC",
    activeTransition: "#FCD34D",
    end: "#FCD34D",
  },
  {
    name: "Ink Peach",
    background: "#111422",
    foreground: "#D8DEEE",
    footer: "#9AA6C1",
    state: "#E8ECF8",
    activeState: "#FFD0A3",
    transition: "#93C5FD",
    activeTransition: "#FDBA74",
    end: "#FDBA74",
  },
  {
    name: "Ember Terminal",
    background: "#17120F",
    foreground: "#F3E8D8",
    footer: "#BDA38B",
    state: "#F3E8D8",
    activeState: "#FF9AAD",
    transition: "#F59E0B",
    activeTransition: "#FB7185",
    end: "#FB7185",
  },
]

let diagram: StateDiagramRenderable | undefined
let footer: TextRenderable | undefined
let exampleIndex = 0
let themeIndex = 0
let parsedDiagram = parseMermaidStateDiagram(EXAMPLES[exampleIndex]!.content)
let activeState: string | undefined
let activeTransitionIndex = 0
let activeRenderer: CliRenderer | undefined
let resizeHandler: ((width: number, height: number) => void) | undefined
let keyHandler: ((key: KeyEvent) => void) | undefined

function renderedSize(content: string): { width: number; height: number } {
  const lines = renderStateDiagram(content).split("\n")
  return {
    width: Math.max(0, ...lines.map((line) => line.length)),
    height: lines.length,
  }
}

function centerDiagram(): void {
  if (!diagram || !activeRenderer) return
  const size = renderedSize(EXAMPLES[exampleIndex]!.content)
  diagram.width = size.width
  diagram.height = size.height
  diagram.x = Math.max(0, Math.floor((activeRenderer.width - size.width) / 2))
  diagram.y = Math.max(0, Math.floor((activeRenderer.height - size.height) / 2))

  positionFooter()
}

function positionFooter(): void {
  if (!footer || !activeRenderer) return
  footer.y = Math.max(0, activeRenderer.height - 2)
  footer.x = Math.max(0, Math.floor((activeRenderer.width - footer.content.length) / 2))
}

function applyTheme(renderer: CliRenderer): void {
  if (!diagram) return
  const theme = THEMES[themeIndex]!
  renderer.setBackgroundColor(theme.background)
  diagram.fg = theme.foreground
  diagram.bg = theme.background
  diagram.stateColor = theme.state
  diagram.activeStateColor = theme.activeState
  diagram.transitionColor = theme.transition
  diagram.activeTransitionColor = theme.activeTransition
  diagram.labelColor = theme.transition
  diagram.startColor = theme.transition
  diagram.choiceColor = theme.transition
  diagram.endColor = theme.end

  if (footer) {
    footer.fg = theme.footer
    updateFooter()
  }
  centerDiagram()
}

function currentParsedDiagram(): StateDiagram {
  return parsedDiagram
}

function stateTitle(parsed: StateDiagram, id: string | undefined): string {
  if (!id) return "none"
  if (id === "__start") return "start"
  if (id === "__end") return "end"
  return parsed.states.find((state) => state.id === id)?.label.replace(/<br\s*\/?>/gi, " ") ?? id
}

function selectableTransitionsFrom(
  parsed: StateDiagram,
  from: string,
  visited: Set<string> = new Set(),
): SelectableTransition[] {
  if (visited.has(from)) return []
  const nextVisited = new Set(visited)
  nextVisited.add(from)
  const statesById = new Map(parsed.states.map((state) => [state.id, state]))
  const transitions = parsed.transitions.filter((transition) => transition.from === from)
  const selectables: SelectableTransition[] = []

  for (const transition of transitions) {
    const path = [{ from: transition.from, to: transition.to, label: transition.label }]
    if (statesById.get(transition.to)?.kind === "choice") {
      const branches = selectableTransitionsFrom(parsed, transition.to, nextVisited)
      if (branches.length > 0) {
        for (const branch of branches) {
          selectables.push({
            label: branch.label || transition.label || "next",
            to: branch.to,
            path: [...path, ...branch.path],
          })
        }
        continue
      }
    }

    selectables.push({ label: transition.label || "next", to: transition.to, path })
  }

  return selectables
}

function selectableTransitions(parsed = currentParsedDiagram()): SelectableTransition[] {
  if (!activeState) return []
  return selectableTransitionsFrom(parsed, activeState)
}

function selectedTransition(parsed = currentParsedDiagram()): SelectableTransition | undefined {
  const transitions = selectableTransitions(parsed)
  if (transitions.length === 0) return undefined
  const index = ((activeTransitionIndex % transitions.length) + transitions.length) % transitions.length
  return transitions[index]
}

function selectedActiveTransition(parsed = currentParsedDiagram()): StateDiagramActiveTransition[] | undefined {
  const transition = selectedTransition(parsed)
  if (!transition) return undefined
  return transition.path
}

function resetInteraction(): void {
  const parsed = currentParsedDiagram()
  activeState = parsed.states.find((state) => state.kind === "start")?.id ?? parsed.states[0]?.id
  activeTransitionIndex = 0
}

function updateFooter(): void {
  if (!footer) return
  const parsed = currentParsedDiagram()
  const transition = selectedTransition(parsed)
  const transitionText = transition
    ? `Selected: ${transition.label || "next"} -> ${stateTitle(parsed, transition.to)}`
    : "No outgoing transition"
  footer.content = `${EXAMPLES[exampleIndex]!.title} · State: ${stateTitle(parsed, activeState)} · ${transitionText} · Tab edge · Enter follow · ←/→ examples · T theme`
  positionFooter()
}

function syncInteraction(): void {
  if (!diagram) return
  const parsed = currentParsedDiagram()
  diagram.activeState = activeState
  diagram.activeTransition = selectedActiveTransition(parsed)
  updateFooter()
}

function updateDiagram(): void {
  if (!diagram || !activeRenderer) return
  const example = EXAMPLES[exampleIndex]!
  parsedDiagram = parseMermaidStateDiagram(example.content)
  diagram.content = example.content
  resetInteraction()
  syncInteraction()
  applyTheme(activeRenderer)
}

function cycleTransition(direction: 1 | -1): void {
  const transitions = selectableTransitions()
  if (transitions.length === 0) return
  activeTransitionIndex = (activeTransitionIndex + direction + transitions.length) % transitions.length
  syncInteraction()
}

function followSelectedTransition(): void {
  const transition = selectedTransition()
  if (!transition) return
  activeState = transition.to
  activeTransitionIndex = 0
  syncInteraction()
}

export function run(renderer: CliRenderer): void {
  activeRenderer = renderer
  const theme = THEMES[themeIndex]!
  renderer.setBackgroundColor(theme.background)
  const example = EXAMPLES[exampleIndex]!
  parsedDiagram = parseMermaidStateDiagram(example.content)
  resetInteraction()
  const size = renderedSize(example.content)
  diagram = new StateDiagramRenderable(renderer, {
    id: "state-diagram-demo",
    content: example.content,
    activeState,
    activeTransition: selectedActiveTransition(),
    position: "absolute",
    left: Math.max(0, Math.floor((renderer.width - size.width) / 2)),
    top: Math.max(0, Math.floor((renderer.height - size.height) / 2)),
    width: size.width,
    height: size.height,
    fg: theme.foreground,
    bg: theme.background,
    stateColor: theme.state,
    activeStateColor: theme.activeState,
    transitionColor: theme.transition,
    activeTransitionColor: theme.activeTransition,
    labelColor: theme.transition,
    startColor: theme.transition,
    choiceColor: theme.transition,
    endColor: theme.end,
  })
  renderer.root.add(diagram)

  footer = new TextRenderable(renderer, {
    id: "state-diagram-footer",
    content: "",
    position: "absolute",
    left: 0,
    top: Math.max(0, renderer.height - 2),
    fg: theme.footer,
  })
  renderer.root.add(footer)
  applyTheme(renderer)
  syncInteraction()

  keyHandler = (key) => {
    if (key.name === "right") {
      exampleIndex = (exampleIndex + 1) % EXAMPLES.length
      updateDiagram()
    } else if (key.name === "left") {
      exampleIndex = (exampleIndex - 1 + EXAMPLES.length) % EXAMPLES.length
      updateDiagram()
    } else if (key.name === "tab") {
      key.preventDefault()
      cycleTransition(key.shift ? -1 : 1)
    } else if (key.name === "return" || key.name === "linefeed" || key.name === "enter") {
      key.preventDefault()
      followSelectedTransition()
    } else if (key.name === "t") {
      themeIndex = (themeIndex + 1) % THEMES.length
      applyTheme(renderer)
    }
  }
  renderer.keyInput.on("keypress", keyHandler)

  resizeHandler = () => centerDiagram()
  renderer.on("resize", resizeHandler)
  setupCommonDemoKeys(renderer)
}

export function destroy(renderer: CliRenderer): void {
  if (keyHandler) renderer.keyInput.off("keypress", keyHandler)
  if (resizeHandler) renderer.off("resize", resizeHandler)
  diagram?.destroyRecursively()
  footer?.destroyRecursively()
  diagram = undefined
  footer = undefined
  activeRenderer = undefined
  keyHandler = undefined
  resizeHandler = undefined
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    const exampleArg = process.argv.find((arg) => arg.startsWith("--example="))
    const index = Math.max(0, Math.min(EXAMPLES.length - 1, Number.parseInt(exampleArg?.split("=")[1] ?? "1", 10) - 1))
    const plain = process.argv.includes("--plain")
    const content = EXAMPLES[index]!.content
    process.stdout.write(plain ? renderStateDiagram(content) : renderStateDiagramAnsi(content))
  } else {
    const renderer = await createCliRenderer({ targetFps: 30 })
    run(renderer)
  }
}
