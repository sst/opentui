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
      <text style={{ bg: "red", fg: "black" }}>Simple text works! {counter()} times</text>
      <text style={{ bg: "red", fg: "black" }}>
        Hello {counter()} <span style={{ bg: "yellow", fg: "black" }}>World</span>{" "}
        <span style={{ bg: "blue", fg: "yellow", underline: true }}>{counter()}</span>
      </text>
    </box>
  )
}
