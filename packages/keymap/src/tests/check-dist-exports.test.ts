import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "bun:test"

interface DistPackageJson {
  exports?: Record<string, { import?: string }>
}

test("dist package exports resolve when dist exists", async () => {
  const rootDir = resolve(import.meta.dir, "..", "..")
  const distDir = resolve(rootDir, "dist")
  const distPackageJsonPath = resolve(distDir, "package.json")

  if (!existsSync(distPackageJsonPath)) {
    return
  }

  const distPackageJson = JSON.parse(readFileSync(distPackageJsonPath, "utf8")) as DistPackageJson
  const expectedExports = [
    ".",
    "./extras",
    "./addons",
    "./addons/opentui",
    "./html",
    "./opentui",
    "./react",
    "./solid",
    "./runtime-modules",
  ] as const

  for (const exportName of expectedExports) {
    const entry = distPackageJson.exports?.[exportName]

    expect(entry?.import).toBeDefined()

    const filePath = resolve(distDir, entry!.import!)
    expect(existsSync(filePath)).toBe(true)

    await import(pathToFileURL(filePath).href)
  }
})
