import { describe, expect, test } from "bun:test"

async function getCapabilitiesFromChild(options: { remote?: boolean }, env: Record<string, string>): Promise<any> {
  const testRendererUrl = new URL("../testing/test-renderer.ts", import.meta.url).href
  const script = `
    import { createTestRenderer } from ${JSON.stringify(testRendererUrl)}

    const { renderer } = await createTestRenderer(${JSON.stringify(options)})
    const internals = renderer
    const caps = internals.lib.getTerminalCapabilities(renderer.rendererPtr)
    console.log(JSON.stringify(caps))
    renderer.destroy()
  `
  const proc = Bun.spawn([process.execPath, "--eval", script], {
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`Child renderer failed with exit ${exitCode}: ${stderr}`)
  }

  const line = stdout.trim().split(/\r?\n/).at(-1)
  if (!line) {
    throw new Error(`Child renderer did not emit capabilities: ${stderr}`)
  }
  return JSON.parse(line)
}

describe("remote detection", () => {
  test("auto remote mode detects SSH and skips default terminal env forwarding", async () => {
    const caps = await getCapabilitiesFromChild(
      {},
      {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        SSH_CONNECTION: "192.0.2.1 54231 192.0.2.2 22",
        TERM: "xterm-256color",
        TERM_PROGRAM: "ghostty",
        TERM_PROGRAM_VERSION: "1.3.1",
      },
    )

    expect(caps.remote).toBe(true)
    expect(caps.ansi256).toBe(false)
    expect(caps.notifications).toBe(false)
    expect(caps.terminal.name).toBe("")
  })

  test("explicit local mode overrides SSH remote detection", async () => {
    const caps = await getCapabilitiesFromChild(
      { remote: false },
      {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        SSH_TTY: "/dev/pts/1",
        TERM: "xterm-256color",
        TERM_PROGRAM: "ghostty",
        TERM_PROGRAM_VERSION: "1.3.1",
      },
    )

    expect(caps.remote).toBe(false)
    expect(caps.ansi256).toBe(true)
    expect(caps.notifications).toBe(true)
    expect(caps.terminal.name).toBe("ghostty")
  })

  test("explicit local mode detects Zellij and suppresses inherited host notification heuristics", async () => {
    const caps = await getCapabilitiesFromChild(
      { remote: false },
      {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        ZELLIJ: "0",
        ZELLIJ_SESSION_NAME: "test-session",
        ZELLIJ_PANE_ID: "1",
        TERM: "xterm-256color",
        TERM_PROGRAM: "ghostty",
        TERM_PROGRAM_VERSION: "1.3.1",
        WT_SESSION: "outer-windows-terminal-session",
        TERM_FEATURES: "T2NoH",
      },
    )

    expect(caps.remote).toBe(false)
    expect(caps.multiplexer).toBe("zellij")
    expect(caps.notifications).toBe(false)
    expect(caps.terminal.name).toBe("Zellij")
  })

  test("explicit remote mode does not require SSH environment", async () => {
    const caps = await getCapabilitiesFromChild(
      { remote: true },
      {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        TERM: "xterm-256color",
        TERM_PROGRAM: "ghostty",
        TERM_PROGRAM_VERSION: "1.3.1",
      },
    )

    expect(caps.remote).toBe(true)
    expect(caps.ansi256).toBe(false)
    expect(caps.notifications).toBe(false)
    expect(caps.terminal.name).toBe("")
  })
})
