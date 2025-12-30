import { createCliRenderer } from "@opentui/core"
import { createRoot, flushSync, useKeyboard } from "@opentui/react"
import { useRef, useState } from "react"

/**
 * flushSync forces React to flush updates synchronously.
 * Without it, React batches updates and the ref won't reflect the new value immediately.
 */
export const App = () => {
  const [count, setCount] = useState(0)
  const [log, setLog] = useState<string[]>([])
  const countRef = useRef<number>(0)

  useKeyboard((key) => {
    if (key.name === "q") process.exit(0)

    if (key.name === "a") {
      // Async: ref still has old value when we read it
      setCount((c) => {
        countRef.current = c + 1
        return c + 1
      })
      setLog((l) => [...l.slice(-4), `async: ref=${countRef.current} (stale until next render)`])
    }

    if (key.name === "s") {
      // Sync: ref has new value immediately after flushSync
      flushSync(() => {
        setCount((c) => {
          countRef.current = c + 1
          return c + 1
        })
      })
      setLog((l) => [...l.slice(-4), `sync:  ref=${countRef.current} (updated immediately)`])
    }
  })

  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <text content="flushSync Demo" style={{ fg: "#FFFF00", attributes: 1 }} />
      <text content="'a' = async | 's' = sync | 'q' = quit" style={{ fg: "#666666" }} />
      <text content={`Count: ${count}`} style={{ fg: "#00FF00", marginTop: 1 }} />
      <box title="Log" style={{ border: true, marginTop: 1, flexDirection: "column", width: 50 }}>
        {log.map((l, i) => (
          <text key={i} content={l} style={{ fg: l.startsWith("sync") ? "#00FFFF" : "#FF8800" }} />
        ))}
      </box>
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
