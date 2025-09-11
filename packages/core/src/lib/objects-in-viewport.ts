import type { ViewportBounds } from "../types"

interface ViewportObject {
  x: number
  y: number
  width: number
  height: number
  zIndex: number
}

export function getObjectsInViewport<T extends ViewportObject>(
  viewport: ViewportBounds,
  objects: T[],
  direction: "row" | "column" = "column",
  padding: number = 10,
  minTriggerSize: number = 16,
): T[] {
  if (objects.length < minTriggerSize) return objects

  const viewportTop = viewport.y - padding
  const viewportBottom = viewport.y + viewport.height + padding
  const viewportLeft = viewport.x - padding
  const viewportRight = viewport.x + viewport.width + padding

  const isRow = direction === "row"

  const children = objects
  const totalChildren = children.length
  if (totalChildren === 0) return []

  const vpStart = isRow ? viewportLeft : viewportTop
  const vpEnd = isRow ? viewportRight : viewportBottom

  // Binary search to find any child that overlaps along the primary axis
  let lo = 0
  let hi = totalChildren - 1
  let candidate = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = children[mid]
    const start = isRow ? c.x : c.y
    const end = isRow ? c.x + c.width : c.y + c.height

    if (end < vpStart) {
      lo = mid + 1 // before viewport along axis
    } else if (start > vpEnd) {
      hi = mid - 1 // after viewport along axis
    } else {
      candidate = mid
      break
    }
  }

  const visibleChildren: T[] = []
  if (candidate === -1) {
    return visibleChildren
  }

  let left = candidate
  while (left - 1 >= 0) {
    const prev = children[left - 1]
    if ((isRow ? prev.x + prev.width : prev.y + prev.height) < vpStart) break
    left--
  }

  let right = candidate + 1
  while (right < totalChildren) {
    const next = children[right]
    if ((isRow ? next.x : next.y) > vpEnd) break
    right++
  }

  // Collect candidates that also overlap on the cross axis
  for (let i = left; i < right; i++) {
    const child = children[i]

    if (isRow) {
      const childBottom = child.y + child.height
      if (childBottom < viewportTop) continue
      const childTop = child.y
      if (childTop > viewportBottom) continue
    } else {
      const childRight = child.x + child.width
      if (childRight < viewportLeft) continue
      const childLeft = child.x
      if (childLeft > viewportRight) continue
    }

    visibleChildren.push(child)
  }

  // At this point there should be not a lot of children, so this should be fast
  if (visibleChildren.length > 1) {
    visibleChildren.sort((a, b) => (a.zIndex > b.zIndex ? 1 : a.zIndex < b.zIndex ? -1 : 0))
  }

  return visibleChildren
}
