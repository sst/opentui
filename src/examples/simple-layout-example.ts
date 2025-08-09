import {
  CliRenderer,
  ContainerElement,
  BufferedElement,
  FlexDirection,
  Align,
  Justify,
  createCliRenderer,
  type ParsedKey,
  type ElementOptions,
  Element,
} from "../index"
import { getKeyHandler } from "../ui/lib/KeyHandler"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

/**
 * Simple text element for demonstration
 */
class TextElement extends BufferedElement {
  private _text: string = ""

  constructor(id: string, text: string, options: ElementOptions) {
    super(id, options)
    this.text = text
  }

  public set text(text: string) {
    this._text = text
    this.needsRefresh = true
  }

  protected refreshContent(contentX: number, contentY: number, contentWidth: number, contentHeight: number): void {
    if (!this.frameBuffer) return

    const textX = Math.max(0, Math.floor((contentWidth - this._text.length) / 2))
    const textY = Math.floor(contentHeight / 2)

    if (textY >= 0 && textY < contentHeight) {
      this.frameBuffer.drawText(this._text, contentX + textX, contentY + textY, this.textColor, this._backgroundColor)
    }
  }
}

interface LayoutDemo {
  name: string
  description: string
  setup: () => void
}

let renderer: CliRenderer | null = null
let header: TextElement | null = null
let contentArea: ContainerElement | null = null
let sidebar: TextElement | null = null
let mainContent: TextElement | null = null
let rightSidebar: TextElement | null = null
let footer: TextElement | null = null
let moveableElement: TextElement | null = null
let currentDemoIndex = 0
let autoAdvanceTimeout: Timer | null = null
let autoplayEnabled = true
let moveableElementVisible = true
let moveableElementX = 0
let moveableElementY = 0

const layoutDemos: LayoutDemo[] = [
  {
    name: "Horizontal Layout",
    description: "Sidebar on left, main content on right",
    setup: () => setupHorizontalLayout(),
  },
  {
    name: "Vertical Layout",
    description: "Sidebar on top, main content below",
    setup: () => setupVerticalLayout(),
  },
  {
    name: "Centered Layout",
    description: "Content centered with margins",
    setup: () => setupCenteredLayout(),
  },
  {
    name: "Three Column",
    description: "Left sidebar, center content, right sidebar",
    setup: () => setupThreeColumnLayout(),
  },
]

function resetElementLayout(element: Element): void {
  element.flexBasis = "auto"
  element.flexGrow = 0
  element.flexShrink = 0
  element.width = "auto"
  element.height = "auto"

  element.minWidth = undefined
  element.maxWidth = undefined
  element.minHeight = undefined
  element.maxHeight = undefined
}

function setupHorizontalLayout(): void {
  if (!contentArea || !sidebar || !mainContent || !rightSidebar) return

  if (contentArea.getRenderable("right-sidebar")) {
    contentArea.remove("right-sidebar")
  }

  resetElementLayout(sidebar)
  resetElementLayout(mainContent)

  contentArea.flexDirection = FlexDirection.Row
  contentArea.alignItems = Align.Stretch

  const sidebarWidth = Math.max(15, Math.floor(renderer!.terminalWidth * 0.2))
  sidebar.flexBasis = sidebarWidth
  sidebar.flexGrow = 0
  sidebar.flexShrink = 0
  sidebar.width = sidebarWidth
  sidebar.minWidth = 15
  sidebar.height = "auto"
  sidebar.text = "LEFT SIDEBAR"
  sidebar.backgroundColor = "#64748b"

  mainContent.flexBasis = "auto"
  mainContent.flexGrow = 1
  mainContent.flexShrink = 1
  mainContent.width = "auto"
  mainContent.minWidth = 20
  mainContent.height = "auto"
  mainContent.text = "MAIN CONTENT"
  mainContent.backgroundColor = "#eab308"
}

function setupVerticalLayout(): void {
  if (!contentArea || !sidebar || !mainContent || !rightSidebar) return

  if (contentArea.getRenderable("right-sidebar")) {
    contentArea.remove("right-sidebar")
  }

  resetElementLayout(sidebar)
  resetElementLayout(mainContent)

  contentArea.flexDirection = FlexDirection.Column
  contentArea.alignItems = Align.Stretch

  const contentHeight = renderer!.terminalHeight - 6
  const topBarHeight = Math.max(3, Math.floor(contentHeight * 0.2))
  sidebar.flexBasis = topBarHeight
  sidebar.flexGrow = 0
  sidebar.flexShrink = 0
  sidebar.height = topBarHeight
  sidebar.minHeight = 3
  sidebar.width = "auto"
  sidebar.text = "TOP BAR"
  sidebar.backgroundColor = "#059669"

  mainContent.flexBasis = "auto"
  mainContent.flexGrow = 1
  mainContent.flexShrink = 1
  mainContent.height = "auto"
  mainContent.minHeight = 5
  mainContent.width = "auto"
  mainContent.text = "MAIN CONTENT"
  mainContent.backgroundColor = "#eab308"
}

function setupCenteredLayout(): void {
  if (!contentArea || !sidebar || !mainContent || !rightSidebar) return

  if (contentArea.getRenderable("right-sidebar")) {
    contentArea.remove("right-sidebar")
  }

  resetElementLayout(sidebar)
  resetElementLayout(mainContent)

  contentArea.flexDirection = FlexDirection.Row
  contentArea.alignItems = Align.Stretch
  contentArea.justifyContent = Justify.Center

  sidebar.flexBasis = 0
  sidebar.flexGrow = 0
  sidebar.flexShrink = 0
  sidebar.width = 0
  sidebar.minWidth = 0
  sidebar.height = "auto"
  sidebar.text = ""
  sidebar.backgroundColor = "transparent"

  const centerWidth = Math.max(30, Math.floor(renderer!.terminalWidth * 0.6))
  mainContent.flexBasis = centerWidth
  mainContent.flexGrow = 0
  mainContent.flexShrink = 0
  mainContent.width = centerWidth
  mainContent.minWidth = 30
  mainContent.maxWidth = Math.floor(renderer!.terminalWidth * 0.8)
  mainContent.height = "auto"
  mainContent.text = "CENTERED CONTENT"
  mainContent.backgroundColor = "#7c3aed"
}

function setupThreeColumnLayout(): void {
  if (!contentArea || !sidebar || !mainContent || !rightSidebar) return

  if (!contentArea.getRenderable("right-sidebar")) {
    contentArea.add(rightSidebar)
  }

  resetElementLayout(sidebar)
  resetElementLayout(mainContent)
  resetElementLayout(rightSidebar)

  contentArea.flexDirection = FlexDirection.Row
  contentArea.alignItems = Align.Stretch

  const terminalWidth = renderer!.terminalWidth
  const sidebarWidth = Math.max(12, Math.floor(terminalWidth * 0.15))

  sidebar.flexBasis = sidebarWidth
  sidebar.flexGrow = 0
  sidebar.flexShrink = 0
  sidebar.width = sidebarWidth
  sidebar.minWidth = 12
  sidebar.height = "auto"
  sidebar.text = "LEFT"
  sidebar.backgroundColor = "#dc2626"

  mainContent.flexBasis = "auto"
  mainContent.flexGrow = 1
  mainContent.flexShrink = 1
  mainContent.width = "auto"
  mainContent.minWidth = 20
  mainContent.height = "auto"
  mainContent.text = "CENTER"
  mainContent.backgroundColor = "#059669"

  rightSidebar.flexBasis = sidebarWidth
  rightSidebar.flexGrow = 0
  rightSidebar.flexShrink = 0
  rightSidebar.width = sidebarWidth
  rightSidebar.minWidth = 12
  rightSidebar.height = "auto"
  rightSidebar.text = "RIGHT"
  rightSidebar.backgroundColor = "#7c3aed"
}

function createLayoutElements(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#001122")

  header = new TextElement("header", "LAYOUT DEMO", {
    zIndex: 0,
    width: "auto",
    height: 3,
    backgroundColor: "#3b82f6",
    textColor: "#ffffff",
    border: true,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: FlexDirection.Row,
  })

  contentArea = new ContainerElement("content-area", {
    zIndex: 0,
    width: "auto",
    height: "auto",
    flexDirection: FlexDirection.Row,
    flexGrow: 1,
    flexShrink: 1,
  })

  sidebar = new TextElement("sidebar", "SIDEBAR", {
    zIndex: 0,
    width: "auto",
    height: "auto",
    backgroundColor: "#64748b",
    textColor: "#ffffff",
    border: true,
    flexGrow: 0,
    flexShrink: 0,
  })

  mainContent = new TextElement("main-content", "MAIN CONTENT", {
    zIndex: 0,
    width: "auto",
    height: "auto",
    backgroundColor: "#919599",
    textColor: "#1e293b",
    border: true,
    flexGrow: 1,
    flexShrink: 1,
  })

  rightSidebar = new TextElement("right-sidebar", "RIGHT", {
    zIndex: 0,
    width: "auto",
    height: "auto",
    backgroundColor: "#7c3aed",
    textColor: "#ffffff",
    border: true,
    flexGrow: 0,
    flexShrink: 0,
  })

  footer = new TextElement("footer", "", {
    zIndex: 0,
    width: "auto",
    height: 3,
    backgroundColor: "#1e40af",
    textColor: "#ffffff",
    border: true,
    flexGrow: 0,
    flexShrink: 0,
  })

  moveableElement = new TextElement("moveable", "MOVE", {
    zIndex: 100,
    width: 8,
    height: 3,
    backgroundColor: "#ff6b6b",
    textColor: "#ffffff",
    border: true,
    borderColor: "#ff4757",
    positionType: "absolute",
    position: { left: 0, top: 0 },
  })

  contentArea.add(sidebar)
  contentArea.add(mainContent)
  renderer.root.add(header)
  renderer.root.add(contentArea)
  renderer.root.add(footer)
  renderer.root.add(moveableElement)

  centerMoveableElement()
  updateFooterText()
  renderer.on("resize", handleResize)
}

function handleResize(width: number, height: number): void {
  // Root layout is automatically resized by the renderer
  centerMoveableElement()
}

function handleKeyPress(key: ParsedKey): void {
  switch (key.name) {
    case "space": // Space - next layout
      nextDemo()
      break
    case "r": // R - restart cycle
      currentDemoIndex = 0
      applyCurrentDemo()
      break
    case "p": // P - toggle autoplay
      toggleAutoplay()
      break
    case "v": // V - toggle moveable element visibility
      toggleMoveableElement()
      break
    case "w": // W - move up
      moveMoveableElement(0, -1)
      break
    case "a": // A - move left
      moveMoveableElement(-1, 0)
      break
    case "s": // S - move down
      moveMoveableElement(0, 1)
      break
    case "d": // D - move right
      moveMoveableElement(1, 0)
      break
  }
}

function nextDemo(): void {
  currentDemoIndex = (currentDemoIndex + 1) % layoutDemos.length
  applyCurrentDemo()
}

function toggleAutoplay(): void {
  autoplayEnabled = !autoplayEnabled

  if (autoplayEnabled) {
    if (autoAdvanceTimeout) {
      clearTimeout(autoAdvanceTimeout)
    }
    autoAdvanceTimeout = setTimeout(() => {
      nextDemo()
    }, 4000)
  } else {
    if (autoAdvanceTimeout) {
      clearTimeout(autoAdvanceTimeout)
      autoAdvanceTimeout = null
    }
  }

  updateFooterText()
}

function toggleMoveableElement(): void {
  if (!moveableElement) return

  moveableElementVisible = !moveableElementVisible
  moveableElement.visible = moveableElementVisible
  updateFooterText()
}

function moveMoveableElement(deltaX: number, deltaY: number): void {
  if (!moveableElement || !renderer) return

  moveableElementX += deltaX
  moveableElementY += deltaY

  moveableElementX = Math.max(0, Math.min(renderer.terminalWidth - 8, moveableElementX))
  moveableElementY = Math.max(0, Math.min(renderer.terminalHeight - 3, moveableElementY))

  moveableElement.setPosition({
    left: moveableElementX,
    top: moveableElementY,
  })
}

function centerMoveableElement(): void {
  if (!renderer || !moveableElement) return

  moveableElementX = Math.floor((renderer.terminalWidth - 8) / 2)
  moveableElementY = Math.floor((renderer.terminalHeight - 3) / 2)

  moveableElement.setPosition({
    left: moveableElementX,
    top: moveableElementY,
  })
}

function updateFooterText(): void {
  if (!footer) return

  const autoplayStatus = autoplayEnabled ? "ON" : "OFF"
  const moveableStatus = moveableElementVisible ? "ON" : "OFF"
  footer.text = `SPACE: next | R: restart | P: autoplay (${autoplayStatus}) | V: overlay (${moveableStatus}) | WASD: move`
}

function applyCurrentDemo(): void {
  const demo = layoutDemos[currentDemoIndex]
  if (!header) return

  const autoplayStatus = autoplayEnabled ? "AUTO" : "MANUAL"
  header.text = `${demo.name} (${currentDemoIndex + 1}/${layoutDemos.length}) - ${autoplayStatus}`
  demo.setup()

  if (autoAdvanceTimeout) {
    clearTimeout(autoAdvanceTimeout)
  }

  if (autoplayEnabled) {
    autoAdvanceTimeout = setTimeout(() => {
      nextDemo()
    }, 4000)
  }
}

export function run(rendererInstance: CliRenderer): void {
  createLayoutElements(rendererInstance)
  getKeyHandler().on("keypress", handleKeyPress)
  currentDemoIndex = 0
  applyCurrentDemo()
}

export function destroy(rendererInstance: CliRenderer): void {
  if (autoAdvanceTimeout) {
    clearTimeout(autoAdvanceTimeout)
    autoAdvanceTimeout = null
  }

  getKeyHandler().off("keypress", handleKeyPress)

  if (renderer) {
    renderer.off("resize", handleResize)
  }

  if (header) rendererInstance.root.remove(header.id)
  if (contentArea) rendererInstance.root.remove(contentArea.id)
  if (footer) rendererInstance.root.remove(footer.id)
  if (moveableElement) rendererInstance.root.remove(moveableElement.id)

  header = null
  contentArea = null
  sidebar = null
  mainContent = null
  rightSidebar = null
  footer = null
  moveableElement = null
  renderer = null
  currentDemoIndex = 0
  moveableElementVisible = true
  moveableElementX = 0
  moveableElementY = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
  // renderer.start()
}
