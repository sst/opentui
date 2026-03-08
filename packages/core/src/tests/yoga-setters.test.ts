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

describe("Yoga Prop Setters - flexBasis", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-basis" })
    expect(() => {
      renderable.flexBasis = 100
    }).not.toThrow()
  })

  test("accepts auto", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-basis-auto" })
    expect(() => {
      renderable.flexBasis = "auto"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-basis-null" })
    expect(() => {
      renderable.flexBasis = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-flex-basis-undefined" })
    expect(() => {
      renderable.flexBasis = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - minWidth", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-min-width" })
    expect(() => {
      renderable.minWidth = 100
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-min-width-percent" })
    expect(() => {
      renderable.minWidth = "50%"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-min-width-null" })
    expect(() => {
      renderable.minWidth = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-min-width-undefined" })
    expect(() => {
      renderable.minWidth = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - maxWidth", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-max-width" })
    expect(() => {
      renderable.maxWidth = 100
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-max-width-percent" })
    expect(() => {
      renderable.maxWidth = "50%"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-max-width-null" })
    expect(() => {
      renderable.maxWidth = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-max-width-undefined" })
    expect(() => {
      renderable.maxWidth = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - minHeight", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-min-height" })
    expect(() => {
      renderable.minHeight = 100
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-min-height-percent" })
    expect(() => {
      renderable.minHeight = "50%"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-min-height-null" })
    expect(() => {
      renderable.minHeight = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-min-height-undefined" })
    expect(() => {
      renderable.minHeight = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - maxHeight", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-max-height" })
    expect(() => {
      renderable.maxHeight = 100
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-max-height-percent" })
    expect(() => {
      renderable.maxHeight = "50%"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-max-height-null" })
    expect(() => {
      renderable.maxHeight = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-max-height-undefined" })
    expect(() => {
      renderable.maxHeight = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - margin", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin" })
    expect(() => {
      renderable.margin = 10
    }).not.toThrow()
  })

  test("accepts auto", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-auto" })
    expect(() => {
      renderable.margin = "auto"
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-percent" })
    expect(() => {
      renderable.margin = "10%"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-null" })
    expect(() => {
      renderable.margin = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-undefined" })
    expect(() => {
      renderable.margin = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - marginX", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-x" })
    expect(() => {
      renderable.marginX = 10
    }).not.toThrow()
  })
  test("accepts auto", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-x-auto" })
    expect(() => {
      renderable.marginX = "auto"
    }).not.toThrow()
  })
  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-x-percent" })
    expect(() => {
      renderable.marginX = "10%"
    }).not.toThrow()
  })
  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-x-null" })
    expect(() => {
      renderable.marginX = null
    }).not.toThrow()
  })
  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-x-undefined" })
    expect(() => {
      renderable.marginX = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - marginY", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-y" })
    expect(() => {
      renderable.marginY = 10
    }).not.toThrow()
  })
  test("accepts auto", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-y-auto" })
    expect(() => {
      renderable.marginY = "auto"
    }).not.toThrow()
  })
  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-y-percent" })
    expect(() => {
      renderable.marginY = "10%"
    }).not.toThrow()
  })
  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-y-null" })
    expect(() => {
      renderable.marginY = null
    }).not.toThrow()
  })
  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-y-undefined" })
    expect(() => {
      renderable.marginY = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - marginTop", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-top" })
    expect(() => {
      renderable.marginTop = 10
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-top-null" })
    expect(() => {
      renderable.marginTop = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-top-undefined" })
    expect(() => {
      renderable.marginTop = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - marginRight", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-right" })
    expect(() => {
      renderable.marginRight = 10
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-right-null" })
    expect(() => {
      renderable.marginRight = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-right-undefined" })
    expect(() => {
      renderable.marginRight = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - marginBottom", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-bottom" })
    expect(() => {
      renderable.marginBottom = 10
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-bottom-null" })
    expect(() => {
      renderable.marginBottom = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-bottom-undefined" })
    expect(() => {
      renderable.marginBottom = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - marginLeft", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-left" })
    expect(() => {
      renderable.marginLeft = 10
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-left-null" })
    expect(() => {
      renderable.marginLeft = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-margin-left-undefined" })
    expect(() => {
      renderable.marginLeft = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - padding", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding" })
    expect(() => {
      renderable.padding = 10
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-percent" })
    expect(() => {
      renderable.padding = "10%"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-null" })
    expect(() => {
      renderable.padding = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-undefined" })
    expect(() => {
      renderable.padding = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - paddingX", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-x" })
    expect(() => {
      renderable.paddingX = 10
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-x-percent" })
    expect(() => {
      renderable.paddingX = "10%"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-x-null" })
    expect(() => {
      renderable.paddingX = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-x-undefined" })
    expect(() => {
      renderable.paddingX = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - paddingY", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-y" })
    expect(() => {
      renderable.paddingY = 10
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-y-percent" })
    expect(() => {
      renderable.paddingY = "10%"
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-y-null" })
    expect(() => {
      renderable.paddingY = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-y-undefined" })
    expect(() => {
      renderable.paddingY = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - paddingTop", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-top" })
    expect(() => {
      renderable.paddingTop = 10
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-top-null" })
    expect(() => {
      renderable.paddingTop = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-top-undefined" })
    expect(() => {
      renderable.paddingTop = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - paddingRight", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-right" })
    expect(() => {
      renderable.paddingRight = 10
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-right-null" })
    expect(() => {
      renderable.paddingRight = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-right-undefined" })
    expect(() => {
      renderable.paddingRight = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - paddingBottom", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-bottom" })
    expect(() => {
      renderable.paddingBottom = 10
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-bottom-null" })
    expect(() => {
      renderable.paddingBottom = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-bottom-undefined" })
    expect(() => {
      renderable.paddingBottom = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - paddingLeft", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-left" })
    expect(() => {
      renderable.paddingLeft = 10
    }).not.toThrow()
  })

  test("accepts null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-left-null" })
    expect(() => {
      renderable.paddingLeft = null
    }).not.toThrow()
  })

  test("accepts undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-padding-left-undefined" })
    expect(() => {
      renderable.paddingLeft = undefined
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - width", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-width" })
    expect(() => {
      renderable.width = 100
    }).not.toThrow()
  })

  test("accepts auto", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-width-auto" })
    expect(() => {
      renderable.width = "auto"
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-width-percent" })
    expect(() => {
      renderable.width = "50%"
    }).not.toThrow()
  })

  test("handles null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-width-null" })
    expect(() => {
      renderable.width = null as any
    }).not.toThrow()
  })

  test("handles undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-width-undefined" })
    expect(() => {
      renderable.width = undefined as any
    }).not.toThrow()
  })
})

describe("Yoga Prop Setters - height", () => {
  test("accepts valid number", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-height" })
    expect(() => {
      renderable.height = 100
    }).not.toThrow()
  })

  test("accepts auto", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-height-auto" })
    expect(() => {
      renderable.height = "auto"
    }).not.toThrow()
  })

  test("accepts percentage", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-height-percent" })
    expect(() => {
      renderable.height = "50%"
    }).not.toThrow()
  })

  test("handles null", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-height-null" })
    expect(() => {
      renderable.height = null as any
    }).not.toThrow()
  })

  test("handles undefined", () => {
    const renderable = new TestRenderable(testRenderer, { id: "test-height-undefined" })
    expect(() => {
      renderable.height = undefined as any
    }).not.toThrow()
  })
})
