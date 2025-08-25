import type { ScrollBoxRenderable } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/react"
import { useEffect, useRef, useState } from "react"

const generateMessages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    author: i % 2 === 0 ? "You" : "AI",
    text: `${i % 2 === 0 ? "Hello" : "Hello, how can I assist you?"}`,
  }))

export const App = () => {
  const [focused, setFocused] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const renderer = useRenderer()
  const scrollRef = useRef<ScrollBoxRenderable>(null)

  useKeyboard((key) => {
    if (key.name === "tab") {
      setFocused((f) => !f)
    }
    if (key.name === "escape") {
      process.exit(0)
    }
  })

  const [messages, setMessages] = useState(() => generateMessages(30))

  const handleSubmit = (value: string) => {
    if (!value.trim()) return
    setMessages((prev) => [
      ...prev,
      {
        id: prev.length ? prev[prev.length - 1].id + 1 : 0,
        author: "You",
        text: value,
      },
      {
        id: prev.length ? prev[prev.length - 1].id + 1 : 0,
        author: "AI",
        text: `As an AI, I cannot help you with "${value}" request.`,
      },
    ])
    setInputValue("")
  }

  useEffect(() => {
    scrollRef.current?.scrollToBottom?.()
  }, [messages.length])

  return (
    <group style={{ flexDirection: "column" }}>
      <box backgroundColor="#0a0a0a" border={false} minHeight={renderer.height}>
        <text attributes={1} content="Scroll Box Demo (TAB to toggle focus, ESC to exit)" />

        <scroll-box
          ref={scrollRef}
          title="Chat History"
          scrollStep={4}
          showScrollIndicator
          style={{
            height: 20,
            width: "auto",
            marginTop: 1,
            border: false,
            borderStyle: "single",
            focusedBorderColor: "#475569",
            borderColor: "#475569",
          }}
          focused={focused}
        >
          {messages.map((m) => (
            <box
              border={false}
              key={m.id}
              style={{
                minHeight: 3,
                justifyContent: "center",
                border: ["left"],
                borderColor: "#5c9cf5",
                borderStyle: "heavy",
                marginBottom: 1,
                marginLeft: 1,
                marginRight: 1,
                paddingLeft: 1,
                paddingRight: 1,
                backgroundColor: "#141414",
              }}
            >
              <text bg="#141414" content={`${m.author}: ${m.text}`} selectable />
            </box>
          ))}
        </scroll-box>

        <box
          style={{
            height: 3,
            marginTop: 1,
            backgroundColor: "#141414",
            justifyContent: "center",
            paddingLeft: 2,
            paddingRight: 2,
          }}
          border={false}
        >
          <box border={false} flexDirection="row">
            <text>&gt; </text>
            <input
              placeholder="Type a message and press Enter"
              value={inputValue}
              onInput={setInputValue}
              onSubmit={handleSubmit}
              focused={!focused}
              flexGrow={1}
              style={{ focusedBackgroundColor: "#141414", height: 1 }}
            />
          </box>
        </box>
        <text style={{ marginTop: 1 }}>Use ↑/↓ (or j/k), PageUp/PageDown, Home/End to scroll</text>
      </box>
    </group>
  )
}

render(<App />)
