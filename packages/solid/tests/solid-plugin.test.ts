import { describe, expect, it } from "bun:test"
import {
  SOLID_SERVER_RUNTIME_FILTER,
  SOLID_STORE_SERVER_RUNTIME_FILTER,
  rewriteSolidServerRuntimePath,
  rewriteSolidStoreServerRuntimePath,
} from "../scripts/solid-plugin-paths"

describe("solid bun plugin server runtime filters", () => {
  it("matches Solid server runtime path for unix and windows separators", () => {
    const unixPath = "/tmp/node_modules/solid-js/dist/server.js"
    const windowsPath = "C:\\tmp\\node_modules\\solid-js\\dist\\server.js"

    expect(SOLID_SERVER_RUNTIME_FILTER.test(unixPath)).toBe(true)
    expect(SOLID_SERVER_RUNTIME_FILTER.test(windowsPath)).toBe(true)
    expect(rewriteSolidServerRuntimePath(unixPath)).toBe("/tmp/node_modules/solid-js/dist/solid.js")
    expect(rewriteSolidServerRuntimePath(windowsPath)).toBe("C:\\tmp\\node_modules\\solid-js\\dist\\solid.js")
  })

  it("matches Solid store server runtime path for unix and windows separators", () => {
    const unixPath = "/tmp/node_modules/solid-js/store/dist/server.js"
    const windowsPath = "C:\\tmp\\node_modules\\solid-js\\store\\dist\\server.js"

    expect(SOLID_STORE_SERVER_RUNTIME_FILTER.test(unixPath)).toBe(true)
    expect(SOLID_STORE_SERVER_RUNTIME_FILTER.test(windowsPath)).toBe(true)
    expect(rewriteSolidStoreServerRuntimePath(unixPath)).toBe("/tmp/node_modules/solid-js/store/dist/store.js")
    expect(rewriteSolidStoreServerRuntimePath(windowsPath)).toBe(
      "C:\\tmp\\node_modules\\solid-js\\store\\dist\\store.js",
    )
  })

  it("does not match non-server runtime paths", () => {
    expect(SOLID_SERVER_RUNTIME_FILTER.test("/tmp/node_modules/solid-js/dist/client.js")).toBe(false)
    expect(SOLID_STORE_SERVER_RUNTIME_FILTER.test("/tmp/node_modules/solid-js/store/dist/client.js")).toBe(false)
  })
})
