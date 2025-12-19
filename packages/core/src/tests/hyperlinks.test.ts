import { test, expect, beforeEach, afterEach, describe } from "bun:test"
import { createTestRenderer, type TestRenderer, type MockMouse } from "../testing/test-renderer"
import { TextRenderable } from "../renderables/Text"
import { link, t, fg } from "../lib/styled-text"
import { TextAttributes } from "../types"

let renderer: TestRenderer
let mockMouse: MockMouse
let renderOnce: () => Promise<void>

beforeEach(async () => {
  ;({ renderer, mockMouse, renderOnce } = await createTestRenderer({
    width: 80,
    height: 24,
  }))
})

afterEach(() => {
  renderer.destroy()
})

describe("link() styled text helper", () => {
  test("should create a text chunk with href and underline", () => {
    const linkedText = link("https://example.com")("Click here")

    expect(linkedText.__isChunk).toBe(true)
    expect(linkedText.text).toBe("Click here")
    expect(linkedText.href).toBe("https://example.com")
    // Underline is stored in the attributes bitmask
    expect(linkedText.attributes! & TextAttributes.UNDERLINE).toBe(TextAttributes.UNDERLINE)
  })

  test("should work with template literals", () => {
    const styledText = t`Visit ${link("https://example.com")("our website")} for more info`

    expect(styledText.chunks.length).toBe(3)
    expect(styledText.chunks[0].text).toBe("Visit ")
    expect(styledText.chunks[1].text).toBe("our website")
    expect(styledText.chunks[1].href).toBe("https://example.com")
    expect(styledText.chunks[1].attributes! & TextAttributes.UNDERLINE).toBe(TextAttributes.UNDERLINE)
    expect(styledText.chunks[2].text).toBe(" for more info")
  })

  test("should compose with other styles", () => {
    const styledLink = fg("blue")(link("https://example.com")("Blue link"))

    expect(styledLink.__isChunk).toBe(true)
    expect(styledLink.text).toBe("Blue link")
    expect(styledLink.href).toBe("https://example.com")
    expect(styledLink.attributes! & TextAttributes.UNDERLINE).toBe(TextAttributes.UNDERLINE)
    expect(styledLink.fg).toBeDefined()
  })
})

describe("link registration", () => {
  test("should register links and return unique IDs", () => {
    const id1 = renderer.registerLink("https://example.com")
    const id2 = renderer.registerLink("https://other.com")
    const id3 = renderer.registerLink("https://example.com") // duplicate

    expect(id1).toBeGreaterThan(0)
    expect(id2).toBeGreaterThan(0)
    expect(id1).not.toBe(id2)
    expect(id3).toBe(id1) // duplicate should return same ID
  })

  test("should retrieve registered links by ID", () => {
    const id = renderer.registerLink("https://example.com")
    const url = renderer.getLink(id)

    expect(url).toBe("https://example.com")
  })

  test("should return null for invalid link ID", () => {
    const url = renderer.getLink(9999)

    expect(url).toBeNull()
  })

  test("should clear all links", () => {
    const id = renderer.registerLink("https://example.com")
    expect(renderer.getLink(id)).toBe("https://example.com")

    renderer.clearLinks()
    expect(renderer.getLink(id)).toBeNull()
  })
})

describe("TextRenderable with links", () => {
  test("should render text with hyperlinks", async () => {
    const text = new TextRenderable(renderer, {
      content: t`Click ${link("https://example.com")("here")} to visit`,
      width: 30,
      height: 1,
    })

    renderer.root.add(text)
    await renderOnce()

    expect(text.plainText).toBe("Click here to visit")
  })

  test("should detect link at position", async () => {
    const text = new TextRenderable(renderer, {
      content: t`Click ${link("https://example.com")("here")} to visit`,
      width: 30,
      height: 1,
    })

    renderer.root.add(text)
    await renderOnce()

    // "Click " is 6 chars, link starts at position 6
    const linkUrl = text.getLinkAt(text.x + 6, text.y)
    expect(linkUrl).toBe("https://example.com")

    // Position 0 should not have a link
    const noLink = text.getLinkAt(text.x, text.y)
    expect(noLink).toBeNull()
  })

  test("should return 0 for getLinkIdAt outside bounds", async () => {
    const text = new TextRenderable(renderer, {
      content: t`${link("https://example.com")("Link")}`,
      width: 10,
      height: 1,
    })

    renderer.root.add(text)
    await renderOnce()

    // Outside renderable bounds
    const linkId = text.getLinkIdAt(-1, -1)
    expect(linkId).toBe(0)
  })
})

describe("link click handling", () => {
  test("should call onLinkClick handler on alt+click", async () => {
    let clickedUrl: string | undefined
    let clickedEvent: any

    const text = new TextRenderable(renderer, {
      content: t`${link("https://example.com")("Click me")}`,
      width: 20,
      height: 1,
      onLinkClick: (url, event) => {
        clickedUrl = url
        clickedEvent = event
      },
    })

    renderer.root.add(text)
    await renderOnce()

    // Alt+click on the link
    await mockMouse.click(text.x + 2, text.y, 0, { modifiers: { alt: true } })
    await renderOnce()

    expect(clickedUrl).toBe("https://example.com")
    expect(clickedEvent).toBeDefined()
  })

  test("should not call onLinkClick without alt modifier", async () => {
    let clickedUrl: string | undefined

    const text = new TextRenderable(renderer, {
      content: t`${link("https://example.com")("Click me")}`,
      width: 20,
      height: 1,
      onLinkClick: (url) => {
        clickedUrl = url
      },
    })

    renderer.root.add(text)
    await renderOnce()

    // Regular click (no alt)
    await mockMouse.click(text.x + 2, text.y)
    await renderOnce()

    expect(clickedUrl).toBeUndefined()
  })

  test("should not call onLinkClick when clicking outside link", async () => {
    let clickedUrl: string | undefined

    const text = new TextRenderable(renderer, {
      content: t`No link here ${link("https://example.com")("but here")}`,
      width: 30,
      height: 1,
      onLinkClick: (url) => {
        clickedUrl = url
      },
    })

    renderer.root.add(text)
    await renderOnce()

    // Alt+click on "No link here" (before the link)
    await mockMouse.click(text.x + 2, text.y, 0, { modifiers: { alt: true } })
    await renderOnce()

    expect(clickedUrl).toBeUndefined()
  })

  test("alt+click should not start text selection", async () => {
    const text = new TextRenderable(renderer, {
      content: t`${link("https://example.com")("Click me")}`,
      width: 20,
      height: 1,
      selectable: true,
    })

    renderer.root.add(text)
    await renderOnce()

    // Alt+click
    await mockMouse.pressDown(text.x + 2, text.y, 0, { modifiers: { alt: true } })
    await renderOnce()

    // Should not have started selection
    expect(renderer.getSelection()).toBeNull()
  })

  test("regular click should still start selection on selectable text", async () => {
    const text = new TextRenderable(renderer, {
      content: t`${link("https://example.com")("Click me")}`,
      width: 20,
      height: 1,
      selectable: true,
    })

    renderer.root.add(text)
    await renderOnce()

    // Regular click (no alt)
    await mockMouse.pressDown(text.x + 2, text.y)
    await renderOnce()

    // Should have started selection
    expect(renderer.getSelection()).not.toBeNull()
  })
})
