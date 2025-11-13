import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { useEffect, useState } from "react"

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

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
