import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../testing"
import { BoxRenderable } from "../renderables/Box"
import { KeyEvent } from "../lib/KeyHandler"

let testRenderer: TestRenderer
let mockInput: MockInput
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer: testRenderer, mockInput, renderOnce } = await createTestRenderer({ width: 80, height: 24 }))
})

afterEach(() => {
  testRenderer.destroy()
})

const createScope = (options: ConstructorParameters<typeof BoxRenderable>[1]): BoxRenderable =>
  new BoxRenderable(testRenderer, {
    backgroundColor: "transparent",
    shouldFill: false,
    trapFocus: true,
    autoFocus: true,
    ...options,
  })

// ═══════════════════════════════════════════════════════════════════════════════
// Keyboard isolation
// ═══════════════════════════════════════════════════════════════════════════════

test("scope intercepts all keys - global handler does not fire", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalEvents.push(key.name)
  })

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  mockInput.pressKey("a")

  expect(globalEvents).toEqual([])
})

test("listener fires for every keystroke", () => {
  const received: string[] = []

  const scope = createScope({
    id: "scope",
    width: 40,
    height: 10,
  })
  scope.on("keypress", (key) => received.push(key.name))
  testRenderer.root.add(scope)

  mockInput.pressKey("a")
  mockInput.pressKey("b")
  mockInput.pressKey("j")

  expect(received).toEqual(["a", "b", "j"])
})

test("keys forwarded correctly - modifiers preserved", () => {
  let captured: KeyEvent | null = null

  const scope = createScope({
    id: "scope",
    width: 40,
    height: 10,
  })
  scope.on("keypress", (key) => {
    captured = key
  })
  testRenderer.root.add(scope)

  mockInput.pressKey("a", { shift: true })

  expect(captured).not.toBeNull()
  expect(captured!.name).toBe("a")
  expect(captured!.shift).toBe(true)
})

test("special keys isolated - return, arrows", () => {
  const scopeKeys: string[] = []
  const globalKeys: string[] = []

  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalKeys.push(key.name)
  })

  const scope = createScope({
    id: "scope",
    width: 40,
    height: 10,
  })
  scope.on("keypress", (key) => scopeKeys.push(key.name))
  testRenderer.root.add(scope)

  mockInput.pressEnter()
  mockInput.pressArrow("up")
  mockInput.pressArrow("down")

  expect(scopeKeys).toEqual(["return", "up", "down"])
  expect(globalKeys).toEqual([])
})

// ═══════════════════════════════════════════════════════════════════════════════
// Ctrl+C passthrough
// ═══════════════════════════════════════════════════════════════════════════════

test("ctrl+c not intercepted - passes through to handlers outside scope", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      globalEvents.push("ctrl-c")
    }
  })

  const scope = createScope({
    id: "scope",
    width: 40,
    height: 10,
  })
  testRenderer.root.add(scope)

  mockInput.pressKey("c", { ctrl: true })

  expect(globalEvents).toEqual(["ctrl-c"])
})

// ═══════════════════════════════════════════════════════════════════════════════
// Scope lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

test("activation on construction - immediately intercepts", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalEvents.push(key.name)
  })

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  mockInput.pressKey("x")
  expect(globalEvents).toEqual([])
})

test("deactivation on destroy - outer handlers resume", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalEvents.push(key.name)
  })

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  mockInput.pressKey("a")
  expect(globalEvents).toEqual([])

  scope.destroy()

  mockInput.pressKey("b")
  expect(globalEvents).toEqual(["b"])
})

test("deactivation on remove - outer handlers resume", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalEvents.push(key.name)
  })

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  mockInput.pressKey("a")
  expect(globalEvents).toEqual([])

  testRenderer.root.remove(scope.id)

  mockInput.pressKey("b")
  expect(globalEvents).toEqual(["b"])
})

test("re-activation - new scope works after old destroyed", () => {
  const events: string[] = []

  const scope1 = createScope({
    id: "scope1",
    width: 40,
    height: 10,
  })
  scope1.on("keypress", (key) => events.push(`s1:${key.name}`))
  testRenderer.root.add(scope1)
  mockInput.pressKey("a")
  scope1.destroy()

  const scope2 = createScope({
    id: "scope2",
    width: 40,
    height: 10,
  })
  scope2.on("keypress", (key) => events.push(`s2:${key.name}`))
  testRenderer.root.add(scope2)
  mockInput.pressKey("b")

  expect(events).toEqual(["s1:a", "s2:b"])
})

// ═══════════════════════════════════════════════════════════════════════════════
// Nested scopes
// ═══════════════════════════════════════════════════════════════════════════════

test("inner scope has priority - only innermost listener fires", () => {
  const events: string[] = []

  const outer = createScope({
    id: "outer",
    width: 60,
    height: 20,
  })
  outer.on("keypress", (key) => events.push(`outer:${key.name}`))
  testRenderer.root.add(outer)

  const inner = createScope({
    id: "inner",
    width: 30,
    height: 10,
  })
  inner.on("keypress", (key) => events.push(`inner:${key.name}`))
  outer.add(inner)

  mockInput.pressKey("x")

  expect(events).toEqual(["inner:x"])
})

test("outer scope resumes after inner removed", () => {
  const events: string[] = []

  const outer = createScope({
    id: "outer",
    width: 60,
    height: 20,
  })
  outer.on("keypress", (key) => events.push(`outer:${key.name}`))
  testRenderer.root.add(outer)

  const inner = createScope({
    id: "inner",
    width: 30,
    height: 10,
  })
  inner.on("keypress", (key) => events.push(`inner:${key.name}`))
  outer.add(inner)

  mockInput.pressKey("a")
  inner.destroy()
  mockInput.pressKey("b")

  expect(events).toEqual(["inner:a", "outer:b"])
})

test("three levels deep - deepest fires, then middle, then outer", () => {
  const events: string[] = []

  const outer = createScope({
    id: "outer",
    width: 70,
    height: 20,
  })
  outer.on("keypress", (key) => events.push(`outer:${key.name}`))
  testRenderer.root.add(outer)

  const middle = createScope({
    id: "middle",
    width: 50,
    height: 15,
  })
  middle.on("keypress", (key) => events.push(`middle:${key.name}`))
  outer.add(middle)

  const deep = createScope({
    id: "deep",
    width: 30,
    height: 10,
  })
  deep.on("keypress", (key) => events.push(`deep:${key.name}`))
  middle.add(deep)

  mockInput.pressKey("1")
  deep.destroy()
  mockInput.pressKey("2")
  middle.destroy()
  mockInput.pressKey("3")

  expect(events).toEqual(["deep:1", "middle:2", "outer:3"])
})

// ═══════════════════════════════════════════════════════════════════════════════
// Tab navigation
// ═══════════════════════════════════════════════════════════════════════════════

test("tab cycles forward through focusable children", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  const c = new BoxRenderable(testRenderer, { id: "c", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  scope.add(c)
  testRenderer.root.add(scope)

  // Auto-focus should focus first child
  await renderOnce()

  expect(a.focused).toBe(true)

  mockInput.pressTab()
  expect(b.focused).toBe(true)

  mockInput.pressTab()
  expect(c.focused).toBe(true)
})

test("shift+tab cycles backward", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  const c = new BoxRenderable(testRenderer, { id: "c", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  scope.add(c)
  testRenderer.root.add(scope)

  await renderOnce()
  expect(a.focused).toBe(true)

  // Shift+Tab is \x1b[Z in standard terminals
  testRenderer.stdin.emit("data", Buffer.from("\x1b[Z"))
  expect(c.focused).toBe(true)
})

test("tab wraps at end - last to first", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  testRenderer.root.add(scope)

  await renderOnce()
  expect(a.focused).toBe(true)

  mockInput.pressTab()
  expect(b.focused).toBe(true)

  mockInput.pressTab()
  expect(a.focused).toBe(true)
})

test("shift+tab wraps at start - first to last", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  testRenderer.root.add(scope)

  await renderOnce()
  expect(a.focused).toBe(true)

  // Shift+Tab is \x1b[Z in standard terminals
  testRenderer.stdin.emit("data", Buffer.from("\x1b[Z"))
  expect(b.focused).toBe(true)
})

test("tab with single focusable - focus stays", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const only = new BoxRenderable(testRenderer, { id: "only", width: 10, height: 3, focusable: true })
  scope.add(only)
  testRenderer.root.add(scope)

  await renderOnce()
  expect(only.focused).toBe(true)

  mockInput.pressTab()
  expect(only.focused).toBe(true)
})

test("tab with no focusable children - no crash", () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const plain = new BoxRenderable(testRenderer, { id: "plain", width: 10, height: 3 })
  scope.add(plain)
  testRenderer.root.add(scope)

  expect(() => mockInput.pressTab()).not.toThrow()
})

test("tab skips invisible children", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true, visible: false })
  const c = new BoxRenderable(testRenderer, { id: "c", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  scope.add(c)
  testRenderer.root.add(scope)

  await renderOnce()
  expect(a.focused).toBe(true)

  mockInput.pressTab()
  expect(c.focused).toBe(true)
})

// ═══════════════════════════════════════════════════════════════════════════════
// trapFocus option
// ═══════════════════════════════════════════════════════════════════════════════

test("trapFocus=true (default) - keys isolated", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalEvents.push(key.name)
  })

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  mockInput.pressKey("j")
  mockInput.pressKey("k")

  expect(globalEvents).toEqual([])
})

test("trapFocus=false - keys not isolated, event passes through", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalEvents.push(key.name)
  })

  const scope = createScope({
    id: "scope",
    width: 40,
    height: 10,
    trapFocus: false,
  })
  testRenderer.root.add(scope)

  mockInput.pressKey("j")

  expect(globalEvents).toEqual(["j"])
})

// ═══════════════════════════════════════════════════════════════════════════════
// autoFocus option
// ═══════════════════════════════════════════════════════════════════════════════

test("autoFocus=true (default) - first focusable child receives focus", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  testRenderer.root.add(scope)

  // Auto-focus is deferred to first onUpdate
  await renderOnce()

  expect(a.focused).toBe(true)
})

test("autoFocus=false - no automatic focus on mount", async () => {
  const scope = createScope({
    id: "scope",
    width: 60,
    height: 20,
    autoFocus: false,
  })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  scope.add(a)
  testRenderer.root.add(scope)

  await renderOnce()

  expect(a.focused).toBe(false)
})

test("autoFocus does not steal focus from already-focused descendant", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  testRenderer.root.add(scope)

  // Manually focus b before onUpdate runs
  b.focus()
  expect(b.focused).toBe(true)

  await renderOnce()

  // autoFocus should not override manually set focus
  expect(b.focused).toBe(true)
  expect(a.focused).toBe(false)
})

test("autoFocus with no focusable children - no crash", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const plain = new BoxRenderable(testRenderer, { id: "plain", width: 10, height: 3 })
  scope.add(plain)
  testRenderer.root.add(scope)

  expect(() => renderOnce()).not.toThrow()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Focus save/restore
// ═══════════════════════════════════════════════════════════════════════════════

test("focus restored on scope destroy", () => {
  const box = new BoxRenderable(testRenderer, { id: "box", width: 10, height: 3, focusable: true })
  testRenderer.root.add(box)
  box.focus()
  expect(testRenderer.currentFocusedRenderable).toBe(box)

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  scope.destroy()
  expect(testRenderer.currentFocusedRenderable).toBe(box)
  expect(box.focused).toBe(true)
})

test("focus restored on scope remove", () => {
  const box = new BoxRenderable(testRenderer, { id: "box", width: 10, height: 3, focusable: true })
  testRenderer.root.add(box)
  box.focus()

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  testRenderer.root.remove(scope.id)
  expect(testRenderer.currentFocusedRenderable).toBe(box)
  expect(box.focused).toBe(true)
})

test("nested scope restore - inner restores to outer's focus", async () => {
  const outer = createScope({ id: "outer", width: 60, height: 20 })
  const outerBox = new BoxRenderable(testRenderer, { id: "outer-box", width: 10, height: 3, focusable: true })
  outer.add(outerBox)
  testRenderer.root.add(outer)

  await renderOnce()
  expect(testRenderer.currentFocusedRenderable).toBe(outerBox)

  const inner = createScope({ id: "inner", width: 30, height: 10 })
  const innerBox = new BoxRenderable(testRenderer, { id: "inner-box", width: 10, height: 3, focusable: true })
  inner.add(innerBox)
  outer.add(inner)

  await renderOnce()
  expect(testRenderer.currentFocusedRenderable).toBe(innerBox)

  inner.destroy()
  expect(testRenderer.currentFocusedRenderable).toBe(outerBox)
  expect(outerBox.focused).toBe(true)
})

test("scope does not intercept keys before mount", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalEvents.push(key.name)
  })

  // Not added to tree on purpose.
  createScope({ id: "scope", width: 40, height: 10 })
  mockInput.pressKey("a")

  expect(globalEvents).toEqual(["a"])
})

test("scope teardown does not restore destroyed saved focus", () => {
  const box = new BoxRenderable(testRenderer, { id: "box", width: 10, height: 3, focusable: true })
  testRenderer.root.add(box)
  box.focus()

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  box.destroy()
  scope.destroy()

  expect(testRenderer.currentFocusedRenderable).toBeNull()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

test("scope with no children - keyboard isolation still works", () => {
  const globalEvents: string[] = []
  testRenderer.keyInput.on("keypress", (key: KeyEvent) => {
    globalEvents.push(key.name)
  })

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  testRenderer.root.add(scope)

  mockInput.pressKey("a")
  mockInput.pressTab()

  expect(globalEvents).toEqual([])
})

test("dynamic children - added after mount participate in tab cycle", async () => {
  const scope = createScope({ id: "scope", width: 60, height: 20 })
  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  scope.add(a)
  testRenderer.root.add(scope)

  await renderOnce()
  expect(a.focused).toBe(true)

  // Add a new focusable child
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  scope.add(b)

  mockInput.pressTab()
  expect(b.focused).toBe(true)
})

test("focused child removed - focus moves to next available", () => {
  const scope = createScope({
    id: "scope",
    width: 40,
    height: 10,
    autoFocus: false,
  })

  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  const c = new BoxRenderable(testRenderer, { id: "c", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  scope.add(c)
  testRenderer.root.add(scope)

  // Focus the middle child
  b.focus()
  expect(b.focused).toBe(true)

  // Remove the focused child — focus should move to next available
  scope.remove(b.id)
  expect(c.focused).toBe(true)
})

test("focused child removed when last - focus wraps to first", () => {
  const scope = createScope({
    id: "scope",
    width: 40,
    height: 10,
    autoFocus: false,
  })

  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(testRenderer, { id: "b", width: 10, height: 3, focusable: true })
  scope.add(a)
  scope.add(b)
  testRenderer.root.add(scope)

  // Focus the last child
  b.focus()
  expect(b.focused).toBe(true)

  // Remove the focused child — focus should wrap to first
  scope.remove(b.id)
  expect(a.focused).toBe(true)
})

test("focused child removed when only focusable - no crash", () => {
  const scope = createScope({
    id: "scope",
    width: 40,
    height: 10,
    autoFocus: false,
  })

  const a = new BoxRenderable(testRenderer, { id: "a", width: 10, height: 3, focusable: true })
  scope.add(a)
  testRenderer.root.add(scope)

  a.focus()
  expect(a.focused).toBe(true)

  // Remove the only focusable child — should not crash
  scope.remove(a.id)
  // No focusable children left — nothing to focus
})

test("multiple scopes at same level - last mounted is topmost", () => {
  const events: string[] = []

  const scope1 = createScope({
    id: "scope1",
    width: 40,
    height: 10,
  })
  scope1.on("keypress", (key) => events.push(`s1:${key.name}`))
  testRenderer.root.add(scope1)

  const scope2 = createScope({
    id: "scope2",
    width: 40,
    height: 10,
  })
  scope2.on("keypress", (key) => events.push(`s2:${key.name}`))
  testRenderer.root.add(scope2)

  mockInput.pressKey("x")

  // Only the last mounted scope (scope2) should respond
  expect(events).toEqual(["s2:x"])
})

test("scope handler does not fire for non-topmost scope", () => {
  const events: string[] = []

  const scope1 = createScope({
    id: "scope1",
    width: 40,
    height: 10,
  })
  scope1.on("keypress", (key) => events.push(`s1:${key.name}`))
  testRenderer.root.add(scope1)

  const scope2 = createScope({
    id: "scope2",
    width: 40,
    height: 10,
  })
  scope2.on("keypress", (key) => events.push(`s2:${key.name}`))
  testRenderer.root.add(scope2)

  mockInput.pressKey("a")
  mockInput.pressKey("b")

  // scope1 should never fire because scope2 stops propagation
  expect(events).toEqual(["s2:a", "s2:b"])
  expect(events.some((e) => e.startsWith("s1:"))).toBe(false)
})

// ═══════════════════════════════════════════════════════════════════════════════
// EventEmitter API
// ═══════════════════════════════════════════════════════════════════════════════

test("off removes listener", () => {
  const events: string[] = []

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  const handler = (key: KeyEvent) => events.push(key.name)
  scope.on("keypress", handler)
  testRenderer.root.add(scope)

  mockInput.pressKey("a")
  scope.off("keypress", handler)
  mockInput.pressKey("b")

  expect(events).toEqual(["a"])
})

test("multiple listeners all fire", () => {
  const events1: string[] = []
  const events2: string[] = []

  const scope = createScope({ id: "scope", width: 40, height: 10 })
  scope.on("keypress", (key) => events1.push(key.name))
  scope.on("keypress", (key) => events2.push(key.name))
  testRenderer.root.add(scope)

  mockInput.pressKey("x")

  expect(events1).toEqual(["x"])
  expect(events2).toEqual(["x"])
})
