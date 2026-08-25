import { test, expect, describe } from "bun:test"
import { createTestRenderer } from "../testing/test-renderer.js"
import { ManualClock } from "../testing/manual-clock.js"
import { createTerminalCapabilities } from "../testing/terminal-capabilities.js"

// Capability mutation must require a probe this process actually issued.
//
// xterm encodes modified F1–F4 as `CSI 1;<mod> P/Q/R/S`; the R slot (e.g.
// Ctrl+F3 = `ESC [ 1;5R`) is byte-identical to a row-1 cursor position
// report. When such a chord is classified as a capability response by shape
// alone, the native layer reads col >= 2 as proof of the explicit-width /
// scaled-text protocol and latches both capabilities (set-only, never
// cleared) — rendering is corrupted until restart.
//
// The renderer arms a capability probe window in setupTerminal()
// (capabilityTimeoutId, 5000ms). These tests pin the invariant: outside an
// outstanding probe window no capability-shaped byte sequence mutates
// capabilities; inside it, genuine probe replies still apply.

interface CapabilityWriteSpy {
  processCalls: string[]
  events: unknown[]
  restore: () => void
}

function spyOnCapabilityWrites(renderer: unknown): CapabilityWriteSpy {
  const lib = (renderer as { lib: any }).lib
  const originalProcess = lib.processCapabilityResponse
  const originalGet = lib.getTerminalCapabilities

  let explicitWidthLatched = false
  const processCalls: string[] = []
  lib.processCapabilityResponse = (_ptr: unknown, sequence: string) => {
    processCalls.push(sequence)
    explicitWidthLatched = true
  }
  lib.getTerminalCapabilities = () => createTerminalCapabilities({ explicit_width: explicitWidthLatched })

  const events: unknown[] = []
  ;(renderer as { on: (ev: string, cb: (caps: unknown) => void) => void }).on("capabilities", (caps) => {
    events.push(caps)
  })

  return {
    processCalls,
    events,
    restore: () => {
      lib.processCapabilityResponse = originalProcess
      lib.getTerminalCapabilities = originalGet
    },
  }
}

describe("capability probe provenance", () => {
  test("a capability-shaped chord with no probe outstanding does not mutate capabilities", async () => {
    const clock = new ManualClock()
    const { renderer } = await createTestRenderer({ clock })
    const spy = spyOnCapabilityWrites(renderer)

    // Ctrl+F3 under modifyOtherKeys — byte-identical to a row-1/col-5 CPR.
    // @ts-expect-error - private method under test
    const handled = renderer.processCapabilitySequence("\x1b[1;5R", true)

    expect(handled).toBe(true) // swallowed, never forwarded as input
    expect(spy.processCalls).toHaveLength(0)
    expect(spy.events).toHaveLength(0)
    // @ts-expect-error - private state under test
    expect(renderer.forceFullRepaintRequested).toBe(false)
    expect(renderer.capabilities?.explicit_width ?? false).toBe(false)

    spy.restore()
    renderer.destroy()
  })

  test("a DA1-shaped response with no probe outstanding does not mutate capabilities", async () => {
    const clock = new ManualClock()
    const { renderer } = await createTestRenderer({ clock })
    const spy = spyOnCapabilityWrites(renderer)

    // @ts-expect-error - private method under test
    const handled = renderer.processCapabilitySequence("\x1b[?62;22c", false)

    expect(handled).toBe(true) // swallowed, never forwarded as input
    expect(spy.processCalls).toHaveLength(0)
    expect(spy.events).toHaveLength(0)

    spy.restore()
    renderer.destroy()
  })

  test("a width-probe reply inside the outstanding window still mutates capabilities", async () => {
    const clock = new ManualClock()
    const { renderer } = await createTestRenderer({ clock })
    const spy = spyOnCapabilityWrites(renderer)

    await renderer.setupTerminal()

    // @ts-expect-error - private method under test
    const handled = renderer.processCapabilitySequence("\x1b[1;2R", true)

    expect(handled).toBe(true)
    expect(spy.processCalls).toEqual(["\x1b[1;2R"])
    expect(spy.events).toHaveLength(1)
    expect(renderer.capabilities?.explicit_width).toBe(true)

    spy.restore()
    renderer.destroy()
  })

  test("after the probe window expires, capability-shaped bytes are inert", async () => {
    const clock = new ManualClock()
    const { renderer } = await createTestRenderer({ clock })
    const spy = spyOnCapabilityWrites(renderer)

    await renderer.setupTerminal()
    clock.advance(5000)

    // @ts-expect-error - private method under test
    const handled = renderer.processCapabilitySequence("\x1b[?62;22c", false)

    expect(handled).toBe(true) // swallowed, never forwarded as input
    expect(spy.processCalls).toHaveLength(0)
    expect(spy.events).toHaveLength(0)

    spy.restore()
    renderer.destroy()
  })
})
