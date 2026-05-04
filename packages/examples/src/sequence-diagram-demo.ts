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

export const GROUP_SEQUENCE_DIAGRAM = `sequenceDiagram
  autonumber
  participant Shopper
  box Storefront
    participant Web
    participant Cart
  end
  box Providers
    participant Payments
    participant Email
  end
  Shopper->>Web: Submit order
  Web->>Web: Validate order
  Web->>Cart: reserve inventory
  Cart-->>Web: reserved
  Note over Web,Cart: inventory is held during payment
  Web->>Payments: authorize card
  Payments-->>Web: approved
  Web->>Email: send receipt
  Web-->>Shopper: Order confirmed`

export const SELF_LOOP_SEQUENCE_DIAGRAM = `sequenceDiagram
  autonumber
  participant Browser
  box Backend
    participant API
  end
  Browser->>API: GET /me
  API->>API: Validate JWT
  API-->>Browser: 200 { user }`

export const CACHE_SEQUENCE_DIAGRAM = `sequenceDiagram
  autonumber
  participant Client
  box Backend
    participant API
    participant Cache
  end
  box Storage
    participant DB
  end
  Client->>API: GET /users/42
  API->>Cache: get user:42
  alt cache hit
    Cache-->>API: { user }
  else cache miss
    Cache-->>API: null
    API->>DB: SELECT user WHERE id=42
    DB-->>API: row
  end
  API-->>Client: 200 { user }`

export const RETRY_SEQUENCE_DIAGRAM = `sequenceDiagram
  autonumber
  participant Client
  box Backend
    participant API
    participant Jobs
  end
  Client->>API: Start export
  API-->>Client: 202 accepted
  loop poll until ready
    Client->>API: GET /exports/7
    API->>Jobs: status export:7
    Jobs-->>API: pending
    API-->>Client: 202 pending
  end
  API-->>Client: 200 download URL`

interface SequenceDiagramExample {
  title: string
  description: string
  content: string
}

const EXAMPLES: SequenceDiagramExample[] = [
  {
    title: "Grouped Checkout",
    description: "full-height participant groups with a straight request chain",
    content: GROUP_SEQUENCE_DIAGRAM,
  },
  {
    title: "Self Check",
    description: "single participant loopback inside a backend group",
    content: SELF_LOOP_SEQUENCE_DIAGRAM,
  },
  {
    title: "Cache Branch",
    description: "alt/else branch without a surrounding loop",
    content: CACHE_SEQUENCE_DIAGRAM,
  },
  {
    title: "Retry Polling",
    description: "loop region without branching",
    content: RETRY_SEQUENCE_DIAGRAM,
  },
]

let container: BoxRenderable | null = null
let scrollBox: ScrollBoxRenderable | null = null
let diagram: SequenceDiagramRenderable | null = null
let titleText: TextRenderable | null = null
let footer: TextRenderable | null = null
let keyHandler: ((key: KeyEvent) => void) | null = null
let themeIndex = 0
let exampleIndex = 0

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
  group: string
  request: string
  response: string
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
    group: "#4E6359",
    request: "#86E1C8",
    response: "#E6B17E",
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
    group: "#4F5A6B",
    request: "#7DD3FC",
    response: "#FCD34D",
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
    group: "#51586A",
    request: "#93C5FD",
    response: "#FDBA74",
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
    group: "#4B5563",
    request: "#A5D8FF",
    response: "#FFE08A",
    note: "#D2DAE5",
    noteBackground: "#252C38",
  },
]

function applyExample(): void {
  const example = EXAMPLES[exampleIndex]!
  diagram!.content = example.content
  titleText!.content = `Mermaid sequenceDiagram -> OpenTUI · ${exampleIndex + 1}. ${example.title}`
}

function selectExample(renderer: CliRenderer, nextExampleIndex: number): void {
  if (nextExampleIndex < 0 || nextExampleIndex >= EXAMPLES.length) return
  exampleIndex = nextExampleIndex
  applyExample()
  applyTheme(renderer, THEMES[themeIndex]!)
}

function applyTheme(renderer: CliRenderer, theme: SequenceDiagramTheme): void {
  const example = EXAMPLES[exampleIndex]!
  renderer.setBackgroundColor(theme.background)
  container!.backgroundColor = theme.background
  scrollBox!.backgroundColor = theme.background
  scrollBox!.borderColor = theme.panelBorder
  scrollBox!.viewportOptions = { backgroundColor: theme.background }
  scrollBox!.contentOptions = { backgroundColor: theme.background, padding: 1 }

  diagram!.fg = theme.foreground
  diagram!.bg = theme.background
  diagram!.participantColor = theme.participant
  diagram!.lifelineColor = theme.lifeline
  diagram!.groupColor = theme.group
  diagram!.requestColor = theme.request
  diagram!.responseColor = theme.response
  diagram!.noteColor = theme.note
  diagram!.noteBackgroundColor = theme.noteBackground

  footer!.fg = theme.footer
  footer!.content = `${example.description} · Theme: ${theme.name} · 1-${EXAMPLES.length} or Left/Right switch examples · T cycles themes`
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

  titleText = new TextRenderable(renderer, {
    id: "sequence-diagram-title",
    content: "",
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
    content: EXAMPLES[exampleIndex]!.content,
    fg: initialTheme.foreground,
    bg: initialTheme.background,
    participantColor: initialTheme.participant,
    lifelineColor: initialTheme.lifeline,
    groupColor: initialTheme.group,
    requestColor: initialTheme.request,
    responseColor: initialTheme.response,
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
  container.add(titleText)
  container.add(scrollBox)
  container.add(footer)
  renderer.root.add(container)
  scrollBox.focus()
  applyExample()
  applyTheme(renderer, initialTheme)

  keyHandler = (key: KeyEvent) => {
    if (key.ctrl || key.meta) return

    if (/^[1-9]$/.test(key.name)) {
      selectExample(renderer, Number(key.name) - 1)
      return
    }

    if (key.name === "right" || key.name === "arrowright") {
      selectExample(renderer, (exampleIndex + 1) % EXAMPLES.length)
      return
    }

    if (key.name === "left" || key.name === "arrowleft") {
      selectExample(renderer, (exampleIndex + EXAMPLES.length - 1) % EXAMPLES.length)
      return
    }

    if (key.name === "t") {
      themeIndex = (themeIndex + 1) % THEMES.length
      applyTheme(renderer, THEMES[themeIndex]!)
    }
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
  titleText = null
  footer = null
}

if (import.meta.main) {
  if (process.argv.includes("--print")) {
    const shouldPrintPlain = process.argv.includes("--plain") || process.env.NO_COLOR !== undefined
    const selectedExample = EXAMPLES.find((_, index) => process.argv.includes(`--example=${index + 1}`)) ?? EXAMPLES[0]!
    console.log(
      shouldPrintPlain
        ? renderSequenceDiagram(selectedExample.content)
        : renderSequenceDiagramAnsi(selectedExample.content),
    )
  } else {
    const renderer = await createCliRenderer({ exitOnCtrlC: true })
    run(renderer)
    setupCommonDemoKeys(renderer)
  }
}
