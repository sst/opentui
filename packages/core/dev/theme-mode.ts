#!/usr/bin/env bun
import { BoxRenderable, type CliRenderer, createCliRenderer, TextRenderable } from "../src/index.js"
import { parseColor } from "../src/lib/RGBA.js"

let renderer: CliRenderer | null = null
let titleText: TextRenderable | null = null
let themeText: TextRenderable | null = null
let statusText: TextRenderable | null = null
let eventCountText: TextRenderable | null = null
let firstDrawText: TextRenderable | null = null
let waitForThemeModeText: TextRenderable | null = null
let historyText: TextRenderable | null = null
let helpText: TextRenderable | null = null
let themeModeEventCount = 0
let firstDrawStartedAt = 0
let timeToFirstDrawMs: number | null = null
let waitForThemeModeStartedAt = 0
let waitForThemeModeResolvedMs: number | null = null
let waitForThemeModeResolvedValue: string | null = null
const updateThemeHistory: string[] = []

function updateThemeDisplay() {
  if (!renderer || renderer.isDestroyed) return
  if (
    !titleText ||
    !themeText ||
    !statusText ||
    !eventCountText ||
    !firstDrawText ||
    !waitForThemeModeText ||
    !historyText ||
    !helpText
  )
    return

  const currentTheme = renderer.themeMode
  updateThemeHistory.push(`updateThemeDisplay ${updateThemeHistory.length + 1}: themeMode=${currentTheme ?? "null"}`)

  eventCountText.content = `theme_mode events: ${themeModeEventCount}`
  firstDrawText.content =
    timeToFirstDrawMs === null ? "time to first draw: pending" : `time to first draw: ${timeToFirstDrawMs.toFixed(1)}ms`
  waitForThemeModeText.content =
    waitForThemeModeResolvedMs === null
      ? "waitForThemeMode: pending"
      : `waitForThemeMode: ${waitForThemeModeResolvedMs.toFixed(1)}ms (resolved ${waitForThemeModeResolvedValue ?? "null"})`
  historyText.content = `updateThemeDisplay history:
${updateThemeHistory.join("\n")}`

  if (currentTheme === "dark") {
    titleText.fg = parseColor("#6BCF7F")
    themeText.content = "🌙 Dark Mode"
    themeText.fg = parseColor("#A5D6FF")
    statusText.content = "Terminal is in dark mode"
    statusText.fg = parseColor("#D7DBE0")
    eventCountText.fg = parseColor("#B8C0CC")
    firstDrawText.fg = parseColor("#B8C0CC")
    waitForThemeModeText.fg = parseColor("#B8C0CC")
    historyText.fg = parseColor("#B8C0CC")
    helpText.fg = parseColor("#8F9BA8")
    renderer.setBackgroundColor("#1a1a2e")
  } else if (currentTheme === "light") {
    titleText.fg = parseColor("#166534")
    themeText.content = "☀️ Light Mode"
    themeText.fg = parseColor("#C2410C")
    statusText.content = "Terminal is in light mode"
    statusText.fg = parseColor("#1F2937")
    eventCountText.fg = parseColor("#374151")
    firstDrawText.fg = parseColor("#374151")
    waitForThemeModeText.fg = parseColor("#374151")
    historyText.fg = parseColor("#374151")
    helpText.fg = parseColor("#4B5563")
    renderer.setBackgroundColor("#f5f5f0")
  } else {
    titleText.fg = parseColor("#6BCF7F")
    themeText.content = "❓ Unknown"
    themeText.fg = parseColor("#FFA500")
    statusText.content = "Theme mode not detected. Try switching your terminal theme."
    statusText.fg = parseColor("#D7DBE0")
    eventCountText.fg = parseColor("#B8C0CC")
    firstDrawText.fg = parseColor("#B8C0CC")
    waitForThemeModeText.fg = parseColor("#B8C0CC")
    historyText.fg = parseColor("#B8C0CC")
    helpText.fg = parseColor("#8F9BA8")
    renderer.setBackgroundColor("#2d2d2d")
  }
}

async function main() {
  firstDrawStartedAt = performance.now()

  renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  })

  const mainContainer = new BoxRenderable(renderer, {
    id: "main-container",
    flexGrow: 1,
    flexDirection: "column",
    padding: 2,
  })

  renderer.root.add(mainContainer)

  titleText = new TextRenderable(renderer, {
    id: "title",
    content: "Theme Mode Monitor",
    bold: true,
    fg: parseColor("#6BCF7F"),
    marginBottom: 2,
  })

  themeText = new TextRenderable(renderer, {
    id: "theme-display",
    content: "Detecting...",
    bold: true,
    marginBottom: 1,
  })

  statusText = new TextRenderable(renderer, {
    id: "status",
    content: "Waiting for theme detection...",
    marginBottom: 2,
  })

  eventCountText = new TextRenderable(renderer, {
    id: "event-count",
    content: "theme_mode events: 0",
    marginBottom: 2,
  })

  firstDrawText = new TextRenderable(renderer, {
    id: "first-draw",
    content: "time to first draw: pending",
    marginBottom: 2,
  })

  waitForThemeModeText = new TextRenderable(renderer, {
    id: "wait-for-theme-mode",
    content: "waitForThemeMode: pending",
    marginBottom: 2,
  })

  historyText = new TextRenderable(renderer, {
    id: "history",
    content: "updateThemeDisplay history:\n(none)",
    marginBottom: 2,
  })

  helpText = new TextRenderable(renderer, {
    id: "help",
    content: "Press Ctrl+C to exit. Try switching your terminal's light/dark theme to see updates.",
    fg: parseColor("#888888"),
  })

  mainContainer.add(titleText)
  mainContainer.add(themeText)
  mainContainer.add(statusText)
  mainContainer.add(eventCountText)
  mainContainer.add(firstDrawText)
  mainContainer.add(waitForThemeModeText)
  mainContainer.add(historyText)
  mainContainer.add(helpText)

  // Listen for theme mode changes from the terminal
  renderer.on("theme_mode", () => {
    themeModeEventCount++
    updateThemeDisplay()
  })

  waitForThemeModeStartedAt = performance.now()
  const resolvedThemeMode = await renderer.waitForThemeMode()
  waitForThemeModeResolvedMs = performance.now() - waitForThemeModeStartedAt
  waitForThemeModeResolvedValue = resolvedThemeMode

  updateThemeDisplay()

  const handleFirstDraw = async () => {
    if (!renderer || !firstDrawText || timeToFirstDrawMs !== null) {
      return
    }

    timeToFirstDrawMs = performance.now() - firstDrawStartedAt
    renderer.removeFrameCallback(handleFirstDraw)
    updateThemeDisplay()
  }

  renderer.setFrameCallback(handleFirstDraw)

  renderer.requestRender()
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
