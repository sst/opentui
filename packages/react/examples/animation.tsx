import { createCliRenderer, TextAttributes } from "@opentui/core"
import { createRoot, useTimeline } from "@opentui/react"
import { useEffect, useState } from "react"

type Stats = {
  cpu: number
  memory: number
  network: number
  disk: number
}

export const App = () => {
  const [stats, setAnimatedStats] = useState<Stats>({
    cpu: 0,
    memory: 0,
    network: 0,
    disk: 0,
  })

  const timeline = useTimeline({
    duration: 3000,
    loop: false,
  })

  useEffect(() => {
    timeline.add(
      stats,
      {
        cpu: 85,
        memory: 70,
        network: 95,
        disk: 60,
        duration: 3000,
        ease: "linear",
        onUpdate: (values) => {
          setAnimatedStats({ ...values.targets[0] })
        },
      },
      0,
    )
  }, [])

  const statsMap = [
    { name: "CPU", key: "cpu", color: "#6a5acd" },
    { name: "Memory", key: "memory", color: "#4682b4" },
    { name: "Network", key: "network", color: "#20b2aa" },
    { name: "Disk", key: "disk", color: "#daa520" },
  ]

  return (
    <box
      title="System Monitor"
      style={{
        margin: 1,
        padding: 1,
        border: true,
        marginLeft: 2,
        marginRight: 2,
        borderStyle: "single",
        borderColor: "#4a4a4a",
      }}
    >
      {statsMap.map((stat) => (
        <box key={stat.key}>
          <box flexDirection="row" justifyContent="space-between">
            <text>{stat.name}</text>
            <text attributes={TextAttributes.DIM}>{Math.round(stats[stat.key as keyof Stats])}%</text>
          </box>
          <box style={{ backgroundColor: "#333333" }}>
            <box style={{ width: `${stats[stat.key as keyof Stats]}%`, height: 1, backgroundColor: stat.color }} />
          </box>
        </box>
      ))}
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
