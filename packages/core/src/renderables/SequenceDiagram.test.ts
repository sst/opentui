import { describe, expect, test } from "bun:test"
import { parseColor } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import {
  parseMermaidSequenceDiagram,
  renderSequenceDiagram,
  renderSequenceDiagramAnsi,
  SequenceDiagramRenderable,
} from "./SequenceDiagram.js"

describe("SequenceDiagram", () => {
  test("parses Mermaid sequenceDiagram participants and messages", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  participant B as Browser
  participant S as Server
  B->>S: GET /
  S-->>B: 401 WWW-Auth
`)

    expect(diagram.participants).toEqual([
      { id: "B", label: "Browser" },
      { id: "S", label: "Server" },
    ])
    expect(diagram.messages).toEqual([
      { from: "B", to: "S", label: "GET /", style: "solid" },
      { from: "S", to: "B", label: "401 WWW-Auth", style: "dashed" },
    ])
    expect(diagram.steps).toEqual([
      { type: "message", message: { from: "B", to: "S", label: "GET /", style: "solid" } },
      { type: "message", message: { from: "S", to: "B", label: "401 WWW-Auth", style: "dashed" } },
    ])
  })

  test("renders a terminal sequence diagram", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant B as Browser
  participant S as Server
  B->>S: GET /
  S-->>B: 401 WWW-Auth
`)

    expect(output).toMatchInlineSnapshot(`
      " Browser           Server
       ───┬───           ───┬──
          │                 │
          │ GET /           │
          ├─────────────────▶
          │                 │
          │ 401 WWW-Auth    │
          ◀─────────────────┤
          │                 │"
    `)
  })

  test("connects participant headers to lifelines", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant Browser
  participant Server
`)

    const lines = output.split("\n")
    const browserCenter = lines[0]!.indexOf("w")
    const serverCenter = lines[0]!.indexOf("v")

    expect(lines[1]?.[browserCenter]).toBe("┬")
    expect(lines[2]?.[browserCenter]).toBe("│")
    expect(lines[1]?.[serverCenter]).toBe("┬")
    expect(lines[2]?.[serverCenter]).toBe("│")
  })

  test("renders notes and long cross-participant messages in order", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  participant Browser
  participant Server
  participant Store as Ticket store
  Note over Browser,Server: native browser Basic prompt
  Browser->>Server: POST connect-token
  Server->>Store: issue { ptyID, scope }
`)

    expect(output).toContain("native browser Basic prompt")
    expect(output).toContain("POST connect-token")
    expect(output).toContain("issue { ptyID, scope }")
    expect(output.indexOf("native browser Basic prompt")).toBeLessThan(output.indexOf("POST connect-token"))
  })

  test("parses activation shorthand and control blocks", () => {
    const diagram = parseMermaidSequenceDiagram(`
sequenceDiagram
  Browser->>+Server: request
  alt accepted
    Server-->>-Browser: response
  else rejected
    activate Server
    Server-->>Browser: error
    deactivate Server
  end
`)

    expect(diagram.steps).toEqual([
      {
        type: "message",
        message: { from: "Browser", to: "Server", label: "request", style: "solid", activate: "Server" },
      },
      { type: "fragment", fragment: { kind: "alt", label: "accepted" } },
      {
        type: "message",
        message: { from: "Server", to: "Browser", label: "response", style: "dashed", deactivate: "Server" },
      },
      { type: "fragment", fragment: { kind: "else", label: "rejected" } },
      { type: "activation", activation: { participant: "Server", active: true } },
      { type: "message", message: { from: "Server", to: "Browser", label: "error", style: "dashed" } },
      { type: "activation", activation: { participant: "Server", active: false } },
      { type: "fragment", fragment: { kind: "end", label: "" } },
    ])
  })

  test("renders centered heavy activation bars", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  Browser->>+Server: request
  Server-->>-Browser: response
`)

    expect(output).toContain("┃")
    expect(output.indexOf("request")).toBeLessThan(output.indexOf("┃"))
    expect(output.indexOf("┃")).toBeLessThan(output.indexOf("response"))
  })

  test("supports custom activation characters", () => {
    const output = renderSequenceDiagram(
      `
sequenceDiagram
  Browser->>+Server: request
  Server-->>-Browser: response
`,
      { activationChar: "▓" },
    )

    expect(output).toContain("▓")
    expect(output).not.toContain("┃")
  })

  test("renders lightweight alt else separators", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  alt accepted
    Browser->>Server: ok
  else rejected
    Server-->>Browser: no
  end
`)

    expect(output).toContain("alt: accepted")
    expect(output).toContain("else: rejected")
    expect(output).toContain("end")
    expect(output.indexOf("alt: accepted")).toBeLessThan(output.indexOf("ok"))
    expect(output.indexOf("else: rejected")).toBeLessThan(output.indexOf("no"))
  })

  test("places two spacer rows above note badges and one below", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  Browser->>Server: one
  Note over Browser,Server: phase
  Browser->>Server: two
`)
    const lines = output.split("\n")
    const noteRow = lines.findIndex((line) => line.includes("phase"))
    const nextMessageRow = lines.findIndex((line) => line.includes("two"))

    expect(noteRow).toBeGreaterThan(0)
    expect(lines[noteRow - 1]?.trim()).toBe("│                 │")
    expect(lines[noteRow - 2]?.trim()).toBe("│                 │")
    expect(lines[noteRow + 1]?.trim()).toBe("│                 │")
    expect(nextMessageRow).toBe(noteRow + 2)
  })

  test("renders br-delimited message labels across multiple rows", () => {
    const output = renderSequenceDiagram(`
sequenceDiagram
  Browser->>Server: POST connect-token<br/>· Basic (cached by browser)<br/>· X-OpenCode-Ticket: 1
`)

    expect(output).toContain("POST connect-token")
    expect(output).toContain("· Basic (cached by browser)")
    expect(output).toContain("· X-OpenCode-Ticket: 1")
    expect(output.indexOf("· X-OpenCode-Ticket: 1")).toBeLessThan(output.indexOf("├"))
  })

  test("colors request and response messages differently", async () => {
    const requestColor = parseColor("#38BDF8")
    const responseColor = parseColor("#F59E0B")
    const testRenderer = await createTestRenderer({ width: 60, height: 16 })

    try {
      const diagram = new SequenceDiagramRenderable(testRenderer.renderer, {
        content: `sequenceDiagram
  Browser->>Server: request
  Server-->>Browser: response`,
        requestColor,
        responseColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const requestSpan = spans.find((span) => span.text.includes("request"))
      const responseSpan = spans.find((span) => span.text.includes("response"))

      expect(requestSpan?.fg.equals(requestColor)).toBe(true)
      expect(responseSpan?.fg.equals(responseColor)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("tweens arrow departure colors away from lifelines over five cells", async () => {
    const lifelineColor = parseColor("#94A3B8")
    const requestColor = parseColor("#38BDF8")
    const testRenderer = await createTestRenderer({ width: 60, height: 12 })

    try {
      const diagram = new SequenceDiagramRenderable(testRenderer.renderer, {
        content: `sequenceDiagram
  Browser->>Server: request`,
        lifelineColor,
        requestColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const arrowLine = testRenderer
        .captureSpans()
        .lines.find((line) => line.spans.some((span) => span.text.includes("▶")))
      const departureSpan = arrowLine?.spans.find((span) => span.text.includes("├"))

      expect(departureSpan).toBeDefined()
      expect(departureSpan?.fg.equals(lifelineColor)).toBe(false)
      expect(departureSpan?.fg.equals(requestColor)).toBe(false)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("colors headers, header rules, and note badges separately", async () => {
    const participantColor = parseColor("#E5E7EB")
    const lifelineColor = parseColor("#64748B")
    const noteColor = parseColor("#A78BFA")
    const noteBackgroundColor = parseColor("#312E81")
    const testRenderer = await createTestRenderer({ width: 70, height: 16 })

    try {
      const diagram = new SequenceDiagramRenderable(testRenderer.renderer, {
        content: `sequenceDiagram
  participant Browser
  participant Server
  Note over Browser,Server: native browser Basic prompt`,
        participantColor,
        lifelineColor,
        noteColor,
        noteBackgroundColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const participantSpan = spans.find((span) => span.text.includes("Browser"))
      const headerRuleSpan = spans.find((span) => span.text.includes("┬"))
      const noteSpan = spans.find((span) => span.text.includes("native browser Basic prompt"))

      expect(participantSpan?.fg.equals(participantColor)).toBe(true)
      expect(headerRuleSpan?.fg.equals(lifelineColor)).toBe(true)
      expect(noteSpan?.fg.equals(noteColor)).toBe(true)
      expect(noteSpan?.bg.equals(noteBackgroundColor)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("prints ANSI colors for terminal dumps", () => {
    const output = renderSequenceDiagramAnsi(`
sequenceDiagram
  Browser->>Server: request
  Server-->>Browser: response
`)

    expect(output).toContain("\x1b[38;2;134;225;200m")
    expect(output).toContain("\x1b[38;2;230;177;126m")
    expect(output).toContain("\x1b[38;2;115;153;138m")
    expect(output).toContain("\x1b[38;2;130;211;188m")
    expect(output).toContain("\x1b[38;2;131;145;126m")
    expect(output).toContain("\x1b[38;2;210;171;126m")
    expect(output).toContain("request")
    expect(output).toContain("response")
    expect(output).toContain("◀")
    expect(output).toContain("┤")
  })
})
