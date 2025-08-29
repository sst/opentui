import { createCliRenderer, TextRenderable, t, type CliRenderer, BoxRenderable, bold, fg } from "../index"
import { setupCommonDemoKeys } from "./lib/standalone-keys"
import { getKeyHandler } from "../lib/KeyHandler"
import { createTimeline, type JSAnimation, Timeline } from "../animation/Timeline"

let text: TextRenderable | null = null
let instructionsText: TextRenderable | null = null
let keyHandler: ((key: any) => void) | null = null
let outputTimer: Timer | null = null
let animationSystem: SplitModeAnimations | null = null
let testOutputInterval = 100

class SplitModeAnimations {
  private timeline: Timeline
  private renderer: CliRenderer
  private container: BoxRenderable

  private systemLoadingBars: BoxRenderable[] = []
  private movingOrbs: BoxRenderable[] = []
  private statusCounters: TextRenderable[] = []
  private pulsingElements: BoxRenderable[] = []

  private systemProgress = { cpu: 0, memory: 0, network: 0, disk: 0 }
  private counters = { packets: 0, connections: 0, processes: 0, uptime: 0 }
  private orbPositions = [
    { x: 2, y: 2 },
    { x: 15, y: 3 },
    { x: 30, y: 2 },
  ]
  private pulseValues = [1.0, 1.0, 1.0]

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.timeline = createTimeline({
      duration: 8000,
      loop: true,
    })

    this.container = new BoxRenderable(renderer, {
      id: "animation-container",
      zIndex: 5,
    })
    this.renderer.root.add(this.container)

    this.setupUI()
    this.setupAnimations()
    this.timeline.play()
  }

  private setupUI(): void {
    const statusPanel = new BoxRenderable(this.renderer, {
      id: "status-panel",
      position: "absolute",
      left: 2,
      top: 5,
      width: this.renderer.width - 6,
      height: 8,
      backgroundColor: "#1a1a2e",
      zIndex: 1,
      borderStyle: "double",
      borderColor: "#4a4a6a",
      title: "◆ SYSTEM MONITOR ◆",
      titleAlignment: "center",
      border: true,
    })
    this.container.add(statusPanel)

    this.systemLoadingBars = []
    const systems = [
      { name: "CPU", color: "#6a5acd", y: 6 },
      { name: "MEM", color: "#4682b4", y: 7 },
      { name: "NET", color: "#20b2aa", y: 8 },
      { name: "DSK", color: "#daa520", y: 9 },
    ]

    systems.forEach((system, index) => {
      const label = new TextRenderable(this.renderer, {
        id: `${system.name.toLowerCase()}-label`,
        content: `${system.name}:`,
        position: "absolute",
        left: 4,
        top: system.y,
        fg: system.color,
        zIndex: 2,
      })
      this.container.add(label)

      const bgBar = new BoxRenderable(this.renderer, {
        id: `${system.name.toLowerCase()}-bg`,
        position: "absolute",
        left: 9,
        top: system.y,
        width: this.renderer.width - 16,
        height: 1,
        backgroundColor: "#333333",
        zIndex: 1,
      })
      this.container.add(bgBar)

      const progressBar = new BoxRenderable(this.renderer, {
        id: `${system.name.toLowerCase()}-progress`,
        position: "absolute",
        left: 9,
        top: system.y,
        width: 1,
        height: 1,
        backgroundColor: system.color,
        zIndex: 2,
      })
      this.container.add(progressBar)
      this.systemLoadingBars.push(progressBar)
    })

    const statsPanel = new BoxRenderable(this.renderer, {
      id: "stats-panel",
      position: "absolute",
      left: 2,
      top: 14,
      width: this.renderer.width - 6,
      height: 4,
      backgroundColor: "#2d1b2e",
      zIndex: 1,
      borderStyle: "single",
      borderColor: "#8a4a8a",
      title: "◇ REAL-TIME STATS ◇",
      titleAlignment: "center",
      border: true,
    })
    this.container.add(statsPanel)

    this.statusCounters = []
    const counterLabels = ["PACKETS", "CONNECTIONS", "PROCESSES", "UPTIME"]
    counterLabels.forEach((label, index) => {
      const counter = new TextRenderable(this.renderer, {
        id: `counter-${index}`,
        content: `${label}: 0`,
        position: "absolute",
        left: 4 + index * 15,
        top: 15,
        fg: "#9a9acd",
        zIndex: 2,
      })
      this.container.add(counter)
      this.statusCounters.push(counter)
    })

    this.movingOrbs = []
    const orbColors = ["#ff6b9d", "#4ecdc4", "#ffe66d"]
    orbColors.forEach((color, index) => {
      const orb = new BoxRenderable(this.renderer, {
        id: `orb-${index}`,
        position: "absolute",
        left: 2,
        top: 2,
        width: 3,
        height: 1,
        backgroundColor: color,
        zIndex: 3,
      })
      this.container.add(orb)
      this.movingOrbs.push(orb)
    })

    this.pulsingElements = []
    const pulseColors = ["#ff8a80", "#80cbc4", "#fff176"]
    pulseColors.forEach((color, index) => {
      const pulse = new BoxRenderable(this.renderer, {
        id: `pulse-${index}`,
        position: "absolute",
        left: this.renderer.width - 8 + index * 2,
        top: 1,
        width: 1,
        height: 1,
        backgroundColor: color,
        zIndex: 3,
      })
      this.container.add(pulse)
      this.pulsingElements.push(pulse)
    })
  }

  private setupAnimations(): void {
    this.timeline.add(
      this.systemProgress,
      {
        cpu: 85,
        memory: 70,
        network: 95,
        disk: 60,
        duration: 3000,
        ease: "inOutQuad",
        onUpdate: (values: JSAnimation) => {
          const progress = values.targets[0]
          const maxWidth = this.renderer.width - 16

          this.systemLoadingBars[0].width = Math.max(1, Math.floor((progress.cpu / 100) * maxWidth))
          this.systemLoadingBars[1].width = Math.max(1, Math.floor((progress.memory / 100) * maxWidth))
          this.systemLoadingBars[2].width = Math.max(1, Math.floor((progress.network / 100) * maxWidth))
          this.systemLoadingBars[3].width = Math.max(1, Math.floor((progress.disk / 100) * maxWidth))
        },
      },
      0,
    )

    this.timeline.add(
      this.systemProgress,
      {
        cpu: 20,
        memory: 30,
        network: 15,
        disk: 25,
        duration: 2000,
        ease: "inOutSine",
        onUpdate: (values: JSAnimation) => {
          const progress = values.targets[0]
          const maxWidth = this.renderer.width - 16

          this.systemLoadingBars[0].width = Math.max(1, Math.floor((progress.cpu / 100) * maxWidth))
          this.systemLoadingBars[1].width = Math.max(1, Math.floor((progress.memory / 100) * maxWidth))
          this.systemLoadingBars[2].width = Math.max(1, Math.floor((progress.network / 100) * maxWidth))
          this.systemLoadingBars[3].width = Math.max(1, Math.floor((progress.disk / 100) * maxWidth))
        },
      },
      4000,
    )

    this.timeline.add(
      this.counters,
      {
        packets: 12847,
        connections: 234,
        processes: 187,
        uptime: 86400,
        duration: 8000,
        ease: "linear",
        onUpdate: (values: JSAnimation) => {
          const counters = values.targets[0]
          this.statusCounters[0].content = `PACKETS: ${Math.floor(counters.packets)}`
          this.statusCounters[1].content = `CONN: ${Math.floor(counters.connections)}`
          this.statusCounters[2].content = `PROC: ${Math.floor(counters.processes)}`
          this.statusCounters[3].content = `UP: ${Math.floor(counters.uptime)}s`
        },
      },
      0,
    )

    this.orbPositions.forEach((orbPos, index) => {
      this.timeline.add(
        orbPos,
        {
          x: this.renderer.width - 10,
          duration: 2000 + index * 400,
          ease: "inOutSine",
          onUpdate: (values: JSAnimation) => {
            const pos = values.targets[0]
            this.movingOrbs[index].x = Math.floor(pos.x)
          },
        },
        index * 800,
      )

      this.timeline.add(
        orbPos,
        {
          x: 2,
          duration: 2000 + index * 400,
          ease: "inOutSine",
          onUpdate: (values: JSAnimation) => {
            const pos = values.targets[0]
            this.movingOrbs[index].x = Math.floor(pos.x)
          },
        },
        4000 + index * 800,
      )
    })

    this.pulseValues.forEach((pulseVal, index) => {
      const pulseData = { intensity: 1.0 }
      this.timeline.add(
        pulseData,
        {
          intensity: 3.0,
          duration: 1000,
          ease: "inOutQuad",
          loop: 8,
          alternate: true,
          onUpdate: (values: JSAnimation) => {
            const intensity = values.targets[0].intensity
            const height = Math.max(1, Math.floor(intensity))
            this.pulsingElements[index].height = Math.min(3, height)
          },
        },
        index * 300,
      )
    })
  }

  public update(deltaTime: number): void {
    this.timeline.update(deltaTime)
  }

  public destroy(): void {
    this.timeline.pause()
    this.renderer.root.remove("animation-container")
  }
}

export function run(rendererInstance: CliRenderer): void {
  rendererInstance.setBackgroundColor("#001122")
  rendererInstance.experimental_splitHeight = 20

  animationSystem = new SplitModeAnimations(rendererInstance)

  text = new TextRenderable(rendererInstance, {
    id: "demo-text",
    position: "absolute",
    left: 2,
    top: 0,
    width: rendererInstance.width - 4,
    height: 2,
    zIndex: 10,
    content: t`${bold(fg("#00ffff")("◆ SPLIT MODE DEMO - ANIMATED DASHBOARD ◆"))}`,
  })

  instructionsText = new TextRenderable(rendererInstance, {
    id: "split-mode-instructions",
    position: "absolute",
    left: 2,
    top: 19,
    width: rendererInstance.width - 4,
    height: 2,
    zIndex: 10,
    content: t`${bold(fg("#cccccc")("[+/-] Split height | [0] Toggle fullscreen | [M/L] Output speed | [U] Toggle mouse"))}`,
  })

  rendererInstance.root.add(text)
  rendererInstance.root.add(instructionsText)

  rendererInstance.setFrameCallback(async (deltaTime: number) => {
    if (animationSystem) {
      animationSystem.update(deltaTime)
    }
  })

  console.log("=== Split Mode Demo ===")
  console.log(`Terminal size: ${rendererInstance.terminalWidth}x${rendererInstance.terminalHeight}`)
  console.log(`Renderer split height: ${rendererInstance.experimental_splitHeight}`)
  console.log(`Renderer offset: ${rendererInstance.terminalHeight - rendererInstance.experimental_splitHeight}`)
  console.log("Console output should appear here and scroll naturally")
  console.log("The renderer should stay fixed at the bottom as a footer")
  console.log(`Test output running at ${testOutputInterval}ms intervals (use M/L to adjust speed)`)
  console.log(`Mouse functionality: ${rendererInstance.useMouse ? "enabled" : "disabled"} (use U to toggle)`)

  let messageCount = 0

  const startTestOutput = () => {
    if (outputTimer) {
      clearInterval(outputTimer)
    }
    outputTimer = setInterval(() => {
      messageCount++
      console.log(`Test output ${messageCount}: This should appear above the renderer and scroll naturally`)
    }, testOutputInterval)
  }

  startTestOutput()

  keyHandler = (key) => {
    if (key.name === "+") {
      const currentHeight = rendererInstance.experimental_splitHeight || 0
      const newHeight = Math.min(currentHeight + 1, rendererInstance.terminalHeight - 5)
      rendererInstance.experimental_splitHeight = newHeight
      console.log(`Split height increased to ${newHeight}`)
    } else if (key.name === "-") {
      const currentHeight = rendererInstance.experimental_splitHeight || 0
      const newHeight = Math.max(currentHeight - 1, 5)
      rendererInstance.experimental_splitHeight = newHeight
      console.log(`Split height decreased to ${newHeight}`)
    } else if (key.name === "0") {
      if (rendererInstance.experimental_splitHeight > 0) {
        rendererInstance.experimental_splitHeight = 0
        console.log("Switched to fullscreen mode")
      } else {
        rendererInstance.experimental_splitHeight = 20
        console.log("Switched to split mode (height 10)")
      }
    } else if (key.name === "m") {
      testOutputInterval = Math.max(5, testOutputInterval - 5)
      startTestOutput()
      console.log(`Test output speed increased (interval: ${testOutputInterval}ms)`)
    } else if (key.name === "l") {
      testOutputInterval = Math.min(1000, testOutputInterval + 5)
      startTestOutput()
      console.log(`Test output speed decreased (interval: ${testOutputInterval}ms)`)
    } else if (key.name === "u") {
      rendererInstance.useMouse = !rendererInstance.useMouse
      console.log(`Mouse functionality ${rendererInstance.useMouse ? "enabled" : "disabled"}`)
    }
  }

  getKeyHandler().on("keypress", keyHandler)
}

export function destroy(rendererInstance: CliRenderer): void {
  if (keyHandler) {
    getKeyHandler().off("keypress", keyHandler)
    keyHandler = null
  }

  if (outputTimer) {
    clearInterval(outputTimer)
    outputTimer = null
  }

  if (animationSystem) {
    animationSystem.destroy()
    animationSystem = null
  }

  if (text) {
    rendererInstance.root.remove(text.id)
    text = null
  }

  if (instructionsText) {
    rendererInstance.root.remove(instructionsText.id)
    instructionsText = null
  }

  rendererInstance.clearFrameCallbacks()
  rendererInstance.experimental_splitHeight = 0
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    targetFps: 30,
    exitOnCtrlC: true,
    useMouse: true,
    useAlternateScreen: false,
    useConsole: false,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
