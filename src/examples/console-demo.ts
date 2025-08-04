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
} from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"

let titleText: TextRenderable | null = null
let instructionsText: TextRenderable | null = null
let consoleButtons: ConsoleButton[] = []
let statusText: TextRenderable | null = null
let buttonCounters = {
  log: 0,
  info: 0,
  warn: 0,
  error: 0,
  debug: 0,
}

class ConsoleButton extends BoxRenderable {
  private isHovered = false
  private isPressed = false
  private originalBg: RGBA
  private hoverBg: RGBA
  private pressBg: RGBA
  private logType: string
  private lastClickTime = 0

  constructor(
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color: RGBA,
    label: string,
    logType: string,
  ) {
    const borderColor = RGBA.fromValues(color.r * 1.3, color.g * 1.3, color.b * 1.3, 1.0)

    super(id, {
      x,
      y,
      width,
      height,
      zIndex: 100,
      bg: color,
      borderColor: borderColor,
      borderStyle: "rounded",
      title: label,
      titleAlignment: "center",
    })

    this.logType = logType
    this.originalBg = color
    this.hoverBg = RGBA.fromValues(color.r * 1.2, color.g * 1.2, color.b * 1.2, color.a)
    this.pressBg = RGBA.fromValues(color.r * 0.8, color.g * 0.8, color.b * 0.8, color.a)
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    if (this.isPressed) {
      this._bg = this.pressBg
    } else if (this.isHovered) {
      this._bg = this.hoverBg
    } else {
      this._bg = this.originalBg
    }

    super.renderSelf(buffer)

    const timeSinceClick = Date.now() - this.lastClickTime
    if (timeSinceClick < 300) {
      const alpha = 1 - timeSinceClick / 300
      const sparkleColor = RGBA.fromValues(1, 1, 1, alpha)

      const centerX = this.x + Math.floor(this.width / 2)
      const centerY = this.y + Math.floor(this.height / 2)

      buffer.setCell(centerX - 1, centerY, "✦", sparkleColor, this._bg)
      buffer.setCell(centerX + 1, centerY, "✦", sparkleColor, this._bg)
    }
  }

  protected onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case "down":
        this.isPressed = true
        this.lastClickTime = Date.now()
        buttonCounters[this.logType as keyof typeof buttonCounters]++

        this.triggerConsoleLog()
        event.preventDefault()
        break

      case "up":
        this.isPressed = false
        event.preventDefault()
        break

      case "over":
        this.isHovered = true
        break

      case "out":
        this.isHovered = false
        this.isPressed = false
        break
    }
  }

  private triggerConsoleLog(): void {
    const count = buttonCounters[this.logType as keyof typeof buttonCounters]
    const timestamp = new Date().toLocaleTimeString()

    switch (this.logType) {
      case "log":
        console.log(`🚀 Console Log #${count} triggered at ${timestamp}`, {
          data: "This is a regular log message",
          count,
          timestamp: new Date(),
          metadata: { source: "console-demo", type: "log" },
        })
        break

      case "info":
        console.info(`ℹ️ Info Log #${count} triggered at ${timestamp}`, {
          message: "This is an informational message",
          details: "Info messages are used for general information",
          level: "INFO",
          count,
        })
        break

      case "warn":
        console.warn(`⚠️ Warning Log #${count} triggered at ${timestamp}`, {
          warning: "This is a warning message",
          reason: "Something might need attention",
          severity: "WARNING",
          count,
          stack: new Error().stack?.split("\n").slice(0, 3),
        })
        break

      case "error":
        console.error(`❌ Error Log #${count} triggered at ${timestamp}`, {
          error: "This is an error message",
          details: "Something went wrong (simulated)",
          errorCode: `ERR_${count}`,
          count,
          fakeStack: new Error("Simulated error").stack,
        })
        break

      case "debug":
        console.debug(`🐛 Debug Log #${count} triggered at ${timestamp}`, {
          debug: "This is a debug message",
          variables: { x: Math.random(), y: Math.random(), count },
          state: "debugging",
          performance: { memory: process.memoryUsage() },
        })
        break
    }

    if (statusText) {
      statusText.content = `Last triggered: ${this.logType.toUpperCase()} #${count} at ${timestamp}`
    }
  }
}

export function run(renderer: CliRenderer): void {
  renderer.start()
  renderer.console.show()

  const backgroundColor = RGBA.fromInts(18, 22, 35, 255)
  renderer.setBackgroundColor(backgroundColor)

  titleText = new TextRenderable("console_demo_title", {
    content: "Console Logging Demo",
    x: 2,
    y: 1,
    fg: RGBA.fromInts(255, 215, 135),
    attributes: TextAttributes.BOLD,
    zIndex: 1000,
  })
  renderer.add(titleText)

  instructionsText = new TextRenderable("console_demo_instructions", {
    content:
      "Click buttons to trigger different console log levels • Press ` to toggle console • Escape: return to menu",
    x: 2,
    y: 2,
    fg: RGBA.fromInts(176, 196, 222),
    zIndex: 1000,
  })
  renderer.add(instructionsText)

  statusText = new TextRenderable("console_demo_status", {
    content: "Click any button to start logging...",
    x: 2,
    y: 4,
    fg: RGBA.fromInts(144, 238, 144),
    attributes: TextAttributes.ITALIC,
    zIndex: 1000,
  })
  renderer.add(statusText)

  const logColor = RGBA.fromInts(160, 160, 170, 255)
  const infoColor = RGBA.fromInts(100, 180, 200, 255)
  const warnColor = RGBA.fromInts(220, 180, 100, 255)
  const errorColor = RGBA.fromInts(200, 120, 120, 255)
  const debugColor = RGBA.fromInts(140, 140, 150, 255)

  const startY = 7
  const buttonWidth = 14
  const buttonHeight = 4
  const spacing = 16

  consoleButtons = [
    new ConsoleButton("log-btn", 2, startY, buttonWidth, buttonHeight, logColor, "LOG", "log"),
    new ConsoleButton("info-btn", 2 + spacing, startY, buttonWidth, buttonHeight, infoColor, "INFO", "info"),
    new ConsoleButton("warn-btn", 2 + spacing * 2, startY, buttonWidth, buttonHeight, warnColor, "WARN", "warn"),
    new ConsoleButton("error-btn", 2 + spacing * 3, startY, buttonWidth, buttonHeight, errorColor, "ERROR", "error"),
    new ConsoleButton("debug-btn", 2, startY + 6, buttonWidth, buttonHeight, debugColor, "DEBUG", "debug"),
  ]

  for (const button of consoleButtons) {
    renderer.add(button)
  }

  const decorText1 = new TextRenderable("decor1", {
    content: "✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦ ✧ ✦",
    x: 2,
    y: startY + 12,
    fg: RGBA.fromInts(100, 120, 150, 120),
    zIndex: 50,
  })
  renderer.add(decorText1)

  const decorText2 = new TextRenderable("decor2", {
    content: "Console will appear at the bottom. Use Ctrl+P/Ctrl+O to change position, +/- to resize.",
    x: 2,
    y: startY + 14,
    fg: RGBA.fromInts(120, 140, 160, 200),
    attributes: TextAttributes.ITALIC,
    zIndex: 50,
  })
  renderer.add(decorText2)

  console.log("🎮 Console Demo initialized! Click the buttons above to test different log levels.")
}

export function destroy(renderer: CliRenderer): void {
  renderer.clearFrameCallbacks()

  if (titleText) {
    renderer.remove("console_demo_title")
    titleText = null
  }

  if (instructionsText) {
    renderer.remove("console_demo_instructions")
    instructionsText = null
  }

  if (statusText) {
    renderer.remove("console_demo_status")
    statusText = null
  }

  for (const button of consoleButtons) {
    renderer.remove(button.id)
  }
  consoleButtons = []

  renderer.remove("decor1")
  renderer.remove("decor2")

  buttonCounters = {
    log: 0,
    info: 0,
    warn: 0,
    error: 0,
    debug: 0,
  }
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })
  run(renderer)
  setupCommonDemoKeys(renderer)
}
