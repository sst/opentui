import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ghosttyVtArchivePath,
  ghosttyVtHeadersSha256,
  ghosttyVtManifestTargets,
  type GhosttyVtConfig,
  type GhosttyVtTarget,
  validGhosttyVtTargets,
  validateGhosttyVtSdk,
} from "./ghostty-vt-sdk"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = resolve(root, "../..")
const config = JSON.parse(readFileSync(join(root, "ghostty-vt.json"), "utf8")) as GhosttyVtConfig
const ghosttyCacheRoot = join(repoRoot, ".cache", "ghostty-vt")
const cacheRoot = join(ghosttyCacheRoot, config.revision)
const sourceRoot = join(cacheRoot, "source")
const sdkRoot = resolve(process.env.OPENTUI_GHOSTTY_VT_ROOT ?? join(ghosttyCacheRoot, "sdk"))
const force = process.argv.includes("--force")

const targets: GhosttyVtTarget[] = [
  { zig: "x86_64-linux-gnu.2.17", output: "x86_64-linux", archive: "libghostty-vt.a" },
  { zig: "aarch64-linux-gnu.2.17", output: "aarch64-linux", archive: "libghostty-vt.a" },
  { zig: "x86_64-linux-musl", output: "x86_64-linux-musl", archive: "libghostty-vt.a" },
  { zig: "aarch64-linux-musl", output: "aarch64-linux-musl", archive: "libghostty-vt.a" },
  { zig: "x86_64-macos.13.0", output: "x86_64-macos", archive: "libghostty-vt.a" },
  { zig: "aarch64-macos.13.0", output: "aarch64-macos", archive: "libghostty-vt.a" },
  { zig: "x86_64-windows-gnu", output: "x86_64-windows", archive: "ghostty-vt-static.lib" },
  { zig: "aarch64-windows-gnu", output: "aarch64-windows", archive: "ghostty-vt-static.lib" },
]

function run(command: string, args: string[], cwd: string, capture = false): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`)
  return capture ? result.stdout.trim() : ""
}

function hostTargets(): GhosttyVtTarget[] {
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch
  if (process.platform === "linux") {
    return targets.filter((target) => target.zig === `${arch}-linux-gnu.2.17` || target.zig === `${arch}-linux-musl`)
  }
  const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform
  return targets.filter((target) => target.output === `${arch}-${os}`)
}

function requestedTargets(): GhosttyVtTarget[] {
  if (process.argv.includes("--all")) return targets
  const value = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
  if (!value) return hostTargets()
  const target = targets.find((candidate) => candidate.zig === value || candidate.output === value)
  if (!target) throw new Error(`Unsupported Ghostty target: ${value}`)
  return [target]
}

const requested = requestedTargets()
const validTargets = validGhosttyVtTargets(sdkRoot, config, targets)
if (!force && requested.every((target) => validTargets.has(target.output))) {
  console.log(`Using cached libghostty-vt SDK at ${sdkRoot}`)
  process.exit(0)
}

if (process.env.OPENTUI_GHOSTTY_VT_ROOT) {
  throw new Error(`OPENTUI_GHOSTTY_VT_ROOT is incomplete for: ${requested.map((target) => target.output).join(", ")}`)
}

if (existsSync(sdkRoot) && !validateGhosttyVtSdk(sdkRoot, config, [])) {
  rmSync(sdkRoot, { recursive: true, force: true })
  validTargets.clear()
}

const zigVersion = run("zig", ["version"], root, true)
if (zigVersion !== config.zigVersion) {
  throw new Error(`libghostty-vt ${config.revision} requires Zig ${config.zigVersion}; found ${zigVersion}`)
}

if (!existsSync(join(sourceRoot, ".git")) || run("git", ["rev-parse", "HEAD"], sourceRoot, true) !== config.revision) {
  rmSync(sourceRoot, { recursive: true, force: true })
  mkdirSync(sourceRoot, { recursive: true })
  run("git", ["init"], sourceRoot)
  run("git", ["remote", "add", "origin", config.repository], sourceRoot)
  run("git", ["fetch", "--depth=1", "origin", config.revision], sourceRoot)
  run("git", ["checkout", "--detach", "FETCH_HEAD"], sourceRoot)
}

const ghosttyRootSource = join(sourceRoot, "src", "lib_vt.zig")
const ghosttyRootGitPath = relative(sourceRoot, ghosttyRootSource).replaceAll("\\", "/")
const originalGhosttyRoot = run("git", ["show", `HEAD:${ghosttyRootGitPath}`], sourceRoot, true)
let hiddenSymbolCount = 0
const hiddenGhosttyRoot = originalGhosttyRoot.replace(/\.\{ \.name = ("ghostty_[^"]+") \}/g, (_, name: string) => {
  hiddenSymbolCount++
  return `.{ .name = ${name}, .visibility = .hidden }`
})
const exportedSymbolCount = originalGhosttyRoot.match(/@export\(/g)?.length ?? 0
if (hiddenSymbolCount === 0 || hiddenSymbolCount !== exportedSymbolCount) {
  throw new Error(`Failed to hide every libghostty-vt C export (${hiddenSymbolCount}/${exportedSymbolCount})`)
}
writeFileSync(ghosttyRootSource, hiddenGhosttyRoot + "\n")

const ghosttyBuildSource = join(sourceRoot, "build.zig")
const originalGhosttyBuild = run("git", ["show", "HEAD:build.zig"], sourceRoot, true)
const staticOnlyGhosttyBuild = originalGhosttyBuild.replace(
  "    libghostty_vt_shared.install(b.getInstallStep());",
  "    _ = libghostty_vt_shared; // OpenTUI consumes only the static artifact.",
)
if (staticOnlyGhosttyBuild === originalGhosttyBuild)
  throw new Error("Failed to disable the libghostty-vt shared install")
writeFileSync(ghosttyBuildSource, staticOnlyGhosttyBuild + "\n")

for (const target of requested) {
  if (!force && validTargets.has(target.output)) continue

  const prefix = join(cacheRoot, "build", target.output)
  rmSync(prefix, { recursive: true, force: true })
  mkdirSync(prefix, { recursive: true })
  console.log(`Building libghostty-vt ${config.revision.slice(0, 8)} for ${target.zig}...`)
  run(
    "zig",
    [
      "build",
      "--prefix",
      prefix,
      "-Demit-lib-vt=true",
      "-Demit-xcframework=false",
      `-Dtarget=${target.zig}`,
      "-Dcpu=baseline",
      "-Doptimize=ReleaseFast",
      `-Dsimd=${config.simd}`,
      `-Dlib-version-string=${config.version}`,
    ],
    sourceRoot,
  )

  const builtArchive = join(prefix, "lib", target.archive)
  if (!existsSync(builtArchive)) throw new Error(`Ghostty build did not produce ${builtArchive}`)
  const archive = ghosttyVtArchivePath(sdkRoot, target)
  mkdirSync(dirname(archive), { recursive: true })
  cpSync(builtArchive, archive)
  if (!existsSync(join(sdkRoot, "include", "ghostty", "vt.h"))) {
    mkdirSync(join(sdkRoot, "include"), { recursive: true })
    cpSync(join(sourceRoot, "include", "ghostty"), join(sdkRoot, "include", "ghostty"), { recursive: true })
  }
  validTargets.add(target.output)
}

writeFileSync(
  join(sdkRoot, "manifest.json"),
  JSON.stringify(
    {
      ...config,
      headersSha256: ghosttyVtHeadersSha256(sdkRoot),
      targets: ghosttyVtManifestTargets(sdkRoot, targets, validTargets),
    },
    null,
    2,
  ) + "\n",
)
console.log(`Built libghostty-vt SDK at ${sdkRoot}`)
