import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer } from "@opentui/core/testing"
import React from "react"
import { render } from "./renderer"

let testRenderer: TestRenderer
let renderOnce: () => Promise<void>
let captureFrame: () => string

beforeEach(async () => {
  ;({
    renderer: testRenderer,
    renderOnce,
    captureCharFrame: captureFrame,
  } = await createTestRenderer({
    width: 50,
    height: 50,
  }))
})

test("renders scrollbox to text and snapshots after scrolling", async () => {
  await render(
    <box flexDirection="column">
      <text attributes={1} content="Box Examples" />
      <box border>
        <text content="1. Standard Box" />
      </box>
      <box border title="Title">
        <text content="2. Box with Title" />
      </box>
      <box border backgroundColor="blue">
        <text content="3. Box with Background Color" />
      </box>
      <box border padding={1}>
        <text content="4. Box with Padding" />
      </box>
      <box border margin={1}>
        <text content="5. Box with Margin" />
      </box>
      <box border alignItems="center">
        <text content="6. Centered Text" />
      </box>
      <box border justifyContent="center" height={5}>
        <text content="7. Justified Center" />
      </box>
      <box border title="Nested Boxes" backgroundColor="red">
        <box border backgroundColor="blue">
          <text content="8. Nested Box" />
        </box>
      </box>
    </box>,
    testRenderer,
  )
  await renderOnce()

  expect("\n" + captureFrame()).toMatchInlineSnapshot(`
    "
    Box Examples                                      
    ┌────────────────────────────────────────────────┐
    │1. Standard Box                                 │
    └────────────────────────────────────────────────┘
    ┌─Title──────────────────────────────────────────┐
    │2. Box with Title                               │
    └────────────────────────────────────────────────┘
    ┌────────────────────────────────────────────────┐
    │3. Box with Background Color                    │
    └────────────────────────────────────────────────┘
    ┌────────────────────────────────────────────────┐
    │                                                │
    │ 4. Box with Padding                            │
    │                                                │
    └────────────────────────────────────────────────┘
                                                      
     ┌──────────────────────────────────────────────┐ 
     │5. Box with Margin                            │ 
     └──────────────────────────────────────────────┘ 
                                                      
    ┌────────────────────────────────────────────────┐
    │                6. Centered Text                │
    └────────────────────────────────────────────────┘
    ┌────────────────────────────────────────────────┐
    │                                                │
    │7. Justified Center                             │
    │                                                │
    └────────────────────────────────────────────────┘
    ┌─Nested Boxes───────────────────────────────────┐
    │┌──────────────────────────────────────────────┐│
    ││8. Nested Box                                 ││
    │└──────────────────────────────────────────────┘│
    └────────────────────────────────────────────────┘
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
                                                      
    "
  `)
})
