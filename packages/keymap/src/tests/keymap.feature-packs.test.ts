import { expect, test } from "bun:test"
import { BaseKeymap, Keymap } from "../index.js"
import { registerDefaultKeys } from "../addons/index.js"
import { createTestKeymapHost } from "../testing/index.js"
import { createGraphFeature } from "../features/graph.js"
import { createLayerDiagnosticsFeature } from "../features/diagnostics.js"

test("default Keymap installs layer diagnostics but not graph", () => {
  const host = createTestKeymapHost()
  const keymap = new Keymap(host)

  expect(typeof keymap.appendLayerAnalyzer).toBe("function")
  expect(() => keymap.getGraphSnapshot()).toThrow("Keymap graph feature is not installed")
})

test("BaseKeymap can install graph and diagnostics feature packs explicitly", () => {
  const host = createTestKeymapHost()
  const keymap = new BaseKeymap(host, {
    graph: createGraphFeature,
    diagnostics: createLayerDiagnosticsFeature,
  })

  expect(keymap.getGraphSnapshot().layers).toEqual([])
  expect(typeof keymap.appendLayerAnalyzer).toBe("function")
})

test("BaseKeymap runs bindings without graph or layer diagnostics features", () => {
  const host = createTestKeymapHost()
  const keymap = new BaseKeymap(host)
  let ran = false

  registerDefaultKeys(keymap)
  keymap.registerLayer({
    bindings: [
      {
        key: "x",
        cmd() {
          ran = true
        },
      },
    ],
  })

  host.press("x")

  expect(ran).toBe(true)
  expect(() => keymap.getGraphSnapshot()).toThrow("Keymap graph feature is not installed")
  expect(() => keymap.appendLayerAnalyzer(() => {})).toThrow("Keymap diagnostics feature is not installed")
})
