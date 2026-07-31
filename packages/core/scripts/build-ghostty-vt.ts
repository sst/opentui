import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

type Config = {
  repository: string
  revision: string
  version: string
  zigVersion: string
  simd: boolean
  symbolVisibility: "hidden"
  macosMinimumVersion: string
  patchRevision: number
}

type SdkManifest = Config & {
  headersSha256: string
  targets: Record<string, { archive: string; sha256: string; zig: string }>
}

type Target = {
  zig: string
  output: string
  archive: string
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = resolve(root, "../..")
const config = JSON.parse(readFileSync(join(root, "ghostty-vt.json"), "utf8")) as Config
const ghosttyCacheRoot = join(repoRoot, ".cache", "ghostty-vt")
const cacheRoot = join(ghosttyCacheRoot, config.revision)
const sourceRoot = join(cacheRoot, "source")
const sdkRoot = resolve(process.env.OPENTUI_GHOSTTY_VT_ROOT ?? join(ghosttyCacheRoot, "sdk"))
const force = process.argv.includes("--force")

const targets: Target[] = [
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

function hostTargets(): Target[] {
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch
  if (process.platform === "linux") {
    return targets.filter((target) => target.zig === `${arch}-linux-gnu.2.17` || target.zig === `${arch}-linux-musl`)
  }
  const os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform
  return targets.filter((target) => target.output === `${arch}-${os}`)
}

function requestedTargets(): Target[] {
  if (process.argv.includes("--all")) return targets
  const value = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
  if (!value) return hostTargets()
  const target = targets.find((candidate) => candidate.zig === value || candidate.output === value)
  if (!target) throw new Error(`Unsupported Ghostty target: ${value}`)
  return [target]
}

function archivePath(target: Target): string {
  return join(sdkRoot, "lib", target.output, target.archive)
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function headersSha256(): string {
  const root = join(sdkRoot, "include")
  const files: string[] = []
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) visit(path)
      else files.push(path)
    }
  }
  visit(root)
  const hash = createHash("sha256")
  for (const path of files) {
    hash.update(relative(root, path).replaceAll("\\", "/"))
    hash.update("\0")
    hash.update(readFileSync(path))
  }
  return hash.digest("hex")
}

function validateSdk(requested: Target[]): boolean {
  if (!existsSync(join(sdkRoot, "include", "ghostty", "vt.h"))) return false
  try {
    const manifest = JSON.parse(readFileSync(join(sdkRoot, "manifest.json"), "utf8")) as SdkManifest
    for (const key of [
      "repository",
      "revision",
      "version",
      "zigVersion",
      "simd",
      "symbolVisibility",
      "macosMinimumVersion",
      "patchRevision",
    ] as const) {
      if (manifest[key] !== config[key]) return false
    }
    if (manifest.headersSha256 !== headersSha256()) return false
    for (const target of requested) {
      const entry = manifest.targets[target.output]
      if (!entry || entry.zig !== target.zig || entry.archive !== target.archive) return false
      if (!existsSync(archivePath(target)) || entry.sha256 !== sha256(archivePath(target))) return false
    }
  } catch {
    return false
  }
  return true
}

const requested = requestedTargets()
if (!force && validateSdk(requested)) {
  console.log(`Using cached libghostty-vt SDK at ${sdkRoot}`)
  process.exit(0)
}

if (process.env.OPENTUI_GHOSTTY_VT_ROOT) {
  throw new Error(`OPENTUI_GHOSTTY_VT_ROOT is incomplete for: ${requested.map((target) => target.output).join(", ")}`)
}

if (existsSync(sdkRoot) && !validateSdk([])) rmSync(sdkRoot, { recursive: true, force: true })

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
const originalGhosttyRoot = run("git", ["show", `HEAD:${relative(sourceRoot, ghosttyRootSource)}`], sourceRoot, true)
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
  if (!force && existsSync(archivePath(target)) && existsSync(join(sdkRoot, "include", "ghostty", "vt.h"))) continue

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
  mkdirSync(dirname(archivePath(target)), { recursive: true })
  cpSync(builtArchive, archivePath(target))
  if (!existsSync(join(sdkRoot, "include", "ghostty", "vt.h"))) {
    mkdirSync(join(sdkRoot, "include"), { recursive: true })
    cpSync(join(sourceRoot, "include", "ghostty"), join(sdkRoot, "include", "ghostty"), { recursive: true })
  }
}

writeFileSync(
  join(sdkRoot, "manifest.json"),
  JSON.stringify(
    {
      ...config,
      headersSha256: headersSha256(),
      targets: Object.fromEntries(
        targets
          .filter((target) => existsSync(archivePath(target)))
          .map((target) => [
            target.output,
            { archive: target.archive, sha256: sha256(archivePath(target)), zig: target.zig },
          ]),
      ),
    },
    null,
    2,
  ) + "\n",
)
console.log(`Built libghostty-vt SDK at ${sdkRoot}`)
