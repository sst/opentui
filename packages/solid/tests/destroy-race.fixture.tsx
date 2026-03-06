import { createTestRenderer } from "@opentui/core/testing"
import { render, testRender, useRenderer } from "../index"

type Mode = "external" | "helper"

const mode = process.argv[2] as Mode | undefined
const startedAt = Date.now()

const log = (message: string): void => {
  const elapsed = Date.now() - startedAt
  console.debug(`[solid-destroy-race-fixture ${mode ?? "unknown"} +${elapsed}ms] ${message}`)
}

let didDestroy = false

function App() {
  const renderer = useRenderer()
  log("App render started")

  if (!didDestroy) {
    didDestroy = true
    log("Destroying renderer from render body")
    renderer.destroy()
    log("renderer.destroy() returned")
  }

  return <text>race repro</text>
}

if (mode === "external") {
  const testSetup = await createTestRenderer({ width: 30, height: 10 })
  await render(() => <App />, testSetup.renderer)
  await Bun.sleep(10)

  if (!testSetup.renderer.isDestroyed) {
    testSetup.renderer.destroy()
  }

  log("External mode completed")
} else if (mode === "helper") {
  const testSetup = await testRender(() => <App />, { width: 30, height: 10 })
  await testSetup.renderOnce()
  await Bun.sleep(10)

  if (!testSetup.renderer.isDestroyed) {
    testSetup.renderer.destroy()
  }

  log("Helper mode completed")
} else {
  throw new Error(`Unknown mode: ${String(mode)}`)
}
