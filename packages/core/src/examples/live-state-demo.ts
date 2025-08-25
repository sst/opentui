#!/usr/bin/env bun

import {
  CliRenderer,
  createCliRenderer,
  RGBA,
  TextAttributes,
  TextRenderable,
  BoxRenderable,
  type MouseEvent,
  OptimizedBuffer,
  t,
  bold,
  red,
  green,
  blue,
  fg,
} from "../index"
import type { BoxOptions } from "../renderables/Box"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let titleText: TextRenderable | null = null
let instructionsText: TextRenderable | null = null
let statusText: TextRenderable | null = null
let rendererStateText: TextRenderable | null = null
let renderableStateText: TextRenderable | null = null
let liveButtons: LiveButton[] = []
let demoRenderable: BoxRenderable | null = null
let currentRenderer: CliRenderer | null = null
let frameCounter = 0
let animationCounter = 0
let frameCallback: ((deltaTime: number) => Promise<void>) | null = null

class LiveButton extends BoxRenderable {
  private isHovered = false
  private isPressed = false
  private originalBg: RGBA
  private hoverBg: RGBA
  private pressBg: RGBA
  private label: string

  constructor(id: string, options: BoxOptions & { label: string }) {
    super(id, { zIndex: 100, border: true, ...options })

    this.label = options.label
    const base = this.backgroundColor
    this.originalBg = base
    this.hoverBg = RGBA.fromValues(
      Math.min(1.0, base.r * 1.4),
      Math.min(1.0, base.g * 1.4),
      Math.min(1.0, base.b * 1.4),
      base.a,
    )
    this.pressBg = RGBA.fromValues(base.r * 0.6, base.g * 0.6, base.b * 0.6, base.a)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this.isPressed) {
      this.backgroundColor = this.pressBg
    } else if (this.isHovered) {
      this.backgroundColor = this.hoverBg
    } else {
      this.backgroundColor = this.originalBg
    }

    super.renderSelf(buffer)

    // Render text centered within the button
    const textColor = RGBA.fromValues(1, 1, 1, 1) // White text
    const centerY = this.y + Math.floor(this.height / 2)
    const startX = this.x + Math.floor((this.width - this.label.length) / 2)

    for (let i = 0; i < this.label.length; i++) {
      const x = startX + i
      if (x >= this.x && x < this.x + this.width) {
        buffer.setCell(x, centerY, this.label[i], textColor, this.backgroundColor)
      }
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case "down":
        this.isPressed = true
        this.needsUpdate()
        event.preventDefault()
        break

      case "up":
        this.isPressed = false
        this.needsUpdate()
        event.preventDefault()
        break

      case "over":
        this.isHovered = true
        this.needsUpdate()
        break

      case "out":
        this.isHovered = false
        this.isPressed = false
        this.needsUpdate()
        break
    }
  }
}

function updateStatusText(message: string): void {
  if (statusText) {
    const timestamp = new Date().toLocaleTimeString()
    statusText.content = `[${timestamp}] ${message}`
  }
}

function updateRendererState(renderer: CliRenderer): void {
  if (rendererStateText) {
    const running = renderer.isRunning
    const liveCount = renderer.liveRequestCount
    const controlState = renderer.currentControlState

    const liveIndicators = ["▘", "▝", "▗", "▖"]
    const liveIndicator = liveCount > 0 ? liveIndicators[animationCounter % liveIndicators.length] : " "

    const styledContent = t`${bold("Renderer State:")} ${running ? green(bold("RUNNING")) : red(bold("STOPPED"))} | ${bold("Live Requests:")} ${liveCount > 0 ? green(bold(liveCount.toString())) : fg("#666")(liveCount.toString())} ${liveCount > 0 ? fg("#00FFFF")(liveIndicator) : ""} | ${bold("Control State:")} ${controlState === "live" ? green(bold(controlState.toUpperCase())) : blue(bold(controlState.toUpperCase()))} | ${bold("Frame:")} ${fg("#888")(frameCounter.toString())}`

    rendererStateText.content = styledContent
  }
}

function updateRenderableState(): void {
  if (renderableStateText) {
    const exists = demoRenderable !== null
    const live = demoRenderable?.live || false
    const visible = demoRenderable?.visible ?? false

    const styledContent = t`${bold("Demo Renderable:")} ${exists ? green(bold("ADDED")) : fg("#666")(bold("NOT ADDED"))} | ${bold("Live:")} ${live ? green(bold("TRUE")) : red(bold("FALSE"))} | ${bold("Visible:")} ${visible ? blue(bold("TRUE")) : fg("#666")(bold("FALSE"))}`

    renderableStateText.content = styledContent
  }
}

function addDemoRenderable(renderer: CliRenderer): void {
  if (demoRenderable) {
    updateStatusText("Demo renderable already exists!")
    return
  }

  demoRenderable = new BoxRenderable("demo-renderable", {
    position: "absolute",
    left: 60,
    top: 15,
    width: 30,
    height: 8,
    backgroundColor: RGBA.fromInts(100, 200, 150, 255),
    borderColor: RGBA.fromInts(150, 255, 200, 255),
    borderStyle: "double",
    title: "Demo Renderable",
    titleAlignment: "center",
    border: true,
  })

  renderer.root.add(demoRenderable)
  updateStatusText("Added demo renderable")
}

function removeDemoRenderable(renderer: CliRenderer): void {
  if (!demoRenderable) {
    updateStatusText("No demo renderable to remove!")
    return
  }

  renderer.root.remove(demoRenderable.id)
  demoRenderable = null
  updateStatusText("Removed demo renderable")
}

export function run(renderer: CliRenderer): void {
  currentRenderer = renderer
  const backgroundColor = RGBA.fromInts(25, 30, 45, 255)
  renderer.setBackgroundColor(backgroundColor)

  titleText = new TextRenderable("live_demo_title", {
    content: "Live State Management Demo",
    position: "absolute",
    left: 2,
    top: 1,
    fg: RGBA.fromInts(255, 215, 135),
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  renderer.root.add(titleText)

  instructionsText = new TextRenderable("live_demo_instructions", {
    content: "Test the live state management system • Escape: return to menu",
    position: "absolute",
    left: 2,
    top: 2,
    fg: RGBA.fromInts(176, 196, 222),
    zIndex: 1000,
  })
  renderer.root.add(instructionsText)

  statusText = new TextRenderable("live_demo_status", {
    content: "Ready - Click buttons to test live state management",
    position: "absolute",
    left: 2,
    top: 4,
    fg: RGBA.fromInts(144, 238, 144),
    attributes: TextAttributes.ITALIC,
    zIndex: 1000,
  })
  renderer.root.add(statusText)

  rendererStateText = new TextRenderable("renderer_state", {
    content: "",
    position: "absolute",
    left: 2,
    top: 6,
    fg: RGBA.fromInts(255, 255, 100),
    zIndex: 1000,
  })
  renderer.root.add(rendererStateText)

  renderableStateText = new TextRenderable("renderable_state", {
    content: "",
    position: "absolute",
    left: 2,
    top: 7,
    fg: RGBA.fromInts(255, 255, 100),
    zIndex: 1000,
  })
  renderer.root.add(renderableStateText)

  // Button colors
  const rendererColor = RGBA.fromInts(100, 140, 180, 255) // Blue - darker for better contrast
  const renderableColor = RGBA.fromInts(180, 100, 140, 255) // Pink - darker for better contrast
  const liveColor = RGBA.fromInts(140, 180, 100, 255) // Green - darker for better contrast
  const visibilityColor = RGBA.fromInts(180, 140, 100, 255) // Orange - for visibility controls

  const startY = 10
  const buttonWidth = 20
  const buttonHeight = 3
  const spacing = 22

  // Renderer control buttons
  liveButtons = [
    new LiveButton("request-live-btn", {
      position: "absolute",
      left: 2,
      top: startY,
      width: buttonWidth,
      height: buttonHeight,
      backgroundColor: rendererColor,
      label: "REQUEST LIVE",
      onMouseDown: () => {
        if (!currentRenderer) return
        currentRenderer.requestLive()
        updateStatusText("Manually requested live")
        updateRendererState(currentRenderer)
        updateRenderableState()
      },
    }),
    new LiveButton("drop-live-btn", {
      position: "absolute",
      left: 2 + spacing,
      top: startY,
      width: buttonWidth,
      height: buttonHeight,
      backgroundColor: rendererColor,
      label: "DROP LIVE",
      onMouseDown: () => {
        if (!currentRenderer) return
        currentRenderer.dropLive()
        updateStatusText("Manually dropped live")
        updateRendererState(currentRenderer)
        updateRenderableState()
      },
    }),

    // Renderable management buttons
    new LiveButton("add-renderable-btn", {
      position: "absolute",
      left: 2,
      top: startY + 5,
      width: buttonWidth,
      height: buttonHeight,
      backgroundColor: renderableColor,
      label: "ADD RENDERABLE",
      onMouseDown: () => {
        if (!currentRenderer) return
        addDemoRenderable(currentRenderer)
        updateRendererState(currentRenderer)
        updateRenderableState()
      },
    }),
    new LiveButton("remove-renderable-btn", {
      position: "absolute",
      left: 2 + spacing,
      top: startY + 5,
      width: buttonWidth,
      height: buttonHeight,
      backgroundColor: renderableColor,
      label: "REMOVE RENDERABLE",
      onMouseDown: () => {
        if (!currentRenderer) return
        removeDemoRenderable(currentRenderer)
        updateRendererState(currentRenderer)
        updateRenderableState()
      },
    }),

    // Live state buttons
    new LiveButton("set-live-true-btn", {
      position: "absolute",
      left: 2,
      top: startY + 10,
      width: buttonWidth,
      height: buttonHeight,
      backgroundColor: liveColor,
      label: "LIVE = TRUE",
      onMouseDown: () => {
        if (demoRenderable) {
          demoRenderable.live = true
          updateStatusText("Set demo renderable live = true")
        } else {
          updateStatusText("No demo renderable to set live!")
        }
        if (currentRenderer) {
          updateRendererState(currentRenderer)
        }
        updateRenderableState()
      },
    }),
    new LiveButton("set-live-false-btn", {
      position: "absolute",
      left: 2 + spacing,
      top: startY + 10,
      width: buttonWidth,
      height: buttonHeight,
      backgroundColor: liveColor,
      label: "LIVE = FALSE",
      onMouseDown: () => {
        if (demoRenderable) {
          demoRenderable.live = false
          updateStatusText("Set demo renderable live = false")
        } else {
          updateStatusText("No demo renderable to set live!")
        }
        if (currentRenderer) {
          updateRendererState(currentRenderer)
        }
        updateRenderableState()
      },
    }),

    // Visibility state buttons
    new LiveButton("set-visible-true-btn", {
      position: "absolute",
      left: 2,
      top: startY + 15,
      width: buttonWidth,
      height: buttonHeight,
      backgroundColor: visibilityColor,
      label: "VISIBLE = TRUE",
      onMouseDown: () => {
        if (demoRenderable) {
          demoRenderable.visible = true
          updateStatusText("Set demo renderable visible = true")
        } else {
          updateStatusText("No demo renderable to set visible!")
        }
        if (currentRenderer) {
          updateRendererState(currentRenderer)
        }
        updateRenderableState()
      },
    }),
    new LiveButton("set-visible-false-btn", {
      position: "absolute",
      left: 2 + spacing,
      top: startY + 15,
      width: buttonWidth,
      height: buttonHeight,
      backgroundColor: visibilityColor,
      label: "VISIBLE = FALSE",
      onMouseDown: () => {
        if (demoRenderable) {
          demoRenderable.visible = false
          updateStatusText("Set demo renderable visible = false")
        } else {
          updateStatusText("No demo renderable to set visible!")
        }
        if (currentRenderer) {
          updateRendererState(currentRenderer)
        }
        updateRenderableState()
      },
    }),
  ]

  for (const button of liveButtons) {
    renderer.root.add(button)
  }

  // Add section labels
  const rendererLabel = new TextRenderable("renderer_label", {
    content: "Renderer Control:",
    position: "absolute",
    left: 2,
    top: startY - 1,
    fg: rendererColor,
    attributes: TextAttributes.BOLD,
    zIndex: 500,
  })
  renderer.root.add(rendererLabel)

  const renderableLabel = new TextRenderable("renderable_label", {
    content: "Renderable Management:",
    position: "absolute",
    left: 2,
    top: startY + 4,
    fg: renderableColor,
    attributes: TextAttributes.BOLD,
    zIndex: 500,
  })
  renderer.root.add(renderableLabel)

  const liveLabel = new TextRenderable("live_label", {
    content: "Live State Control:",
    position: "absolute",
    left: 2,
    top: startY + 9,
    fg: liveColor,
    attributes: TextAttributes.BOLD,
    zIndex: 500,
  })
  renderer.root.add(liveLabel)

  const visibilityLabel = new TextRenderable("visibility_label", {
    content: "Visibility Control:",
    position: "absolute",
    left: 2,
    top: startY + 14,
    fg: visibilityColor,
    attributes: TextAttributes.BOLD,
    zIndex: 500,
  })
  renderer.root.add(visibilityLabel)

  frameCallback = async (deltaTime) => {
    frameCounter++
    if (frameCounter % 10 === 0) {
      animationCounter++
      updateRendererState(renderer)
      updateRenderableState()
    }
  }
  renderer.setFrameCallback(frameCallback)

  updateRendererState(renderer)
  updateRenderableState()

  console.log("Live State Demo initialized! Test the automatic live state management system.")
}

export function destroy(renderer: CliRenderer): void {
  if (frameCallback) {
    renderer.removeFrameCallback(frameCallback)
    frameCallback = null
  }

  currentRenderer = null
  frameCounter = 0
  animationCounter = 0

  if (titleText) {
    renderer.root.remove("live_demo_title")
    titleText = null
  }

  if (instructionsText) {
    renderer.root.remove("live_demo_instructions")
    instructionsText = null
  }

  if (statusText) {
    renderer.root.remove("live_demo_status")
    statusText = null
  }

  if (rendererStateText) {
    renderer.root.remove("renderer_state")
    rendererStateText = null
  }

  if (renderableStateText) {
    renderer.root.remove("renderable_state")
    renderableStateText = null
  }

  for (const button of liveButtons) {
    renderer.root.remove(button.id)
  }
  liveButtons = []

  if (demoRenderable) {
    renderer.root.remove(demoRenderable.id)
    demoRenderable = null
  }

  renderer.root.remove("renderer_label")
  renderer.root.remove("renderable_label")
  renderer.root.remove("live_label")
  renderer.root.remove("visibility_label")
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
