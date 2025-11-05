import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

const LOREM = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Proin dictum rutrum mi, ac egestas elit dictum ac.",
  "Aliquam erat volutpat. Nullam in nisi vitae turpis consequat ultrices.",
  "Sed posuere pretium metus, a posuere est consequat nec.",
  "Curabitur nec quam sed augue congue vestibulum.",
  "Suspendisse tincidunt, augue at rhoncus cursus, urna felis malesuada leo.",
  "Nam molestie euismod faucibus. Quisque id odio in pede ornare luctus.",
  "Integer consequat, quam at congue cursus, magna eros pretium enim.",
  "Vivamus cursus, ex eu tincidunt cursus, libero massa dictum arcu.",
  "Morbi auctor magna a ultricies consequat.",
]

// Helper function that creates a random selection of `num` lines from LOREM
const getRandomLoremLines = (num: number) => {
  const lines: string[] = []
  for (let i = 0; i < num; i++) {
    const idx = Math.floor(Math.random() * LOREM.length)
    lines.push(LOREM[idx])
  }
  return lines
}

export const App = () => {
  // Let's use 16 boxes for variety and clarity
  const boxColors = [
    "#2e3440",
    "#bf616a",
    "#a3be8c",
    "#ebcb8b",
    "#81a1c1",
    "#b48ead",
    "#88c0d0",
    "#5e81ac",
    "#d08770",
    "#e5e9f0",
    "#414868",
    "#7aa2f7",
    "#292e42",
    "#373d52",
    "#24283b",
    "#cdd6f4",
  ]
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
      {Array.from({ length: 16 }).map((_, i) => {
        const numLines = 2 + Math.floor(Math.random() * 4) // 2 to 5 lines per box
        const lines = getRandomLoremLines(numLines)
        const bg = boxColors[i % boxColors.length]
        const borderColor = boxColors[(i + 1) % boxColors.length]
        return (
          <box
            key={i}
            style={{
              width: "100%",
              padding: 2,
              marginBottom: 2,
              backgroundColor: bg,
            }}
          >
            <text
              style={{
                marginBottom: 1,
              }}
              content={`Box ${i + 1}`}
            />
            {lines.map((txt, j) => (
              <text
                key={j}
                style={{
                  marginBottom: 0,
                }}
                content={txt}
              />
            ))}
          </box>
        )
      })}
    </scrollbox>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
