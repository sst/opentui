import { useEffect, useState } from "react"
import { render } from "@opentui/react"

export const App = () => {
  const [counter, setCounter] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCounter((prevCount) => prevCount + 1)
    }, 50)

    return () => clearInterval(interval)
  }, [])

  return <text content={`${counter} tests passed...`} fg="#00FF00" />
}

render(<App />)
