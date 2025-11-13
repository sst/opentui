#!/usr/bin/env bun

import { mkdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, "..", "..")
const examplesDir = join(rootDir, "src", "examples")

// Supported platforms and architectures based on bun-webgpu and opentui native binaries
const targets = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  // dawn webgpu used by bun-webgpu is not supported on arm64 linux currently
  // { platform: "linux", arch: "arm64" },
  { platform: "windows", arch: "x64" },
]

// Ensure dist directory exists
const distDir = join(examplesDir, "dist")
mkdirSync(distDir, { recursive: true })

// Get version from package.json
const packageJson = JSON.parse(await Bun.file(join(rootDir, "package.json")).text())
const version = packageJson.version

// Install bun-webgpu for all platforms to ensure cross-compilation works
console.log("Installing bun-webgpu for all platforms...")
const bunWebgpuVersion = packageJson.optionalDependencies?.["bun-webgpu"] || "0.1.3"
await Bun.$`bun install --os="*" --cpu="*" bun-webgpu@${bunWebgpuVersion}`
console.log(`✅ bun-webgpu@${bunWebgpuVersion} installed for all platforms`)
console.log()

console.log(`Building examples executable for all platforms...`)
console.log(`Output directory: ${distDir}`)
console.log()

let successCount = 0
let failCount = 0

for (const { platform: targetPlatform, arch: targetArch } of targets) {
  const exeName = targetPlatform === "windows" ? "opentui-examples.exe" : "opentui-examples"
  const outfile = join(distDir, `${targetPlatform}-${targetArch}`, exeName)
  const outDir = dirname(outfile)

  mkdirSync(outDir, { recursive: true })

  console.log(`Building for ${targetPlatform}-${targetArch}...`)

  try {
    const buildResult = await Bun.build({
      conditions: ["browser"],
      tsconfig: join(rootDir, "tsconfig.json"),
      sourcemap: "external",
      compile: {
        target: `bun-${targetPlatform}-${targetArch}` as any,
        outfile,
        execArgv: [`--user-agent=opentui-examples/${version}`, `--env-file=""`, `--`],
        windows: {},
      },
      entrypoints: [join(examplesDir, "index.ts")],
      define: {
        OPENCODE_VERSION: `'${version}'`,
        OPENCODE_CHANNEL: `'dev'`,
      },
    })

    if (buildResult.logs.length > 0) {
      console.log(`  Build logs for ${targetPlatform}-${targetArch}:`)
      buildResult.logs.forEach((log) => {
        if (log.level === "error") {
          console.error("  ERROR:", log.message)
        } else if (log.level === "warning") {
          console.warn("  WARNING:", log.message)
        } else {
          console.log("  INFO:", log.message)
        }
      })
    }

    if (buildResult.success) {
      console.log(`  ✅ Successfully built: ${outfile}`)

      // Make it executable on Unix-like systems
      if (targetPlatform !== "windows") {
        await Bun.$`chmod +x ${outfile}`
      }

      successCount++
    } else {
      console.error(`  ❌ Build failed for ${targetPlatform}-${targetArch}`)
      failCount++
    }
  } catch (error) {
    console.error(`  ❌ Build error for ${targetPlatform}-${targetArch}:`, error)
    failCount++
  }

  console.log()
}

console.log("=".repeat(60))
console.log(`Build complete: ${successCount} succeeded, ${failCount} failed`)
console.log(`Output directory: ${distDir}`)

if (failCount > 0) {
  process.exit(1)
}
