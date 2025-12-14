import { describe, expect, test } from "bun:test"
import { isBunfsPath, getBunfsRootPath } from "./bunfs"

describe("bunfs", () => {
  test("isBunfsPath detects $bunfs paths", () => {
    expect(isBunfsPath("/$bunfs/root/file.wasm")).toBe(true)
  })

  test("isBunfsPath detects Windows B: paths", () => {
    expect(isBunfsPath("B:\\~BUN\\root\\file.wasm")).toBe(true)
    expect(isBunfsPath("B:/~BUN/root/file.wasm")).toBe(true)
  })

  test("isBunfsPath ignores regular paths", () => {
    expect(isBunfsPath("/usr/local/bin/file")).toBe(false)
    expect(isBunfsPath("C:/Users/file.wasm")).toBe(false)
  })

  test("getBunfsRootPath", () => {
    const root = getBunfsRootPath()
    if (process.platform === "win32") {
      expect(root).toBe("B:\\~BUN\\root")
    } else {
      expect(root).toBe("/$bunfs/root")
    }
  })
})
