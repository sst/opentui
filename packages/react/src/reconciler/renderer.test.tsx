import { createTestRenderer, type MockInput, type TestRenderer } from "@opentui/core/testing"
import { beforeEach, expect, test } from "bun:test"
import { useState } from "react"
import { render } from "./renderer"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string
let mockInput: MockInput

beforeEach(async () => {
  ;({
    renderer: testRenderer,
    renderOnce,
    captureCharFrame: captureFrame,
    mockInput,
  } = await createTestRenderer({
    width: 40,
    height: 10,
  }))
})

test("renders input and box with state", async () => {
  const App = () => {
    const [text, setText] = useState("")

    return (
      <box flexDirection="column">
        <input focused placeholder="Type here..." onInput={setText} />
        <box border>
          <text content={text || "(empty)"} />
        </box>
      </box>
    )
  }

  await render(<App />, testRenderer)
  await renderOnce()

  expect("\n" + captureFrame().trim()).toMatchInlineSnapshot(`
    "
    ┌──────────────────────────────────────┐
    │(empty)                               │
    └──────────────────────────────────────┘"
  `)

  for (const letter of "hello") {
    mockInput.pressKey(letter)
  }
  await renderOnce()

  expect("\n" + captureFrame().trim()).toMatchInlineSnapshot(`
    "
    ┌──────────────────────────────────────┐
    │hello                                 │
    └──────────────────────────────────────┘"
  `)
  for (const letter of " world") {
    mockInput.pressKey(letter)
  }
  await renderOnce()

  expect("\n" + captureFrame().trim()).toMatchInlineSnapshot(`
    "
    ┌──────────────────────────────────────┐
    │hello world                           │
    └──────────────────────────────────────┘"
  `)
})
