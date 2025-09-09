#!/usr/bin/env bun
import { createCliRenderer, BoxRenderable, RGBA, type CliRenderer } from "../index"
import { setRenderLibPath } from "../zig"
import { NativePtySession } from "../pty"
import { getKeyHandler } from "../lib/KeyHandler"

let renderer: CliRenderer | null = null
let leftBox: BoxRenderable | null = null
let rightBox: BoxRenderable | null = null
let left: NativePtySession | null = null
let right: NativePtySession | null = null
let active: "left" | "right" = "left"

function setActivePane(which: "left" | "right") {
  active = which
  if (leftBox && rightBox) {
    const ACTIVE = "#00AAFF"
    const INACTIVE = "#FFFFFF"
    leftBox.borderColor = which === "left" ? ACTIVE : INACTIVE
    rightBox.borderColor = which === "right" ? ACTIVE : INACTIVE
  }
}

function layout(renderer: CliRenderer) {
  const totalW = renderer.width
  const totalH = renderer.height
  const gutter = 1
  const panelW = Math.floor((totalW - 3) / 2)
  const panelH = totalH

  if (!leftBox) {
    leftBox = new BoxRenderable(renderer, {
      id: "pty-left",
      position: "absolute",
      left: 0,
      top: 0,
      width: panelW,
      height: panelH,
      border: true,
      borderStyle: "single",
      title: "Left",
      backgroundColor: RGBA.fromInts(16, 20, 28, 255),
      onMouseDown() {
        setActivePane("left")
      },
    })
    renderer.root.add(leftBox)
  }
  if (!rightBox) {
    rightBox = new BoxRenderable(renderer, {
      id: "pty-right",
      position: "absolute",
      left: panelW + 2,
      top: 0,
      width: panelW,
      height: panelH,
      border: true,
      borderStyle: "single",
      title: "Right",
      backgroundColor: RGBA.fromInts(16, 20, 28, 255),
      onMouseDown() {
        setActivePane("right")
      },
    })
    renderer.root.add(rightBox)
  }

  leftBox.width = panelW
  leftBox.height = panelH
  rightBox.left = panelW + 2
  rightBox.width = panelW
  rightBox.height = panelH

  const innerW = panelW - 2
  const innerH = panelH - 2
  const w = Math.max(1, innerW)
  const h = Math.max(1, innerH)
  if (left) left.resize(w, h)
  if (right) right.resize(w, h)
}

export async function run(rendererInstance: CliRenderer) {
  // Prefer freshly built native lib over published optional dep
  try {
    const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch
    const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"
    const ext = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so"
    const url = new URL(`../zig/lib/${arch}-${os}/libopentui.${ext}`, import.meta.url)
    setRenderLibPath(url.pathname)
  } catch (e) {
    // ignore; falls back to packaged lib
  }
  renderer = rendererInstance
  // Enable mouse so clicking panes can change active session
  renderer.useMouse = true
  renderer.setBackgroundColor("#001122")

  left = NativePtySession.create(Math.max(20, Math.floor(renderer.width / 2) - 2), renderer.height - 2)
  
  // Small delay to ensure first PTY is fully initialized
  await new Promise(r => setTimeout(r, 100))
  
  right = NativePtySession.create(Math.max(20, Math.floor(renderer.width / 2) - 2), renderer.height - 2)

  // Nudge shells to display prompt
  try {
    left.write("\r\n")
    right.write("\r\n")
  } catch {}

  layout(renderer)

  // Initialize focus indicator
  setActivePane(active)

  renderer.on("resize", () => layout(renderer!))

  const keyHandler = getKeyHandler()
  keyHandler.on("keypress", (key) => {
    // ctrl+c ends app (renderer handles exit usually)
    if (key.raw === "\u0003") return
    if (key.name === "tab") {
      setActivePane(active === "left" ? "right" : "left")
      return
    }

    const target = active === "left" ? left : right
    if (!target) return
    const data = new TextEncoder().encode(key.raw)
    target.write(data)
  })

  // Frame callback pulls PTY and renders both views
  renderer.setFrameCallback(async () => {
    left?.tick()
    right?.tick()
  })

  // Draw sessions in post-process so they respect pane scissor and borders
  renderer.addPostProcessFn((buffer) => {
    if (!renderer || !leftBox || !rightBox) return
    
    const innerLeftX = leftBox.x + 1
    const innerLeftY = leftBox.y + 1
    const innerLeftW = Math.max(1, leftBox.width - 2)
    const innerLeftH = Math.max(1, leftBox.height - 2)

    const innerRightX = rightBox.x + 1
    const innerRightY = rightBox.y + 1
    const innerRightW = Math.max(1, rightBox.width - 2)
    const innerRightH = Math.max(1, rightBox.height - 2)

    // Clip and render left
    buffer.pushScissorRect(innerLeftX, innerLeftY, innerLeftW, innerLeftH)
    left?.render(buffer, innerLeftX, innerLeftY)
    buffer.clearScissorRects()

    // Clip and render right
    buffer.pushScissorRect(innerRightX, innerRightY, innerRightW, innerRightH)
    right?.render(buffer, innerRightX, innerRightY)
    buffer.clearScissorRects()
  })

  renderer.start()
}

export function destroy(rendererInstance: CliRenderer) {
  rendererInstance.clearPostProcessFns()
  if (left) left.destroy()
  if (right) right.destroy()
  if (leftBox) rendererInstance.root.remove(leftBox.id)
  if (rightBox) rendererInstance.root.remove(rightBox.id)
  left = null
  right = null
  leftBox = null
  rightBox = null
}

if (import.meta.main) {
  const r = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 })
  await run(r)
}
