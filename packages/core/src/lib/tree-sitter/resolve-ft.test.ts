import { test, expect } from "bun:test"
import { extensionToFiletype, infoStringToFiletype, pathToFiletype } from "./resolve-ft.js"

test("pathToFiletype only resolves actual paths", () => {
  expect(pathToFiletype("tsx")).toBeUndefined()
  expect(pathToFiletype("components/Button.tsx")).toBe("typescriptreact")
})

test("infoStringToFiletype normalizes markdown fence labels", () => {
  expect(infoStringToFiletype("tsx")).toBe("typescriptreact")
  expect(infoStringToFiletype("TSX title=Button.tsx")).toBe("typescriptreact")
  expect(infoStringToFiletype(".jsx")).toBe("javascriptreact")
  expect(infoStringToFiletype("Button.tsx")).toBe("typescriptreact")
})

test("extensionToFiletype can be extended by consumers", () => {
  const previous = extensionToFiletype.get("foo")

  try {
    extensionToFiletype.set("foo", "custom")
    expect(infoStringToFiletype("foo")).toBe("custom")
    expect(pathToFiletype("example.foo")).toBe("custom")
  } finally {
    if (previous === undefined) {
      extensionToFiletype.delete("foo")
    } else {
      extensionToFiletype.set("foo", previous)
    }
  }
})
