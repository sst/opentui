import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"

// Message types
type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  fullContent: string
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
  const [messages, setMessages] = createStore<{ data: Message[] }>({ data: [] })
  let [isChunkingActive, setIsChunkingActive] = createSignal(false)

  // Generate a random message
  const generateMessage = (): Message => {
    const role = Math.random() > 0.5 ? "user" : "assistant"
    let fullContent = messageTemplates[Math.floor(Math.random() * messageTemplates.length)]
    if (!fullContent) {
      fullContent = messageTemplates[0]!
    }
    return {
      id: Math.random().toString(36).substring(2, 9),
      role,
      content: "", // Start empty, will be filled in chunks
      fullContent,
      timestamp: new Date(),
      isComplete: false,
    }
  }

  // Add a new message to the list (only if not already chunking)
  const addMessage = () => {
    if (isChunkingActive()) return // Don't add new messages while one is being chunked

    const newMessage = generateMessage()

    // Set the full content on the message but mark it as incomplete
    newMessage.content = "" // Start empty

    setMessages("data", messages.data.length, newMessage)

    // Start chunking this message

    setIsChunkingActive(true)
    startChunkingMessage(newMessage.id, newMessage.fullContent)
  }

  // Simulate chunked arrival for a specific message
  const startChunkingMessage = (messageId: string, fullContent: string) => {
    let currentIndex = 0
    const chunkSize = Math.floor(Math.random() * 5) + 1 // 1-5 characters per chunk

    const chunkInterval = setInterval(() => {
      setMessages(
        "data",
        produce((ms) => {
          const message = ms.find((m) => m.id === messageId)
          if (message) {
            message.content = fullContent.slice(0, currentIndex + chunkSize)
            message.isComplete = currentIndex + chunkSize >= fullContent.length
          }
        }),
      )

      currentIndex += chunkSize

      if (currentIndex >= fullContent.length) {
        clearInterval(chunkInterval)
        setIsChunkingActive(false) // Reset the flag
        // Immediately start the next message
        addMessage()
      }
    }, 16)
  }

  onMount(() => {
    setTimeout(addMessage, 500)
  })

  return (
    <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexGrow={1} maxHeight="100%">
      <box paddingBottom={1}>
        <text>
          <span style={{ fg: "#00ff00" }}>📨</span> <span style={{ fg: "#ffffff" }}>Live Message Stream</span>
        </text>
        <text fg="#666666">Messages arrive in chunks - watch them build character by character!</text>
      </box>

      <scrollbox
        scrollbarOptions={{ visible: true }}
        stickyScroll={true}
        stickyStart="bottom"
        paddingTop={1}
        paddingBottom={1}
        contentOptions={{
          flexGrow: 1,
          gap: 1,
        }}
      >
        <For each={messages.data}>{(message) => <MessageItem message={message} />}</For>
      </scrollbox>

      <box paddingTop={1}>
        <text fg="#666666">
          Messages: {messages.data.length} |{" "}
          <Show when={isChunkingActive()} fallback="Waiting for next message...">
            Receiving message...
          </Show>
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
        <text>
          <Show when={props.message.role === "user"} fallback={<span style={{ fg: "#0088ff" }}>🤖 Assistant</span>}>
            <span style={{ fg: "#00ff00" }}>👤 You</span>
          </Show>
        </text>
        <box flexGrow={1} />
        <text fg="#666666">{timeString()}</text>
      </box>

      <text>
        {props.message.content}
        <Show when={!props.message.isComplete} fallback={""}>
          <span style={{ fg: "#ffff00" }}>▊</span>
        </Show>
      </text>

      <Show when={!props.message.isComplete}>
        {() => {
          const progress = createMemo(() =>
            Math.round((props.message.content.length / props.message.fullContent!.length) * 100),
          )
          return (
            <text fg="#666666" paddingTop={0.5}>
              Receiving message... ({progress()}%)
            </text>
          )
        }}
      </Show>
    </box>
  )
}
