import { bold, underline, t, fg, bg, italic } from "@opentui/core"
import { createSignal, onCleanup, onMount } from "solid-js"

export default function TextStyleScene() {
  const [counter, setCounter] = createSignal(0)

  let interval: NodeJS.Timeout

  onMount(() => {
    interval = setInterval(() => {
      setCounter((c) => c + 1)
    }, 1000)
  })

  onCleanup(() => {
    clearInterval(interval)
  })

  return (
    <box>
      <text style={{ bg: "red" }}>Simple text works! {counter()} times</text>
      <text style={{ bg: "red" }}>
        Hello <span style={{ bg: "yellow" }}>World</span> {counter()}{" "}
        <span style={{ bg: "blue", underline: true }}>{counter()}</span>
      </text>
    </box>
  )
}
