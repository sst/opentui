import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  type KeyEvent,
  renderSequenceDiagram,
  renderSequenceDiagramAnsi,
  ScrollBoxRenderable,
  SequenceDiagramRenderable,
  TextRenderable,
} from "@opentui/core"
import { setupCommonDemoKeys } from "./lib/standalone-keys.js"

export const AUTH_SEQUENCE_DIAGRAM = `sequenceDiagram
  participant Browser
  participant API
  participant Cache
  participant DB
  Browser->>+API: GET /users/42
  API->>+Cache: get user:42
  alt cache hit
    Cache-->>-API: { user }
  else cache miss
    Cache-->>-API: null
    API->>+DB: SELECT user WHERE id=42
    DB-->>-API: row
    API->>+Cache: set user:42
    Cache-->>-API: ok
  end
  Note over API,Cache: cache is refreshed on misses
  API-->>-Browser: 200 { user }`

let container: BoxRenderable | null = null
let scrollBox: ScrollBoxRenderable | null = null
let diagram: SequenceDiagramRenderable | null = null
let footer: TextRenderable | null = null
let keyHandler: ((key: KeyEvent) => void) | null = null
let themeIndex = 0

interface SequenceDiagramTheme {
  name: string
  description: string
  background: string
  panelBorder: string
  title: string
  footer: string
  foreground: string
  participant: string
  lifeline: string
  request: string
  response: string
  activation: string
  note: string
  noteBackground: string
}

const THEMES: SequenceDiagramTheme[] = [
  {
    name: "Moss Copper",
    description: "green requests, copper responses, dusty mauve notes",
    background: "#101815",
    panelBorder: "#2F453B",
    title: "#E4EFE8",
    footer: "#8DA99B",
    foreground: "#D7E5DD",
    participant: "#E4EFE8",
    lifeline: "#6F8A7E",
    request: "#86E1C8",
    response: "#E6B17E",
    activation: "#AECABD",
    note: "#D7E5DD",
    noteBackground: "#24382F",
  },
  {
    name: "Glacier",
    description: "cool slate, soft sky, warm amber",
    background: "#111827",
    panelBorder: "#374151",
    title: "#E7EDF5",
    footer: "#94A3B8",
    foreground: "#D6DEE9",
    participant: "#E7EDF5",
    lifeline: "#64748B",
    request: "#7DD3FC",
    response: "#FCD34D",
    activation: "#A6B2C4",
    note: "#D6DEE9",
    noteBackground: "#253044",
  },
  {
    name: "Ink Peach",
    description: "blue ink, peach replies, fuchsia labels",
    background: "#111422",
    panelBorder: "#30384F",
    title: "#E8ECF8",
    footer: "#9AA6C1",
    foreground: "#D8DEEE",
    participant: "#E8ECF8",
    lifeline: "#69728B",
    request: "#93C5FD",
    response: "#FDBA74",
    activation: "#ABB3C5",
    note: "#D8DEEE",
    noteBackground: "#2B3144",
  },
  {
    name: "Quiet Notebook",
    description: "low-chroma, long-session friendly",
    background: "#11151C",
    panelBorder: "#303742",
    title: "#E3E8EF",
    footer: "#8B96A5",
    foreground: "#D2DAE5",
    participant: "#E3E8EF",
    lifeline: "#606B7A",
    request: "#A5D8FF",
    response: "#FFE08A",
    activation: "#9FAAB8",
    note: "#D2DAE5",
    noteBackground: "#252C38",
  },
]

function applyTheme(renderer: CliRenderer, theme: SequenceDiagramTheme): void {
  renderer.setBackgroundColor(theme.background)
  container!.backgroundColor = theme.background
  scrollBox!.backgroundColor = theme.background
  scrollBox!.borderColor = theme.panelBorder
  scrollBox!.viewportOptions = { backgroundColor: theme.background }
  scrollBox!.contentOptions = { backgroundColor: theme.background }

  diagram!.fg = theme.foreground
  diagram!.bg = theme.background
  diagram!.participantColor = theme.participant
  diagram!.lifelineColor = theme.lifeline
  diagram!.requestColor = theme.request
  diagram!.responseColor = theme.response
  diagram!.activationColor = theme.activation
  diagram!.noteColor = theme.note
  diagram!.noteBackgroundColor = theme.noteBackground

  footer!.fg = theme.footer
  footer!.content = `Theme: ${theme.name} · T cycles themes · + / - activates participants`
}

export function run(renderer: CliRenderer): void {
  const initialTheme = THEMES[themeIndex]!
  renderer.setBackgroundColor(initialTheme.background)

  container = new BoxRenderable(renderer, {
    id: "sequence-diagram-demo",
    flexGrow: 1,
    flexDirection: "column",
    backgroundColor: initialTheme.background,
    padding: 1,
  })

  const title = new TextRenderable(renderer, {
    id: "sequence-diagram-title",
    content: "Mermaid sequenceDiagram → OpenTUI",
    fg: initialTheme.title,
    marginBottom: 1,
    flexShrink: 0,
  })

  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "sequence-diagram-scrollbox",
    rootOptions: {
      border: true,
      borderColor: initialTheme.panelBorder,
      backgroundColor: initialTheme.background,
    },
    viewportOptions: {
      backgroundColor: initialTheme.background,
    },
    contentOptions: {
      backgroundColor: initialTheme.background,
      padding: 1,
    },
    flexGrow: 1,
  })

  diagram = new SequenceDiagramRenderable(renderer, {
    id: "auth-sequence-diagram",
    content: AUTH_SEQUENCE_DIAGRAM,
    fg: initialTheme.foreground,
    bg: initialTheme.background,
    participantColor: initialTheme.participant,
    lifelineColor: initialTheme.lifeline,
    requestColor: initialTheme.request,
    responseColor: initialTheme.response,
    activationColor: initialTheme.activation,
    noteColor: initialTheme.note,
    noteBackgroundColor: initialTheme.noteBackground,
  })

  footer = new TextRenderable(renderer, {
    id: "sequence-diagram-footer",
    content: "",
    fg: initialTheme.footer,
    marginTop: 1,
    flexShrink: 0,
  })

  scrollBox.add(diagram)
  container.add(title)
  container.add(scrollBox)
  container.add(footer)
  renderer.root.add(container)
  scrollBox.focus()
  applyTheme(renderer, initialTheme)

  keyHandler = (key: KeyEvent) => {
    if (key.name !== "t" || key.ctrl || key.meta) return
    themeIndex = (themeIndex + 1) % THEMES.length
    applyTheme(renderer, THEMES[themeIndex]!)
  }
  renderer.keyInput.on("keypress", keyHandler)
}

export function destroy(renderer: CliRenderer): void {
  if (keyHandler) {
    renderer.keyInput.off("keypress", keyHandler)
    keyHandler = null
  }
  if (!container) return
  renderer.root.remove(container.id)
  container.destroyRecursively()
  container = null
  scrollBox = null
  diagram = null
  footer = null
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    const shouldPrintPlain = process.argv.includes("--plain") || process.env.NO_COLOR !== undefined
    console.log(
      shouldPrintPlain
        ? renderSequenceDiagram(AUTH_SEQUENCE_DIAGRAM)
        : renderSequenceDiagramAnsi(AUTH_SEQUENCE_DIAGRAM),
    )
  } else {
    const renderer = await createCliRenderer({ exitOnCtrlC: true })
    run(renderer)
    setupCommonDemoKeys(renderer)
  }
}
