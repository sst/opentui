import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard } from "@opentui/react"
import { useState, useEffect } from "react"

export default function App() {
  const [animating, setAnimating] = useState(false)
  const [opacities, setOpacities] = useState([1.0, 0.8, 0.5, 0.3])
  const [phase, setPhase] = useState(0)

  useKeyboard((key) => {
    if (key.name === "a" && !key.ctrl && !key.meta) {
      setAnimating(!animating)
    } else if (key.name === "1") {
      setOpacities((prev) => [prev[0] === 1.0 ? 0.3 : 1.0, prev[1], prev[2], prev[3]])
    } else if (key.name === "2") {
      setOpacities((prev) => [prev[0], prev[1] === 1.0 ? 0.3 : 1.0, prev[2], prev[3]])
    } else if (key.name === "3") {
      setOpacities((prev) => [prev[0], prev[1], prev[2] === 1.0 ? 0.3 : 1.0, prev[3]])
    } else if (key.name === "4") {
      setOpacities((prev) => [prev[0], prev[1], prev[2], prev[3] === 1.0 ? 0.3 : 1.0])
    }
  })

  useEffect(() => {
    if (!animating) return

    const interval = setInterval(() => {
      setPhase((p) => p + 0.05)
    }, 50)

    return () => clearInterval(interval)
  }, [animating])

  useEffect(() => {
    if (animating) {
      setOpacities([
        0.3 + 0.7 * Math.abs(Math.sin(phase)),
        0.3 + 0.7 * Math.abs(Math.sin(phase + 0.5)),
        0.3 + 0.7 * Math.abs(Math.sin(phase + 1.0)),
        0.3 + 0.7 * Math.abs(Math.sin(phase + 1.5)),
      ])
    }
  }, [phase, animating])

  const colors = ["#e94560", "#0f3460", "#533483", "#16a085"]

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box height={3} backgroundColor="#16213e" border borderStyle="single" alignItems="center" justifyContent="center">
        <text fg="#e94560">
          OPACITY DEMO | 1-4: Toggle opacity | A: {animating ? "Stop" : "Animate"} | Ctrl+C: Exit
        </text>
      </box>

      {/* Main content */}
      <box flexGrow={1} flexDirection="row" padding={2}>
        {/* Overlapping boxes */}
        <box flexGrow={1} position="relative">
          {[0, 1, 2, 3].map((i) => (
            <box
              key={i}
              position="absolute"
              left={10 + i * 8}
              top={2 + i * 2}
              width={20}
              height={8}
              backgroundColor={colors[i]}
              opacity={opacities[i]}
              border
              borderStyle="double"
              borderColor="#ffffff"
              alignItems="center"
              justifyContent="center"
              flexDirection="column"
            >
              <text fg="#ffffff">Box {i + 1}</text>
              <text fg="#ffffff">Opacity: {opacities[i].toFixed(1)}</text>
            </box>
          ))}
        </box>

        {/* Nested opacity demo */}
        <box
          position="absolute"
          right={5}
          top={5}
          width={35}
          height={10}
          backgroundColor="#e94560"
          opacity={0.7}
          border
          borderStyle="single"
          padding={1}
          flexDirection="column"
        >
          <text fg="#ffffff">Parent: 0.7 opacity</text>
          <box
            backgroundColor="#0f3460"
            opacity={0.5}
            border
            flexGrow={1}
            alignItems="center"
            justifyContent="center"
            flexDirection="column"
          >
            <text fg="#ffffff">Child: 0.5 opacity</text>
            <text fg="#ffcc00">Effective: 0.35</text>
          </box>
        </box>
      </box>
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
