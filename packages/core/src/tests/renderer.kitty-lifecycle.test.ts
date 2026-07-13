import { Buffer } from "node:buffer"

import { expect, test } from "bun:test"

import type { NativeSpanFeed } from "../NativeSpanFeed.js"
import { CliRenderer, type KittyKeyboardOptions } from "../renderer.js"
import { createTestStdin, TestWriteStream } from "../testing/test-streams.js"

class CollectingWriteStream extends TestWriteStream {
  private readonly writes: Buffer[] = []

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const bytes = chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk))
    this.writes.push(bytes)
    callback()
  }

  public take(): string {
    const output = Buffer.concat(this.writes).toString("latin1")
    this.writes.length = 0
    return output
  }
}

interface KittyRendererHarness {
  renderer: CliRenderer
  stdin: NodeJS.ReadStream
  stdout: CollectingWriteStream
  feed: NativeSpanFeed
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
    stdout.take()
    return { renderer, stdin, stdout, feed }
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

test("useKittyKeyboard: null masks an inherited Kitty mode for the renderer lifetime", async () => {
  const harness = await createKittyRenderer()

  try {
    const activationOutput = await reportInheritedKittyMode(harness)
    expect(activationOutput).toContain("\x1b[>0u")
    expect(activationOutput).not.toContain("\x1b[<u")

    let inputSource: string | undefined
    harness.renderer.keyInput.once("keypress", (key) => {
      inputSource = key.source
    })
    harness.stdin.emit("data", Buffer.from("\x1b[97u"))
    expect(inputSource).not.toBe("kitty")

    const shutdownOutput = await destroyKittyRenderer(harness)
    expect(shutdownOutput).toContain("\x1b[<u")
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
      pushedZero: activationOutput.includes("\x1b[>0u"),
      disabledFallback: activationOutput.includes("\x1b[>4;0m"),
      inputSource,
    }).toEqual({
      pushedZero: true,
      disabledFallback: false,
      inputSource: "kitty",
    })
  } finally {
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

test("disableKittyKeyboard before setup defers terminal writes until setup", async () => {
  const harness = await createKittyRenderer({ events: true }, false)

  try {
    harness.renderer.disableKittyKeyboard()
    await harness.feed.idle()
    const outputBeforeSetup = harness.stdout.take()
    const enabledBeforeSetup = harness.renderer.useKittyKeyboard

    await harness.renderer.setupTerminal()
    await harness.feed.idle()
    harness.stdout.take()
    const activationOutput = await reportInheritedKittyMode(harness)

    expect({
      outputBeforeSetup,
      enabledBeforeSetup,
      activationPushedZero: activationOutput.includes("\x1b[>0u"),
    }).toEqual({
      outputBeforeSetup: "",
      enabledBeforeSetup: false,
      activationPushedZero: true,
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
      attemptedKittyPush: enableOutput.includes("\x1b[>7u"),
      disabledFallback: enableOutput.includes("\x1b[>4;0m"),
    }).toEqual({
      attemptedKittyPush: true,
      disabledFallback: false,
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

    expect(harness.stdout.take()).not.toContain("\x1b[>4;0m")
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
    harness.stdout.take()
    const activationOutput = await reportInheritedKittyMode(harness)

    expect({
      enableOutput,
      enabledAfterEnable,
      disableOutput,
      enabledAfterDisable,
      activationPushedZero: activationOutput.includes("\x1b[>0u"),
      activationKeptFallback: !activationOutput.includes("\x1b[>4;0m"),
    }).toEqual({
      enableOutput: "",
      enabledAfterEnable: true,
      disableOutput: "",
      enabledAfterDisable: false,
      activationPushedZero: true,
      activationKeptFallback: true,
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
    harness.stdout.take()

    harness.renderer.enableKittyKeyboard(7)
    await harness.feed.idle()

    expect(harness.stdout.take()).not.toContain("\x1b[>4;0m")
  } finally {
    await destroyKittyRenderer(harness)
  }
})
