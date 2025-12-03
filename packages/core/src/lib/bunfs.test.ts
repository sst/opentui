import { describe, expect, test } from "bun:test"
import { isBunfsPath, getBunfsRootPath } from "./bunfs"

describe("BunFS Path Detection", () => {
  test("Detects paths with $bunfs marker", () => {
    expect(isBunfsPath("/$bunfs/root/file.wasm")).toBe(true)
    expect(isBunfsPath("/some/path/$bunfs/file.wasm")).toBe(true)
  })

  test("Detects POSIX paths starting with //", () => {
    expect(isBunfsPath("//root/file.wasm")).toBe(true)
    expect(isBunfsPath("//some/other/path")).toBe(true)
  })

  test("Detects Windows paths (Forward Slash)", () => {
    expect(isBunfsPath("B:/~BUN/root/file.wasm")).toBe(true)
    expect(isBunfsPath("b:/~bun/root/file.wasm")).toBe(true) // case-insensitive
    expect(isBunfsPath("B:/~BUN/something/else")).toBe(true)
  })

  test("Detects Windows paths (Back Slash)", () => {
    expect(isBunfsPath("B:\\~BUN\\root\\file.wasm")).toBe(true)
    expect(isBunfsPath("b:\\~bun\\root\\file.wasm")).toBe(true) // case-insensitive
    expect(isBunfsPath("B:\\~BUN\\something\\else")).toBe(true)
  })

  test("Ignores standard paths", () => {
    expect(isBunfsPath("C:/Users/Dev/file.wasm")).toBe(false)
    expect(isBunfsPath("./local/file.wasm")).toBe(false)
    expect(isBunfsPath("/usr/local/bin/file")).toBe(false)
    expect(isBunfsPath("../relative/path")).toBe(false)
    expect(isBunfsPath("D:/Some/Path")).toBe(false)
  })

  test("getBunfsRootPath returns platform-appropriate path", () => {
    const rootPath = getBunfsRootPath()
    // Should be one of the two valid formats
    expect(rootPath === "B:/~BUN/root/" || rootPath === "/$bunfs/root/").toBe(true)
  })
})
