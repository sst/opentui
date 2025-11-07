// Delete when done testing

import { createCliRenderer, InputRenderable } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { useEffect, useRef } from "react"

export const App = () => {
  const inputRef = useRef<InputRenderable>(null)

  useEffect(() => {
    if (!inputRef.current) return
    inputRef.current.value = "Hello, world!"
  }, [inputRef.current])

  return (
    <box border height={3}>
      <input
        focused
        placeholder="Type here..."
        ref={inputRef}
        onChange={(value) => console.log(`onChange: ${value}`)}
        onInput={(value) => console.log(`onInput: ${value}`)}
        onSubmit={(e) => console.log(`onSubmit: ${e}`)}
      />
    </box>
  )
}

const renderer = await createCliRenderer()
renderer.console.show()
createRoot(renderer).render(<App />)
