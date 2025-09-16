#!/usr/bin/env bun

/**
 * Simple Interactive Terminal Demo
 * 
 * A minimal terminal emulator using libvterm that provides a fully interactive shell.
 * You can type commands and interact with it like a normal terminal.
 */

import { createCliRenderer, BoxRenderable } from "../index"
import { TerminalRenderer } from "../renderables/TerminalRenderer"
import { setRenderLibPath } from "../zig"
import { parseKeypress } from "../lib/parse.keypress"

async function main() {
  try {
    const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
    const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
    const ext = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so"
    const libPath = new URL(`../zig/lib/${arch}-${os}/libopentui.${ext}`, import.meta.url).pathname
    setRenderLibPath(libPath)
  } catch (e) {
    console.warn("⚠️  Failed to load local libopentui library", e)
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30
  })

  renderer.useMouse = true
  renderer.setBackgroundColor("#001122")

  renderer.console.show()

  const container = new BoxRenderable(renderer, {
    position: "absolute",
    left: 2,
    top: 1,
    width: renderer.width - 4,
    height: renderer.height - 2,
    border: true,
    borderStyle: "single",
    borderColor: "#00AAFF",
    title: "Terminal (libvterm)",
    backgroundColor: "#000000",
  })

  const terminalCols = Math.max(10, container.width - 2)
  const terminalRows = Math.max(5, container.height - 2)
    
  const terminal = new TerminalRenderer(renderer, {
    width: container.width - 2,  // Account for container border
    height: container.height - 2, // Account for container border
    cols: terminalCols,
    rows: terminalRows,
    shell: "bash",
    backgroundColor: "#000000",
    autoFocus: true,
  })

  container.add(terminal)
  renderer.root.add(container)

  renderer.on("resize", () => {
    container.width = renderer.width - 4
    container.height = renderer.height - 2
    terminal.width = container.width - 2
    terminal.height = container.height - 2
    terminal.cols = Math.max(10, container.width - 2)
    terminal.rows = Math.max(5, container.height - 2)
  })

  renderer.on("key", (data: Buffer) => {
    const key = parseKeypress(data)

    if (key.raw === "\u0003") return

    terminal.handleKeyPress(key)
  })

  renderer.focusRenderable(terminal)

  renderer.start()

  console.log("🚀 Simple Terminal Demo Started!")
  console.log("💡 Type commands normally. Press Ctrl+C to exit.")
  console.log(`📊 Terminal: ${terminalCols}x${terminalRows} characters`)
  console.log(`🔧 Backend: ${terminal.hasLibvtermSupport ? "libvterm" : "basic PTY"}`)
  console.log("📋 Copy/Paste:")
  console.log("   - Copy: Ctrl+Shift+C")
  console.log("   - Paste: Ctrl+Shift+V")
}

if (import.meta.main) {
  main().catch(console.error)
}