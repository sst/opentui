#!/usr/bin/env bun

import { chmodSync, existsSync, mkdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { BunPlugin } from "bun"

interface PackageJson {
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

type BuildTarget = {
  platform: "darwin" | "linux" | "windows"
  arch: "x64" | "arm64"
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageRoot = resolve(__dirname, "..")
const repoRoot = resolve(packageRoot, "../..")
const coreRoot = join(repoRoot, "packages", "core")
const keymapRoot = join(repoRoot, "packages", "keymap")
const threeRoot = join(repoRoot, "packages", "three")
const examplesDir = join(packageRoot, "src")
const usePrebuiltArtifacts = process.env.OPENTUI_EXAMPLES_USE_PREBUILT_ARTIFACTS === "true"
const skipBunWebgpuInstall = process.env.OPENTUI_EXAMPLES_SKIP_BUN_WEBGPU_INSTALL === "true"

// Supported platforms and architectures based on bun-webgpu and opentui native binaries.
const targets: BuildTarget[] = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "windows", arch: "x64" },
]

const distDir = join(packageRoot, "dist")
mkdirSync(distDir, { recursive: true })

const packageJson: PackageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
const version = packageJson.version
const bunWebgpuVersion = packageJson.dependencies?.["bun-webgpu"] ?? packageJson.optionalDependencies?.["bun-webgpu"]

if (!bunWebgpuVersion) {
  throw new Error("bun-webgpu is not installed")
}

const workspaceAliasPlugin: BunPlugin = {
  name: "workspace-alias",
  setup(build) {
    build.onResolve({ filter: /^@opentui\/core$/ }, () => ({
      path: join(coreRoot, "src", "index.ts"),
    }))

    build.onResolve({ filter: /^@opentui\/three$/ }, () => ({
      path: join(threeRoot, "src", "index.ts"),
    }))

    build.onResolve({ filter: /^@opentui\/keymap$/ }, () => ({
      path: join(keymapRoot, "src", "index.ts"),
    }))

    build.onResolve({ filter: /^@opentui\/keymap\/addons\/opentui$/ }, () => ({
      path: join(keymapRoot, "src", "addons", "opentui", "index.ts"),
    }))

    build.onResolve({ filter: /^@opentui\/keymap\/opentui$/ }, () => ({
      path: join(keymapRoot, "src", "opentui.ts"),
    }))
  },
}

function getNativePackageDir(platform: string, arch: string): string {
  const packagePlatform = platform === "windows" ? "win32" : platform
  return join(coreRoot, "node_modules", "@opentui", `core-${packagePlatform}-${arch}`)
}

if (skipBunWebgpuInstall) {
  console.log(`Skipping bun-webgpu install; assuming bun-webgpu@${bunWebgpuVersion} is already prepared`)
} else {
  console.log("Installing bun-webgpu for all platforms...")
  await Bun.$`bun install --os="*" --cpu="*" bun-webgpu@${bunWebgpuVersion}`
  console.log(`✅ bun-webgpu@${bunWebgpuVersion} installed for all platforms`)
}

if (usePrebuiltArtifacts) {
  console.log("Using prebuilt native opentui packages from CI artifacts...")

  for (const { platform, arch } of targets) {
    const packageDir = getNativePackageDir(platform, arch)
    if (!existsSync(packageDir)) {
      throw new Error(`Missing prebuilt native package for ${platform}-${arch}: ${packageDir}`)
    }
  }

  console.log("✅ Prebuilt native opentui packages verified")
} else {
  console.log("Building local native opentui packages for all platforms...")
  await Bun.$`bun ${join(coreRoot, "scripts", "build.ts")} --native --all`
  console.log("✅ Local native opentui packages refreshed")
}
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
      tsconfig: join(packageRoot, "tsconfig.json"),
      sourcemap: "external",
      plugins: [workspaceAliasPlugin],
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
        chmodSync(outfile, 0o755)
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
