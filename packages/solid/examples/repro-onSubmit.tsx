import { createSignal, Match, Show, Switch } from "solid-js"
import { createRoot, useKeyboard, useRenderer } from "@opentui/solid"
import { createCliRenderer } from "@opentui/core"

process.env.DEBUG = "true"

const InputTest = () => {
  const renderer = useRenderer()

  renderer.useConsole = true
  renderer.console.show()

  const [sig, setS] = createSignal(0)

  useKeyboard((key) => {
    if (key.name === "tab") {
      setS((s) => (s + 1) % 3)
    }
  })

  const onSubmit = () => {
    console.log("input")
  }

  return (
    <box border title="input">
      <Switch>
        <Match when={sig() === 0}>
          <box border title="input 0" height={3}>
            <input
              focused
              placeholder="input0"
              // onSubmit={onSubmit}
              onSubmit={() => {
                console.log("input 0")
              }}
            />
          </box>
        </Match>
        <Match when={sig() === 1}>
          <Show when={sig() > 0}>
            <box border title="input 1" height={3}>
              <input
                focused
                placeholder="input1"
                // onSubmit={onSubmit}
                onSubmit={() => {
                  console.log("input 1")
                }}
              />
            </box>
          </Show>
        </Match>
        <Match when={sig() === 2}>
          <box border title="input 2" height={3}>
            <input
              focused
              placeholder="input2"
              // onSubmit={onSubmit}
              onSubmit={() => {
                console.log("input 2")
              }}
            />
          </box>
        </Match>
      </Switch>
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(InputTest)
