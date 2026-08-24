import { expect, test } from "bun:test"
import { setContentIfChanged } from "./native-highlighted-editor-demo.js"

test("unchanged frame status does not assign content again", () => {
  let assignmentCount = 0
  let stored = ""
  const target = {
    get content(): string {
      return stored
    },
    set content(value: string) {
      assignmentCount++
      stored = value
    },
  }

  let previous = setContentIfChanged(target, "same status", undefined)
  previous = setContentIfChanged(target, "same status", previous)
  previous = setContentIfChanged(target, "changed status", previous)

  expect(previous).toBe("changed status")
  expect(stored).toBe("changed status")
  expect(assignmentCount).toBe(2)
})
