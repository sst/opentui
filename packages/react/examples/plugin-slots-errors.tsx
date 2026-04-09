import { createCliRenderer, type PluginErrorEvent } from "@opentui/core"
import {
  Slot,
  createReactSlotRegistry,
  createRoot,
  type ReactPlugin,
  type SlotMode,
  useKeyboard,
  useRenderer,
} from "@opentui/react"
import { useEffect, useMemo, useState } from "react"

type DemoSlots = {
  statusbar: { label: string }
  sidebar: { section: string }
}

const DEMO_STATUS_LABEL = "host-status"
const DEMO_SIDEBAR_SECTION = "plugins"

const hostContext = {
  appName: "react-plugin-slots-demo",
  version: "1.0.0",
}

function nextStatusbarMode(mode: SlotMode): SlotMode {
  if (mode === "append") {
    return "replace"
  }

  if (mode === "replace") {
    return "single_winner"
  }

  return "append"
}

function formatPluginError(event: PluginErrorEvent): string {
  return `${event.pluginId} [${event.phase}/${event.source}] @ ${event.slot ?? "<none>"}: ${event.error.message}`
}

function CrashNode({ pluginId }: { pluginId: string }) {
  throw new Error(`Forced subtree crash in ${pluginId}`)
  return null
}

function ClockStatusText({ label }: { label: string }) {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString())

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toLocaleTimeString())
    }, 1000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  return <text fg="#93c5fd">{`Clock plugin -> ${label} (${time})`}</text>
}

function createClockPlugin(crash: boolean): ReactPlugin<DemoSlots, typeof hostContext> {
  return {
    id: "clock-plugin",
    order: 0,
    slots: {
      statusbar(_ctx, props) {
        if (crash) {
          return <CrashNode pluginId="clock-plugin" />
        }

        return (
          <box
            border
            borderStyle="single"
            borderColor="#2563eb"
            marginLeft={1}
            paddingLeft={1}
            paddingRight={1}
            height={3}
          >
            <ClockStatusText label={props.label} />
          </box>
        )
      },
      sidebar(_ctx, props) {
        return (
          <box
            border
            borderStyle="single"
            borderColor="#0ea5e9"
            flexDirection="column"
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg="#38bdf8">{`Clock Sidebar (${props.section})`}</text>
            <text fg="#e2e8f0">Healthy</text>
          </box>
        )
      },
    },
  }
}

function createActivityPlugin(crash: boolean): ReactPlugin<DemoSlots, typeof hostContext> {
  return {
    id: "activity-plugin",
    order: 10,
    slots: {
      statusbar() {
        if (crash) {
          throw new Error("Forced activity render failure")
        }

        return (
          <box
            border
            borderStyle="single"
            borderColor="#16a34a"
            marginLeft={1}
            paddingLeft={1}
            paddingRight={1}
            height={3}
          >
            <text fg="#86efac">Activity plugin healthy</text>
          </box>
        )
      },
    },
  }
}

function App() {
  const renderer = useRenderer()
  const registry = useMemo(
    () => createReactSlotRegistry<DemoSlots, typeof hostContext>(renderer, hostContext),
    [renderer],
  )

  const [statusbarMode, setStatusbarMode] = useState<SlotMode>("append")
  const [clockEnabled, setClockEnabled] = useState(true)
  const [activityEnabled, setActivityEnabled] = useState(true)
  const [clockCrashEnabled, setClockCrashEnabled] = useState(false)
  const [activityCrashEnabled, setActivityCrashEnabled] = useState(false)
  const [showPlaceholder, setShowPlaceholder] = useState(true)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [errorLines, setErrorLines] = useState<string[]>([])

  const AppSlot = Slot<DemoSlots, typeof hostContext>

  const pluginFailurePlaceholder = (failure: PluginErrorEvent) => {
    return (
      <box border borderStyle="single" borderColor="#fb7185" marginLeft={1} paddingLeft={1} paddingRight={1}>
        <text fg="#fecaca">{`Plugin error: ${failure.pluginId}`}</text>
        <text fg="#fca5a5">{`${failure.phase}/${failure.source} @ ${failure.slot ?? "unknown"}`}</text>
      </box>
    )
  }

  useEffect(() => {
    renderer.setBackgroundColor("#000000")
  }, [renderer])

  useEffect(() => {
    return registry.onPluginError((event) => {
      setErrorLines((current) => [formatPluginError(event), ...current].slice(0, 6))
    })
  }, [registry])

  useEffect(() => {
    const unregisterCallbacks: Array<() => void> = []

    if (clockEnabled) {
      unregisterCallbacks.push(registry.register(createClockPlugin(clockCrashEnabled)))
    }

    if (activityEnabled) {
      unregisterCallbacks.push(registry.register(createActivityPlugin(activityCrashEnabled)))
    }

    return () => {
      for (const unregister of unregisterCallbacks.reverse()) {
        unregister()
      }
    }
  }, [registry, clockEnabled, activityEnabled, clockCrashEnabled, activityCrashEnabled, refreshNonce])

  useKeyboard((key) => {
    switch (key.name) {
      case "1":
        setClockEnabled((current) => !current)
        return
      case "2":
        setActivityEnabled((current) => !current)
        return
      case "m":
        setStatusbarMode((current) => nextStatusbarMode(current))
        return
      case "e":
        setClockCrashEnabled((current) => !current)
        return
      case "d":
        setActivityCrashEnabled((current) => !current)
        return
      case "p":
        setShowPlaceholder((current) => !current)
        return
      case "r":
        setRefreshNonce((current) => current + 1)
        return
      case "x":
        setClockCrashEnabled(false)
        setActivityCrashEnabled(false)
        setErrorLines([])
        registry.clearPluginErrors()
        setRefreshNonce((current) => current + 1)
        return
      case "c":
        if (key.ctrl) {
          key.preventDefault()
          renderer.destroy()
        }
        return
    }
  })

  const info = [
    "React Plugin Slot Demo",
    "",
    `Statusbar mode: ${statusbarMode.toUpperCase()} (press m to cycle)`,
    `Clock plugin: ${clockEnabled ? "ON" : "OFF"} (press 1)`,
    `Activity plugin: ${activityEnabled ? "ON" : "OFF"} (press 2)`,
    `Clock subtree crash: ${clockCrashEnabled ? "ON" : "OFF"} (press e)`,
    `Activity throw: ${activityCrashEnabled ? "ON" : "OFF"} (press d)`,
    `Show placeholders: ${showPlaceholder ? "YES" : "NO"} (press p)`,
    "",
    `Statusbar slot label: ${DEMO_STATUS_LABEL}`,
    `Sidebar slot section: ${DEMO_SIDEBAR_SECTION}`,
    "",
    "Press r to re-register active plugins.",
    "Press x to reset errors and clear history.",
    "",
    "Recent plugin errors:",
    ...(errorLines.length > 0 ? errorLines : ["(none)"]),
  ].join("\n")

  return (
    <box width="100%" height="100%" flexDirection="column" padding={1} backgroundColor="#020617">
      <box
        height={5}
        width="100%"
        border
        borderStyle="single"
        borderColor="#334155"
        alignItems="center"
        flexDirection="row"
        paddingLeft={1}
        marginBottom={1}
      >
        <AppSlot
          registry={registry}
          name="statusbar"
          label={DEMO_STATUS_LABEL}
          mode={statusbarMode}
          pluginFailurePlaceholder={showPlaceholder ? pluginFailurePlaceholder : undefined}
        >
          <text fg="#94a3b8">Fallback statusbar content</text>
        </AppSlot>
      </box>

      <box width="100%" flexGrow={1} flexDirection="row">
        <box
          width={36}
          border
          borderStyle="single"
          borderColor="#334155"
          flexDirection="column"
          padding={1}
          marginRight={1}
        >
          <AppSlot
            registry={registry}
            name="sidebar"
            section={DEMO_SIDEBAR_SECTION}
            mode="replace"
            pluginFailurePlaceholder={showPlaceholder ? pluginFailurePlaceholder : undefined}
          >
            <text fg="#94a3b8">No sidebar plugin active</text>
          </AppSlot>
        </box>

        <box flexGrow={1} border borderStyle="single" borderColor="#334155" flexDirection="column" padding={1}>
          <text fg="#e2e8f0" content={info} />
        </box>
      </box>
    </box>
  )
}

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
})

createRoot(renderer).render(<App />)
