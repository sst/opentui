import { expect, test } from "bun:test"

test("loads asset-free exports under the browser condition", () => {
  const entry = new URL("./index.ts", import.meta.url).href
  const script = `import(${JSON.stringify(entry)}).then(({ ThreeRenderable }) => process.stdout.write(ThreeRenderable.name))`
  const result = Bun.spawnSync([process.execPath, "--conditions=browser", "--eval", script])

  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toBe("ThreeRenderable")
  expect(result.stderr.toString()).toBe("")
})
