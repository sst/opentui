import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockInput } from "../testing"
import { BoxRenderable } from "../renderables/Box"
import { collectFocusableDescendants, focusNext, focusPrev } from "./focus-traversal"

let renderer: TestRenderer

beforeEach(async () => {
  ;({ renderer } = await createTestRenderer({ width: 80, height: 24 }))
})

afterEach(() => {
  renderer.destroy()
})

test("collectFocusableDescendants - empty tree returns []", () => {
  const box = new BoxRenderable(renderer, { id: "empty", width: 10, height: 5 })
  renderer.root.add(box)

  expect(collectFocusableDescendants(box)).toEqual([])
})

test("collectFocusableDescendants - flat focusable children in layout order", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(renderer, { id: "b", width: 10, height: 3, focusable: true })
  const c = new BoxRenderable(renderer, { id: "c", width: 10, height: 3, focusable: true })
  parent.add(a)
  parent.add(b)
  parent.add(c)
  renderer.root.add(parent)

  const result = collectFocusableDescendants(parent)
  expect(result).toEqual([a, b, c])
})

test("collectFocusableDescendants - skips non-focusable children", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(renderer, { id: "b", width: 10, height: 3 }) // not focusable
  const c = new BoxRenderable(renderer, { id: "c", width: 10, height: 3, focusable: true })
  parent.add(a)
  parent.add(b)
  parent.add(c)
  renderer.root.add(parent)

  const result = collectFocusableDescendants(parent)
  expect(result).toEqual([a, c])
})

test("collectFocusableDescendants - nested tree in depth-first order", () => {
  const root = new BoxRenderable(renderer, { id: "root", width: 60, height: 20 })
  const group1 = new BoxRenderable(renderer, { id: "g1", width: 30, height: 10 })
  const child1a = new BoxRenderable(renderer, { id: "1a", width: 10, height: 3, focusable: true })
  const child1b = new BoxRenderable(renderer, { id: "1b", width: 10, height: 3, focusable: true })
  const group2 = new BoxRenderable(renderer, { id: "g2", width: 30, height: 10 })
  const child2a = new BoxRenderable(renderer, { id: "2a", width: 10, height: 3, focusable: true })

  group1.add(child1a)
  group1.add(child1b)
  group2.add(child2a)
  root.add(group1)
  root.add(group2)
  renderer.root.add(root)

  const result = collectFocusableDescendants(root)
  expect(result).toEqual([child1a, child1b, child2a])
})

test("collectFocusableDescendants - invisible children skipped", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(renderer, { id: "b", width: 10, height: 3, focusable: true, visible: false })
  const c = new BoxRenderable(renderer, { id: "c", width: 10, height: 3, focusable: true })
  parent.add(a)
  parent.add(b)
  parent.add(c)
  renderer.root.add(parent)

  const result = collectFocusableDescendants(parent)
  expect(result).toEqual([a, c])
})

test("focusNext - wraps at end", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(renderer, { id: "b", width: 10, height: 3, focusable: true })
  parent.add(a)
  parent.add(b)
  renderer.root.add(parent)

  expect(focusNext(parent, b)).toBe(a)
})

test("focusNext - null current returns first", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(renderer, { id: "b", width: 10, height: 3, focusable: true })
  parent.add(a)
  parent.add(b)
  renderer.root.add(parent)

  expect(focusNext(parent, null)).toBe(a)
})

test("focusNext - current not in tree returns first", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3, focusable: true })
  const outsider = new BoxRenderable(renderer, { id: "outsider", width: 10, height: 3, focusable: true })
  parent.add(a)
  renderer.root.add(parent)
  renderer.root.add(outsider)

  expect(focusNext(parent, outsider)).toBe(a)
})

test("focusPrev - wraps at start", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(renderer, { id: "b", width: 10, height: 3, focusable: true })
  parent.add(a)
  parent.add(b)
  renderer.root.add(parent)

  expect(focusPrev(parent, a)).toBe(b)
})

test("focusPrev - null current returns last", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3, focusable: true })
  const b = new BoxRenderable(renderer, { id: "b", width: 10, height: 3, focusable: true })
  parent.add(a)
  parent.add(b)
  renderer.root.add(parent)

  expect(focusPrev(parent, null)).toBe(b)
})

test("single focusable - focusNext and focusPrev return same element", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const only = new BoxRenderable(renderer, { id: "only", width: 10, height: 3, focusable: true })
  parent.add(only)
  renderer.root.add(parent)

  expect(focusNext(parent, only)).toBe(only)
  expect(focusPrev(parent, only)).toBe(only)
})

test("no focusable descendants - returns null", () => {
  const parent = new BoxRenderable(renderer, { id: "parent", width: 40, height: 10 })
  const a = new BoxRenderable(renderer, { id: "a", width: 10, height: 3 })
  parent.add(a)
  renderer.root.add(parent)

  expect(focusNext(parent, null)).toBe(null)
  expect(focusPrev(parent, null)).toBe(null)
})
