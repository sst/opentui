import { test, expect } from "bun:test"
import { installDOMShims } from "./index"

test("installDOMShims is idempotent", () => {
  const originalDocument = (globalThis as any).document

  installDOMShims()
  const firstDocument = (globalThis as any).document

  installDOMShims()
  const secondDocument = (globalThis as any).document

  expect(firstDocument).toBe(secondDocument)
})

test("installDOMShims installs global DOM objects", () => {
  installDOMShims()

  expect((globalThis as any).document).toBeDefined()
  expect((globalThis as any).Node).toBeDefined()
  expect((globalThis as any).Element).toBeDefined()
  expect((globalThis as any).HTMLElement).toBeDefined()
  expect((globalThis as any).Text).toBeDefined()
  expect((globalThis as any).Comment).toBeDefined()
  expect((globalThis as any).DocumentFragment).toBeDefined()
})

test("DOM shims have expected methods", () => {
  installDOMShims()

  const doc = (globalThis as any).document
  expect(typeof doc.createElement).toBe("function")
  expect(typeof doc.createTextNode).toBe("function")
  expect(typeof doc.createComment).toBe("function")
})
