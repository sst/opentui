import { spawnSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const srcDir = join(rootDir, "src")

function collectTestFiles(dir: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)

    if (stat.isDirectory()) {
      files.push(...collectTestFiles(path))
    } else if (entry.endsWith(".test.ts")) {
      files.push(path)
    }
  }

  return files
}

const testFiles = collectTestFiles(srcDir).sort()

for (const file of testFiles) {
  const testPath = relative(rootDir, file)
  console.log(`\nRunning ${testPath}`)

  const result = spawnSync("bun", ["test", testPath], {
    cwd: rootDir,
    stdio: "inherit",
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log(`\nRan ${testFiles.length} JavaScript test files serially.`)
