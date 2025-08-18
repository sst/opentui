import { render } from "@opentui/react"

export const App = () => {
  return (
    <>
      <group flexDirection="column">
        <text attributes={1} content="Box Examples" />
        <box>
          <text content="1. Standard Box" />
        </box>
        <box title="Title">
          <text content="2. Box with Title" />
        </box>
        <box backgroundColor="blue">
          <text content="3. Box with Background Color" />
        </box>
        <box padding={1}>
          <text content="4. Box with Padding" />
        </box>
        <box margin={1}>
          <text content="5. Box with Margin" />
        </box>
        <box alignItems="center">
          <text content="6. Centered Text" />
        </box>
        <box justifyContent="center" height={5}>
          <text content="7. Justified Center" />
        </box>
        <box title="Nested Boxes" backgroundColor="red">
          <box backgroundColor="blue">
            <text content="8. Nested Box" />
          </box>
        </box>
      </group>
    </>
  )
}

render(<App />)
