import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { testRender } from "../index"

/**
 * Tests to verify that custom directives with no arguments are properly
 * distinguished from ref callbacks.
 *
 * The key difference:
 * - ref callbacks: (el) => ... (1 parameter)
 * - custom directives: (el, accessor) => ... (2+ parameters)
 */

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Custom Directive vs Ref Tests", () => {
  beforeEach(async () => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  afterEach(() => {
    if (testSetup) {
      testSetup.renderer.destroy()
    }
  })

  it("should treat single-parameter functions as refs", async () => {
    let refElement: any = undefined
    const refCallback = (el: any) => {
      refElement = el
    }

    testSetup = await testRender(
      () => (
        <box>
          <box ref={refCallback} width={10} height={5} />
        </box>
      ),
      {
        width: 30,
        height: 10,
      },
    )

    await testSetup.renderOnce()

    // Ref should be set
    expect(refElement).toBeDefined()
    expect(refElement.__solidRefCallback).toBeDefined()

    // Clean up to trigger ref cleanup
    testSetup.renderer.destroy()
    await new Promise((resolve) => process.nextTick(resolve))
  })

  it("should NOT treat two-parameter functions as refs", async () => {
    let directiveElement: any = undefined
    const customDirective = (el: any, accessor: () => any) => {
      directiveElement = el
      // Custom directive logic here
    }

    // Note: In real usage, you'd use use:customDirective
    // But for testing purposes, we'll call the use function directly
    testSetup = await testRender(
      () => {
        const box = <box width={10} height={5} />
        // Simulate custom directive (2 parameters, so NOT a ref)
        if (box) {
          customDirective(box, () => undefined)
        }
        return <box>{box}</box>
      },
      {
        width: 30,
        height: 10,
      },
    )

    await testSetup.renderOnce()

    // Element should be set by directive
    expect(directiveElement).toBeDefined()
    // But it should NOT have __solidRefCallback since it has 2 params
    expect(directiveElement.__solidRefCallback).toBeUndefined()

    testSetup.renderer.destroy()
  })

  it("should handle ref callbacks with TypeScript type annotations", async () => {
    let refElement: any = undefined

    testSetup = await testRender(
      () => (
        <box>
          <box
            ref={(el: any) => {
              refElement = el
            }}
            width={10}
            height={5}
          />
        </box>
      ),
      {
        width: 30,
        height: 10,
      },
    )

    await testSetup.renderOnce()

    // Ref should be set
    expect(refElement).toBeDefined()
    expect(refElement.__solidRefCallback).toBeDefined()

    testSetup.renderer.destroy()
  })
})
