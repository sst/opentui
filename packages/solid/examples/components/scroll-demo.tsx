import { createMemo, For, Index } from "solid-js"

export const ScrollDemo = () => {
  const objectItems = createMemo(() => Array.from({ length: 1000 }).map((_, i) => ({ count: i + 1 })))

  return (
    <scrollbox
      style={{
        width: "100%",
        height: "100%",
        flexGrow: 1,
        rootOptions: {
          backgroundColor: "#24283b",
          border: true,
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
      <For each={objectItems()}>
        {(item) => (
          <box
            style={{
              width: "100%",
              padding: 1,
              marginBottom: 1,
              backgroundColor: item.count % 2 === 0 ? "#292e42" : "#2f3449",
            }}
          >
            <text content={`Box ${item.count}`} />
          </box>
        )}
      </For>
    </scrollbox>
  )
}

export const ScrollDemoIndex = () => {
  const primitiveItems = createMemo(() => Array.from({ length: 1000 }).map((_, i) => i + 1))

  return (
    <scrollbox
      style={{
        width: "100%",
        height: "100%",
        flexGrow: 1,
        rootOptions: {
          backgroundColor: "#24283b",
          border: true,
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
      <Index each={primitiveItems()}>
        {(item) => (
          <box
            style={{
              width: "100%",
              padding: 1,
              marginBottom: 1,
              backgroundColor: item() % 2 === 0 ? "#292e42" : "#2f3449",
            }}
          >
            <text content={`Box ${item()}`} />
          </box>
        )}
      </Index>
    </scrollbox>
  )
}
