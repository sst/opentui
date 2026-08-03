import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

export type GhosttyVtConfig = {
  repository: string
  revision: string
  version: string
  zigVersion: string
  simd: boolean
  symbolVisibility: "hidden"
  macosMinimumVersion: string
  patchRevision: number
}

export type GhosttyVtTarget = {
  zig: string
  output: string
  archive: string
}

type RunCommand = (command: string, args: string[], cwd: string, capture?: boolean) => string

type SdkManifest = GhosttyVtConfig & {
  headersSha256: string
  targets: Record<string, { archive: string; sha256: string; zig: string }>
}

export function ghosttyVtArchivePath(sdkRoot: string, target: GhosttyVtTarget): string {
  return join(sdkRoot, "lib", target.output, target.archive)
}

export function resolveGhosttyVtRootOverride(value: string | undefined, baseDir: string): string | undefined {
  return value ? resolve(baseDir, value) : undefined
}

export function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

export function ghosttyVtHeadersSha256(sdkRoot: string): string {
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

export function validateGhosttyVtSdk(sdkRoot: string, config: GhosttyVtConfig, requested: GhosttyVtTarget[]): boolean {
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
    if (manifest.headersSha256 !== ghosttyVtHeadersSha256(sdkRoot)) return false
    for (const target of requested) {
      const entry = manifest.targets[target.output]
      if (!entry || entry.zig !== target.zig || entry.archive !== target.archive) return false
      const archive = ghosttyVtArchivePath(sdkRoot, target)
      if (!existsSync(archive) || entry.sha256 !== sha256(archive)) return false
    }
  } catch {
    return false
  }
  return true
}

export function validGhosttyVtTargets(
  sdkRoot: string,
  config: GhosttyVtConfig,
  targets: GhosttyVtTarget[],
): Set<string> {
  return new Set(
    targets.filter((target) => validateGhosttyVtSdk(sdkRoot, config, [target])).map((target) => target.output),
  )
}

export function ghosttyVtManifestTargets(
  sdkRoot: string,
  targets: GhosttyVtTarget[],
  validTargets: ReadonlySet<string>,
): SdkManifest["targets"] {
  return Object.fromEntries(
    targets
      .filter((target) => validTargets.has(target.output) && existsSync(ghosttyVtArchivePath(sdkRoot, target)))
      .map((target) => [
        target.output,
        { archive: target.archive, sha256: sha256(ghosttyVtArchivePath(sdkRoot, target)), zig: target.zig },
      ]),
  )
}

export function restoreGhosttyVtSource(sourceRoot: string, revision: string, run: RunCommand): void {
  run("git", ["reset", "--hard", revision], sourceRoot)
  run("git", ["clean", "-fd"], sourceRoot)
}

export function readGhosttyVtSourceRevision(sourceRoot: string, run: RunCommand): string | null {
  if (!existsSync(join(sourceRoot, ".git"))) return null
  try {
    return run("git", ["rev-parse", "HEAD"], sourceRoot, true)
  } catch {
    return null
  }
}
