import type { Renderable } from "../Renderable"

export function collectFocusableDescendants(root: Renderable): Renderable[] {
  const result: Renderable[] = []
  walkFocusable(root, result)
  return result
}

function walkFocusable(node: Renderable, result: Renderable[]): void {
  for (const child of node.getChildren()) {
    if (!child.visible) continue
    if (child.focusable) {
      result.push(child)
    }
    walkFocusable(child, result)
  }
}

export function nextFocusable(root: Renderable, current: Renderable | null): Renderable | null {
  const focusables = collectFocusableDescendants(root)
  if (focusables.length === 0) return null

  if (!current) return focusables[0]!

  const idx = focusables.indexOf(current)
  if (idx === -1) return focusables[0]!

  return focusables[(idx + 1) % focusables.length]!
}

export function prevFocusable(root: Renderable, current: Renderable | null): Renderable | null {
  const focusables = collectFocusableDescendants(root)
  if (focusables.length === 0) return null

  if (!current) return focusables[focusables.length - 1]!

  const idx = focusables.indexOf(current)
  if (idx === -1) return focusables[focusables.length - 1]!

  return focusables[(idx - 1 + focusables.length) % focusables.length]!
}

export function isDescendantOf(renderable: Renderable | null, ancestor: Renderable): boolean {
  let current: Renderable | null = renderable
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

export function findClosestKeyboardScope(node: Renderable): Renderable | null {
  let current: Renderable | null = node
  while (current) {
    if (current.trapFocus) return current
    current = current.parent
  }
  return null
}

export function getNextFocusTargetAfterRemoval(
  scope: Renderable,
  currentlyFocused: Renderable,
  removed: Renderable,
): Renderable | null {
  const focusables = collectFocusableDescendants(scope)
  const idx = focusables.indexOf(currentlyFocused)
  if (focusables.length <= 1) return null

  let nextTarget: Renderable | null = focusables[(idx + 1) % focusables.length] ?? null
  if (!nextTarget) return null

  if (nextTarget === currentlyFocused || nextTarget === removed || isDescendantOf(nextTarget, removed)) {
    nextTarget = focusables.find((f) => f !== currentlyFocused && f !== removed && !isDescendantOf(f, removed)) ?? null
  }

  return nextTarget
}
