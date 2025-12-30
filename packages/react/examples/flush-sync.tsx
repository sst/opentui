import { createCliRenderer } from "@opentui/core"
import { createRoot, flushSync, useKeyboard } from "@opentui/react"
import { useState } from "react"

/**
 * This example demonstrates the use of `flushSync` to force synchronous state updates.
 *
 * `flushSync` is useful when you need to ensure React applies state updates immediately
 * before continuing with other operations. Without it, React batches updates and applies
 * them asynchronously for better performance.
 *
 * Press 'a' to add items normally (batched), press 's' to add with flushSync (immediate).
 * Press 'q' to quit.
 */
export const App = () => {
  const [items, setItems] = useState<string[]>([])
  const [lastAction, setLastAction] = useState<string>("")

  useKeyboard((key) => {
    if (key.name === "q") {
      process.exit(0)
    }

    if (key.name === "a") {
      // Normal async update - React batches this
      const timestamp = new Date().toLocaleTimeString()
      setItems((prev) => [...prev, `Async item at ${timestamp}`])
      setLastAction(`Added async item (items.length after setState: ${items.length})`)
    }

    if (key.name === "s") {
      // Synchronous update with flushSync - React applies this immediately
      const timestamp = new Date().toLocaleTimeString()
      let newLength = 0
      flushSync(() => {
        setItems((prev) => {
          const newItems = [...prev, `Sync item at ${timestamp}`]
          newLength = newItems.length
          return newItems
        })
      })
      // After flushSync, the DOM is updated and we can read the new state
      setLastAction(`Added sync item (items.length after flushSync: ${newLength})`)
    }
  })

  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <text content="flushSync Example" style={{ fg: "#FFFF00", attributes: 1 }} />
      <text content="'a' async add | 's' sync add | 'q' quit" style={{ fg: "#666666", marginTop: 1 }} />
      {lastAction && <text content={lastAction} style={{ fg: "#888888" }} />}

      <box title={`Items (${items.length})`} style={{ border: true, marginTop: 1, flexDirection: "column" }}>
        {items.length === 0 ? (
          <text content="No items yet..." style={{ fg: "#666666" }} />
        ) : (
          items.slice(-5).map((item, i) => <text key={i} content={`  ${item}`} style={{ fg: "#00FF00" }} />)
        )}
        {items.length > 5 && <text content={`  ... and ${items.length - 5} more`} style={{ fg: "#666666" }} />}
      </box>
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
