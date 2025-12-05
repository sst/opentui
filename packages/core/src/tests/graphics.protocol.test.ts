import { afterEach, describe, expect, test } from "bun:test"
import { detectGraphicsSupport } from "../graphics/protocol"
import { clearEnvCache } from "../lib/env"

const originalTermProgram = process.env.TERM_PROGRAM
const originalTerm = process.env.TERM
const originalPreferKitty = process.env.OTUI_PREFER_KITTY_GRAPHICS

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

afterEach(() => {
  setEnv("TERM_PROGRAM", originalTermProgram)
  setEnv("TERM", originalTerm)
  setEnv("OTUI_PREFER_KITTY_GRAPHICS", originalPreferKitty)
  clearEnvCache()
})

describe("detectGraphicsSupport", () => {
  test("detects iTerm2 via TERM_PROGRAM", () => {
    setEnv("TERM_PROGRAM", "iTerm.app")
    setEnv("TERM", "xterm-256color")
    clearEnvCache()

    expect(detectGraphicsSupport().protocol).toBe("iterm2")
  })

  test("detects kitty via TERM", () => {
    setEnv("TERM_PROGRAM", "")
    setEnv("TERM", "xterm-kitty")
    clearEnvCache()

    expect(detectGraphicsSupport().protocol).toBe("kitty")
  })

  test("prefers kitty when override is set", () => {
    setEnv("TERM_PROGRAM", "")
    setEnv("TERM", "xterm-256color")
    setEnv("OTUI_PREFER_KITTY_GRAPHICS", "true")
    clearEnvCache()

    expect(detectGraphicsSupport().protocol).toBe("kitty")
  })

  test("falls back to none when no graphics are detected", () => {
    setEnv("TERM_PROGRAM", "")
    setEnv("TERM", "xterm-256color")
    setEnv("OTUI_PREFER_KITTY_GRAPHICS", "false")
    clearEnvCache()

    expect(detectGraphicsSupport().protocol).toBe("none")
  })
})
