import { test, expect, beforeEach, afterEach } from "bun:test"
import { createTestRenderer, type MockMouse, type TestRenderer } from "../testing"
import { ScrollBoxRenderable } from "../renderables/ScrollBox"
import { BoxRenderable } from "../renderables/Box"
import { Renderable } from "../Renderable"

let testRenderer: TestRenderer
let mockMouse: MockMouse

const hoverDebounceDelay = 40
const waitForHoverDebounce = async () => {
  await new Promise((resolve) => setTimeout(resolve, hoverDebounceDelay + 10))
}

class MovingBoxRenderable extends BoxRenderable {
  public shouldMove = false

  protected onUpdate(_deltaTime: number): void {
    if (this.shouldMove) {
      this.shouldMove = false
      this.translateY = 3
    }
  }
}

beforeEach(async () => {
  ;({ renderer: testRenderer, mockMouse } = await createTestRenderer({
    width: 50,
    height: 30,
    hoverDebounceDelay,
  }))
})

afterEach(() => {
  testRenderer.destroy()
})

test("hit grid updates after render when scrollbox scrolls", async () => {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 40,
    height: 20,
    scrollY: true,
  })
  testRenderer.root.add(scrollBox)

  const items: BoxRenderable[] = []
  for (let i = 0; i < 30; i++) {
    const item = new BoxRenderable(testRenderer, {
      id: `item-${i}`,
      height: 2,
      backgroundColor: i % 2 === 0 ? "red" : "blue",
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const item0 = items[0]
  const item4 = items[4]

  expect(item0.y).toBe(0)
  expect(item4.y).toBe(8)

  const checkHitAt = (x: number, y: number): Renderable | undefined => {
    const renderableId = testRenderer.hitTest(x, y)
    return Renderable.renderablesByNumber.get(renderableId)
  }

  let hitAtItem0 = checkHitAt(5, item0.y)
  expect(hitAtItem0?.id).toBe("item-0")

  let hitAtItem4 = checkHitAt(5, item4.y)
  expect(hitAtItem4?.id).toBe("item-4")

  scrollBox.scrollTop = 10

  expect(item0.y).toBe(-10)
  expect(item4.y).toBe(-2)

  const item5 = items[5]
  const item9 = items[9]

  expect(item5.y).toBe(0)
  expect(item9.y).toBe(8)

  // Hit grid updates after render
  await testRenderer.idle()

  const hitAtItem5 = checkHitAt(5, item5.y)
  expect(hitAtItem5?.id).toBe("item-5")

  const hitAtItem9 = checkHitAt(5, item9.y)
  expect(hitAtItem9?.id).toBe("item-9")
})

test("hover updates after scroll when pointer moves", async () => {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 20,
    height: 6,
    scrollY: true,
  })
  testRenderer.root.add(scrollBox)

  const hoverEvents: string[] = []
  let hoveredId: string | null = null

  const items: BoxRenderable[] = []
  for (let i = 0; i < 5; i++) {
    const itemId = `item-${i}`
    const item = new BoxRenderable(testRenderer, {
      id: itemId,
      width: "100%",
      height: 2,
      onMouseOver: () => {
        hoveredId = itemId
        hoverEvents.push(`over:${itemId}`)
      },
      onMouseOut: () => {
        if (hoveredId === itemId) {
          hoveredId = null
        }
        hoverEvents.push(`out:${itemId}`)
      },
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const pointerX = items[0].x + 1
  const pointerY = items[0].y + 1

  await mockMouse.moveTo(pointerX, pointerY)
  expect(hoveredId).toBe("item-0")
  expect(hoverEvents).toEqual(["over:item-0"])

  scrollBox.scrollTop = 2
  await testRenderer.idle()

  // Hover updates when pointer moves after scroll and render
  await mockMouse.moveTo(pointerX, pointerY)
  expect(hoveredId).toBe("item-1")
  expect(hoverEvents).toEqual(["over:item-0", "out:item-0", "over:item-1"])
})

test("hover updates after scroll without pointer movement", async () => {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 20,
    height: 6,
    scrollY: true,
  })
  testRenderer.root.add(scrollBox)

  const hoverEvents: string[] = []
  let hoveredId: string | null = null

  const items: BoxRenderable[] = []
  for (let i = 0; i < 5; i++) {
    const itemId = `item-${i}`
    const item = new BoxRenderable(testRenderer, {
      id: itemId,
      width: "100%",
      height: 2,
      onMouseOver: () => {
        hoveredId = itemId
        hoverEvents.push(`over:${itemId}`)
      },
      onMouseOut: () => {
        if (hoveredId === itemId) {
          hoveredId = null
        }
        hoverEvents.push(`out:${itemId}`)
      },
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const pointerX = items[0].x + 1
  const pointerY = items[0].y + 1

  await mockMouse.moveTo(pointerX, pointerY)
  expect(hoveredId).toBe("item-0")
  expect(hoverEvents).toEqual(["over:item-0"])

  scrollBox.scrollTop = 2
  await testRenderer.idle()
  await waitForHoverDebounce()

  expect(hoveredId).toBe("item-1")
  expect(hoverEvents).toEqual(["over:item-0", "out:item-0", "over:item-1"])
})

test("hover debounce coalesces rapid scroll changes", async () => {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 20,
    height: 6,
    scrollY: true,
  })
  testRenderer.root.add(scrollBox)

  const hoverEvents: string[] = []
  let hoveredId: string | null = null

  const items: BoxRenderable[] = []
  for (let i = 0; i < 5; i++) {
    const itemId = `item-${i}`
    const item = new BoxRenderable(testRenderer, {
      id: itemId,
      width: "100%",
      height: 2,
      onMouseOver: () => {
        hoveredId = itemId
        hoverEvents.push(`over:${itemId}`)
      },
      onMouseOut: () => {
        if (hoveredId === itemId) {
          hoveredId = null
        }
        hoverEvents.push(`out:${itemId}`)
      },
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const pointerX = items[0].x + 1
  const pointerY = items[0].y + 1

  await mockMouse.moveTo(pointerX, pointerY)
  expect(hoveredId).toBe("item-0")
  expect(hoverEvents).toEqual(["over:item-0"])

  scrollBox.scrollTop = 2
  await testRenderer.idle()
  await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.floor(hoverDebounceDelay / 2))))

  scrollBox.scrollTop = 4
  await testRenderer.idle()
  await waitForHoverDebounce()

  expect(hoveredId).toBe("item-2")
  expect(hoverEvents).toEqual(["over:item-0", "out:item-0", "over:item-2"])
})

test("mouse move cancels pending hover debounce", async () => {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 20,
    height: 6,
    scrollY: true,
  })
  testRenderer.root.add(scrollBox)

  const hoverEvents: string[] = []
  let hoveredId: string | null = null

  const items: BoxRenderable[] = []
  for (let i = 0; i < 5; i++) {
    const itemId = `item-${i}`
    const item = new BoxRenderable(testRenderer, {
      id: itemId,
      width: "100%",
      height: 2,
      onMouseOver: () => {
        hoveredId = itemId
        hoverEvents.push(`over:${itemId}`)
      },
      onMouseOut: () => {
        if (hoveredId === itemId) {
          hoveredId = null
        }
        hoverEvents.push(`out:${itemId}`)
      },
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const pointerX = items[0].x + 1
  const pointerY = items[0].y + 1

  await mockMouse.moveTo(pointerX, pointerY)
  expect(hoveredId).toBe("item-0")
  expect(hoverEvents).toEqual(["over:item-0"])

  scrollBox.scrollTop = 2
  await testRenderer.idle()

  await mockMouse.moveTo(pointerX, pointerY)
  expect(hoveredId).toBe("item-1")
  expect(hoverEvents).toEqual(["over:item-0", "out:item-0", "over:item-1"])

  await waitForHoverDebounce()
  expect(hoverEvents).toEqual(["over:item-0", "out:item-0", "over:item-1"])
})

test("hit grid handles multiple scroll operations correctly", async () => {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 40,
    height: 20,
    scrollY: true,
  })
  testRenderer.root.add(scrollBox)

  const items: BoxRenderable[] = []
  for (let i = 0; i < 40; i++) {
    const item = new BoxRenderable(testRenderer, {
      id: `item-${i}`,
      height: 2,
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const checkHitAt = (x: number, y: number): Renderable | undefined => {
    const renderableId = testRenderer.hitTest(x, y)
    return Renderable.renderablesByNumber.get(renderableId)
  }

  scrollBox.scrollTop = 20
  expect(items[10].y).toBe(0)
  await testRenderer.idle()
  let hit = checkHitAt(5, items[10].y)
  expect(hit?.id).toBe("item-10")

  scrollBox.scrollTop = 40
  expect(items[20].y).toBe(0)
  await testRenderer.idle()
  hit = checkHitAt(5, items[20].y)
  expect(hit?.id).toBe("item-20")

  scrollBox.scrollTop = 0
  expect(items[0].y).toBe(0)
  await testRenderer.idle()
  hit = checkHitAt(5, items[0].y)
  expect(hit?.id).toBe("item-0")
})

test("hit grid respects scrollbox viewport clipping when offset", async () => {
  const container = new BoxRenderable(testRenderer, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
  })
  testRenderer.root.add(container)

  const header = new BoxRenderable(testRenderer, {
    id: "header",
    height: 5,
    width: "100%",
  })
  container.add(header)

  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 40,
    height: 10,
    scrollY: true,
  })
  container.add(scrollBox)

  const items: BoxRenderable[] = []
  for (let i = 0; i < 10; i++) {
    const item = new BoxRenderable(testRenderer, {
      id: `item-${i}`,
      height: 2,
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const checkHitAt = (x: number, y: number): Renderable | undefined => {
    const renderableId = testRenderer.hitTest(x, y)
    return Renderable.renderablesByNumber.get(renderableId)
  }

  const headerHit = checkHitAt(2, header.y + 1)
  expect(headerHit?.id).toBe("header")

  scrollBox.scrollTop = 4
  await testRenderer.idle()

  const headerHitAfterScroll = checkHitAt(2, header.y + 1)
  expect(headerHitAfterScroll?.id).toBe("header")

  const viewportHit = checkHitAt(2, scrollBox.viewport.y + 1)
  expect(viewportHit?.id).toBe("item-2")
})

test("hover recheck skips while dragging captured renderable", async () => {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 20,
    height: 6,
    scrollY: true,
  })
  testRenderer.root.add(scrollBox)

  const hoverEvents: string[] = []

  const items: BoxRenderable[] = []
  for (let i = 0; i < 5; i++) {
    const itemId = `item-${i}`
    const item = new BoxRenderable(testRenderer, {
      id: itemId,
      width: "100%",
      height: 2,
      onMouseOver: () => {
        hoverEvents.push(`over:${itemId}`)
      },
      onMouseOut: () => {
        hoverEvents.push(`out:${itemId}`)
      },
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const pointerX = items[0].x + 1
  const pointerY = items[0].y + 1

  await mockMouse.moveTo(pointerX, pointerY)
  await mockMouse.pressDown(pointerX, pointerY)
  await mockMouse.moveTo(pointerX, pointerY)

  scrollBox.scrollTop = 2
  await testRenderer.idle()
  await waitForHoverDebounce()

  expect(hoverEvents).toEqual(["over:item-0"])
})

test("captured renderable is not in hit grid during scroll", async () => {
  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    width: 40,
    height: 10,
    scrollY: true,
  })
  testRenderer.root.add(scrollBox)

  const items: BoxRenderable[] = []
  for (let i = 0; i < 20; i++) {
    const item = new BoxRenderable(testRenderer, {
      id: `item-${i}`,
      height: 2,
    })
    items.push(item)
    scrollBox.add(item)
  }

  await testRenderer.idle()

  const pointerX = 2
  const pointerY = scrollBox.viewport.y + 1

  await mockMouse.pressDown(pointerX, pointerY)
  await mockMouse.moveTo(pointerX, pointerY + 1)

  scrollBox.scrollTop = 4
  await testRenderer.idle()

  const renderableId = testRenderer.hitTest(pointerX, pointerY)
  const hit = Renderable.renderablesByNumber.get(renderableId)
  expect(hit?.id).toBe("item-2")
})

test("hit grid stays clipped after render", async () => {
  const container = new BoxRenderable(testRenderer, {
    id: "container",
    width: 10,
    height: 4,
    overflow: "hidden",
  })
  testRenderer.root.add(container)

  const child = new BoxRenderable(testRenderer, {
    id: "child",
    width: 20,
    height: 4,
  })
  container.add(child)

  await testRenderer.idle()

  const insideHitId = testRenderer.hitTest(container.x + 1, container.y + 1)
  const insideHit = Renderable.renderablesByNumber.get(insideHitId)
  expect(insideHit?.id).toBe("child")

  const outsideHitId = testRenderer.hitTest(container.x + container.width + 1, container.y + 1)
  expect(outsideHitId).toBe(0)
})

test("buffered overflow scissor uses screen coordinates for hit grid", async () => {
  const container = new BoxRenderable(testRenderer, {
    id: "buffered-container",
    width: 10,
    height: 4,
    overflow: "hidden",
    buffered: true,
    position: "absolute",
    left: 10,
    top: 5,
  })
  testRenderer.root.add(container)

  const child = new BoxRenderable(testRenderer, {
    id: "buffered-child",
    width: 10,
    height: 4,
  })
  container.add(child)

  await testRenderer.idle()

  const hitId = testRenderer.hitTest(container.x + 1, container.y + 1)
  const hit = Renderable.renderablesByNumber.get(hitId)
  expect(hit?.id).toBe("buffered-child")
})

test("hover updates after translate animation", async () => {
  const hoverEvents: string[] = []
  let hoveredId: string | null = null

  const under = new BoxRenderable(testRenderer, {
    id: "under",
    position: "absolute",
    left: 2,
    top: 2,
    width: 6,
    height: 2,
    zIndex: 0,
    onMouseOver: () => {
      hoveredId = "under"
      hoverEvents.push("over:under")
    },
    onMouseOut: () => {
      if (hoveredId === "under") {
        hoveredId = null
      }
      hoverEvents.push("out:under")
    },
  })
  testRenderer.root.add(under)

  const moving = new MovingBoxRenderable(testRenderer, {
    id: "moving",
    position: "absolute",
    left: 2,
    top: 2,
    width: 6,
    height: 2,
    zIndex: 1,
    onMouseOver: () => {
      hoveredId = "moving"
      hoverEvents.push("over:moving")
    },
    onMouseOut: () => {
      if (hoveredId === "moving") {
        hoveredId = null
      }
      hoverEvents.push("out:moving")
    },
  })
  testRenderer.root.add(moving)

  await testRenderer.idle()

  const pointerX = moving.x + 1
  const pointerY = moving.y + 1

  await mockMouse.moveTo(pointerX, pointerY)
  expect(hoveredId).toBe("moving")
  expect(hoverEvents).toEqual(["over:moving"])

  moving.shouldMove = true
  moving.requestRender()
  await testRenderer.idle()
  await waitForHoverDebounce()

  expect(hoveredId).toBe("under")
  expect(hoverEvents).toEqual(["over:moving", "out:moving", "over:under"])
})

test("scrolling does not steal clicks outside the list", async () => {
  let lastClick = "none"

  const overlay = new BoxRenderable(testRenderer, {
    id: "overlay",
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    zIndex: 100,
    onMouseDown: () => {
      lastClick = "overlay"
    },
  })
  testRenderer.root.add(overlay)

  const dialog = new BoxRenderable(testRenderer, {
    id: "dialog",
    position: "absolute",
    left: 5,
    top: 4,
    width: 30,
    height: 14,
    flexDirection: "column",
    padding: 1,
    gap: 1,
    onMouseDown: (event) => {
      lastClick = "dialog"
      event.stopPropagation()
    },
  })
  overlay.add(dialog)

  const header = new BoxRenderable(testRenderer, {
    id: "dialog-header",
    width: "100%",
    height: 2,
    onMouseDown: (event) => {
      lastClick = "header"
      event.stopPropagation()
    },
  })
  dialog.add(header)

  const scrollBox = new ScrollBoxRenderable(testRenderer, {
    id: "dialog-scrollbox",
    width: "100%",
    height: 7,
    scrollY: true,
    onMouseDown: (event) => {
      lastClick = "scrollbox"
      event.stopPropagation()
    },
  })
  dialog.add(scrollBox)

  for (let i = 0; i < 20; i++) {
    const item = new BoxRenderable(testRenderer, {
      id: `line-${i}`,
      width: "100%",
      height: 1,
    })
    scrollBox.add(item)
  }

  await testRenderer.idle()

  await mockMouse.click(scrollBox.viewport.x + 1, scrollBox.viewport.y + 1)
  expect(lastClick).toBe("scrollbox")

  const headerClickY = header.y + 1
  const targetScrollTop = Math.max(1, scrollBox.viewport.y - headerClickY)
  scrollBox.scrollTop = targetScrollTop

  await mockMouse.click(header.x + 1, headerClickY)
  expect(lastClick).toBe("header")

  await mockMouse.click(dialog.x + 1, dialog.y - 1)
  expect(lastClick).toBe("overlay")

  await testRenderer.idle()
})
