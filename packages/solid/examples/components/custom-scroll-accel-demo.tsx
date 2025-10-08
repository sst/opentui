import { createMemo, For, createSignal } from "solid-js"
import { LinearScrollAccel, MacOSScrollAccel } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"

/**
 * Custom scroll acceleration that applies a simple quadratic curve
 */
class QuadraticScrollAccel {
  private lastTickTime = 0
  private tickCount = 0
  private readonly streakTimeout = 150
  private readonly maxMultiplier = 3

  tick(now = Date.now()): number {
    const dt = this.lastTickTime ? now - this.lastTickTime : Infinity

    // Reset streak if too much time has passed
    if (dt === Infinity || dt > this.streakTimeout) {
      this.lastTickTime = now
      this.tickCount = 0
      return 1
    }

    this.lastTickTime = now
    this.tickCount++

    // Apply quadratic acceleration: multiplier grows with consecutive ticks
    // Formula: 1 + (tickCount / 8)^2
    const multiplier = 1 + Math.pow(this.tickCount / 8, 2)

    return Math.min(multiplier, this.maxMultiplier)
  }

  reset(): void {
    this.lastTickTime = 0
    this.tickCount = 0
  }
}

/**
 * Custom scroll acceleration with aggressive exponential curve
 */
class AggressiveScrollAccel {
  private lastTickTime = 0
  private velocityHistory: number[] = []
  private readonly historySize = 4
  private readonly streakTimeout = 180

  tick(now = Date.now()): number {
    const dt = this.lastTickTime ? now - this.lastTickTime : Infinity

    if (dt === Infinity || dt > this.streakTimeout) {
      this.lastTickTime = now
      this.velocityHistory = []
      return 1
    }

    this.lastTickTime = now
    this.velocityHistory.push(dt)

    if (this.velocityHistory.length > this.historySize) {
      this.velocityHistory.shift()
    }

    const avgInterval = this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length

    // More aggressive curve: smaller intervals = higher multiplier
    // Scaled down to be less extreme
    const multiplier = 1 + Math.pow(120 / avgInterval, 1.2)

    return Math.min(multiplier, 4)
  }

  reset(): void {
    this.lastTickTime = 0
    this.velocityHistory = []
  }
}

export const CustomScrollAccelDemo = () => {
  const items = createMemo(() => Array.from({ length: 1000 }).map((_, i) => ({ count: i + 1 })))
  const [accelType, setAccelType] = createSignal<"linear" | "macos" | "quadratic" | "aggressive">("macos")

  const scrollAcceleration = createMemo(() => {
    switch (accelType()) {
      case "linear":
        return new LinearScrollAccel()
      case "macos":
        return new MacOSScrollAccel({ A: 0.5, tau: 4, maxMultiplier: 4 })
      case "quadratic":
        return new QuadraticScrollAccel()
      case "aggressive":
        return new AggressiveScrollAccel()
    }
  })

  const modeNames = {
    linear: "Linear (no accel)",
    macos: "macOS (smooth)",
    quadratic: "Quadratic",
    aggressive: "Aggressive",
  }

  useKeyboard((key) => {
    if (key.raw === "1") setAccelType("linear")
    else if (key.raw === "2") setAccelType("macos")
    else if (key.raw === "3") setAccelType("quadratic")
    else if (key.raw === "4") setAccelType("aggressive")
  })

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
      }}
    >
      <box
        style={{
          width: "100%",
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
          backgroundColor: "#24283b",
          flexShrink: 0,
        }}
      >
        <text
          content={`Scroll Acceleration: ${modeNames[accelType()]} (Press 1=Linear, 2=macOS, 3=Quadratic, 4=Aggressive)`}
        />
      </box>

      <scrollbox
        style={{
          width: "100%",
          flexGrow: 1,
          rootOptions: {
            backgroundColor: "#24283b",
            border: true,
          },
          wrapperOptions: {
            backgroundColor: "#1f2335",
          },
          viewportOptions: {
            backgroundColor: "#1a1b26",
          },
          contentOptions: {
            backgroundColor: "#16161e",
          },
          scrollbarOptions: {
            showArrows: true,
            trackOptions: {
              foregroundColor: "#7aa2f7",
              backgroundColor: "#414868",
            },
          },
        }}
        scrollAcceleration={scrollAcceleration()}
        focused
      >
        <For each={items()}>
          {(item) => (
            <box
              style={{
                width: "100%",
                padding: 1,
                marginBottom: 1,
                backgroundColor: item.count % 2 === 0 ? "#292e42" : "#2f3449",
              }}
            >
              <text content={`Item ${item.count}`} />
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}
