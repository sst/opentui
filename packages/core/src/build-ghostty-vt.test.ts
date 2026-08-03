import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  ghosttyVtArchivePath,
  ghosttyVtHeadersSha256,
  ghosttyVtManifestTargets,
  type GhosttyVtConfig,
  type GhosttyVtTarget,
  readGhosttyVtSourceRevision,
  restoreGhosttyVtSource,
  resolveGhosttyVtRootOverride,
  sha256,
  validGhosttyVtTargets,
} from "../scripts/ghostty-vt-sdk"

const config: GhosttyVtConfig = {
  repository: "https://example.com/ghostty.git",
  revision: "revision",
  version: "version",
  zigVersion: "0.15.2",
  simd: false,
  symbolVisibility: "hidden",
  macosMinimumVersion: "13.0.0",
  patchRevision: 1,
}

const targets: GhosttyVtTarget[] = [
  { zig: "aarch64-macos.13.0", output: "aarch64-macos", archive: "libghostty-vt.a" },
  { zig: "x86_64-linux-gnu.2.17", output: "x86_64-linux", archive: "libghostty-vt.a" },
]

let testRoot: string | undefined

afterEach(() => {
  if (testRoot) rmSync(testRoot, { recursive: true, force: true })
  testRoot = undefined
})

describe("Ghostty VT SDK cache", () => {
  test("treats an empty external SDK root as unset", () => {
    expect(resolveGhosttyVtRootOverride(undefined, "/tmp/build")).toBeUndefined()
    expect(resolveGhosttyVtRootOverride("", "/tmp/build")).toBeUndefined()
  })

  test("resolves a relative external SDK root from the core package", () => {
    const packageRoot = join(import.meta.dirname, "..")
    const repoRoot = join(packageRoot, "../..")
    const resolved = resolveGhosttyVtRootOverride("relative-sdk", packageRoot)

    expect(resolved).toBe(join(packageRoot, "relative-sdk"))
    expect(resolved).not.toBe(join(repoRoot, "relative-sdk"))
  })

  test("does not trust or re-record an archive whose checksum changed", () => {
    testRoot = mkdtempSync(join(tmpdir(), "opentui-ghostty-vt-sdk-"))
    mkdirSync(join(testRoot, "include", "ghostty"), { recursive: true })
    writeFileSync(join(testRoot, "include", "ghostty", "vt.h"), "header")

    for (const target of targets) {
      const archive = ghosttyVtArchivePath(testRoot, target)
      mkdirSync(dirname(archive), { recursive: true })
      writeFileSync(archive, target.output)
    }

    writeFileSync(
      join(testRoot, "manifest.json"),
      JSON.stringify({
        ...config,
        headersSha256: ghosttyVtHeadersSha256(testRoot),
        targets: Object.fromEntries(
          targets.map((target) => [
            target.output,
            {
              archive: target.archive,
              sha256: sha256(ghosttyVtArchivePath(testRoot!, target)),
              zig: target.zig,
            },
          ]),
        ),
      }),
    )

    writeFileSync(ghosttyVtArchivePath(testRoot, targets[0]), "changed archive")

    const validTargets = validGhosttyVtTargets(testRoot, config, targets)
    expect(validTargets).toEqual(new Set([targets[1].output]))
    expect(ghosttyVtManifestTargets(testRoot, targets, validTargets)).toEqual({
      [targets[1].output]: {
        archive: targets[1].archive,
        sha256: sha256(ghosttyVtArchivePath(testRoot, targets[1])),
        zig: targets[1].zig,
      },
    })
  })

  test("restores the pinned source before rebuilding", () => {
    testRoot = mkdtempSync(join(tmpdir(), "opentui-ghostty-vt-source-"))
    const sourceRoot = join(testRoot, "source")
    mkdirSync(sourceRoot)

    const run = (command: string, args: string[], cwd: string, capture = false): string => {
      const result = spawnSync(command, args, { cwd, encoding: "utf8" })
      if (result.status !== 0) throw new Error(result.stderr)
      return capture ? result.stdout.trim() : ""
    }

    run("git", ["init"], sourceRoot)
    run("git", ["config", "core.autocrlf", "false"], sourceRoot)
    expect(readGhosttyVtSourceRevision(sourceRoot, run)).toBeNull()
    writeFileSync(join(sourceRoot, ".gitignore"), ".zig-cache\n")
    writeFileSync(join(sourceRoot, "source.zig"), "original\n")
    run("git", ["add", ".gitignore", "source.zig"], sourceRoot)
    run(
      "git",
      ["-c", "user.name=OpenTUI Test", "-c", "user.email=test@opentui.dev", "commit", "-m", "fixture"],
      sourceRoot,
    )
    const revision = run("git", ["rev-parse", "HEAD"], sourceRoot, true)
    expect(readGhosttyVtSourceRevision(sourceRoot, run)).toBe(revision)

    writeFileSync(join(sourceRoot, "source.zig"), "modified\n")
    writeFileSync(join(sourceRoot, "untracked.zig"), "untracked\n")
    mkdirSync(join(sourceRoot, ".zig-cache"))
    writeFileSync(join(sourceRoot, ".zig-cache", "cache"), "cache\n")

    restoreGhosttyVtSource(sourceRoot, revision, run)

    expect(readFileSync(join(sourceRoot, "source.zig"), "utf8")).toBe("original\n")
    expect(existsSync(join(sourceRoot, "untracked.zig"))).toBe(false)
    expect(existsSync(join(sourceRoot, ".zig-cache", "cache"))).toBe(true)
  })

  test("validates an external SDK before starting the native build", () => {
    testRoot = mkdtempSync(join(tmpdir(), "opentui-ghostty-vt-external-"))
    const result = spawnSync(process.execPath, ["scripts/build.ts", "--native"], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, OPENTUI_GHOSTTY_VT_ROOT: testRoot },
    })

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain("OPENTUI_GHOSTTY_VT_ROOT is incomplete")
  })
})
