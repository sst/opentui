import { render } from "@opentui/react"

export const App = () => {
  return (
    <scrollbox
      style={{
        rootOptions: {
          backgroundColor: "#24283b",
        },
        wrapperOptions: {
          backgroundColor: "#1f2335",
        },
        viewportOptions: {
          backgroundColor: "#1a1b26",
        },
        contentOptions: {
          backgroundColor: "#16161e",
        },
        scrollbarOptions: {
          showArrows: true,
          trackOptions: {
            foregroundColor: "#7aa2f7",
            backgroundColor: "#414868",
          },
        },
      }}
      focused
    >
      {Array.from({ length: 1000 }).map((_, i) => (
        <box
          key={i}
          style={{ width: "100%", padding: 1, marginBottom: 1, backgroundColor: i % 2 === 0 ? "#292e42" : "#2f3449" }}
        >
          <text content={`Box ${i}`} />
        </box>
      ))}
    </scrollbox>
  )
}

render(<App />)
