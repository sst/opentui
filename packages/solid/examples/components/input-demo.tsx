import { useRenderer } from "@opentui/solid"
import { createSignal, onMount } from "solid-js"

const InputScene = () => {
  const renderer = useRenderer()
  onMount(() => {
    renderer.setBackgroundColor("#001122")
  })

  const [nameValue, setNameValue] = createSignal("")

  return (
    <box height={4}>
      <text>Name: {nameValue()}</text>
      <input focused onInput={(value) => setNameValue(value)} />
    </box>
  )
}

export default InputScene
