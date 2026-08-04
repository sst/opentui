import { Buffer } from "node:buffer"

import { expect, test } from "bun:test"

import type { NativeSpanFeed } from "../NativeSpanFeed.js"
import { CliRenderer, type KittyKeyboardOptions } from "../renderer.js"
import { createTestStdin, TestWriteStream } from "../testing/test-streams.js"

const KITTY_GRAPHICS_QUERY = "\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[c"

class CollectingWriteStream extends TestWriteStream {
  private readonly writes: Buffer[] = []
  private deferCallbacks = false
  private pendingCallbacks: Array<() => void> = []

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const bytes = chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk))
    this.writes.push(bytes)
    if (this.deferCallbacks) {
      this.pendingCallbacks.push(() => callback())
    } else {
      callback()
    }
  }

  public take(): string {
    const output = Buffer.concat(this.writes).toString("latin1")
    this.writes.length = 0
    return output
  }

  public deferWriteCallbacks(): void {
    this.deferCallbacks = true
  }

  public releaseWriteCallbacks(): void {
    this.deferCallbacks = false
    const callbacks = this.pendingCallbacks.splice(0)
    for (const callback of callbacks) callback()
  }
}

interface KittyRendererHarness {
  renderer: CliRenderer
  stdin: NodeJS.ReadStream
  stdout: CollectingWriteStream
  feed: NativeSpanFeed
  initialOutput: string
}

async function createKittyRenderer(
  useKittyKeyboard: KittyKeyboardOptions | null = null,
  setupTerminal = true,
): Promise<KittyRendererHarness> {
  const stdin = createTestStdin()
  const stdout = new CollectingWriteStream(80, 24)
  const renderer = new CliRenderer(stdin, stdout as CollectingWriteStream & NodeJS.WriteStream, 80, 24, {
    useKittyKeyboard,
    useMouse: false,
    useThread: false,
    screenMode: "main-screen",
    consoleMode: "disabled",
    clearOnShutdown: false,
    exitOnCtrlC: false,
    exitSignals: [],
    remote: true,
  })
  const feed = (renderer as unknown as { _feed: NativeSpanFeed | null })._feed
  if (!feed) {
    renderer.destroy()
    throw new Error("Expected a feed-backed renderer")
  }

  try {
    if (setupTerminal) {
      await renderer.setupTerminal()
    }
    await feed.idle()
    const initialOutput = stdout.take()
    return { renderer, stdin, stdout, feed, initialOutput }
  } catch (error) {
    try {
      renderer.destroy()
    } catch {}
    try {
      await feed.idle()
    } catch {}
    throw error
  }
}

async function reportInheritedKittyMode(harness: KittyRendererHarness): Promise<string> {
  harness.stdin.emit("data", Buffer.from("\x1b[?1u"))
  await harness.feed.idle()
  return harness.stdout.take()
}

async function destroyKittyRenderer(harness: KittyRendererHarness): Promise<string> {
  try {
    if (!harness.renderer.isDestroyed) {
      harness.renderer.destroy()
    }
  } finally {
    await harness.feed.idle()
  }
  return harness.stdout.take()
}

function occursBefore(output: string, first: string, second: string): boolean {
  const firstIndex = output.indexOf(first)
  const secondIndex = output.indexOf(second)
  return firstIndex >= 0 && secondIndex > firstIndex
}

function countOccurrences(output: string, sequence: string): number {
  return output.split(sequence).length - 1
}

test("useKittyKeyboard: null masks inherited Kitty input before capability detection", async () => {
  const harness = await createKittyRenderer()

  try {
    const keys: Array<{ name: string; source: string }> = []
    harness.renderer.keyInput.on("keypress", (key) => {
      keys.push({ name: key.name, source: key.source })
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))

    expect({
      startupPushes: countOccurrences(harness.initialOutput, "\x1b[>0u"),
      keys,
    }).toEqual({
      startupPushes: 1,
      keys: [{ name: "", source: "raw" }],
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("useKittyKeyboard: null masks an inherited Kitty mode for the renderer lifetime", async () => {
  const harness = await createKittyRenderer()

  try {
    const activationOutput = await reportInheritedKittyMode(harness)

    const keys: Array<{ name: string; source: string }> = []
    harness.renderer.keyInput.on("keypress", (key) => {
      keys.push({ name: key.name, source: key.source })
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))

    const shutdownOutput = await destroyKittyRenderer(harness)
    expect({
      startupPushes: countOccurrences(harness.initialOutput, "\x1b[>0u"),
      activationPushes: countOccurrences(activationOutput, "\x1b[>0u"),
      activationPops: countOccurrences(activationOutput, "\x1b[<u"),
      keys,
      shutdownPops: countOccurrences(shutdownOutput, "\x1b[<u"),
    }).toEqual({
      startupPushes: 1,
      activationPushes: 0,
      activationPops: 0,
      keys: [{ name: "", source: "raw" }],
      shutdownPops: 1,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("a focus cycle restores the owned zero-flag Kitty entry without growing the stack", async () => {
  const harness = await createKittyRenderer()

  try {
    harness.stdin.emit("data", Buffer.from("\x1b[O"))
    harness.stdin.emit("data", Buffer.from("\x1b[I"))
    await harness.feed.idle()
    const focusOutput = harness.stdout.take()

    expect({
      poppedEntries: countOccurrences(focusOutput, "\x1b[<u"),
      pushedEntries: countOccurrences(focusOutput, "\x1b[>0u"),
      popBeforePush: occursBefore(focusOutput, "\x1b[<u", "\x1b[>0u"),
      enabled: harness.renderer.useKittyKeyboard,
    }).toEqual({
      poppedEntries: 1,
      pushedEntries: 1,
      popBeforePush: true,
      enabled: false,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("a zero-flag options object masks inherited flags without disabling Kitty parsing", async () => {
  const harness = await createKittyRenderer({
    disambiguate: false,
    alternateKeys: false,
    events: false,
    allKeysAsEscapes: false,
    reportText: false,
  })

  try {
    const activationOutput = await reportInheritedKittyMode(harness)

    let inputSource: string | undefined
    harness.renderer.keyInput.once("keypress", (key) => {
      inputSource = key.source
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))

    expect({
      startupPushes: countOccurrences(harness.initialOutput, "\x1b[>0u"),
      startupEnabledFallback: harness.initialOutput.includes("\x1b[>4;1m"),
      activationPushes: countOccurrences(activationOutput, "\x1b[>0u"),
      disabledFallback: harness.initialOutput.includes("\x1b[>4;0m") || activationOutput.includes("\x1b[>4;0m"),
      enabled: harness.renderer.useKittyKeyboard,
      inputSource,
    }).toEqual({
      startupPushes: 1,
      startupEnabledFallback: true,
      activationPushes: 0,
      disabledFallback: false,
      enabled: true,
      inputSource: "kitty",
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("useKittyKeyboard setter enables terminal state and parsing", async () => {
  const harness = await createKittyRenderer()

  try {
    await reportInheritedKittyMode(harness)

    harness.renderer.useKittyKeyboard = true
    await harness.feed.idle()
    const enableOutput = harness.stdout.take()

    const keys: Array<{ name: string; source: string }> = []
    harness.renderer.keyInput.on("keypress", (key) => {
      keys.push({ name: key.name, source: key.source })
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))

    expect({
      poppedEntries: countOccurrences(enableOutput, "\x1b[<u"),
      pushedEntries: countOccurrences(enableOutput, "\x1b[>5u"),
      replacedPreviousMode: occursBefore(enableOutput, "\x1b[<u", "\x1b[>5u"),
      disabledFallback: countOccurrences(enableOutput, "\x1b[>4;0m"),
      enabled: harness.renderer.useKittyKeyboard,
      keys,
    }).toEqual({
      poppedEntries: 1,
      pushedEntries: 1,
      replacedPreviousMode: true,
      disabledFallback: 1,
      enabled: true,
      keys: [{ name: "a", source: "kitty" }],
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("useKittyKeyboard setter disables terminal state and parsing", async () => {
  const harness = await createKittyRenderer({ events: true })

  try {
    await reportInheritedKittyMode(harness)

    harness.renderer.useKittyKeyboard = false
    await harness.feed.idle()
    const disableOutput = harness.stdout.take()

    const keys: Array<{ name: string; source: string }> = []
    harness.renderer.keyInput.on("keypress", (key) => {
      keys.push({ name: key.name, source: key.source })
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))

    expect({
      poppedEntries: countOccurrences(disableOutput, "\x1b[<u"),
      pushedEntries: countOccurrences(disableOutput, "\x1b[>0u"),
      replacedPreviousMode: occursBefore(disableOutput, "\x1b[<u", "\x1b[>0u"),
      enabledFallback: countOccurrences(disableOutput, "\x1b[>4;1m"),
      enabled: harness.renderer.useKittyKeyboard,
      keys,
    }).toEqual({
      poppedEntries: 1,
      pushedEntries: 1,
      replacedPreviousMode: true,
      enabledFallback: 1,
      enabled: false,
      keys: [{ name: "", source: "raw" }],
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("Kitty lifecycle output remains pending until an asynchronous Writable callback completes", async () => {
  const harness = await createKittyRenderer({ events: true })

  try {
    await reportInheritedKittyMode(harness)
    harness.stdout.deferWriteCallbacks()

    harness.renderer.disableKittyKeyboard()
    const idlePromise = harness.feed.idle()
    let idleResolved = false
    void idlePromise.then(() => {
      idleResolved = true
    })
    await Promise.resolve()

    expect({
      backpressured: harness.feed.isBackpressured(),
      idleResolved,
    }).toEqual({
      backpressured: true,
      idleResolved: false,
    })

    harness.stdout.releaseWriteCallbacks()
    await idlePromise
    const disableOutput = harness.stdout.take()

    expect({
      poppedEntries: countOccurrences(disableOutput, "\x1b[<u"),
      pushedEntries: countOccurrences(disableOutput, "\x1b[>0u"),
      enabledFallback: countOccurrences(disableOutput, "\x1b[>4;1m"),
    }).toEqual({
      poppedEntries: 1,
      pushedEntries: 1,
      enabledFallback: 1,
    })
  } finally {
    harness.stdout.releaseWriteCallbacks()
    await destroyKittyRenderer(harness)
  }
})

test("enableKittyKeyboard after null synchronizes terminal state, parsing, getter, and resume", async () => {
  const harness = await createKittyRenderer()

  try {
    await reportInheritedKittyMode(harness)

    harness.renderer.enableKittyKeyboard(7)
    await harness.feed.idle()
    const enableOutput = harness.stdout.take()
    const enabledAfterEnable = harness.renderer.useKittyKeyboard

    const keys: Array<{ name: string; source: string }> = []
    harness.renderer.keyInput.on("keypress", (key) => {
      keys.push({ name: key.name, source: key.source })
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))

    harness.renderer.suspend()
    await harness.feed.idle()
    const suspendOutput = harness.stdout.take()

    harness.renderer.resume()
    await harness.feed.idle()
    const resumeOutput = harness.stdout.take()
    harness.stdin.emit("data", Buffer.from("\x1b[98u"))

    expect({
      enableReplacedPreviousMode: occursBefore(enableOutput, "\x1b[<u", "\x1b[>7u"),
      fallbackDisabled: enableOutput.includes("\x1b[>4;0m"),
      enabledAfterEnable,
      suspendPoppedMode: suspendOutput.includes("\x1b[<u"),
      resumeRestoredMode: resumeOutput.includes("\x1b[>7u"),
      enabledAfterResume: harness.renderer.useKittyKeyboard,
      keys,
    }).toEqual({
      enableReplacedPreviousMode: true,
      fallbackDisabled: true,
      enabledAfterEnable: true,
      suspendPoppedMode: true,
      resumeRestoredMode: true,
      enabledAfterResume: true,
      keys: [
        { name: "a", source: "kitty" },
        { name: "b", source: "kitty" },
      ],
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("disableKittyKeyboard synchronizes terminal state, parsing, getter, fallback, and resume", async () => {
  const harness = await createKittyRenderer({ events: true })

  try {
    await reportInheritedKittyMode(harness)

    harness.renderer.disableKittyKeyboard()
    await harness.feed.idle()
    const disableOutput = harness.stdout.take()
    const enabledAfterDisable = harness.renderer.useKittyKeyboard

    const keys: Array<{ name: string; source: string }> = []
    harness.renderer.keyInput.on("keypress", (key) => {
      keys.push({ name: key.name, source: key.source })
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))
    const kittySourceBeforeSuspend = keys.at(-1)?.source
    harness.stdin.emit("data", Buffer.from("x"))
    const rawNameBeforeSuspend = keys.at(-1)?.name

    harness.renderer.suspend()
    await harness.feed.idle()
    const suspendOutput = harness.stdout.take()

    harness.renderer.resume()
    await harness.feed.idle()
    const resumeOutput = harness.stdout.take()
    harness.stdin.emit("data", Buffer.from("\x1b[98u"))
    const kittySourceAfterResume = keys.at(-1)?.source
    harness.stdin.emit("data", Buffer.from("y"))
    const rawNameAfterResume = keys.at(-1)?.name

    expect({
      disableReplacedPreviousMode: occursBefore(disableOutput, "\x1b[<u", "\x1b[>0u"),
      fallbackEnabled: disableOutput.includes("\x1b[>4;1m"),
      enabledAfterDisable,
      suspendPoppedMode: suspendOutput.includes("\x1b[<u"),
      resumeRestoredMode: resumeOutput.includes("\x1b[>0u"),
      resumeFallbackEnabled: resumeOutput.includes("\x1b[>4;1m"),
      resumeDidNotDisableFallback: !resumeOutput.includes("\x1b[>4;0m"),
      enabledAfterResume: harness.renderer.useKittyKeyboard,
      kittySourceBeforeSuspend,
      rawNameBeforeSuspend,
      kittySourceAfterResume,
      rawNameAfterResume,
    }).toEqual({
      disableReplacedPreviousMode: true,
      fallbackEnabled: true,
      enabledAfterDisable: false,
      suspendPoppedMode: true,
      resumeRestoredMode: true,
      resumeFallbackEnabled: true,
      resumeDidNotDisableFallback: true,
      enabledAfterResume: false,
      kittySourceBeforeSuspend: "raw",
      rawNameBeforeSuspend: "x",
      kittySourceAfterResume: "raw",
      rawNameAfterResume: "y",
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("disableKittyKeyboard masks inherited Kitty input before capability detection", async () => {
  const harness = await createKittyRenderer({ events: true })

  try {
    harness.renderer.disableKittyKeyboard()
    await harness.feed.idle()
    const disableOutput = harness.stdout.take()

    const keys: Array<{ name: string; source: string }> = []
    harness.renderer.keyInput.on("keypress", (key) => {
      keys.push({ name: key.name, source: key.source })
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))

    expect({
      startupEnabledFallback: countOccurrences(harness.initialOutput, "\x1b[>4;1m"),
      startupKittyPushes: countOccurrences(harness.initialOutput, "\x1b[>7u"),
      disablePops: countOccurrences(disableOutput, "\x1b[<u"),
      disablePushes: countOccurrences(disableOutput, "\x1b[>0u"),
      disabledFallback: disableOutput.includes("\x1b[>4;0m"),
      enabled: harness.renderer.useKittyKeyboard,
      keys,
    }).toEqual({
      startupEnabledFallback: 1,
      startupKittyPushes: 0,
      disablePops: 0,
      disablePushes: 1,
      disabledFallback: false,
      enabled: false,
      keys: [{ name: "", source: "raw" }],
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("disableKittyKeyboard before setup defers terminal writes until setup", async () => {
  const harness = await createKittyRenderer({ events: true }, false)

  try {
    harness.renderer.disableKittyKeyboard()
    await harness.feed.idle()
    const outputBeforeSetup = harness.stdout.take()
    const enabledBeforeSetup = harness.renderer.useKittyKeyboard

    await harness.renderer.setupTerminal()
    await harness.feed.idle()
    const setupOutput = harness.stdout.take()
    const activationOutput = await reportInheritedKittyMode(harness)

    expect({
      outputBeforeSetup,
      enabledBeforeSetup,
      setupPushes: countOccurrences(setupOutput, "\x1b[>0u"),
      activationPushes: countOccurrences(activationOutput, "\x1b[>0u"),
    }).toEqual({
      outputBeforeSetup: "",
      enabledBeforeSetup: false,
      setupPushes: 1,
      activationPushes: 0,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("disableKittyKeyboard while suspended defers terminal writes until resume", async () => {
  const harness = await createKittyRenderer({ events: true })

  try {
    await reportInheritedKittyMode(harness)
    harness.renderer.suspend()
    await harness.feed.idle()
    harness.stdout.take()

    harness.renderer.disableKittyKeyboard()
    await harness.feed.idle()
    const outputWhileSuspended = harness.stdout.take()
    const enabledWhileSuspended = harness.renderer.useKittyKeyboard

    harness.renderer.resume()
    await harness.feed.idle()
    const resumeOutput = harness.stdout.take()

    expect({
      outputWhileSuspended,
      enabledWhileSuspended,
      resumePushedZero: resumeOutput.includes("\x1b[>0u"),
      resumeEnabledFallback: resumeOutput.includes("\x1b[>4;1m"),
    }).toEqual({
      outputWhileSuspended: "",
      enabledWhileSuspended: false,
      resumePushedZero: true,
      resumeEnabledFallback: true,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("capability handling does not reactivate Kitty after an input handler suspends the renderer", async () => {
  const harness = await createKittyRenderer()

  try {
    harness.renderer.prependInputHandler((sequence) => {
      if (sequence !== "\x1b[?1u") return false
      harness.renderer.suspend()
      return false
    })

    harness.stdin.emit("data", Buffer.from("\x1b[?1u"))
    await harness.feed.idle()
    const suspendOutput = harness.stdout.take()

    harness.renderer.resume()
    await harness.feed.idle()
    const resumeOutput = harness.stdout.take()

    expect({
      capabilityDetected: harness.renderer.capabilities?.kitty_keyboard,
      suspendPops: countOccurrences(suspendOutput, "\x1b[<u"),
      suspendPushes: countOccurrences(suspendOutput, "\x1b[>0u"),
      suspendFallbackEnables: countOccurrences(suspendOutput, "\x1b[>4;1m"),
      suspendGraphicsQueries: countOccurrences(suspendOutput, KITTY_GRAPHICS_QUERY),
      resumePushes: countOccurrences(resumeOutput, "\x1b[>0u"),
      resumeFallbackEnables: countOccurrences(resumeOutput, "\x1b[>4;1m"),
      resumeGraphicsQueries: countOccurrences(resumeOutput, KITTY_GRAPHICS_QUERY),
    }).toEqual({
      capabilityDetected: true,
      suspendPops: 1,
      suspendPushes: 0,
      suspendFallbackEnables: 0,
      suspendGraphicsQueries: 0,
      resumePushes: 1,
      resumeFallbackEnables: 1,
      resumeGraphicsQueries: 1,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("resume before a capability response preserves pending queries until the response arrives", async () => {
  const harness = await createKittyRenderer()

  try {
    harness.renderer.suspend()
    await harness.feed.idle()
    harness.stdout.take()

    harness.renderer.resume()
    await harness.feed.idle()
    const resumeOutput = harness.stdout.take()

    const capabilityOutput = await reportInheritedKittyMode(harness)

    expect({
      resumePushes: countOccurrences(resumeOutput, "\x1b[>0u"),
      resumeGraphicsQueries: countOccurrences(resumeOutput, KITTY_GRAPHICS_QUERY),
      capabilityDetected: harness.renderer.capabilities?.kitty_keyboard,
      capabilityPushes: countOccurrences(capabilityOutput, "\x1b[>0u"),
      capabilityGraphicsQueries: countOccurrences(capabilityOutput, KITTY_GRAPHICS_QUERY),
    }).toEqual({
      resumePushes: 1,
      resumeGraphicsQueries: 0,
      capabilityDetected: true,
      capabilityPushes: 0,
      capabilityGraphicsQueries: 1,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("enableKittyKeyboard preserves modifyOtherKeys when Kitty support was not detected", async () => {
  const harness = await createKittyRenderer()

  try {
    harness.stdin.emit("data", Buffer.from("\x1b[c"))
    await harness.feed.idle()
    harness.stdout.take()

    harness.renderer.enableKittyKeyboard(7)
    await harness.feed.idle()
    const enableOutput = harness.stdout.take()

    expect({
      startupEnabledFallback: countOccurrences(harness.initialOutput, "\x1b[>4;1m"),
      attemptedKittyPushes: countOccurrences(enableOutput, "\x1b[>7u"),
      disabledFallback: countOccurrences(enableOutput, "\x1b[>4;0m"),
    }).toEqual({
      startupEnabledFallback: 1,
      attemptedKittyPushes: 1,
      disabledFallback: 0,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("enableKittyKeyboard with zero flags preserves the modifyOtherKeys fallback", async () => {
  const harness = await createKittyRenderer()

  try {
    await reportInheritedKittyMode(harness)

    harness.renderer.enableKittyKeyboard(0)
    await harness.feed.idle()

    const enableOutput = harness.stdout.take()
    expect({
      startupEnabledFallback: countOccurrences(harness.initialOutput, "\x1b[>4;1m"),
      disabledFallback: countOccurrences(enableOutput, "\x1b[>4;0m"),
    }).toEqual({
      startupEnabledFallback: 1,
      disabledFallback: 0,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("runtime Kitty changes before setup are deferred until setup", async () => {
  const harness = await createKittyRenderer(null, false)

  try {
    harness.renderer.enableKittyKeyboard(7)
    await harness.feed.idle()
    const enableOutput = harness.stdout.take()
    const enabledAfterEnable = harness.renderer.useKittyKeyboard

    harness.renderer.disableKittyKeyboard()
    await harness.feed.idle()
    const disableOutput = harness.stdout.take()
    const enabledAfterDisable = harness.renderer.useKittyKeyboard

    await harness.renderer.setupTerminal()
    await harness.feed.idle()
    const setupOutput = harness.stdout.take()
    const activationOutput = await reportInheritedKittyMode(harness)

    expect({
      enableOutput,
      enabledAfterEnable,
      disableOutput,
      enabledAfterDisable,
      setupPushes: countOccurrences(setupOutput, "\x1b[>0u"),
      activationPushes: countOccurrences(activationOutput, "\x1b[>0u"),
      keptFallback: !setupOutput.includes("\x1b[>4;0m") && !activationOutput.includes("\x1b[>4;0m"),
    }).toEqual({
      enableOutput: "",
      enabledAfterEnable: true,
      disableOutput: "",
      enabledAfterDisable: false,
      setupPushes: 1,
      activationPushes: 0,
      keptFallback: true,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("runtime Kitty changes while suspended are deferred until resume", async () => {
  const harness = await createKittyRenderer()

  try {
    await reportInheritedKittyMode(harness)
    harness.renderer.suspend()
    await harness.feed.idle()
    harness.stdout.take()

    harness.renderer.enableKittyKeyboard(7)
    await harness.feed.idle()
    const positiveEnableOutput = harness.stdout.take()

    harness.renderer.enableKittyKeyboard(0)
    await harness.feed.idle()
    const zeroEnableOutput = harness.stdout.take()

    harness.renderer.resume()
    await harness.feed.idle()
    const resumeOutput = harness.stdout.take()

    expect({
      positiveEnableOutput,
      zeroEnableOutput,
      resumePushedZero: resumeOutput.includes("\x1b[>0u"),
      resumeEnabledFallback: resumeOutput.includes("\x1b[>4;1m"),
    }).toEqual({
      positiveEnableOutput: "",
      zeroEnableOutput: "",
      resumePushedZero: true,
      resumeEnabledFallback: true,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("changing enabled Kitty flags to zero restores modifyOtherKeys", async () => {
  const harness = await createKittyRenderer({ events: true })

  try {
    await reportInheritedKittyMode(harness)

    harness.renderer.enableKittyKeyboard(0)
    await harness.feed.idle()
    const enableOutput = harness.stdout.take()

    expect({
      replacedPreviousMode: occursBefore(enableOutput, "\x1b[<u", "\x1b[>0u"),
      restoredFallback: enableOutput.includes("\x1b[>4;1m"),
    }).toEqual({
      replacedPreviousMode: true,
      restoredFallback: true,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})

test("repeated enableKittyKeyboard preserves fallback without detected support", async () => {
  const harness = await createKittyRenderer()

  try {
    harness.stdin.emit("data", Buffer.from("\x1b[c"))
    await harness.feed.idle()
    harness.stdout.take()

    harness.renderer.enableKittyKeyboard(7)
    await harness.feed.idle()
    const firstEnableOutput = harness.stdout.take()

    harness.renderer.enableKittyKeyboard(7)
    await harness.feed.idle()

    const repeatedEnableOutput = harness.stdout.take()
    expect({
      startupEnabledFallback: countOccurrences(harness.initialOutput, "\x1b[>4;1m"),
      firstEnablePops: countOccurrences(firstEnableOutput, "\x1b[<u"),
      firstEnablePushes: countOccurrences(firstEnableOutput, "\x1b[>7u"),
      firstEnableDisabledFallback: countOccurrences(firstEnableOutput, "\x1b[>4;0m"),
      pushedEntries: countOccurrences(repeatedEnableOutput, "\x1b[>7u"),
      poppedEntries: countOccurrences(repeatedEnableOutput, "\x1b[<u"),
      disabledFallback: countOccurrences(repeatedEnableOutput, "\x1b[>4;0m"),
    }).toEqual({
      startupEnabledFallback: 1,
      firstEnablePops: 1,
      firstEnablePushes: 1,
      firstEnableDisabledFallback: 0,
      pushedEntries: 0,
      poppedEntries: 0,
      disabledFallback: 0,
    })
  } finally {
    await destroyKittyRenderer(harness)
  }
})
