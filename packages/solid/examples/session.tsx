import { createMemo, createSignal, For, onMount } from "solid-js"
import { ScrollBoxRenderable, fg } from "@opentui/core"

// Message types
type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  fullContent?: string
  timestamp: Date
  isComplete: boolean
}

// Sample message templates with different sizes
const messageTemplates = [
  "Hello! How can I help you today?",
  "I understand you're looking for information about React development.\n\nLet me provide you with some detailed guidance on best practices\nfor building modern web applications.",
  "That's a great question! When working with SolidJS, you should\nconsider the reactive principles that make it different from other frameworks.\n\nThe key is understanding signals and how they automatically\ntrack dependencies.",
  "Based on your requirements, I recommend the following approach:\n\n1) Set up your development environment\n2) Create the basic component structure\n3) Implement the core functionality\n4) Add error handling and testing\n\nThis systematic approach will ensure you build a robust solution.",
  "The scrollbox component in OpenTUI provides excellent performance\ncharacteristics for handling large amounts of content.\n\nIt uses virtual scrolling under the hood to efficiently render\nonly the visible portion of your data, making it ideal for chat\napplications, logs, or any scenario where you need to display\npotentially unbounded content streams.",
  "Debugging reactive systems can be tricky, but SolidJS provides\nexcellent developer tools.\n\nRemember to use the reactive debugger to inspect signal values\nand track how changes propagate through your component tree.\n\nThe key insight is that effects run immediately when their\ndependencies change, unlike other frameworks where updates\nmight be batched.",
  "Performance optimization in frontend applications often comes\ndown to minimizing unnecessary re-renders.\n\nIn SolidJS, this means being careful about how you structure\nyour signals and computations.\n\nUse createMemo for expensive calculations and avoid creating\nsignals inside loops or conditional blocks when possible.",
  "TypeScript provides excellent type safety for JavaScript applications,\nbut it requires careful consideration of how types interact\nwith reactive systems.\n\nThe key is to properly type your signals and ensure that type\ninformation flows correctly through your component hierarchy.",
  "When designing user interfaces, accessibility should always be\na primary consideration.\n\nThis means providing proper ARIA labels, keyboard navigation\nsupport, and ensuring that your components work well with\nscreen readers.\n\nOpenTUI makes this easier by providing semantic components\nthat handle many accessibility concerns automatically.",
  "Testing reactive applications requires a different mindset\nthan traditional unit testing.\n\nYou need to think about testing the reactive flow - how signals\nupdate when their dependencies change, how effects respond\nto those changes, and whether your UI correctly reflects\nthe current state of your application data.",
]

export function Session() {
  const [messages, setMessages] = createSignal<Message[]>([])
  let scrollRef: ScrollBoxRenderable | undefined
  let isChunkingActive = false

  // Generate a random message
  const generateMessage = (): Message => {
    const templates = messageTemplates
    const template = templates[Math.floor(Math.random() * templates.length)]
    const role = Math.random() > 0.5 ? "user" : "assistant"

    return {
      id: Math.random().toString(36).substr(2, 9),
      role,
      content: "", // Start empty, will be filled in chunks
      timestamp: new Date(),
      isComplete: false,
    }
  }

  // Add a new message to the list (only if not already chunking)
  const addMessage = () => {
    if (isChunkingActive) return // Don't add new messages while one is being chunked

    const newMessage = generateMessage()
    const fullContent = messageTemplates[Math.floor(Math.random() * messageTemplates.length)]

    // Set the full content on the message but mark it as incomplete
    newMessage.content = "" // Start empty
    newMessage.fullContent = fullContent // Store the full content

    setMessages((prev) => [...prev, newMessage])

    // Start chunking this message
    if (fullContent) {
      isChunkingActive = true
      startChunkingMessage(newMessage.id, fullContent)
    }
  }

  // Simulate chunked arrival for a specific message
  const startChunkingMessage = (messageId: string, fullContent: string) => {
    let currentIndex = 0
    const chunkSize = Math.floor(Math.random() * 5) + 1 // 1-5 characters per chunk

    const chunkInterval = setInterval(
      () => {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  content: fullContent.slice(0, currentIndex + chunkSize),
                  isComplete: currentIndex + chunkSize >= fullContent.length,
                }
              : msg,
          ),
        )

        currentIndex += chunkSize

        if (currentIndex >= fullContent.length) {
          clearInterval(chunkInterval)
          isChunkingActive = false // Reset the flag
          // Immediately start the next message
          addMessage()
        }
      },
      2 + Math.random() * 10,
    )
  }

  onMount(() => {
    setTimeout(addMessage, 500)
  })

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexGrow={1} maxHeight="100%">
      <box paddingBottom={1}>
        <text>
          {fg("#00ff00")("📨")} {fg("#ffffff")("Live Message Stream")}
        </text>
        <text fg="#666666">Messages arrive in chunks - watch them build character by character!</text>
      </box>

      <scrollbox
        ref={(r: any) => (scrollRef = r)}
        scrollbarOptions={{ visible: true }}
        paddingTop={1}
        paddingBottom={1}
        contentOptions={{
          flexGrow: 1,
          gap: 1,
        }}
      >
        <For each={messages()}>{(message) => <MessageItem message={message} />}</For>
      </scrollbox>

      <box paddingTop={1}>
        <text fg="#666666">
          Messages: {messages().length} | {isChunkingActive ? "Receiving message..." : "Waiting for next message..."}
        </text>
      </box>
    </box>
  )
}

// Simple message display component
function MessageItem(props: { message: Message }) {
  const timeString = createMemo(() =>
    props.message.timestamp.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  )

  return (
    <box
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      border={["left"]}
      borderColor={props.message.role === "user" ? "#00ff00" : "#0088ff"}
      backgroundColor={props.message.role === "user" ? "#001100" : "#000022"}
    >
      <box flexDirection="row" paddingBottom={0.5}>
        <text>{props.message.role === "user" ? fg("#00ff00")("👤 You") : fg("#0088ff")("🤖 Assistant")}</text>
        <box flexGrow={1} />
        <text fg="#666666">{timeString()}</text>
      </box>

      <text>
        {props.message.content}
        {!props.message.isComplete && fg("#ffff00")("▊")}
      </text>

      {!props.message.isComplete && props.message.fullContent && (
        <text fg="#666666" paddingTop={0.5}>
          Receiving message... ({Math.round((props.message.content.length / props.message.fullContent.length) * 100)}
          %)
        </text>
      )}
    </box>
  )
}
