/**
 * Smoke-tests the packed npm consumer contract for `@opentui/react`.
 *
 * This verifies the built React and Core tarballs install in a fresh project
 * and that Node can import React's public ESM entrypoints without Bun's more
 * permissive extension resolution.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { requireNode26 } from "../../../scripts/node26.mjs"

interface PackageJson {
  name: string
  peerDependencies?: Record<string, string>
  version: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = resolve(__dirname, "..")
const coreRootDir = resolve(rootDir, "..", "core")
const distDir = join(rootDir, "dist")
const coreDistDir = join(coreRootDir, "dist")
const args = new Set(process.argv.slice(2))
const keepTemp = args.has("--keep-temp")
const skipBuild = args.has("--skip-build")
const nodePath = requireNode26()
const commandTimeoutMs = 5 * 60 * 1000

const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as PackageJson
const corePackageJson = JSON.parse(readFileSync(join(coreRootDir, "package.json"), "utf8")) as PackageJson

function runCommand(
  command: string,
  commandArgs: string[],
  cwd: string,
  errorMessage: string,
  options: { stdio?: "inherit" | "pipe" } = {},
): SpawnSyncReturns<Buffer> {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: options.stdio ?? "inherit",
    timeout: commandTimeoutMs,
  })

  if (result.error) {
    throw new Error(`${errorMessage}: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(errorMessage)
  }

  return result
}

function ensureBuildArtifacts(): void {
  if (!skipBuild) {
    runCommand("bun", ["run", "build:lib"], coreRootDir, "Core library build failed")
    runCommand("bun", ["run", "build", "--ci"], rootDir, "React build failed")
  }

  if (!existsSync(coreDistDir)) {
    throw new Error(`Missing core dist directory at ${coreDistDir}. Run bun run build:lib in packages/core first.`)
  }

  if (!existsSync(distDir)) {
    throw new Error(`Missing React dist directory at ${distDir}. Run bun run build first.`)
  }
}

function packArtifact(packageDir: string, packDir: string): string {
  const result = runCommand(
    "npm",
    ["pack", "--pack-destination", packDir],
    packageDir,
    `Failed to pack ${packageDir}`,
    { stdio: "pipe" },
  )

  const tarballName = result.stdout.toString("utf8").trim().split(/\r?\n/).at(-1)
  if (!tarballName) {
    throw new Error(`Failed to determine tarball name for ${packageDir}`)
  }

  return join(packDir, tarballName)
}

function writeConsumerPackage(consumerDir: string, reactTarball: string, coreTarball: string): void {
  const reactDependency = `file:${relative(consumerDir, reactTarball).replaceAll("\\", "/")}`
  const coreDependency = `file:${relative(consumerDir, coreTarball).replaceAll("\\", "/")}`

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "opentui-react-dist-test-node",
        private: true,
        type: "module",
        dependencies: {
          [packageJson.name]: reactDependency,
          [corePackageJson.name]: coreDependency,
          react: packageJson.peerDependencies?.react ?? ">=19.2.0",
        },
      },
      null,
      2,
    ),
  )
}

function writeNodeTest(consumerDir: string): void {
  writeFileSync(
    join(consumerDir, "index.mjs"),
    `import assert from "node:assert/strict"

const reactRuntime = await import(${JSON.stringify(packageJson.name)})
const rendererRuntime = await import(${JSON.stringify(`${packageJson.name}/renderer`)})
const testUtilsRuntime = await import(${JSON.stringify(`${packageJson.name}/test-utils`)})
const jsxRuntime = await import(${JSON.stringify(`${packageJson.name}/jsx-runtime`)})
const jsxDevRuntime = await import(${JSON.stringify(`${packageJson.name}/jsx-dev-runtime`)})

assert.equal(typeof reactRuntime.createRoot, "function")
assert.equal(typeof rendererRuntime.createRoot, "function")
assert.equal(typeof testUtilsRuntime.testRender, "function")
assert.equal(typeof jsxRuntime.jsx, "function")
assert.equal(typeof jsxRuntime.jsxs, "function")
assert.equal(typeof jsxRuntime.Fragment, "symbol")
assert.equal(typeof jsxDevRuntime.jsxDEV, "function")

console.log("Node React dist import smoke test passed")
`,
  )
}

function installAndTest(consumerDir: string): void {
  runCommand("npm", ["install", "--ignore-scripts", "--no-package-lock"], consumerDir, "Node dist test install failed")
  runCommand(nodePath, ["index.mjs"], consumerDir, "Node React dist import smoke test failed")
}

let tempRoot: string | undefined

try {
  ensureBuildArtifacts()

  tempRoot = mkdtempSync(join(tmpdir(), "opentui-react-dist-test-"))
  const packDir = join(tempRoot, "packs")
  const consumerDir = join(tempRoot, "consumer")

  mkdirSync(packDir, { recursive: true })
  mkdirSync(consumerDir, { recursive: true })

  const coreTarball = packArtifact(coreDistDir, packDir)
  const reactTarball = packArtifact(distDir, packDir)

  writeConsumerPackage(consumerDir, reactTarball, coreTarball)
  writeNodeTest(consumerDir)
  installAndTest(consumerDir)

  if (!keepTemp) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = undefined
  }

  console.log("Packed React dist smoke tests passed")
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  if (tempRoot) {
    console.error(`Dist test workspace kept at ${tempRoot}`)
  }
  process.exit(1)
}
