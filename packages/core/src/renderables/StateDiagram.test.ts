import { describe, expect, test } from "bun:test"
import { parseColor } from "../lib/RGBA.js"
import { createTestRenderer } from "../testing/test-renderer.js"
import {
  parseMermaidStateDiagram,
  renderStateDiagram,
  renderStateDiagramAnsi,
  StateDiagramRenderable,
} from "./StateDiagram.js"

describe("StateDiagram", () => {
  test("detects and parses Mermaid state diagrams", () => {
    const diagram = parseMermaidStateDiagram(`
stateDiagram-v2
  %% request lifecycle
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: done
  Success --> [*]
`)

    expect(diagram.direction).toBe("LR")
    expect(diagram.states).toEqual([
      { id: "__start", label: "●", kind: "start" },
      { id: "Idle", label: "Idle", kind: "state" },
      { id: "Loading", label: "Loading", kind: "state" },
      { id: "Success", label: "Success", kind: "state" },
      { id: "__end", label: "◎", kind: "end" },
    ])
    expect(diagram.transitions).toEqual([
      { from: "__start", to: "Idle", label: "" },
      { from: "Idle", to: "Loading", label: "submit" },
      { from: "Loading", to: "Success", label: "done" },
      { from: "Success", to: "__end", label: "" },
    ])
  })

  test("parses quoted state aliases", () => {
    const diagram = parseMermaidStateDiagram(`
stateDiagram-v2
  state "Waiting<br/>for Payment" as WaitingPayment
  [*] --> WaitingPayment
`)

    expect(diagram.states).toContainEqual({ id: "WaitingPayment", label: "Waiting<br/>for Payment", kind: "state" })
  })

  test("parses choice pseudo-states", () => {
    const diagram = parseMermaidStateDiagram(`
stateDiagram-v2
  [*] --> Decision
  state Decision <<choice>>
  Decision --> Accepted: yes
`)

    expect(diagram.states).toContainEqual({ id: "Decision", label: "┼", kind: "choice" })
  })

  test("renders a horizontal state diagram", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: done
  Success --> [*]
`)

    expect(output).toMatchInlineSnapshot(`
      "              ╭──────╮   submit    ╭─────────╮    done     ╭─────────╮
      ●────────────▶│ Idle ├────────────▶│ Loading ├────────────▶│ Success ├────────────▶◎
                    ╰──────╯             ╰─────────╯             ╰─────────╯"
    `)
  })

  test("renders a vertical state diagram", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction TB
  [*] --> Cart
  Cart --> Payment: checkout
  Payment --> Complete
`)

    expect(output).toMatchInlineSnapshot(`
      "      ●
            │
            │
            │
            ▼
        ╭──────╮
        │ Cart │
        ╰───┬──╯
            │
            │ checkout
            │
            ▼
       ╭─────────╮
       │ Payment │
       ╰────┬────╯
            │
            │
            │
            ▼
      ╭──────────╮
      │ Complete │
      ╰──────────╯"
    `)
  })

  test("renders branched and backward transitions visibly", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
  Loading --> Success: 200 OK
  Loading --> Error: timeout
  Error --> Loading: retry
  Success --> [*]
`)

    expect(output).toMatchInlineSnapshot(`
      "              ╭──────╮   submit    ╭─────────╮   200 OK    ╭─────────╮
      ●────────────▶│ Idle ├────────────▶│ Loading ├────────────▶│ Success ├────────────▶◎
                    ╰──────╯             ╰──┬──────╯             ╰─────────╯
                                            │   ▲
                                   timeout  │   │
                                            ▼   │  retry
                                          ╭─────┴─╮
                                          │ Error │
                                          ╰───────╯"
    `)
  })

  test("renders configurable line arrowheads", () => {
    const output = renderStateDiagram(
      `
stateDiagram-v2
  direction LR
  [*] --> Idle
  Idle --> Loading: submit
`,
      { arrowHeadStyle: "line" },
    )

    expect(output).toContain("→")
    expect(output).not.toContain("▶")
  })

  test("renders self transitions and choice branches", () => {
    const output = renderStateDiagram(`
stateDiagram-v2
  direction LR
  state Decision <<choice>>
  [*] --> Editing
  Editing --> Editing: type
  Editing --> Decision: submit
  Decision --> Saved: ok
  Decision --> Error: fail
  Error --> Editing: retry
`)

    expect(output).toMatchInlineSnapshot(`
      "              ╭─────────╮   submit          ok      ╭───────╮
      ●────────────▶│ Editing ├─────────────┬────────────▶│ Saved │
                    ╰──┬──────╯             │             ╰───────╯
                     ▲ │    ▲ type          │ fail
                     │ ╰────╯               │
                     │                      ▼
                     │                  ╭───────╮
                     │                  │ Error │
                     │                  ╰───┬───╯
                     │                      │
                     │                      │
                     │        retry         │
                     ╰──────────────────────╯"
    `)
  })

  test("renders ANSI styles", () => {
    const output = renderStateDiagramAnsi(`
stateDiagram-v2
  [*] --> Idle
`)

    expect(output).toContain("\x1b[")
    expect(output).toContain("●")
  })

  test("colors states, transitions, labels, and markers separately", async () => {
    const stateColor = parseColor("#E5E7EB")
    const activeStateColor = parseColor("#DDFFF6")
    const transitionColor = parseColor("#86E1C8")
    const labelColor = parseColor("#E6B17E")
    const testRenderer = await createTestRenderer({ width: 80, height: 12 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: submit`,
        activeState: "Loading",
        stateColor,
        activeStateColor,
        transitionColor,
        labelColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const idleSpan = spans.find((span) => span.text.includes("Idle"))
      const loadingSpan = spans.find((span) => span.text.includes("Loading"))
      const arrowSpan = spans.find((span) => span.text.includes("▶"))
      const labelSpan = spans.find((span) => span.text.includes("submit"))
      const fadeSpan = spans.find((span) => span.text.includes("├") || span.text.includes("┤"))

      expect(idleSpan?.fg.equals(stateColor)).toBe(true)
      expect(loadingSpan?.fg.equals(activeStateColor)).toBe(true)
      expect(arrowSpan?.fg.equals(transitionColor)).toBe(true)
      expect(labelSpan?.fg.equals(labelColor)).toBe(true)
      expect(fadeSpan?.fg.equals(stateColor)).toBe(false)
      expect(fadeSpan?.fg.equals(transitionColor)).toBe(false)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("colors active transitions separately", async () => {
    const transitionColor = parseColor("#86E1C8")
    const activeTransitionColor = parseColor("#E6B17E")
    const testRenderer = await createTestRenderer({ width: 80, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  [*] --> Idle
  Idle --> Loading: submit`,
        activeTransition: { from: "Idle", to: "Loading" },
        transitionColor,
        activeTransitionColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const activeArrowSpan = spans.find((span) => span.text.includes("▶") && span.fg?.equals(activeTransitionColor))
      const inactiveArrowSpan = spans.find((span) => span.text.includes("▶") && span.fg?.equals(transitionColor))
      const departureSpan = spans.find((span) => span.text.includes("├"))
      const labelSpan = spans.find((span) => span.text.includes("submit"))

      expect(activeArrowSpan).toBeTruthy()
      expect(inactiveArrowSpan).toBeTruthy()
      expect(departureSpan?.fg.equals(activeTransitionColor)).toBe(false)
      expect(departureSpan?.fg.equals(transitionColor)).toBe(false)
      expect(labelSpan?.fg.equals(activeTransitionColor)).toBe(true)
    } finally {
      testRenderer.renderer.destroy()
    }
  })

  test("colors active transition paths through choice junctions", async () => {
    const activeTransitionColor = parseColor("#E6B17E")
    const testRenderer = await createTestRenderer({ width: 120, height: 8 })

    try {
      const diagram = new StateDiagramRenderable(testRenderer.renderer, {
        content: `stateDiagram-v2
  direction LR
  state Decision <<choice>>
  Validating --> Decision
  Decision --> Submitted: valid
  Decision --> Invalid: errors`,
        activeTransition: [
          { from: "Validating", to: "Decision" },
          { from: "Decision", to: "Submitted", label: "valid" },
        ],
        activeTransitionColor,
      })

      testRenderer.renderer.root.add(diagram)
      await testRenderer.renderOnce()

      const spans = testRenderer.captureSpans().lines.flatMap((line) => line.spans)
      const validSpan = spans.find((span) => span.text.includes("valid"))
      const errorsSpan = spans.find((span) => span.text.includes("errors"))
      const activeArrowSpan = spans.find((span) => span.text.includes("▶") && span.fg?.equals(activeTransitionColor))

      expect(validSpan?.fg.equals(activeTransitionColor)).toBe(true)
      expect(errorsSpan?.fg.equals(activeTransitionColor)).toBe(false)
      expect(activeArrowSpan).toBeTruthy()
    } finally {
      testRenderer.renderer.destroy()
    }
  })
})
