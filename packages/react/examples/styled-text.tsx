import { useEffect, useState } from "react"
import { render } from "@opentui/react"
import { blue, bold, red, t, underline } from "@opentui/core"

export const App = () => {
  const [counter, setCounter] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCounter((prevCount) => prevCount + 1)
    }, 50)

    return () => clearInterval(interval)
  }, [])

  return (
    <box>
      <text>Simple text works! {counter}</text>
      <text>{underline(bold(`Chunk also works! ${counter}`))}</text>
      <text>{t`${bold(red("Bold Red"))} and ${blue("Blue Text")} ${counter}`}</text>
    </box>
  )
}

render(<App />)
