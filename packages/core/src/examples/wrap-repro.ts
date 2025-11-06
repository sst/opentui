#!/usr/bin/env bun
// Delete when fixed

import { createCliRenderer, BoxRenderable, TextRenderable } from ".."
import { setupCommonDemoKeys } from "./lib/standalone-keys"

const loremText = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`

export function run(renderer: any): void {
  renderer.setBackgroundColor("#0a0a14")

  // This does not work as expected. The text should wrap at the box width but overflows when using flex.
  const box1 = new BoxRenderable(renderer, {
    id: "box1",
    width: "50%",
    alignItems: "flex-start",
    border: true,
    borderColor: "#ff0000",
  })
  renderer.root.add(box1)

  const text1 = new TextRenderable(renderer, {
    id: "text1",
    content: loremText,
    wrapMode: "word",
  })
  box1.add(text1)

  // This does work as expected.
  const box2 = new BoxRenderable(renderer, {
    id: "box2",
    width: "50%",
    border: true,
    borderColor: "#00ff00",
    marginTop: 2,
  })
  renderer.root.add(box2)

  const text2 = new TextRenderable(renderer, {
    id: "text2",
    content: loremText,
    wrapMode: "word",
  })
  box2.add(text2)
}

export function destroy(renderer: any): void {
  renderer.root.remove("box1")
  renderer.root.remove("box2")
}

if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  })

  run(renderer)
  setupCommonDemoKeys(renderer)
  renderer.start()
}
