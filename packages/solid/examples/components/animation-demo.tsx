import { useTerminalDimensions, useTimeline, createComponentTimeline } from "@opentui/solid"
import { For } from "solid-js"

export const SplitModeDemo = () => {
  const tDims = useTerminalDimensions()
  const systems = [
    { name: "CPU", color: "#6a5acd", y: 6, animKey: "cpu" },
    { name: "MEM", color: "#4682b4", y: 7, animKey: "memory" },
    { name: "NET", color: "#20b2aa", y: 8, animKey: "network" },
    { name: "DSK", color: "#daa520", y: 9, animKey: "disk" },
  ] as const

  const timeline = createComponentTimeline({
    duration: 8000,
    loop: false,
  })

  const animatedSystem = useTimeline(
    timeline,
    { cpu: 0, memory: 0, network: 0, disk: 0 },
    { cpu: 85, memory: 70, network: 95, disk: 60 },
    {
      duration: 3000,
      ease: "inOutQuad",
    },
    0,
  )

  return (
    <box
      style={{
        zIndex: 5,
      }}
      live
    >
      <box
        title="SYSTEM MONITOR"
        titleAlignment="center"
        style={{
          position: "absolute",
          left: 2,
          top: 5,
          width: tDims().width - 6,
          height: 8,
          backgroundColor: "#1a1a2e",
          zIndex: 1,
          border: true,
          borderStyle: "double",
          borderColor: "#4a4a4a",
        }}
      >
        <text>{animatedSystem().cpu}</text>
        {/* <DummComponent /> */}
        <For each={systems}>
          {(system) => (
            <box
              style={{
                flexDirection: "row",
                height: 1,
                width: "100%",
                paddingLeft: 1,
                paddingRight: 2,
              }}
            >
              <text
                style={{
                  fg: system.color,
                  zIndex: 2,
                  marginRight: 1,
                }}
              >
                {system.name}
              </text>
              <box
                style={{
                  height: 1,
                  backgroundColor: "#333333",
                  zIndex: 1,
                  flexGrow: 1,
                }}
              >
                <box
                  style={{
                    width: `${Math.round(animatedSystem()[system.animKey])}%`,
                    height: 1,
                    backgroundColor: system.color,
                    zIndex: 2,
                  }}
                />
              </box>
            </box>
          )}
        </For>
      </box>

      <box
        title="◇ REAL-TIME STATS ◇"
        titleAlignment="center"
        style={{
          position: "absolute",
          left: 2,
          top: 14,
          width: tDims().width - 6,
          height: 4,
          backgroundColor: "#2d1b2e",
          zIndex: 1,
          border: true,
          borderStyle: "single",
          borderColor: "#8a4a8a",
        }}
      />

      <For each={["PACKETS", "CONNECTIONS", "PROCESSES", "UPTIME"] as const}>
        {(label, index) => (
          <text
            style={{
              position: "absolute",
              left: 4 + index() * 15,
              top: 15,
              fg: "#9a9acd",
              zIndex: 2,
            }}
          >
            {label}: 0
          </text>
        )}
      </For>

      <For each={["#ff6b9d", "#4ecdc4", "#ffe66d"] as const}>
        {(color) => (
          <box
            style={{
              position: "absolute",
              left: 2,
              top: 2,
              width: 3,
              height: 1,
              backgroundColor: color,
              zIndex: 3,
            }}
          />
        )}
      </For>

      <For each={["#ff8a80", "#80cbc4", "#fff176"] as const}>
        {(color, index) => (
          <box
            style={{
              position: "absolute",
              left: tDims().width - 8 + index() * 2,
              top: 1,
              width: 1,
              height: 1,
              backgroundColor: color,
              zIndex: 3,
            }}
          />
        )}
      </For>
    </box>
  )
}
