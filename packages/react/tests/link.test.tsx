import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { act } from "react"
import { useState } from "react"
import { SyntaxStyle, type TextRenderable } from "@opentui/core"
import { testRender } from "../src/test-utils.js"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("Link Rendering Tests", () => {
  beforeEach(async () => {
    if (testSetup) {
      act(() => {
        testSetup.renderer.destroy()
      })
    }
  })

  afterEach(() => {
    if (testSetup) {
      act(() => {
        testSetup.renderer.destroy()
      })
    }
  })

  test("should render link with href correctly", async () => {
    await act(async () => {
      testSetup = await testRender(
        <text>
          Visit <a href="https://opentui.com">opentui.com</a> for more info
        </text>,
        {
          width: 50,
          height: 5,
        },
      )
    })

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("Visit opentui.com for more info")
  })

  test("should render styled link with underline", async () => {
    await act(async () => {
      testSetup = await testRender(
        <text>
          <u>
            <a href="https://opentui.com" fg="blue">
              opentui.com
            </a>
          </u>
        </text>,
        {
          width: 50,
          height: 5,
        },
      )
    })

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("opentui.com")
  })

  test("should render link inside text with other elements", async () => {
    await act(async () => {
      testSetup = await testRender(
        <text>
          Check out <a href="https://github.com/anomalyco/opentui">GitHub</a> and{" "}
          <a href="https://opentui.com">our website</a>
        </text>,
        {
          width: 60,
          height: 5,
        },
      )
    })

    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()

    expect(frame).toContain("GitHub")
    expect(frame).toContain("our website")
  })

  test("updates and removes href without replacing the keyed link", async () => {
    let setHref!: (href: string | null | undefined) => void
    let link: TextRenderable | null = null
    function App() {
      const [href, updateHref] = useState<string | null | undefined>("https://first.example")
      setHref = updateHref
      return (
        <text>
          <a key="stable" ref={(value) => (link = value)} {...(href === undefined ? ({} as any) : { href })}>
            linked
          </a>
        </text>
      )
    }

    await act(async () => {
      testSetup = await testRender(<App />, { width: 30, height: 3 })
    })
    await testSetup.renderOnce()
    const identity = link
    expect(link?.link?.url).toBe("https://first.example")

    await act(async () => setHref("https://second.example"))
    await testSetup.renderOnce()
    expect(link).toBe(identity)
    expect(link?.link?.url).toBe("https://second.example")

    await act(async () => setHref(undefined))
    await testSetup.renderOnce()
    expect(link).toBe(identity)
    expect(link?.link).toBeUndefined()

    await act(async () => setHref(""))
    await testSetup.renderOnce()
    expect(link?.link).toBeUndefined()

    await act(async () => setHref(null))
    await testSetup.renderOnce()
    expect(link?.link).toBeUndefined()
  })

  test("omitted undefined null and empty initial hrefs create no link and preserve registered provenance", async () => {
    const style = SyntaxStyle.fromStyles({ registered: { bold: true } })
    const styleId = style.getStyleId("registered")!
    const links: Array<TextRenderable | null> = []
    await act(async () => {
      testSetup = await testRender(
        <text>
          <a ref={(value) => (links[0] = value)} {...({ styleId, styleSource: style } as any)}>
            omitted
          </a>
          <a ref={(value) => (links[1] = value)} {...({ href: undefined, styleId, styleSource: style } as any)}>
            undefined
          </a>
          <a ref={(value) => (links[2] = value)} {...({ href: null, styleId, styleSource: style } as any)}>
            null
          </a>
          <a ref={(value) => (links[3] = value)} {...({ href: "", styleId, styleSource: style } as any)}>
            empty
          </a>
        </text>,
        { width: 50, height: 3 },
      )
    })
    await testSetup.renderOnce()
    for (const link of links) {
      expect(link?.link).toBeUndefined()
      expect(link?.styleId).toBe(styleId)
      expect(link?.styleSource).toBe(style)
    }
    style.destroy()
  })
})
