import { useEffect, useState } from "react"
import { Text, render } from "../"

export const App = () => {
  const [counter, setCounter] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCounter((prevCount) => prevCount + 1)
    }, 50)

    return () => clearInterval(interval)
  }, [])

  return <Text content={`${counter} tests passed...`} fg="#00FF00" />
}

render(<App />)
