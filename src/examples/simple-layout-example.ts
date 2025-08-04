import {
  CliRenderer,
  Layout,
  ContainerElement,
  BufferedElement,
  FlexDirection,
  Align,
  Justify,
  createCliRenderer,
  type ParsedKey,
} from "../index"
import { getKeyHandler } from "../ui/lib/KeyHandler"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

/**
 * Simple text element for demonstration
 */
class TextElement extends BufferedElement {
  private text: string = ""

  constructor(id: string, text: string, options: any) {
    super(id, options)
    this.text = text
  }

  public setText(text: string): void {
    this.text = text
    this.needsRefresh = true
  }

  protected refreshContent(contentX: number, contentY: number, contentWidth: number, contentHeight: number): void {
    if (!this.frameBuffer) return

    const textX = Math.max(0, Math.floor((contentWidth - this.text.length) / 2))
    const textY = Math.floor(contentHeight / 2)

    if (textY >= 0 && textY < contentHeight) {
      this.frameBuffer.drawText(this.text, contentX + textX, contentY + textY, this.textColor, this.backgroundColor)
    }
  }
}

interface LayoutDemo {
  name: string
  description: string
  setup: () => void
}

let renderer: CliRenderer | null = null
let mainLayout: Layout | null = null
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

function resetElementLayout(element: any): void {
  element.setFlexBasis("auto")
  element.setFlex(0, 0)
  element.setWidth("auto")
  element.setHeight("auto")

  element.layoutNode.yogaNode.setMinWidth(undefined)
  element.layoutNode.yogaNode.setMaxWidth(undefined)
  element.layoutNode.yogaNode.setMinHeight(undefined)
  element.layoutNode.yogaNode.setMaxHeight(undefined)
}

function setupHorizontalLayout(): void {
  if (!contentArea || !sidebar || !mainContent || !rightSidebar) return

  if (contentArea.getRenderable("right-sidebar")) {
    contentArea.remove("right-sidebar")
  }

  resetElementLayout(sidebar)
  resetElementLayout(mainContent)

  contentArea.setFlexDirection(FlexDirection.Row)
  contentArea.setAlignment(Align.Stretch)

  const sidebarWidth = Math.max(15, Math.floor(renderer!.terminalWidth * 0.2))
  sidebar.setFlexBasis(sidebarWidth)
  sidebar.setFlex(0, 0)
  sidebar.setWidth(sidebarWidth)
  sidebar.setMinWidth(15)
  sidebar.setHeight("auto")
  sidebar.setText("LEFT SIDEBAR")
  sidebar.setBackgroundColor("#64748b")

  mainContent.setFlexBasis("auto")
  mainContent.setFlex(1, 1)
  mainContent.setWidth("auto")
  mainContent.setMinWidth(20)
  mainContent.setHeight("auto")
  mainContent.setText("MAIN CONTENT")
  mainContent.setBackgroundColor("#eab308")
}

function setupVerticalLayout(): void {
  if (!contentArea || !sidebar || !mainContent || !rightSidebar) return

  if (contentArea.getRenderable("right-sidebar")) {
    contentArea.remove("right-sidebar")
  }

  resetElementLayout(sidebar)
  resetElementLayout(mainContent)

  contentArea.setFlexDirection(FlexDirection.Column)
  contentArea.setAlignment(Align.Stretch)

  const contentHeight = renderer!.terminalHeight - 6
  const topBarHeight = Math.max(3, Math.floor(contentHeight * 0.2))
  sidebar.setFlexBasis(topBarHeight)
  sidebar.setFlex(0, 0)
  sidebar.setHeight(topBarHeight)
  sidebar.setMinHeight(3)
  sidebar.setWidth("auto")
  sidebar.setText("TOP BAR")
  sidebar.setBackgroundColor("#059669")

  mainContent.setFlexBasis("auto")
  mainContent.setFlex(1, 1)
  mainContent.setHeight("auto")
  mainContent.setMinHeight(5)
  mainContent.setWidth("auto")
  mainContent.setText("MAIN CONTENT")
  mainContent.setBackgroundColor("#eab308")
}

function setupCenteredLayout(): void {
  if (!contentArea || !sidebar || !mainContent || !rightSidebar) return

  if (contentArea.getRenderable("right-sidebar")) {
    contentArea.remove("right-sidebar")
  }

  resetElementLayout(sidebar)
  resetElementLayout(mainContent)

  contentArea.setFlexDirection(FlexDirection.Row)
  contentArea.setAlignment(Align.Stretch, Justify.Center)

  sidebar.setFlexBasis(0)
  sidebar.setFlex(0, 0)
  sidebar.setWidth(0)
  sidebar.setMinWidth(0)
  sidebar.setHeight("auto")
  sidebar.setText("")
  sidebar.setBackgroundColor("transparent")

  const centerWidth = Math.max(30, Math.floor(renderer!.terminalWidth * 0.6))
  mainContent.setFlexBasis(centerWidth)
  mainContent.setFlex(0, 0)
  mainContent.setWidth(centerWidth)
  mainContent.setMinWidth(30)
  mainContent.setMaxWidth(Math.floor(renderer!.terminalWidth * 0.8))
  mainContent.setHeight("auto")
  mainContent.setText("CENTERED CONTENT")
  mainContent.setBackgroundColor("#7c3aed")
}

function setupThreeColumnLayout(): void {
  if (!contentArea || !sidebar || !mainContent || !rightSidebar) return

  if (!contentArea.getRenderable("right-sidebar")) {
    contentArea.add(rightSidebar)
  }

  resetElementLayout(sidebar)
  resetElementLayout(mainContent)
  resetElementLayout(rightSidebar)

  contentArea.setFlexDirection(FlexDirection.Row)
  contentArea.setAlignment(Align.Stretch)

  const terminalWidth = renderer!.terminalWidth
  const sidebarWidth = Math.max(12, Math.floor(terminalWidth * 0.15))

  sidebar.setFlexBasis(sidebarWidth)
  sidebar.setFlex(0, 0)
  sidebar.setWidth(sidebarWidth)
  sidebar.setMinWidth(12)
  sidebar.setHeight("auto")
  sidebar.setText("LEFT")
  sidebar.setBackgroundColor("#dc2626")

  mainContent.setFlexBasis("auto")
  mainContent.setFlex(1, 1)
  mainContent.setWidth("auto")
  mainContent.setMinWidth(20)
  mainContent.setHeight("auto")
  mainContent.setText("CENTER")
  mainContent.setBackgroundColor("#059669")

  rightSidebar.setFlexBasis(sidebarWidth)
  rightSidebar.setFlex(0, 0)
  rightSidebar.setWidth(sidebarWidth)
  rightSidebar.setMinWidth(12)
  rightSidebar.setHeight("auto")
  rightSidebar.setText("RIGHT")
  rightSidebar.setBackgroundColor("#7c3aed")
}

function createLayoutElements(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#001122")

  mainLayout = new Layout("main-layout", {
    x: 0,
    y: 0,
    zIndex: 1,
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
  })
  renderer.add(mainLayout)

  header = new TextElement("header", "LAYOUT DEMO", {
    x: 0,
    y: 0,
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
    x: 0,
    y: 0,
    zIndex: 0,
    width: "auto",
    height: "auto",
    flexDirection: FlexDirection.Row,
    flexGrow: 1,
    flexShrink: 1,
  })

  sidebar = new TextElement("sidebar", "SIDEBAR", {
    x: 0,
    y: 0,
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
    x: 0,
    y: 0,
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
    x: 0,
    y: 0,
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
    x: 0,
    y: 0,
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
    x: 0,
    y: 0,
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
  mainLayout.add(header)
  mainLayout.add(contentArea)
  mainLayout.add(footer)
  mainLayout.add(moveableElement)

  centerMoveableElement()
  updateFooterText()
  renderer.on("resize", handleResize)
}

function handleResize(width: number, height: number): void {
  if (!mainLayout) return
  mainLayout.resize(width, height)
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
  footer.setText(
    `SPACE: next | R: restart | P: autoplay (${autoplayStatus}) | V: overlay (${moveableStatus}) | WASD: move`,
  )
}

function applyCurrentDemo(): void {
  const demo = layoutDemos[currentDemoIndex]
  if (!header) return

  const autoplayStatus = autoplayEnabled ? "AUTO" : "MANUAL"
  header.setText(`${demo.name} (${currentDemoIndex + 1}/${layoutDemos.length}) - ${autoplayStatus}`)
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

  if (mainLayout) {
    rendererInstance.remove(mainLayout.id)
    mainLayout.destroy()
    mainLayout = null
  }

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
  renderer.start()
}
