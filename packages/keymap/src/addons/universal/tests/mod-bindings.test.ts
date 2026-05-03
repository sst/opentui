import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { registerCommaBindings, registerDefaultKeys, registerModBindings } from "@opentui/keymap/addons"
import { Keymap, type KeymapEvent, type KeymapHost, type KeymapHostMetadata } from "../../../index.js"
import { createDiagnosticHarness } from "../../../tests/diagnostic-harness.js"

const diagnostics = createDiagnosticHarness()

class FakeTarget {}

class FakeEvent implements KeymapEvent {
  public propagationStopped = false
  public defaultPrevented = false

  constructor(
    public readonly name: string,
    public readonly ctrl = false,
    public readonly shift = false,
    public readonly meta = false,
    public readonly superKey = false,
    public readonly hyperKey = false,
  ) {}

  public get super(): boolean {
    return this.superKey
  }

  public get hyper(): boolean {
    return this.hyperKey
  }

  public preventDefault(): void {
    this.defaultPrevented = true
  }

  public stopPropagation(): void {
    this.propagationStopped = true
  }
}

class FakeHost implements KeymapHost<FakeTarget, FakeEvent> {
  public readonly rootTarget = new FakeTarget()
  public readonly isDestroyed = false
  private readonly keyPressListeners = new Set<(event: FakeEvent) => void>()
  private readonly keyReleaseListeners = new Set<(event: FakeEvent) => void>()
  private readonly focusListeners = new Set<(target: FakeTarget | null) => void>()

  constructor(public readonly metadata: KeymapHostMetadata) {}

  public getFocusedTarget(): FakeTarget | null {
    return null
  }

  public getParentTarget(_target: FakeTarget): FakeTarget | null {
    return null
  }

  public isTargetDestroyed(_target: FakeTarget): boolean {
    return false
  }

  public onKeyPress(listener: (event: FakeEvent) => void): () => void {
    this.keyPressListeners.add(listener)
    return () => {
      this.keyPressListeners.delete(listener)
    }
  }

  public onKeyRelease(listener: (event: FakeEvent) => void): () => void {
    this.keyReleaseListeners.add(listener)
    return () => {
      this.keyReleaseListeners.delete(listener)
    }
  }

  public onFocusChange(listener: (target: FakeTarget | null) => void): () => void {
    this.focusListeners.add(listener)
    return () => {
      this.focusListeners.delete(listener)
    }
  }

  public onTargetDestroy(_target: FakeTarget, _listener: () => void): () => void {
    return () => {}
  }

  public createCommandEvent(): FakeEvent {
    return new FakeEvent("command")
  }

  public press(
    name: string,
    modifiers?: { ctrl?: boolean; shift?: boolean; meta?: boolean; super?: boolean },
  ): FakeEvent {
    const event = new FakeEvent(
      name,
      modifiers?.ctrl ?? false,
      modifiers?.shift ?? false,
      modifiers?.meta ?? false,
      modifiers?.super ?? false,
    )

    for (const listener of this.keyPressListeners) {
      listener(event)
    }

    return event
  }
}

function createMetadata(
  primaryModifier: KeymapHostMetadata["primaryModifier"],
  modifiers: Partial<KeymapHostMetadata["modifiers"]> = {},
): KeymapHostMetadata {
  return {
    platform: primaryModifier === "super" ? "macos" : primaryModifier === "ctrl" ? "linux" : "unknown",
    primaryModifier,
    modifiers: {
      ctrl: "supported",
      shift: "supported",
      meta: "supported",
      super: "supported",
      hyper: "unknown",
      ...modifiers,
    },
  }
}

function createKeymap(metadata: KeymapHostMetadata): { host: FakeHost; keymap: Keymap<FakeTarget, FakeEvent> } {
  const host = new FakeHost(metadata)
  const keymap = diagnostics.trackKeymap(new Keymap(host))
  registerDefaultKeys(keymap)
  return { host, keymap }
}

describe("mod bindings addon", () => {
  afterEach(() => {
    diagnostics.assertNoUnhandledDiagnostics()
  })

  test("resolves mod to the host super primary modifier and preserves display", () => {
    const { host, keymap } = createKeymap(createMetadata("super"))
    const calls: string[] = []

    registerModBindings(keymap)
    keymap.registerLayer({
      bindings: [
        {
          key: "mod+s",
          cmd() {
            calls.push("save")
          },
        },
      ],
    })

    const activeKey = keymap.getActiveKeys()[0]
    expect(activeKey?.stroke).toMatchObject({ name: "s", ctrl: false, super: true })
    expect(activeKey?.display).toBe("mod+s")

    host.press("s", { ctrl: true })
    host.press("s", { super: true })
    expect(calls).toEqual(["save"])
  })

  test("falls back to ctrl when the host primary modifier is unknown", () => {
    const { host, keymap } = createKeymap(createMetadata("unknown"))
    const calls: string[] = []

    registerModBindings(keymap)
    keymap.registerLayer({
      bindings: [
        {
          key: "mod+s",
          cmd() {
            calls.push("save")
          },
        },
      ],
    })

    const activeKey = keymap.getActiveKeys()[0]
    expect(activeKey?.stroke).toMatchObject({ name: "s", ctrl: true, super: false })
    expect(activeKey?.display).toBe("mod+s")

    host.press("s", { super: true })
    host.press("s", { ctrl: true })
    expect(calls).toEqual(["save"])
  })

  test("falls back to ctrl when the primary modifier is unsupported", () => {
    const { host, keymap } = createKeymap(createMetadata("super", { super: "unsupported" }))
    const calls: string[] = []

    registerModBindings(keymap)
    keymap.registerLayer({
      bindings: [
        {
          key: "mod+s",
          cmd() {
            calls.push("save")
          },
        },
      ],
    })

    expect(keymap.getActiveKeys()[0]?.stroke).toMatchObject({ name: "s", ctrl: true, super: false })

    host.press("s", { ctrl: true })
    expect(calls).toEqual(["save"])
  })

  test("stacks with comma bindings when mod is registered before comma", () => {
    const { host, keymap } = createKeymap(createMetadata("ctrl"))
    const calls: string[] = []

    registerModBindings(keymap)
    registerCommaBindings(keymap)
    keymap.registerLayer({
      bindings: [
        {
          key: "mod+x, mod+y",
          cmd() {
            calls.push("hit")
          },
        },
      ],
    })

    expect(keymap.getActiveKeys().map((key) => key.display)).toEqual(["mod+x", "mod+y"])
    expect(keymap.getActiveKeys().map((key) => key.stroke.ctrl)).toEqual([true, true])

    host.press("x")
    host.press("x", { ctrl: true })
    host.press("y", { ctrl: true })
    expect(calls).toEqual(["hit", "hit"])
  })

  test("stacks with comma bindings when comma is registered before mod", () => {
    const { host, keymap } = createKeymap(createMetadata("ctrl"))
    const calls: string[] = []

    registerCommaBindings(keymap)
    registerModBindings(keymap)
    keymap.registerLayer({
      bindings: [
        {
          key: "mod+x, mod+y",
          cmd() {
            calls.push("hit")
          },
        },
      ],
    })

    expect(keymap.getActiveKeys().map((key) => key.display)).toEqual(["mod+x", "mod+y"])
    expect(keymap.getActiveKeys().map((key) => key.stroke.ctrl)).toEqual([true, true])

    host.press("x")
    host.press("x", { ctrl: true })
    host.press("y", { ctrl: true })
    expect(calls).toEqual(["hit", "hit"])
  })
})
