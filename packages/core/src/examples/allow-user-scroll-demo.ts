import { BoxRenderable, type CliRenderer, createCliRenderer, TextRenderable, t, fg, bold, bg } from "../index"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { createMockMouse, MouseButtons } from "../testing/mock-mouse"

let renderer: CliRenderer | null = null
let mainContainer: BoxRenderable | null = null
let leftScrollBox: ScrollBoxRenderable | null = null
let rightScrollBox: ScrollBoxRenderable | null = null
let notificationBox: BoxRenderable | null = null
let notificationText: TextRenderable | null = null
let itemCount = 0
let notificationTimeout: ReturnType<typeof setTimeout> | null = null
let mockMouse: ReturnType<typeof createMockMouse> | null = null

function addTextLine(scrollBox: ScrollBoxRenderable, prefix: string, index: number): void {
  const colors = ["#7aa2f7", "#bb9af7", "#f7768e", "#e0af68", "#9ece6a", "#7dcfff"]
  const color = colors[index % colors.length]

  const lineBox = new BoxRenderable(renderer!, {
    id: `${prefix}-line-${index}`,
    width: "100%",
    padding: 1,
    marginBottom: 0,
  })

  const text = new TextRenderable(renderer!, {
    content: t`${fg(color)(`Line ${index + 1}:`)} ${fg("#c0caf5")(prefix)} ${fg("#565f89")("-")} ${fg("#9aa5ce")("This is sample text content for scrolling demonstration.")}`,
  })

  lineBox.add(text)
  scrollBox.add(lineBox)
}

function showNotification(message: string, side: "left" | "right" | "both"): void {
  if (!notificationText) return

  let displayMessage = ""
  if (side === "left") {
    displayMessage = `← LEFT: ${message}`
  } else if (side === "right") {
    displayMessage = `RIGHT →: ${message}`
  } else {
    displayMessage = `← LEFT | RIGHT →: ${message}`
  }

  notificationText.content = displayMessage

  if (notificationTimeout) {
    clearTimeout(notificationTimeout)
  }

  notificationTimeout = setTimeout(() => {
    if (notificationText) {
      notificationText.content = "Simulating input..."
    }
  }, 800)
}

async function simulateScrollDown(side: "left" | "right" | "both"): Promise<void> {
  if (!mockMouse || !leftScrollBox || !rightScrollBox) return

  // Calculate center positions of each scrollbox viewport
  const leftX = leftScrollBox.x + Math.floor(leftScrollBox.width / 2)
  const leftY = leftScrollBox.y + Math.floor(leftScrollBox.height / 2)
  const rightX = rightScrollBox.x + Math.floor(rightScrollBox.width / 2)
  const rightY = rightScrollBox.y + Math.floor(rightScrollBox.height / 2)

  if (side === "left" || side === "both") {
    await mockMouse.scroll(leftX, leftY, "down")
  }

  if (side === "right" || side === "both") {
    await mockMouse.scroll(rightX, rightY, "down")
  }
}

async function simulateScrollUp(side: "left" | "right" | "both"): Promise<void> {
  if (!mockMouse || !leftScrollBox || !rightScrollBox) return

  // Calculate center positions of each scrollbox viewport
  const leftX = leftScrollBox.x + Math.floor(leftScrollBox.width / 2)
  const leftY = leftScrollBox.y + Math.floor(leftScrollBox.height / 2)
  const rightX = rightScrollBox.x + Math.floor(rightScrollBox.width / 2)
  const rightY = rightScrollBox.y + Math.floor(rightScrollBox.height / 2)

  if (side === "left" || side === "both") {
    await mockMouse.scroll(leftX, leftY, "up")
  }

  if (side === "right" || side === "both") {
    await mockMouse.scroll(rightX, rightY, "up")
  }
}

async function simulateUserScrollDown(): Promise<void> {
  showNotification("User scrolls DOWN (mouse wheel)", "left")
  await simulateScrollDown("left")
}

async function simulateBlockedScrollDown(): Promise<void> {
  showNotification("User tries to scroll DOWN (blocked)", "right")
  await simulateScrollDown("right")
}

async function simulateUserScrollUp(): Promise<void> {
  showNotification("User scrolls UP (mouse wheel)", "left")
  await simulateScrollUp("left")
}

async function simulateBlockedScrollUp(): Promise<void> {
  showNotification("User tries to scroll UP (blocked)", "right")
  await simulateScrollUp("right")
}

/**
 * Calculate the slider thumb position for a ScrollBoxRenderable's vertical scrollbar.
 * Returns the center X and Y coordinates of the thumb.
 */
function getSliderThumbPosition(scrollBox: ScrollBoxRenderable): { x: number; y: number; height: number } | null {
  if (!scrollBox.verticalScrollBar?.slider) return null

  const slider = scrollBox.verticalScrollBar.slider
  if (slider.orientation !== "vertical") return null

  // Calculate thumb position using the same logic as SliderRenderable.getVirtualThumbStart()
  const range = slider.max - slider.min
  if (range === 0) {
    return { x: slider.x + Math.floor(slider.width / 2), y: slider.y, height: slider.height }
  }

  const valueRatio = (slider.value - slider.min) / range
  const virtualTrackSize = slider.height * 2

  // Calculate virtual thumb size (viewportSize / contentSize * virtualTrackSize)
  const viewportSize = Math.max(1, slider.viewPortSize)
  const contentSize = range + viewportSize
  const thumbRatio = viewportSize / contentSize
  const virtualThumbSize = Math.max(1, Math.min(Math.floor(virtualTrackSize * thumbRatio), virtualTrackSize))

  // Calculate virtual thumb start position
  const virtualThumbStart = Math.round(valueRatio * (virtualTrackSize - virtualThumbSize))

  // Convert to real coordinates
  const realThumbStart = Math.floor(virtualThumbStart / 2)
  const realThumbEnd = Math.ceil((virtualThumbStart + virtualThumbSize) / 2)
  const realThumbSize = Math.max(1, realThumbEnd - realThumbStart)

  return {
    x: slider.x + Math.floor(slider.width / 2),
    y: slider.y + realThumbStart + Math.floor(realThumbSize / 2),
    height: realThumbSize,
  }
}

async function simulateSliderThumbDrag(
  scrollBox: ScrollBoxRenderable,
  side: "left" | "right",
  shouldWork: boolean,
): Promise<void> {
  if (!mockMouse) return

  const thumbPos = getSliderThumbPosition(scrollBox)
  if (!thumbPos) return

  const startX = thumbPos.x
  const startY = thumbPos.y

  // Drag downward to scroll up in content (moving thumb down reveals earlier content)
  const dragDistance = Math.min(5, Math.floor(scrollBox.verticalScrollBar.slider.height / 4))
  const endY = startY + dragDistance

  if (shouldWork) {
    showNotification("Dragging slider thumb DOWN (should work)", side)
  } else {
    showNotification("Attempting slider thumb drag (should be BLOCKED)", side)
  }

  await mockMouse.drag(startX, startY, startX, endY, MouseButtons.LEFT)
}

function addContentToBoth(): void {
  itemCount++
  showNotification(`Auto-scroll: Adding line ${itemCount}`, "both")

  if (leftScrollBox) {
    addTextLine(leftScrollBox, "LEFT", itemCount)
    leftScrollBox.scrollTop = leftScrollBox.scrollHeight
  }

  if (rightScrollBox) {
    addTextLine(rightScrollBox, "RIGHT", itemCount)
    rightScrollBox.scrollTop = rightScrollBox.scrollHeight
  }
}

async function runDemoSequence(): Promise<void> {
  if (!leftScrollBox || !rightScrollBox) return

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  // Phase 1: Add a lot of content (auto-scroll works on both - sticky to bottom)
  for (let i = 0; i < 30; i++) {
    addContentToBoth()
    await sleep(100)
  }

  await sleep(500)

  // Phase 2: User scrolls UP on left (should work - moves content up, revealing earlier lines)
  showNotification("User scrolls UP on LEFT (mouse wheel)", "left")
  for (let i = 0; i < 15; i++) {
    await simulateScrollUp("left")
    await sleep(150)
  }

  await sleep(800)

  // Phase 3: User tries to scroll UP on right (should be BLOCKED - stays at bottom)
  showNotification("User tries to scroll UP on RIGHT (blocked)", "right")
  for (let i = 0; i < 15; i++) {
    await simulateScrollUp("right")
    await sleep(150)
  }

  await sleep(500)

  // Phase 4: More up scrolling on left to show full range
  showNotification("More UP scrolling on LEFT", "left")
  for (let i = 0; i < 10; i++) {
    await simulateScrollUp("left")
    await sleep(150)
  }

  await sleep(500)

  // Phase 5: More blocked scrolling on right
  showNotification("More blocked scrolling on RIGHT", "right")
  for (let i = 0; i < 10; i++) {
    await simulateScrollUp("right")
    await sleep(150)
  }

  await sleep(1000)

  // Phase 6: Slider thumb drag on LEFT (should work - moves content)
  showNotification("Slider thumb drag demo on LEFT...", "left")
  await sleep(500)
  await simulateSliderThumbDrag(leftScrollBox, "left", true)
  await sleep(800)

  // Verify left scrollbox moved
  showNotification("LEFT content scrolled via slider!", "left")
  await sleep(500)

  // Phase 7: Slider thumb drag on RIGHT (should be BLOCKED)
  showNotification("Attempting slider thumb drag on RIGHT...", "right")
  await sleep(500)
  await simulateSliderThumbDrag(rightScrollBox, "right", false)
  await sleep(800)

  // Confirm right scrollbox did NOT move
  showNotification("RIGHT slider drag BLOCKED - content unchanged", "right")
  await sleep(500)

  showNotification("Demo complete! Left scrolled, Right stayed.", "both")
}

export function run(rendererInstance: CliRenderer): void {
  renderer = rendererInstance
  renderer.setBackgroundColor("#0a0a14")

  // Initialize mock mouse for simulating real mouse events
  mockMouse = createMockMouse(rendererInstance)

  mainContainer = new BoxRenderable(renderer, {
    id: "main-container",
    flexGrow: 1,
    maxHeight: "100%",
    maxWidth: "100%",
    flexDirection: "column",
    backgroundColor: "#0f0f23",
  })

  const titleBox = new BoxRenderable(renderer, {
    id: "title-box",
    width: "100%",
    flexDirection: "column",
    backgroundColor: "#1a1a2e",
    padding: 1,
    flexShrink: 0,
  })

  const titleText = new TextRenderable(renderer, {
    content: t`${bold(fg("#7aa2f7")("allowUserScroll Demo"))}`,
  })

  const subtitleText = new TextRenderable(renderer, {
    content: t`${fg("#565f89")("Left:")} ${fg("#9ece6a")("allowUserScroll = true")} ${fg("#565f89")("|")} ${fg("#565f89")("Right:")} ${fg("#f7768e")("allowUserScroll = false")}`,
  })

  titleBox.add(titleText)
  titleBox.add(subtitleText)

  const contentContainer = new BoxRenderable(renderer, {
    id: "content-container",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "stretch",
  })

  leftScrollBox = new ScrollBoxRenderable(renderer, {
    id: "left-scroll-box",
    allowUserScroll: true,
    stickyScroll: true,
    stickyStart: "bottom",
    flexGrow: 1,
    rootOptions: {
      backgroundColor: "#1e1e2e",
      border: true,
      borderColor: "#7aa2f7",
    },
    wrapperOptions: {
      backgroundColor: "#181825",
    },
    viewportOptions: {
      backgroundColor: "#11111b",
    },
    contentOptions: {
      backgroundColor: "#0f0f0f",
    },
  })

  const leftLabel = new BoxRenderable(renderer, {
    id: "left-label",
    width: "100%",
    backgroundColor: "#24283b",
    padding: 0,
    flexShrink: 0,
  })

  const leftLabelText = new TextRenderable(renderer, {
    content: t`${bold(fg("#7aa2f7")(" ← User Scrolling ENABLED"))}`,
  })

  leftLabel.add(leftLabelText)
  leftScrollBox.insertBefore(leftLabel)

  rightScrollBox = new ScrollBoxRenderable(renderer, {
    id: "right-scroll-box",
    allowUserScroll: false,
    stickyScroll: true,
    stickyStart: "bottom",
    flexGrow: 1,
    rootOptions: {
      backgroundColor: "#1e1e2e",
      border: true,
      borderColor: "#f7768e",
    },
    wrapperOptions: {
      backgroundColor: "#181825",
    },
    viewportOptions: {
      backgroundColor: "#11111b",
    },
    contentOptions: {
      backgroundColor: "#0f0f0f",
    },
  })

  const rightLabel = new BoxRenderable(renderer, {
    id: "right-label",
    width: "100%",
    backgroundColor: "#24283b",
    padding: 0,
    flexShrink: 0,
  })

  const rightLabelText = new TextRenderable(renderer, {
    content: t`${bold(fg("#f7768e")("User Scrolling DISABLED →"))}`,
  })

  rightLabel.add(rightLabelText)
  rightScrollBox.insertBefore(rightLabel)

  contentContainer.add(leftScrollBox)
  contentContainer.add(rightScrollBox)

  notificationBox = new BoxRenderable(renderer, {
    id: "notification-box",
    width: "100%",
    flexDirection: "column",
    backgroundColor: "#1a1a2e",
    padding: 1,
    flexShrink: 0,
  })

  notificationText = new TextRenderable(renderer, {
    content: "Simulating input...",
  })

  notificationBox.add(notificationText)

  mainContainer.add(titleBox)
  mainContainer.add(contentContainer)
  mainContainer.add(notificationBox)

  renderer.root.add(mainContainer)

  for (let i = 0; i < 10; i++) {
    addTextLine(leftScrollBox!, "LEFT", i)
    addTextLine(rightScrollBox!, "RIGHT", i)
  }

  leftScrollBox!.focus()

  runDemoSequence().catch(console.error)

  rendererInstance.keyInput.on("keypress", (key) => {
    if (key.name === "d") {
      addContentToBoth()
    } else if (key.name === "u" && key.shift) {
      simulateUserScrollUp()
    } else if (key.name === "d" && key.shift) {
      simulateUserScrollDown()
    } else if (key.name === "q") {
      renderer?.stop()
    }
  })
}

export function destroy(rendererInstance: CliRenderer): void {
  if (notificationTimeout) {
    clearTimeout(notificationTimeout)
  }

  if (mainContainer) {
    rendererInstance.root.remove(mainContainer.id)
    mainContainer.destroyRecursively()
    mainContainer = null
  }

  leftScrollBox = null
  rightScrollBox = null
  notificationBox = null
  notificationText = null
  renderer = null
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
}
