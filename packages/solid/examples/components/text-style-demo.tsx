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
      <text>Simple text works! {counter()}</text>
      <text>{underline(bold(`Chunk also works! ${counter()}`))}</text>
      <text>{t`${italic(fg("#adff2f")("Styled"))} ${bold(fg("#ff8c00")("Text"))} also works! ${counter()}`}</text>
      <text>
        And {bold("chunk arrays")} work {fg("#ff8c00")("as welll")}!! {italic(underline(`${counter()}`))}
      </text>
      You do not need to have a text node {counter()} as a parent when dealing with text {counter()}
      <box border>
        {counter()} Mix in some {bold("more text")} {counter()}
      </box>
    </box>
  )
}
