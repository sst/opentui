import { render } from "@opentui/react"

export const App = () => {
  return (
    <>
      <group flexDirection="row">
        <box borderStyle="single">
          <text content="Single" />
        </box>
        <box borderStyle="double">
          <text content="Double" />
        </box>
        <box borderStyle="rounded">
          <text content="Rounded" />
        </box>
        <box borderStyle="heavy">
          <text content="Heavy" />
        </box>
      </group>
    </>
  )
}

render(<App />)
