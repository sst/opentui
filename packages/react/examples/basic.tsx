import { bold, fg, italic, t, TextAttributes } from "@opentui/core"
import { useCallback, useState } from "react"
import { Box, Group, Input, render, Text, useKeyboard, useRenderer } from "../src"

export const App = () => {
  const renderer = useRenderer()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [focused, setFocused] = useState<"username" | "password">("username")
  const [status, setStatus] = useState<"idle" | "invalid" | "success">("idle")

  useKeyboard((key) => {
    if (key.name === "tab") {
      setFocused((prevFocused) => (prevFocused === "username" ? "password" : "username"))
    }

    if (key.ctrl && key.name === "k") {
      renderer?.toggleDebugOverlay()
      renderer?.console.toggle()
    }
  })

  const handleUsernameChange = useCallback((value: string) => {
    setUsername(value)
  }, [])

  const handlePasswordChange = useCallback((value: string) => {
    setPassword(value)
  }, [])

  const handleSubmit = useCallback(() => {
    if (username === "admin" && password === "secret") {
      setStatus("success")
    } else {
      setStatus("invalid")
    }
  }, [username, password])

  return (
    <Group padding={2} flexDirection="column">
      <Text content="OpenTUI with React!" fg="#FFFF00" attributes={TextAttributes.BOLD | TextAttributes.ITALIC} />
      <Text content={t`${bold(italic(fg("cyan")(`Styled Text!`)))}`} />

      <Box width={40} height={3} title="Username" marginTop={1}>
        <Input
          placeholder="Enter your username..."
          onInput={handleUsernameChange}
          onSubmit={handleSubmit}
          focused={focused === "username"}
          focusedBackgroundColor="#000000"
        />
      </Box>

      <Box width={40} height={3} title="Password" marginTop={1} marginBottom={1}>
        <Input
          placeholder="Enter your password..."
          onInput={handlePasswordChange}
          onSubmit={handleSubmit}
          focused={focused === "password"}
          focusedBackgroundColor="#000000"
        />
      </Box>

      <Text
        fg={status === "idle" ? "#AAAAAA" : status === "success" ? "green" : "red"}
        content={status.toUpperCase()}
      />
    </Group>
  )
}

render(<App />)
