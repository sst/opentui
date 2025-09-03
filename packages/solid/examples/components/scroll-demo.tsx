export const ScrollDemo = () => {
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
          thumbOptions: {
            backgroundColor: "#7aa2f7",
          },
          trackOptions: {
            backgroundColor: "#414868",
          },
        },
      }}
      focused
    >
      {Array.from({ length: 1000 }).map((_, i) => (
        <box
          style={{ width: "100%", padding: 1, marginBottom: 1, backgroundColor: i % 2 === 0 ? "#292e42" : "#2f3449" }}
        >
          <text content={`Box ${i}`} />
        </box>
      ))}
    </scrollbox>
  )
}
