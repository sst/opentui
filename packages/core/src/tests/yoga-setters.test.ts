import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { Renderable, type RenderableOptions } from "../Renderable"
import { createTestRenderer, type TestRenderer } from "../testing/test-renderer"
import type { RenderContext } from "../types"

class TestRenderable extends Renderable {
  constructor(ctx: RenderContext, options: RenderableOptions) {
    super(ctx, options)
  }
}

let testRenderer: TestRenderer

beforeEach(async () => {
  ;({ renderer: testRenderer } = await createTestRenderer({}))
})

afterEach(() => {
  testRenderer.destroy()
})

describe("Yoga Prop Setters - flexGrow", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-grow" })
    expect(() => {
      renderable.flexGrow = 1
    }).not.toThrow()
  })

  test("accepts 0", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-grow-zero" })
    expect(() => {
      renderable.flexGrow = 0
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-grow-null" })
    expect(() => {
      renderable.flexGrow = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-grow-undefined" })
    expect(() => {
      renderable.flexGrow = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - flexShrink", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-shrink" })
    expect(() => {
      renderable.flexShrink = 1
    }).not.toThrow()
  })

  test("accepts 0", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-shrink-zero" })
    expect(() => {
      renderable.flexShrink = 0
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-shrink-null" })
    expect(() => {
      renderable.flexShrink = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-shrink-undefined" })
    expect(() => {
      renderable.flexShrink = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - flexDirection", () => {
  test("accepts valid string", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-direction" })
    expect(() => {
      renderable.flexDirection = "row"
    }).not.toThrow()
  })

  test("accepts all valid values", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-direction-all" })
    expect(() => {
      renderable.flexDirection = "column"
      renderable.flexDirection = "column-reverse"
      renderable.flexDirection = "row"
      renderable.flexDirection = "row-reverse"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-direction-null" })
    expect(() => {
      renderable.flexDirection = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-direction-undefined" })
    expect(() => {
      renderable.flexDirection = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - flexWrap", () => {
  test("accepts valid string", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-wrap" })
    expect(() => {
      renderable.flexWrap = "wrap"
    }).not.toThrow()
  })

  test("accepts all valid values", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-wrap-all" })
    expect(() => {
      renderable.flexWrap = "no-wrap"
      renderable.flexWrap = "wrap"
      renderable.flexWrap = "wrap-reverse"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-wrap-null" })
    expect(() => {
      renderable.flexWrap = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-wrap-undefined" })
    expect(() => {
      renderable.flexWrap = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - alignItems", () => {
  test("accepts valid string", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-align-items" })
    expect(() => {
      renderable.alignItems = "center"
    }).not.toThrow()
  })

  test("accepts all valid values", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-align-items-all" })
    expect(() => {
      renderable.alignItems = "auto"
      renderable.alignItems = "flex-start"
      renderable.alignItems = "center"
      renderable.alignItems = "flex-end"
      renderable.alignItems = "stretch"
      renderable.alignItems = "baseline"
      renderable.alignItems = "space-between"
      renderable.alignItems = "space-around"
      renderable.alignItems = "space-evenly"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-align-items-null" })
    expect(() => {
      renderable.alignItems = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-align-items-undefined" })
    expect(() => {
      renderable.alignItems = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - justifyContent", () => {
  test("accepts valid string", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-justify-content" })
    expect(() => {
      renderable.justifyContent = "center"
    }).not.toThrow()
  })

  test("accepts all valid values", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-justify-content-all" })
    expect(() => {
      renderable.justifyContent = "flex-start"
      renderable.justifyContent = "center"
      renderable.justifyContent = "flex-end"
      renderable.justifyContent = "space-between"
      renderable.justifyContent = "space-around"
      renderable.justifyContent = "space-evenly"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-justify-content-null" })
    expect(() => {
      renderable.justifyContent = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-justify-content-undefined" })
    expect(() => {
      renderable.justifyContent = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - alignSelf", () => {
  test("accepts valid string", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-align-self" })
    expect(() => {
      renderable.alignSelf = "center"
    }).not.toThrow()
  })

  test("accepts all valid values", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-align-self-all" })
    expect(() => {
      renderable.alignSelf = "auto"
      renderable.alignSelf = "flex-start"
      renderable.alignSelf = "center"
      renderable.alignSelf = "flex-end"
      renderable.alignSelf = "stretch"
      renderable.alignSelf = "baseline"
      renderable.alignSelf = "space-between"
      renderable.alignSelf = "space-around"
      renderable.alignSelf = "space-evenly"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-align-self-null" })
    expect(() => {
      renderable.alignSelf = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-align-self-undefined" })
    expect(() => {
      renderable.alignSelf = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - overflow", () => {
  test("accepts valid string", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-overflow" })
    expect(() => {
      renderable.overflow = "hidden"
    }).not.toThrow()
  })

  test("accepts all valid values", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-overflow-all" })
    expect(() => {
      renderable.overflow = "visible"
      renderable.overflow = "hidden"
      renderable.overflow = "scroll"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-overflow-null" })
    expect(() => {
      renderable.overflow = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-overflow-undefined" })
    expect(() => {
      renderable.overflow = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - position", () => {
  test("accepts valid string", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-position" })
    expect(() => {
      renderable.position = "absolute"
    }).not.toThrow()
  })

  test("accepts all valid values", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-position-all" })
    expect(() => {
      renderable.position = "static"
      renderable.position = "relative"
      renderable.position = "absolute"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-position-null" })
    expect(() => {
      renderable.position = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-position-undefined" })
    expect(() => {
      renderable.position = undefined
    }).not.toThrow()
  })
})
