import type { InputRenderable } from "@lexwdex-org/core"
import { usePaste, useRenderer } from "@lexwdex-org/solid"
import { createSignal, onMount } from "solid-js"

const InputScene = () => {
  const renderer = useRenderer()
  const [nameValue, setNameValue] = createSignal("")
  let inputRef: InputRenderable | null = null

  usePaste((event) => {
    inputRef?.handlePaste(event)
  })

  onMount(() => {
    renderer.setBackgroundColor("#001122")
  })

  return (
    <box height={4} border>
      <text>Name: {nameValue()}</text>
      <input ref={(r) => (inputRef = r)} focused onInput={(value) => setNameValue(value)} />
    </box>
  )
}

export default InputScene
